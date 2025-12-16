
setPastCredentialsHandler(downloadProtectedBinary);

setPressEnterKeyHandler(downloadProtectedBinary);

setDownloadBtnHandler(downloadProtectedBinary);

let manifest = null;
let contentSize = null;

async function downloadProtectedBinary() {
    const manifest = await downloadProtectedBinaryManifest(
        passwordField.value,
        workspaceField.value,
        protectedUrlSuffix
    );
    if (!manifest) {
        await postDownloadProcessor('RESPONSE_WITH_ERROR');
        return;
    }

    const encryptionContract = await EncryptionContract.fromTransferableString(
        encryptionContractStr,
        passwordField.value,
        stringToByteArray(workspaceField.value)
    );

    //alert("open on mobile error that fixed after refresh");

    contentSize = manifest.datagrams.reduce((sum, datagram) => sum + datagram.size, 0);
    console.log(`Content size = ${contentSize}`);
    if (canBeShownInBrowser(manifest.mimeType) && (contentSize < MemoryBlock.MB100)) {
        openInBrowserCheckbox.checked = true;
    }
    showDownloadProgress();
    if (openInBrowserCheckbox.checked || (!window.showSaveFilePicker)) {
        await openProtectedBinaryInBrowser(manifest, encryptionContract);
    } else {
        await saveProtectedBinaryAsFile(manifest, encryptionContract);
    }
}

async function openProtectedBinaryInBrowser(manifest, encryptionContract) {
    const chunks = [];

    const result = await downloadSharedBinaryViaWebSocket(manifest,
        async function (chunk) {
            const decChunk = await decryptBinaryChunk(chunk, encryptionContract);
            chunks.push(decChunk);
        }, null);

    if (result) {
        const blob = new Blob(chunks, {type: manifest.mimeType});
        openBlobInTheSameTab(blob, manifest.name);
    }

    await postDownloadProcessor(result ? "" : 'RESPONSE_WITH_ERROR');
}

async function saveProtectedBinaryAsFile(manifest, encryptionContract) {
    const options = {
        suggestedName: manifest.name
    };
    const fileHandle = await window.showSaveFilePicker(options);
    const writable = await fileHandle.createWritable();

    const result = await downloadSharedBinaryViaWebSocket(manifest,
        async function (chunk) {
            const decChunk = await decryptBinaryChunk(chunk, encryptionContract);
            await writable.write({type: 'write', data: decChunk});
        }, async function () {
            await writable.close();
        });

    await postDownloadProcessor(result ? "" : 'RESPONSE_WITH_ERROR');
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

