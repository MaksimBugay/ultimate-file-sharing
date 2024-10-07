const RecorderState = Object.freeze({
    READY: 0,
    RECORDING: 1,
    PREVIEW: 2
});

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
    recorderState = RecorderState.RECORDING;
    recordBtn.textContent = 'Stop';  // Change the button text to 'Stop'
    recordBtn.classList.add('stop-btn');  // Change button color/style to indicate stop

    // Ensure video controls are not displayed
    videoPlayer.removeAttribute('controls');

    // Show the REC label with the pulsing dot
    recordingIndicator.style.display = 'flex';

    // Start recording logic here
    //alert('Recording started! Implement your recording logic here.');
}

// Function to stop recording and show video player controls
function stopRecording() {
    recorderState = RecorderState.PREVIEW;
    recordBtn.textContent = 'Save';
    recordBtn.classList.remove('stop-btn');
    recordBtn.classList.add('save-btn');

    // Finalize recording logic here
    //alert('Recording stopped! Implement your finalizing logic here.');

    // Hide the REC label with the pulsing dot
    recordingIndicator.style.display = 'none';

    // Show video controls
    videoPlayer.setAttribute('controls', 'controls');
}

function resetPlayer() {
    recorderState = RecorderState.READY;
    recordBtn.textContent = 'Start recording';
    recordBtn.classList.remove('stop-btn');
    recordBtn.classList.remove('save-btn');
    recordBtn.style.display = 'block';
    recordingIndicator.style.display = 'none';
    videoPlayer.removeAttribute('controls');
    videoPlayer.src = undefined;
}

// Event listener for record/stop button
recordBtn.addEventListener('click', function () {
    if (RecorderState.READY === recorderState) {
        startRecording();
    }
    else if (RecorderState.RECORDING === recorderState) {
        stopRecording();
    }
    else if (RecorderState.PREVIEW === recorderState) {
        alert("save video");
    }
});
