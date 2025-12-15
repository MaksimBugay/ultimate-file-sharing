const wsUrl = 'wss://secure.fileshare.ovh:31085';

const playableMediaTypes = [
    "video/mp4",
    'video/webm; codecs="vp8, opus"',
    'video/webm; codecs="vp9, opus"',
    "audio/webm",
    "audio/mpeg"
];

const playableImageTypes = [
    "image/jpeg",
    "image/bmp",
    "image/png"
];

function isPlayableMedia(contentType) {
    // Remove the codec part from the contentType if it exists
    const baseContentType = contentType.split(';')[0].trim(); // Extract base type, e.g., "video/webm"

    // Check if the base content type exists in the playableMediaTypes array
    return playableMediaTypes.some(type => type.split(';')[0].trim() === baseContentType);
}

function canBeShownInBrowser(contentType) {
    return ('application/pdf' === contentType) || ('text/plain' === contentType) || playableImageTypes.includes(contentType) || isPlayableMedia(contentType);
}

function diagnoseTelegram() {
    const info = {
        userAgent: navigator.userAgent,
        hasTelegram: typeof window.Telegram !== 'undefined',
        hasWebApp: !!(window.Telegram && window.Telegram.WebApp),
        hasWebViewProxy: typeof window.TelegramWebviewProxy !== 'undefined',
        windowKeys: Object.keys(window).filter(k => k.toLowerCase().includes('telegram')),
        navigatorKeys: Object.keys(navigator).filter(k => k.toLowerCase().includes('telegram'))
    };
    if (window.Telegram) {
        info.telegramKeys = Object.keys(window.Telegram);
        if (window.Telegram.WebApp) {
            info.webAppKeys = Object.keys(window.Telegram.WebApp);
            info.platform = window.Telegram.WebApp.platform;
            info.version = window.Telegram.WebApp.version;
        }
    }
    alert(`Diagnostic: ${JSON.stringify(info, null, 2)}`);
    console.log('Telegram Diagnostic:', JSON.stringify(info, null, 2));
    return info;
}

//diagnoseTelegram();
function isTelegram() {
    return !!(
        window.TelegramWebview ||
        (window.Telegram?.WebApp) ||
        /Telegram/i.test(navigator.userAgent || '')
    );
}


function isFacebook() {
    const ua = navigator.userAgent || '';
    return /FBAN|FBAV/i.test(ua);
}

function isEmbeddedBrowser() {
    return isTelegram() || isFacebook();
}


//======================================================================================================================

const contentContainer = document.getElementById('contentContainer');
const contentText = document.getElementById('contentText');
const contentTextContainer = document.getElementById("contentTextContainer");
const contentImage = document.getElementById("contentImage");
const pdfViewer = document.getElementById('pdfViewer');
const contentVideoPlayer = document.getElementById('contentVideoPlayer');
const downloadBtn = document.getElementById('downloadBtn');
const progressBarContainer = document.getElementById("progressBarContainer");
const progressBar = document.getElementById("downloadProgress");
const progressPercentage = document.getElementById("progressPercentage");
const errorMessage = document.getElementById('errorMessage');
const downloadLink = document.getElementById("downloadLink");

function showDownloadProgress() {
    progressBarContainer.style.display = 'block';
    downloadBtn.style.display = 'none';
}

function restoreInnerHTMLFromBase64(inBase64String) {
    try {
        let base64String = inBase64String;
        // Step 1: Fix URL-safe Base64
        base64String = fixBase64ForDecoding(base64String);

        // Step 2: Pad the Base64 string
        base64String = padBase64String(base64String);

        const arrayBuffer = urlSafeBase64ToArrayBuffer(base64String);

        // Decode array buffer to text using UTF-8
        const decoder = new TextDecoder('utf-8');
        return decoder.decode(arrayBuffer);
    } catch (error) {
        console.error("Error decoding Base64 string:", error);
        return "";
    }
}

// Helper function to fix URL-safe Base64
function fixBase64ForDecoding(base64String) {
    return base64String.replace(/-/g, '+').replace(/_/g, '/');
}

// Helper function to pad Base64 string
function padBase64String(base64String) {
    while (base64String.length % 4 !== 0) {
        base64String += '=';
    }
    return base64String;
}

function openBlobInTheSameTab(blob, binaryFileName) {
    openBlobInBrowser(blob, binaryFileName);
    /*if (isMobile()) {
        openBlobInBrowser(blob, binaryFileName);
    } else {
        const blobUrl = URL.createObjectURL(blob);
        window.location.replace(blobUrl);
    }*/
}

function openBlobInBrowser(blob, binaryFileName) {
    contentContainer.style.display = 'block';
    if ('text/plain' === blob.type) {
        const reader = new FileReader();
        const textDecoder = new TextDecoder("utf-8");

        reader.onload = function () {
            const resultBuffer = reader.result;

            if (resultBuffer instanceof ArrayBuffer) {
                contentText.innerHTML = textDecoder.decode(resultBuffer);
                contentText.style.display = 'block';
                contentTextContainer.style.display = 'block';
            } else {
                console.error("Error: Expected ArrayBuffer, but got something else");
            }
        };

        reader.readAsArrayBuffer(blob);
    } else if (playableImageTypes.includes(blob.type)) {
        const blobUrl = URL.createObjectURL(blob);
        contentImage.src = blobUrl;
        contentImage.onload = function () {
            contentImage.style.display = 'block';
            URL.revokeObjectURL(blobUrl);
        };
    } else if (blob.type.includes('pdf')) {
        const blobUrl = URL.createObjectURL(blob);
        delay(1000).then(() => {
            pdfViewer.src = blobUrl;
            pdfViewer.style.display = 'block';
        });
        delay(5000).then(() => {
            URL.revokeObjectURL(blobUrl);
        });
    } else if (isPlayableMedia(blob.type)) {
        const blobUrl = URL.createObjectURL(blob);
        const source = document.createElement('source');
        source.src = blobUrl;
        source.type = blob.type;

        contentVideoPlayer.appendChild(source);

        if (isMobile()) {
            contentVideoPlayer.muted = true; // Required for autoplay on mobile
            contentVideoPlayer.playsInline = true;
        }
        contentVideoPlayer.autoplay = true;

        contentVideoPlayer.addEventListener('canplay', function () {
            contentVideoPlayer.play().catch((err) => {
                console.error('Playback blocked:', err);
            });
        });

        contentVideoPlayer.style.display = 'block';
    } else {
        if (isMobile()) {
            downloadLink.href = URL.createObjectURL(blob);
            downloadLink.target = '_blank';
            downloadLink.download = binaryFileName;
            downloadLink.style.display = 'inline-block';
            downloadLink.click();
        } else {
            downloadFile(blob, binaryFileName);
        }
    }
}

async function downloadSharedBinaryViaWebSocket(manifest, binaryChunkProcessor, afterFinishedHandler) {
    if (!manifest) {
        return false;
    }

    await openWsConnection(manifest.id);

    if (!PushcaClient.isOpen()) {
        showErrorMessage("Download channel is broken");
        return false;
    }

    for (let order = 0; order < manifest.datagrams.length; order++) {

        const chunk = await PushcaClient.downloadBinaryChunk(
            manifest.sender,
            manifest.id,
            order,
            MemoryBlock.MB_ENC
        );

        if (!chunk) {
            return false;
        }

        if (typeof binaryChunkProcessor === 'function') {
            await binaryChunkProcessor(chunk);
        }

        const percentComplete = Math.round(((order + 1) / manifest.datagrams.length) * 100);
        progressBar.value = percentComplete;
        progressPercentage.textContent = `${percentComplete}%`;
    }
    PushcaClient.stopWebSocketPermanently();

    if (typeof afterFinishedHandler === 'function') {
        await afterFinishedHandler();
    }

    return true;
}

//================================== Web socket connection =============================================================

async function openWsConnection(binaryId) {
    if (!PushcaClient.isOpen()) {
        const pClient = new ClientFilter(
            `SecureFileShare_${binaryId}`,
            "anonymous-sharing",
            uuid.v4().toString(),
            "download-binary-ws-page"
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


if (isEmbeddedBrowser() && /Android/i.test(navigator.userAgent)) {
    document.querySelector('.login-container').remove();
    contentContainer.style.display = "block";

    const href = window.location.href;

    // Remove protocol FIRST
    const noScheme = href.replace(/^https?:\/\//, '');

    downloadLink.href =
        `intent://${noScheme}` +
        `#Intent;scheme=https;package=com.android.chrome;end`;

    downloadLink.target = '_blank';
    downloadLink.style.display = 'inline-block';
    downloadLink.addEventListener("click", () => window.close());
} else if (isEmbeddedBrowser() && /iPhone|iPad|iPod/i.test(navigator.userAgent)) {
    //showIOSInstruction();
}