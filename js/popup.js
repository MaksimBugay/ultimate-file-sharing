const fileInput = document.getElementById('fileInput');
fileInput.addEventListener('change', processSelectedFile);

const port = chrome.runtime.connect();
window.addEventListener('unload', () => {
    port.disconnect();
});

openDataBase(function () {
    clearAllBinaries();
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
        console.log(binaryManifest);
        loadAllBinaryChunks(binaryId, binaryManifest.datagrams.length,
            function (loadedChunks) {
                const binaryBlob = new Blob(loadedChunks, {type: mimeType});
                const url = URL.createObjectURL(binaryBlob);
                chrome.runtime.sendMessage({
                    action: 'save-file',
                    mimeType: mimeType,
                    fileName: originalFileName,
                    url: url
                }, (response) => {
                    if (response && response.downloadId) {
                        console.log(`Download id = ${response.downloadId}`);
                    }
                    URL.revokeObjectURL(url);
                });
            });
    })
}

async function loadAllBinaryChunks(binaryId, totalNumberOfChunks, chunksConsumer) {
    const chunks = [];

    let order = 0;

    while (order < totalNumberOfChunks) {
        const chunkId = buildSharedFileChunkId(binaryId, order);
        const result = await loadBinaryChunk(chunkId);
        if ((WaiterResponseType.SUCCESS === result.type) && result.body) {
            chunks.push(result.body);
        } else {
            console.error(`Binary data is corrupted or cannot be loaded: chunkId = ${chunkId}`);
            return;
        }
        order += 1;
    }

    if (typeof chunksConsumer === 'function') {
        chunksConsumer(chunks);
    }
}

async function loadBinaryChunk(chunkId) {
    return await CallableFuture.callAsynchronously(3000, null, function (waiterId) {
        getBinaryChunk(chunkId, function (chunkBlob) {
            CallableFuture.releaseWaiterIfExistsWithSuccess(waiterId, chunkBlob);
        });
    });
}

function buildSharedFileChunkId(binaryId, order) {
    return `${binaryId}_${order}`;
}