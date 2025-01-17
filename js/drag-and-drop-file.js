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

initDropZone(dropZone);
initDropZone(dropZonePopup);

dropZonePopup.addEventListener('drop', async function (event) {
    await processListOfFiles(event.dataTransfer.files);
    delay(500).then(() => {
        event.dataTransfer.clearData();
    });
});
// Handle the dropped files
dropZone.addEventListener('drop', async function (event) {
    const files = event.dataTransfer.files;
    if ('transfer-choice' === shareOrTransfer()) {
        if (!(Fileshare.properties && Fileshare.properties.transferGroup)) {
            openModal(ContentType.FILE_TRANSFER);
            transferGroupName.focus();
            for (const file of files) {
                TransferFileHelper.preparedFile.push(file);
            }
        } else {
            openModal(ContentType.FILE_TRANSFER);
            for (const file of files) {
                await TransferFileHelper.transferFile(
                    file,
                    Fileshare.properties.transferGroup,
                    Fileshare.properties.transferGroupPassword
                );
            }
            closeModal();
        }
        return;
    }
    // Process each dropped file (you can handle multiple files if needed)
    openModal(ContentType.FILE_TRANSFER);
    for (const file of files) {
        // File is now a Blob object
        const blob = new Blob([file], {type: file.type});

        await SaveInCloudHelper.cacheFileInCloud(
            file,
            Fileshare.defaultReadMeText,
            true);
    }
    delay(500).then(() => {
        event.dataTransfer.clearData();
        closeModal();
    });
});

function shareOrTransfer() {
    const selectedOption = document.querySelector('input[name="share-or-transfer"]:checked');
    return selectedOption ? selectedOption.value : 'share-choice';
}

function showMainSpinnerInButton() {
    document.getElementById('download-spinner-main').style.display = 'flex';
    document.getElementById('download-message-main').textContent = 'Loading...';
}

function hideMainSpinnerInButton() {
    document.getElementById('download-spinner-main').style.display = 'none';
    document.getElementById('download-message-main').textContent = '';
}
