const routs = new Map();

const GatewayPath = Object.freeze({
    VERIFY_BINARY_SIGNATURE: "verify-binary-signature"
});

async function verifyBinarySignature(header, requestPayload) {
    try {
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
    } catch (error) {
        console.warn("Failed attempt of signature verification: " + error);
        return new WaiterResponse(
            WaiterResponseType.SUCCESS,
            stringToByteArray(
                JSON.stringify({result: false})
            )
        )
    }
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