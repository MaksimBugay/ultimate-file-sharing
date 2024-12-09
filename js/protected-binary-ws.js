const wsUrl = 'wss://secure.fileshare.ovh:31085';

setPastCredentialsHandler(downloadSharedBinary);

setPressEnterKeyHandler(downloadSharedBinary);

setDownloadBtnHandler(downloadSharedBinary);

async function downloadSharedBinary() {
    const signedRequest = await createSignedDownloadRequest(
        passwordField.value,
        workspaceField.value,
        protectedUrlSuffix
    );

    const manifest = await downloadProtectedBinaryManifest(signedRequest);

    if (!manifest) {
        await postDownloadProcessor('RESPONSE_WITH_ERROR');
        return;
    }

    const options = {
        suggestedName: manifest.name
    };
    const fileHandle = await window.showSaveFilePicker(options);
    const writable = await fileHandle.createWritable();

    const result = await downloadProtectedBinary(manifest,
        async function (chunk) {
            await writable.write({type: 'write', data: chunk});
        }, async function () {
            await writable.close();
        });

    await postDownloadProcessor(result ? "" : 'RESPONSE_WITH_ERROR');
}

async function downloadProtectedBinary(inManifest, binaryChunkProcessor, afterFinishedHandler) {
    let manifest = inManifest;

    if (!manifest) {
        const signedRequest = await createSignedDownloadRequest(
            passwordField.value,
            workspaceField.value,
            protectedUrlSuffix
        );

        manifest = await downloadProtectedBinaryManifest(signedRequest);
    }

    if (!manifest) {
        return false;
    }

    await openWsConnection();

    if (!PushcaClient.isOpen()) {
        showErrorMessage("Download channel is broken");
        return false;
    }

    const encryptionContract = await EncryptionContract.fromTransferableString(
        encryptionContractStr,
        passwordField.value,
        stringToByteArray(workspaceField.value)
    );

    showDownloadProgress();
    for (let order = 0; order < manifest.datagrams.length; order++) {

        const encChunk = await PushcaClient.downloadBinaryChunk(
            manifest.sender,
            manifest.id,
            order,
            MemoryBlock.MB_ENC
        );

        if (!encChunk) {
            return false;
        }

        const chunk = await decryptBinaryChunk(encChunk, encryptionContract);

        if (typeof binaryChunkProcessor === 'function') {
            await binaryChunkProcessor(chunk);
        }

        const percentComplete = Math.round(((order + 1) / manifest.datagrams.length) * 100);
        progressBar.value = percentComplete;
        progressPercentage.textContent = `${percentComplete}%`;
    }
    PushcaClient.stopWebSocket();

    if (typeof afterFinishedHandler === 'function') {
        await afterFinishedHandler();
    }

    return true;
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