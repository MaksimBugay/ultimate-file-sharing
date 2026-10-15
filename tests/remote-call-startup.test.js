const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../js/remote-call.js'), 'utf8');

function callHarness(withUnavailableAudioContext, search = '', behavior = {}) {
  const elements = new Map();
  const startedRecorders = [];
  const attemptedRecorders = [];
  const captureRequests = [];
  const stoppedInputs = [];
  const audioInputs = [];
  const constraintRequests = [];
  let stoppedCalls = 0;
  let now = 100;
  let timerId = 0;
  const timers = new Map();
  const published = [];
  const captureSettings = [];
  let captureDraws = 0;
  const makeAudioTrack = (readyState = 'live') => ({
    kind: 'audio', readyState, enabled: true, echoMode: true,
    stop() { this.readyState = 'ended'; stoppedInputs.push(this); },
    getCapabilities: () => ({ echoCancellation: behavior.systemEchoMode ? [true, false, 'all'] : [true, false] }),
    getSettings() { return { echoCancellation: this.echoMode }; },
    async applyConstraints(value) { constraintRequests.push(value); this.echoMode = value.echoCancellation.exact; }
  });
  const audioTrack = makeAudioTrack(behavior.initialTrackEnded ? 'ended' : 'live');
  const videoTrack = { kind: 'video', stop() {} };
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      style: {}, checked: false, hidden: false, disabled: false, value: '100',
      textContent: '', srcObject: null,
      getAttribute: () => 'false', setAttribute() {},
      addEventListener() {},
      querySelector: () => ({ style: {} }),
      play: () => Promise.resolve(), pause() {}, removeAttribute() {}, load() {}
    });
    return elements.get(id);
  };
  class MediaStream {
    constructor(tracks) { this.tracks = tracks; }
    getTracks() { return this.tracks; }
    addTrack(track) { this.tracks.push(track); }
    removeTrack(track) { this.tracks = this.tracks.filter(item => item !== track); }
    getAudioTracks() { return this.tracks.filter(track => track.kind === 'audio'); }
    getVideoTracks() { return this.tracks.filter(track => track.kind === 'video'); }
  }
  class MediaRecorder {
    static isTypeSupported() { return true; }
    constructor(stream, options) {
      this.stream = stream;
      this.options = options;
      this.mimeType = options.mimeType;
      this.state = 'inactive';
      this.handlers = new Map();
    }
    addEventListener(type, handler) { this.handlers.set(type, handler); }
    removeEventListener(type) { this.handlers.delete(type); }
    start(chunkMs) {
      this.chunkMs = chunkMs;
      attemptedRecorders.push(this);
      const error = behavior.failStart?.(this, attemptedRecorders);
      if (error) { this.state = 'recording'; throw error; }
      if (this.options.mimeType === 'audio/webm') this.mimeType = 'audio/webm;codecs=opus';
      this.state = 'recording'; startedRecorders.push(this);
      if (!behavior.startEventAfterStop) queueMicrotask(() => this.handlers.get('start')?.());
    }
    stop() {
      this.state = 'inactive';
      if (behavior.startEventAfterStop) this.handlers.get('start')?.();
      this.handlers.get('dataavailable')?.({ data: new Blob([new Uint8Array([1, 2])], { type: this.mimeType }) });
      if (behavior.endInitialTrackOnProbeStop && this.stream.getAudioTracks()[0] === audioTrack) audioTrack.stop();
      if (!behavior.ignoreInitialStop || this.stream.getAudioTracks()[0] !== audioTrack) this.handlers.get('stop')?.();
    }
  }
  class MediaSource {
    static isTypeSupported(mimeType) { return mimeType !== 'audio/webm'; }
  }
  class UnavailableAudioContext {
    constructor() { this.state = 'suspended'; }
    resume() { return Promise.reject(new Error('User gesture required')); }
    close() { return Promise.resolve(); }
  }
  const window = {
    location: { search }, MediaRecorder, MediaSource,
    HTMLCanvasElement: { prototype: { captureStream() {} } },
    RemoteCallConversationRecorder: withUnavailableAudioContext ? class {} : undefined,
    AudioContext: withUnavailableAudioContext ? UnavailableAudioContext : undefined,
    RemoteCallConnection: { stopCall() { stoppedCalls++; } },
    addEventListener() {}
  };
  const document = {
    getElementById: element,
    querySelectorAll: () => [],
    addEventListener() {},
    createElement(tag) {
      assert.equal(tag, 'canvas');
      return {
        getContext: () => ({ fillRect() { captureDraws++; } }),
        captureStream(fps) { captureSettings.push({ width: this.width, height: this.height, fps }); return new MediaStream([videoTrack]); }
      };
    }
  };
  vm.runInNewContext(source, {
    window, document, MediaStream, MediaRecorder, MediaSource,
    navigator: { mediaDevices: { getUserMedia: async constraints => { captureRequests.push(constraints); const track = captureRequests.length === 1 ? audioTrack : makeAudioTrack(); audioInputs.push(track); await behavior.beforeCaptureReturn?.(track, captureRequests.length); return new MediaStream([track]); } } },
    HTMLMediaElement: { HAVE_CURRENT_DATA: 2 },
    URLSearchParams, URL, performance: { now: () => now, timeOrigin: 1 },
    Blob, Uint8Array,
    setInterval: () => 1, clearInterval() {},
    setTimeout: (fn, delay) => { const id = ++timerId; timers.set(id, { fn, at: now + delay, delay }); return id; },
    clearTimeout: id => timers.delete(id),
    console: { warn() {}, error() {} }
  });
  return { media: window.RemoteCallMedia, captureDraws: () => captureDraws, audioInputs, startedRecorders, attemptedRecorders, captureRequests, stoppedInputs, constraintRequests, published, captureSettings,
    publish: chunk => published.push(chunk),
    async advance(ms) {
      const target = now + ms;
      for (;;) {
        const event = [...timers].sort((a, b) => a[1].at - b[1].at).find(([, timer]) => timer.at <= target);
        if (!event) break;
        now = event[1].at;
        timers.delete(event[0]);
        event[1].fn();
        for (let i = 0; i < 10; i++) await Promise.resolve();
      }
      now = target;
      await new Promise(resolve => setImmediate(resolve));
    },
    get timerDelays() { return [...timers.values()].map(timer => timer.delay); },
    now: () => now,
    async prepare() {
      let settled = false;
      let outcome;
      let failure;
      const preparation = this.media.prepare().then(value => { outcome = value; settled = true; }, error => { failure = error; settled = true; });
      for (let turn = 0; !settled && turn < 100; turn++) {
        for (let i = 0; i < 20; i++) await Promise.resolve();
        if (settled) break;
        const next = [...timers.values()].sort((a, b) => a.at - b.at)[0];
        if (next) await this.advance(Math.max(0, next.at - now));
        else await new Promise(resolve => setImmediate(resolve));
      }
      assert.ok(settled, 'media preparation must settle with a bounded number of timers');
      await preparation;
      if (failure) throw failure;
      return outcome;
    },
    stoppedCalls: () => stoppedCalls };
}

test('call starts when the optional conversation recorder script is absent', async () => {
  const h = callHarness(false);
  await h.prepare();
  await h.media.start(() => {});
  assert.equal(h.startedRecorders.filter(recorder => recorder.state === 'recording').length, 3);
  assert.equal(h.stoppedCalls(), 0);
});

test('call starts when optional Web Audio cannot resume', async () => {
  const h = callHarness(true);
  await h.prepare();
  await h.media.start(() => {});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.startedRecorders.filter(recorder => recorder.state === 'recording').length, 3);
  assert.equal(h.stoppedCalls(), 0);
});


test('recorders default to half-second chunks and respect valid overrides', async () => {
  for (const [search, expected] of [['', 500], ['?chunkSeconds=invalid', 500], ['?chunkSeconds=0.05', 500], ['?chunkSeconds=0.25', 250]]) {
    const h = callHarness(false, search);
    await h.prepare();
    await h.media.start(() => {});
    assert.deepEqual(h.startedRecorders.slice(-3).map(recorder => recorder.chunkMs), [expected, expected, expected]);
    assert.deepEqual(h.timerDelays.map(Math.round), [33, expected, expected]);
    await h.media.stop();
  }
});


test('frame orders use capture starts relative to the agreed origin and survive SQ drops', async () => {
  const h = callHarness(false);
  await h.prepare();
  const actualStart = h.now();
  await h.media.start(() => {}, actualStart - 20); // Sender deliberately discards every SQ frame.
  await h.advance(1600);
  await h.media.stop();
  const own = h.media.getHistories().own.audio;
  assert.deepEqual(Array.from(own, frame => frame.order), [20, 520, 1020, 1520]);
  assert.deepEqual(Array.from(own, frame => frame.startTime), [20, 520, 1020, 1520]);
  assert.equal(own[0].endTime, 520);
  assert.equal(own[0].actualRecordingStartTimeMs, actualStart);
  assert.equal(h.media.getRecordingStartTimes().audio, actualStart);
  assert.ok(own.every(frame => frame.independent && frame.binary.byteLength === 2));
});

test('audio bitrate reductions create new encoders and keep all own history and timestamps', async () => {
  const h = callHarness(false);
  await h.prepare();
  await h.media.start(h.publish, h.now() - 20);
  await h.advance(700);
  const first = await h.media.reduceTransportQuality('audio', 1);
  await h.advance(700);
  const second = await h.media.reduceTransportQuality('audio', 2);
  assert.equal(first.bitrate, 42880);
  assert.equal(second.bitrate, 28730);
  assert.equal(first.generation, 1);
  assert.equal(second.generation, 2);
  const encoded = h.startedRecorders.filter(recorder => recorder.stream.getTracks().length === 1 && recorder.stream.getAudioTracks().length);
  assert.equal(encoded.find(recorder => recorder.options.audioBitsPerSecond === 42880).options.audioBitsPerSecond, 42880);
  assert.equal(encoded.at(-1).options.audioBitsPerSecond, 28730);
  await h.advance(500);
  await h.media.stop();
  const frames = h.media.getHistories().own.audio;
  assert.ok(frames.length >= 5);
  assert.ok(frames.some(frame => frame.generation === 0));
  assert.ok(frames.some(frame => frame.generation === 1));
  assert.ok(frames.some(frame => frame.generation === 2));
  assert.ok(frames.every((frame, index) => index === 0 || frame.order > frames[index - 1].order));
});

test('video encoders switch to medium then low and disabling video leaves audio recording', async () => {
  const h = callHarness(false);
  await h.prepare();
  await h.media.start(h.publish);
  await h.advance(600);
  const medium = await h.media.reduceTransportQuality('video', 1);
  await h.advance(600);
  const low = await h.media.reduceTransportQuality('video', 2);
  assert.equal(medium.bitrate, 700000);
  assert.equal(medium.quality, 'medium');
  assert.equal(low.bitrate, 350000);
  assert.equal(low.quality, 'low');
  assert.deepEqual(h.captureSettings, [{ width: 1280, height: 720, fps: 30 }, { width: 854, height: 480, fps: 20 }, { width: 640, height: 360, fps: 15 }]);
  await h.media.disableOutgoingVideo();
  const videoCount = h.media.getHistories().own.video.length;
  await h.advance(1000);
  assert.equal(h.media.getHistories().own.video.length, videoCount);
  assert.ok(h.startedRecorders.filter(recorder => recorder.stream.getTracks().length === 1 && recorder.stream.getAudioTracks().length).at(-1).state === 'recording');
  await h.media.stop();
});

function unsupportedAudio() {
  return Object.assign(new Error('There was an error starting the MediaRecorder.'), { name: 'NotSupportedError' });
}

test('audio preparation tests the real encoder and falls back when an advertised Opus configuration cannot start', async () => {
  const h = callHarness(false, '', { failStart: recorder => recorder.mimeType === 'audio/webm;codecs=opus' ? unsupportedAudio() : null });
  const types = await h.prepare();
  assert.equal(types.audio, 'audio/webm;codecs=opus');
  assert.deepEqual(h.attemptedRecorders.map(recorder => recorder.options.mimeType), ['audio/webm;codecs=opus', 'audio/webm']);
  assert.ok(h.attemptedRecorders.every(recorder => recorder.state === 'inactive'), 'all startup probes must release their encoders');
  assert.equal(h.captureRequests.length, 1);
  await h.media.start(h.publish, h.now() - 20);
  assert.equal(h.startedRecorders.find(recorder => recorder.state === 'recording' && recorder.stream.getTracks().length === 1 && recorder.stream.getAudioTracks().length).options.mimeType, 'audio/webm');
  await h.advance(600);
  const restart = await h.media.reduceTransportQuality('audio', 1);
  assert.equal(restart.mimeType, types.audio);
  assert.equal(restart.bitrate, 42880);
  assert.equal(h.startedRecorders.filter(recorder => recorder.stream.getTracks().length === 1 && recorder.stream.getAudioTracks().length).at(-1).options.mimeType, 'audio/webm');
  await h.advance(600);
  await h.media.stop();
  assert.equal(h.media.getHistories().own.audio[0].mimeType, types.audio);
  assert.equal(h.media.getHistories().own.audio[0].order, 20);
  assert.equal(h.stoppedCalls(), 0);
});

test('audio preparation reopens an ended microphone before the synchronized start can be proposed', async () => {
  const h = callHarness(false, '', { initialTrackEnded: true });
  const types = await h.prepare();
  assert.equal(types.audio, 'audio/webm;codecs=opus');
  assert.equal(h.captureRequests.length, 2);
  assert.equal(h.captureRequests[1].video, false);
  assert.equal(h.captureRequests[1].audio.channelCount.ideal, 1);
  assert.equal(h.captureRequests[1].audio.sampleRate.ideal, 48000);
  await h.media.start(h.publish);
  assert.equal(h.startedRecorders.filter(recorder => recorder.state === 'recording').length, 3);
  await h.media.stop();
});

test('audio preparation bounds retries and releases capture when every encoder configuration fails', async () => {
  const h = callHarness(false, '', { failStart: () => unsupportedAudio() });
  await assert.rejects(h.prepare(), /Microphone audio recording could not start/);
  assert.equal(h.captureRequests.length, 2);
  assert.equal(h.attemptedRecorders.length, 4);
  assert.ok(h.attemptedRecorders.every(recorder => recorder.state === 'inactive'));
  assert.equal(h.stoppedInputs.length, 2);
  assert.deepEqual(h.captureSettings, []);
  assert.equal(h.media.getHistories().own.audio.length, 0);
  assert.equal(h.media.getRecordingStartTimes().audio, null);
});

test('audio preparation does not retry a security or permission failure as a format fallback', async () => {
  const denied = Object.assign(new Error('Audio capture is not allowed'), { name: 'SecurityError' });
  const h = callHarness(false, '', { failStart: () => denied });
  await assert.rejects(h.prepare(), /Audio capture is not allowed/);
  assert.equal(h.captureRequests.length, 1);
  assert.equal(h.attemptedRecorders.length, 1);
});

test('a recorder rejected at the agreed start leaves no false history or recording-start timestamp', async () => {
  let attempts = 0;
  const h = callHarness(false, '', { failStart: recorder => recorder.stream.getTracks().length === 1 && recorder.stream.getAudioTracks().length && ++attempts > 1 ? unsupportedAudio() : null });
  await h.prepare();
  await assert.rejects(h.media.start(h.publish), /audio recorder could not start/);
  assert.equal(h.media.getHistories().own.audio.length, 0);
  assert.equal(h.media.getRecordingStartTimes().audio, null);
  assert.equal(h.published.length, 0);
  assert.ok(h.attemptedRecorders.every(recorder => recorder.state === 'inactive'));
});

test('a later audio recorder restart failure reports a call error without an uncaught timer exception', async () => {
  let attempts = 0;
  const h = callHarness(false, '', { failStart: recorder => recorder.stream.getTracks().length === 1 && recorder.stream.getAudioTracks().length && ++attempts > 2 ? unsupportedAudio() : null });
  await h.prepare();
  await h.media.start(h.publish);
  await h.advance(600);
  assert.equal(h.stoppedCalls(), 1);
  assert.equal(h.media.getHistories().own.audio.length, 1);
  await h.media.stop();
});

test('audio preparation completes when the start event is delayed until the recorder is stopped', async () => {
  const h = callHarness(false, '', { startEventAfterStop: true });
  const types = await h.prepare();
  assert.equal(types.audio, 'audio/webm;codecs=opus');
  assert.equal(h.captureRequests.length, 1);
  assert.equal(h.now(), 600);
  assert.deepEqual(h.timerDelays.map(Math.round), [33, 100]);
  await h.media.start(h.publish);
  await h.advance(600);
  assert.equal(h.media.getHistories().own.audio.length, 1);
  await h.media.stop();
});

test('a missing recorder stop event retries the microphone and can recover on a fresh input', async () => {
  const h = callHarness(false, '', { ignoreInitialStop: true });
  const types = await h.prepare();
  assert.equal(types.audio, 'audio/webm;codecs=opus');
  assert.equal(h.captureRequests.length, 2);
  assert.ok(h.now() < 10000);
  assert.deepEqual(h.timerDelays.map(Math.round), [33, 100]);
  await h.media.start(h.publish);
  await h.media.stop();
});

test('a failed full-system echo capture retries with standard browser echo cancellation', async () => {
  const h = callHarness(false, '', {
    systemEchoMode: true,
    failStart: recorder => recorder.stream.getAudioTracks()[0]?.echoMode === 'all' ? unsupportedAudio() : null
  });
  const types = await h.prepare();
  assert.equal(types.audio, 'audio/webm;codecs=opus');
  assert.equal(h.captureRequests.length, 2);
  assert.deepEqual(h.constraintRequests.map(value => value.echoCancellation.exact), ['all']);
  await h.media.start(h.publish);
  await h.media.stop();
});

test('a working full-system echo capture keeps its preferred mode without reopening the microphone', async () => {
  const h = callHarness(false, '', { systemEchoMode: true });
  await h.prepare();
  assert.equal(h.captureRequests.length, 1);
  assert.deepEqual(h.constraintRequests.map(value => value.echoCancellation.exact), ['all']);
  await h.media.start(h.publish);
  await h.media.stop();
});


test('preparation reopens a microphone that ends as its startup probe stops', async () => {
  const h = callHarness(false, '', { endInitialTrackOnProbeStop: true });
  await h.prepare();
  assert.equal(h.captureRequests.length, 2);
  assert.equal(h.audioInputs[0].readyState, 'ended');
  assert.equal(h.audioInputs[1].readyState, 'live');
  await h.media.start(h.publish);
  assert.ok(h.startedRecorders.some(r => r.state === 'recording' && r.stream.getAudioTracks()[0] === h.audioInputs[1]));
  await h.media.stop();
});

test('a microphone ending between preparation and the agreed start is restored before recording', async () => {
  const h = callHarness(false);
  await h.prepare();
  h.audioInputs[0].stop();
  await h.advance(700);
  await h.media.ensureReady();
  assert.equal(h.captureRequests.length, 2);
  assert.equal(h.audioInputs[1].readyState, 'live');
  assert.equal(h.media.getHistories().own.audio.length, 0, 'recovery probes stay out of OHQ and SQ');
  const start = h.now();
  await h.media.start(h.publish, start);
  assert.equal(h.media.getRecordingStartTimes().audio, start);
  await h.advance(600);
  await h.media.stop();
  assert.equal(h.media.getHistories().own.audio[0].order, 0);
});

test('recording cannot start while microphone recovery is still in progress', async () => {
  const h = callHarness(false);
  await h.prepare();
  h.audioInputs[0].stop();
  await h.advance(100);
  await assert.rejects(h.media.start(h.publish), /still recovering/);
  assert.equal(h.media.getRecordingStartTimes().audio, null);
  await h.advance(600);
  await h.media.ensureReady();
  await h.media.abort();
  assert.deepEqual(h.timerDelays, []);
});

test('repeated microphone loss has a bounded recovery count', async () => {
  const h = callHarness(false);
  await h.prepare();
  for (let attempt = 0; attempt < 2; attempt++) {
    h.audioInputs.at(-1).stop();
    await h.advance(700);
    await h.media.ensureReady();
  }
  h.audioInputs.at(-1).stop();
  await h.advance(100);
  await assert.rejects(h.media.ensureReady(), /repeatedly stopped/);
  assert.equal(h.captureRequests.length, 3);
  await h.media.abort();
  assert.deepEqual(h.timerDelays, []);
});


test('ending the call while a replacement microphone opens releases the late input', async () => {
  let release;
  const h = callHarness(false, '', { beforeCaptureReturn: (_track, count) => count === 2 ? new Promise(resolve => { release = resolve; }) : undefined });
  await h.prepare();
  h.audioInputs[0].stop();
  await h.advance(100);
  assert.equal(h.captureRequests.length, 2);
  await h.media.abort();
  release();
  await h.advance(0);
  assert.ok(h.audioInputs.every(track => track.readyState === 'ended'));
  assert.equal(h.captureRequests.length, 2);
  assert.deepEqual(h.timerDelays, []);
});

test('canceling initial preparation does not open another microphone after the probe settles', async () => {
  const h = callHarness(false);
  const preparation = h.media.prepare();
  void preparation.catch(() => {});
  await h.advance(0);
  await h.media.abort();
  await h.advance(3000);
  await assert.rejects(preparation, /canceled/);
  assert.equal(h.captureRequests.length, 1);
  assert.ok(h.audioInputs.every(track => track.readyState === 'ended'));
});


test('video drawing follows the selected frame rate on the capture clock', async () => {
  const h = callHarness(false);
  await h.prepare();
  await h.media.start(h.publish);
  for (const [level, fps] of [[0, 30], [1, 20], [2, 15]]) {
    if (level) await h.media.reduceTransportQuality('video', level);
    const before = h.captureDraws();
    await h.advance(1000);
    const frames = h.captureDraws() - before;
    assert.ok(frames >= fps - 1 && frames <= fps + 1, `expected ${fps} canvas frames, got ${frames}`);
  }
  await h.media.stop();
  const stopped = h.captureDraws();
  await h.advance(1000);
  assert.equal(h.captureDraws(), stopped);
});
