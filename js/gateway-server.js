const routs = new Map();

const GatewayPath = Object.freeze({
    VERIFY_BINARY_SIGNATURE: "verify-binary-signature"
});

async function verifyBinarySignature(header, requestPayload) {
    try {
        const requestJson = byteArrayToString(requestPayload);
        console.log(`Gateway request payload`);
        const request = DownloadProtectedBinaryRequest.fromJsonString(requestJson);
        console.log(request);
        let password;
        const getManifestResult = await CallableFuture.callAsynchronously(2000, null, function (waiterId) {
            getManifest(
                result.binaryId,
                function (manifest) {
                    CallableFuture.releaseWaiterIfExistsWithSuccess(waiterId, manifest);
                }, function (event) {
                    CallableFuture.releaseWaiterIfExistsWithError(waiterId, event.target.error);
                }
            );
        });
        if ((WaiterResponseType.SUCCESS === getManifestResult.type) && getManifestResult.body) {
            password = getManifestResult.body.password;
        } else {
            return new WaiterResponse(
                WaiterResponseType.SUCCESS,
                stringToByteArray(
                    JSON.stringify({result: false})
                )
            )
        }

        const salt = stringToByteArray(PushcaClient.ClientObj.workSpaceId);
        const signature = await makeSignature(
            password,
            salt,
            JSON.stringify(request.toSkipSignatureJSON())
        );
        console.log(`Request signature: ${arrayBufferToUrlSafeBase64(signature)}`);
        const result = await verifySignature(
            password, salt, JSON.stringify(request.toSkipSignatureJSON()), request.signature
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
        );
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