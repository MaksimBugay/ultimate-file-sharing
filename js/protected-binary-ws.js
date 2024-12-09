const wsUrl = 'wss://secure.fileshare.ovh:31085';

setPastCredentialsHandler(downloadSharedBinary);

setPressEnterKeyHandler(downloadSharedBinary);

setDownloadBtnHandler(downloadSharedBinary);

let manifest = null;
let contentSize = null;

async function downloadSharedBinary() {
    const manifest = await downloadProtectedBinaryManifest(
        passwordField.value,
        workspaceField.value,
        protectedUrlSuffix
    );
    if (!manifest) {
        await postDownloadProcessor('RESPONSE_WITH_ERROR');
        return;
    }
    contentSize = manifest.datagrams.reduce((sum, datagram) => sum + datagram.size, 0);
    console.log(`Content size = ${contentSize}`);
    if (canBeShownInBrowser(manifest.mimeType) && (contentSize < MemoryBlock.MB100)) {
        openInBrowserCheckbox.checked = true;
    }
    showDownloadProgress();
    await delay(2_000);
    if (openInBrowserCheckbox.checked || (!window.showSaveFilePicker)) {
        await openProtectedBinaryInBrowser(manifest);
    } else {
        await saveProtectedBinaryAsFile(manifest);
    }
}

async function openProtectedBinaryInBrowser(manifest) {
    const chunks = [];

    const result = await downloadProtectedBinaryViaWebSocket(manifest,
        async function (chunk) {
            chunks.push(chunk);
        }, null);

    if (result) {
        const blob = new Blob(chunks, {type: manifest.mimeType});
        openBlobInBrowser(blob, manifest.name);
    }

    await postDownloadProcessor(result ? "" : 'RESPONSE_WITH_ERROR');
}

function openBlobInBrowser(blob, binaryFileName) {
    if ('text/plain' === blob.type) {
        const reader = new FileReader();
        const textDecoder = new TextDecoder("utf-8");

        reader.onload = function () {
            const resultBuffer = reader.result;

            if (resultBuffer instanceof ArrayBuffer) {
                contentText.textContent = textDecoder.decode(resultBuffer);
                contentText.style.display = 'block';
                contentTextContainer.style.display = 'block';
                contentContainer.style.display = 'block';
            } else {
                console.error("Error: Expected ArrayBuffer, but got something else");
            }
        };

        reader.readAsArrayBuffer(blob);
    } else if (playableImageTypes.includes(blob.type)) {
        const blobUrl = URL.createObjectURL(blob);
        contentImage.src = blobUrl;
        contentImage.onload = function () {
            contentContainer.style.display = 'block';
            contentImage.style.display = 'block';
            URL.revokeObjectURL(blobUrl);
        };
    } else if (isPlayableMedia(blob.type)) {
        const blobUrl = URL.createObjectURL(blob);
        const source = document.createElement('source');
        source.src = blobUrl;
        source.type = blob.type;

        contentVideoPlayer.appendChild(source);

        contentVideoPlayer.addEventListener('canplay', function () {
            contentVideoPlayer.play();
        });

        contentContainer.style.display = 'block';
        contentVideoPlayer.style.display = 'block';
    } else {
        downloadFile(blob, binaryFileName);
    }

}

async function saveProtectedBinaryAsFile(manifest) {
    const options = {
        suggestedName: manifest.name
    };
    const fileHandle = await window.showSaveFilePicker(options);
    const writable = await fileHandle.createWritable();

    const result = await downloadProtectedBinaryViaWebSocket(manifest,
        async function (chunk) {
            await writable.write({type: 'write', data: chunk});
        }, async function () {
            await writable.close();
        });

    await postDownloadProcessor(result ? "" : 'RESPONSE_WITH_ERROR');
}

async function downloadProtectedBinaryViaWebSocket(inManifest, binaryChunkProcessor, afterFinishedHandler) {
    let vManifest = inManifest;

    if (!vManifest) {
        vManifest = await downloadProtectedBinaryManifest(
            passwordField.value,
            workspaceField.value,
            protectedUrlSuffix
        );
    }

    if (!vManifest) {
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

    for (let order = 0; order < vManifest.datagrams.length; order++) {

        const encChunk = await PushcaClient.downloadBinaryChunk(
            vManifest.sender,
            vManifest.id,
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

        const percentComplete = Math.round(((order + 1) / vManifest.datagrams.length) * 100);
        progressBar.value = percentComplete;
        progressPercentage.textContent = `${percentComplete}%`;
    }
    PushcaClient.stopWebSocket();

    if (typeof afterFinishedHandler === 'function') {
        await afterFinishedHandler();
    }

    return true;
}

async function downloadProtectedBinaryManifest(pwd, workspaceId, suffix) {
    const signedRequest = await createSignedDownloadRequest(
        pwd,
        workspaceId,
        suffix
    );
    const response = await fetch(serverUrl + '/binary/m/protected', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(signedRequest)
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