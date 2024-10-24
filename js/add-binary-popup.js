const ContentType = Object.freeze({
    FILE: 0,
    LIVE_STREAM: 1,
    VIDEO: 2,
    COPY_PAST: 3,
    AUDIO:4
});

const addBinaryPopup = document.getElementById("addBinaryPopup");
const closeButton = document.querySelector('.close');

const fileInput = document.getElementById('fileInput');
const passwordField = document.getElementById('passwordInput');
const encryptFileContentCheckbox = document.getElementById('encryptFileContentCheckbox');
const createZipArchiveCheckbox = document.getElementById('createZipArchiveCheckbox');
const zipArchiveNameField = document.getElementById('zipArchiveName');
const selectFileLabel = document.getElementById('selectFileLabel');
const selectFileOrDirectoryContainer = document.getElementById('selectFileOrDirectoryContainer');
const copyPastContainer = document.getElementById('copy-past-container')
const pastArea = document.getElementById('pasteArea')
const videoRecorderContainer = document.getElementById('video-recorder-container');
const fileSelectorContainer = document.getElementById('file-selector-container');
const copyPastName = document.getElementById('copyPastName')
fileInput.addEventListener('change', processSelectedFiles);

passwordField.value = null;
encryptFileContentCheckbox.checked = false;
passwordField.addEventListener('input', function () {
    if (passwordField.value.trim() !== '') {
        encryptFileContentCheckbox.parentElement.style.display = 'block'; // Show checkbox
    } else {
        encryptFileContentCheckbox.checked = false;
        encryptFileContentCheckbox.parentElement.style.display = 'none'; // Hide checkbox
    }
});

function openModal(contentType) {
    addBinaryPopup.style.display = 'block';
    if (ContentType.FILE === contentType) {
        fileSelectorContainer.style.display = 'block';
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
}

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

function closeModal() {
    hideSpinnerInButton();
    addBinaryPopup.style.display = 'none';
    createZipArchiveCheckbox.checked = false;
    hideZipArchiveRelatedElements();
    videoRecorderContainer.style.display = 'none';
    fileSelectorContainer.style.display = 'none';
    copyPastContainer.style.display = 'none';
    fileInput.value = "";
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
            // Optionally, you can do something with the blob, like creating an image URL
            showSpinnerInButton();
            const binaryId = uuid.v4().toString();
            const slices = await blobToArrayBuffers(blob, MemoryBlock.MB100);
            await createAndStoreBinaryFromSlices(slices, binaryId, getCopyPastName(mimeType), mimeType);
            delay(500).then(() => {
                slices.length = 0;
                closeModal();
            });
            /*// Append the image to the output div
            const url = URL.createObjectURL(blob);
            const img = document.createElement('img');
            img.src = url;
            img.style.maxWidth = '300px';
            pastArea.parentElement.appendChild(img); */
        }
    }
});

function getCopyPastName(mimeType) {
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
    return `binary-${new Date().getTime()}${ext}`
}

closeButton.addEventListener('click', closeModal);

// Add event listener to the modal itself to close it when clicked outside
window.addEventListener('click', (event) => {
    if (event.target === addBinaryPopup) {
        closeModal();
    }
});

createZipArchiveCheckbox.addEventListener('change', function () {
    if (this.checked) {
        showZipArchiveRelatedElements();
    } else {
        hideZipArchiveRelatedElements();
    }
});

function showZipArchiveRelatedElements() {
    zipArchiveNameField.style.display = 'block';
    selectFileLabel.style.display = 'none';
    selectFileOrDirectoryContainer.style.display = 'flex';
}

function hideZipArchiveRelatedElements() {
    zipArchiveNameField.style.display = 'none';
    fileInput.removeAttribute('webkitdirectory');
    fileInput.setAttribute('multiple', '');
    document.getElementById('fileChoice').checked = true;
    selectFileLabel.style.display = 'block';
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

async function processListOfFiles(files) {
    showSpinnerInButton();
    //create zip archive
    if (createZipArchiveCheckbox.checked) {
        if (files.length === 0) {
            return;
        }
        let zipArchiveName = zipArchiveNameField.value;
        if (!zipArchiveName) {
            const file0 = files[0];
            zipArchiveName = file0.webkitRelativePath ? file0.webkitRelativePath.split('/')[0] + '.zip' : `zip-with-${file0.name}`;
        } else {
            zipArchiveName = zipArchiveName + '.zip';
        }
        const zip = new JSZip();
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            await zip.file(file.name, file);
        }

        // Generate the zip file as a Blob
        const zipBlob = await zip.generateAsync({type: "blob"});

        const binaryId = uuid.v4().toString();
        const slices = await blobToArrayBuffers(zipBlob, MemoryBlock.MB100);
        await createAndStoreBinaryFromSlices(slices, binaryId, zipArchiveName, "application/zip");
    } else {
        for (let i = 0; i < files.length; i++) {
            await addFileToRegistry(files[i]);
        }
    }
    delay(500).then(() => closeModal());
}

async function addFileToRegistry(file) {
    if (file) {
        const binaryId = uuid.v4().toString();
        const slices = await readFileToChunkArray(file);
        return await createAndStoreBinaryFromSlices(slices, binaryId, file.name, file.type);
    } else {
        return false;
    }
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

async function createAndStoreBinaryFromSlices(inSlices, binaryId, binaryName, mimeType, encryptionContract) {
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
            result = await createBinaryManifest(binaryId, binaryName, mimeType, passwordField.value, encryptionContract);
        } else {
            result = await createBinaryManifest(binaryId, binaryName, mimeType, null, null);
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
        addManifestToManagerGrid(tmpManifest);
    } catch (err) {
        console.warn(err);
        return false;
    }
}