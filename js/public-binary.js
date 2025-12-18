async function webSocketAvailabilityCheck() {
    const result = await CallableFuture.callAsynchronously(1000, null, function (waiterId) {
        try {
            const ws = new WebSocket("wss://echo.websocket.org");
            ws.onopen = () => {
                CallableFuture.releaseWaiterIfExistsWithSuccess(waiterId, "true");
                ws.close(1000, "Testing was finished")
            };
            ws.onerror = err => {
                CallableFuture.releaseWaiterIfExistsWithError(waiterId, err);
                ws.close(1000, "Testing was finished");
            };
        } catch (err) {
            CallableFuture.releaseWaiterIfExistsWithError(waiterId, err);
        }
    });
    return WaiterResponseType.SUCCESS === result.type;
}

function openPublicBinaryInTheSameTab(workspaceId, binaryId, pageId, humanToken) {
    let directDownloadUrl = `${serverUrl}/binary/${workspaceId}/${binaryId}`;
    if (pageId) {
        directDownloadUrl = `${directDownloadUrl}?page-id=${pageId}&human-token=${humanToken}`;
    }

    webSocketAvailabilityCheck().then(result => {
        if (!result) {
            window.location.replace(directDownloadUrl);
        } else {
            openWsConnection(binaryId).then(() => {
                PushcaClient.stopWebSocketPermanently();
                delay(100).then(() => window.location.replace(directDownloadUrl));
            });
        }
    });
}

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

if (!humanOnly) {
    openPublicBinaryInTheSameTab(
        workspaceId,
        binaryId,
        null,
        null
    );
} else {

    let manifest = null;
    let openInBrowserFlag = false;
    let contentSize = 0;

    const workspaceIdLabel = document.getElementById('workspaceIdLabel');
    const contentPreviewContainer = document.getElementById('contentPreviewContainer');
    const previewBox = document.getElementById("previewBox");

    function showErrorMessage(errorText) {
        contentPreviewContainer.remove();
        errorMessage.textContent = errorText;
        errorMessage.style.display = 'block';
    }

    workspaceIdLabel.textContent = `Workspace ID: ${workspaceId}`;

    document.addEventListener('DOMContentLoaded', function () {
        if (humanOnly) {
            createSimilarityChallengeDialog(
                contentPreviewContainer,
                true,
                (token, pageId) => {
                    openPublicBinaryInTheSameTab(
                        workspaceId,
                        binaryId,
                        pageId,
                        token
                    );
                },
                false,
                null,
                null,
                () => {
                    const mainContainer = document.querySelector('.main-container-full-height');
                    if (mainContainer) {
                        mainContainer.style.display = 'none';
                    }
                    delay(1000).then(
                        () => {
                            const demoWidgetContainer = document.getElementById("demoWidgetContainer");
                            if (demoWidgetContainer) {
                                const adItems = [
                                    {
                                        title: "Share with a full control over access to your content",
                                        srcUrl: "https://secure.fileshare.ovh/videos/file-share-demo-new.mp4",
                                        link: "https://secure.fileshare.ovh/file-sharing-embedded.html"
                                    },
                                    {
                                        title: "Create extra security layer on top of any social media",
                                        srcUrl: "https://secure.fileshare.ovh/videos/Fileshare-Chrome-extension-demo.mp4",
                                        link: "https://chromewebstore.google.com/detail/fileshare/hapdidbjoflidaclfhkbbjmedjgpnmgj?hl=en-US&utm_source=ext_sidebar"
                                    },
                                    {
                                        title: "Transfer files between any devices with ultimate security",
                                        srcUrl: "https://secure.fileshare.ovh/videos/file-transfer-demo.mp4",
                                        link: "https://secure.fileshare.ovh/file-transfer-embedded.html"
                                    }
                                ];

                                // Cryptocurrency wallets for donations
                                const wallets = [
                                    {
                                        cryptoCurrency: "Bitcoin (BTC)",
                                        walletAddress: "bc1qqa79qjjr8q0wc86spkyw354tpd27am3s57flxtj409xdn6yyrqfstpp9m2"
                                    },
                                    {
                                        cryptoCurrency: "Ethereum (ETH)",
                                        walletAddress: "0xe99B15Ff9B0b9eE5BCA3411d693DeE2e4b87bA5C"
                                    },
                                    {
                                        cryptoCurrency: "USDT TRC-20 (TRX)",
                                        walletAddress: "THGBNA1XpxCDWZJYcAVEGpBNQA9AuSANzp"
                                    }
                                ];

                                // Create and inject the widget
                                addDemoWidget(adItems, wallets, demoWidgetContainer);
                                demoWidgetContainer.style.display = 'block';
                            }
                        }
                    )
                }
            );
        } else {
            previewBox.style.display = "block";
            downloadPublicBinary(workspaceId, binaryId, null, null);
        }
    });

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
        if (contentSize < MemoryBlock.MB100) {
            openInBrowserFlag = true;
        }
        const isSavePickerSupported = await supportsSavePicker();
        if (openInBrowserFlag || (!isSavePickerSupported)) {
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
            openBlobInTheSameTab(blob, manifest.name);
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
}

async function supportsSavePicker(timeoutMs = 200) {
    if (typeof window.showSaveFilePicker !== "function") {
        return false;
    }

    let timeout;

    const timeoutPromise = new Promise(resolve => {
        timeout = setTimeout(() => resolve(false), timeoutMs);
    });

    const testPromise = (async () => {
        try {
            await window.showSaveFilePicker({
                suggestedName: "test.txt",
                types: [{accept: {"text/plain": [".txt"]}}]
            });
            clearTimeout(timeout);
            return true;  // if it really works
        } catch (e) {
            clearTimeout(timeout);
            return false;  // if API rejects (unsupported)
        }
    })();

    return Promise.race([timeoutPromise, testPromise]);
}