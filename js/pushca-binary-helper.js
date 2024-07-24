const BinaryType = Object.freeze({
    FILE: 0,
    MEDIA_STREAM: 1,
    BINARY_MESSAGE: 2
});

class Datagram {
    constructor(order, size, md5) {
        this.order = order;
        this.size = size;
        this.md5 = md5;
    }
}

class BinaryManifest {
    constructor(id, name, mimeType, sender, pusherInstanceId, datagrams) {
        this.id = id;
        this.name = name;
        this.mimeType = mimeType;
        this.sender = sender;
        this.pusherInstanceId = pusherInstanceId;
        if (isArrayNotEmpty(datagrams)) {
            this.datagrams = datagrams;
        } else {
            this.datagrams = [];
        }
    }

    static fromObject(jsonObject) {
        const sender = new ClientFilter(
            jsonObject.sender.workSpaceId,
            jsonObject.sender.accountId,
            jsonObject.sender.deviceId,
            jsonObject.sender.applicationId
        );
        let datagrams = [];
        if (isArrayNotEmpty(jsonObject.datagrams)) {
            datagrams = jsonObject.mentioned.map(obj => new Datagram(
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
            datagrams
        );
    }

    static fromJSON(jsonString) {
        const jsonObject = typeof jsonString === 'string' ? JSON.parse(jsonString) : jsonString;
        return this.fromObject(jsonObject);
    }
}

async function addBinaryToStorage(binaryId, originalFileName, mimeType, arrayBuffer) {
    let binaryManifest;
    const result = await createBinaryManifest(binaryId, originalFileName, mimeType);
    if ((WaiterResponseType.SUCCESS === result.type) && result.body) {
        binaryManifest = result.body;
    }
    if (!binaryManifest) {
        console.log(`Cannot create binary manifest: ${originalFileName}`);
        return null;
    }

    const chunks = splitArrayBuffer(arrayBuffer, MemoryBlock.MB);
    for (let order = 0; order < chunks.length; order++) {
        const chunkId = buildSharedFileChunkId(binaryId, order);
        const result = await addChunkToBinaryManifest(binaryManifest, order, chunks[order]);
        if ((WaiterResponseType.SUCCESS === result.type) && result.body) {
            binaryManifest = result.body;
        } else {
            console.log(`Cannot append binary chunk: name ${originalFileName}, order ${order}`);
            return null;
        }
        const blob = new Blob([chunks[order]], {type: mimeType});
        addBinaryChunk(chunkId, blob);
    }
    return binaryManifest;
}

async function createBinaryManifest(id, name, mimeType) {
    let timeoutMs = 2000;

    let timeout = (ms) => new Promise((resolve, reject) => {
        setTimeout(() => reject(new Error('Timeout after ' + ms + ' ms')), ms);
    });

    let result;
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
            CallableFuture.releaseWaiterIfExistsWithSuccess(id, binaryManifest);
        } else {
            CallableFuture.releaseWaiterIfExistsWithError(id, "Cannot fetch Pushca connection attributes");
        }
    });

    try {
        result = await Promise.race([
            CallableFuture.addToWaitingHall(id),
            timeout(timeoutMs)
        ]);
    } catch (error) {
        CallableFuture.waitingHall.delete(id);
        result = new WaiterResponse(WaiterResponseType.ERROR, error);
    }
    return result;
}


async function addChunkToBinaryManifest(binaryManifest, order, arrayBuffer) {
    let timeoutMs = 2000;
    const id = uuid.v4().toString();

    let timeout = (ms) => new Promise((resolve, reject) => {
        setTimeout(() => reject(new Error('Timeout after ' + ms + ' ms')), ms);
    });

    let result;
    chunk2Datagram(order, arrayBuffer, function (datagram) {
        if (datagram) {
            binaryManifest.datagrams.push(datagram);
            CallableFuture.releaseWaiterIfExistsWithSuccess(id, binaryManifest);
        } else {
            CallableFuture.releaseWaiterIfExistsWithError(id, "Cannot convert bytes to datagram");
        }
    });

    try {
        result = await Promise.race([
            CallableFuture.addToWaitingHall(id),
            timeout(timeoutMs)
        ]);
    } catch (error) {
        CallableFuture.waitingHall.delete(id);
        result = new WaiterResponse(WaiterResponseType.ERROR, error);
    }
    return result;
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