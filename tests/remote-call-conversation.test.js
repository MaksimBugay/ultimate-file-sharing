const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../js/remote-call-conversation.js'), 'utf8');

function harness() {
  const connections = [];
  const stoppedTracks = [];
  const drawn = [];
  const localMicrophone = { id: 'local microphone' };
  const remoteVideo = { readyState: 2, videoWidth: 640, videoHeight: 480 };
  const canvasTrack = { id: 'canvas remote video', stop() { stoppedTracks.push(this.id); } };
  const mixedTrack = { id: 'mixed audio', stop() { stoppedTracks.push(this.id); } };
  let mediaRecorder;
  const node = id => ({
    id,
    connect(destination) { connections.push([id, destination.id]); },
    disconnect(destination) { connections.push([id, `disconnect:${destination?.id || 'all'}`]); }
  });
  const playbackSource = node('remote audio');
  const audioContext = {
    createMediaStreamDestination() { return { id: 'mix', stream: new MediaStream([mixedTrack]) }; },
    createMediaStreamSource(stream) {
      assert.equal(stream.getAudioTracks()[0], localMicrophone);
      return node('local microphone');
    },
    createGain() { return { ...node('gain'), gain: { value: 1 } }; }
  };
  class MediaStream {
    constructor(tracks) { this.tracks = tracks; }
    getTracks() { return this.tracks; }
    getVideoTracks() { return this.tracks.filter(track => track.id.includes('video')); }
    getAudioTracks() { return this.tracks.filter(track => track.id.includes('audio') || track === localMicrophone); }
  }
  class MediaRecorder {
    constructor(stream, options) {
      this.stream = stream;
      this.mimeType = options.mimeType;
      this.handlers = new Map();
      this.state = 'inactive';
      mediaRecorder = this;
    }
    addEventListener(type, handler) { this.handlers.set(type, handler); }
    start(chunkMs) { this.chunkMs = chunkMs; this.state = 'recording'; }
    emit(type, event = {}) { this.handlers.get(type)?.(event); }
    stop() { this.state = 'inactive'; this.emit('stop'); }
  }
  const document = {
    createElement(tag) {
      assert.equal(tag, 'canvas');
      return {
        width: 0, height: 0,
        getContext() {
          return {
            fillRect() {},
            drawImage(video) { drawn.push(video); }
          };
        },
        captureStream() { return new MediaStream([canvasTrack]); }
      };
    }
  };
  const window = {};
  vm.runInNewContext(source, {
    window, document, MediaStream, MediaRecorder,
    HTMLMediaElement: { HAVE_CURRENT_DATA: 2 },
    setInterval: () => 1, clearInterval() {}
  });
  return { Recorder: window.RemoteCallConversationRecorder, MediaRecorder, audioContext,
    localMicrophone, remoteVideo, playbackSource, connections, stoppedTracks, drawn,
    get mediaRecorder() { return mediaRecorder; } };
}

test('conversation recording stores remote video with mixed remote and local audio', async () => {
  const h = harness();
  let updates = 0;
  const recording = new h.Recorder({
    video: h.remoteVideo,
    microphoneTrack: h.localMicrophone,
    audioContext: h.audioContext,
    playbackSource: h.playbackSource,
    mimeType: 'video/webm;codecs=vp8,opus',
    chunkMs: 1000,
    onUpdate: () => { updates++; },
    onLimit: () => false,
    onError: error => assert.fail(error.message)
  }).start();
  const mediaRecorder = h.mediaRecorder;
  assert.equal(mediaRecorder.stream.getVideoTracks()[0].id, 'canvas remote video');
  assert.equal(mediaRecorder.stream.getAudioTracks()[0].id, 'mixed audio');
  assert.equal(mediaRecorder.chunkMs, 1000);
  assert.deepEqual(h.drawn, [h.remoteVideo]);
  assert.ok(h.connections.some(([source, destination]) => source === 'remote audio' && destination === 'gain'));
  assert.ok(h.connections.some(([source, destination]) => source === 'local microphone' && destination === 'gain'));

  const chunk = { size: 7 };
  mediaRecorder.emit('dataavailable', { data: chunk });
  assert.equal(recording.chunks.length, 1);
  assert.equal(recording.chunks[0], chunk);
  assert.equal(recording.storedBytes, 7);
  await recording.stop();
  assert.equal(recording.finished, true);
  assert.ok(updates >= 2);
  assert.deepEqual(h.stoppedTracks.sort(), ['canvas remote video', 'mixed audio']);
});

test('failed conversation encoder releases its video and audio tracks', () => {
  const h = harness();
  h.MediaRecorder.prototype.start = () => { throw new Error('Encoder unavailable'); };
  const recording = new h.Recorder({
    video: h.remoteVideo, microphoneTrack: h.localMicrophone,
    audioContext: h.audioContext, playbackSource: h.playbackSource,
    mimeType: 'video/webm;codecs=vp8,opus', chunkMs: 1000,
    onUpdate() {}, onLimit: () => false, onError: error => assert.fail(error.message)
  });
  assert.throws(() => recording.start(), /Encoder unavailable/);
  assert.deepEqual(h.stoppedTracks.sort(), ['canvas remote video', 'mixed audio']);
});

test('failed audio setup does not disconnect live remote playback', () => {
  const h = harness();
  h.audioContext.createMediaStreamDestination = () => { throw new Error('Audio mix unavailable'); };
  const recording = new h.Recorder({
    video: h.remoteVideo, microphoneTrack: h.localMicrophone,
    audioContext: h.audioContext, playbackSource: h.playbackSource,
    mimeType: 'video/webm;codecs=vp8,opus', chunkMs: 1000,
    onUpdate() {}, onLimit: () => false, onError: error => assert.fail(error.message)
  });
  assert.throws(() => recording.start(), /Audio mix unavailable/);
  assert.ok(!h.connections.some(([source, destination]) => source === 'remote audio' && destination.startsWith('disconnect:')));
  assert.deepEqual(h.stoppedTracks, ['canvas remote video']);
});
