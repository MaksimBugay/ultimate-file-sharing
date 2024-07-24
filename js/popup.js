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
                0,
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

function saveBinary(binaryId, order, originalFileName, arrayBuffer, mimeType) {

    const chunks = splitArrayBuffer(arrayBuffer, MemoryBlock.MB);

    for (let order = 0; order < chunks.length; order++) {
        const chunkId = buildSharedFileChunkId(binaryId, order);
        const blob = new Blob([chunks[order]], {type: mimeType});
        addBinaryChunk(chunkId, blob);
    }

    loadAllBinaryChunks(binaryId, chunks.length,
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
    let timeoutMs = 3000;

    let timeout = (ms) => new Promise((resolve, reject) => {
        setTimeout(() => reject(new Error('Timeout after ' + ms + ' ms')), ms);
    });

    let result;
    getBinaryChunk(chunkId, function (chunkBlob) {
        CallableFuture.releaseWaiterIfExistsWithSuccess(chunkId, chunkBlob);
    });

    try {
        result = await Promise.race([
            CallableFuture.addToWaitingHall(chunkId),
            timeout(timeoutMs)
        ]);
    } catch (error) {
        CallableFuture.waitingHall.delete(chunkId);
        result = new WaiterResponse(WaiterResponseType.ERROR, error);
    }
    return result;
}

function buildSharedFileChunkId(binaryId, order) {
    return `${binaryId}_${order}`;
}