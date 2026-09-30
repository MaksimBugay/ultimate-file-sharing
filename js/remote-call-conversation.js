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
