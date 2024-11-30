const RecorderState = Object.freeze({
    READY: 0,
    RECORDING: 1,
    PREVIEW: 2
});

const VideoPlayer = {}
VideoPlayer.contentType = ContentType.VIDEO

const videoMimeType = MediaRecorder.isTypeSupported('video/webm; codecs="vp9, opus"') ?
    'video/webm; codecs="vp9, opus"' : 'video/webm; codecs="vp8, opus"';
const audioMimeType = 'audio/webm';

let mimeType;

let stream;
let mediaRecorder;
const chunks = []
let fullVideoBlob;

const videoPlayer = document.getElementById('videoPlayer');
const recordBtn = document.getElementById('recordBtn');
const recordedVideoName = document.getElementById('recordedVideoName')
recordBtn.focus();
const recordingIndicator = document.getElementById('recordingIndicator');
let recorderState = RecorderState.READY;

function setFocusToRecordBtn() {
    resetPlayer();
    recordBtn.focus();
}

// Function to start recording
function startRecording() {
    startMediaRecording().then(result => {
        if (result.status === 0) {
            recorderState = RecorderState.RECORDING;
            recordBtn.textContent = 'Stop';
            recordBtn.classList.add('stop-btn');
            videoPlayer.removeAttribute('controls');
            recordingIndicator.style.display = 'flex';
        } else {
            console.warn(result.message)
        }
    });
}

// Function to stop recording and show video player controls
function stopRecording() {
    recorderState = RecorderState.PREVIEW;
    recordBtn.textContent = 'Save';
    recordBtn.classList.remove('stop-btn');
    recordBtn.classList.add('save-btn');

    // Hide the REC label with the pulsing dot
    recordingIndicator.style.display = 'none';

    stopVideoRecording().then(result => {
        if (result.status === 0) {
            videoPlayer.setAttribute('controls', 'controls');
            playRecording();
        } else {
            console.warn(result.message)
        }
    });
}

function resetPlayer() {
    recorderState = RecorderState.READY;
    recordBtn.textContent = 'Start recording';
    recordBtn.classList.remove('stop-btn');
    recordBtn.classList.remove('save-btn');
    recordBtn.style.display = 'block';
    recordingIndicator.style.display = 'none';
    videoPlayer.removeAttribute('controls');
    videoPlayer.src = "";
    chunks.length = 0;
    fullVideoBlob = null;
    recordedVideoName.value = '';
}

// Event listener for record/stop button
recordBtn.addEventListener('click', async function () {
    if (RecorderState.READY === recorderState) {
        startRecording();
    } else if (RecorderState.RECORDING === recorderState) {
        stopRecording();
    } else if (RecorderState.PREVIEW === recorderState) {
        if (!fullVideoBlob) {
            return;
        }
        videoPlayer.pause();
        await SaveInCloudHelper.cacheBlobInCloud(
            getVideoName(),
            mimeType,
            readMeTextMemo.textContent,
            fullVideoBlob,
            !shareFromDeviceCheckbox.checked,
            passwordField.value.trim());
        delay(500).then(() => {
            chunks.length = 0;
            fullVideoBlob = null;
            closeModal();
        });
    }
});

function getVideoName() {
    const vName = recordedVideoName.value;
    if (vName) {
        return `${vName}.webm`;
    }
    if (ContentType.VIDEO === VideoPlayer.contentType) {
        return `video-recording-${new Date().getTime()}.webm`
    } else {
        return `audio-recording-${new Date().getTime()}.webm`
    }
}

//=================================row recording functions==============================================================
async function startAudioRecording() {
    try {
        // Request audio stream only
        stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                sampleRate: 44100,  // Request high-quality audio sampling rate
                channelCount: 2,    // Request stereo audio
                echoCancellation: true  // Enable echo cancellation for better audio
            }
        });

        // Create a new MediaRecorder with audio format only
        mediaRecorder = new MediaRecorder(stream, {
            mimeType: mimeType,
            audioBitsPerSecond: 128 * 1024
        });

        mediaRecorder.ondataavailable = event => {
            if (event.data.size > 0) {
                const blob = event.data;
                chunks.push(blob);
                console.log(`${blob.size} chunks were recorded`);
            }
        };

        mediaRecorder.start(10000);
        return {status: 0, message: 'recording started'};
    } catch (err) {
        return {status: -1, message: `Cannot start, error accessing media devices: ${err}`};
    }
}

async function startMediaRecording() {
    if (ContentType.VIDEO === VideoPlayer.contentType) {
        mimeType = videoMimeType;
        return await startVideoRecording();
    } else {
        mimeType = audioMimeType;
        return await startAudioRecording();
    }
}

async function startVideoRecording() {
    try {
        stream = await navigator.mediaDevices.getUserMedia({
            video: {
                /*width: { ideal: 1920, max: 1920 },
                height: { ideal: 1080, max: 1080 },*/
                frameRate: {ideal: 60, max: 60},  // Request 60 FPS if available
                facingMode: {ideal: "user"}
            },
            audio: {
                sampleRate: 44100,  // Request high-quality audio sampling rate
                channelCount: 2,    // Request stereo audio
                echoCancellation: true  // Enable echo cancellation for better audio
            }
        });

        // Create a new MediaRecorder with the desired format
        mediaRecorder = new MediaRecorder(stream, {
            mimeType: mimeType,
            videoBitsPerSecond: 5 * 1024 * 1024,  // 5Mbps video bitrate for high quality
            audioBitsPerSecond: 128 * 1024  // 128kbps audio bitrate for decent audio quality
        });

        mediaRecorder.ondataavailable = event => {
            if (event.data.size > 0) {
                const blob = event.data;
                chunks.push(blob);
                console.log(`${blob.size} chunks were recorded`);
            }
        };

        mediaRecorder.start(10000);
        return {status: 0, message: 'recording started'};
    } catch (err) {
        return {status: -1, message: `Cannot start, error accessing media devices: ${err}`};
    }
}

async function stopVideoRecording() {
    try {
        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
            mediaRecorder.stop();
            await delay(1000);
        }
        // Stop all media tracks to turn off the camera
        if (stream) {
            stream.getTracks().forEach(track => track.stop());
        }
        return {status: 0, message: 'recording stopped'};
    } catch (err) {
        return {status: -1, message: `Cannot stop, error accessing media devices: ${err}`};
    }
}

function playRecording() {
    fullVideoBlob = new Blob(chunks, {type: mimeType});
    chunks.length = 0;
    videoPlayer.src = URL.createObjectURL(fullVideoBlob);

    videoPlayer.removeEventListener('ended', blobUrlCleanup)
    videoPlayer.addEventListener('ended', blobUrlCleanup);

    videoPlayer.removeEventListener('error', blobUrlCleanup)
    videoPlayer.addEventListener('error', blobUrlCleanup);

    videoPlayer.play();
}

function blobUrlCleanup() {
    const error = this.error;
    const url = this.src;
    if (url) {
        URL.revokeObjectURL(url);
    }
    if (error) {
        console.error(`An error occurred during video playback: ${error}`);
    } else {
        console.log('Video ended');
    }
}

//======================================================================================================================
