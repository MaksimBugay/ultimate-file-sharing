// Residual echo suppressor for the incoming remote stream. Input 0 is the remote
// playback. The reference is our own recorded audio, rebuilt on the main thread from
// the playback marks the peer attached to its chunks, and keyed by the remote media
// time. No delay is estimated here; a fixed tolerance window covers device latency.
const FRAME = 512;
const HOP = FRAME / 2;
const BINS = FRAME / 2 + 1;
const OUTPUT_SIZE = 4096;
const TOLERANCE_MS = 80;
const REFERENCE_FLOOR = 0.01;
const MAX_LEAK = 2;
const OVER_SUBTRACTION = 2;
const MIN_GAIN = 0.1;

class Fft {
  constructor(size) {
    this.size = size;
    const bits = Math.log2(size);
    this.reverse = new Uint32Array(size);
    for (let i = 0; i < size; i++) {
      let reversed = 0;
      for (let bit = 0; bit < bits; bit++) reversed |= ((i >> bit) & 1) << (bits - 1 - bit);
      this.reverse[i] = reversed;
    }
    this.cos = new Float32Array(size / 2);
    this.sin = new Float32Array(size / 2);
    for (let i = 0; i < size / 2; i++) {
      this.cos[i] = Math.cos(-2 * Math.PI * i / size);
      this.sin[i] = Math.sin(-2 * Math.PI * i / size);
    }
  }

  // In-place forward transform; the inverse conjugates the input and the output.
  transform(re, im) {
    const size = this.size;
    for (let i = 0; i < size; i++) {
      const j = this.reverse[i];
      if (j <= i) continue;
      let swap = re[i]; re[i] = re[j]; re[j] = swap;
      swap = im[i]; im[i] = im[j]; im[j] = swap;
    }
    for (let length = 2; length <= size; length <<= 1) {
      const half = length >> 1;
      const step = size / length;
      for (let start = 0; start < size; start += length) {
        for (let k = 0; k < half; k++) {
          const wr = this.cos[k * step];
          const wi = this.sin[k * step];
          const a = start + k;
          const b = a + half;
          const xr = re[b] * wr - im[b] * wi;
          const xi = re[b] * wi + im[b] * wr;
          re[b] = re[a] - xr;
          im[b] = im[a] - xi;
          re[a] += xr;
          im[a] += xi;
        }
      }
    }
  }
}

class RemoteCallEchoProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.fft = new Fft(FRAME);
    // Square-root periodic Hann for analysis and synthesis sums to one at 50% overlap.
    this.window = new Float32Array(FRAME);
    for (let i = 0; i < FRAME; i++) this.window[i] = Math.sqrt(0.5 - 0.5 * Math.cos(2 * Math.PI * i / FRAME));
    this.input = new Float32Array(FRAME);
    this.inputPosition = 0;
    this.pending = 0;
    this.overlap = new Float32Array(FRAME);
    this.output = new Float32Array(OUTPUT_SIZE);
    this.readPosition = 0;
    this.writePosition = HOP;
    this.re = new Float32Array(FRAME);
    this.im = new Float32Array(FRAME);
    this.reference = new Float32Array(FRAME);
    this.referenceRe = new Float32Array(FRAME);
    this.referenceIm = new Float32Array(FRAME);
    // Reference power spectra from TOLERANCE_MS before to TOLERANCE_MS after the frame.
    const historyLength = 2 * Math.ceil(TOLERANCE_MS * sampleRate / 1000 / HOP) + 1;
    this.history = Array.from({ length: historyLength }, () => new Float32Array(BINS));
    this.historyPosition = 0;
    this.echoPower = new Float32Array(BINS);
    this.leak = new Float32Array(BINS);
    this.gain = new Float32Array(BINS).fill(1);
    this.segments = [];
    this.offsetMs = null;
    this.playing = false;
    this.port.onmessage = event => this.onMessage(event.data);
  }

  onMessage(message) {
    if (message?.type === 'reset') {
      this.segments = [];
      this.offsetMs = null;
      this.playing = false;
      this.history.forEach(powers => powers.fill(0));
      this.leak.fill(0);
      this.gain.fill(1);
    } else if (message?.type === 'clock' && Number.isFinite(message.mediaMs)
      && Number.isFinite(message.contextTime)) {
      // The media clock advances with the context clock while playing; smooth the
      // main-thread sampling jitter and snap after seeks or stalls.
      const offset = message.mediaMs - message.contextTime * 1000;
      if (this.offsetMs === null || Math.abs(offset - this.offsetMs) > 100) this.offsetMs = offset;
      else this.offsetMs += 0.05 * (offset - this.offsetMs);
      this.playing = message.playing === true;
      const oldestMs = message.mediaMs - 2000;
      this.segments = this.segments.filter(segment => segment.endMs >= oldestMs);
    } else if (message?.type === 'reference' && Number.isFinite(message.startMs)
      && message.samples instanceof Float32Array && message.samples.length) {
      const segment = {
        startMs: message.startMs,
        endMs: message.startMs + message.samples.length * 1000 / sampleRate,
        samples: message.samples
      };
      this.segments = this.segments.filter(existing => existing.startMs !== segment.startMs);
      this.segments.push(segment);
      this.segments.sort((a, b) => a.startMs - b.startMs);
    }
  }

  readReference(startMs) {
    this.reference.fill(0);
    let found = false;
    const endMs = startMs + FRAME * 1000 / sampleRate;
    for (const segment of this.segments) {
      if (segment.endMs <= startMs || segment.startMs >= endMs) continue;
      const offset = Math.round((segment.startMs - startMs) * sampleRate / 1000);
      const from = Math.max(0, offset);
      const to = Math.min(FRAME, offset + segment.samples.length);
      if (to <= from) continue;
      this.reference.set(segment.samples.subarray(from - offset, to - offset), from);
      found = true;
    }
    return found;
  }

  processFrame(frameStartMs) {
    const { re, im, fft, window } = this;
    for (let i = 0; i < FRAME; i++) {
      re[i] = this.input[(this.inputPosition + i) % FRAME] * window[i];
      im[i] = 0;
    }
    fft.transform(re, im);

    const powers = this.history[this.historyPosition];
    this.historyPosition = (this.historyPosition + 1) % this.history.length;
    if (frameStartMs !== null && this.readReference(frameStartMs + TOLERANCE_MS)) {
      for (let i = 0; i < FRAME; i++) {
        this.referenceRe[i] = this.reference[i] * window[i];
        this.referenceIm[i] = 0;
      }
      fft.transform(this.referenceRe, this.referenceIm);
      for (let k = 0; k < BINS; k++) {
        powers[k] = this.referenceRe[k] * this.referenceRe[k] + this.referenceIm[k] * this.referenceIm[k];
      }
    } else {
      powers.fill(0);
    }
    this.echoPower.fill(0);
    for (const history of this.history) {
      for (let k = 0; k < BINS; k++) if (history[k] > this.echoPower[k]) this.echoPower[k] = history[k];
    }

    for (let k = 0; k < BINS; k++) {
      const remote = re[k] * re[k] + im[k] * im[k];
      const reference = this.echoPower[k];
      let target = 1;
      if (reference > REFERENCE_FLOOR) {
        // Track the lower envelope of remote/reference: it falls quickly to the echo
        // coupling and rises slowly, so the peer talking over us is not learned as echo.
        const ratio = Math.min(MAX_LEAK, remote / reference);
        this.leak[k] += (ratio < this.leak[k] ? 0.2 : 0.002) * (ratio - this.leak[k]);
        const echo = OVER_SUBTRACTION * this.leak[k] * reference;
        target = remote > 0 ? Math.max(MIN_GAIN, 1 - echo / remote) : MIN_GAIN;
      }
      this.gain[k] += (target < this.gain[k] ? 0.6 : 0.15) * (target - this.gain[k]);
      re[k] *= this.gain[k];
      im[k] *= this.gain[k];
      if (k > 0 && k < FRAME / 2) {
        re[FRAME - k] *= this.gain[k];
        im[FRAME - k] *= this.gain[k];
      }
    }

    for (let i = 0; i < FRAME; i++) im[i] = -im[i];
    fft.transform(re, im);
    for (let i = 0; i < FRAME; i++) this.overlap[i] += re[i] / FRAME * window[i];
    for (let i = 0; i < HOP; i++) this.output[this.writePosition++ % OUTPUT_SIZE] = this.overlap[i];
    this.overlap.copyWithin(0, HOP);
    this.overlap.fill(0, FRAME - HOP);
  }

  process(inputs, outputs) {
    const output = outputs[0]?.[0];
    if (!output) return true;
    const channels = inputs[0] || [];
    for (let i = 0; i < output.length; i++) {
      let sample = 0;
      for (const channel of channels) sample += channel[i];
      this.input[this.inputPosition] = channels.length ? sample / channels.length : 0;
      this.inputPosition = (this.inputPosition + 1) % FRAME;
      if (++this.pending === HOP) {
        this.pending = 0;
        const frameEndMs = (currentTime + (i + 1) / sampleRate) * 1000;
        this.processFrame(this.playing && this.offsetMs !== null
          ? frameEndMs + this.offsetMs - FRAME * 1000 / sampleRate : null);
      }
      output[i] = this.readPosition < this.writePosition ? this.output[this.readPosition++ % OUTPUT_SIZE] : 0;
    }
    return true;
  }
}

registerProcessor('remote-call-echo', RemoteCallEchoProcessor);
