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

/**
 * Check whether a video URL can actually be played in the current browser.
 *
 * Attempts real playback and requires sustained progress (currentTime >= 2s)
 * to confirm the video is genuinely playable, not just a few buffered frames.
 *
 * @param {string} src - Video URL to test.
 * @param {number} [timeoutMs=12000] - Max time to wait before declaring failure.
 * @returns {Promise<{playable: boolean, reason: string}>}
 */
async function canPlayInBrowser(src, timeoutMs = 12000) {
    // Quick content-type check — reject non-video early
    try {
        const resp = await fetch(src, {
            method: 'HEAD',
            cache: 'no-store',
            signal: AbortSignal.timeout(5000),
        });
        if (!resp.ok) {
            return { playable: false, reason: `server returned ${resp.status}` };
        }
        const contentType = (resp.headers.get('content-type') || '').toLowerCase();
        if (contentType && !contentType.startsWith('video/') && !contentType.startsWith('application/octet-stream')) {
            return { playable: false, reason: `not a video: ${contentType}` };
        }
    } catch (e) {
        return { playable: false, reason: `HEAD request failed: ${e.message}` };
    }

    // Playback test: require sustained progress, not just one decoded frame
    return new Promise((resolve) => {
        let video = document.getElementById('videoTester');
        if (!video) {
            video = document.createElement('video');
            video.id = 'videoTester';
            video.style.cssText =
                'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;opacity:0;pointer-events:none';
            document.body.appendChild(video);
        }

        video.muted = true;
        video.playsInline = true;
        video.preload = 'auto';
        video.volume = 0;

        let settled = false;
        let playbackStarted = false;
        let stallTimer = null;
        const listeners = [];

        const on = (target, event, handler) => {
            target.addEventListener(event, handler);
            listeners.push([target, event, handler]);
        };

        const cleanup = () => {
            listeners.forEach(([t, e, h]) => t.removeEventListener(e, h));
            listeners.length = 0;
            if (stallTimer) clearTimeout(stallTimer);
            video.pause();
            video.removeAttribute('src');
            video.load();
        };

        const done = (playable, reason) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            cleanup();
            resolve({ playable, reason });
        };

        const timer = setTimeout(() => {
            if (playbackStarted && video.currentTime > 0 && video.videoWidth > 0) {
                done(true, `partial playback confirmed at ${video.currentTime.toFixed(1)}s`);
            } else {
                done(false, 'timeout waiting for sustained playback');
            }
        }, timeoutMs);

        on(video, 'error', () => {
            const code = video.error ? video.error.code : -1;
            const msgs = {
                1: 'aborted',
                2: 'network error',
                3: 'decode error',
                4: 'format not supported',
            };
            done(false, msgs[code] || `error code ${code}`);
        });

        on(video, 'timeupdate', () => {
            if (video.currentTime > 0 && video.videoWidth > 0 && video.videoHeight > 0) {
                playbackStarted = true;
                // Reset stall detection on each progress
                if (stallTimer) clearTimeout(stallTimer);
                stallTimer = setTimeout(() => {
                    if (video.currentTime < 1.5) {
                        done(false, `playback stalled at ${video.currentTime.toFixed(1)}s`);
                    }
                }, 4000);

                if (video.currentTime >= 2.0) {
                    done(true, `sustained playback confirmed ${video.videoWidth}x${video.videoHeight}`);
                }
            }
        });

        on(video, 'loadeddata', () => {
            if (video.videoWidth === 0 || video.videoHeight === 0) {
                done(false, 'loaded but no video dimensions');
                return;
            }
            video.play().catch(() => done(false, 'play() rejected'));
        });

        video.src = src;
        video.load();
    });
}
async function openPublicBinaryInTheSameTab(workspaceId, binaryId, pageId, humanToken) {
    let encodedNameSuffix = "";
    try {
        const manifest = await downloadPublicBinaryManifest(workspaceId, binaryId, pageId, humanToken);
        encodedNameSuffix = `/${encodeURIComponent(manifest.name)}`;
    } catch (error) {
        const message =
            error?.response?.data?.message ||
            error?.response?.data ||
            error?.message ||
            JSON.stringify(error);

        console.log(`Failed to load manifest:\n${message}`);
    }
    let directDownloadUrl = `${serverUrl}/binary/${workspaceId}/${binaryId}${encodedNameSuffix}`;
    //let directDownloadUrl = `${serverUrl}/binary/${workspaceId}/${binaryId}`;
    const forDownloadOnly =  false;//! (await canPlayInBrowser(directDownloadUrl));
    directDownloadUrl = `${directDownloadUrl}?for-download-only=${forDownloadOnly}`;
    if (pageId) {
        directDownloadUrl = `${directDownloadUrl}&page-id=${pageId}&human-token=${humanToken}`;
    }

    webSocketAvailabilityCheck().then(result => {
        if (!result) {
            window.location.replace(directDownloadUrl);
        } else {
            openWsConnection(binaryId).then(
                () => {
                    delay(1500).then(
                        () => {
                            PushcaClient.stopWebSocketPermanently();
                            window.location.replace(directDownloadUrl);
                        }
                    );
                }
            );
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
                null
            );
        } else {
            previewBox.style.display = "block";
            downloadPublicBinary(workspaceId, binaryId, null, null);
        }
    });

    function downloadPublicBinary(workspaceId, binaryId, pageId, humanToken) {
        prepareBinaryDownloading(workspaceId, binaryId, pageId, humanToken).then(
            (userActionRequired) => {
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
            }
        );
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