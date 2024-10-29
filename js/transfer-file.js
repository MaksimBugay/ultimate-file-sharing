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

TransferFileHelper.processedReceivedChunk = async function (binaryWithHeader) {
    if (binaryWithHeader.order === 0) {
        const manifest = FileTransferManifest.fromBinary(binaryWithHeader.payload);
        console.log(JSON.stringify(manifest.toJSON()));

        const totalNumberOfChunks = Math.ceil(Math.ceil(manifest.size / MemoryBlock.MB));
        TransferFileHelper.registry.set(binaryWithHeader.binaryId, new Array(totalNumberOfChunks).fill(null));
        // Define a stream to manage chunked downloads
        const stream = new ReadableStream({
            async start(controller) {
                let index = 0;
                while (index < totalNumberOfChunks) {
                    const chunk = await getChunk(manifest.id, index);
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

        consentDialog.classList.add('visible');
        allowClipboard.addEventListener('click', async function () {
            // Requesting clipboard access on user interaction
            try {
                downloadBinaryStream(response, manifest.name, manifest.size);
                consentDialog.classList.remove('visible');
            } catch (err) {
                console.error("Failed receive transferred file operation: ", err);
                consentDialog.classList.remove('visible');
            }
        });

        /*const blob = await response.blob();
        const url = URL.createObjectURL(blob);

        // Create a downloadable link
        const link = document.createElement('a');
        link.href = url;
        link.download = manifest.name;
        link.click();
        // Revoke the object URL after the download
        URL.revokeObjectURL(url);*/
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
    while (!receiveQueue[order]) {
        await delay(100);
    }
    if (order > 0) {
        receiveQueue[order - 1] = null;
    }
    return receiveQueue[order];
}

async function downloadBinaryStream(response, binaryFileName, contentLength) {
    const reader = response.body.getReader();

    // Open the file for writing
    const options = {
        suggestedName: binaryFileName
    };
    const fileHandle = await window.showSaveFilePicker(options);
    const writable = await fileHandle.createWritable();
    //showDownloadProgress();

    let writtenBytes = 0;

    while (true) {
        const {value, done} = await reader.read();

        if (done) {
            break;
        }

        await writable.write({type: 'write', data: value});
        writtenBytes += value.byteLength;

        // Optional progress update
        if (contentLength) {
            const percentComplete = Math.round((writtenBytes / contentLength) * 100);
            console.log(`Download progress: ${percentComplete}`);
            //progressBar.value = percentComplete;
            //progressPercentage.textContent = `${percentComplete}%`;
        } else {
            // If content-length is not available, we can't calculate progress
            //progressBar.removeAttribute('value');
        }
    }

    // Close the writable stream
    await writable.close();

    console.log(`File downloaded to: ${fileHandle.name}`);
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

            offset += MemoryBlock.MB;
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

        const blob = file.slice(offset, offset + MemoryBlock.MB);
        reader.readAsArrayBuffer(blob);
    }

    readNextChunk();

    while (sliceNumber < Math.ceil(Math.ceil(fileSize / MemoryBlock.MB))) {
        await delay(100);
    }
}
