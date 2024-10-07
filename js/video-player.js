const videoPlayer = document.getElementById('videoPlayer');
const recordBtn = document.getElementById('recordBtn');
recordBtn.focus();
const recordingIndicator = document.getElementById('recordingIndicator');
let isRecording = false;  // Track whether we are recording or not

function setFocusToRecordBtn() {
    resetPlayer();
    recordBtn.focus();
}

// Function to start recording
function startRecording() {
    isRecording = true;
    recordBtn.textContent = 'Stop';  // Change the button text to 'Stop'
    recordBtn.classList.add('stop-btn');  // Change button color/style to indicate stop

    // Ensure video controls are not displayed
    videoPlayer.removeAttribute('controls');

    // Show the REC label with the pulsing dot
    recordingIndicator.style.display = 'flex';

    // Start recording logic here
    alert('Recording started! Implement your recording logic here.');
}

// Function to stop recording and show video player controls
function stopRecording() {
    isRecording = false;
    recordBtn.style.display = 'none';  // Hide the stop button after stopping

    // Finalize recording logic here
    alert('Recording stopped! Implement your finalizing logic here.');

    // Hide the REC label with the pulsing dot
    recordingIndicator.style.display = 'none';

    // Show video controls
    videoPlayer.setAttribute('controls', 'controls');
}

function resetPlayer(){
    isRecording = false;
    recordBtn.textContent = 'Start recording';
    recordBtn.classList.remove('stop-btn');
    recordBtn.style.display = 'block';
    recordingIndicator.style.display = 'none';
    videoPlayer.setAttribute('controls', null);
    //videoPlayer.src = null;
}

// Event listener for record/stop button
recordBtn.addEventListener('click', function () {
    if (!isRecording) {
        startRecording();  // Start recording if not already recording
    } else {
        stopRecording();  // Stop recording if it's currently recording
    }
});
