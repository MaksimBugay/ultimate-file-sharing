document.getElementById('fileInput').addEventListener('change', processSelectedFile);

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
    const chunkId = buildSharedFileChunkId(binaryId, order, originalFileName);
    const blob = new Blob([arrayBuffer], {type: mimeType});
    addBinaryChunk(chunkId, blob);

    getBinaryChunk(chunkId, function (chunkBlob) {
        const url = URL.createObjectURL(chunkBlob);
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

function buildSharedFileChunkId(binaryId, order) {
    return `${binaryId}_${order}`;
}