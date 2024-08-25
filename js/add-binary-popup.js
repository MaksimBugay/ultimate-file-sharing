const addBinaryPopup = document.getElementById("addBinaryPopup");
const closeButton = document.querySelector('.close');

const fileInput = document.getElementById('fileInput');
const passwordField = document.getElementById('passwordInput');
const createZipArchiveCheckbox = document.getElementById('createZipArchiveCheckbox');
const zipArchiveNameField = document.getElementById('zipArchiveName');
const selectFileLabel = document.getElementById('selectFileLabel');
const selectFileOrDirectoryContainer = document.getElementById('selectFileOrDirectoryContainer');
fileInput.addEventListener('change', processSelectedFiles);

function openModal() {
    addBinaryPopup.style.display = 'block';
}

function closeModal() {
    addBinaryPopup.style.display = 'none';
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
        zipArchiveNameField.style.display = 'block';
        selectFileLabel.style.display = 'none';
        selectFileOrDirectoryContainer.style.display = 'flex';
    } else {
        zipArchiveNameField.style.display = 'none';
        fileInput.removeAttribute('webkitdirectory');
        fileInput.setAttribute('multiple', '');
        document.getElementById('fileChoice').checked = true;
        selectFileLabel.style.display = 'block';
        selectFileOrDirectoryContainer.style.display = 'none';
    }
});

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

async function processSelectedFiles(event) {
    //create zip archive
    if (createZipArchiveCheckbox.checked) {
        if (event.target.files.length === 0) {
            return;
        }
        let zipArchiveName = zipArchiveNameField.value;
        if (!zipArchiveName) {
            const file0 = event.target.files[0];
            zipArchiveName = file0.webkitRelativePath ? file0.webkitRelativePath.split('/')[0] + '.zip' : `zip-with-${file0.name}`;
        }
        const zip = new JSZip();
        for (let i = 0; i < event.target.files.length; i++) {
            const file = event.target.files[i];
            await zip.file(file.name, file);
        }

        // Generate the zip file as a Blob
        const zipBlob = await zip.generateAsync({type: "blob"});

        const binaryId = uuid.v4().toString();
        const slices = await blobToArrayBuffers(zipBlob, MemoryBlock.MB100);
        await createAndStoreBinaryFromSlices(slices, binaryId, zipArchiveName, "application/zip");
    } else {
        for (let i = 0; i < event.target.files.length; i++) {
            await addFileToRegistry(event.target.files[i]);
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

async function createAndStoreBinaryFromSlices(slices, binaryId, binaryName, mimeType) {
    try {
        let tmpManifest;
        let result;
        if (passwordField.value) {
            result = await createBinaryManifest(binaryId, binaryName, mimeType, passwordField.value);
        } else {
            result = await createBinaryManifest(binaryId, binaryName, mimeType, null);
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