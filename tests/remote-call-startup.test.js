const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../js/remote-call.js'), 'utf8');

function callHarness(withUnavailableAudioContext) {
  const elements = new Map();
  const startedRecorders = [];
  let stoppedCalls = 0;
  const audioTrack = { kind: 'audio', enabled: true, stop() {}, getSettings: () => ({ echoCancellation: true }) };
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
    getAudioTracks() { return this.tracks.filter(track => track.kind === 'audio'); }
    getVideoTracks() { return this.tracks.filter(track => track.kind === 'video'); }
  }
  class MediaRecorder {
    static isTypeSupported() { return true; }
    constructor(stream, options) {
      this.stream = stream;
      this.mimeType = options.mimeType;
      this.state = 'inactive';
      this.handlers = new Map();
    }
    addEventListener(type, handler) { this.handlers.set(type, handler); }
    start() { this.state = 'recording'; startedRecorders.push(this); }
    stop() { this.state = 'inactive'; this.handlers.get('stop')?.(); }
  }
  class MediaSource {
    static isTypeSupported() { return true; }
  }
  class UnavailableAudioContext {
    constructor() { this.state = 'suspended'; }
    resume() { return Promise.reject(new Error('User gesture required')); }
    close() { return Promise.resolve(); }
  }
  const window = {
    location: { search: '' }, MediaRecorder, MediaSource,
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
        getContext: () => ({ fillRect() {} }),
        captureStream: () => new MediaStream([videoTrack])
      };
    }
  };
  vm.runInNewContext(source, {
    window, document, MediaStream, MediaRecorder, MediaSource,
    navigator: { mediaDevices: { getUserMedia: async () => new MediaStream([audioTrack]) } },
    HTMLMediaElement: { HAVE_CURRENT_DATA: 2 },
    URLSearchParams, URL, performance: { now: () => 100, timeOrigin: 0 },
    setInterval: () => 1, clearInterval() {}, setTimeout, clearTimeout,
    console: { warn() {}, error() {} }
  });
  return { media: window.RemoteCallMedia, startedRecorders, stoppedCalls: () => stoppedCalls };
}

test('call starts when the optional conversation recorder script is absent', async () => {
  const h = callHarness(false);
  await h.media.prepare();
  await h.media.start(() => {});
  assert.equal(h.startedRecorders.length, 3);
  assert.equal(h.stoppedCalls(), 0);
});

test('call starts when optional Web Audio cannot resume', async () => {
  const h = callHarness(true);
  await h.media.prepare();
  await h.media.start(() => {});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.startedRecorders.length, 3);
  assert.equal(h.stoppedCalls(), 0);
});
