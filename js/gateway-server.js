const routs = new Map();

const GatewayPath = Object.freeze({
    VERIFY_BINARY_SIGNATURE: "verify-binary-signature"
});

async function verifyBinarySignature(header, requestPayload) {
    return booleanToBytes(true);
}

routs.set(GatewayPath.VERIFY_BINARY_SIGNATURE, verifyBinarySignature);

function processGateWayRequest(path, header, requestPayload, responseConsumer) {
    const route = routs.get(path);

    if (typeof route === 'function') {
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