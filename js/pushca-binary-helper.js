const BinaryType = Object.freeze({
    FILE: 0,
    MEDIA_STREAM: 1,
    BINARY_MESSAGE: 2
});

const DatagramState = Object.freeze({
    UNKNOWN: 0,
    LOADED: 1,
    CORRUPTED: 2
});

class Datagram {
    constructor(order, size, md5) {
        this.order = order;
        this.size = size;
        this.md5 = md5;
        this.state = DatagramState.UNKNOWN;
    }

    setBytes(bytes) {
        this.bytes = bytes;
        this.state = DatagramState.LOADED;
    }

    setState(datagramState) {
        this.state = datagramState;
    }
}

class BinaryManifest {
    constructor(id, name, mimeType, sender, pusherInstanceId, datagrams, totalSize) {
        this.id = id;
        this.name = name;
        this.mimeType = mimeType;
        this.sender = sender;
        this.pusherInstanceId = pusherInstanceId;
        this.datagrams = isArrayNotEmpty(datagrams) ? datagrams : [];
        this.totalSize = totalSize;
        this.created = new Date().getTime();
    }

    getTotalSize() {
        if (this.totalSize) {
            return this.totalSize;
        }
        this.totalSize = calculateTotalSize(this.datagrams);
        return this.totalSize;
    }

    resetTotalSize() {
        this.totalSize = null;
    }

    appendDatagram(datagram) {
        this.resetTotalSize();
        this.datagrams.push(datagram);
    }

    setSender(sender) {
        this.sender = sender;
    }

    setPusherInstanceId(pusherInstanceId) {
        this.pusherInstanceId = pusherInstanceId;
    }

    async setChunkBytes(order, bytes) {
        const datagram = this.datagrams[order];
        return CallableFuture.callAsynchronously(2000, null, function (waiterId) {
            calculateSha256(bytes).then(md5 => {
                if (datagram.md5 === md5) {
                    datagram.setBytes(bytes);
                    CallableFuture.releaseWaiterIfExistsWithSuccess(waiterId, true);
                } else {
                    console.warn(`Corrupted chunk was received: binary id = ${this.id}, order = ${order}`);
                    datagram.setState(DatagramState.CORRUPTED);
                    CallableFuture.releaseWaiterIfExistsWithError(waiterId, false);
                }
            });
        });
    }

    isCompleted() {
        return this.datagrams.every(datagram => datagram.state === DatagramState.LOADED);
    }

    isFinalized() {
        return this.datagrams.every(datagram => datagram.state !== DatagramState.UNKNOWN);
    }

    isExpired() {
        return ((new Date().getTime()) - this.created) > 30 * 60 * 1000;
    }

    toJSON() {
        return {
            id: this.id,
            name: this.name,
            mimeType: this.mimeType,
            sender: this.sender,
            pusherInstanceId: this.pusherInstanceId,
            datagrams: this.datagrams
        };
    }

    static fromObject(jsonObject, totalSize) {
        const sender = new ClientFilter(
            jsonObject.sender.workSpaceId,
            jsonObject.sender.accountId,
            jsonObject.sender.deviceId,
            jsonObject.sender.applicationId
        );
        let datagrams = [];
        if (isArrayNotEmpty(jsonObject.datagrams)) {
            datagrams = jsonObject.datagrams.map(obj => new Datagram(
                    obj.order,
                    obj.size,
                    obj.md5
                )
            );
        }
        return new BinaryManifest(
            jsonObject.id,
            jsonObject.name,
            jsonObject.mimeType,
            sender,
            jsonObject.pusherInstanceId,
            datagrams,
            totalSize
        );
    }

    static fromJSON(jsonString, totalSize) {
        const jsonObject = typeof jsonString === 'string' ? JSON.parse(jsonString) : jsonString;
        return this.fromObject(jsonObject, totalSize);
    }
}

class BinaryWithHeader {
    constructor(sourceBuffer) {
        this.binaryType = bytesToShortInt(copyBytes(sourceBuffer, 0, 1));
        this.destClientHash = bytesToInt(copyBytes(sourceBuffer, 1, 5));
        this.withAcknowledge = bytesToBoolean(copyBytes(sourceBuffer, 5, 6));
        this.binaryId = bytesToUuid(copyBytes(sourceBuffer, 6, 22));
        this.order = bytesToInt(copyBytes(sourceBuffer, 22, 26));
        this.payload = copyBytes(sourceBuffer, 26, sourceBuffer.byteLength);
    }

    getId() {
        return buildSharedFileChunkId(this.binaryId, this.order, this.destClientHash);
    }
}

const BinaryWaitingHall = new Map();

function buildSharedFileChunkId(binaryId, order, destHashCode) {
    return `${binaryId}-${order}-${destHashCode}`;
}

async function addBinaryToStorage(binaryId, originalFileName, mimeType, arrayBuffer, sliceNumber, inBinaryManifest) {
    let binaryManifest = inBinaryManifest;
    let result;
    if (sliceNumber === 0) {
        result = await createBinaryManifest(binaryId, originalFileName, mimeType);
        if ((WaiterResponseType.SUCCESS === result.type) && result.body) {
            binaryManifest = result.body;
        }
    }
    if (!binaryManifest) {
        console.log(`Cannot create binary manifest: ${originalFileName}`);
        return null;
    }
    if (sliceNumber === 0) {
        result = await CallableFuture.callAsynchronously(2000, null, function (waiterId) {
            saveBinaryManifest(
                binaryManifest,
                function () {
                    CallableFuture.releaseWaiterIfExistsWithSuccess(waiterId, true);
                },
                function (event) {
                    alert(event.target.error);
                    CallableFuture.releaseWaiterIfExistsWithError(waiterId, false);
                }
            );
        });
        if (WaiterResponseType.ERROR === result.type) {
            return null;
        }
    }
    const chunks = splitArrayBuffer(arrayBuffer, MemoryBlock.MB);
    for (let n = 0; n < chunks.length; n++) {
        const order = sliceNumber * 100 + n;
        const result = await addChunkToBinaryManifest(binaryManifest, order, chunks[n]);
        if ((WaiterResponseType.SUCCESS === result.type) && result.body) {
            binaryManifest = result.body;
        } else {
            console.log(`Cannot append binary chunk: name ${originalFileName}, order ${order}`);
            return null;
        }
        const blob = new Blob([chunks[n]], {type: mimeType});
        saveBinaryChunk(binaryId, order, blob);
    }

    result = await CallableFuture.callAsynchronously(2000, null, function (waiterId) {
        saveBinaryManifest(
            binaryManifest,
            function () {
                CallableFuture.releaseWaiterIfExistsWithSuccess(waiterId, true);
            },
            function (event) {
                alert(event.target.error);
                removeAllRecordsWithBinaryId(binaryManifest.id);
                CallableFuture.releaseWaiterIfExistsWithError(waiterId, false);
            }
        );
    });
    if (WaiterResponseType.ERROR === result.type) {
        console.log(`Failed Save manifest attempt during binary upload: file name = ${originalFileName}`);
        return null;
    }
    return binaryManifest;
}

async function createBinaryManifest(id, name, mimeType) {

    return await CallableFuture.callAsynchronously(2000, null, function (waiteId) {
        chrome.runtime.sendMessage({action: 'get-pushca-connection-attributes'}, (response) => {
            let binaryManifest = null;
            if (response && response.clientObj) {
                const sender = new ClientFilter(
                    response.clientObj.workSpaceId,
                    response.clientObj.accountId,
                    null,
                    response.clientObj.applicationId
                );
                binaryManifest = new BinaryManifest(
                    id,
                    name,
                    mimeType,
                    sender,
                    response.pusherInstanceId,
                    []
                );
                CallableFuture.releaseWaiterIfExistsWithSuccess(waiteId, binaryManifest);
            } else {
                CallableFuture.releaseWaiterIfExistsWithError(waiteId, "Cannot fetch Pushca connection attributes");
            }
        });
    });
}


async function addChunkToBinaryManifest(binaryManifest, order, arrayBuffer) {

    return await CallableFuture.callAsynchronously(2000, null, function (waiterId) {
        chunk2Datagram(order, arrayBuffer, function (datagram) {
            if (datagram) {
                binaryManifest.appendDatagram(datagram);
                CallableFuture.releaseWaiterIfExistsWithSuccess(waiterId, binaryManifest);
            } else {
                CallableFuture.releaseWaiterIfExistsWithError(waiterId, "Cannot convert bytes to datagram");
            }
        });
    });
}

function chunk2Datagram(order, arrayBuffer, consumer) {
    if ((!arrayBuffer) || (arrayBuffer.byteLength === 0)) {
        if (typeof consumer === 'function') {
            consumer(null);
        }
        return;
    }

    calculateSha256(arrayBuffer).then(md5 => {
        if (typeof consumer === 'function') {
            consumer(
                new Datagram(order, arrayBuffer.byteLength, md5)
            );
        }
    });
}

function calculateClientHashCode(workSpaceId, accountId, deviceId, applicationId) {
    const formattedString = formatString("{0}@@{1}@@{2}@@{3}", workSpaceId, accountId, deviceId, applicationId);
    return calculateStringHashCode(formattedString);
}

function buildPushcaBinaryHeader(binaryType, destHashCode, withAcknowledge, binaryId, order) {
    return concatenateByteArrays(
        shortIntToBytes(binaryType),
        intToBytes(destHashCode),
        booleanToBytes(withAcknowledge),
        uuidToBytes(binaryId),
        intToBytes(order)
    );
}

function extractOrderFromBinaryWithHeader(sourceBuffer) {
    const orderBytes = copyBytes(sourceBuffer, 22, 26);
    return bytesToInt(orderBytes);
}

async function calculateSha256(content) {
    const hashBuffer = await crypto.subtle.digest('SHA-256', content);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return btoa(String.fromCharCode.apply(null, hashArray));
}

function calculateTotalSize(datagrams) {
    if (!isArrayNotEmpty(datagrams)) {
        return 0;
    }
    return datagrams.reduce((sum, datagram) => sum + datagram.size, 0);
}

async function processUploadBinaryAppeal(uploadBinaryAppeal) {
    const dest = new ClientFilter(
        uploadBinaryAppeal.sender.workSpaceId,
        uploadBinaryAppeal.sender.accountId,
        uploadBinaryAppeal.sender.deviceId,
        uploadBinaryAppeal.sender.applicationId
    );
    sendBinary(
        uploadBinaryAppeal.binaryId,
        uploadBinaryAppeal.manifestOnly,
        uploadBinaryAppeal.requestedChunks,
        dest);
}

async function sendBinary(binaryId, manifestOnly, requestedChunks, dest) {
    const destHashCode = calculateClientHashCode(
        dest.workSpaceId,
        dest.accountId,
        dest.deviceId,
        dest.applicationId
    );
    if (isArrayNotEmpty(requestedChunks)) {
        for (let i = 0; i < requestedChunks.length; i++) {
            await retrieveAndSendBinaryChunk(binaryId, requestedChunks[i], destHashCode, false);
        }
        return;
    }
    let manifest;
    let result = await CallableFuture.callAsynchronously(2000, null, function (waiterId) {
        getManifest(
            binaryId,
            function (manifest) {
                CallableFuture.releaseWaiterIfExistsWithSuccess(waiterId, manifest);
            }, function (event) {
                CallableFuture.releaseWaiterIfExistsWithError(waiterId, event.target.error);
            }
        );
    });
    if ((WaiterResponseType.SUCCESS === result.type) && result.body) {
        manifest = result.body;
    }
    if (!manifest) {
        console.warn(`Unknown binary with id ${binaryId}`)
        return;
    }
    manifest.setPusherInstanceId(PushcaClient.pusherInstanceId);
    manifest.setSender(PushcaClient.ClientObj);
    if (manifestOnly) {
        await PushcaClient.sendBinaryManifest(dest, manifest);
        return;
    }
    for (let order = 0; order < manifest.datagrams.length; order++) {
        await retrieveAndSendBinaryChunk(binaryId, order, destHashCode, true);
    }
    console.log(`Successfully send binary with id ${binaryId}`);
}

async function retrieveAndSendBinaryChunk(binaryId, order, destHashCode, withAcknowledge) {
    const result = await CallableFuture.callAsynchronously(2000, null, function (waiterId) {
        getBinaryChunk(binaryId, order, function (arrayBuffer) {
            CallableFuture.releaseWaiterIfExistsWithSuccess(waiterId, arrayBuffer);
        });
    });
    if ((WaiterResponseType.ERROR === result.type) || (!result.body)) {
        console.warn(`Chunk ${order} of binary with id ${binaryId} not found`);
        return;
    }
    const chunk = await result.body.arrayBuffer();

    return await PushcaClient.sendBinaryChunk(
        binaryId,
        order,
        destHashCode,
        withAcknowledge,
        chunk
    );
}

function buildDownloadWaiterId(waiterId) {
    return `wd_${waiterId}`;
}

function downloadBinary(chunks, fileName, mimeType) {
    const binaryBlob = new Blob(chunks, {type: mimeType});
    const url = URL.createObjectURL(binaryBlob);
    chrome.runtime.sendMessage({
        action: 'save-file',
        mimeType: mimeType,
        fileName: fileName,
        url: url
    }, (response) => {
        if (response && response.downloadId) {
            console.log(`Download id = ${response.downloadId}`);
        }
        URL.revokeObjectURL(url);
    });
}