const routs = new Map();

const GatewayPath = Object.freeze({
    VERIFY_BINARY_SIGNATURE: "verify-binary-signature",
    VERIFY_JOIN_TRANSFER_GROUP_REQUEST: "verify-join-transfer-group-request"
});

async function verifyJoinTransferGroupRequest(header, requestPayload) {
    try {
        const requestJson = byteArrayToString(requestPayload);
        console.log(`Gateway request payload: JoinTransferGroupRequest`);
        const request = JoinTransferGroupRequest.fromJsonString(requestJson);
        console.log(request);

        let response;
        if (Fileshare.sessionId !== request.sessionId) {
            return null;
        }

        const result = await CallableFuture.callAsynchronously(
            27_000,
            null,
            function (waiterId) {
                showJoinTransferGroupDialog(waiterId, request.deviceId);
            }
        )

        if (result && (WaiterResponseType.SUCCESS === result.type)) {
            if (result.body && Fileshare.properties.transferGroup && Fileshare.properties.transferGroupPassword) {
                const responseStr = JSON.stringify({
                    name: Fileshare.properties.transferGroup,
                    pwd: Fileshare.properties.transferGroupPassword
                });
                const importedPublicKey = await importPublicKeyFromString(request.publicKeyStr);
                response = await encryptWithPublicKey(
                    importedPublicKey,
                    responseStr
                );
            } else {
                response = JoinTransferGroupResponse.DENIED;
            }
        } else {
            if (isJoinTransferGroupDialogVisible()) {
                hideJoinTransferGroupDialog();
            }
            return null;
        }

        return new WaiterResponse(
            WaiterResponseType.SUCCESS,
            stringToByteArray(
                JSON.stringify({result: response})
            )
        );
    } catch (error) {
        console.warn("Rejected join transfer group attempt: " + error);
        return new WaiterResponse(
            WaiterResponseType.SUCCESS,
            stringToByteArray(
                JSON.stringify({result: JoinTransferGroupResponse.ERROR})
            )
        );
    }
}

async function verifyBinarySignature(header, requestPayload) {
    try {
        const requestJson = byteArrayToString(requestPayload);
        console.log(`Gateway request payload: DownloadProtectedBinaryRequest`);
        const request = DownloadProtectedBinaryRequest.fromJsonString(requestJson);
        console.log(request);
        let password;
        const getManifestResult = await CallableFuture.callAsynchronously(2000, null, function (waiterId) {
            getManifest(
                request.binaryId,
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

        const salt = stringToByteArray(Fileshare.workSpaceId);
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
routs.set(GatewayPath.VERIFY_JOIN_TRANSFER_GROUP_REQUEST, verifyJoinTransferGroupRequest);

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
        if (result && (WaiterResponseType.SUCCESS === result.type) && result.body) {
            if (typeof responseConsumer === 'function') {
                responseConsumer(result.body);
            }
        }
    });
}