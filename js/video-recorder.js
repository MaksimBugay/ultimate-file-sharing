(() => {
  'use strict';

  const chunkSecondsParam = new URLSearchParams(window.location.search).get('chunkSeconds');
  const requestedChunkSeconds = chunkSecondsParam === null ? NaN : Number(chunkSecondsParam);
  const CHUNK_SECONDS = Number.isFinite(requestedChunkSeconds)
    && requestedChunkSeconds >= 0.1 && requestedChunkSeconds <= 3600
    ? requestedChunkSeconds : 5;
  const CHUNK_MS = Math.round(CHUNK_SECONDS * 1000);
  const ui = {
    live: document.getElementById('liveVideo'),
    playerCaption: document.getElementById('playerCaption'),
    start: document.getElementById('startButton'),
    stop: document.getElementById('stopButton'),
    replayButton: document.getElementById('replayButton'),
    replayControls: document.getElementById('replayControls'),
    pauseReplayButton: document.getElementById('pauseReplayButton'),
    muteReplayButton: document.getElementById('muteReplayButton'),
    replayVolume: document.getElementById('replayVolume'),
    save: document.getElementById('saveButton'),
    status: document.getElementById('status'),
    elapsed: document.getElementById('elapsed'),
    videoCount: document.getElementById('videoCount'),
    audioCount: document.getElementById('audioCount'),
    storedSize: document.getElementById('storedSize')
  };

  document.querySelectorAll('[data-chunk-seconds]').forEach(element => {
    element.textContent = String(CHUNK_SECONDS);
  });

  const chunks = { video: [], audio: [] };
  const active = { video: null, audio: null };
  const wholeRecording = { video: null, audio: null };
  const fileParts = { video: [], audio: [] };
  const fileMimeTypes = { video: '', audio: '' };
  const replayAudio = new Audio();
  replayAudio.preload = 'auto';
  replayAudio.muted = false;
  replayAudio.volume = 1;
  let mediaStream = null;
  let recording = false;
  let recordingFinished = false;
  let replayActive = false;
  let replayIndex = 0;
  let audioBlocked = false;
  let busy = false;
  let startedAt = 0;
  let elapsedTimer = null;
  let replayUrl = null;
  let replayAudioUrl = null;
  let saveStage = 'video';
  let baseName = '';
  let stoppingPromise = null;

  function setStatus(message, error = false) {
    ui.status.textContent = message;
    ui.status.style.color = error ? '#ffb2b2' : '';
  }

  function updateStats() {
    ui.videoCount.textContent = chunks.video.length;
    ui.audioCount.textContent = chunks.audio.length;
    const bytes = [...chunks.video, ...chunks.audio]
      .reduce((total, chunk) => total + chunk.blob.size, 0)
      + [...fileParts.video, ...fileParts.audio].reduce((total, part) => total + part.size, 0);
    ui.storedSize.textContent = `${(bytes / 1048576).toFixed(1)} MB`;
    ui.save.disabled = busy || !recordingFinished || saveStage === 'done'
      || (saveStage === 'video' ? !chunks.video.length : !chunks.audio.length);
    ui.replayButton.disabled = busy || !recordingFinished || !chunks.video.length || !chunks.audio.length;
  }

  function updateElapsed() {
    const seconds = Math.floor((performance.now() - startedAt) / 1000);
    ui.elapsed.textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  }

  function pickMimeType(kind) {
    const candidates = kind === 'video'
      ? ['video/webm;codecs=vp8', 'video/webm;codecs=vp9', 'video/webm', 'video/mp4;codecs=avc1.42E01E', 'video/mp4']
      : ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/ogg;codecs=opus'];
    return candidates.find(type => MediaRecorder.isTypeSupported(type)) || null;
  }

  function releaseReplayUrls() {
    if (replayUrl) {
      URL.revokeObjectURL(replayUrl);
      replayUrl = null;
    }
    if (replayAudioUrl) {
      URL.revokeObjectURL(replayAudioUrl);
      replayAudioUrl = null;
    }
  }

  function updateReplayControls() {
    ui.pauseReplayButton.textContent = ui.live.paused ? 'Play' : 'Pause';
    ui.muteReplayButton.textContent = audioBlocked ? 'Enable audio' : replayAudio.muted ? 'Unmute audio' : 'Mute audio';
    ui.muteReplayButton.setAttribute('aria-pressed', String(replayAudio.muted));
  }

  function playReplayAudio() {
    replayAudio.play().then(() => {
      audioBlocked = false;
      updateReplayControls();
    }).catch(() => {
      if (!replayActive) return;
      audioBlocked = true;
      ui.playerCaption.textContent = 'Audio playback was blocked. Click Enable audio below the player.';
      updateReplayControls();
    });
  }

  function playNext() {
    if (!replayActive) return;
    replayAudio.pause();
    releaseReplayUrls();
    const index = replayIndex++;
    const videoChunk = chunks.video[index];
    const audioChunk = chunks.audio[index];
    if (!videoChunk || !audioChunk) {
      replayActive = false;
      ui.live.removeAttribute('src');
      ui.live.load();
      replayAudio.removeAttribute('src');
      replayAudio.load();
      ui.replayControls.hidden = true;
      ui.playerCaption.textContent = 'Replay finished. Press Replay video + audio to watch again.';
      return;
    }
    replayUrl = URL.createObjectURL(videoChunk.blob);
    replayAudioUrl = URL.createObjectURL(audioChunk.blob);
    replayAudio.src = replayAudioUrl;
    ui.live.src = replayUrl;
    audioBlocked = false;
    ui.playerCaption.textContent = `Playing video and audio chunk ${index + 1} of ${Math.min(chunks.video.length, chunks.audio.length)}`;
    playReplayAudio();
    ui.live.play().catch(() => {
      if (replayActive) {
        replayAudio.pause();
        ui.playerCaption.textContent = 'Press Play below the player to resume replay.';
        updateReplayControls();
      }
    });
    updateReplayControls();
  }

  function replayRecording() {
    if (busy || recording || !recordingFinished || !chunks.video.length || !chunks.audio.length) return;
    ui.live.pause();
    replayAudio.pause();
    ui.live.controls = false;
    ui.replayControls.hidden = false;
    replayIndex = 0;
    replayActive = true;
    playNext();
  }

  function startWholeRecording(kind, stream, mimeType) {
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    let resolveDone;
    const done = new Promise(resolve => { resolveDone = resolve; });
    wholeRecording[kind] = { recorder, done };
    recorder.addEventListener('dataavailable', event => {
      if (event.data.size) {
        fileParts[kind].push(event.data);
        updateStats();
      }
    });
    recorder.addEventListener('error', event => {
      setStatus(`${kind} file recording failed: ${event.error?.message || 'unknown error'}`, true);
      stopRecording();
    });
    recorder.addEventListener('stop', () => {
      resolveDone();
    });
    recorder.start(CHUNK_MS);
    fileMimeTypes[kind] = recorder.mimeType || mimeType || '';
  }

  function startSegment(kind, stream, mimeType) {
    if (!recording) return;
    const options = mimeType ? { mimeType } : undefined;
    const recorder = new MediaRecorder(stream, options);
    const parts = [];
    const segmentStart = performance.now();
    let resolveDone;
    const done = new Promise(resolve => { resolveDone = resolve; });
    const segment = { recorder, timer: null, done };
    active[kind] = segment;

    recorder.addEventListener('dataavailable', event => {
      if (event.data.size) parts.push(event.data);
    });
    recorder.addEventListener('error', event => {
      setStatus(`${kind} recording failed: ${event.error?.message || 'unknown error'}`, true);
      stopRecording();
    });
    recorder.addEventListener('stop', () => {
      clearTimeout(segment.timer);
      if (active[kind] === segment) active[kind] = null;
      const blob = new Blob(parts, { type: recorder.mimeType || mimeType || parts[0]?.type || '' });
      if (blob.size) {
        const chunk = {
          index: chunks[kind].length,
          startMs: Math.round(segmentStart - startedAt),
          durationMs: Math.round(performance.now() - segmentStart),
          blob
        };
        chunks[kind].push(chunk);
        updateStats();
      }
      resolveDone();
      if (recording) {
        try { startSegment(kind, stream, mimeType); }
        catch (error) {
          setStatus(`${kind} recording failed: ${error.message}`, true);
          stopRecording();
        }
      }
    });
    recorder.start();
    segment.timer = setTimeout(() => {
      if (recorder.state === 'recording') recorder.stop();
    }, CHUNK_MS);
  }

  async function startRecording() {
    if (busy || recording || mediaStream) return;
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setStatus('This browser does not support camera capture and MediaRecorder on this page. Use HTTPS or localhost.', true);
      return;
    }
    busy = true;
    ui.start.disabled = true;
    setStatus('Requesting camera and microphone access…');
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      if (!mediaStream.getVideoTracks().length || !mediaStream.getAudioTracks().length) {
        mediaStream.getTracks().forEach(track => track.stop());
        mediaStream = null;
        ui.start.disabled = false;
        setStatus('Both a camera and microphone are required.', true);
        return;
      }
      ui.live.srcObject = mediaStream;
      ui.live.controls = false;
      ui.playerCaption.textContent = 'Live camera preview, with audio muted to prevent feedback.';
      const videoStream = new MediaStream(mediaStream.getVideoTracks());
      const audioStream = new MediaStream(mediaStream.getAudioTracks());
      const videoMime = pickMimeType('video');
      const audioMime = pickMimeType('audio');
      startedAt = performance.now();
      baseName = `recording-${new Date().toISOString().replace(/[:.]/g, '-')}`;
      recording = true;
      recordingFinished = false;
      startWholeRecording('video', videoStream, videoMime);
      startWholeRecording('audio', audioStream, audioMime);
      startSegment('video', videoStream, videoMime);
      startSegment('audio', audioStream, audioMime);
      elapsedTimer = setInterval(updateElapsed, 250);
      ui.stop.disabled = false;
      setStatus('Recording. Replay becomes available after recording stops.');
    } catch (error) {
      recording = false;
      for (const kind of ['video', 'audio']) {
        for (const current of [active[kind], wholeRecording[kind]]) {
          if (!current) continue;
          clearTimeout(current.timer);
          if (current.recorder.state !== 'inactive') current.recorder.stop();
        }
      }
      mediaStream?.getTracks().forEach(track => track.stop());
      mediaStream = null;
      ui.live.srcObject = null;
      ui.playerCaption.textContent = 'Camera preview unavailable.';
      ui.start.disabled = false;
      setStatus(`Could not start recording: ${error.message}`, true);
    } finally {
      busy = false;
      updateStats();
    }
  }

  function stopRecording() {
    if (stoppingPromise) return stoppingPromise;
    if (!recording) return Promise.resolve();
    recording = false;
    stoppingPromise = (async () => {
      ui.stop.disabled = true;
      clearInterval(elapsedTimer);
      updateElapsed();
      setStatus('Finishing the video and audio files…');
      const finishing = [];
      for (const kind of ['video', 'audio']) {
        for (const current of [active[kind], wholeRecording[kind]]) {
          if (!current) continue;
          clearTimeout(current.timer);
          finishing.push(current.done);
          if (current.recorder.state !== 'inactive') current.recorder.stop();
        }
      }
      await Promise.all(finishing);
      mediaStream?.getTracks().forEach(track => track.stop());
      ui.live.srcObject = null;
      recordingFinished = true;
      ui.playerCaption.textContent = chunks.video.length && chunks.audio.length
        ? 'Recording stopped. Press Replay video + audio to play the stored chunks.'
        : 'Recording stopped without a complete video and audio chunk pair.';
      setStatus(`Recording stopped. ${chunks.video.length} video and ${chunks.audio.length} audio chunks are ready.`);
      updateStats();
    })();
    return stoppingPromise;
  }

  function buildFile(kind) {
    return new Blob(fileParts[kind], { type: fileMimeTypes[kind] });
  }

  function fileExtension(mimeType) {
    if (mimeType.includes('mp4')) return '.mp4';
    if (mimeType.includes('ogg')) return '.ogg';
    return '.webm';
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

  async function saveCurrentTrack() {
    if (busy || !recordingFinished || !chunks[saveStage].length) return;
    const kind = saveStage;
    if (!fileParts[kind].length) {
      setStatus(`No ${kind} data was recorded.`, true);
      return;
    }
    const mimeType = fileMimeTypes[kind];
    const extension = fileExtension(mimeType);
    const fileName = `${baseName}-${kind}${extension}`;
    busy = true;
    ui.save.disabled = true;
    try {
      // Open the picker directly from this click; browsers require user activation.
      const handle = window.showSaveFilePicker
        ? await window.showSaveFilePicker({
            suggestedName: fileName,
            types: [{ description: `${kind} recording`, accept: { [mimeType.split(';')[0]]: [extension] } }]
          })
        : null;
      const blob = buildFile(kind);
      if (handle) {
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
      } else {
        downloadFallback(blob, fileName);
      }
      if (kind === 'video') {
        saveStage = 'audio';
        ui.save.textContent = 'Save audio file';
        setStatus('Video saved. Click “Save audio file” to choose where to save the microphone chunks.');
      } else {
        saveStage = 'done';
        ui.save.textContent = 'Both files saved';
        setStatus('Video and audio files saved.');
      }
    } catch (error) {
      if (error.name !== 'AbortError') setStatus(`Could not save ${kind}: ${error.message}`, true);
      else setStatus(`${kind} save canceled. Recording is still available in memory.`);
    } finally {
      busy = false;
      updateStats();
      if (saveStage === 'done') ui.save.disabled = true;
    }
  }

  ui.live.addEventListener('ended', playNext);
  ui.live.addEventListener('pause', () => {
    if (replayActive && !ui.live.ended) replayAudio.pause();
    if (replayActive) updateReplayControls();
  });
  ui.live.addEventListener('play', () => {
    if (replayActive && replayAudio.src && replayAudio.paused) playReplayAudio();
    if (replayActive) updateReplayControls();
  });
  ui.live.addEventListener('timeupdate', () => {
    if (!replayActive || ui.live.paused || replayAudio.paused || replayAudio.ended || replayAudio.readyState < 2) return;
    const videoTime = ui.live.currentTime;
    if (Number.isFinite(replayAudio.duration) && videoTime >= replayAudio.duration) return;
    if (Math.abs(replayAudio.currentTime - videoTime) > 0.25) {
      try { replayAudio.currentTime = videoTime; } catch { /* Some recorded chunks are not seekable. */ }
    }
  });
  ui.live.addEventListener('seeking', () => {
    if (replayActive && replayAudio.readyState >= 2) {
      try { replayAudio.currentTime = ui.live.currentTime; } catch { /* Keep playing if seeking is unavailable. */ }
    }
  });
  ui.live.addEventListener('error', () => {
    if (!replayActive) return;
    ui.playerCaption.textContent = 'This chunk could not be replayed in this browser.';
    playNext();
  });
  ui.start.addEventListener('click', startRecording);
  ui.stop.addEventListener('click', stopRecording);
  ui.replayButton.addEventListener('click', replayRecording);
  ui.pauseReplayButton.addEventListener('click', () => {
    if (!replayActive) return;
    if (ui.live.paused) ui.live.play().catch(() => setStatus('Could not resume replay.', true));
    else ui.live.pause();
  });
  ui.muteReplayButton.addEventListener('click', () => {
    if (!replayActive) return;
    if (audioBlocked) {
      replayAudio.muted = false;
      playReplayAudio();
    } else {
      replayAudio.muted = !replayAudio.muted;
    }
    updateReplayControls();
  });
  ui.replayVolume.addEventListener('input', () => {
    replayAudio.volume = Number(ui.replayVolume.value) / 100;
    if (replayAudio.volume > 0) replayAudio.muted = false;
    updateReplayControls();
  });
  ui.save.addEventListener('click', saveCurrentTrack);
  window.addEventListener('pagehide', () => {
    recording = false;
    for (const kind of ['video', 'audio']) {
      for (const current of [active[kind], wholeRecording[kind]]) {
        if (current?.recorder.state === 'recording') current.recorder.stop();
      }
    }
    mediaStream?.getTracks().forEach(track => track.stop());
    replayAudio.pause();
    releaseReplayUrls();
  });
})();
