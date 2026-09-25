(() => {
  'use strict';

  const chunkSecondsParam = new URLSearchParams(window.location.search).get('chunkSeconds');
  const requestedChunkSeconds = chunkSecondsParam === null ? NaN : Number(chunkSecondsParam);
  const CHUNK_MS = Number.isFinite(requestedChunkSeconds)
    && requestedChunkSeconds >= 0.1 && requestedChunkSeconds <= 60
    ? Math.round(requestedChunkSeconds * 1000) : 1000;
  const WINDOW_MS = CHUNK_MS;
  const INITIAL_COMMON_BUFFER_SECONDS = 0.5;
  const REPLAY_DELAY_MS = 5000;
  const ECHO_START_MS = 12000;
  const ECHO_END_MS = 5000;
  const MAX_RECORDING_BYTES = 512 * 1048576;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  const ui = {
    camera: document.getElementById('liveVideo'),
    video: document.getElementById('replayVideo'),
    cameraCaption: document.getElementById('cameraCaption'),
    cameraEnabled: document.getElementById('cameraEnabled'),
    caption: document.getElementById('playerCaption'),
    start: document.getElementById('startButton'),
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
  let startedAt = 0;
  let elapsedTimer = null;
  let recording = false;
  let finished = false;
  let busy = false;
  let stoppingPromise = null;
  let micSaving = false;
  let saveStage = 'video';
  let baseName = '';
  let storedBytes = 0;
  let player = null;
  let cameraTrack = null;
  let cameraActive = false;
  let cameraBusy = false;
  let cameraInput = null;
  let canvas = null;
  let canvasContext = null;
  let canvasStream = null;
  let drawTimer = null;
  const recorders = { audio: null, video: null };
  const chunks = { audio: [], video: [] };
  const mimeTypes = { audio: '', video: '' };
  const lastEndMs = { audio: 0, video: 0 };
  const nextSequence = { audio: 0, video: 0 };
  const conversionTail = { audio: Promise.resolve(), video: Promise.resolve() };
  const mediaWindows = new Map();
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
    ui.count.textContent = `${chunks.audio.length} / ${chunks.video.length}`;
    ui.size.textContent = `${(storedBytes / 1048576).toFixed(1)} MB`;
    ui.cameraEnabled.disabled = busy || cameraBusy || !!stoppingPromise;
    ui.replay.disabled = busy || recording || !finished || !chunks.audio.length || !chunks.video.length;
    ui.save.disabled = busy || !finished || saveStage === 'done' || !chunks[saveStage]?.length;
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

  function addToWindow(chunk) {
    const index = Math.floor(chunk.startTime / WINDOW_MS);
    let window = mediaWindows.get(index);
    if (!window) {
      window = {
        index,
        startTime: index * WINDOW_MS,
        endTime: (index + 1) * WINDOW_MS,
        duration: WINDOW_MS,
        audio: null,
        video: null
      };
      mediaWindows.set(index, window);
    }
    const kind = chunk.mediaType.toLowerCase();
    if (!window[kind]) window[kind] = chunk;
    else {
      // MediaRecorder timeslices are approximate. Retain extra chunks without changing their timestamps.
      (window.extra ||= { audio: [], video: [] })[kind].push(chunk);
    }
    const oldestAllowed = index - 30;
    for (const key of mediaWindows.keys()) {
      if (key < oldestAllowed) mediaWindows.delete(key);
    }
  }

  function onRecorderData(kind, event) {
    if (!event.data?.size) return;
    const index = nextSequence[kind]++;
    const endTime = Math.max(lastEndMs[kind] + 1, relativeMs());
    const startTime = lastEndMs[kind];
    lastEndMs[kind] = endTime;
    const blob = event.data;
    conversionTail[kind] = conversionTail[kind].then(async () => {
      const binary = new Uint8Array(await blob.arrayBuffer());
      const chunk = {
        index,
        mediaType: kind.toUpperCase(),
        startTime,
        endTime,
        duration: endTime - startTime,
        binary
      };
      chunks[kind].push(chunk);
      addToWindow(chunk);
      storedBytes += binary.byteLength;
      updateStats();
      if (recording && storedBytes >= MAX_RECORDING_BYTES) {
        setStatus('Recording reached the 512 MB in-memory limit. Finishing…');
        void stopRecording();
      }
    }).catch(error => {
      setStatus(`Could not store ${kind} chunk: ${error.message}`, true);
      if (recording) void stopRecording();
    });
  }

  function startRecorder(kind, track, mimeType) {
    const recorder = new MediaRecorder(new MediaStream([track]), {
      mimeType,
      ...(kind === 'audio' ? { audioBitsPerSecond: 64000 } : { videoBitsPerSecond: 1500000 })
    });
    let resolveStopped;
    const stopped = new Promise(resolve => { resolveStopped = resolve; });
    recorder.addEventListener('dataavailable', event => onRecorderData(kind, event));
    recorder.addEventListener('error', event => {
      setStatus(`${kind} recorder failed: ${event.error?.message || 'unknown error'}`, true);
      if (recording) void stopRecording();
    });
    recorder.addEventListener('stop', resolveStopped, { once: true });
    recorder.start(CHUNK_MS);
    recorders[kind] = { recorder, stopped };
    mimeTypes[kind] = recorder.mimeType || mimeType;
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
        if (this.currentOperation?.type === 'append') this.queuedBytes -= this.currentOperation.bytes.byteLength;
        if (this.currentOperation?.type === 'remove') this.trimQueued = false;
        this.currentOperation = null;
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

    enqueue(bytes) {
      if (this.closed || this.queuedBytes + bytes.byteLength > this.maxQueuedBytes) return false;
      this.fragments.push(bytes);
      this.queuedBytes += bytes.byteLength;
      return true;
    }

    fill() {
      if (this.closed) return;
      const ahead = this.bufferedEnd() - this.video.currentTime;
      if (ahead < 12 && this.operations.length < 4 && this.fragments.length) {
        this.operations.push({ type: 'append', bytes: this.fragments.shift() });
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
    constructor(video, fragments, types, { live = false, playAfter = 0 } = {}) {
      this.video = video;
      this.localFragments = fragments;
      this.localIndex = { audio: 0, video: 0 };
      this.types = types;
      this.live = live;
      this.playAfter = playAfter;
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
      this.durationClamped = false;
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
        if (!queue.enqueue(chunk.binary)) break;
        inbox.pending.delete(inbox.next++);
        inbox.bytes -= chunk.binary.byteLength;
      }
    }

    finishTrack(kind) {
      if (!this.inbox[kind]) throw new Error('Invalid media stream');
      this.inbox[kind].finished = true;
      this.progress();
    }

    finishLive() {
      this.live = false;
      this.progress();
    }

    feedLocalChunks() {
      if (!this.localFragments) return;
      for (const kind of ['audio', 'video']) {
        const source = this.localFragments[kind];
        const queue = this.queues[kind];
        let supplied = 0;
        while (this.localIndex[kind] < source.length && supplied < 4
          && queue.bufferedEnd() - this.video.currentTime < 12
          && queue.queuedBytes < queue.maxQueuedBytes / 2) {
          if (!this.ingestChunk(source[this.localIndex[kind]])) break;
          this.localIndex[kind]++;
          supplied++;
        }
        if (!this.live && this.localIndex[kind] === source.length) this.inbox[kind].finished = true;
      }
    }

    progress() {
      if (this.closed || !this.queues) return;
      this.feedLocalChunks();
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
      const waitingForDelay = !this.started && performance.now() < this.playAfter;
      const initialRange = !this.started && !waitingForDelay && findCommonBufferedRange(audio, video,
        fullyAppended ? 0.05 : INITIAL_COMMON_BUFFER_SECONDS);
      ui.diagnostics.textContent = `MSE · audio ${formatRanges(audio)} · video ${formatRanges(video)} · playhead ${this.video.currentTime.toFixed(2)}s · buffered end gap ${Math.abs(audioEnd - videoEnd).toFixed(2)}s${this.syncHold ? ' · waiting for both streams' : ''}`;
      if (waitingForDelay) {
        ui.caption.textContent = `Delayed replay starts in ${Math.ceil((this.playAfter - performance.now()) / 1000)}s.`;
      }
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
      if (this.mediaSource.readyState === 'open' && fullyAppended && !waitingForDelay) {
        if (!this.started) {
          this.fail(new Error('Audio and video MSE timelines have no overlapping buffered range'));
          return;
        }
        try {
          if (!this.durationClamped && sharedEnd > 0 && this.mediaSource.duration > sharedEnd) {
            this.durationClamped = true;
            this.mediaSource.duration = sharedEnd;
            if (!this.queues.audio.idle() || !this.queues.video.idle()) return;
          }
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
    player?.close();
    player = null;
    stopVideoCapture();
    cameraBusy = false;
    for (const kind of ['audio', 'video']) {
      chunks[kind].length = 0;
      recorders[kind] = null;
      mimeTypes[kind] = '';
      lastEndMs[kind] = 0;
      nextSequence[kind] = 0;
      conversionTail[kind] = Promise.resolve();
    }
    mediaWindows.clear();
    pcmFrames.length = 0;
    pcmSampleRate = 0;
    storedBytes = 0;
    finished = false;
    saveStage = 'video';
    ui.save.textContent = 'Save video file';
    ui.controls.hidden = true;
    ui.cameraCaption.textContent = 'Live preview appears here when recording starts.';
    ui.caption.textContent = 'Replay begins five seconds after recording starts.';
    ui.diagnostics.textContent = 'Audio and video buffer diagnostics appear during replay.';
    updateStats();
  }

  async function startRecording() {
    if (busy || recording || stoppingPromise) return;
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder || !window.MediaSource
      || !HTMLCanvasElement.prototype.captureStream) {
      setStatus('MediaRecorder, MediaSource and canvas capture are required. Use HTTPS or localhost in a Chromium browser.', true);
      return;
    }
    const audioMime = pickMime('audio');
    const videoMime = pickMime('video');
    if (!audioMime || !videoMime) {
      setStatus('This browser has no audio and video WebM formats supported by both MediaRecorder and MediaSource.', true);
      return;
    }
    busy = true;
    ui.start.disabled = true;
    setStatus(ui.cameraEnabled.checked
      ? 'Requesting camera and microphone access…' : 'Requesting microphone access…');
    try {
      resetRecording();
      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: ui.cameraEnabled.checked
          ? { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } }
          : false
      });
      const audioTrack = requireTrack(mediaStream.getAudioTracks()[0],
        'The required microphone or camera track is unavailable.');
      const initialCameraTrack = mediaStream.getVideoTracks()[0];
      if (ui.cameraEnabled.checked) requireTrack(initialCameraTrack,
        'The required microphone or camera track is unavailable.');
      await startPcmCapture(audioTrack);
      startVideoCapture();
      if (initialCameraTrack) await enableCameraTrack(initialCameraTrack);
      ui.cameraCaption.textContent = cameraActive
        ? 'Live camera preview, with audio muted to prevent feedback.'
        : 'Camera off. Black video frames and microphone audio are recording.';
      baseName = `recording-${new Date().toISOString().replace(/[:.]/g, '-')}`;
      startedAt = performance.now();
      recording = true;
      startRecorder('audio', audioTrack, audioMime);
      startRecorder('video', canvasStream.getVideoTracks()[0], videoMime);
      ui.video.muted = false;
      ui.video.volume = Number(ui.volume.value) / 100;
      ui.controls.hidden = false;
      player = new MseReplayPlayer(ui.video, chunks, mimeTypes,
        { live: true, playAfter: startedAt + REPLAY_DELAY_MS });
      updateReplayControls();
      elapsedTimer = setInterval(updateElapsed, 250);
      ui.stop.disabled = false;
      setStatus('Recording continuous audio and video streams. Delayed replay begins in five seconds.');
    } catch (error) {
      recording = false;
      await stopRecorders();
      await stopPcmCapture();
      player?.close();
      player = null;
      stopVideoCapture();
      mediaStream?.getTracks().forEach(track => track.stop());
      mediaStream = null;
      ui.camera.srcObject = null;
      ui.start.disabled = false;
      ui.cameraCaption.textContent = 'Camera preview unavailable.';
      setStatus(`Could not start recording: ${error.message}`, true);
    } finally {
      busy = false;
      updateStats();
    }
  }

  async function stopRecorders() {
    const done = [];
    for (const kind of ['audio', 'video']) {
      const current = recorders[kind];
      if (!current) continue;
      done.push(current.stopped);
      if (current.recorder.state !== 'inactive') current.recorder.stop();
    }
    await Promise.all(done);
    await Promise.all([conversionTail.audio, conversionTail.video]);
  }

  function stopRecording() {
    if (stoppingPromise) return stoppingPromise;
    if (!recording) return Promise.resolve();
    recording = false;
    ui.stop.disabled = true;
    clearInterval(elapsedTimer);
    updateElapsed();
    setStatus('Finishing the audio and video streams…');
    stoppingPromise = (async () => {
      try {
        await stopRecorders();
        player?.finishLive();
        await stopPcmCapture();
        pcmFrames.length = 0;
        finished = true;
        ui.cameraCaption.textContent = 'Recording stopped.';
        if (!player || player.closed) ui.caption.textContent = chunks.audio.length && chunks.video.length
          ? 'Recording stopped. Press Replay from start to watch it.'
          : 'Recording stopped without both audio and video data.';
        setStatus(`Recording stopped. Stored ${chunks.audio.length} audio and ${chunks.video.length} video chunks.`);
      } catch (error) {
        setStatus(`Could not finish recording: ${error.message}`, true);
      } finally {
        stopVideoCapture();
        mediaStream?.getTracks().forEach(track => track.stop());
        mediaStream = null;
        ui.camera.srcObject = null;
        ui.start.disabled = false;
        stoppingPromise = null;
        updateStats();
      }
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
      if (!ui.cameraEnabled.checked) {
        disableCameraTrack();
        ui.cameraCaption.textContent = 'Camera off. Black video frames and microphone audio continue.';
        setStatus('Camera capture stopped. Continuous video recording now contains black frames.');
      } else {
        const cameraStream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } }
        });
        requestedTrack = requireTrack(cameraStream.getVideoTracks()[0], 'Camera track is unavailable.');
        if (!recording) {
          requestedTrack.stop();
          ui.cameraEnabled.checked = cameraActive;
          return;
        }
        await enableCameraTrack(requestedTrack);
        if (!recording) {
          disableCameraTrack();
          return;
        }
        mediaStream.addTrack(requestedTrack);
        ui.cameraCaption.textContent = 'Camera on. Live frames are recording with the same video recorder.';
        setStatus('Camera capture resumed without restarting the video stream.');
      }
    } catch (error) {
      if (requestedTrack && requestedTrack !== cameraTrack) requestedTrack.stop();
      if (ui.cameraEnabled.checked) disableCameraTrack();
      ui.cameraEnabled.checked = cameraActive;
      setStatus(`Could not change camera state: ${error.message}`, true);
    } finally {
      cameraBusy = false;
      ui.stop.disabled = !recording;
      updateStats();
    }
  }

  function replayRecording() {
    if (recording || busy || !finished || !chunks.audio.length || !chunks.video.length) return;
    player?.close();
    ui.video.srcObject = null;
    ui.video.muted = false;
    ui.video.volume = Number(ui.volume.value) / 100;
    ui.controls.hidden = false;
    ui.caption.textContent = 'Preparing separate audio and video buffers…';
    player = new MseReplayPlayer(ui.video, chunks, mimeTypes);
    updateReplayControls();
  }

  async function saveCurrentTrack() {
    if (busy || !finished || saveStage === 'done' || !chunks[saveStage].length) return;
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
      const blob = new Blob(chunks[kind].map(chunk => chunk.binary), { type: mimeTypes[kind] });
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

  ui.start.addEventListener('click', startRecording);
  ui.stop.addEventListener('click', stopRecording);
  ui.cameraEnabled.addEventListener('change', changeCamera);
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
    if (player && !player.closed) ui.caption.textContent = 'Replay finished. Press Replay from start to watch again.';
  });
  ui.video.addEventListener('error', () => {
    if (player && !player.closed) player.fail(new Error(ui.video.error?.message || 'Media element error'));
  });
  window.addEventListener('pagehide', () => {
    recording = false;
    clearInterval(elapsedTimer);
    for (const current of Object.values(recorders)) {
      if (current && current.recorder.state !== 'inactive') current.recorder.stop();
    }
    stopVideoCapture();
    mediaStream?.getTracks().forEach(track => track.stop());
    player?.close();
    if (audioContext) void stopPcmCapture();
  });
})();
