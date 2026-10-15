// Experimental suppression using only the closest synchronized own audio frame.
// References and incoming playback use the same capture timeline. No network or
// acoustic delay compensation is applied.
const REFERENCE_FLOOR = 0.0001;
const CORRELATION_THRESHOLD = 0.65;

class RemoteCallEchoProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.segments = [];
    this.offsetMs = null;
    this.playing = false;
    this.gain = 1;
    this.port.onmessage = event => {
      const message = event.data;
      if (message?.type === 'reset') {
        this.segments = [];
        this.offsetMs = null;
        this.playing = false;
        this.gain = 1;
      } else if (message?.type === 'clock' && Number.isFinite(message.mediaMs) && Number.isFinite(message.contextTime)) {
        this.offsetMs = message.mediaMs - message.contextTime * 1000;
        this.playing = message.playing === true;
        this.segments = this.segments.filter(segment => segment.endMs >= message.mediaMs - 2000);
      } else if (message?.type === 'reference' && Number.isFinite(message.startMs)
        && message.samples instanceof Float32Array && message.samples.length) {
        this.segments.push({ startMs: message.startMs,
          endMs: message.startMs + message.samples.length * 1000 / sampleRate, samples: message.samples });
        if (this.segments.length > 16) this.segments.shift();
      }
    };
  }

  process(inputs, outputs) {
    const output = outputs[0]?.[0];
    if (!output) return true;
    const channels = inputs[0] || [];
    const frameStartMs = this.playing && this.offsetMs !== null ? currentTime * 1000 + this.offsetMs : null;
    let ownPower = 0;
    let remotePower = 0;
    let correlation = 0;
    for (let i = 0; i < output.length; i++) {
      let remote = 0;
      for (const channel of channels) remote += channel[i] || 0;
      if (channels.length) remote /= channels.length;
      output[i] = remote;
      const time = frameStartMs === null ? null : frameStartMs + i * 1000 / sampleRate;
      const segment = time === null ? null : this.segments.find(entry => time >= entry.startMs && time < entry.endMs);
      const own = segment ? segment.samples[Math.floor((time - segment.startMs) * sampleRate / 1000)] || 0 : 0;
      ownPower += own * own;
      remotePower += remote * remote;
      correlation += own * remote;
    }
    const similarity = ownPower && remotePower ? correlation / Math.sqrt(ownPower * remotePower) : 0;
    const target = ownPower / output.length > REFERENCE_FLOOR && similarity > CORRELATION_THRESHOLD ? 0.25 : 1;
    this.gain += (target - this.gain) * (target < this.gain ? 0.5 : 0.1);
    for (let i = 0; i < output.length; i++) output[i] *= this.gain;
    return true;
  }
}

registerProcessor('remote-call-echo', RemoteCallEchoProcessor);
