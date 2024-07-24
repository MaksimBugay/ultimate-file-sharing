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

function createBinaryManifest(id, name, mimeType, consumer) {
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
        } else {
            console.log("Cannot fetch Pushca connection attributes");
        }
        if (typeof consumer === 'function') {
            consumer(binaryManifest);
        }
    });
}

function addChunkToBinaryManifest(binaryManifest, order, arrayBuffer) {
    chunk2Datagram(order, arrayBuffer, function (datagram) {
        binaryManifest.datagrams.push(datagram);
    })

}

function chunk2Datagram(order, arrayBuffer, consumer) {
    if (!arrayBuffer) {
        return;
    }
    if (arrayBuffer.byteLength === 0) {
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