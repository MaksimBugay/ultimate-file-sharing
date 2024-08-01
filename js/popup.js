const fileInput = document.getElementById('fileInput');
fileInput.addEventListener('change', processSelectedFile);

const port = chrome.runtime.connect();
window.addEventListener('unload', () => {
    port.disconnect();
});

FingerprintJS.load().then(fp => {
    fp.get().then(result => {
        openDataBase(result.visitorId);
    });
});

document.getElementById("copy-link-btn").addEventListener('click', function () {
    chrome.runtime.sendMessage({action: 'save-file'}, (response) => {
        if (response && response.fileName) {
            alert(response.fileName);
        }
    });
});

function processSelectedFile(event) {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();

        reader.onload = function (e) {
            const arrayBuffer = e.target.result;
            saveBinary(
                uuid.v4().toString(),
                file.name,
                arrayBuffer,
                file.type
            );
        };

        reader.onerror = function (e) {
            console.error("Error reading file:", e);
        };

        reader.readAsArrayBuffer(file);
    } else {
        console.error("No file selected");
    }
}

function saveBinary(binaryId, originalFileName, arrayBuffer, mimeType) {
    addBinaryToStorage(binaryId, originalFileName, mimeType, arrayBuffer).then((binaryManifest) => {
        console.log(JSON.stringify(binaryManifest.toJSON()));
        loadAllBinaryChunks(binaryId, binaryManifest.datagrams.length,
            function (loadedChunks) {
                downloadBinary(loadedChunks, originalFileName, mimeType);
            });
    })
}

async function loadAllBinaryChunks(binaryId, totalNumberOfChunks, chunksConsumer) {
    const chunks = [];

    let order = 0;

    while (order < totalNumberOfChunks) {
        const result = await loadBinaryChunk(binaryId, order);
        if ((WaiterResponseType.SUCCESS === result.type) && result.body) {
            chunks.push(result.body);
        } else {
            console.error(`Binary data is corrupted or cannot be loaded: binaryId = ${binaryId}, order = ${order}`);
            return;
        }
        order += 1;
    }

    if (typeof chunksConsumer === 'function') {
        chunksConsumer(chunks);
    }
}

async function loadBinaryChunk(binaryId, order) {
    return await CallableFuture.callAsynchronously(3000, null, function (waiterId) {
        getBinaryChunk(binaryId, order, function (chunkBlob) {
            CallableFuture.releaseWaiterIfExistsWithSuccess(waiterId, chunkBlob);
        });
    });
}
