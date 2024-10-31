class FileTransferManifest {
    constructor(id, name, type, size) {
        this.id = id ? id : uuid.v4().toString();
        this.name = name;
        this.type = type;
        this.size = size;
    }

    toJSON() {
        return {
            id: this.id,
            name: this.name,
            type: this.type,
            size: this.size
        };
    }

    toBinaryChunk() {
        return stringToArrayBuffer(JSON.stringify(this.toJSON()));
    }

    static fromObject(jsonObject) {
        return new FileTransferManifest(
            jsonObject.id,
            jsonObject.name,
            jsonObject.type,
            jsonObject.size
        );
    }

    static fromJSON(jsonString) {
        const jsonObject = typeof jsonString === 'string' ? JSON.parse(jsonString) : jsonString;
        return this.fromObject(jsonObject);
    }

    static fromBinary(arrayBuffer) {
        return FileTransferManifest.fromJSON(arrayBufferToString(arrayBuffer));
    }
}

const TransferFileHelper = {}
TransferFileHelper.registry = new Map();
TransferFileHelper.blockSize = MemoryBlock.MB;

const ftDownloadProgress = document.getElementById("ftDownloadProgress");
const ftProgressPercentage = document.getElementById("ftProgressPercentage");
const ftProgressBarContainer = document.getElementById("ftProgressBarContainer");
const acceptFileTransferDialog = document.getElementById("acceptFileTransferDialog");
const acceptFileTransferBtn = document.getElementById("acceptFileTransferBtn");
const denyFileTransferBtn = document.getElementById("denyFileTransferBtn");

acceptFileTransferDialog.addEventListener("click", (event) => {
    if (event.target === acceptFileTransferDialog) {
        event.stopPropagation(); // Prevent click from propagating if outside dialog
    }
});

acceptFileTransferBtn.addEventListener('click', async function () {
    try {
        showDownloadProgress();
        await TransferFileHelper.saveTransfer().then(() => {
            TransferFileHelper.cleanTransfer();
            hideAcceptFileTransferDialog();
        });
    } catch (err) {
        console.error("Failed receive transferred file operation: ", err);
        TransferFileHelper.cleanTransfer();
        hideAcceptFileTransferDialog();
    }
});

denyFileTransferBtn.addEventListener('click', function () {
    TransferFileHelper.cleanTransfer();
    hideAcceptFileTransferDialog();
});

TransferFileHelper.processedReceivedChunk = async function (binaryWithHeader) {
    if (binaryWithHeader.order === 0) {
        const manifest = FileTransferManifest.fromBinary(binaryWithHeader.payload);
        console.log(JSON.stringify(manifest.toJSON()));

        const totalNumberOfChunks = Math.ceil(Math.ceil(manifest.size / TransferFileHelper.blockSize));
        TransferFileHelper.registry.set(binaryWithHeader.binaryId, new Array(totalNumberOfChunks).fill(null));
        // Define a stream to manage chunked downloads
        const stream = new ReadableStream({
            async start(controller) {
                let index = 0;
                while (index < totalNumberOfChunks) {
                    const chunk = await getChunk(manifest.id, index);
                    if (!chunk) {
                        break;
                    }
                    controller.enqueue(new Uint8Array(chunk));
                    index++;
                }
                controller.close();
            }
        });

        // Create a Blob URL from the stream
        const response = new Response(stream, {
            headers: {
                'Content-Type': `${manifest.type}`,
                'Content-Length': `${manifest.size.toString()}`
            }
        });

        TransferFileHelper.saveTransfer = async function () {
            if (window.showSaveFilePicker) {
                await downloadBinaryStream(response, manifest.name, manifest.size);
            } else {
                await downloadBinaryStreamSilently(response, manifest.name, manifest.size, manifest.type);
            }
        }
        TransferFileHelper.cleanTransfer = function () {
            TransferFileHelper.registry.delete(manifest.id);
        }
        showAcceptFileTransferDialog();
    } else {
        const receiveQueue = TransferFileHelper.registry.get(binaryWithHeader.binaryId);
        if (receiveQueue) {
            receiveQueue[binaryWithHeader.order - 1] = binaryWithHeader.payload;
        } else {
            console.warn(`Unassigned transferred chunk was received: binaryId = ${binaryWithHeader.binaryId}, order = ${binaryWithHeader.order}`);
        }
    }
}

async function getChunk(binaryId, order) {
    const receiveQueue = TransferFileHelper.registry.get(binaryId);
    if (!receiveQueue) {
        return null;
    }
    while (!receiveQueue[order]) {
        await delay(100);
    }
    if (order > 0) {
        receiveQueue[order - 1] = null;
    }
    return receiveQueue[order];
}

function showAcceptFileTransferDialog() {
    acceptFileTransferDialog.classList.add('visible');
}

function hideAcceptFileTransferDialog() {
    hideDownloadProgress();
    acceptFileTransferDialog.classList.remove('visible');
}

function showDownloadProgress() {
    ftProgressBarContainer.style.display = 'block';
    //TODO disable buttons here
}

function hideDownloadProgress() {
    ftProgressBarContainer.style.display = 'none';
    //TODO enable buttons here
}

async function downloadBinaryStream(response, binaryFileName, contentLength) {
    const reader = response.body.getReader();

    // Open the file for writing
    const options = {
        suggestedName: binaryFileName
    };
    const fileHandle = await window.showSaveFilePicker(options);
    const writable = await fileHandle.createWritable();

    let writtenBytes = 0;

    while (true) {
        const {value, done} = await reader.read();

        if (done) {
            break;
        }

        await writable.write({type: 'write', data: value});
        writtenBytes += value.byteLength;

        if (contentLength) {
            const percentComplete = Math.round((writtenBytes / contentLength) * 100);
            ftDownloadProgress.value = percentComplete;
            ftProgressPercentage.textContent = `${percentComplete}%`;
        } else {
            // If content-length is not available, we can't calculate progress
            ftDownloadProgress.removeAttribute('value');
            ftDownloadProgress.textContent = 'Downloading...';
        }
    }

    // Close the writable stream
    await writable.close();

    console.log(`File downloaded to: ${fileHandle.name}`);
}

async function downloadBinaryStreamSilently(response, binaryFileName, contentLength, contentType) {
    const reader = response.body.getReader();
    const chunks = [];
    let receivedLength = 0;

    while (true) {
        const {done, value} = await reader.read();
        if (done) {
            break;
        }
        chunks.push(value);
        receivedLength += value.length;

        if (contentLength) {
            const progress = Math.round((receivedLength / contentLength) * 100);
            ftDownloadProgress.value = progress;
            ftProgressPercentage.textContent = `${progress}%`;
        } else {
            // Handle case where content-length is not available
            ftDownloadProgress.removeAttribute('value');
            ftDownloadProgress.textContent = 'Downloading...';
        }
    }
    const blob = new Blob(chunks, {type: `${contentType}`});
    downloadFile(blob, binaryFileName);
}

TransferFileHelper.transferFile = async function transferFile(file, transferGroupId) {
    const ftManifest = new FileTransferManifest(null, file.name, file.type, file.size);

    const result = await PushcaClient.transferBinaryChunk(
        ftManifest.id,
        0,
        transferGroupId,
        ftManifest.toBinaryChunk()
    );
    if (WaiterResponseType.ERROR === result.type) {
        console.error(`Failed file transfer attempt: ${file.name}`);
        return false;
    }

    await readFileSequentially(file, async function (order, arrayBuffer) {
        //console.log(`Send chunk ${order}`);
        const result = await PushcaClient.transferBinaryChunk(
            ftManifest.id,
            order,
            transferGroupId,
            arrayBuffer
        );
    });
}

async function readFileSequentially(file, chunkHandler) {
    const fileSize = file.size;
    let offset = 0;
    let sliceNumber = 0;

    async function readNextChunk() {
        const reader = new FileReader();

        reader.onload = async function (e) {
            const arrayBuffer = e.target.result;

            offset += TransferFileHelper.blockSize;
            sliceNumber++;

            if (typeof chunkHandler === 'function') {
                await chunkHandler(sliceNumber, arrayBuffer);
            }

            if (offset < fileSize) {
                await readNextChunk();
            } else {
                console.log('File read completed.');
            }
        };

        reader.onerror = function (e) {
            console.error("Error reading file:", e);
        };

        const blob = file.slice(offset, offset + TransferFileHelper.blockSize);
        reader.readAsArrayBuffer(blob);
    }

    await readNextChunk();

    while (sliceNumber < Math.ceil(Math.ceil(fileSize / TransferFileHelper.blockSize))) {
        await delay(100);
    }
}
