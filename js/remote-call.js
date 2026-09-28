(() => {
  'use strict';

  const chunkSecondsParam = new URLSearchParams(window.location.search).get('chunkSeconds');
  const requestedChunkSeconds = chunkSecondsParam === null ? NaN : Number(chunkSecondsParam);
  const CHUNK_MS = Number.isFinite(requestedChunkSeconds)
    && requestedChunkSeconds >= 0.1 && requestedChunkSeconds <= 60
    ? Math.round(requestedChunkSeconds * 1000) : 1000;
  const WINDOW_MS = CHUNK_MS;
  const INITIAL_COMMON_BUFFER_SECONDS = 0.5;
  const ECHO_START_MS = 12000;
  const ECHO_END_MS = 5000;
  const MAX_RECORDING_BYTES = 512 * 1048576;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  const ui = {
    camera: document.getElementById('liveVideo'),
    video: document.getElementById('replayVideo'),
    cameraCaption: document.getElementById('cameraCaption'),
    echoCancellationStatus: document.getElementById('echoCancellationStatus'),
    cameraEnabled: document.getElementById('cameraEnabled'),
    muteMic: document.getElementById('muteMicButton'),
    caption: document.getElementById('playerCaption'),
    stop: document.getElementById('stopButton'),
    saveMic: document.getElementById('saveRecentMicButton'),
    replay: document.getElementById('replayButton'),
    controls: document.getElementById('replayControls'),
    pause: document.getElementById('pauseReplayButton'),
    mute: document.getElementById('muteReplayButton'),
    volume: document.getElementById('replayVolume'),
    save: document.getElementById('saveButton'),
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
  let audioContext = null;
  let audioProcessor = null;
  let audioSource = null;
  let silentOutput = null;
  let micMuted = false;
  let startedAt = 0;
  let elapsedTimer = null;
  let recording = false;
  let finished = false;
  let busy = false;
  let stoppingPromise = null;
  let micSaving = false;
  let saveStage = 'video';
  let baseName = '';
  let player = null;
  let recorderSession = null;
  let localLink = null;
  let remoteLink = null;
  let remoteReceived = { audio: new Set(), video: new Set() };
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
  const pcmFrames = [];
  let pcmSampleRate = 0;

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
    updateMicButton();
  }

  function updateStats() {
    const chunks = recorderSession?.chunks;
    ui.count.textContent = `${chunks?.audio.length || 0} / ${chunks?.video.length || 0}`;
    ui.size.textContent = `${((recorderSession?.storedBytes || 0) / 1048576).toFixed(1)} MB`;
    ui.cameraEnabled.disabled = busy || cameraBusy || !!stoppingPromise || (!!preparedMimeTypes && !recording);
    ui.muteMic.disabled = !recording || busy || !!stoppingPromise;
    ui.replay.disabled = busy || recording || !finished || !remotePlaybackFinished
      || !chunks?.audio.length || !chunks?.video.length;
    ui.save.disabled = busy || !finished || saveStage === 'done' || !chunks?.[saveStage]?.length;
    updateMicButton();
  }

  function pickMime(kind) {
    const candidates = kind === 'audio'
      ? ['audio/webm;codecs=opus']
      : ['video/webm;codecs=vp9', 'video/webm;codecs=vp8'];
    return candidates.find(type => MediaRecorder.isTypeSupported(type) && MediaSource.isTypeSupported(type));
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
    constructor({ clock, onUpdate, onLimit, onError }) {
      this.clock = clock;
      this.onUpdate = onUpdate;
      this.onLimit = onLimit;
      this.onError = onError;
      this.publisher = null;
      this.recorders = { audio: null, video: null };
      this.chunks = { audio: [], video: [] };
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
      const index = this.nextSequence[kind]++;
      const endTime = Math.max(this.lastEndMs[kind] + 1, this.clock());
      const startTime = this.lastEndMs[kind];
      this.lastEndMs[kind] = endTime;
      const blob = event.data;
      this.conversionTail[kind] = this.conversionTail[kind].then(async () => {
        const binary = new Uint8Array(await blob.arrayBuffer());
        const chunk = {
          index,
          mediaType: kind.toUpperCase(),
          mimeType: this.mimeTypes[kind],
          startTime,
          endTime,
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
      recorder.start(CHUNK_MS);
      this.recorders[kind] = { recorder, stopped };
      this.mimeTypes[kind] = recorder.mimeType || mimeType;
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

  async function startPcmCapture(track) {
    if (!AudioContextClass) return;
    audioContext = new AudioContextClass();
    pcmSampleRate = audioContext.sampleRate;
    audioSource = audioContext.createMediaStreamSource(new MediaStream([track]));
    audioProcessor = audioContext.createScriptProcessor(4096, 1, 1);
    silentOutput = audioContext.createGain();
    silentOutput.gain.value = 0;
    audioProcessor.onaudioprocess = event => {
      if (!recording) return;
      const samples = new Float32Array(event.inputBuffer.getChannelData(0));
      const endTime = relativeMs();
      const startTime = endTime - samples.length * 1000 / pcmSampleRate;
      pcmFrames.push({ startTime, endTime, samples });
      const oldest = endTime - 14000;
      while (pcmFrames.length && pcmFrames[0].endTime < oldest) pcmFrames.shift();
    };
    audioSource.connect(audioProcessor);
    audioProcessor.connect(silentOutput);
    silentOutput.connect(audioContext.destination);
    await audioContext.resume();
  }

  async function stopPcmCapture() {
    if (!audioContext) return;
    audioProcessor.onaudioprocess = null;
    audioSource.disconnect();
    audioProcessor.disconnect();
    silentOutput.disconnect();
    const context = audioContext;
    audioContext = audioProcessor = audioSource = silentOutput = null;
    await context.close();
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

  function micRange() {
    const now = relativeMs();
    return { startTime: now - ECHO_START_MS, endTime: now - ECHO_END_MS };
  }

  function coversRange(range, frames) {
    if (!frames.length || range.startTime < 0) return false;
    let until = range.startTime;
    for (const frame of frames) {
      if (frame.endTime <= until) continue;
      if (frame.startTime > until + 120) return false;
      until = Math.max(until, frame.endTime);
      if (until >= range.endTime) return true;
    }
    return false;
  }

  function updateMicButton() {
    const range = startedAt ? micRange() : { startTime: -1, endTime: -1 };
    ui.saveMic.disabled = !recording || busy || micSaving || !pcmSampleRate || !coversRange(range, pcmFrames);
  }

  function encodeWav(samples, sampleRate) {
    const bytes = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(bytes);
    const writeText = (offset, value) => {
      for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
    };
    writeText(0, 'RIFF');
    view.setUint32(4, bytes.byteLength - 8, true);
    writeText(8, 'WAVE');
    writeText(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeText(36, 'data');
    view.setUint32(40, samples.length * 2, true);
    for (let i = 0; i < samples.length; i++) {
      const sample = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(44 + 2 * i, sample < 0 ? sample * 32768 : sample * 32767, true);
    }
    return new Blob([bytes], { type: 'audio/wav' });
  }

  function makeMicClip(range, frames) {
    const samples = new Float32Array(Math.round((range.endTime - range.startTime) * pcmSampleRate / 1000));
    for (const frame of frames) {
      const from = Math.max(range.startTime, frame.startTime);
      const to = Math.min(range.endTime, frame.endTime);
      if (to <= from) continue;
      const output = Math.max(0, Math.round((from - range.startTime) * pcmSampleRate / 1000));
      const input = Math.max(0, Math.round((from - frame.startTime) * pcmSampleRate / 1000));
      const count = Math.min(Math.round((to - from) * pcmSampleRate / 1000), frame.samples.length - input, samples.length - output);
      if (count > 0) samples.set(frame.samples.subarray(input, input + count), output);
    }
    return encodeWav(samples, pcmSampleRate);
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

  async function saveRecentMic() {
    if (!recording || micSaving || !pcmSampleRate) return;
    const range = micRange();
    const frames = pcmFrames.filter(frame => frame.endTime > range.startTime && frame.startTime < range.endTime);
    if (!coversRange(range, frames)) return;
    const fileName = `${baseName}-mic-${Math.round(range.startTime)}-${Math.round(range.endTime)}.wav`;
    micSaving = true;
    updateMicButton();
    try {
      const handlePromise = window.showSaveFilePicker
        ? window.showSaveFilePicker({
            suggestedName: fileName,
            types: [{ description: 'Microphone audio snippet', accept: { 'audio/wav': ['.wav'] } }]
          })
        : Promise.resolve(null);
      const [handle, blob] = await Promise.all([handlePromise, Promise.resolve().then(() => makeMicClip(range, frames))]);
      if (handle) {
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
      } else downloadFallback(blob, fileName);
      setStatus(`Saved microphone audio from ${(range.startTime / 1000).toFixed(1)}s to ${(range.endTime / 1000).toFixed(1)}s.`);
    } catch (error) {
      setStatus(error.name === 'AbortError' ? 'Microphone snippet save canceled.' : `Could not save microphone snippet: ${error.message}`, error.name !== 'AbortError');
    } finally {
      micSaving = false;
      updateMicButton();
    }
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
    constructor(video, types) {
      this.video = video;
      this.types = types;
      this.inbox = {
        audio: { next: 0, pending: new Map(), bytes: 0, finished: false },
        video: { next: 0, pending: new Map(), bytes: 0, finished: false }
      };
      this.mediaSource = new MediaSource();
      this.url = URL.createObjectURL(this.mediaSource);
      this.queues = null;
      this.started = false;
      this.syncHold = true;
      this.userPaused = false;
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
        })) break;
        inbox.next++;
      }
    }

    finishTrack(kind) {
      if (!this.inbox[kind]) throw new Error('Invalid media stream');
      this.inbox[kind].finished = true;
      this.progress();
    }

    progress() {
      if (this.closed || !this.queues) return;
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
      if (this.started && !(fullyAppended && !this.syncHold
        && this.video.currentTime >= sharedEnd - 0.03)) {
        const minimumAhead = fullyAppended
          ? Math.min(0.15, Math.max(0.02, sharedEnd - this.video.currentTime - 0.01)) : 0.15;
        const ready = hasCommonBufferAt(audio, video, this.video.currentTime, minimumAhead)
          && this.video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
          && !this.video.seeking;
        if (!ready) {
          this.syncHold = true;
          this.video.pause();
          ui.caption.textContent = 'Waiting for synchronized audio and video.';
        } else if (this.syncHold) {
          this.syncHold = false;
          ui.caption.textContent = 'Playing synchronized audio and video.';
          if (!this.userPaused) this.video.play().catch(() => {
            ui.caption.textContent = 'Playback needs a click. Press Play below the player.';
          });
        }
        updateReplayControls();
      }
      if (this.mediaSource.readyState === 'open' && fullyAppended) {
        if (!this.started) {
          this.fail(new Error('Audio and video MSE timelines have no overlapping buffered range'));
          return;
        }
        try {
          this.mediaSource.endOfStream();
        } catch (error) { this.fail(error); }
      }
    }

    togglePause() {
      if (!this.userPaused && !this.video.paused) {
        this.userPaused = true;
        this.video.pause();
      } else {
        this.userPaused = false;
        if (!this.syncHold) this.video.play().catch(() => setStatus('Could not resume replay.', true));
      }
      updateReplayControls();
    }

    fail(error) {
      if (this.closed) return;
      setStatus(`MSE replay failed: ${error.message}`, true);
      ui.caption.textContent = 'This browser could not replay the separate audio and video streams.';
      this.close();
    }

    close() {
      if (this.closed) return;
      this.closed = true;
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
    ui.pause.textContent = player?.syncHold ? 'Buffering…' : ui.video.paused ? 'Play' : 'Pause';
    ui.pause.disabled = !!player?.syncHold;
    ui.mute.textContent = ui.video.muted ? 'Unmute audio' : 'Mute audio';
    ui.mute.setAttribute('aria-pressed', String(ui.video.muted));
  }

  function resetRecording() {
    localLink?.close();
    localLink = null;
    remoteLink?.close();
    remoteLink = null;
    clearTimeout(remoteFinishTimer);
    remoteFinishTimer = null;
    remoteFinalCounts = null;
    remotePlaybackFinished = false;
    remoteReceived = { audio: new Set(), video: new Set() };
    player?.close();
    player = null;
    stopVideoCapture();
    cameraBusy = false;
    preparedMimeTypes = null;
    recorderSession = new CallRecorder({
      clock: relativeMs,
      onUpdate: updateStats,
      onLimit: () => {
        if (!recording) return;
        setStatus('Recording reached the 512 MB in-memory limit. Finishing…');
        void window.RemoteCallConnection.stopCall();
      },
      onError: (kind, error) => {
        setStatus(`${kind} recorder failed: ${error.message}`, true);
        if (recording) void window.RemoteCallConnection.stopCall();
      }
    });
    pcmFrames.length = 0;
    pcmSampleRate = 0;
    setMicMuted(false);
    finished = false;
    saveStage = 'video';
    ui.save.textContent = 'Save video file';
    ui.controls.hidden = true;
    ui.cameraCaption.textContent = 'Live preview appears here when recording starts.';
    ui.echoCancellationStatus.textContent = 'Echo cancellation will be checked when the microphone opens.';
    ui.caption.textContent = 'Incoming audio and video appear here during the call.';
    ui.diagnostics.textContent = 'Audio and video buffer diagnostics appear during replay.';
    updateStats();
  }

  async function acquireMediaStream() {
    const audio = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
    if (!cameraEnabled()) return navigator.mediaDevices.getUserMedia({ audio, video: false });
    return navigator.mediaDevices.getUserMedia({
      audio,
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } }
    }).catch(async () => {
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

  async function prepareRecording() {
    if (preparedMimeTypes) return preparedMimeTypes;
    if (busy || recording || stoppingPromise) throw new Error('Media is busy');
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder || !window.MediaSource
      || !HTMLCanvasElement.prototype.captureStream) {
      throw new Error('MediaRecorder, MediaSource and canvas capture are required. Use HTTPS or localhost in a Chromium browser.');
    }
    const audioMime = pickMime('audio');
    const videoMime = pickMime('video');
    if (!audioMime || !videoMime) {
      throw new Error('This browser has no audio and video WebM formats supported by both MediaRecorder and MediaSource.');
    }
    busy = true;
    setStatus(cameraEnabled()
      ? 'Requesting camera and microphone access…' : 'Requesting microphone access…');
    try {
      resetRecording();
      mediaStream = await acquireMediaStream();
      await configureEchoCancellation(requireTrack(mediaStream.getAudioTracks()[0],
        'The required microphone or camera track is unavailable.'));
      const initialCameraTrack = mediaStream.getVideoTracks()[0];
      if (cameraEnabled()) requireTrack(initialCameraTrack,
        'The required microphone or camera track is unavailable.');
      startVideoCapture();
      if (initialCameraTrack) await enableCameraTrack(initialCameraTrack);
      updateCameraCaption();
      baseName = `recording-${new Date().toISOString().replace(/[:.]/g, '-')}`;
      preparedMimeTypes = { audio: audioMime, video: videoMime };
      setStatus(cameraActive ? 'Camera and microphone are ready for the call.'
        : 'Microphone is ready. Black video will be sent.');
      return preparedMimeTypes;
    } catch (error) {
      stopVideoCapture();
      mediaStream?.getTracks().forEach(track => track.stop());
      mediaStream = null;
      ui.camera.srcObject = null;
      ui.cameraCaption.textContent = 'Camera preview unavailable.';
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
    startedAt = performance.now();
    recording = true;
    try {
      recorderSession.setPublisher({ publishChunk: sendChunk });
      recorderSession.start('audio', audioTrack, preparedMimeTypes.audio);
      recorderSession.start('video', videoTrack, preparedMimeTypes.video);
      void startPcmCapture(audioTrack).catch(error => console.warn('Microphone clip capture is unavailable:', error));
      elapsedTimer = setInterval(updateElapsed, 250);
      ui.stop.disabled = false;
      setStatus('Recording and sending live audio and video.');
      updateStats();
    } catch (error) {
      await stopRecording();
      throw error;
    }
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
        await stopPcmCapture();
        pcmFrames.length = 0;
        finished = true;
        ui.cameraCaption.textContent = 'Recording stopped.';
        if (!player || player.closed) ui.caption.textContent = 'Call recording stopped.';
        setStatus(`Recording stopped. Stored ${recorderSession.chunks.audio.length} audio and ${recorderSession.chunks.video.length} video chunks.`);
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
        const cameraStream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } }
        });
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
    const savedChunks = recorderSession?.chunks;
    if (recording || busy || !finished || !savedChunks?.audio.length || !savedChunks?.video.length) return;
    localLink?.close();
    remoteLink?.close();
    remoteLink = null;
    clearTimeout(remoteFinishTimer);
    remoteFinishTimer = null;
    player?.close();
    ui.video.srcObject = null;
    ui.video.muted = false;
    ui.video.volume = Number(ui.volume.value) / 100;
    ui.controls.hidden = false;
    ui.caption.textContent = 'Preparing separate audio and video buffers…';
    player = new MseReplayPlayer(ui.video, recorderSession.mimeTypes);
    localLink = new LocalChunkLink(player);
    recorderSession.setPublisher(localLink);
    for (const kind of ['audio', 'video']) {
      for (const chunk of savedChunks[kind]) recorderSession.publishChunk(chunk);
      localLink.finishTrack(kind);
    }
    updateReplayControls();
  }

  function setPeerMimeTypes(types) {
    if (!['audio', 'video'].every(kind => typeof types?.[kind] === 'string'
      && MediaSource.isTypeSupported(types[kind]))) {
      throw new Error('Peer audio or video format is not supported');
    }
    remoteLink?.close();
    player?.close();
    clearTimeout(remoteFinishTimer);
    remoteFinishTimer = null;
    remoteFinalCounts = null;
    remotePlaybackFinished = false;
    remoteReceived = { audio: new Set(), video: new Set() };
    ui.video.muted = false;
    ui.video.volume = Number(ui.volume.value) / 100;
    ui.controls.hidden = false;
    ui.caption.textContent = 'Waiting for incoming audio and video chunks…';
    player = new MseReplayPlayer(ui.video, types);
    remoteLink = new LocalChunkLink(player);
    updateReplayControls();
  }

  function receiveRemoteChunk(kind, order, payload) {
    if (!remoteLink || (kind !== 'audio' && kind !== 'video')) return;
    remoteReceived[kind].add(order);
    remoteLink.publishChunk({
      index: order,
      mediaType: kind.toUpperCase(),
      binary: new Uint8Array(payload)
    });
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
        updateStats();
      }, 30000);
    }
  }

  async function abortPreparedMedia() {
    if (recording) return stopRecording();
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
    await stopPcmCapture();
    updateStats();
    return { audio: recorderSession?.chunks.audio.length || 0, video: recorderSession?.chunks.video.length || 0 };
  }

  window.RemoteCallMedia = {
    prepare: prepareRecording,
    start: startRecording,
    stop: stopRecording,
    setPeerMimeTypes,
    receiveChunk: receiveRemoteChunk,
    finishRemote,
    abort: abortPreparedMedia
  };

  async function saveCurrentTrack() {
    const savedChunks = recorderSession?.chunks;
    if (busy || !finished || saveStage === 'done' || !savedChunks?.[saveStage]?.length) return;
    const kind = saveStage;
    const fileName = `${baseName}-${kind}.webm`;
    busy = true;
    updateStats();
    try {
      const handle = window.showSaveFilePicker
        ? await window.showSaveFilePicker({
            suggestedName: fileName,
            types: [{ description: `${kind} recording`, accept: { [`${kind}/webm`]: ['.webm'] } }]
          })
        : null;
      const blob = new Blob(savedChunks[kind].map(chunk => chunk.binary),
        { type: recorderSession.mimeTypes[kind] });
      if (handle) {
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
      } else downloadFallback(blob, fileName);
      if (kind === 'video') {
        saveStage = 'audio';
        ui.save.textContent = 'Save audio file';
        setStatus('Video saved. Click Save audio file to save the microphone stream.');
      } else {
        saveStage = 'done';
        ui.save.textContent = 'Both files saved';
        setStatus('Video and audio files saved.');
      }
    } catch (error) {
      setStatus(error.name === 'AbortError' ? `${kind} save canceled.` : `Could not save ${kind}: ${error.message}`, error.name !== 'AbortError');
    } finally {
      busy = false;
      updateStats();
    }
  }

  ui.stop.addEventListener('click', () => { void window.RemoteCallConnection.stopCall(); });
  ui.cameraEnabled.addEventListener('click', toggleCamera);
  ui.muteMic.addEventListener('click', toggleMicMute);
  ui.saveMic.addEventListener('click', saveRecentMic);
  ui.replay.addEventListener('click', replayRecording);
  ui.save.addEventListener('click', saveCurrentTrack);
  ui.pause.addEventListener('click', () => {
    if (!player || player.closed) return;
    player.togglePause();
  });
  ui.mute.addEventListener('click', () => {
    if (!player || player.closed) return;
    ui.video.muted = !ui.video.muted;
    updateReplayControls();
  });
  ui.volume.addEventListener('input', () => {
    ui.video.volume = Number(ui.volume.value) / 100;
    if (ui.video.volume > 0 && player && !player.closed) ui.video.muted = false;
    updateReplayControls();
  });
  ui.video.addEventListener('play', updateReplayControls);
  ui.video.addEventListener('pause', updateReplayControls);
  ui.video.addEventListener('ended', () => {
    if (player && !player.closed) ui.caption.textContent = 'Playback finished.';
  });
  ui.video.addEventListener('error', () => {
    if (player && !player.closed) player.fail(new Error(ui.video.error?.message || 'Media element error'));
  });
  window.addEventListener('pagehide', () => {
    recording = false;
    clearInterval(elapsedTimer);
    recorderSession?.stopImmediately();
    localLink?.close();
    remoteLink?.close();
    clearTimeout(remoteFinishTimer);
    stopVideoCapture();
    mediaStream?.getTracks().forEach(track => track.stop());
    player?.close();
    if (audioContext) void stopPcmCapture();
  });
})();
