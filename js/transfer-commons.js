const TransferTargetType = Object.freeze({
    HOST: 'host',
    GROUP: 'group'
});

class FileTransferManifest {
    constructor(id, name, type, size, originatorVirtualHost) {
        this.id = id ? id : uuid.v4().toString();
        this.name = name;
        this.type = type;
        this.size = size;
        this.originatorVirtualHost = originatorVirtualHost;
    }

    toJSON() {
        return {
            id: this.id,
            name: this.name,
            type: this.type,
            size: this.size,
            originatorVirtualHost: this.originatorVirtualHost
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
            jsonObject.originatorVirtualHost
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
TransferFileHelper.tmpGroupRegistry = new Map();
TransferFileHelper.blockSize = MemoryBlock.MB;
TransferFileHelper.preparedFile = [];

TransferFileHelper.transferFileToVirtualHostBase = async function (file, receiverVirtualHost, senderVirtualHost, errorMsg, propertiesHolder) {
    const binaryId = uuid.v4().toString();
    const joinGroupResponse = await acquireTmpGroupHandshake(
        receiverVirtualHost,
        binaryId,
        function () {
            location.reload();
        }
    );

    if (!joinGroupResponse) {
        return false;
    }

    return await TransferFileHelper.transferFileBase(
        file,
        joinGroupResponse.name,
        joinGroupResponse.pwd,
        senderVirtualHost,
        errorMsg,
        propertiesHolder,
        binaryId,
        joinGroupResponse.destHashCode
    );
}

async function acquireTmpGroupHandshake(alias, binaryId, errorHandler) {
    const clientWithAlias = await PushcaClient.connectionAliasLookup(alias);
    if (!clientWithAlias) {
        showErrorMsg("Unknown virtual host", errorHandler);
        return null;
    }

    const joinGroupResponse = await sendJoinTransferGroupRequestToClient(
        clientWithAlias.client,
        new JoinTransferGroupRequest(null, null, null, binaryId)
    );

    if (!joinGroupResponse) {
        showErrorMsg("Failed virtual host handshake", errorHandler);
        return null;
    }

    return {
        name: joinGroupResponse.name,
        pwd: joinGroupResponse.pwd,
        destHashCode: clientWithAlias.client.hashCode()
    };
}

TransferFileHelper.transferFileBase = async function (file, transferGroup, transferGroupPassword,
                                                      senderVirtualHost, errorMsg, propertiesHolder, binaryId = null, destHashCode = null) {
    const ftManifest = new FileTransferManifest(
        binaryId, file.name, file.type, file.size, senderVirtualHost
    );
    const encAndSendResult = await sendTransferManifest(
        ftManifest,
        transferGroup,
        transferGroupPassword,
        destHashCode
    );
    if (WaiterResponseType.ERROR === encAndSendResult.result.type) {
        showErrorMsg(errorMsg, null);
        return false;
    }

    return await readFileSequentiallyBase(file, async function (order, arrayBuffer) {
        //console.log(`Send chunk ${order}`);
        const result = await encryptAndTransferBinaryChunk(
            ftManifest.id,
            order,
            encAndSendResult.transferGroupId,
            arrayBuffer,
            encAndSendResult.encryptionContract
        );
        return WaiterResponseType.SUCCESS === result.type
    }, errorMsg, propertiesHolder);
}

async function executeWithShowProgressBar(operation, propertiesHolder) {
    await requestWakeLock(propertiesHolder);
    const progressBarWidget = propertiesHolder.progressBarWidget
    progressBarWidget.pbContainer.style.display = 'block';
    if (typeof operation === 'function') {
        await operation();
    }
    progressBarWidget.pbProgress.value = 0;
    progressBarWidget.pbProgressPercentage.textContent = `0%`;
    progressBarWidget.pbContainer.style.display = 'none';
    releaseWakeLock(propertiesHolder);
}

async function readFileSequentiallyBase(file, chunkHandler, errorMsg, propertiesHolder) {
    const progressBarWidget = propertiesHolder.progressBarWidget;
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
                        progressBarWidget.reset();
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
            progressBarWidget.setProgress(progress);
            await delay(100);
        }
    }, propertiesHolder);

    return !pipeWasBroken;
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

async function sendJoinTransferGroupRequestToClient(dest, joinTransferGroupRequest) {
    const {publicKey, privateKey} = await generateRSAKeyPair();
    const publicKeyString = await exportPublicKey(publicKey);

    const request = joinTransferGroupRequest.cloneAndReplacePublicKey(publicKeyString);

    const response = await PushcaClient.sendGatewayRequest(
        dest,
        GatewayPath.VERIFY_JOIN_TRANSFER_GROUP_REQUEST,
        stringToByteArray(JSON.stringify(request))
    );

    if (!response) {
        return null;
    }

    if ('error' === response) {
        return null;
    }

    try {
        const jsonResponseWrapper = JSON.parse(response);
        const responseBytes = base64ToArrayBuffer(jsonResponseWrapper.body);
        const responseStr = arrayBufferToString(responseBytes);
        const jsonObject = JSON.parse(responseStr);
        if ((JoinTransferGroupResponse.DENIED === jsonObject.result) || (JoinTransferGroupResponse.ERROR === jsonObject.result)) {
            console.warn("Declined join transfer group attempt: " + jsonObject.result);
            return null;
        }
        return JSON.parse(await decryptWithPrivateKey(privateKey, jsonObject.result));
    } catch (err) {
        console.warn("Failed join transfer group attempt: " + err);
        return null;
    }
}

async function sendTransferManifest(ftManifest, transferGroup, transferGroupPassword, destHashCode = null) {
    const transferGroupId = destHashCode ? destHashCode : calculateStringHashCode(transferGroup);
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
