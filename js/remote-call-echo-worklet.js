// A conservative residual-echo canceller. Both inputs share one AudioContext
// clock: input 0 is the microphone, input 1 is the audio actually being played.
class RemoteCallEchoProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.historySize = 1;
    while (this.historySize < sampleRate * 0.6) this.historySize *= 2;
    this.mask = this.historySize - 1;
    this.microphone = new Float32Array(this.historySize);
    this.playback = new Float32Array(this.historySize);
    this.lowMicrophone = new Float32Array(this.historySize);
    this.lowPlayback = new Float32Array(this.historySize);
    this.micLowState = 0;
    this.playbackLowState = 0;
    this.position = 0;
    this.windowSize = 1024;
    this.maximumLag = Math.min(Math.round(sampleRate * 0.35), this.historySize - this.windowSize - 1);
    this.searchInterval = Math.round(sampleRate * 0.05);
    this.nextSearch = this.maximumLag + this.windowSize;
    this.lag = 0;
    this.targetGain = 0;
    this.gain = 0;
    this.muted = false;
    this.port.onmessage = event => {
      if (event.data?.type === 'mute') {
        this.muted = event.data.muted === true;
        if (this.muted) this.targetGain = this.gain = 0;
      }
    };
  }

  findEcho() {
    let coarseCorrelation = 0;
    let coarseLag = 0;
    for (let lag = 0; lag <= this.maximumLag; lag += 16) {
      let dot = 0;
      let micEnergy = 0;
      let playbackEnergy = 0;
      for (let i = 0; i < this.windowSize; i += 4) {
        const index = (this.position - 1 - i) & this.mask;
        const mic = this.lowMicrophone[index];
        const ref = this.lowPlayback[(index - lag) & this.mask];
        dot += mic * ref;
        micEnergy += mic * mic;
        playbackEnergy += ref * ref;
      }
      if (micEnergy < 0.0005 || playbackEnergy < 0.0005 || dot <= 0) continue;
      const correlation = dot / Math.sqrt(micEnergy * playbackEnergy);
      if (correlation > coarseCorrelation) {
        coarseCorrelation = correlation;
        coarseLag = lag;
      }
    }
    let bestCorrelation = 0;
    let bestLag = 0;
    let bestGain = 0;
    for (let lag = Math.max(0, coarseLag - 64);
      lag <= Math.min(this.maximumLag, coarseLag + 64); lag++) {
      let dot = 0;
      let micEnergy = 0;
      let playbackEnergy = 0;
      for (let i = 0; i < this.windowSize; i += 2) {
        const index = (this.position - 1 - i) & this.mask;
        const mic = this.microphone[index];
        const ref = this.playback[(index - lag) & this.mask];
        dot += mic * ref;
        micEnergy += mic * mic;
        playbackEnergy += ref * ref;
      }
      if (micEnergy < 0.0005 || playbackEnergy < 0.0005 || dot <= 0) continue;
      const correlation = dot / Math.sqrt(micEnergy * playbackEnergy);
      if (correlation > bestCorrelation) {
        bestCorrelation = correlation;
        bestLag = lag;
        bestGain = dot / playbackEnergy;
      }
    }
    // A high correlation is required so simultaneous local speech passes through.
    if (bestCorrelation >= 0.72) {
      this.lag = bestLag;
      this.targetGain = Math.min(0.85, Math.max(0, bestGain));
    } else {
      this.targetGain = 0;
    }
  }

  process(inputs, outputs) {
    const output = outputs[0]?.[0];
    if (!output) return true;
    const microphone = inputs[0]?.[0];
    const playbackLeft = inputs[1]?.[0];
    const playbackRight = inputs[1]?.[1];
    const start = this.position;
    for (let i = 0; i < output.length; i++) {
      const reference = playbackRight
        ? ((playbackLeft?.[i] || 0) + playbackRight[i]) * 0.5
        : playbackLeft?.[i] || 0;
      const mic = microphone?.[i] || 0;
      this.micLowState += 0.05 * (mic - this.micLowState);
      this.playbackLowState += 0.05 * (reference - this.playbackLowState);
      this.microphone[this.position & this.mask] = mic;
      this.playback[this.position & this.mask] = reference;
      this.lowMicrophone[this.position & this.mask] = this.micLowState;
      this.lowPlayback[this.position & this.mask] = this.playbackLowState;
      this.position++;
    }
    if (this.position >= this.nextSearch) {
      this.findEcho();
      this.nextSearch = this.position + this.searchInterval;
    }
    for (let i = 0; i < output.length; i++) {
      if (this.muted) {
        output[i] = 0;
        continue;
      }
      this.gain += 0.005 * (this.targetGain - this.gain);
      const mic = microphone?.[i] || 0;
      const ref = this.playback[(start + i - this.lag) & this.mask];
      output[i] = Math.max(-1, Math.min(1, mic - this.gain * ref));
    }
    return true;
  }
}

registerProcessor('remote-call-echo', RemoteCallEchoProcessor);
