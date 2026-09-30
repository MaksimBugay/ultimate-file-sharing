(() => {
  'use strict';

  const chunkSecondsParam = new URLSearchParams(window.location.search).get('chunkSeconds');
  const requestedChunkSeconds = chunkSecondsParam === null ? NaN : Number(chunkSecondsParam);
  const CHUNK_MS = Number.isFinite(requestedChunkSeconds)
    && requestedChunkSeconds >= 0.1 && requestedChunkSeconds <= 60
    ? Math.round(requestedChunkSeconds * 1000) : 1000;
  const WINDOW_MS = CHUNK_MS;
  const INITIAL_COMMON_BUFFER_SECONDS = 0.5;
  const MAX_RECORDING_BYTES = 512 * 1048576;
  // Opus needs decoded packets ahead of a snippet before its output settles.
  const ECHO_REFERENCE_PREROLL_MS = 120;
  const WEBM_MASTER_IDS = new Set([
    0x18538067, 0x1549a966, 0x1654ae6b, 0xae, 0xe1, 0x1f43b675, 0xa0
  ]); // Segment, Info, Tracks, TrackEntry, Audio, Cluster, BlockGroup.
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  const ui = {
    camera: document.getElementById('liveVideo'),
    video: document.getElementById('replayVideo'),
    cameraCaption: document.getElementById('cameraCaption'),
    echoCancellationStatus: document.getElementById('echoCancellationStatus'),
    extraEchoCancellation: document.getElementById('extraEchoCancellation'),
    cameraEnabled: document.getElementById('cameraEnabled'),
    muteMic: document.getElementById('muteMicButton'),
    caption: document.getElementById('playerCaption'),
    stop: document.getElementById('stopButton'),
    replay: document.getElementById('replayButton'),
    controls: document.getElementById('replayControls'),
    pause: document.getElementById('pauseReplayButton'),
    mute: document.getElementById('muteReplayButton'),
    volume: document.getElementById('replayVolume'),
    save: document.getElementById('saveButton'),
    statusCard: document.getElementById('callStatus'),
    status: document.getElementById('status'),
    elapsed: document.getElementById('elapsed'),
    chunkInterval: document.getElementById('chunkInterval'),
    count: document.getElementById('chunkCount'),
    size: document.getElementById('storedSize'),
    diagnostics: document.getElementById('diagnostics')
  };

  document.querySelectorAll('[data-chunk-seconds]').forEach(element => {
    element.textContent = String(CHUNK_MS / 1000);
  });
  ui.chunkInterval.textContent = `${CHUNK_MS / 1000} s`;

  let mediaStream = null;
  let echoContext = null;
  let echoPlayerSource = null;
  let echoNode = null;
  let echoClockTimer = null;
  let echoReference = null;
  let echoGeneration = 0;
  let micMuted = false;
  let startedAt = 0;
  let elapsedTimer = null;
  let recording = false;
  let finished = false;
  let callEnded = false;
  let busy = false;
  let stoppingPromise = null;
  let recordingSaved = false;
  let memoryLimitReached = false;
  let baseName = '';
  let player = null;
  let recorderSession = null;
  let conversationRecorder = null;
  let conversationStoppingPromise = null;
  let localReplayUrl = null;
  let localReplayActive = false;
  let remoteLink = null;
  let remoteReceived = { audio: new Set(), video: new Set() };
  let remoteChunkTimings = { audio: new Map(), video: new Map() };
  let remoteFinalCounts = null;
  let remoteFinishTimer = null;
  let remotePlaybackFinished = false;
  let preparedMimeTypes = null;
  let cameraTrack = null;
  let cameraActive = false;
  let cameraBusy = false;
  let cameraInput = null;
  let canvas = null;
  let canvasContext = null;
  let canvasStream = null;
  let drawTimer = null;
  function setStatus(message, error = false) {
    ui.status.textContent = message;
    ui.status.style.color = error ? '#ffb2b2' : '';
  }

  function relativeMs() {
    return Math.max(0, Math.round(performance.now() - startedAt));
  }

  function updateElapsed() {
    if (!startedAt) return;
    const seconds = Math.floor(relativeMs() / 1000);
    ui.elapsed.textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  }

  function updateStats() {
    const chunks = recorderSession?.chunks;
    ui.count.textContent = `${chunks?.audio.length || 0} / ${chunks?.video.length || 0}`;
    const storedBytes = (recorderSession?.storedBytes || 0) + (conversationRecorder?.storedBytes || 0);
    ui.size.textContent = `${(storedBytes / 1048576).toFixed(1)} MB`;
    ui.cameraEnabled.disabled = busy || cameraBusy || !!stoppingPromise || (!!preparedMimeTypes && !recording);
    ui.extraEchoCancellation.disabled = new URLSearchParams(window.location.search).has('source-host')
      || busy || !!stoppingPromise || !!preparedMimeTypes || recording;
    ui.muteMic.disabled = !recording || busy || !!stoppingPromise;
    ui.replay.disabled = busy || recording || !finished || !callEnded || !remotePlaybackFinished
      || !conversationRecorder?.finished || !conversationRecorder.chunks.length;
    ui.save.disabled = busy || !finished || !callEnded || recordingSaved
      || !conversationRecorder?.finished || !conversationRecorder.chunks.length;
  }

  function checkRecordingMemoryLimit() {
    const storedBytes = (recorderSession?.storedBytes || 0) + (conversationRecorder?.storedBytes || 0);
    if (storedBytes < MAX_RECORDING_BYTES) return false;
    if (memoryLimitReached) return true;
    memoryLimitReached = true;
    if (recording) {
      setStatus('Recordings reached the 512 MB in-memory limit. Finishing…');
      void window.RemoteCallConnection.stopCall();
    } else {
      setStatus('Conversation recording reached the 512 MB in-memory limit.', true);
      void conversationRecorder?.stop();
    }
    return true;
  }

  function pickMime(kind) {
    const candidates = kind === 'audio'
      ? ['audio/webm;codecs=opus']
      : ['video/webm;codecs=vp9', 'video/webm;codecs=vp8'];
    return candidates.find(type => MediaRecorder.isTypeSupported(type) && MediaSource.isTypeSupported(type));
  }

  function pickRecordingMime(videoMime) {
    const preferred = videoMime.includes('vp9') ? 'vp9' : 'vp8';
    const other = preferred === 'vp9' ? 'vp8' : 'vp9';
    return [`video/webm;codecs=${preferred},opus`, `video/webm;codecs=${other},opus`, 'video/webm']
      .find(mimeType => MediaRecorder.isTypeSupported(mimeType)) || null;
  }

  function requireTrack(track, message) {
    if (!track) throw new Error(message);
    return track;
  }

  // Queue chunks until the MSE receiver has room for them.
  class LocalChunkLink {
    constructor(receiver) {
      this.receiver = receiver;
      this.tracks = {
        audio: { queue: [], ended: false, notified: false },
        video: { queue: [], ended: false, notified: false }
      };
      this.closed = false;
      this.pumpTimer = setInterval(() => this.flush(), 50);
    }

    publishChunk(chunk) {
      const kind = chunk.mediaType.toLowerCase();
      if (!this.tracks[kind] || this.closed) return;
      this.tracks[kind].queue.push(chunk);
      this.flush();
    }

    finishTrack(kind) {
      if (!this.tracks[kind] || this.closed) return;
      this.tracks[kind].ended = true;
      this.flush();
    }

    flush() {
      if (this.closed || this.receiver.closed) return;
      try {
        for (const kind of ['audio', 'video']) {
          const track = this.tracks[kind];
          let sent = 0;
          while (sent < track.queue.length && this.receiver.receiveChunk(track.queue[sent])) sent++;
          if (sent) track.queue.splice(0, sent);
          if (track.ended && !track.queue.length && !track.notified) {
            track.notified = true;
            this.receiver.finishTrack(kind);
          }
        }
      } catch (error) {
        setStatus(`Chunk delivery failed: ${error.message}`, true);
        this.close();
      }
    }

    close() {
      if (this.closed) return;
      this.closed = true;
      clearInterval(this.pumpTimer);
      for (const track of Object.values(this.tracks)) track.queue.length = 0;
    }
  }

  class CallRecorder {
    constructor({ clock, playbackMark, onUpdate, onLimit, onError }) {
      this.clock = clock;
      this.playbackMark = playbackMark;
      this.playMark = null;
      this.onUpdate = onUpdate;
      this.onLimit = onLimit;
      this.onError = onError;
      this.publisher = null;
      this.recorders = { audio: null, video: null, recording: null };
      this.chunks = { audio: [], video: [] };
      this.recordingChunks = [];
      this.recordingMimeType = '';
      this.mimeTypes = { audio: '', video: '' };
      this.lastEndMs = { audio: 0, video: 0 };
      this.nextSequence = { audio: 0, video: 0 };
      this.conversionTail = { audio: Promise.resolve(), video: Promise.resolve() };
      this.mediaWindows = new Map();
      this.storedBytes = 0;
    }

    setPublisher(publisher) {
      this.publisher = publisher;
    }

    publishChunk(chunk) {
      this.publisher?.publishChunk(chunk);
    }

    addToWindow(chunk) {
      const index = Math.floor(chunk.startTime / WINDOW_MS);
      let window = this.mediaWindows.get(index);
      if (!window) {
        window = {
          index,
          startTime: index * WINDOW_MS,
          endTime: (index + 1) * WINDOW_MS,
          duration: WINDOW_MS,
          audio: null,
          video: null
        };
        this.mediaWindows.set(index, window);
      }
      const kind = chunk.mediaType.toLowerCase();
      if (!window[kind]) window[kind] = chunk;
      else (window.extra ||= { audio: [], video: [] })[kind].push(chunk);
      const oldestAllowed = index - 30;
      for (const key of this.mediaWindows.keys()) {
        if (key < oldestAllowed) this.mediaWindows.delete(key);
      }
    }

    onData(kind, event) {
      if (!event.data?.size) return;
      const createdAtEpochMs = performance.timeOrigin + performance.now();
      const index = this.nextSequence[kind]++;
      const endTime = Math.max(this.lastEndMs[kind] + 1, this.clock());
      const startTime = this.lastEndMs[kind];
      this.lastEndMs[kind] = endTime;
      // What the peer's stream was playing when this chunk started and ended recording;
      // the peer rebuilds its own voice that our microphone may have picked up.
      const playStart = kind === 'audio' ? this.playMark : null;
      const playEnd = kind === 'audio' ? this.playbackMark() : null;
      if (kind === 'audio') this.playMark = playEnd;
      const blob = event.data;
      this.conversionTail[kind] = this.conversionTail[kind].then(async () => {
        const binary = new Uint8Array(await blob.arrayBuffer());
        const chunk = {
          index,
          mediaType: kind.toUpperCase(),
          mimeType: this.mimeTypes[kind],
          startTime,
          endTime,
          createdAtEpochMs,
          playStart,
          playEnd,
          duration: endTime - startTime,
          binary
        };
        this.chunks[kind].push(chunk);
        this.addToWindow(chunk);
        this.storedBytes += binary.byteLength;
        this.publishChunk(chunk);
        this.onUpdate();
        if (this.storedBytes >= MAX_RECORDING_BYTES) this.onLimit();
      }).catch(error => this.onError(kind, error));
    }

    start(kind, track, mimeType) {
      const recorder = new MediaRecorder(new MediaStream([track]), {
        mimeType,
        ...(kind === 'audio' ? { audioBitsPerSecond: 64000 } : { videoBitsPerSecond: 1500000 })
      });
      let resolveStopped;
      const stopped = new Promise(resolve => { resolveStopped = resolve; });
      recorder.addEventListener('dataavailable', event => this.onData(kind, event));
      recorder.addEventListener('error', event => {
        this.onError(kind, event.error || new Error('unknown recorder error'));
      });
      recorder.addEventListener('stop', resolveStopped, { once: true });
      if (kind === 'audio') this.playMark = this.playbackMark();
      recorder.start(CHUNK_MS);
      this.recorders[kind] = { recorder, stopped };
      this.mimeTypes[kind] = recorder.mimeType || mimeType;
    }

    startCombined(audioTrack, videoTrack, mimeType) {
      const recorder = new MediaRecorder(new MediaStream([videoTrack, audioTrack]), {
        mimeType, audioBitsPerSecond: 64000, videoBitsPerSecond: 1500000
      });
      let resolveStopped;
      const stopped = new Promise(resolve => { resolveStopped = resolve; });
      recorder.addEventListener('dataavailable', event => {
        if (!event.data?.size) return;
        this.recordingChunks.push(event.data);
        this.storedBytes += event.data.size;
        this.onUpdate();
        if (this.storedBytes >= MAX_RECORDING_BYTES) this.onLimit();
      });
      recorder.addEventListener('error', event => {
        this.onError('combined', event.error || new Error('unknown recorder error'));
      });
      recorder.addEventListener('stop', resolveStopped, { once: true });
      recorder.start(CHUNK_MS);
      this.recorders.recording = { recorder, stopped };
      this.recordingMimeType = recorder.mimeType || mimeType;
    }

    stopImmediately() {
      for (const current of Object.values(this.recorders)) {
        if (current && current.recorder.state !== 'inactive') current.recorder.stop();
      }
    }

    async stop() {
      const done = Object.values(this.recorders).filter(Boolean).map(current => current.stopped);
      this.stopImmediately();
      await Promise.all(done);
      await Promise.all([this.conversionTail.audio, this.conversionTail.video]);
    }
  }

  function drawVideoFrame() {
    if (!canvasContext) return;
    canvasContext.fillStyle = '#000';
    canvasContext.fillRect(0, 0, canvas.width, canvas.height);
    if (!cameraActive || !cameraInput || cameraInput.readyState < HTMLMediaElement.HAVE_CURRENT_DATA
      || !cameraInput.videoWidth || !cameraInput.videoHeight) return;
    const scale = Math.min(canvas.width / cameraInput.videoWidth, canvas.height / cameraInput.videoHeight);
    const width = cameraInput.videoWidth * scale;
    const height = cameraInput.videoHeight * scale;
    try {
      canvasContext.drawImage(cameraInput, (canvas.width - width) / 2,
        (canvas.height - height) / 2, width, height);
    } catch {
      // A camera track can end between the readiness check and drawing; keep the frame black.
    }
  }

  function startVideoCapture() {
    canvas = document.createElement('canvas');
    canvas.width = 1280;
    canvas.height = 720;
    canvasContext = canvas.getContext('2d', { alpha: false });
    if (!canvasContext || !canvas.captureStream) throw new Error('Canvas video capture is unavailable.');
    drawVideoFrame();
    canvasStream = canvas.captureStream(30);
    if (!canvasStream.getVideoTracks()[0]) throw new Error('Canvas video track is unavailable.');
    drawTimer = setInterval(drawVideoFrame, 1000 / 30);
    ui.camera.muted = true;
    ui.camera.srcObject = canvasStream;
    ui.camera.play().catch(() => {});
  }

  async function enableCameraTrack(track) {
    cameraInput ||= document.createElement('video');
    cameraInput.muted = true;
    cameraInput.playsInline = true;
    cameraInput.srcObject = new MediaStream([track]);
    try { await cameraInput.play(); }
    catch (error) {
      cameraInput.srcObject = null;
      throw error;
    }
    cameraTrack = track;
    cameraActive = true;
    drawVideoFrame();
  }

  function disableCameraTrack() {
    cameraActive = false;
    cameraInput?.pause();
    if (cameraInput) cameraInput.srcObject = null;
    if (cameraTrack) {
      mediaStream?.removeTrack(cameraTrack);
      cameraTrack.stop();
      cameraTrack = null;
    }
    drawVideoFrame();
  }

  function stopVideoCapture() {
    clearInterval(drawTimer);
    drawTimer = null;
    disableCameraTrack();
    canvasStream?.getTracks().forEach(track => track.stop());
    canvasStream = null;
    canvasContext = null;
    canvas = null;
  }

  function updateCameraCaption() {
    ui.cameraCaption.textContent = cameraActive
      ? micMuted ? 'Live camera preview. Microphone muted; silent audio is recording.'
        : 'Live camera preview, with audio muted to prevent feedback.'
      : micMuted ? 'Camera off. Black video frames and silent audio are recording.'
        : 'Camera off. Black video frames and microphone audio are recording.';
  }

  function showDeviceOff(button, off) {
    button.style.backgroundColor = off ? '#69323b' : '';
    button.style.color = off ? '#ffe0e3' : '';
    button.querySelector('.off-mark').style.visibility = off ? 'visible' : '';
  }

  function setMicMuted(muted) {
    micMuted = muted;
    const audioTrack = mediaStream?.getAudioTracks()[0];
    if (audioTrack) audioTrack.enabled = !muted;
    ui.muteMic.title = muted ? 'Unmute microphone' : 'Mute microphone';
    ui.muteMic.setAttribute('aria-pressed', String(muted));
    showDeviceOff(ui.muteMic, muted);
  }

  function cameraEnabled() {
    return ui.cameraEnabled.getAttribute('aria-pressed') === 'true';
  }

  function setCameraEnabled(enabled) {
    ui.cameraEnabled.setAttribute('aria-pressed', String(enabled));
    ui.cameraEnabled.title = enabled ? 'Turn camera off' : 'Turn camera on';
    showDeviceOff(ui.cameraEnabled, !enabled);
  }

  function downloadFallback(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  class SourceBufferQueue {
    constructor(sourceBuffer, video, maxQueuedBytes, onProgress, onError) {
      this.buffer = sourceBuffer;
      this.video = video;
      this.maxQueuedBytes = maxQueuedBytes;
      this.onProgress = onProgress;
      this.onError = onError;
      this.fragments = [];
      this.queuedBytes = 0;
      this.operations = [];
      this.trimQueued = false;
      this.currentOperation = null;
      this.closed = false;
      this.onUpdateEnd = () => {
        const completed = this.currentOperation;
        this.currentOperation = null;
        if (completed?.type === 'append') {
          this.queuedBytes -= completed.bytes.byteLength;
          completed.onAppended();
        }
        if (completed?.type === 'remove') this.trimQueued = false;
        this.fill();
        this.pump();
        this.onProgress();
      };
      this.onBufferError = () => this.onError(new Error('MSE SourceBuffer error'));
      sourceBuffer.addEventListener('updateend', this.onUpdateEnd);
      sourceBuffer.addEventListener('error', this.onBufferError);
    }

    bufferedEnd() {
      const ranges = this.buffer.buffered;
      return ranges.length ? ranges.end(ranges.length - 1) : 0;
    }

    enqueue(bytes, onAppended) {
      if (this.closed || this.queuedBytes + bytes.byteLength > this.maxQueuedBytes) return false;
      this.fragments.push({ bytes, onAppended });
      this.queuedBytes += bytes.byteLength;
      return true;
    }

    fill() {
      if (this.closed) return;
      const ahead = this.bufferedEnd() - this.video.currentTime;
      if (ahead < 12 && this.operations.length < 4 && this.fragments.length) {
        this.operations.push({ type: 'append', ...this.fragments.shift() });
      }
      const ranges = this.buffer.buffered;
      const cutoff = this.video.currentTime - 20;
      if (!this.trimQueued && ranges.length && ranges.start(0) < cutoff - 10) {
        this.operations.unshift({ type: 'remove', start: ranges.start(0), end: cutoff });
        this.trimQueued = true;
      }
    }

    pump() {
      if (this.closed || this.buffer.updating || !this.operations.length) return;
      const operation = this.operations.shift();
      try {
        this.currentOperation = operation;
        if (operation.type === 'append') this.buffer.appendBuffer(operation.bytes);
        else this.buffer.remove(operation.start, operation.end);
      } catch (error) {
        this.currentOperation = null;
        this.onError(error);
      }
    }

    idle() {
      return !this.fragments.length && !this.operations.length && !this.buffer.updating;
    }

    close() {
      this.closed = true;
      this.fragments.length = 0;
      this.operations.length = 0;
      this.buffer.removeEventListener('updateend', this.onUpdateEnd);
      this.buffer.removeEventListener('error', this.onBufferError);
    }
  }

  class MseReplayPlayer {
    constructor(video, types, onPlaybackEnd) {
      this.video = video;
      this.types = types;
      this.onPlaybackEnd = onPlaybackEnd;
      this.inbox = {
        audio: { next: 0, pending: new Map(), bytes: 0, finished: false },
        video: { next: 0, pending: new Map(), bytes: 0, finished: false }
      };
      this.mediaSource = new MediaSource();
      this.url = URL.createObjectURL(this.mediaSource);
      this.queues = null;
      this.audioChunkEnds = [];
      this.playingAudioChunk = null;
      this.started = false;
      this.syncHold = true;
      this.playbackFinished = false;
      this.closed = false;
      this.onOpen = () => this.open();
      this.onTimeUpdate = () => this.progress();
      this.mediaSource.addEventListener('sourceopen', this.onOpen, { once: true });
      video.addEventListener('timeupdate', this.onTimeUpdate);
      this.progressTimer = setInterval(() => this.progress(), 50);
      video.src = this.url;
    }

    open() {
      if (this.closed) return;
      try {
        this.queues = {
          audio: new SourceBufferQueue(this.mediaSource.addSourceBuffer(this.types.audio), this.video,
            8 * 1048576, () => this.progress(), error => this.fail(error)),
          video: new SourceBufferQueue(this.mediaSource.addSourceBuffer(this.types.video), this.video,
            32 * 1048576, () => this.progress(), error => this.fail(error))
        };
        this.progress();
      } catch (error) {
        this.fail(error);
      }
    }

    // This is the receiver entry point: each chunk may arrive independently and out of order.
    receiveChunk(chunk) {
      const accepted = this.ingestChunk(chunk);
      if (accepted) this.progress();
      return accepted;
    }

    ingestChunk(chunk) {
      const kind = chunk?.mediaType?.toLowerCase();
      if (!this.inbox[kind] || !Number.isSafeInteger(chunk.index) || chunk.index < 0
        || !(chunk.binary instanceof Uint8Array)) throw new Error('Invalid media chunk');
      const inbox = this.inbox[kind];
      if (this.closed || inbox.finished) throw new Error('Media stream is closed');
      if (chunk.index < inbox.next || inbox.pending.has(chunk.index)) return true;
      const maxBytes = kind === 'audio' ? 8 * 1048576 : 32 * 1048576;
      if (inbox.bytes + chunk.binary.byteLength > maxBytes) return false;
      inbox.pending.set(chunk.index, chunk);
      inbox.bytes += chunk.binary.byteLength;
      this.flushOrdered(kind);
      return true;
    }

    flushOrdered(kind) {
      const queue = this.queues?.[kind];
      if (!queue) return;
      const inbox = this.inbox[kind];
      while (inbox.pending.has(inbox.next)) {
        const chunk = inbox.pending.get(inbox.next);
        if (!queue.enqueue(chunk.binary, () => {
          if (inbox.pending.delete(chunk.index)) inbox.bytes -= chunk.binary.byteLength;
          if (kind === 'audio') this.recordAudioChunkEnd(chunk.index, queue.bufferedEnd());
        })) break;
        inbox.next++;
      }
    }

    // Chunk i holds the audio buffered after chunk i - 1 and up to its recorded end.
    recordAudioChunkEnd(index, endSeconds) {
      this.audioChunkEnds.push({ index, endMs: endSeconds * 1000 });
      if (this.audioChunkEnds.length > 120) this.audioChunkEnds.shift();
    }

    // Returns the incoming audio chunk and media time being heard now, or null when
    // nothing is audible, so the local recorder can tag its chunks with it.
    updatePlayingAudioChunk() {
      const video = this.video;
      this.playingAudioChunk = null;
      if (this.closed || !this.started || this.syncHold || video.paused || video.seeking
        || video.muted || video.volume === 0
        || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return null;
      const timeMs = video.currentTime * 1000;
      const ranges = this.queues?.audio.buffer.buffered;
      let audioBuffered = false;
      for (let index = 0; index < (ranges?.length || 0); index++) {
        if (ranges.start(index) * 1000 <= timeMs && timeMs < ranges.end(index) * 1000) {
          audioBuffered = true;
          break;
        }
      }
      if (!audioBuffered) return null;
      const appended = this.audioChunkEnds.find(entry => entry.endMs > timeMs);
      if (appended) this.playingAudioChunk = { chunk: appended.index, timeMs };
      return this.playingAudioChunk;
    }

    finishTrack(kind) {
      if (!this.inbox[kind]) throw new Error('Invalid media stream');
      this.inbox[kind].finished = true;
      this.progress();
    }

    progress() {
      if (this.closed || this.playbackFinished || !this.queues) return;
      this.flushOrdered('audio');
      this.flushOrdered('video');
      for (const queue of Object.values(this.queues)) {
        queue.fill();
        queue.pump();
      }
      const audio = this.queues.audio.buffer.buffered;
      const video = this.queues.video.buffer.buffered;
      const audioEnd = this.queues.audio.bufferedEnd();
      const videoEnd = this.queues.video.bufferedEnd();
      const fullyAppended = Object.values(this.inbox).every(inbox => inbox.finished && !inbox.pending.size)
        && this.queues.audio.idle() && this.queues.video.idle();
      const sharedEnd = Math.min(audioEnd, videoEnd);
      const initialRange = !this.started && findCommonBufferedRange(audio, video,
        fullyAppended ? 0.05 : INITIAL_COMMON_BUFFER_SECONDS);
      ui.diagnostics.textContent = `MSE · audio ${formatRanges(audio)} · video ${formatRanges(video)} · playhead ${this.video.currentTime.toFixed(2)}s · buffered end gap ${Math.abs(audioEnd - videoEnd).toFixed(2)}s${this.syncHold ? ' · waiting for both streams' : ''}`;
      if (initialRange) {
        this.started = true;
        this.video.currentTime = initialRange.start;
      }
      if (this.mediaSource.readyState === 'open' && fullyAppended) {
        if (!this.started) {
          this.fail(new Error('Audio and video MSE timelines have no overlapping buffered range'));
          return;
        }
        try {
          this.mediaSource.endOfStream();
        } catch (error) {
          this.fail(error);
          return;
        }
      }
      if (this.started && fullyAppended && this.video.currentTime >= sharedEnd - 0.05) {
        this.finishPlayback();
        return;
      }
      if (this.started) {
        const minimumAhead = fullyAppended
          ? Math.min(0.15, Math.max(0.02, sharedEnd - this.video.currentTime - 0.01)) : 0.15;
        const ready = hasCommonBufferAt(audio, video, this.video.currentTime, minimumAhead)
          && this.video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
          && !this.video.seeking;
        if (!ready) {
          if (fullyAppended && this.video.currentTime >= sharedEnd - 0.15) {
            this.finishPlayback();
            return;
          }
          this.syncHold = true;
          this.video.pause();
          ui.caption.textContent = 'Waiting for synchronized audio and video.';
        } else if (this.syncHold) {
          this.syncHold = false;
          ui.caption.textContent = 'Playing synchronized audio and video.';
          this.video.play().catch(() => {
            ui.caption.textContent = 'Playback needs a click. Press Play below the player.';
          });
        }
        updateReplayControls();
      }
      this.updatePlayingAudioChunk();
    }

    finishPlayback() {
      if (this.closed || this.playbackFinished) return;
      this.playbackFinished = true;
      clearInterval(this.progressTimer);
      this.video.pause();
      this.playingAudioChunk = null;
      ui.caption.textContent = 'Playback finished.';
      ui.controls.hidden = true;
      this.onPlaybackEnd?.();
    }

    fail(error) {
      if (this.closed || this.playbackFinished) return;
      setStatus(`MSE replay failed: ${error.message}`, true);
      ui.caption.textContent = 'This browser could not replay the separate audio and video streams.';
      this.close();
      this.onPlaybackEnd?.();
    }

    close() {
      if (this.closed) return;
      this.closed = true;
      ui.controls.hidden = true;
      clearInterval(this.progressTimer);
      this.video.pause();
      this.video.removeEventListener('timeupdate', this.onTimeUpdate);
      this.mediaSource.removeEventListener('sourceopen', this.onOpen);
      if (this.queues) Object.values(this.queues).forEach(queue => queue.close());
      for (const inbox of Object.values(this.inbox)) inbox.pending.clear();
      this.video.removeAttribute('src');
      this.video.load();
      URL.revokeObjectURL(this.url);
    }
  }

  function formatRanges(ranges) {
    if (!ranges.length) return 'empty';
    return `${ranges.start(0).toFixed(2)}–${ranges.end(ranges.length - 1).toFixed(2)}s`;
  }

  function findCommonBufferedRange(audio, video, minimumSeconds) {
    for (let a = 0; a < audio.length; a++) {
      for (let v = 0; v < video.length; v++) {
        const start = Math.max(audio.start(a), video.start(v));
        const end = Math.min(audio.end(a), video.end(v));
        if (end - start >= minimumSeconds) return { start, end };
      }
    }
    return null;
  }

  function hasCommonBufferAt(audio, video, time, minimumAhead) {
    for (let a = 0; a < audio.length; a++) {
      if (audio.start(a) > time + 0.05 || audio.end(a) < time + minimumAhead) continue;
      for (let v = 0; v < video.length; v++) {
        if (video.start(v) <= time + 0.05 && video.end(v) >= time + minimumAhead) return true;
      }
    }
    return false;
  }

  function updateReplayControls() {
    ui.pause.textContent = ui.video.paused ? 'Play' : 'Pause';
    ui.pause.disabled = false;
    ui.mute.textContent = ui.video.muted ? 'Unmute audio' : 'Mute audio';
    ui.mute.setAttribute('aria-pressed', String(ui.video.muted));
  }

  function releaseLocalReplay() {
    localReplayActive = false;
    if (!localReplayUrl) return;
    ui.video.pause();
    ui.video.removeAttribute('src');
    ui.video.load();
    URL.revokeObjectURL(localReplayUrl);
    localReplayUrl = null;
  }

  function resetRecording() {
    void conversationRecorder?.stop();
    conversationRecorder = null;
    conversationStoppingPromise = null;
    memoryLimitReached = false;
    releaseLocalReplay();
    remoteLink?.close();
    remoteLink = null;
    clearTimeout(remoteFinishTimer);
    remoteFinishTimer = null;
    remoteFinalCounts = null;
    remotePlaybackFinished = false;
    callEnded = false;
    remoteReceived = { audio: new Set(), video: new Set() };
    remoteChunkTimings = { audio: new Map(), video: new Map() };
    player?.close();
    player = null;
    resetEchoProcessing();
    echoReference = null;
    stopVideoCapture();
    cameraBusy = false;
    preparedMimeTypes = null;
    recorderSession = new CallRecorder({
      clock: relativeMs,
      playbackMark: () => (remoteLink && player && !player.closed ? player.updatePlayingAudioChunk() : null),
      onUpdate: () => { updateStats(); checkRecordingMemoryLimit(); },
      onLimit: checkRecordingMemoryLimit,
      onError: (kind, error) => {
        setStatus(`${kind} recorder failed: ${error.message}`, true);
        if (recording) void window.RemoteCallConnection.stopCall();
      }
    });
    setMicMuted(false);
    finished = false;
    recordingSaved = false;
    ui.save.textContent = 'Save conversation';
    ui.controls.hidden = true;
    ui.cameraCaption.textContent = 'Live preview appears here when recording starts.';
    ui.echoCancellationStatus.textContent = 'Echo cancellation will be checked when the microphone opens.';
    ui.caption.textContent = 'Incoming audio and video appear here during the call.';
    ui.diagnostics.textContent = 'Audio and video buffer diagnostics appear during replay.';
    updateStats();
  }

  async function acquireCameraStream(audio) {
    const video = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } };
    try {
      return await navigator.mediaDevices.getUserMedia({ audio, video: { ...video, facingMode: { exact: 'user' } } });
    } catch (error) {
      if (error.name !== 'OverconstrainedError' || (error.constraint && error.constraint !== 'facingMode')) throw error;
      return navigator.mediaDevices.getUserMedia({ audio, video });
    }
  }

  async function acquireMediaStream() {
    const audio = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
    if (!cameraEnabled()) return navigator.mediaDevices.getUserMedia({ audio, video: false });
    return acquireCameraStream(audio).catch(async () => {
      const stream = await navigator.mediaDevices.getUserMedia({ audio, video: false });
      setCameraEnabled(false);
      return stream;
    });
  }

  async function configureEchoCancellation(track) {
    const modes = track.getCapabilities?.()?.echoCancellation;
    // This call plays remote audio through MediaSource, so "remote-only" (WebRTC
    // tracks) is insufficient. Request cancellation of all system output when offered.
    if (Array.isArray(modes) && modes.includes('all')
      && track.applyConstraints) {
      try {
        await track.applyConstraints({
          echoCancellation: { exact: 'all' },
          noiseSuppression: true,
          autoGainControl: true
        });
      } catch (error) {
        console.warn('Full-system echo cancellation could not be enabled:', error);
      }
    }
    let setting = track.getSettings?.()?.echoCancellation;
    if (setting === false && track.applyConstraints) {
      try {
        await track.applyConstraints({
          echoCancellation: { exact: true },
          noiseSuppression: true,
          autoGainControl: true
        });
        setting = track.getSettings?.()?.echoCancellation;
      } catch (error) {
        console.warn('Microphone echo cancellation could not be enabled:', error);
      }
    }
    if (setting === 'all') {
      ui.echoCancellationStatus.textContent = 'Echo cancellation: all system audio.';
    } else if (setting === true) {
      ui.echoCancellationStatus.textContent = 'Echo cancellation: on (browser mode).';
    } else if (setting === false) {
      ui.echoCancellationStatus.textContent = 'Echo cancellation is unavailable. Use headphones to prevent echo.';
    } else if (setting === 'remote-only') {
      ui.echoCancellationStatus.textContent = 'Echo cancellation may not cover incoming audio. Use headphones if you hear echo.';
    } else {
      ui.echoCancellationStatus.textContent = 'Echo cancellation requested; use headphones if you hear echo.';
    }
  }

  async function resumeEchoContext(context) {
    let timeout;
    try {
      await Promise.race([
        context.resume(),
        new Promise((_, reject) => {
          timeout = setTimeout(() => reject(new Error('Audio processing needs a user gesture')), 1500);
        })
      ]);
      if (context.state !== 'running') throw new Error('Audio processing could not start');
    } finally {
      clearTimeout(timeout);
    }
  }

  async function prepareConversationAudio() {
    if (!AudioContextClass) throw new Error('Web Audio is required to record both sides of the call');
    if (!echoContext) {
      const context = new AudioContextClass();
      try {
        const source = context.createMediaElementSource(ui.video);
        source.connect(context.destination);
        echoContext = context;
        echoPlayerSource = source;
      } catch (error) {
        void context.close().catch(() => {});
        throw error;
      }
    }
    if (!echoPlayerSource) throw new Error('Incoming audio source is unavailable');
    if (echoContext.state !== 'running') await resumeEchoContext(echoContext);
  }

  function readVint(bytes, offset, keepMarker) {
    if (offset >= bytes.length) return null;
    const first = bytes[offset];
    let length = 1;
    while (length <= 8 && first < 2 ** (8 - length)) length++;
    if (length > 8) throw new Error('Invalid WebM data');
    if (offset + length > bytes.length) return null;
    let value = keepMarker ? first : first % (2 ** (8 - length));
    for (let i = 1; i < length; i++) value = value * 256 + bytes[offset + i];
    return { value, length, unknown: !keepMarker && value === 2 ** (7 * length) - 1 };
  }

  function readUint(bytes, start, end) {
    let value = 0;
    for (let i = start; i < end; i++) value = value * 256 + bytes[i];
    return value;
  }

  // Extracts Opus packets and media timestamps from our MediaRecorder WebM stream.
  // Elements can continue across chunk boundaries, so chunks must be pushed in order.
  class WebmOpusParser {
    constructor() {
      this.pending = new Uint8Array(0);
      this.timecodeScale = 1000000;
      this.clusterTimecode = 0;
      this.channels = 1;
      this.sampleRate = 48000;
    }

    push(binary) {
      const bytes = new Uint8Array(this.pending.length + binary.length);
      bytes.set(this.pending);
      bytes.set(binary, this.pending.length);
      const packets = [];
      let offset = 0;
      while (offset < bytes.length) {
        const id = readVint(bytes, offset, true);
        const size = id && readVint(bytes, offset + id.length, false);
        if (!size) break;
        const start = offset + id.length + size.length;
        if (WEBM_MASTER_IDS.has(id.value)) {
          offset = start;
          continue;
        }
        if (size.unknown) throw new Error('Unsupported WebM element size');
        const end = start + size.value;
        if (end > bytes.length) break;
        this.readElement(id.value, bytes, start, end, packets);
        offset = end;
      }
      this.pending = bytes.slice(offset);
      return packets;
    }

    readElement(id, bytes, start, end, packets) {
      if (id === 0x2ad7b1) this.timecodeScale = readUint(bytes, start, end);
      else if (id === 0xe7) this.clusterTimecode = readUint(bytes, start, end);
      else if (id === 0x9f) this.channels = readUint(bytes, start, end);
      else if (id === 0xb5) {
        const view = new DataView(bytes.buffer, bytes.byteOffset + start, end - start);
        this.sampleRate = end - start === 4 ? view.getFloat32(0) : view.getFloat64(0);
      } else if (id === 0xa3 || id === 0xa1) {
        const track = readVint(bytes, start, false);
        const header = start + (track?.length || 0);
        if (!track || header + 3 > end) throw new Error('Invalid WebM block');
        if (Math.floor(bytes[header + 2] / 2) % 4 !== 0) return; // MediaRecorder does not lace audio frames.
        const unsignedTimecode = bytes[header] * 256 + bytes[header + 1];
        const relative = unsignedTimecode >= 0x8000 ? unsignedTimecode - 0x10000 : unsignedTimecode;
        packets.push({
          timestampUs: Math.round((this.clusterTimecode + relative) * this.timecodeScale / 1000),
          data: bytes.subarray(header + 3, end)
        });
      }
    }
  }

  function monoFrame(data) {
    const samples = new Float32Array(data.numberOfFrames);
    const plane = new Float32Array(data.numberOfFrames);
    for (let channel = 0; channel < data.numberOfChannels; channel++) {
      data.copyTo(plane, { planeIndex: channel, format: 'f32-planar' });
      for (let i = 0; i < plane.length; i++) samples[i] += plane[i] / data.numberOfChannels;
    }
    const startMs = data.timestamp / 1000;
    return { startMs, endMs: startMs + samples.length * 1000 / data.sampleRate, sampleRate: data.sampleRate, samples };
  }

  // Decodes our own stored audio chunks around the moments the peer reports playing.
  class LocalEchoReference {
    constructor(chunks) {
      this.chunks = chunks;
      this.parser = new WebmOpusParser();
      this.packets = [];
      this.prunedBefore = 0;
    }

    parseThrough(index) {
      while (this.packets.length <= index && this.packets.length < this.chunks.length) {
        this.packets.push(this.parser.push(this.chunks[this.packets.length].binary));
      }
    }

    async decode(firstChunk, lastChunk, fromMs, toMs) {
      // A single mark can point a whole peer chunk away from the other end of the
      // snippet, and peers may use different chunk intervals, so widen by timestamps.
      let last = Math.min(lastChunk, this.chunks.length - 1);
      this.parseThrough(last);
      while (last + 1 < this.chunks.length && !(this.packets[last]?.at(-1)?.timestampUs / 1000 >= toMs)) {
        this.parseThrough(++last);
      }
      const prerollFromUs = (fromMs - ECHO_REFERENCE_PREROLL_MS) * 1000;
      let first = Math.max(0, Math.min(firstChunk, last));
      while (first > 0 && this.packets[first - 1] && !(this.packets[first]?.[0]?.timestampUs <= prerollFromUs)) first--;
      const selected = [];
      for (let i = first; i <= last; i++) {
        for (const packet of this.packets[i] || []) {
          if (packet.timestampUs >= prerollFromUs && packet.timestampUs <= toMs * 1000) selected.push(packet);
        }
      }
      for (; this.prunedBefore < first - 60; this.prunedBefore++) this.packets[this.prunedBefore] = null;
      if (!selected.length) return [];
      const frames = [];
      let failure = null;
      const decoder = new AudioDecoder({
        output: data => {
          try { frames.push(monoFrame(data)); } finally { data.close(); }
        },
        error: error => { failure = error; }
      });
      try {
        decoder.configure({
          codec: 'opus', sampleRate: Math.round(this.parser.sampleRate), numberOfChannels: this.parser.channels
        });
        for (const packet of selected) {
          decoder.decode(new EncodedAudioChunk({ type: 'key', timestamp: packet.timestampUs, data: packet.data }));
        }
        await decoder.flush();
      } finally {
        if (decoder.state !== 'closed') decoder.close();
      }
      if (failure) throw failure;
      return frames;
    }
  }

  // Maps a moment of the peer's chunk recording to our media time it was playing.
  function playedTimeAt(time, timing) {
    const { senderStartTimeMs: start, senderEndTimeMs: end, playStart, playEnd } = timing;
    return playStart.timeMs + (time - start) * (playEnd.timeMs - playStart.timeMs) / (end - start);
  }

  // Rebuilds the part of our stream the peer played while recording one audio chunk,
  // laid out on that chunk's timeline at the processing sample rate.
  async function buildEchoReference(reference, timing, sampleRate) {
    const { playStart, playEnd, senderStartTimeMs: start, senderEndTimeMs: end } = timing;
    if (!playStart || !playEnd || playEnd.chunk < playStart.chunk) return null;
    const playbackRate = (playEnd.timeMs - playStart.timeMs) / (end - start);
    if (playbackRate < 0.5 || playbackRate > 1.5) return null;
    const frames = await reference.decode(playStart.chunk, playEnd.chunk,
      playedTimeAt(start, timing), playedTimeAt(end, timing));
    if (!frames.length) return null;
    const samples = new Float32Array(Math.round((end - start) * sampleRate / 1000));
    let frameIndex = 0;
    for (let i = 0; i < samples.length; i++) {
      const played = playedTimeAt(start + i * 1000 / sampleRate, timing);
      while (frameIndex < frames.length - 1 && frames[frameIndex].endMs <= played) frameIndex++;
      const frame = frames[frameIndex];
      const position = (played - frame.startMs) * frame.sampleRate / 1000;
      const lower = Math.floor(position);
      if (lower < 0 || lower >= frame.samples.length) continue;
      const next = lower + 1 < frame.samples.length ? frame.samples[lower + 1]
        : frames[frameIndex + 1]?.samples[0] ?? frame.samples[lower];
      samples[i] = frame.samples[lower] + (position - lower) * (next - frame.samples[lower]);
    }
    return samples;
  }

  function queueEchoReference(timing) {
    const reference = echoReference;
    const generation = echoGeneration;
    if (!echoNode || !reference || !timing.playStart || !timing.playEnd) return;
    void buildEchoReference(reference, timing, echoContext.sampleRate).then(samples => {
      if (!samples || generation !== echoGeneration || !echoNode) return;
      echoNode.port.postMessage({ type: 'reference', startMs: timing.senderStartTimeMs, samples }, [samples.buffer]);
    }).catch(error => {
      if (echoReference !== reference) return;
      bypassEchoProcessing();
      console.warn('Extra echo reference is unavailable:', error);
      ui.echoCancellationStatus.textContent = 'Extra echo cancellation stopped; incoming audio plays normally.';
    });
  }

  function resetEchoProcessing() {
    echoGeneration++;
    echoNode?.port.postMessage({ type: 'reset' });
  }

  // References are keyed by the incoming stream's media time; the worklet maps its
  // own clock to that time from these samples.
  function postEchoClock() {
    if (!echoNode) return;
    const video = ui.video;
    echoNode.port.postMessage({
      type: 'clock',
      mediaMs: video.currentTime * 1000,
      contextTime: echoContext.currentTime,
      playing: !video.paused && !video.seeking && video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA
    });
  }

  function bypassEchoProcessing() {
    if (!echoNode) return;
    clearInterval(echoClockTimer);
    echoClockTimer = null;
    try { echoPlayerSource.disconnect(echoNode); } catch { /* The worklet was already detached. */ }
    echoNode.disconnect();
    echoNode.port.close();
    echoNode = null;
    echoReference = null;
    echoPlayerSource.connect(echoContext.destination);
  }

  // Keep the media element source for the page's lifetime; only its worklet route
  // changes, since the element can be captured by one source node only.
  async function prepareExtraEchoCancellation() {
    if (!AudioContextClass || !window.AudioWorkletNode || !window.AudioDecoder || !window.EncodedAudioChunk) {
      throw new Error('AudioWorklet and WebCodecs audio decoding are required');
    }
    if (echoNode) {
      if (echoContext.state !== 'running') await resumeEchoContext(echoContext);
      ui.echoCancellationStatus.textContent += ' Extra echo cancellation: on.';
      return;
    }
    if (!echoContext) {
      const context = new AudioContextClass();
      if (!context.audioWorklet?.addModule) {
        void context.close().catch(() => {});
        throw new Error('AudioWorklet is unavailable');
      }
      try {
        await context.audioWorklet.addModule('js/remote-call-echo-worklet.js');
        await resumeEchoContext(context);
        // Captured last: from here on the element is audible only through this context.
        echoPlayerSource = context.createMediaElementSource(ui.video);
        echoPlayerSource.connect(context.destination);
      } catch (error) {
        void context.close().catch(() => {});
        throw error;
      }
      echoContext = context;
    } else if (echoContext.state !== 'running') {
      await resumeEchoContext(echoContext);
    }
    const node = new AudioWorkletNode(echoContext, 'remote-call-echo', {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1]
    });
    try {
      echoPlayerSource.disconnect();
      echoPlayerSource.connect(node);
      node.connect(echoContext.destination);
    } catch (error) {
      node.disconnect();
      node.port.close();
      echoPlayerSource.disconnect();
      echoPlayerSource.connect(echoContext.destination);
      throw error;
    }
    echoNode = node;
    node.addEventListener('processorerror', () => {
      bypassEchoProcessing();
      setStatus('Extra echo cancellation failed; incoming audio now plays unprocessed.', true);
    });
    echoClockTimer = setInterval(postEchoClock, 100);
    ui.echoCancellationStatus.textContent += ' Extra echo cancellation: on.';
  }

  async function prepareRecording() {
    if (preparedMimeTypes) return preparedMimeTypes;
    if (busy || recording || stoppingPromise) throw new Error('Media is busy');
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder || !window.MediaSource
      || !window.RemoteCallConversationRecorder || !AudioContextClass
      || !HTMLCanvasElement.prototype.captureStream) {
      throw new Error('MediaRecorder, MediaSource, Web Audio and canvas capture are required. Use HTTPS or localhost in a Chromium browser.');
    }
    const audioMime = pickMime('audio');
    const videoMime = pickMime('video');
    const recordingMime = videoMime && pickRecordingMime(videoMime);
    if (!audioMime || !videoMime || !recordingMime) {
      throw new Error('This browser has no audio and video WebM formats supported for the call and combined recording.');
    }
    busy = true;
    ui.statusCard.hidden = false;
    setStatus(cameraEnabled()
      ? 'Requesting camera and microphone access…' : 'Requesting microphone access…');
    try {
      resetRecording();
      mediaStream = await acquireMediaStream();
      const microphoneTrack = requireTrack(mediaStream.getAudioTracks()[0],
        'The required microphone or camera track is unavailable.');
      const initialCameraTrack = mediaStream.getVideoTracks()[0];
      if (cameraEnabled()) requireTrack(initialCameraTrack,
        'The required microphone or camera track is unavailable.');
      ui.statusCard.hidden = true;
      await configureEchoCancellation(microphoneTrack);
      if (ui.extraEchoCancellation.checked) {
        try {
          await prepareExtraEchoCancellation();
        } catch (error) {
          console.warn('Extra echo cancellation is unavailable:', error);
          ui.echoCancellationStatus.textContent += ' Extra processing unavailable.';
        }
      }
      startVideoCapture();
      if (initialCameraTrack) await enableCameraTrack(initialCameraTrack);
      updateCameraCaption();
      baseName = `recording-${new Date().toISOString().replace(/[:.]/g, '-')}`;
      preparedMimeTypes = { audio: audioMime, video: videoMime, recording: recordingMime };
      setStatus(cameraActive ? 'Camera and microphone are ready for the call.'
        : 'Microphone is ready. Black video will be sent.');
      return preparedMimeTypes;
    } catch (error) {
      bypassEchoProcessing();
      stopVideoCapture();
      mediaStream?.getTracks().forEach(track => track.stop());
      mediaStream = null;
      ui.camera.srcObject = null;
      ui.cameraCaption.textContent = 'Camera preview unavailable.';
      ui.statusCard.hidden = false;
      setStatus(`Could not prepare media: ${error.message}`, true);
      throw error;
    } finally {
      busy = false;
      updateStats();
    }
  }

  async function startRecording(sendChunk) {
    if (!preparedMimeTypes || !mediaStream || recording || busy || stoppingPromise) {
      throw new Error('Camera and microphone are not ready');
    }
    const audioTrack = requireTrack(mediaStream.getAudioTracks()[0], 'Microphone track is unavailable');
    const videoTrack = requireTrack(canvasStream?.getVideoTracks()[0], 'Video track is unavailable');
    await prepareConversationAudio();
    startedAt = performance.now();
    recording = true;
    // Kept after recording stops: the peer's buffered chunks still refer to our audio.
    echoReference = echoNode ? new LocalEchoReference(recorderSession.chunks.audio) : null;
    try {
      recorderSession.setPublisher({ publishChunk: sendChunk });
      recorderSession.startCombined(audioTrack, videoTrack, preparedMimeTypes.recording);
      recorderSession.start('audio', audioTrack, preparedMimeTypes.audio);
      recorderSession.start('video', videoTrack, preparedMimeTypes.video);
      conversationRecorder = new window.RemoteCallConversationRecorder({
        video: ui.video,
        microphoneTrack: audioTrack,
        audioContext: echoContext,
        playbackSource: echoPlayerSource,
        mimeType: preparedMimeTypes.recording,
        chunkMs: CHUNK_MS,
        onUpdate: () => { updateStats(); checkRecordingMemoryLimit(); },
        onLimit: checkRecordingMemoryLimit,
        onError: error => {
          setStatus(`Conversation recorder failed: ${error.message}`, true);
          if (recording) void window.RemoteCallConnection.stopCall();
        }
      }).start();
      elapsedTimer = setInterval(updateElapsed, 250);
      ui.stop.disabled = false;
      setStatus('Recording and sending live audio and video.');
      updateStats();
    } catch (error) {
      await conversationRecorder?.stop();
      await stopRecording();
      throw error;
    }
  }

  function finishConversationIfReady() {
    if (recording || !conversationRecorder || conversationRecorder.finished || conversationStoppingPromise
      || (player && !player.closed && !player.playbackFinished)) return;
    const current = conversationRecorder;
    conversationStoppingPromise = current.stop().then(() => {
      if (conversationRecorder !== current) return;
      updateStats();
      if (current.chunks.length && (!player || !player.closed || player.playbackFinished)
        && !memoryLimitReached) setStatus('Conversation recording is ready to replay or save.');
    }).catch(error => setStatus(`Could not finish conversation recording: ${error.message}`, true));
  }

  function stopRecording() {
    if (stoppingPromise) return stoppingPromise;
    if (!recording) {
      if (mediaStream || preparedMimeTypes) return abortPreparedMedia();
      return Promise.resolve({
        audio: recorderSession?.chunks.audio.length || 0,
        video: recorderSession?.chunks.video.length || 0
      });
    }
    recording = false;
    ui.stop.disabled = true;
    clearInterval(elapsedTimer);
    updateElapsed();
    setStatus('Finishing the audio and video streams…');
    stoppingPromise = (async () => {
      try {
        await recorderSession.stop();
        finished = true;
        finishConversationIfReady();
        ui.cameraCaption.textContent = 'Recording stopped.';
        if (!player || player.closed) ui.caption.textContent = 'Call recording stopped.';
        setStatus('Local recording stopped. Finishing the conversation recording before replay or saving.');
      } catch (error) {
        setStatus(`Could not finish recording: ${error.message}`, true);
      } finally {
        stopVideoCapture();
        mediaStream?.getTracks().forEach(track => track.stop());
        mediaStream = null;
        preparedMimeTypes = null;
        ui.echoCancellationStatus.textContent = 'Microphone released.';
        ui.camera.srcObject = null;
        stoppingPromise = null;
        updateStats();
      }
      return { audio: recorderSession.chunks.audio.length, video: recorderSession.chunks.video.length };
    })();
    updateStats();
    return stoppingPromise;
  }

  async function changeCamera() {
    if (!recording || cameraBusy) return;
    cameraBusy = true;
    ui.stop.disabled = true;
    updateStats();
    let requestedTrack = null;
    try {
      if (!cameraEnabled()) {
        disableCameraTrack();
        updateCameraCaption();
        setStatus('Camera capture stopped. Continuous video recording now contains black frames.');
      } else {
        const cameraStream = await acquireCameraStream(false);
        requestedTrack = requireTrack(cameraStream.getVideoTracks()[0], 'Camera track is unavailable.');
        if (!recording) {
          requestedTrack.stop();
          setCameraEnabled(cameraActive);
          return;
        }
        await enableCameraTrack(requestedTrack);
        if (!recording) {
          disableCameraTrack();
          return;
        }
        mediaStream.addTrack(requestedTrack);
        updateCameraCaption();
        setStatus('Camera capture resumed without restarting the video stream.');
      }
    } catch (error) {
      if (requestedTrack && requestedTrack !== cameraTrack) requestedTrack.stop();
      if (cameraEnabled()) disableCameraTrack();
      setCameraEnabled(cameraActive);
      setStatus(`Could not change camera state: ${error.message}`, true);
    } finally {
      cameraBusy = false;
      ui.stop.disabled = !recording;
      updateStats();
    }
  }

  function toggleCamera() {
    if (busy || cameraBusy || stoppingPromise) return;
    setCameraEnabled(!cameraEnabled());
    void changeCamera();
  }

  function toggleMicMute() {
    if (!recording || busy || stoppingPromise) return;
    setMicMuted(!micMuted);
    updateCameraCaption();
    setStatus(micMuted
      ? 'Microphone muted. Silent audio chunks continue recording.'
      : 'Microphone unmuted. Audio recording continues.');
  }

  function replayRecording() {
    const savedChunks = conversationRecorder?.chunks;
    if (recording || busy || !finished || !callEnded || !remotePlaybackFinished
      || !conversationRecorder?.finished || !savedChunks?.length) return;
    bypassEchoProcessing();
    remoteLink?.close();
    remoteLink = null;
    clearTimeout(remoteFinishTimer);
    remoteFinishTimer = null;
    player?.close();
    player = null;
    releaseLocalReplay();
    ui.video.srcObject = null;
    ui.video.muted = false;
    ui.video.volume = Number(ui.volume.value) / 100;
    localReplayUrl = URL.createObjectURL(new Blob(savedChunks, { type: conversationRecorder.recordingMimeType }));
    localReplayActive = true;
    ui.video.src = localReplayUrl;
    ui.video.load();
    ui.controls.hidden = false;
    ui.caption.textContent = 'Replaying the conversation.';
    ui.diagnostics.textContent = 'Conversation replay includes the other person’s video and both voices.';
    updateReplayControls();
    void ui.video.play().catch(() => {
      if (localReplayActive) ui.caption.textContent = 'Playback needs a click. Press Play below the player.';
    });
  }

  function setPeerMimeTypes(types) {
    if (!['audio', 'video'].every(kind => typeof types?.[kind] === 'string'
      && MediaSource.isTypeSupported(types[kind]))) {
      throw new Error('Peer audio or video format is not supported');
    }
    releaseLocalReplay();
    remoteLink?.close();
    player?.close();
    clearTimeout(remoteFinishTimer);
    remoteFinishTimer = null;
    remoteFinalCounts = null;
    remotePlaybackFinished = false;
    remoteReceived = { audio: new Set(), video: new Set() };
    remoteChunkTimings = { audio: new Map(), video: new Map() };
    ui.video.muted = false;
    ui.video.volume = Number(ui.volume.value) / 100;
    ui.controls.hidden = true;
    ui.caption.textContent = 'Waiting for incoming audio and video chunks…';
    player = new MseReplayPlayer(ui.video, types, finishConversationIfReady);
    remoteLink = new LocalChunkLink(player);
    updateReplayControls();
  }

  function receiveRemoteChunk(kind, order, payload, timing) {
    if (!remoteLink || (kind !== 'audio' && kind !== 'video')) return;
    // Start/end are relative to the sender's recording start. Creation and arrival
    // use epoch milliseconds; their difference also includes any device clock skew.
    const metadata = {
      senderStartTimeMs: timing.senderStartTimeMs,
      senderEndTimeMs: timing.senderEndTimeMs,
      createdAtEpochMs: timing.createdAtEpochMs,
      arrivedAtEpochMs: timing.arrivedAtEpochMs,
      estimatedDeliveryDelayMs: timing.arrivedAtEpochMs - timing.createdAtEpochMs,
      playStart: timing.playStart,
      playEnd: timing.playEnd
    };
    const timings = remoteChunkTimings[kind];
    timings.set(order, metadata);
    if (timings.size > 180) timings.delete(timings.keys().next().value);
    remoteReceived[kind].add(order);
    remoteLink.publishChunk({
      index: order,
      mediaType: kind.toUpperCase(),
      ...metadata,
      binary: new Uint8Array(payload)
    });
    if (kind === 'audio') queueEchoReference(metadata);
    maybeFinishRemote();
  }

  function maybeFinishRemote() {
    if (!remoteFinalCounts || !remoteLink) return false;
    if (remoteReceived.audio.size < remoteFinalCounts.audio
      || remoteReceived.video.size < remoteFinalCounts.video) return false;
    clearTimeout(remoteFinishTimer);
    remoteFinishTimer = null;
    remoteLink.finishTrack('audio');
    remoteLink.finishTrack('video');
    remotePlaybackFinished = true;
    updateStats();
    return true;
  }

  function finishRemote(counts) {
    if (!['audio', 'video'].every(kind => Number.isSafeInteger(counts?.[kind]) && counts[kind] >= 0)) {
      throw new Error('Invalid final chunk counts');
    }
    if (!remoteLink) return;
    remoteFinalCounts = counts;
    if (!maybeFinishRemote() && !remoteFinishTimer) {
      remoteFinishTimer = setTimeout(() => {
        remoteFinishTimer = null;
        remoteLink?.finishTrack('audio');
        remoteLink?.finishTrack('video');
        remotePlaybackFinished = true;
        player?.fail(new Error('Some remote chunks were not received'));
        updateStats();
      }, 30000);
    }
  }

  async function abortPreparedMedia() {
    if (recording) {
      const counts = await stopRecording();
      await conversationRecorder?.stop();
      return counts;
    }
    releaseLocalReplay();
    stopVideoCapture();
    mediaStream?.getTracks().forEach(track => track.stop());
    mediaStream = null;
    preparedMimeTypes = null;
    ui.echoCancellationStatus.textContent = 'Microphone released.';
    ui.camera.srcObject = null;
    remoteLink?.close();
    remoteLink = null;
    player?.close();
    player = null;
    clearTimeout(remoteFinishTimer);
    remoteFinishTimer = null;
    updateStats();
    return { audio: recorderSession?.chunks.audio.length || 0, video: recorderSession?.chunks.video.length || 0 };
  }

  window.RemoteCallMedia = {
    prepare: prepareRecording,
    start: startRecording,
    stop: stopRecording,
    setPeerMimeTypes,
    receiveChunk: receiveRemoteChunk,
    getReceivedChunkTiming: (kind, order) => remoteChunkTimings[kind]?.get(order) || null,
    finishRemote,
    markCallEnded: () => {
      callEnded = true;
      updateStats();
    },
    abort: abortPreparedMedia
  };

  async function saveRecording() {
    const savedChunks = conversationRecorder?.chunks;
    if (busy || !finished || !callEnded || recordingSaved
      || !conversationRecorder?.finished || !savedChunks?.length) return;
    const fileName = `${baseName}-conversation.webm`;
    busy = true;
    updateStats();
    try {
      const handle = window.showSaveFilePicker
        ? await window.showSaveFilePicker({
            suggestedName: fileName,
            types: [{ description: 'Audio and video recording', accept: { 'video/webm': ['.webm'] } }]
          })
        : null;
      const blob = new Blob(savedChunks, { type: conversationRecorder.recordingMimeType });
      if (handle) {
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
      } else downloadFallback(blob, fileName);
      recordingSaved = true;
      ui.save.textContent = 'Conversation saved';
      setStatus('Conversation video and both voices saved.');
    } catch (error) {
      setStatus(error.name === 'AbortError' ? 'Recording save canceled.'
        : `Could not save recording: ${error.message}`, error.name !== 'AbortError');
    } finally {
      busy = false;
      updateStats();
    }
  }

  ui.stop.addEventListener('click', () => { void window.RemoteCallConnection.stopCall(); });
  ui.cameraEnabled.addEventListener('click', toggleCamera);
  ui.muteMic.addEventListener('click', toggleMicMute);
  ui.replay.addEventListener('click', replayRecording);
  ui.save.addEventListener('click', saveRecording);
  ui.pause.addEventListener('click', () => {
    if (!localReplayActive) return;
    if (ui.video.paused) {
      void ui.video.play().catch(() => setStatus('Could not resume replay.', true));
    } else ui.video.pause();
  });
  ui.mute.addEventListener('click', () => {
    if (!localReplayActive) return;
    ui.video.muted = !ui.video.muted;
    updateReplayControls();
  });
  ui.volume.addEventListener('input', () => {
    ui.video.volume = Number(ui.volume.value) / 100;
    if (ui.video.volume > 0 && localReplayActive) ui.video.muted = false;
    updateReplayControls();
  });
  ui.video.addEventListener('play', updateReplayControls);
  window.addEventListener('pointerdown', () => {
    if (echoContext?.state === 'suspended') void echoContext.resume().catch(() => {});
  }, { capture: true });
  ui.video.addEventListener('pause', updateReplayControls);
  ui.video.addEventListener('ended', () => {
    if (localReplayActive) {
      localReplayActive = false;
      ui.controls.hidden = true;
      ui.caption.textContent = 'Playback finished.';
    } else player?.finishPlayback();
  });
  ui.video.addEventListener('error', () => {
    if (localReplayActive) {
      localReplayActive = false;
      ui.controls.hidden = true;
      ui.caption.textContent = 'This browser could not replay the local recording.';
      setStatus(`Could not replay local recording: ${ui.video.error?.message || 'Media element error'}`, true);
    } else if (player && !player.closed) player.fail(new Error(ui.video.error?.message || 'Media element error'));
  });
  window.addEventListener('pagehide', () => {
    recording = false;
    clearInterval(elapsedTimer);
    recorderSession?.stopImmediately();
    void conversationRecorder?.stop();
    releaseLocalReplay();
    remoteLink?.close();
    clearTimeout(remoteFinishTimer);
    stopVideoCapture();
    clearInterval(echoClockTimer);
    if (echoContext) void echoContext.close().catch(() => {});
    mediaStream?.getTracks().forEach(track => track.stop());
    player?.close();
  });
})();
