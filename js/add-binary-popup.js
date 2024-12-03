const ContentType = Object.freeze({
    FILE: 0,
    LIVE_STREAM: 1,
    VIDEO: 2,
    COPY_PAST: 3,
    AUDIO: 4,
    FILE_TRANSFER: 5,
    TEXT_MESSAGE: 6
});

const AddBinaryWidget = {}

const addBinaryPopup = document.getElementById("addBinaryPopup");
const closeButton = document.getElementById("addBinaryPopupCloseBtn");

const fileInput = document.getElementById('fileInput');
const passwordField = document.getElementById('passwordInput');
const encryptFileContentCheckbox = document.getElementById('encryptFileContentCheckbox');
const createZipArchiveCheckbox = document.getElementById('createZipArchiveCheckbox');
const shareFromDeviceCheckbox = document.getElementById("shareFromDeviceCheckbox");
const shareFromDeviceWarning = document.getElementById("shareFromDeviceWarning");
const zipArchiveNameField = document.getElementById('zipArchiveName');
const selectFileOrDirectoryContainer = document.getElementById('selectFileOrDirectoryContainer');
const protectWithPasswordContainer = document.getElementById("protectWithPasswordContainer");
const transferGroupContainer = document.getElementById("transferGroupContainer");
const transferGroupToggleButton = document.querySelector('[data-target="#expandableDiv0"]');
const transferGroupCollapsibleDiv = document.getElementById('expandableDiv0');
const mmProgressBarContainer = document.getElementById("mmProgressBarContainer");
const mmDownloadProgress = document.getElementById("mmDownloadProgress");
const mmProgressPercentage = document.getElementById("mmProgressPercentage");
const copyPastContainer = document.getElementById('copy-past-container')
const pastArea = document.getElementById('pasteArea')
const videoRecorderContainer = document.getElementById('video-recorder-container');
const fileSelectorContainer = document.getElementById('file-selector-container');
const copyPastName = document.getElementById('copyPastName')
const readMeTextMemo = document.getElementById("readMeTextMemo");
const textMessageContainer = document.getElementById("textMessageContainer");
const textMessageMemo = document.getElementById('textMessageMemo');
const saveTextMessageBtn = document.getElementById('saveTextMessageBtn');
fileInput.addEventListener('change', processSelectedFiles);

passwordField.value = null;
encryptFileContentCheckbox.checked = false;
passwordField.addEventListener('input', passwordFieldWasChangedHandler);

function passwordFieldWasChangedHandler() {
    if (passwordField.value.trim() !== '') {
        encryptFileContentCheckbox.checked = false;
        encryptFileContentCheckbox.parentElement.style.display = 'none'; // Show checkbox
    } else {
        encryptFileContentCheckbox.checked = false;
        encryptFileContentCheckbox.parentElement.style.display = 'none'; // Hide checkbox
    }
}

function openModal(contentType, showForce = false) {
    AddBinaryWidget.contentType = contentType;

    readMeTextMemo.textContent = Fileshare.defaultReadMeText;
    shareFromDeviceCheckbox.checked = false;
    shareFromDeviceWarning.style.display = 'none';
    createZipArchiveCheckbox.checked = false;
    protectWithPasswordContainer.style.display = 'block';
    document.getElementById('fileChoice').checked = true;
    transferGroupContainer.style.display = 'none';
    passwordFieldWasChangedHandler();

    addBinaryPopup.style.display = 'block';
    if (ContentType.FILE === contentType) {
        fileSelectorContainer.style.display = 'block';
        document.addEventListener("keydown", selectFileIfEnterWasPressed);
    }
    if (ContentType.VIDEO === contentType) {
        videoRecorderContainer.style.display = 'block';
        VideoPlayer.contentType = ContentType.VIDEO
        setFocusToRecordBtn();
    }
    if (ContentType.AUDIO === contentType) {
        const videoPlayer = document.getElementById('videoPlayer');
        videoPlayer.style.height = '120px';
        videoRecorderContainer.style.display = 'block';
        VideoPlayer.contentType = ContentType.AUDIO
        setFocusToRecordBtn();
    }
    if (ContentType.COPY_PAST === contentType) {
        copyPastContainer.style.display = 'block';
        pastArea.focus();
    }
    if (ContentType.TEXT_MESSAGE === contentType) {
        textMessageContainer.style.display = 'block';
        textMessageMemo.focus();
    }
    if (ContentType.FILE_TRANSFER === contentType) {
        protectWithPasswordContainer.style.display = 'none';
        transferGroupContainer.style.display = 'block';
        fileSelectorContainer.style.display = 'block';
        document.addEventListener("keydown", selectFileIfEnterWasPressed);
        if (Fileshare.properties) {
            if (Fileshare.properties.transferGroup) {
                postJoinTransferGroupActions();
            } else {
                postLeaveTransferGroupActions();
            }
        }
        if (showForce) {
            transferGroupCollapsibleDiv.classList.add('show');
        }
    }
}

function selectFileIfEnterWasPressed(event) {
    if (event.key === "Enter") {
        fileInput.click();
    }
}

saveTextMessageBtn.addEventListener('click', async function () {
    alert(textMessageMemo.textContent);
    const mimeType = 'text/plain';
    const name = `text-${new Date().getTime()}.txt`;
    let textBlob = new Blob([textMessageMemo.textContent], {type: 'text/plain'});
    await SaveInCloudHelper.cacheBlobInCloud(
        name,
        mimeType,
        readMeTextMemo.textContent,
        textBlob,
        !shareFromDeviceCheckbox.checked,
        passwordField.value.trim());
    delay(500).then(() => {
        closeModal();
        textBlob = null;
    });
});
pastArea.addEventListener('focus', function () {
    pastArea.style.color = 'blue';
    pastArea.value = 'Press Ctrl+V to past content'
    pastArea.setSelectionRange(0, 0);
});

pastArea.addEventListener('blur', function () {
    pastArea.style.color = 'gray';
    pastArea.value = ''
});

pastArea.addEventListener('keydown', function (event) {
    const isCtrlV = (event.ctrlKey || event.metaKey) && event.key === 'v';

    if (!isCtrlV) {
        event.preventDefault();
    }
});

function afterTransferDoneHandler() {
    createZipArchiveCheckbox.checked = false;
    hideZipArchiveRelatedElements();
    fileInput.value = "";
    mmProgressBarContainer.style.display = 'none';
}

function closeModal() {
    hideSpinnerInButton();
    addBinaryPopup.style.display = 'none';
    createZipArchiveCheckbox.checked = false;
    hideZipArchiveRelatedElements();
    videoRecorderContainer.style.display = 'none';
    fileSelectorContainer.style.display = 'none';
    copyPastContainer.style.display = 'none';
    transferGroupContainer.style.display = 'none';
    fileInput.value = "";
    videoPlayer.style.height = '200px';
    document.removeEventListener("keydown", selectFileIfEnterWasPressed);
    mmProgressBarContainer.style.display = 'none';
    textMessageMemo.textContent = '';
    textMessageContainer.style.display = 'none';
}

function resetFileInputElement() {
    const newFileInput = document.createElement("input");
    newFileInput.type = "file";
    newFileInput.id = "fileInput";
    newFileInput.style.display = "none";
    newFileInput.multiple = true;
    newFileInput.addEventListener('change', processSelectedFiles);

    fileInput.parentNode.replaceChild(newFileInput, fileInput);
}

// Add paste event listener to the hidden textarea
pastArea.addEventListener('paste', async function (event) {
    const clipboardItems = event.clipboardData.items;

    for (let item of clipboardItems) {
        // Check if the clipboard item is a file (binary data)
        if (item.kind === 'file') {
            const blob = item.getAsFile();
            const mimeType = blob.type;
            const name = getCopyPastName(mimeType, blob.name);
            await SaveInCloudHelper.cacheBlobInCloud(
                name,
                mimeType,
                readMeTextMemo.textContent,
                blob,
                !shareFromDeviceCheckbox.checked,
                passwordField.value.trim());
            delay(500).then(() => {
                closeModal();
            });
        } else {
            event.stopPropagation();
            event.preventDefault();
        }
    }
});

function getCopyPastName(mimeType, blobName) {
    let ext = "";
    if (mimeType.includes('png')) {
        ext = '.png';
    }
    if (mimeType.includes('bmp')) {
        ext = '.bmp';
    }
    const vName = copyPastName.value;
    if (vName) {
        return `${vName}${ext}`;
    }
    const prefix = blobName ? blobName : 'binary';
    return `${prefix}-${new Date().getTime()}${ext}`
}

closeButton.addEventListener('click', closeModal);

// Add event listener to the modal itself to close it when clicked outside
window.addEventListener('click', (event) => {
    if (event.target === addBinaryPopup) {
        //closeModal();
    }
});

shareFromDeviceCheckbox.addEventListener('change', shareFromDeviceStateWasChanged);

function shareFromDeviceStateWasChanged() {
    if (shareFromDeviceCheckbox.checked) {
        shareFromDeviceWarning.style.display = 'block';
    } else {
        shareFromDeviceWarning.style.display = 'none';
    }
}

createZipArchiveCheckbox.addEventListener('change', function () {
    if (this.checked) {
        showZipArchiveRelatedElements();
    } else {
        hideZipArchiveRelatedElements();
    }
});

function showZipArchiveRelatedElements() {
    zipArchiveNameField.style.display = 'block';
    selectFileOrDirectoryContainer.style.display = 'flex';
}

function hideZipArchiveRelatedElements() {
    zipArchiveNameField.style.display = 'none';
    fileInput.removeAttribute('webkitdirectory');
    fileInput.setAttribute('multiple', '');
    document.getElementById('fileChoice').checked = true;
    selectFileOrDirectoryContainer.style.display = 'none';
}

document.querySelectorAll('input[name="choice"]').forEach((element) => {
    element.addEventListener('change', function () {
        if (this.value === 'file') {
            fileInput.removeAttribute('webkitdirectory');
            fileInput.setAttribute('multiple', '');
        } else if (this.value === 'directory') {
            fileInput.removeAttribute('multiple');
            fileInput.setAttribute('webkitdirectory', '');
        }
    });
});


async function blobToArrayBuffers(blob, chunkSize) {
    const arrayBuffers = [];
    const totalSize = blob.size;
    let offset = 0;

    while (offset < totalSize) {
        const chunk = blob.slice(offset, offset + chunkSize);
        const arrayBuffer = await chunk.arrayBuffer();
        arrayBuffers.push(arrayBuffer);
        offset += chunkSize;
    }

    return arrayBuffers;
}

function showSpinnerInButton() {
    document.getElementById('download-spinner').style.display = 'flex';
    document.getElementById('download-message').textContent = 'Loading...';
}

function hideSpinnerInButton() {
    document.getElementById('download-spinner').style.display = 'none';
    document.getElementById('download-message').textContent = '';
}

async function processSelectedFiles(event) {
    await processListOfFiles(event.target.files);
}

function replaceExtensionWithZip(filename) {
    return filename.replace(/\.[^/.]+$/, ".zip");
}

async function processListOfFiles(files) {
    if (ContentType.FILE_TRANSFER !== AddBinaryWidget.contentType) {
        showSpinnerInButton();
    }
    //create zip archive
    if (createZipArchiveCheckbox.checked) {
        if (files.length === 0) {
            return;
        }
        if (ContentType.FILE_TRANSFER === AddBinaryWidget.contentType) {
            showSpinnerInButton();
        }
        let zipArchiveName = zipArchiveNameField.value;
        if (!zipArchiveName) {
            const file0 = files[0];
            zipArchiveName = file0.webkitRelativePath ? file0.webkitRelativePath.split('/')[0] : `zip-with-${file0.name}`;
            zipArchiveName = replaceExtensionWithZip(zipArchiveName);
        }
        if (!zipArchiveName.includes('.zip')) {
            zipArchiveName = zipArchiveName + '.zip';
        }
        const zip = new JSZip();
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            await zip.file(file.name, file);
        }

        // Generate the zip file as a Blob
        const zipBlob = await zip.generateAsync({type: "blob"});
        if (ContentType.FILE_TRANSFER === AddBinaryWidget.contentType) {
            hideSpinnerInButton();
            await TransferFileHelper.transferBlob(
                zipBlob, zipArchiveName, "application/zip",
                transferGroupName.value, transferGroupPasswordInput.value
            )
        } else {
            hideSpinnerInButton();
            await SaveInCloudHelper.cacheBlobInCloud(
                zipArchiveName,
                "application/zip",
                readMeTextMemo.textContent,
                zipBlob,
                !shareFromDeviceCheckbox.checked,
                passwordField.value.trim());
        }
    } else {
        for (let i = 0; i < files.length; i++) {
            await addFileToRegistry(files[i]);
        }
    }
    if (ContentType.FILE_TRANSFER === AddBinaryWidget.contentType) {
        afterTransferDoneHandler();
    } else {
        delay(500).then(() => closeModal());
    }
}

async function addFileToRegistry(file) {
    if (!file) {
        return false;
    }
    if (ContentType.FILE_TRANSFER === AddBinaryWidget.contentType) {
        return TransferFileHelper.transferFile(file, transferGroupName.value, transferGroupPasswordInput.value);
    }

    hideSpinnerInButton();
    return await SaveInCloudHelper.cacheFileInCloud(
        file,
        readMeTextMemo.textContent,
        !shareFromDeviceCheckbox.checked,
        passwordField.value.trim()
    );
}

async function readFileToChunkArray(file) {
    const fileSize = file.size;
    let offset = 0;
    let sliceNumber = 0;
    const slices = [];

    function readNextChunk() {
        const reader = new FileReader();

        reader.onload = function (e) {
            const arrayBuffer = e.target.result;
            slices.push(arrayBuffer);

            offset += MemoryBlock.MB100;
            sliceNumber++;

            if (offset < fileSize) {
                readNextChunk();
            } else {
                console.log('File read completed.');
            }
        };

        reader.onerror = function (e) {
            console.error("Error reading file:", e);
        };

        const blob = file.slice(offset, offset + MemoryBlock.MB100);
        reader.readAsArrayBuffer(blob);
    }

    readNextChunk();

    while (slices.length < Math.ceil(Math.ceil(fileSize / MemoryBlock.MB100))) {
        await delay(100);
    }

    return slices;
}

async function createAndStoreBinaryFromSlices(inSlices, binaryId, binaryName, mimeType) {
    try {
        //===============encryption=====================================================================================
        let slices = inSlices;
        let encryptionContract = null;

        if (encryptFileContentCheckbox.checked) {
            const encryptionData = await encryptSlicesWithAES(inSlices);
            slices = await blobToArrayBuffers(encryptionData.data, MemoryBlock.MB100);
            encryptionContract = encryptionData.encryptionContract;
        }
        //==============================================================================================================
        let tmpManifest;
        let result;
        if (passwordField.value) {
            result = await createBinaryManifest(binaryId, binaryName, mimeType, readMeTextMemo.textContent, passwordField.value, encryptionContract);
        } else {
            result = await createBinaryManifest(binaryId, binaryName, mimeType, readMeTextMemo.textContent, null, null);
        }
        if ((WaiterResponseType.SUCCESS === result.type) && result.body) {
            tmpManifest = result.body;
        }
        if (!tmpManifest) {
            console.log(`Cannot create binary manifest: ${binaryName}`);
            return false;
        }
        //console.log('new manifest');
        //console.log(tmpManifest);
        for (let i = 0; i < slices.length; i++) {
            tmpManifest = await addBinaryToStorage(binaryId, binaryName, mimeType, slices[i], i, tmpManifest);
            if (tmpManifest === null) {
                removeBinary(binaryId, function () {
                    console.log(`Binary with id ${binaryId} was completely removed from DB`);
                });
                return false;
            }
        }
        await PushcaClient.cacheBinaryChunkInCloud(
            binaryId,
            1_000_000,
            stringToArrayBuffer(
                arrayBufferToBase64(
                    stringToArrayBuffer(JSON.stringify(tmpManifest.toJSON()))
                )
            )
        );
        addManifestToManagerGrid(tmpManifest);
    } catch (err) {
        console.warn(err);
        return false;
    }
}