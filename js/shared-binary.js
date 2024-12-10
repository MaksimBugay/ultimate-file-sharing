
const wsUrl = 'wss://secure.fileshare.ovh:31085';

const playableMediaTypes = [
    "video/mp4",
    'video/webm; codecs="vp8, opus"',
    'video/webm; codecs="vp9, opus"',
    "audio/webm"
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
    return ('text/plain' === contentType) || playableImageTypes.includes(contentType) || isPlayableMedia(contentType);
}

//======================================================================================================================

const contentContainer = document.getElementById('contentContainer');
const contentText = document.getElementById('contentText');
const contentTextContainer = document.getElementById("contentTextContainer");
const contentImage = document.getElementById("contentImage");
const contentVideoPlayer = document.getElementById('contentVideoPlayer');
const downloadBtn = document.getElementById('downloadBtn');
const progressBarContainer = document.getElementById("progressBarContainer");
const progressBar = document.getElementById("downloadProgress");
const progressPercentage = document.getElementById("progressPercentage");
const errorMessage = document.getElementById('errorMessage');

function showDownloadProgress() {
    progressBarContainer.style.display = 'block';
    downloadBtn.style.display = 'none';
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

async function downloadSharedBinaryViaWebSocket(manifest, binaryChunkProcessor, afterFinishedHandler) {
    if (!manifest) {
        return false;
    }

    await openWsConnection();

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
    PushcaClient.stopWebSocket();

    if (typeof afterFinishedHandler === 'function') {
        await afterFinishedHandler();
    }

    return true;
}

//================================== Web socket connection =============================================================

async function openWsConnection() {
    if (!PushcaClient.isOpen()) {
        const pClient = new ClientFilter(
            "SecureFileShare",
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

