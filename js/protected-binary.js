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

const serverUrl = 'https://secure.fileshare.ovh:31443';
const urlParams = new URLSearchParams(window.location.search);

// Retrieve specific parameters
let protectedUrlSuffix = decodeURIComponent(urlParams.get('suffix'));
let encryptionContractStr;
let signatureHash;

const suffixParts = protectedUrlSuffix.split('|');
if (suffixParts.length > 1) {
    protectedUrlSuffix = suffixParts[0];
    encryptionContractStr = suffixParts[1];
}
if (suffixParts.length > 2) {
    signatureHash = suffixParts[2];
}
console.log(`Signature hash: ${signatureHash}`);

const passwordField = document.getElementById('password');
const workspaceField = document.getElementById('workSpaceId');
const downloadBtn = document.getElementById('downloadBtn');
const togglePasswordBtn = document.getElementById('togglePassword');
const openInBrowserCheckbox = document.getElementById("openInBrowserCheckbox");
const progressBar = document.getElementById("downloadProgress");
const progressPercentage = document.getElementById("progressPercentage");
const loginContainer = document.querySelector('.login-container');
const contentContainer = document.getElementById('contentContainer');
const contentImage = document.getElementById("contentImage");
const contentVideoPlayer = document.getElementById('contentVideoPlayer');
const progressBarContainer = document.getElementById("progressBarContainer");
const downloadButtonText = document.getElementById("buttonText");
const downloadSpinner = document.getElementById('downloadSpinner');
const pastCredentialsTextarea = document.getElementById('pastCredentials');
const errorMessage = document.getElementById('errorMessage');

pastCredentialsTextarea.addEventListener('blur', function () {
    //pastCredentialsTextarea.style.visibility = 'hidden';
});

if (urlParams.get('workspace')) {
    pastCredentialsTextarea.style.visibility = 'hidden';
    workspaceField.value = urlParams.get('workspace');
    passwordField.focus();
} else {
    pastCredentialsTextarea.focus();
}

pastCredentialsTextarea.addEventListener('input', () => {
    const memoText = pastCredentialsTextarea.value;
    if (memoText.includes('workspaceId') && memoText.includes('password')) {
        const object = JSON.parse(memoText);
        workspaceField.value = object['workspaceId'];
        passwordField.value = object['password'];
        pastCredentialsTextarea.value = '';
        downloadSharedBinary();
    }
});

document.addEventListener('keydown', function (event) {
    if (event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        if ('password' === event.target.id || 'pastCredentials' === event.target.id) {
            downloadSharedBinary();
        }
    }
});

downloadBtn.addEventListener('click', function () {
    downloadSharedBinary();
});

function downloadSharedBinary() {
    createSignedDownloadRequest(passwordField.value, workspaceField.value, protectedUrlSuffix).then(request => {
        console.log(request);
        if (window.showSaveFilePicker && (!encryptionContractStr)) {
            downloadProtectedBinary(request).then((result) => {
                postDownloadProcessor(result);
            });
        } else {
            downloadProtectedBinarySilently(request).then((result) => {
                postDownloadProcessor(result);
            });
        }
    });
}

function postDownloadProcessor(result) {
    if (loginContainer) {
        loginContainer.remove();
    }
    if ('RESPONSE_WITH_ERROR' !== result) {
        if (!openInBrowserCheckbox.checked) {
            delay(1000).then(() => window.close());
        }
    }
}

function extractFileName(contentDisposition) {
    let filename = 'protected-binary.data';

    if (contentDisposition && contentDisposition.includes('filename=')) {
        filename = contentDisposition.split('filename=')[1].split(';')[0];
        filename = filename.replace(/['"]/g, '');
    }

    return filename;
}

async function loadBinaryResponse(downloadRequest) {
    const response = await fetch(serverUrl + '/binary/protected', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(downloadRequest)
    });
    if (!response.ok) {
        console.error('Failed download protected binary attempt ' + response.statusText);
        errorMessage.textContent = 'Failed download protected binary attempt ' + response.statusText;
        errorMessage.style.display = 'block';
        return null;
    }
    return response;
}

async function downloadProtectedBinary(downloadRequest) {
    const response = await loadBinaryResponse(downloadRequest);
    if (response === null) {
        return 'RESPONSE_WITH_ERROR';
    }
    const contentType = response.headers.get('content-type');
    const contentLength = response.headers.get('content-length');
    const binaryFileName = extractFileName(response.headers.get('Content-Disposition'));
    const reader = response.body.getReader();

    // Open the file for writing
    const options = {
        suggestedName: binaryFileName
    };
    const fileHandle = await window.showSaveFilePicker(options);
    const writable = await fileHandle.createWritable();
    showDownloadProgress();

    let writtenBytes = 0;

    while (true) {
        const {value, done} = await reader.read();

        if (done) {
            break;
        }

        await writable.write({type: 'write', data: value});
        writtenBytes += value.byteLength;

        // Optional progress update
        if (contentLength) {
            const percentComplete = Math.round((writtenBytes / contentLength) * 100);
            progressBar.value = percentComplete;
            progressPercentage.textContent = `${percentComplete}%`;
        } else {
            // If content-length is not available, we can't calculate progress
            progressBar.removeAttribute('value');
        }
    }

    // Close the writable stream
    await writable.close();

    console.log(`File downloaded to: ${fileHandle.name}`);
}

function showDownloadProgress() {
    progressBarContainer.style.display = 'block';
    downloadBtn.style.display = 'none';
}

async function downloadProtectedBinarySilently(downloadRequest) {
    //showSpinnerInButton();
    showDownloadProgress();
    const response = await loadBinaryResponse(downloadRequest);
    if (response === null) {
        return 'RESPONSE_WITH_ERROR';
    }
    const contentType = response.headers.get('content-type');
    const contentLength = response.headers.get('content-length');
    const binaryFileName = extractFileName(response.headers.get('Content-Disposition'));
    const reader = response.body.getReader();
    const chunks = [];
    let receivedLength = 0;

    while (true) {
        const {done, value} = await reader.read();
        if (done) {
            break;
        }
        chunks.push(value);
        receivedLength += value.length;

        if (contentLength) {
            const progress = Math.round((receivedLength / contentLength) * 100);
            progressBar.value = progress;
            progressPercentage.textContent = `${progress}%`;
        } else {
            // Handle case where content-length is not available
            progressBar.value = null;
            progressPercentage.textContent = 'Downloading...';
        }
    }
    let blob;
    if (encryptionContractStr) {
        const encryptionContract = await EncryptionContract.fromTransferableString(
            encryptionContractStr,
            passwordField.value,
            stringToByteArray(workspaceField.value)
        );

        let success = true;
        try {
            blob = await decryptChunkByChunk(chunks, encryptionContract);
        } catch (err) {
            success = false;
            console.error(err);
        }
        if (!success) {
            blob = await decryptAES(chunks, encryptionContract.base64Key, encryptionContract.base64IV, contentType);
        }
    } else {
        blob = new Blob(chunks, {type: contentType});
    }
    chunks.length = 0;
    if (openInBrowserCheckbox.checked) {
        if (playableImageTypes.includes(contentType)) {
            const blobUrl = URL.createObjectURL(blob);
            contentImage.src = blobUrl;
            contentImage.onload = function () {
                contentContainer.style.display = 'block';
                contentImage.style.display = 'block';
                URL.revokeObjectURL(blobUrl);
            };
            return;
        }
        if (isPlayableMedia(contentType)) {
            const blobUrl = URL.createObjectURL(blob);
            const source = document.createElement('source');
            source.src = blobUrl;
            source.type = contentType;

            contentVideoPlayer.appendChild(source);

            contentVideoPlayer.addEventListener('canplay', function () {
                contentVideoPlayer.play();
            });

            contentContainer.style.display = 'block';
            contentVideoPlayer.style.display = 'block';
            return;
        }
    }
    downloadFile(blob, binaryFileName);
    //const blob = new Blob(chunks, {type: response.headers.get('content-type')});
    //const blob = new Blob([await response.arrayBuffer()], {type: response.headers.get('content-type')});
}

async function createSignedDownloadRequest(pwd, workspaceId, suffix) {
    const request = new DownloadProtectedBinaryRequest(
        suffix,
        new Date().getTime() + 30000,
        null
    );

    const signature = await makeSignature(
        pwd,
        stringToByteArray(workspaceId),
        JSON.stringify(request.toSkipSignatureJSON())
    );

    const passwordHash = await calculateSha256(stringToArrayBuffer(pwd));

    return new DownloadProtectedBinaryRequest(
        request.suffix,
        request.exp,
        arrayBufferToUrlSafeBase64(signature),
        null,
        passwordHash
    )
}

togglePasswordBtn.addEventListener('mousedown', function () {
    passwordField.setAttribute('type', 'text');
});

togglePasswordBtn.addEventListener('mouseup', function () {
    passwordField.setAttribute('type', 'password');
});

togglePasswordBtn.addEventListener('mouseleave', function () {
    passwordField.setAttribute('type', 'password');
});

// Toggle password visibility on mobile (touch events)
togglePasswordBtn.addEventListener('touchstart', function () {
    passwordField.setAttribute('type', 'text');
});

togglePasswordBtn.addEventListener('touchend', function () {
    passwordField.setAttribute('type', 'password');
});

