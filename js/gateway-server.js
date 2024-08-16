const routs = new Map();

const GatewayPath = Object.freeze({
    VERIFY_BINARY_SIGNATURE: "verify-binary-signature"
});

class DownloadProtectedBinaryRequest {
    constructor(suffix, exp, canPlayType, signature) {
        this.suffix = suffix;
        this.exp = exp;
        this.canPlayType = canPlayType;
        this.signature = signature;
    }

    toJSON() {
        return {
            suffix: this.suffix,
            exp: this.exp,
            canPlayType: this.canPlayType
        };
    }

    static fromJsonString(jsonString) {
        const jsonObject = typeof jsonString === 'string' ? JSON.parse(jsonString) : jsonString;
        return new DownloadProtectedBinaryRequest(
            jsonObject.suffix,
            jsonObject.exp,
            jsonObject.canPlayType,
            jsonObject.signature
        );
    }
}

async function verifyBinarySignature(header, requestPayload) {
    const requestJson = byteArrayToString(requestPayload);
    console.log(`Gateway request payload`);
    const request = DownloadProtectedBinaryRequest.fromJsonString(requestJson);
    const salt = stringToByteArray(PushcaClient.ClientObj.workSpaceId);
    const signature = await makeSignature(
        "strongPassword",
        salt,
        JSON.stringify(request.toJSON())
    )
    console.log(`Request signature: ${arrayBufferToBase64(signature)}`);
    const result = await verifySignature(
        "strongPassword", salt, JSON.stringify(request.toJSON()), request.signature
    );
    return new WaiterResponse(
        WaiterResponseType.SUCCESS,
        stringToByteArray(
            JSON.stringify({result: result})
        )
    )
}

routs.set(GatewayPath.VERIFY_BINARY_SIGNATURE, verifyBinarySignature);

function processGateWayRequest(path, header, requestPayload, responseConsumer) {
    const route = routs.get(path);

    if (typeof route !== 'function') {
        console.warn(`Unknown gateway path ${path}`);
        if (typeof responseConsumer === 'function') {
            responseConsumer(null);
        }
        return;
    }

    route(header, requestPayload).then(result => {
        if ((WaiterResponseType.SUCCESS === result.type) && result.body) {
            if (typeof responseConsumer === 'function') {
                responseConsumer(result.body);
            }
        }
    });
}