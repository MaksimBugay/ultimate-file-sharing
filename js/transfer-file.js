class FileTransferManifest {
    constructor(id, name, type, size, originatorDeviceId) {
        this.id = id ? id : uuid.v4().toString();
        this.name = name;
        this.type = type;
        this.size = size;
        this.originatorDeviceId = originatorDeviceId;
    }

    toJSON() {
        return {
            id: this.id,
            name: this.name,
            type: this.type,
            size: this.size,
            originatorDeviceId: this.originatorDeviceId
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
            jsonObject.size,
            jsonObject.originatorDeviceId
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
TransferFileHelper.preparedFile = [];

const ftDownloadProgress = document.getElementById("ftDownloadProgress");
const ftProgressPercentage = document.getElementById("ftProgressPercentage");
const ftProgressBarContainer = document.getElementById("ftProgressBarContainer");
const acceptFileTransferDialog = document.getElementById("acceptFileTransferDialog");
const joinTransferGroupDialog = document.getElementById('joinTransferGroupDialog');
const allowJoinTransferGroupBtn = document.getElementById('allowJoinTransferGroupBtn');
const denyJoinTransferGroupBtn = document.getElementById('denyJoinTransferGroupBtn');
const jtgDeviceId = document.getElementById('jtgDeviceId');
const acceptFileTransferBtn = document.getElementById("acceptFileTransferBtn");
const denyFileTransferBtn = document.getElementById("denyFileTransferBtn");
const ftrName = document.getElementById("ftrName");
const ftrType = document.getElementById("ftrType");
const ftrSize = document.getElementById("ftrSize");
const ftrOriginatorDeviceId = document.getElementById("ftrOriginatorDeviceId");

joinTransferGroupDialog.addEventListener("click", (event) => {
    if (event.target === acceptFileTransferDialog) {
        event.stopPropagation(); // Prevent click from propagating if outside dialog
    }
});

function showJoinTransferGroupDialog(waiterId, deviceId) {
    jtgDeviceId.textContent = deviceId;
    const allowHandler = function () {
        CallableFuture.releaseWaiterIfExistsWithSuccess(waiterId, true);
        cleanUp();
        hideJoinTransferGroupDialog();
    }
    const denyHandler = function () {
        CallableFuture.releaseWaiterIfExistsWithSuccess(waiterId, false);
        cleanUp();
        hideJoinTransferGroupDialog();
    }

    function cleanUp() {
        allowJoinTransferGroupBtn.removeEventListener('click', allowHandler);
        denyJoinTransferGroupBtn.removeEventListener('click', denyHandler);
    }

    allowJoinTransferGroupBtn.addEventListener('click', allowHandler);
    denyJoinTransferGroupBtn.addEventListener('click', denyHandler);
    joinTransferGroupDialog.classList.add('visible');
}

function isJoinTransferGroupDialogVisible() {
    return joinTransferGroupDialog.classList.contains('visible');
}

function hideJoinTransferGroupDialog() {
    joinTransferGroupDialog.classList.remove('visible');
}

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
        if (!(Fileshare.properties && Fileshare.properties.transferGroup)) {
            console.warn("Transfer group is not defined but transfer request was received");
            return;
        }
        const transferGroupPassword = Fileshare.properties.transferGroupPassword;
        const transferGroup = Fileshare.properties.transferGroup;
        let encryptionContract;
        let manifest;
        try {
            const tRequestStr = byteArrayToString(binaryWithHeader.payload);
            const parts = tRequestStr.split("|");
            encryptionContract = await EncryptionContract.fromTransferableString(
                parts[1],
                transferGroupPassword ? transferGroupPassword : `TRANSFER_GROUP_${transferGroup}`,
                stringToByteArray(transferGroup)
            );
            const payload = await decryptAESToArrayBuffer(
                base64ToArrayBuffer(parts[0]),
                encryptionContract.base64Key,
                encryptionContract.base64IV
            );
            manifest = FileTransferManifest.fromBinary(payload);
            console.log(JSON.stringify(manifest.toJSON()));
        } catch (err) {
            showErrorMsg("Unrecognized file transfer request was received");
            console.error("Broken file transfer request", err);
        }

        const totalNumberOfChunks = Math.ceil(manifest.size / TransferFileHelper.blockSize);
        TransferFileHelper.registry.set(
            binaryWithHeader.binaryId,
            {
                encryptionContract: encryptionContract,
                data: new Array(totalNumberOfChunks).fill(null)
            }
        );
        // Define a stream to manage chunked downloads
        const stream = new ReadableStream({
            async start(controller) {
                let index = 0;
                while (index < totalNumberOfChunks) {
                    const chunk = await getChunk(manifest.id, index);
                    if (!chunk) {
                        controller.signal.aborted;
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

        while (isAcceptFileTransferDialogVisible()) {
            await delay(500);
        }

        TransferFileHelper.saveTransfer = async function () {
            requestWakeLock();
            if (window.showSaveFilePicker) {
                await downloadBinaryStream(response, manifest.name, manifest.size);
            } else {
                await downloadBinaryStreamSilently(response, manifest.name, manifest.size, manifest.type);
            }
            releaseWakeLock();
        }
        TransferFileHelper.cleanTransfer = function () {
            TransferFileHelper.registry.delete(manifest.id);
        }

        ftrName.textContent = manifest.name;
        ftrType.textContent = manifest.type;
        ftrSize.textContent = `${Math.round((manifest.size * 100) / MemoryBlock.MB) / 100}`;
        ftrOriginatorDeviceId.textContent = manifest.originatorDeviceId;
        showAcceptFileTransferDialog();
    } else {
        const receiveQueue = TransferFileHelper.registry.get(binaryWithHeader.binaryId);
        if (receiveQueue) {
            receiveQueue.data[binaryWithHeader.order - 1] = binaryWithHeader.payload;
        } else {
            console.warn(`Unassigned transferred chunk was received: binaryId = ${binaryWithHeader.binaryId}, order = ${binaryWithHeader.order}`);
        }
    }
}

async function getChunk(binaryId, order, maxWaitTime = 60000) {
    const receiveQueue = TransferFileHelper.registry.get(binaryId);
    if (!receiveQueue) {
        return null;
    }
    const startTime = Date.now();
    while (!receiveQueue.data[order]) {
        if (Date.now() - startTime >= maxWaitTime) {
            showErrorMsg("Transferred data is unavailable", function () {
                TransferFileHelper.registry.delete(binaryId);
            });
            return null;
        }
        await delay(100);
    }
    if (order > 0) {
        receiveQueue.data[order - 1] = null;
    }
    const encChunk = receiveQueue.data[order];

    return decryptAESToArrayBuffer(
        encChunk,
        receiveQueue.encryptionContract.base64Key,
        receiveQueue.encryptionContract.base64IV
    );
}

function showAcceptFileTransferDialog() {
    acceptFileTransferDialog.classList.add('visible');
}

function isAcceptFileTransferDialogVisible() {
    return acceptFileTransferDialog.classList.contains('visible');
}

function hideAcceptFileTransferDialog() {
    hideDownloadProgress();
    acceptFileTransferDialog.classList.remove('visible');
}

function showDownloadProgress() {
    ftProgressBarContainer.style.display = 'block';
    acceptFileTransferBtn.style.display = 'none';
    denyFileTransferBtn.style.display = 'none';
}

function hideDownloadProgress() {
    ftProgressBarContainer.style.display = 'none';
    acceptFileTransferBtn.style.display = '';
    denyFileTransferBtn.style.display = '';
    ftDownloadProgress.value = 0;
    ftProgressPercentage.textContent = `0%`;
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

async function sendTransferManifest(ftManifest, transferGroup, transferGroupPassword) {
    const transferGroupId = calculateStringHashCode(transferGroup);
    const encryptionData = await encryptWithAES(ftManifest.toBinaryChunk());
    const transferableEncryptionContract = await encryptionData.encryptionContract.toTransferableString(
        transferGroupPassword ? transferGroupPassword : `TRANSFER_GROUP_${transferGroup}`,
        stringToByteArray(transferGroup)
    );

    const result = await PushcaClient.transferBinaryChunk(
        ftManifest.id,
        0,
        transferGroupId,
        stringToArrayBuffer(`${encryptionData.dataBase64}|${transferableEncryptionContract}`)
    );

    return {
        result: result,
        encryptionContract: encryptionData.encryptionContract,
        transferGroupId: transferGroupId
    }
}

TransferFileHelper.transferFile = async function transferFile(file, transferGroup, transferGroupPassword) {
    const ftManifest = new FileTransferManifest(
        null, file.name, file.type, file.size, IndexDbDeviceId
    );
    const encAndSendResult = await sendTransferManifest(
        ftManifest,
        transferGroup,
        transferGroupPassword
    );
    if (WaiterResponseType.ERROR === encAndSendResult.result.type) {
        showErrorMsg("Failed file transfer attempt: all group members are unavailable. Open https://secure.fileshare.ovh on receiver's side and join the group", null);
        return false;
    }

    return await readFileSequentially(file, async function (order, arrayBuffer) {
        //console.log(`Send chunk ${order}`);
        const result = await encryptAndTransferBinaryChunk(
            ftManifest.id,
            order,
            encAndSendResult.transferGroupId,
            arrayBuffer,
            encAndSendResult.encryptionContract
        );
        return WaiterResponseType.SUCCESS === result.type
    }, "Failed file transfer attempt: all group members are unavailable. Open https://secure.fileshare.ovh on receiver's side and join the group");
}

TransferFileHelper.transferBlob = async function transferBlob(blob, name, type, transferGroup, transferGroupPassword) {
    const ftManifest = new FileTransferManifest(
        null, name, type, blob.size, IndexDbDeviceId
    );
    const encAndSendResult = await sendTransferManifest(
        ftManifest,
        transferGroup,
        transferGroupPassword
    );
    if (WaiterResponseType.ERROR === encAndSendResult.result.type) {
        console.error(`Failed file transfer attempt: ${name}`);
        return false;
    }

    await executeWithShowProgressBar(async function () {
        const slices = await blobToArrayBuffers(blob, TransferFileHelper.blockSize);
        for (let i = 0; i < slices.length; i++) {
            const result = await encryptAndTransferBinaryChunk(
                ftManifest.id,
                i + 1,
                encAndSendResult.transferGroupId,
                slices[i],
                encAndSendResult.encryptionContract
            );
            if (WaiterResponseType.ERROR === result.type) {
                console.error(`Failed file transfer attempt: ${name}`);
                return false;
            }
            const progress = Math.round(((i + 1) / slices.length) * 100);
            mmDownloadProgress.value = progress;
            mmProgressPercentage.textContent = `${progress}%`;
        }
    });
}

async function readFileSequentially(file, chunkHandler, errorMsg) {
    const fileSize = file.size;
    let offset = 0;
    let sliceNumber = 0;
    let pipeWasBroken = false;

    async function readNextChunk() {
        const reader = new FileReader();

        reader.onload = async function (e) {
            const arrayBuffer = e.target.result;

            offset += TransferFileHelper.blockSize;
            sliceNumber++;

            let chunkHandlerResult = true;
            if (typeof chunkHandler === 'function') {
                chunkHandlerResult = await chunkHandler(sliceNumber, arrayBuffer);
            }

            if (chunkHandlerResult) {
                if (offset < fileSize) {
                    await readNextChunk();
                } else {
                    console.log('File read completed.');
                }
            } else {
                pipeWasBroken = true;
                console.log('Failed file chunk transfer attempt.');
                showErrorMsg(
                    errorMsg,
                    function () {
                        mmDownloadProgress.value = 0;
                        mmProgressPercentage.textContent = `0%`;
                        afterTransferDoneHandler();
                    }
                );
            }
        };

        reader.onerror = function (e) {
            console.error("Error reading file:", e);
        };

        const blob = file.slice(offset, offset + TransferFileHelper.blockSize);
        reader.readAsArrayBuffer(blob);
    }

    await executeWithShowProgressBar(async function () {
        readNextChunk();

        const totalNumberOfSlices = Math.ceil(fileSize / TransferFileHelper.blockSize)
        while ((!pipeWasBroken) && (sliceNumber < totalNumberOfSlices)) {
            const progress = Math.round((sliceNumber / totalNumberOfSlices) * 100);
            mmDownloadProgress.value = progress;
            mmProgressPercentage.textContent = `${progress}%`;
            await delay(100);
        }
    });

    return !pipeWasBroken;
}

async function executeWithShowProgressBar(operation) {
    requestWakeLock();
    mmProgressBarContainer.style.display = 'block';
    if (typeof operation === 'function') {
        await operation();
    }
    mmDownloadProgress.value = 0;
    mmProgressPercentage.textContent = `0%`;
    mmProgressBarContainer.style.display = 'none';
    releaseWakeLock();
}

async function encryptAndTransferBinaryChunk(binaryId, order, destHashCode, arrayBuffer, encryptionContract) {
    const encArrayBuffer = await encryptWithAESUsingContract(arrayBuffer, encryptionContract);

    return await PushcaClient.transferBinaryChunk(
        binaryId,
        order,
        destHashCode,
        encArrayBuffer
    );
}
