const dropZone = document.getElementById('dropZone');

// Prevent default behavior for drag and drop events (to prevent opening the file in the browser)
['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, preventDefaults, false);
});

function preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
}

// Add visual feedback for when file is being dragged over the drop zone
['dragenter', 'dragover'].forEach(eventName => {
    dropZone.addEventListener(eventName, () => dropZone.classList.add('dragover'), false);
});

['dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, () => dropZone.classList.remove('dragover'), false);
});

// Handle the dropped files
dropZone.addEventListener('drop', async function (event) {
    const files = event.dataTransfer.files;

    // Process each dropped file (you can handle multiple files if needed)
    for (const file of files) {
        // File is now a Blob object
        const blob = new Blob([file], {type: file.type});

        console.log('File name:', file.name);
        console.log('File type:', file.type);
        console.log('Blob:', blob);

        showMainSpinnerInButton();
        const binaryId = uuid.v4().toString();
        const slices = await blobToArrayBuffers(blob, MemoryBlock.MB100);
        await createAndStoreBinaryFromSlices(slices, binaryId, file.name, file.type);
        delay(500).then(() => {
            slices.length = 0;
            hideMainSpinnerInButton();
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
