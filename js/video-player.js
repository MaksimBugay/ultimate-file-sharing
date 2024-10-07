const RecorderState = Object.freeze({
    READY: 0,
    RECORDING: 1,
    PREVIEW: 2
});

const mimeType = 'video/webm; codecs=vp8, opus'
let stream;
let mediaRecorder;
const chunks = []
let fullVideoBlob;

const videoPlayer = document.getElementById('videoPlayer');
const recordBtn = document.getElementById('recordBtn');
recordBtn.focus();
const recordingIndicator = document.getElementById('recordingIndicator');
let recorderState = RecorderState.READY;

function setFocusToRecordBtn() {
    resetPlayer();
    recordBtn.focus();
}

// Function to start recording
function startRecording() {
    startVideoRecording().then(result => {
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
        showSpinnerInButton();
        const binaryId = uuid.v4().toString();
        const slices = await blobToArrayBuffers(fullVideoBlob, MemoryBlock.MB100);
        await createAndStoreBinaryFromSlices(slices, binaryId, "My first video", mimeType);
        delay(500).then(() => {
            chunks.length = 0;
            fullVideoBlob = null;
            closeModal();
        });
    }
});

//=================================row recording functions==============================================================
async function startVideoRecording() {
    try {
        stream = await navigator.mediaDevices.getUserMedia({video: true, audio: true});
        mediaRecorder = new MediaRecorder(stream, {mimeType: mimeType});

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
