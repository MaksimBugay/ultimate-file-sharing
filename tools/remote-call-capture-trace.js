// Paste into the top-level browser console before joining a remote call.
// Inspect RemoteCallCaptureTrace.records; call restore() to remove the hooks.
(() => {
  'use strict';
  if (window.top !== window || !navigator.mediaDevices || window.RemoteCallCaptureTrace) return;
  const records = [];
  const cleanup = [];
  const identifiers = new WeakMap();
  let nextId = 0;
  const origin = performance.now();
  const record = (type, fields = {}) => {
    records.push({ timeMs: Math.round(performance.now() - origin), type, ...fields });
    if (records.length > 1000) records.shift();
  };
  const describe = track => {
    if (!identifiers.has(track)) identifiers.set(track, ++nextId);
    let settings = {};
    try { settings = track.getSettings(); } catch { /* Track may have ended. */ }
    return { track: identifiers.get(track), state: track.readyState, enabled: track.enabled,
      muted: track.muted, sampleRate: settings.sampleRate, channelCount: settings.channelCount,
      echoCancellation: settings.echoCancellation };
  };
  const watch = (target, type, listener) => {
    target.addEventListener(type, listener);
    cleanup.push(() => target.removeEventListener(type, listener));
  };
  const hook = (object, key, replacement) => {
    const original = object[key];
    object[key] = replacement(original);
    const installed = object[key];
    cleanup.push(() => { if (object[key] === installed) object[key] = original; });
  };
  hook(navigator.mediaDevices, 'getUserMedia', original => function (...args) {
    record('getUserMedia:request');
    const result = original.apply(this, args);
    void result.then(stream => {
      for (const track of stream.getAudioTracks()) {
        record('microphone:acquired', describe(track));
        for (const event of ['ended', 'mute', 'unmute']) watch(track, event, () => record(`microphone:${event}`, describe(track)));
      }
    }, error => record('getUserMedia:error', { name: error.name, message: error.message }));
    return result;
  });
  hook(MediaStreamTrack.prototype, 'stop', original => function (...args) {
    if (this.kind === 'audio') record('microphone:stop-called', { ...describe(this), stack: new Error().stack });
    return original.apply(this, args);
  });
  hook(MediaStreamTrack.prototype, 'applyConstraints', original => function (...args) {
    if (this.kind !== 'audio') return original.apply(this, args);
    record('microphone:constraints', { ...describe(this), echoCancellation: args[0]?.echoCancellation });
    const result = original.apply(this, args);
    void result.then(() => record('microphone:constraints-applied', describe(this)),
      error => record('microphone:constraints-error', { ...describe(this), name: error.name, message: error.message }));
    return result;
  });
  for (const operation of ['start', 'stop']) hook(MediaRecorder.prototype, operation, original => function (...args) {
    const audio = this.stream.getAudioTracks();
    if (!audio.length) return original.apply(this, args);
    record(`recorder:${operation}`, { mime: this.mimeType, state: this.state, tracks: audio.map(describe) });
    try { return original.apply(this, args); }
    catch (error) {
      record(`recorder:${operation}-error`, { name: error.name, message: error.message, tracks: audio.map(describe), stack: error.stack });
      throw error;
    }
  });
  watch(document, 'visibilitychange', () => record('visibility', { value: document.visibilityState }));
  watch(window, 'pagehide', () => record('pagehide'));
  window.RemoteCallCaptureTrace = {
    records,
    snapshot: () => ({ userAgent: navigator.userAgent, records: [...records] }),
    restore: () => { for (const restore of cleanup.reverse()) restore(); delete window.RemoteCallCaptureTrace; }
  };
  record('installed', { userAgent: navigator.userAgent, visibility: document.visibilityState });
})();
