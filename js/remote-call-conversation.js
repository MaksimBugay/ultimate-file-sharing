(() => {
  'use strict';

  // A second, independent recording of remote video and both voices on the live playback timeline.
  // The original local camera/microphone recording remains in RemoteCallMedia.
  class ConversationRecorder {
    constructor({ video, microphoneTrack, audioContext, playbackSource, mimeType,
      chunkMs, onUpdate, onLimit, onError }) {
      this.video = video;
      this.microphoneTrack = microphoneTrack;
      this.audioContext = audioContext;
      this.playbackSource = playbackSource;
      this.mimeType = mimeType;
      this.chunkMs = chunkMs;
      this.onUpdate = onUpdate;
      this.onLimit = onLimit;
      this.onError = onError;
      this.chunks = [];
      this.storedBytes = 0;
      this.finished = false;
      this.limitReported = false;
      this.stopPromise = null;
      this.drawTimer = null;
    }

    static closestFrame(frames, order) {
      if (!frames.length) return null;
      let low = 0;
      let high = frames.length;
      while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (frames[middle].order < order) low = middle + 1;
        else high = middle;
      }
      const after = frames[Math.min(low, frames.length - 1)];
      const before = frames[Math.max(0, low - 1)];
      return Math.abs(before.order - order) <= Math.abs(after.order - order) ? before : after;
    }

    static planHistory({ ownAudio, remoteAudio, remoteVideo, chunkMs }) {
      const sorted = frames => [...frames].sort((a, b) => a.order - b.order);
      const own = sorted(ownAudio);
      const audio = sorted(remoteAudio);
      const video = sorted(remoteVideo);
      const windows = own.map(frame => ({ order: frame.order, startTime: frame.startTime,
        endTime: frame.endTime, ownAudio: frame }));
      let end = own.at(-1)?.endTime || 0;
      // Retain a peer's final capture tail when STOP delivery outlasts local capture.
      for (const frame of audio) {
        if (frame.endTime <= end) continue;
        const startTime = Math.max(end, frame.startTime);
        windows.push({ order: startTime, startTime, endTime: frame.endTime, ownAudio: null });
        end = frame.endTime;
      }
      const finalEnd = video.reduce((last, frame) => Math.max(last, frame.endTime), end);
      while (end < finalEnd) {
        const endTime = Math.min(finalEnd, end + chunkMs);
        windows.push({ order: end, startTime: end, endTime, ownAudio: null });
        end = endTime;
      }
      const overlaps = (frame, window) => frame && frame.endTime > window.startTime && frame.startTime < window.endTime;
      return windows.map(window => {
        const remoteAudio = ConversationRecorder.closestFrame(audio, window.order);
        const remoteVideo = ConversationRecorder.closestFrame(video, window.order);
        return { ...window,
          remoteAudio: overlaps(remoteAudio, window) ? remoteAudio : null,
          remoteVideo: overlaps(remoteVideo, window) ? remoteVideo : null };
      });
    }

    static async renderHistory({ ownAudio, remoteAudio, remoteVideo, mimeType, chunkMs, onProgress }) {
      const plan = ConversationRecorder.planHistory({ ownAudio, remoteAudio, remoteVideo, chunkMs });
      if (!plan.length) throw new Error('There is no recorded audio to save');
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) throw new Error('Web Audio is required to combine recorded voices');
      const context = new AudioContextClass();
      const videos = new Set();
      const audioSources = new Set();
      const decoded = new Map();
      const chunks = [];
      let videoStream;
      let audioDestination;
      let startupSilence;
      let recorder;
      let drawTimer;
      let activeVideo = null;
      let startAt = 0;
      let failure = null;
      let storedBytes = 0;
      const durationMs = plan.at(-1).endTime;
      const fail = error => { failure ||= error; };
      const onPageHide = () => fail(new Error('Recording assembly was canceled because the page closed'));
      const decode = frame => {
        if (!frame || frame.empty || window.RemoteCallMedia?.hasEncodedFrames?.(frame) === false) return Promise.resolve(null);
        if (!decoded.has(frame)) {
          decoded.set(frame, context.decodeAudioData(frame.binary.slice().buffer).catch(() => {
            throw new Error(`Could not decode recorded audio at order ${frame.order}`);
          }));
        }
        return decoded.get(frame);
      };
      const releaseVideo = entry => {
        if (!entry) return;
        entry.video.pause();
        entry.video.removeAttribute('src');
        entry.video.load();
        URL.revokeObjectURL(entry.url);
        videos.delete(entry);
      };
      const prepareVideo = async frame => {
        if (!frame || frame.empty || window.RemoteCallMedia?.hasEncodedFrames?.(frame) === false) return null;
        const video = document.createElement('video');
        video.muted = true;
        video.playsInline = true;
        video.preload = 'auto';
        const entry = { video, frame, url: URL.createObjectURL(new Blob([frame.binary], { type: frame.mimeType })) };
        videos.add(entry);
        await new Promise((resolve, reject) => {
          const done = error => {
            clearTimeout(timer);
            video.removeEventListener('loadeddata', loaded);
            video.removeEventListener('error', errored);
            error ? reject(error) : resolve();
          };
          const loaded = () => done();
          const errored = () => done(new Error(`Could not decode recorded video at order ${frame.order}`));
          const timer = setTimeout(() => done(new Error('Recorded video decoding timed out')), 10000);
          video.addEventListener('loadeddata', loaded, { once: true });
          video.addEventListener('error', errored, { once: true });
          video.src = entry.url;
          video.load();
        });
        return entry;
      };
      const prepare = async window => {
        const [own, remote, video] = await Promise.all([decode(window.ownAudio), decode(window.remoteAudio), prepareVideo(window.remoteVideo)]);
        return { own, remote, video, window };
      };
      const waitUntil = async target => {
        while (context.currentTime < target) {
          if (failure) throw failure;
          if (context.state !== 'running') throw new Error('Recording assembly paused because browser audio stopped');
          await new Promise(resolve => setTimeout(resolve, Math.min(100, Math.max(1, (target - context.currentTime) * 1000))));
        }
        if (failure) throw failure;
      };
      const scheduleAudio = (buffer, frame, window) => {
        if (!buffer || !frame) return;
        const from = Math.max(window.startTime, frame.startTime);
        const to = Math.min(window.endTime, frame.endTime, frame.startTime + buffer.duration * 1000);
        if (to <= from) return;
        const source = context.createBufferSource();
        const gain = context.createGain();
        source.buffer = buffer;
        gain.gain.value = 0.5;
        source.connect(gain);
        gain.connect(audioDestination);
        audioSources.add(source);
        source.onended = () => { source.disconnect(); gain.disconnect(); audioSources.delete(source); };
        source.start(startAt + from / 1000, (from - frame.startTime) / 1000, (to - from) / 1000);
      };
      window.addEventListener('pagehide', onPageHide);
      try {
        await context.resume();
        if (context.state !== 'running') throw new Error('Browser audio could not start for recording assembly');
        audioDestination = context.createMediaStreamDestination();
        // MediaRecorder needs both live tracks before its start event. Keep the
        // destination producing silent samples while stored frames are decoded.
        startupSilence = context.createConstantSource();
        startupSilence.offset.value = 0;
        startupSilence.connect(audioDestination);
        startupSilence.start();
        const canvas = document.createElement('canvas');
        canvas.width = 1280;
        canvas.height = 720;
        const drawing = canvas.getContext('2d', { alpha: false });
        if (!drawing || !canvas.captureStream) throw new Error('Canvas video capture is unavailable');
        const draw = () => {
          drawing.fillStyle = '#000';
          drawing.fillRect(0, 0, canvas.width, canvas.height);
          const elapsedMs = Math.max(0, (context.currentTime - startAt) * 1000);
          const entry = activeVideo;
          if (entry) {
            const { video, frame } = entry;
            const position = (elapsedMs - frame.startTime) / 1000;
            if (position >= 0 && elapsedMs < frame.endTime && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
              if (Math.abs(video.currentTime - position) > 0.1) video.currentTime = position;
              if (video.paused) void video.play().catch(error => { if (error.name !== 'AbortError') fail(error); });
              const scale = Math.min(canvas.width / video.videoWidth, canvas.height / video.videoHeight);
              try { drawing.drawImage(video, (canvas.width - video.videoWidth * scale) / 2,
                (canvas.height - video.videoHeight * scale) / 2, video.videoWidth * scale, video.videoHeight * scale); }
              catch (error) { fail(error); }
            }
          }
          onProgress?.(Math.min(elapsedMs, durationMs), durationMs);
        };
        draw();
        videoStream = canvas.captureStream(30);
        recorder = new MediaRecorder(new MediaStream([
          ...videoStream.getVideoTracks(), ...audioDestination.stream.getAudioTracks()
        ]), { mimeType, audioBitsPerSecond: 96000, videoBitsPerSecond: 1500000 });
        const stopped = new Promise(resolve => recorder.addEventListener('stop', resolve, { once: true }));
        recorder.addEventListener('error', event => fail(event.error || new Error('Combined recording failed')));
        recorder.addEventListener('dataavailable', event => {
          if (!event.data?.size) return;
          chunks.push(event.data);
          storedBytes += event.data.size;
          if (storedBytes > 512 * 1048576) fail(new Error('Combined recording exceeded the 512 MB recording limit'));
        });
        let prepared = await prepare(plan[0]);
        let startTimer;
        const started = new Promise((resolve, reject) => {
          recorder.addEventListener('start', () => { clearTimeout(startTimer); resolve(); }, { once: true });
          startTimer = setTimeout(() => reject(new Error('Combined recording could not start')), 10000);
        });
        startAt = context.currentTime;
        drawTimer = setInterval(draw, 1000 / 30);
        recorder.start(chunkMs);
        try { await started; } finally { clearTimeout(startTimer); }
        // Let the encoder initialize before scheduling the first stored samples.
        startAt = context.currentTime + 0.1;
        for (let index = 0; index < plan.length; index++) {
          const next = index + 1 < plan.length ? prepare(plan[index + 1]) : null;
          if (next) void next.catch(fail);
          const { own, remote, video, window: captureWindow } = prepared;
          // Audio retains its capture timestamps, including gaps, instead of
          // shifting delayed/absent frames onto the next available time slot.
          scheduleAudio(own, captureWindow.ownAudio, captureWindow);
          scheduleAudio(remote, captureWindow.remoteAudio, captureWindow);
          await waitUntil(startAt + captureWindow.startTime / 1000);
          releaseVideo(activeVideo);
          activeVideo = video;
          draw();
          await waitUntil(startAt + captureWindow.endTime / 1000);
          if (next) prepared = await next;
          for (const frame of decoded.keys()) {
            if (frame.endTime < captureWindow.startTime - chunkMs * 2) decoded.delete(frame);
          }
        }
        recorder.stop();
        await stopped;
        if (failure) throw failure;
        if (!chunks.length) throw new Error('The combined recording contains no media');
        return { chunks, storedBytes, finished: true, recordingMimeType: recorder.mimeType || mimeType };
      } finally {
        clearInterval(drawTimer);
        window.removeEventListener('pagehide', onPageHide);
        if (recorder && recorder.state !== 'inactive') recorder.stop();
        for (const source of audioSources) { try { source.stop(); } catch { /* Already ended. */ } source.disconnect(); }
        for (const entry of videos) releaseVideo(entry);
        videoStream?.getTracks().forEach(track => track.stop());
        startupSilence?.stop();
        startupSilence?.disconnect();
        audioDestination?.stream.getTracks().forEach(track => track.stop());
        await context.close();
      }
    }

    drawFrame() {
      const { canvas, context, video } = this;
      context.fillStyle = '#000';
      context.fillRect(0, 0, canvas.width, canvas.height);
      if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth || !video.videoHeight) return;
      const scale = Math.min(canvas.width / video.videoWidth, canvas.height / video.videoHeight);
      const width = video.videoWidth * scale;
      const height = video.videoHeight * scale;
      try {
        context.drawImage(video, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
      } catch {
        // The remote frame can disappear while MSE switches buffers; keep this frame black.
      }
    }

    start() {
      try {
        this.initialize();
        return this;
      } catch (error) {
        this.releaseTracks();
        throw error;
      }
    }

    initialize() {
      this.canvas = document.createElement('canvas');
      this.canvas.width = 1280;
      this.canvas.height = 720;
      this.context = this.canvas.getContext('2d', { alpha: false });
      if (!this.context || !this.canvas.captureStream) throw new Error('Remote video capture is unavailable');
      this.drawFrame();
      this.videoStream = this.canvas.captureStream(30);
      const videoTrack = this.videoStream.getVideoTracks()[0];
      if (!videoTrack) throw new Error('Remote video recording track is unavailable');

      this.audioDestination = this.audioContext.createMediaStreamDestination();
      this.microphoneSource = this.audioContext.createMediaStreamSource(new MediaStream([this.microphoneTrack]));
      this.microphoneGain = this.audioContext.createGain();
      this.playbackGain = this.audioContext.createGain();
      this.microphoneGain.gain.value = 0.5;
      this.playbackGain.gain.value = 0.5;
      this.microphoneSource.connect(this.microphoneGain);
      this.microphoneGain.connect(this.audioDestination);
      this.playbackSource.connect(this.playbackGain);
      this.playbackGain.connect(this.audioDestination);
      const audioTrack = this.audioDestination.stream.getAudioTracks()[0];
      if (!audioTrack) throw new Error('Conversation audio recording track is unavailable');
      const stream = new MediaStream([videoTrack, audioTrack]);
      this.recorder = new MediaRecorder(stream, {
        mimeType: this.mimeType, audioBitsPerSecond: 96000, videoBitsPerSecond: 1500000
      });
      this.recordingMimeType = this.recorder.mimeType || this.mimeType;
      this.stopped = new Promise(resolve => {
        this.recorder.addEventListener('stop', () => {
          this.finished = true;
          this.releaseTracks();
          this.onUpdate();
          resolve();
        }, { once: true });
      });
      this.recorder.addEventListener('dataavailable', event => {
        if (!event.data?.size) return;
        this.chunks.push(event.data);
        this.storedBytes += event.data.size;
        this.onUpdate();
        if (!this.limitReported && this.onLimit(this.storedBytes)) this.limitReported = true;
      });
      this.recorder.addEventListener('error', event => {
        this.onError(event.error || new Error('Conversation recorder failed'));
      });
      this.recorder.start(this.chunkMs);
      this.drawTimer = setInterval(() => this.drawFrame(), 1000 / 30);
    }

    releaseTracks() {
      clearInterval(this.drawTimer);
      this.drawTimer = null;
      if (this.playbackGain) {
        try { this.playbackSource.disconnect(this.playbackGain); } catch { /* Already disconnected. */ }
      }
      this.microphoneSource?.disconnect();
      this.microphoneGain?.disconnect();
      this.playbackGain?.disconnect();
      this.videoStream?.getTracks().forEach(track => track.stop());
      this.audioDestination?.stream.getTracks().forEach(track => track.stop());
    }

    stop() {
      if (this.stopPromise) return this.stopPromise;
      if (!this.recorder) return Promise.resolve();
      this.stopPromise = this.stopped;
      if (this.recorder.state !== 'inactive') this.recorder.stop();
      return this.stopPromise;
    }
  }

  window.RemoteCallConversationRecorder = ConversationRecorder;
})();
