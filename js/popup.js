const fileInput = document.getElementById('fileInput');
const passwordField = document.getElementById('passwordInput');
fileInput.addEventListener('change', processSelectedFiles);

const port = chrome.runtime.connect();
window.addEventListener('unload', () => {
    port.disconnect();
});

document.addEventListener('DOMContentLoaded', function () {
    chrome.runtime.sendMessage({action: 'popup-opened'});
});

FingerprintJS.load().then(fp => {
    fp.get().then(result => {
        openDataBase(result.visitorId);
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
    if (1 === 1) {
        if (event.target.files.length === 0) {
            return;
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
        return await createAndStoreBinaryFromSlices(slices, binaryId, "test.zip", "application/zip");
    }
    for (let i = 0; i < event.target.files.length; i++) {
        await addFileToRegistry(event.target.files[i]);
    }
    delay(500).then(() => window.close());
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
        tmpManifest.resetTotalSize();
        chrome.runtime.sendMessage({
            action: 'add-manifest-to-file-sharing-manager',
            manifest: JSON.stringify(tmpManifest.toDbJSON()),
            totalSize: tmpManifest.getTotalSize(),
            created: tmpManifest.created
        });
    } catch (err) {
        console.warn(err);
        return false;
    }
}