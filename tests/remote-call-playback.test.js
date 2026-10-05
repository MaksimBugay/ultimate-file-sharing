const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../js/remote-call.js'), 'utf8');
const EPOCH = 1800000000000;

// Deterministic wall clock, independently advancing media elements and asynchronous
// SourceBuffers. Execute the complete application through its public receiver API.
function harness(options = {}) {
  let now = EPOCH;
  let wallClockJumpMs = 0;
  let nextTimer = 0;
  let stoppedCalls = 0;
  let videoReceptionStops = 0;
  const timers = new Map();
  const sources = [];
  const urls = new Map();
  const revoked = [];
  const elements = new Map();
  const schedule = (fn, delay, interval = 0) => {
    const id = ++nextTimer;
    timers.set(id, { fn, at: now + delay, interval });
    return id;
  };
  class Events {
    constructor() { this.handlers = new Map(); }
    addEventListener(type, fn) {
      if (!this.handlers.has(type)) this.handlers.set(type, new Set());
      this.handlers.get(type).add(fn);
    }
    removeEventListener(type, fn) { this.handlers.get(type)?.delete(fn); }
    emit(type, event = {}) { for (const fn of [...(this.handlers.get(type) || [])]) fn(event); }
  }
  const ranges = (start, end) => ({ length: end > start ? 1 : 0, start: () => start, end: () => end });
  class Element extends Events {
    constructor(id) {
      super();
      Object.assign(this, { id, style: {}, dataset: {}, checked: false, hidden: false, disabled: false,
        value: '100', textContent: '', currentTime: 0, paused: true, muted: false, volume: 1,
        seeking: false, pauseCalls: 0, loadCalls: 0, playCalls: 0 });
    }
    set src(url) {
      this.url = url;
      this.source = urls.get(url);
      if (this.source) this.source.element = this;
    }
    get src() { return this.url || ''; }
    get buffered() { return this.source?.buffer?.buffered || ranges(0, 0); }
    get readyState() { return this.buffered.length ? 3 : 0; }
    getAttribute() { return 'false'; }
    setAttribute() {}
    querySelector() { return { style: {} }; }
    removeAttribute(name) { if (name === 'src') { this.url = ''; this.source = null; } }
    load() { this.loadCalls++; this.currentTime = 0; }
    pause() { this.paused = true; this.pauseCalls++; this.emit('pause'); }
    play() {
      this.playCalls++;
      if (options.autoplayBlocked && !this.gestureAllowed) return Promise.reject(new Error('Gesture required'));
      this.paused = false; this.emit('play'); return Promise.resolve();
    }
    advance(ms) {
      if (this.paused || !this.buffered.length) return;
      this.currentTime = Math.min(this.buffered.end(0), this.currentTime + ms / 1000);
      if (this.source.readyState === 'ended' && this.currentTime >= this.buffered.end(0)) this.emit('ended');
    }
  }
  const byId = id => {
    if (!elements.has(id)) elements.set(id, new Element(id));
    return elements.get(id);
  };
  class SourceBuffer extends Events {
    constructor(kind) {
      super(); Object.assign(this, { kind, updating: false, start: 0, end: 0, appends: [], removes: [] });
    }
    get buffered() { return ranges(this.start, this.end); }
    appendBuffer(bytes) {
      assert.equal(this.updating, false, 'a SourceBuffer must serialize its own mutations');
      if (options.appendThrows === this.kind) throw new Error('Corrupt media');
      this.updating = true;
      const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const index = data.getUint32(0);
      const duration = data.getUint32(4) / 1000;
      this.appends.push({ index, at: now });
      if (options.blockAppend === this.kind) return;
      this.timer = schedule(() => {
        this.end += duration; this.updating = false; this.emit('updateend');
      }, options.appendMs?.[this.kind] ?? 5);
    }
    remove(start, end) {
      assert.equal(this.updating, false);
      this.updating = true;
      this.removes.push([start, end]);
      this.timer = schedule(() => { this.start = end; this.updating = false; this.emit('updateend'); }, 2);
    }
    abort() { timers.delete(this.timer); this.updating = false; }
  }
  class MediaSource extends Events {
    static isTypeSupported() { return true; }
    constructor() { super(); this.readyState = 'closed'; sources.push(this); }
    open() { this.readyState = 'open'; this.emit('sourceopen'); }
    addSourceBuffer(type) {
      if (type.includes('unsupported')) throw new Error('Unsupported format');
      this.buffer = new SourceBuffer(type.startsWith('audio') ? 'audio' : 'video');
      return this.buffer;
    }
    removeSourceBuffer(buffer) { assert.equal(buffer, this.buffer); this.removed = true; this.buffer = null; }
    endOfStream() { assert.equal(this.buffer.updating, false); this.readyState = 'ended'; this.endedAt = now; }
  }
  class FakeDate extends Date { static now() { return now + (options.localClockOffsetMs || 0) + wallClockJumpMs; } }
  const window = new Events();
  Object.assign(window, { location: { search: '' }, MediaSource,
    RemoteCallConnection: { stopCall() { stoppedCalls++; }, disableRemoteVideoReception() { videoReceptionStops++; } } });
  vm.runInNewContext(source, {
    window, document: { getElementById: byId, querySelectorAll: () => [], addEventListener() {} },
    MediaSource, Uint8Array, Date: FakeDate, URLSearchParams,
    URL: { createObjectURL(source) { const url = `blob:${urls.size}`; urls.set(url, source); return url; },
      revokeObjectURL(url) { revoked.push(url); } },
    performance: { timeOrigin: EPOCH + (options.localClockOffsetMs || 0) - (options.pageAgeMs || 0),
      now: () => (options.pageAgeMs || 0) + now - EPOCH },
    HTMLMediaElement: { HAVE_CURRENT_DATA: 2, HAVE_FUTURE_DATA: 3 },
    setInterval: (fn, ms) => schedule(fn, ms, ms), clearInterval: id => timers.delete(id),
    setTimeout: (fn, ms) => schedule(fn, ms), clearTimeout: id => timers.delete(id),
    console
  });
  const media = window.RemoteCallMedia;
  media.setPeerMimeTypes({ audio: 'audio/webm;codecs=opus', video: options.videoType || 'video/webm;codecs=vp8' });
  sources[0].open();
  if (!options.videoNeverOpens) sources[1].open();
  const flushPromises = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
  async function advanceTo(target) {
    target += EPOCH;
    while (true) {
      let id = null;
      let event = null;
      for (const [candidate, timer] of timers) {
        if (timer.at <= target && (!event || timer.at < event.at)) { id = candidate; event = timer; }
      }
      const step = event ? event.at : target;
      for (const element of elements.values()) element.advance(step - now);
      now = step;
      if (event) {
        if (!timers.has(id)) continue;
        if (event.interval) event.at += event.interval; else timers.delete(id);
        event.fn();
      }
      await flushPromises();
      if (!event) break;
    }
    await flushPromises();
  }
  function chunk(kind, index, { duration = 500, captureEnd = (index + 1) * duration, createdAt,
    receivedAt = now + (options.localClockOffsetMs || 0),
    decryptedAt = now + (options.localClockOffsetMs || 0) } = {}) {
    const payload = new ArrayBuffer(8);
    const view = new DataView(payload);
    view.setUint32(0, index); view.setUint32(4, duration);
    media.receiveChunk(kind, index, payload, {
      senderStartTimeMs: captureEnd - duration, senderEndTimeMs: captureEnd,
      createdAtEpochMs: createdAt ?? EPOCH + (options.remoteClockOffsetMs || 0) + captureEnd,
      arrivedAtEpochMs: receivedAt, decryptedAtEpochMs: decryptedAt, playStart: null, playEnd: null
    });
  }
  return { media, sources, byId, window, revoked, chunk, advanceTo,
    scheduleAt: (ms, fn) => schedule(fn, EPOCH + ms - now),
    diagnostics: () => media.getPlaybackDiagnostics(),
    stoppedCalls: () => stoppedCalls, videoReceptionStops: () => videoReceptionStops,
    time: () => now - EPOCH,
    jumpWallClock: ms => { wallClockJumpMs += ms; } };
}

function scheduleStream(h, kind, count, deliveryDelay = 30) {
  for (let i = 0; i < count; i++) {
    const captured = (i + 1) * 500;
    h.scheduleAt(captured + (typeof deliveryDelay === 'function' ? deliveryDelay(i) : deliveryDelay),
      () => h.chunk(kind, i));
  }
}

test('normal streams start with their first data and have independent MSE owners', async () => {
  const h = harness();
  scheduleStream(h, 'audio', 20, 30); scheduleStream(h, 'video', 20, 80);
  await h.advanceTo(10000);
  const d = h.diagnostics();
  assert.equal(d.state, 'NORMAL');
  assert.ok(d.audioPlaybackDelayMs < 600); assert.ok(d.videoPlaybackDelayMs < 650);
  assert.equal(h.byId('remotePanel').dataset.playbackState, 'NORMAL');
  assert.equal(h.byId('playbackDelayWarning').hidden, true);
  assert.equal(h.byId('remoteAudio').pauseCalls, 0);
  assert.equal(h.byId('remoteAudio').playCalls, 1);
  assert.equal(h.sources.length, 2);
  assert.notEqual(h.sources[0].buffer, h.sources[1].buffer);
  assert.ok(h.sources[0].buffer.appends[0].at < h.sources[1].buffer.appends[0].at);
});

for (const options of [{ videoNeverOpens: true }, { blockAppend: 'video' }, { appendMs: { video: 1100 } }]) {
  test(`audio remains continuous when video is unavailable/slow: ${JSON.stringify(options)}`, async () => {
    const h = harness(options);
    scheduleStream(h, 'audio', 30); scheduleStream(h, 'video', 30);
    await h.advanceTo(14000);
    assert.ok(h.diagnostics().audioPlaybackDelayMs < 600);
    assert.equal(h.byId('remoteAudio').pauseCalls, 0);
    assert.equal(h.sources[0].buffer.appends.length, 27);
    assert.equal(h.diagnostics().audio.queuedDurationMs, 0);
  });
}

test('a missing/reordered video index only holds video and is restored in stream order', async () => {
  const h = harness();
  scheduleStream(h, 'audio', 20);
  h.scheduleAt(530, () => h.chunk('video', 0));
  h.scheduleAt(1530, () => h.chunk('video', 2));
  h.scheduleAt(4530, () => h.chunk('video', 1));
  await h.advanceTo(4250);
  assert.equal(h.diagnostics().state, 'VIDEO_DELAYED');
  assert.equal(h.diagnostics().video.waitingForIndex, 1);
  assert.ok(h.diagnostics().audioPlaybackDelayMs < 600);
  assert.equal(h.byId('disableRemoteVideo').hidden, false);
  await h.advanceTo(4750);
  assert.deepEqual(h.sources[1].buffer.appends.map(x => x.index), [0, 1, 2]);
});

test('video delivery delayed by one second never pauses or seeks audio', async () => {
  const h = harness();
  scheduleStream(h, 'audio', 30); scheduleStream(h, 'video', 30, 1030);
  await h.advanceTo(14500);
  assert.equal(h.diagnostics().state, 'NORMAL');
  assert.ok(h.diagnostics().audioPlaybackDelayMs < 600);
  assert.ok(h.diagnostics().videoPlaybackDelayMs > 1400);
  assert.equal(h.byId('remoteAudio').pauseCalls, 0);
});

for (const [audio, video, state] of [[30, 3300, 'VIDEO_DELAYED'], [3100, 30, 'AUDIO_DELAYED'], [3600, 4000, 'AUDIO_DELAYED']]) {
  test(`delay warning priority: audio delivery ${audio} ms, video ${video} ms gives ${state}`, async () => {
    const h = harness();
    scheduleStream(h, 'audio', 40, audio); scheduleStream(h, 'video', 40, video);
    await h.advanceTo(18000);
    assert.equal(h.diagnostics().state, state);
    assert.equal(h.byId('remotePanel').dataset.playbackState, state);
    assert.equal(h.byId('playbackDelayWarning').hidden, false);
    assert.equal(h.byId('disableRemoteVideo').hidden, state !== 'VIDEO_DELAYED');
    assert.equal(h.byId('remoteAudio').pauseCalls, 0);
    assert.equal(h.byId('replayVideo').pauseCalls, 0);
  });
}

test('delay maps the playing chunk on the relative call timeline and retains stalled age', async () => {
  const h = harness();
  await h.advanceTo(4000);
  h.chunk('video', 0, { captureEnd: 500, receivedAt: EPOCH + 3990, decryptedAt: EPOCH + 3995 });
  h.chunk('video', 1, { captureEnd: 3800 });
  await h.advanceTo(4250);
  const d = h.diagnostics().video;
  assert.equal(d.currentlyPlaying.index, 0);
  assert.equal(d.lastAppended.index, 1);
  assert.equal(d.currentlyPlaying.creationTime, 500);
  assert.equal(d.currentlyPlaying.receivedAtCallTimeMs, 3990);
  assert.equal(d.currentlyPlaying.decryptedAtCallTimeMs, 3995);
  assert.equal(d.currentlyPlaying.appendedAtCallTimeMs, 4000);
  assert.ok(Math.abs(d.playbackDelayMs - 4005) < 1, `actual ${d.playbackDelayMs}`);
  assert.ok(d.bufferedAheadMs > 700);
  await h.advanceTo(8000);
  assert.ok(h.diagnostics().videoPlaybackDelayMs >= 4199);
});

test('warning hysteresis recovers below 2500 ms and red overrides blue', async () => {
  // Artificial capture offsets exercise the monitor through the actual player
  // without changing the independent media clocks or scheduling.
  const h = harness();
  await h.advanceTo(5000);
  h.chunk('audio', 0, { captureEnd: 5000 });
  h.chunk('video', 0, { captureEnd: 1900 });
  await h.advanceTo(5250);
  assert.equal(h.diagnostics().state, 'VIDEO_DELAYED');
  h.chunk('audio', 1, { captureEnd: 5500 });
  h.chunk('video', 1, { captureEnd: 3200 }); // 2805 ms: still blue
  await h.advanceTo(5750);
  assert.equal(h.diagnostics().state, 'VIDEO_DELAYED');
  h.chunk('audio', 2, { captureEnd: 6000 });
  h.chunk('video', 2, { captureEnd: 4100 }); // 2405 ms: recovered
  await h.advanceTo(6250);
  assert.equal(h.diagnostics().state, 'NORMAL');
  h.chunk('audio', 3, { captureEnd: 3000 });
  h.chunk('video', 3, { captureEnd: 3000 });
  await h.advanceTo(6750);
  assert.equal(h.diagnostics().state, 'AUDIO_DELAYED');
});

test('disable video releases only video and prevents further processing, with no reconnect', async () => {
  const h = harness();
  scheduleStream(h, 'audio', 30); scheduleStream(h, 'video', 30, 3300);
  await h.advanceTo(8000);
  assert.equal(h.diagnostics().state, 'VIDEO_DELAYED');
  const audioUrl = h.byId('remoteAudio').src;
  const before = h.byId('remoteAudio').currentTime;
  h.byId('disableRemoteVideo').emit('click');
  await h.advanceTo(14000);
  assert.equal(h.byId('remoteAudio').src, audioUrl);
  assert.ok(h.byId('remoteAudio').currentTime > before + 5.9);
  assert.equal(h.byId('remoteAudio').pauseCalls, 0);
  assert.equal(h.byId('remoteAudio').loadCalls, 0);
  assert.equal(h.diagnostics().audio.closed, false);
  assert.equal(h.diagnostics().video.closed, true);
  assert.equal(h.diagnostics().video.queueLength, 0);
  assert.equal(h.diagnostics().video.queuedBytes, 0);
  assert.equal(h.diagnostics().state, 'NORMAL');
  assert.equal(h.sources[1].removed, true);
  assert.equal(h.sources[1].buffer, null);
  assert.deepEqual(h.revoked, ['blob:1']);
  assert.equal(h.byId('replayVideo').hidden, true);
  assert.equal(h.byId('remoteVideoPlaceholder').hidden, false);
  assert.equal(h.stoppedCalls(), 0);
  assert.equal(h.videoReceptionStops(), 1);
});

for (const options of [{ appendThrows: 'video' }, { videoType: 'video/unsupported' }]) {
  test(`video errors are isolated: ${JSON.stringify(options)}`, async () => {
    const h = harness(options);
    scheduleStream(h, 'audio', 20); scheduleStream(h, 'video', 20);
    await h.advanceTo(9000);
    assert.equal(h.diagnostics().video.closed, true);
    assert.ok(h.diagnostics().video.failure);
    assert.ok(h.diagnostics().audioPlaybackDelayMs < 600);
    assert.equal(h.byId('remoteAudio').pauseCalls, 0);
    assert.equal(h.stoppedCalls(), 0);
  });
}

test('queue overflow stops the affected stream visibly rather than silently dropping a continuation', async () => {
  const h = harness({ blockAppend: 'video' });
  scheduleStream(h, 'audio', 100); scheduleStream(h, 'video', 100);
  await h.advanceTo(35000);
  assert.match(h.diagnostics().video.failure, /queue limit exceeded/);
  assert.equal(h.diagnostics().video.queueLength, 0);
  assert.match(h.byId('playerCaption').textContent, /video playback stopped/);
  assert.ok(h.diagnostics().audioPlaybackDelayMs < 600);
  assert.equal(h.byId('remoteAudio').pauseCalls, 0);
});

test('video end-of-stream is independent of a missing final audio chunk', async () => {
  const h = harness();
  h.chunk('video', 0); h.chunk('audio', 0);
  h.media.finishRemote({ audio: 2, video: 1 });
  await h.advanceTo(250);
  assert.equal(h.sources[1].readyState, 'ended');
  assert.equal(h.sources[0].readyState, 'open');
  await h.advanceTo(750);
  assert.equal(h.byId('remoteAudio').pauseCalls, 0);
});

test('audio end-of-stream is independent of missing final video, including the 30s timeout', async () => {
  const h = harness();
  h.chunk('audio', 0); h.chunk('audio', 1);
  h.media.finishRemote({ audio: 2, video: 2 });
  await h.advanceTo(250);
  assert.equal(h.sources[0].readyState, 'ended');
  assert.equal(h.sources[1].readyState, 'open');
  await h.advanceTo(31000);
  assert.equal(h.diagnostics().audio.failure, null);
  assert.match(h.diagnostics().video.failure, /not received/);
});

test('autoplay rejection waits for a gesture without coupling the streams', async () => {
  const h = harness({ autoplayBlocked: true });
  scheduleStream(h, 'audio', 10); scheduleStream(h, 'video', 10, 2000);
  await h.advanceTo(1500);
  assert.equal(h.diagnostics().audio.needsGesture, true);
  assert.equal(h.byId('remoteAudio').playCalls, 1);
  h.byId('remoteAudio').gestureAllowed = true;
  h.window.emit('pointerdown');
  await h.advanceTo(2000);
  assert.equal(h.diagnostics().audio.needsGesture, false);
  assert.ok(h.byId('remoteAudio').currentTime > 0);
  assert.equal(h.byId('replayVideo').currentTime, 0);
});

test('five minutes of progressively jittery video delivery never adds delay to audio', async t => {
  const h = harness();
  scheduleStream(h, 'audio', 620, i => 25 + (i % 5) * 5);
  // Video latency grows, arrival order can change, and late continuation chunks
  // must be reordered without dropping. Audio keeps its 500ms production cadence.
  scheduleStream(h, 'video', 620, i => 30 + i * 8 + (i % 7) * 20);
  const samples = [];
  for (const wall of [10000, 60000, 180000, 300000]) {
    await h.advanceTo(wall);
    const d = h.diagnostics();
    samples.push({ wallMs: wall, audioDelayMs: Math.round(d.audioPlaybackDelayMs),
      videoDelayMs: Math.round(d.videoPlaybackDelayMs), audioQueueMs: d.audio.queuedDurationMs,
      videoQueueMs: d.video.queuedDurationMs, audioAheadMs: Math.round(d.audio.bufferedAheadMs),
      videoAheadMs: Math.round(d.video.bufferedAheadMs), state: d.state });
    assert.ok(d.audioPlaybackDelayMs < 600, JSON.stringify(d));
    assert.equal(h.byId('remoteAudio').pauseCalls, 0);
    assert.equal(d.audio.failure, null); assert.equal(d.video.failure, null);
  }
  assert.ok(samples.at(-1).videoDelayMs > 5000);
  assert.equal(samples.at(-1).state, 'VIDEO_DELAYED');
  assert.ok(Math.max(...samples.map(x => x.audioDelayMs)) - Math.min(...samples.map(x => x.audioDelayMs)) < 50);
  assert.ok(h.sources[0].buffer.removes.length > 0, 'historical buffer is trimmed independently');
  t.diagnostic(JSON.stringify(samples));
});


test('delay monitor is a read-only observer with strict warning and recovery thresholds', () => {
  const start = source.indexOf('  class CallDelayMonitor');
  const end = source.indexOf('  class MseReplayPlayer', start);
  const context = vm.createContext({ PLAYBACK_DELAY_WARNING_MS: 3000, PLAYBACK_DELAY_RECOVERY_MS: 2500 });
  vm.runInContext(source.slice(start, end) + ';globalThis.Monitor = CallDelayMonitor;', context);
  const monitor = new context.Monitor();
  let audioDelay = 350;
  let videoDelay = 480;
  // Frozen observers have no scheduling API. Reading delay cannot mutate playback.
  const audio = Object.freeze({ getPlaybackDelayMs: () => audioDelay });
  const video = Object.freeze({ getPlaybackDelayMs: () => videoDelay });
  assert.equal(monitor.evaluate(audio, video).state, 'NORMAL');
  videoDelay = 3000; assert.equal(monitor.evaluate(audio, video).state, 'NORMAL');
  videoDelay = 3001; assert.equal(monitor.evaluate(audio, video).state, 'VIDEO_DELAYED');
  videoDelay = 2999; assert.equal(monitor.evaluate(audio, video).state, 'VIDEO_DELAYED');
  videoDelay = 2500; assert.equal(monitor.evaluate(audio, video).state, 'VIDEO_DELAYED');
  videoDelay = 2499; assert.equal(monitor.evaluate(audio, video).state, 'NORMAL');
  audioDelay = 3100; videoDelay = 4500;
  assert.equal(monitor.evaluate(audio, video).state, 'AUDIO_DELAYED');
  audioDelay = 2500; assert.equal(monitor.evaluate(audio, video).state, 'AUDIO_DELAYED');
  audioDelay = 2499; assert.equal(monitor.evaluate(audio, video).state, 'VIDEO_DELAYED');
  assert.equal(monitor.evaluate(audio, null).state, 'NORMAL');
});

test('missing audio does not stall video ordering, appends or playback', async () => {
  const h = harness();
  scheduleStream(h, 'video', 40);
  h.scheduleAt(530, () => h.chunk('audio', 0));
  h.scheduleAt(1530, () => h.chunk('audio', 2));
  await h.advanceTo(18000);
  const d = h.diagnostics();
  assert.equal(d.state, 'AUDIO_DELAYED');
  assert.equal(d.audio.waitingForIndex, 1);
  assert.ok(d.videoPlaybackDelayMs < 600);
  assert.equal(h.byId('replayVideo').pauseCalls, 0);
});


test('caller and callee measure the same delay despite different device clocks and page ages', async () => {
  const caller = harness({ localClockOffsetMs: 5000, remoteClockOffsetMs: 0, pageAgeMs: 60000 });
  const callee = harness({ localClockOffsetMs: 0, remoteClockOffsetMs: 5000, pageAgeMs: 20000 });
  for (const h of [caller, callee]) {
    scheduleStream(h, 'audio', 30, 1000);
    scheduleStream(h, 'video', 30, 1000);
    await h.advanceTo(10000);
    const d = h.diagnostics();
    assert.equal(d.state, 'NORMAL');
    assert.ok(d.audioPlaybackDelayMs > 1000 && d.audioPlaybackDelayMs < 2000);
    assert.equal(h.byId('playbackDelayWarning').hidden, true);
    const timing = h.media.getReceivedChunkTiming('audio', 0);
    assert.equal(timing.createdAtCallTimeMs, 500);
    assert.equal(timing.arrivedAtCallTimeMs, 1500);
    assert.equal(timing.estimatedDeliveryDelayMs, 1000);
    assert.equal(d.audio.currentlyPlaying.queuedAtCallTimeMs,
      d.audio.currentlyPlaying.receivedAtCallTimeMs);
  }
  assert.equal(caller.diagnostics().audioPlaybackDelayMs, callee.diagnostics().audioPlaybackDelayMs);
});

test('changing a device wall clock during a call does not change playback delay', async () => {
  const h = harness();
  scheduleStream(h, 'audio', 40, 30); scheduleStream(h, 'video', 40, 30);
  await h.advanceTo(8000);
  const before = h.diagnostics().audioPlaybackDelayMs;
  h.jumpWallClock(60000);
  await h.advanceTo(8500);
  assert.ok(Math.abs(h.diagnostics().audioPlaybackDelayMs - before) < 2);
  assert.equal(h.diagnostics().state, 'NORMAL');
  h.jumpWallClock(-120000);
  await h.advanceTo(9000);
  assert.ok(Math.abs(h.diagnostics().audioPlaybackDelayMs - before) < 2);
  assert.equal(h.diagnostics().state, 'NORMAL');
});

for (const remoteClockOffsetMs of [-86400000, 86400000]) {
  test(`real delayed audio still warns with sender clock offset ${remoteClockOffsetMs} ms`, async () => {
    const h = harness({ remoteClockOffsetMs });
    scheduleStream(h, 'audio', 40, 3100); scheduleStream(h, 'video', 40, 30);
    await h.advanceTo(18000);
    const d = h.diagnostics();
    assert.equal(d.state, 'AUDIO_DELAYED');
    assert.ok(d.audioPlaybackDelayMs > 3000);
    assert.ok(d.videoPlaybackDelayMs < 1000);
    assert.equal(h.byId('remoteAudio').pauseCalls, 0);
    assert.equal(h.byId('replayVideo').pauseCalls, 0);
    assert.equal(h.byId('playbackDelayMessage').textContent,
      `Audio is delayed by network conditions. Audio delay: ${Math.round(d.audioPlaybackDelayMs)} ms.`);
  });
}
