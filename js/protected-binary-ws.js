const wsUrl = 'wss://secure.fileshare.ovh:31085';

let binaryChunkProcessor;

setPastCredentialsHandler(downloadProtectedBinary);

setPressEnterKeyHandler(downloadProtectedBinary);

setDownloadBtnHandler(downloadProtectedBinary);

async function downloadProtectedBinary() {
    const signedRequest = await createSignedDownloadRequest(
        passwordField.value,
        workspaceField.value,
        protectedUrlSuffix
    );

    const manifest = await downloadProtectedBinaryManifest(signedRequest);

    if (!manifest) {
        return
    }

    await openWsConnection();

    if (!PushcaClient.isOpen()) {
        showErrorMessage("Download channel is broken");
    }

    showDownloadProgress();
    let counter = 0;
    for (let order = 0; order < manifest.datagrams.length; order++) {

        const chunk = await PushcaClient.downloadBinaryChunk(
            manifest.sender,
            manifest.id,
            order,
            MemoryBlock.MB_ENC
        );

        counter += chunk.byteLength;

        console.log(`Downloaded ${counter} bytes`);

        const percentComplete = Math.round(((order + 1) / manifest.datagrams.length) * 100);
        progressBar.value = percentComplete;
        progressPercentage.textContent = `${percentComplete}%`;
    }
    PushcaClient.stopWebSocket();
}

async function downloadProtectedBinaryManifest(downloadRequest) {
    const response = await fetch(serverUrl + '/binary/m/protected', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(downloadRequest)
    });
    if (!response.ok) {
        console.error('Failed download protected binary attempt ' + response.statusText);
        showErrorMessage('Failed download protected binary attempt ' + response.statusText);
        return null;
    }
    return response.json();
}

//================================== Web socket connection =============================================================

async function openWsConnection() {
    if (!PushcaClient.isOpen()) {
        const pClient = new ClientFilter(
            "SecureFileShare",
            "anonymous-sharing",
            uuid.v4().toString(),
            "protected-binary-ws-page"
        );
        await PushcaClient.openWsConnection(
            wsUrl,
            pClient,
            function (clientObj) {
                return new ClientFilter(
                    clientObj.workSpaceId,
                    clientObj.accountId,
                    clientObj.deviceId,
                    clientObj.applicationId
                );
            }
        );
    }
}

//======================================================================================================================