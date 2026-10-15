// Experimental suppression using the closest own audio chunk and three earlier
// chunks. A bounded search matches delayed echo inside that capture window.
const REFERENCE_FLOOR = 0.0001;
const CORRELATION_THRESHOLD = 0.65;
const SEARCH_CANDIDATES_PER_BLOCK = 256;
const SEARCH_SAMPLES_PER_BLOCK = 32768;

class RemoteCallEchoProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.history = new Float32Array(Math.round(sampleRate * 0.04));
    this.querySamples = new Float32Array(this.history.length);
    this.reset();
    this.port.onmessage = event => {
      const message = event.data;
      if (message?.type === 'reset') {
        this.reset();
      } else if (message?.type === 'clock' && Number.isFinite(message.mediaMs) && Number.isFinite(message.contextTime)) {
        this.offsetMs = message.mediaMs - message.contextTime * 1000;
        this.playing = message.playing === true;
        this.segments = this.segments.filter(segment => segment.endMs >= message.mediaMs - 2000);
      } else if (message?.type === 'reference' && Number.isFinite(message.startMs)
        && Number.isFinite(message.endMs) && message.endMs > message.startMs
        && Number.isFinite(message.referenceStartMs)
        && message.samples instanceof Float32Array && message.samples.length
        && message.scanSamples instanceof Float32Array && message.scanSamples.length
        && Number.isSafeInteger(message.scanStride) && message.scanStride > 0
        && message.scanSamples.length === Math.floor(message.samples.length / message.scanStride)) {
        this.segments.push(message);
        if (this.segments.length > 16) this.segments.shift();
      }
    };
  }

  reset() {
    this.segments = [];
    this.offsetMs = null;
    this.playing = false;
    this.suppressionGain = 1;
    this.historyLength = 0;
    this.historyIndex = 0;
    this.lastMediaEndMs = null;
    this.referenceOffsetMs = 0;
    this.search = null;
  }

  statistics(samples) {
    let sum = 0;
    let power = 0;
    for (const value of samples) { sum += value; power += value * value; }
    return { samples, sum, energy: Math.max(0, power - sum * sum / samples.length) };
  }

  correlationAt(samples, offset, query) {
    let sum = 0;
    let power = 0;
    let dot = 0;
    for (let i = 0; i < query.samples.length; i++) {
      const value = samples[offset + i];
      sum += value;
      power += value * value;
      dot += value * query.samples[i];
    }
    const energy = power - sum * sum / query.samples.length;
    return energy > 0 && query.energy > 0
      ? (dot - sum * query.sum / query.samples.length) / Math.sqrt(energy * query.energy) : 0;
  }

  startSearch(segment, frameEndMs) {
    if (!segment || this.historyLength < this.history.length) return;
    for (let i = 0; i < this.history.length; i++) {
      this.querySamples[i] = this.history[(this.historyIndex + i) % this.history.length];
    }
    const coarse = new Float32Array(Math.floor(this.querySamples.length / segment.scanStride));
    if (coarse.length < 2 || segment.scanSamples.length < coarse.length) return;
    for (let i = 0; i < coarse.length; i++) {
      let sum = 0;
      for (let j = 0; j < segment.scanStride; j++) sum += this.querySamples[i * segment.scanStride + j];
      coarse[i] = sum / segment.scanStride;
    }
    const query = this.statistics(coarse);
    if (query.energy <= 1e-12) return;
    this.search = { segment, query, fullQuery: this.statistics(this.querySamples),
      startMs: frameEndMs - this.history.length * 1000 / sampleRate,
      next: 0, best: 0, score: 0 };
  }

  advanceSearch() {
    const search = this.search;
    if (!search) return;
    const { segment, query } = search;
    if (!search.refining) {
      const last = segment.scanSamples.length - query.samples.length;
      const count = Math.min(SEARCH_CANDIDATES_PER_BLOCK,
        Math.max(1, Math.floor(SEARCH_SAMPLES_PER_BLOCK / query.samples.length)));
      const end = Math.min(last + 1, search.next + count);
      for (; search.next < end; search.next++) {
        const score = this.correlationAt(segment.scanSamples, search.next, query);
        if (score > search.score) { search.score = score; search.best = search.next; }
      }
      if (search.next <= last) return;
      if (search.score <= CORRELATION_THRESHOLD) { this.search = null; return; }
      // Refine at the original sample rate, also spread across render blocks.
      const center = search.best * segment.scanStride;
      search.refining = true;
      search.next = Math.max(0, center - segment.scanStride);
      search.last = Math.min(segment.samples.length - this.querySamples.length, center + segment.scanStride);
      search.best = null;
      search.score = CORRELATION_THRESHOLD;
      return;
    }
    const count = Math.max(1, Math.floor(SEARCH_SAMPLES_PER_BLOCK / search.fullQuery.samples.length));
    const end = Math.min(search.last + 1, search.next + count);
    for (; search.next < end; search.next++) {
      const score = this.correlationAt(segment.samples, search.next, search.fullQuery);
      if (score > search.score) { search.score = score; search.best = search.next; }
    }
    if (search.next <= search.last) return;
    if (search.best !== null) {
      this.referenceOffsetMs = segment.referenceStartMs + search.best * 1000 / sampleRate - search.startMs;
    }
    this.search = null;
  }

  process(inputs, outputs) {
    const output = outputs[0]?.[0];
    if (!output) return true;
    const channels = inputs[0] || [];
    const frameStartMs = this.playing && this.offsetMs !== null ? currentTime * 1000 + this.offsetMs : null;
    if (frameStartMs === null || (this.lastMediaEndMs !== null && Math.abs(frameStartMs - this.lastMediaEndMs) > 10)) {
      this.historyLength = 0;
      this.historyIndex = 0;
      this.search = null;
      this.referenceOffsetMs = 0;
    }
    this.lastMediaEndMs = frameStartMs === null ? null : frameStartMs + output.length * 1000 / sampleRate;
    let ownPower = 0;
    let remotePower = 0;
    let correlation = 0;
    for (let i = 0; i < output.length; i++) {
      let remote = 0;
      for (const channel of channels) remote += channel[i] || 0;
      if (channels.length) remote /= channels.length;
      output[i] = remote;
      let own = 0;
      if (frameStartMs !== null) {
        this.history[this.historyIndex] = remote;
        this.historyIndex = (this.historyIndex + 1) % this.history.length;
        this.historyLength = Math.min(this.historyLength + 1, this.history.length);
        const time = frameStartMs + i * 1000 / sampleRate;
        const segment = this.segments.find(entry => time >= entry.startMs && time < entry.endMs);
        const position = segment ? Math.round((time + this.referenceOffsetMs - segment.referenceStartMs) * sampleRate / 1000) : -1;
        own = segment?.samples[position] || 0;
      }
      ownPower += own * own;
      remotePower += remote * remote;
      correlation += own * remote;
    }
    if (frameStartMs !== null) {
      if (!this.search) this.startSearch(this.segments.find(segment => frameStartMs >= segment.startMs && frameStartMs < segment.endMs), this.lastMediaEndMs);
      this.advanceSearch();
    }
    const similarity = ownPower && remotePower ? correlation / Math.sqrt(ownPower * remotePower) : 0;
    const target = ownPower / output.length > REFERENCE_FLOOR && similarity > CORRELATION_THRESHOLD ? 0.25 : 1;
    this.suppressionGain += (target - this.suppressionGain) * (target < this.suppressionGain ? 0.5 : 0.1);
    for (let i = 0; i < output.length; i++) output[i] *= this.suppressionGain;
    return true;
  }
}

registerProcessor('remote-call-echo', RemoteCallEchoProcessor);
