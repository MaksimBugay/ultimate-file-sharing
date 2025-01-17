const ftDownloadProgress = document.getElementById("ftDownloadProgress");
const ftProgressPercentage = document.getElementById("ftProgressPercentage");
const ftProgressBarContainer = document.getElementById("ftProgressBarContainer");
const acceptFileTransferDialog = document.getElementById("acceptFileTransferDialog");
const joinTransferGroupDialog = document.getElementById('joinTransferGroupDialog');
const allowJoinTransferGroupBtn = document.getElementById('allowJoinTransferGroupBtn');
const denyJoinTransferGroupBtn = document.getElementById('denyJoinTransferGroupBtn');
const jtgDeviceId = document.getElementById('jtgDeviceId');
const jtgVirtualHostName = document.getElementById('jtgVirtualHostName');
const jtgCity = document.getElementById('jtgCity');
const jtgProxyInfo = document.getElementById('jtgProxyInfo');
const jtgIP = document.getElementById('jtgIP');
const jtgCountry = document.getElementById('jtgCountry');
const acceptFileTransferBtn = document.getElementById("acceptFileTransferBtn");
const denyFileTransferBtn = document.getElementById("denyFileTransferBtn");
const ftrName = document.getElementById("ftrName");
const ftrType = document.getElementById("ftrType");
const ftrSize = document.getElementById("ftrSize");
const frOriginatorVirtualHost = document.getElementById("frOriginatorVirtualHost");
const transReceiverContainer = document.getElementById('transReceiverContainer');
const transGroupContainer = document.getElementById('transGroupContainer');
const virtualHost = document.getElementById('virtualHost');
const hostAsTransferTargetChoice = document.getElementById('hostAsTransferTargetChoice');
const groupAsTransferTargetChoice = document.getElementById('groupAsTransferTargetChoice');

let isUpdatingProgrammatically = false;

frOriginatorVirtualHost.addEventListener('click', function (event) {
    const alias = event.target.textContent;
    PushcaClient.connectionAliasLookup(alias).then(clientWithAlias => {
        if (clientWithAlias) {
            showHostDetailsDialog(Fileshare.workSpaceId, clientWithAlias);
        }
    });
});

virtualHost.addEventListener('click', function () {
    const value = this.value.trim();
    if (value && virtualHost.readOnly) {
        PushcaClient.connectionAliasLookup(value).then(clientWithAlias => {
            if (clientWithAlias) {
                showHostDetailsDialog(null, clientWithAlias);
            }
        });
    }
});
virtualHost.addEventListener('input', (event) => {
    if (isUpdatingProgrammatically) {
        return;
    }

    if (event.target.value.length > 3) {
        PushcaClient.connectionAliasLookup(event.target.value).then(clientWithAlias => {
            if (clientWithAlias) {
                isUpdatingProgrammatically = true;
                event.target.setAttribute('readonly', true);
                event.target.classList.add('embedded-link');
                event.target.value = clientWithAlias.alias;
                isUpdatingProgrammatically = false;
            }
        });
    }
});

function storeTmpTransferGroupForBinary(binaryId, groupName, groupPassword) {
    TransferFileHelper.tmpGroupRegistry.set(
        binaryId,
        {
            name: groupName,
            pwd: groupPassword
        }
    );
}

document.querySelectorAll('input[name="transferTargetChoice"]').forEach((element) => {
    element.addEventListener('change', function () {
        virtualHost.value = null;
        setTransferTargetChoice(this.value);
    });
});

function setTransferTargetChoice(choiceName) {
    if (choiceName === TransferTargetType.HOST) {
        hostAsTransferTargetChoice.checked = true;
        transReceiverContainer.style.display = 'block';
        transGroupContainer.style.display = 'none';
        virtualHost.focus();
    } else if (choiceName === TransferTargetType.GROUP) {
        groupAsTransferTargetChoice.checked = true;
        transReceiverContainer.style.display = 'none';
        transGroupContainer.style.display = 'block';
    }
}

function getTransferTargetChoice() {
    if (hostAsTransferTargetChoice.checked) {
        return TransferTargetType.HOST;
    } else if (groupAsTransferTargetChoice.checked) {
        return TransferTargetType.GROUP;
    } else {
        return null;
    }
}

joinTransferGroupDialog.addEventListener("click", (event) => {
    if (event.target === acceptFileTransferDialog) {
        event.stopPropagation(); // Prevent click from propagating if outside dialog
    }
});

function showJoinTransferGroupDialog(waiterId, deviceId, gatewayRequestHeader) {
    jtgDeviceId.textContent = deviceId;
    jtgVirtualHostName.textContent = gatewayRequestHeader.alias;
    jtgIP.textContent = gatewayRequestHeader.ip;
    jtgCountry.innerHTML = gatewayRequestHeader.countryCode ?
        getCountryWithFlagInnerHtml(gatewayRequestHeader.countryCode, gatewayRequestHeader.countryName) : null;
    jtgCity.textContent = gatewayRequestHeader.city;
    jtgProxyInfo.textContent = gatewayRequestHeader.proxyInfo ? gatewayRequestHeader.proxyInfo : '-';
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
        const binaryId = binaryWithHeader.binaryId;
        let transferGroupPassword
        let transferGroup
        const tmpGroup = TransferFileHelper.tmpGroupRegistry.get(binaryId);
        if (tmpGroup) {
            transferGroupPassword = tmpGroup.pwd;
            transferGroup = tmpGroup.name;
            TransferFileHelper.tmpGroupRegistry.delete(binaryId);
        } else {
            if (!(Fileshare.properties && Fileshare.properties.transferGroup)) {
                console.warn("Transfer group is not defined but transfer request was received");
                return;
            }
            transferGroupPassword = Fileshare.properties.transferGroupPassword;
            transferGroup = Fileshare.properties.transferGroup;
        }
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
            await requestWakeLock(Fileshare);
            if (window.showSaveFilePicker) {
                await downloadBinaryStream(response, manifest.name, manifest.size);
            } else {
                await downloadBinaryStreamSilently(response, manifest.name, manifest.size, manifest.type);
            }
            releaseWakeLock(Fileshare);
        }
        TransferFileHelper.cleanTransfer = function () {
            TransferFileHelper.registry.delete(manifest.id);
        }

        ftrName.textContent = manifest.name;
        ftrType.textContent = manifest.type;
        ftrSize.textContent = `${Math.round((manifest.size * 100) / MemoryBlock.MB) / 100}`;
        frOriginatorVirtualHost.textContent = manifest.originatorVirtualHost;
        showAcceptFileTransferDialog();
    } else {
        let receiveQueue = null;
        while (!receiveQueue) {
            receiveQueue = TransferFileHelper.registry.get(binaryWithHeader.binaryId);
            await delay(100);
        }
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

TransferFileHelper.transferFileToVirtualHost = async function (file, receiverVirtualHost) {
    return await TransferFileHelper.transferFileToVirtualHostBase(
        file,
        receiverVirtualHost,
        Fileshare.connectionAlias,
        "Failed file transfer attempt: receiver is not unavailable. Open https://secure.fileshare.ovh on receiver's side and use assigned virtual host as a destination",
        Fileshare
    );
}

TransferFileHelper.transferFile = async function (file, transferGroup, transferGroupPassword, binaryId = null, destHashCode = null) {
    return await TransferFileHelper.transferFileBase(
        file,
        transferGroup,
        transferGroupPassword,
        Fileshare.connectionAlias,
        "Failed file transfer attempt: all group members are unavailable. Open https://secure.fileshare.ovh on receiver's side and join the group",
        Fileshare,
        binaryId,
        destHashCode
    );
}

TransferFileHelper.transferBlobToVirtualHost = async function (blob, name, type, alias) {
    const binaryId = uuid.v4().toString();
    const joinGroupResponse = await acquireTmpGroupHandshake(alias, binaryId, closeModal);

    if (!joinGroupResponse) {
        return false;
    }

    return await TransferFileHelper.transferBlob(
        blob, name, type,
        joinGroupResponse.name,
        joinGroupResponse.pwd,
        binaryId,
        joinGroupResponse.destHashCode
    );
}

TransferFileHelper.transferBlob = async function (blob, name, type,
                                                  transferGroup, transferGroupPassword,
                                                  binaryId = null, destHashCode = null) {
    const ftManifest = new FileTransferManifest(
        binaryId, name, type, blob.size, Fileshare.connectionAlias
    );
    const encAndSendResult = await sendTransferManifest(
        ftManifest,
        transferGroup,
        transferGroupPassword,
        destHashCode
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
    }, Fileshare);
}

async function readFileSequentially(file, chunkHandler, errorMsg) {
    return await readFileSequentiallyBase(
        file, chunkHandler, errorMsg, Fileshare
    );
}

async function sendJoinTransferGroupRequest(transferGroupHost, sessionId, deviceFpId, binaryId) {
    const joinTransferGroupRequest = new JoinTransferGroupRequest(
        deviceFpId,
        sessionId,
        null,
        binaryId
    );

    const ownerFilter = new ClientFilter(
        null,
        transferGroupHost,
        null,
        null
    );

    return await sendJoinTransferGroupRequestToClient(ownerFilter, joinTransferGroupRequest);
}

