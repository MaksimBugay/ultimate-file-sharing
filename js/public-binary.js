const serverUrl = 'https://secure.fileshare.ovh';
const urlParams = new URLSearchParams(window.location.search);

let workspaceId = null;
let binaryId = null;

if (urlParams.get('w')) {
    workspaceId = urlParams.get('w');
}

if (urlParams.get('id')) {
    binaryId = urlParams.get('id');
}

let manifest = null;
let openInBrowserFlag = false;
let contentSize = 0;

const workspaceIdLabel = document.getElementById('workspaceIdLabel');
const contentPreviewContainer = document.getElementById('contentPreviewContainer');

function showErrorMessage(errorText) {
    contentPreviewContainer.remove();
    errorMessage.textContent = errorText;
    errorMessage.style.display = 'block';
}

workspaceIdLabel.textContent = `Workspace ID: ${workspaceId}`;

prepareBinaryDownloading(workspaceId, binaryId).then((userActionRequired) => {
    if (!userActionRequired) {
        return;
    }
    downloadBtn.addEventListener('click', function () {
        savePublicBinaryAsFile(manifest);
    });
    document.addEventListener('keydown', function (event) {
        if (event.key === 'Enter') {
            event.preventDefault();
            event.stopPropagation();
            if ('downloadBtn' === event.target.id) {
                savePublicBinaryAsFile(manifest);
            }
        }
    });
});

//======================================== Implementations =============================================================
async function prepareBinaryDownloading(workspaceId, binaryId) {
    let userActionRequired = false;

    if ((!workspaceId) || (!binaryId)) {
        showErrorMessage("Undefined binary");
        return userActionRequired;
    }

    const readMeText = await fetchPublicBinaryDescription(workspaceId, binaryId);
    const readMeTextMemo = document.getElementById("readMeTextMemo");
    if (readMeText && readMeTextMemo) {
        readMeTextMemo.textContent = readMeText;
    }

    manifest = await downloadPublicBinaryManifest(workspaceId, binaryId);

    contentSize = manifest.datagrams.reduce((sum, datagram) => sum + datagram.size, 0);
    if (canBeShownInBrowser(manifest.mimeType) && (contentSize < MemoryBlock.MB100)) {
        openInBrowserFlag = true;
    }
    showDownloadProgress();
    if (openInBrowserFlag || (!window.showSaveFilePicker)) {
        await openPublicBinaryInBrowser(manifest);
    } else {
        downloadBtn.focus();
        userActionRequired = true;
    }
    return userActionRequired;
}

async function savePublicBinaryAsFile(manifest) {
    const options = {
        suggestedName: manifest.name
    };
    const fileHandle = await window.showSaveFilePicker(options);
    const writable = await fileHandle.createWritable();

    const result = await downloadSharedBinaryViaWebSocket(manifest,
        async function (chunk) {
            await writable.write({type: 'write', data: chunk});
        }, async function () {
            await writable.close();
        });

    await postDownloadProcessor(result ? "" : 'RESPONSE_WITH_ERROR');
}

async function openPublicBinaryInBrowser(manifest) {
    const chunks = [];

    const result = await downloadSharedBinaryViaWebSocket(manifest,
        async function (chunk) {
            chunks.push(chunk);
        }, null);

    if (result) {
        const blob = new Blob(chunks, {type: manifest.mimeType});
        openBlobInBrowser(blob, manifest.name);
    }

    await postDownloadProcessor(result ? "" : 'RESPONSE_WITH_ERROR');
}

async function postDownloadProcessor(result) {
    if (contentPreviewContainer) {
        contentPreviewContainer.remove();
    }
    if ('RESPONSE_WITH_ERROR' !== result) {
        if (!openInBrowserFlag) {
            delay(1000).then(() => window.close());
        }
    }
}

async function fetchPublicBinaryDescription(workspaceId, binaryId) {
    const url = serverUrl + `/binary/binary-manifest/${workspaceId}/${binaryId}`;
    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            return null;
        }

        return await response.text();
    } catch (error) {
        console.error('Cannot fetch public binary description:', error);
        return null;
    }
}

async function downloadPublicBinaryManifest(workspaceId, binaryId) {
    const response = await fetch(serverUrl + `/binary/m/${workspaceId}/${binaryId}`, {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json'
        }
    });
    if (!response.ok) {
        console.error('Failed download public binary manifest attempt ' + response.statusText);
        showErrorMessage('Failed download public binary attempt ' + response.statusText);
        return null;
    }
    return response.json();
}
