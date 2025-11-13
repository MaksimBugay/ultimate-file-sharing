const serverUrl = 'https://secure.fileshare.ovh';
const urlParams = new URLSearchParams(window.location.search);
let workspaceId = null;
let binaryId = null;
let humanOnly = false;

if (urlParams.get('w')) {
    workspaceId = urlParams.get('w');
}

if (urlParams.get('id')) {
    binaryId = urlParams.get('id');
}

if (urlParams.get('human-only')) {
    humanOnly = true;
}

let manifest = null;
let openInBrowserFlag = false;
let contentSize = 0;

const workspaceIdLabel = document.getElementById('workspaceIdLabel');
const contentPreviewContainer = document.getElementById('contentPreviewContainer');
const captchaFrame = document.getElementById("captchaFrame");
const captchaContainer = document.getElementById("captchaContainer");
const previewBox = document.getElementById("previewBox");

function removeCaptcha() {
    if (captchaFrame) {
        captchaFrame.remove();
    }
    if (captchaContainer) {
        captchaContainer.remove();
    }
}

function showErrorMessage(errorText) {
    contentPreviewContainer.remove();
    errorMessage.textContent = errorText;
    errorMessage.style.display = 'block';
}

workspaceIdLabel.textContent = `Workspace ID: ${workspaceId}`;

if (humanOnly) {
    previewBox.style.display = "none";

    const pageId = uuid.v4().toString();
    const humanTokenConsumer = async function (token) {
        PushcaClient.stopWebSocket();
        delay(1000);
        removeCaptcha();
        previewBox.style.display = "block";

        downloadPublicBinary(workspaceId, binaryId, pageId, token);
    }

    if (captchaContainer) {
        addVisualSimilarityChallenge(
            captchaContainer,
            pageId,
            humanTokenConsumer()
        );
    } else {

        PushcaClient.onHumanTokenHandler = humanTokenConsumer;

        captchaFrame.src = `https://secure.fileshare.ovh/puzzle-captcha-min.html?page-id=${pageId}&piece-length=180&skip-demo=false`;
        openWsConnection();

        async function openWsConnection() {
            if (!PushcaClient.isOpen()) {
                const pClient = new ClientFilter(
                    "SecureFileShare",
                    "dynamic-captcha",
                    pageId,
                    "CAPTCHA_CLIENT"
                );
                await PushcaClient.openWsConnection(
                    'wss://secure.fileshare.ovh:31085',
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
    }
} else {
    removeCaptcha();
    previewBox.style.display = "block";
    downloadPublicBinary(workspaceId, binaryId, null, null);
}

function downloadPublicBinary(workspaceId, binaryId, pageId, humanToken) {
    prepareBinaryDownloading(workspaceId, binaryId, pageId, humanToken).then((userActionRequired) => {
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
}

//======================================== Implementations =============================================================
async function prepareBinaryDownloading(workspaceId, binaryId, pageId, humanToken) {
    let userActionRequired = false;

    if ((!workspaceId) || (!binaryId)) {
        showErrorMessage("Undefined binary");
        return userActionRequired;
    }

    const readMeText = await fetchPublicBinaryDescription(workspaceId, binaryId);
    const readMeTextMemo = document.getElementById("readMeTextMemo");
    if (readMeText && readMeTextMemo) {
        if (isBase64(readMeText)) {
            readMeTextMemo.innerHTML = restoreInnerHTMLFromBase64(readMeText);
        } else {
            readMeTextMemo.innerText = readMeText;
        }
    }

    manifest = await downloadPublicBinaryManifest(workspaceId, binaryId, pageId, humanToken);

    contentSize = manifest.datagrams.reduce((sum, datagram) => sum + datagram.size, 0);
    if (canBeShownInBrowser(manifest.mimeType) && (contentSize < MemoryBlock.MB100)) {
        openInBrowserFlag = true;
    }
    if (openInBrowserFlag || (!window.showSaveFilePicker)) {
        showDownloadProgress();
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
    showDownloadProgress();
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

async function downloadPublicBinaryManifest(workspaceId, binaryId, pageId, humanToken) {
    const url = serverUrl + "/binary/m/public"; // Ensure this is your actual API URL

    const requestData = {
        workspaceId: workspaceId,
        binaryId: binaryId,
        pageId: pageId,
        humanToken: humanToken
    };

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(requestData)
        });

        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }

        return await response.json();

    } catch (error) {
        console.error("Error during fetching binary manifest:", error);
        throw error; // Rethrow error to handle it in the calling function
    }
}
