const serverUrl = 'https://secure.fileshare.ovh:31443';
const urlParams = new URLSearchParams(window.location.search);

// Retrieve specific parameters
let protectedUrlSuffix = decodeURIComponent(urlParams.get('suffix'));
let encryptionContract;

const suffixParts = protectedUrlSuffix.split('|');
if (suffixParts.length > 1) {
    protectedUrlSuffix = suffixParts[0];
    encryptionContract = EncryptionContract.fromTransferableString(suffixParts[1]);
}

const passwordField = document.getElementById('password');
const workspaceField = document.getElementById('workSpaceId');
const downloadBtn = document.getElementById('downloadBtn');
const togglePasswordBtn = document.getElementById('togglePassword');
const progressBar = document.getElementById("downloadProgress");
const progressPercentage = document.getElementById("progressPercentage");
const loginContainer = document.querySelector('.login-container');
const progressBarContainer = document.getElementById("progressBarContainer");
const downloadButtonText = document.getElementById("buttonText");
const downloadSpinner = document.getElementById('downloadSpinner');
const pastCredentialsTextarea = document.getElementById('pastCredentials');
const errorMessage = document.getElementById('errorMessage');

pastCredentialsTextarea.addEventListener('blur', function () {
    pastCredentialsTextarea.style.visibility = 'hidden';
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
        if (window.showSaveFilePicker && (!encryptionContract)) {
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
        delay(1000).then(() => window.close());
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
    if (encryptionContract) {
        blob = await decryptAES(chunks, encryptionContract.base64Key, encryptionContract.base64IV);
    } else {
        blob = new Blob(chunks, {type: 'application/octet-stream'});
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
    )

    return new DownloadProtectedBinaryRequest(
        request.suffix,
        request.exp,
        arrayBufferToUrlSafeBase64(signature)
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

