const dropZone = document.getElementById('dropZone');
const dropZonePopup = document.getElementById('dropZonePopup');

function preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
}

function initDropZone(dzElement) {
// Prevent default behavior for drag and drop events (to prevent opening the file in the browser)
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dzElement.addEventListener(eventName, preventDefaults, false);
    });

// Add visual feedback for when file is being dragged over the drop zone
    ['dragenter', 'dragover'].forEach(eventName => {
        dzElement.addEventListener(eventName, () => dzElement.classList.add('dragover'), false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dzElement.addEventListener(eventName, () => dzElement.classList.remove('dragover'), false);
    });
}

initDropZone(dropZone)
initDropZone(dropZonePopup)

dropZonePopup.addEventListener('drop', async function (event) {
    await processListOfFiles(event.dataTransfer.files);
    delay(500).then(() => {
        event.dataTransfer.clearData();
    });
});
// Handle the dropped files
dropZone.addEventListener('drop', async function (event) {
    const files = event.dataTransfer.files;

    // Process each dropped file (you can handle multiple files if needed)
    for (const file of files) {
        // File is now a Blob object
        const blob = new Blob([file], {type: file.type});

        showMainSpinnerInButton();
        const binaryId = uuid.v4().toString();
        const slices = await blobToArrayBuffers(blob, MemoryBlock.MB100);
        await createAndStoreBinaryFromSlices(slices, binaryId, file.name, file.type);
        delay(500).then(() => {
            hideMainSpinnerInButton();
            slices.length = 0;
            event.dataTransfer.clearData();
        });
    }
});

function showMainSpinnerInButton() {
    document.getElementById('download-spinner-main').style.display = 'flex';
    document.getElementById('download-message-main').textContent = 'Loading...';
}

function hideMainSpinnerInButton() {
    document.getElementById('download-spinner-main').style.display = 'none';
    document.getElementById('download-message-main').textContent = '';
}
