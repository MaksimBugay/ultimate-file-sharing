const serverUrl = 'https://vasilii.prodpushca.com:30443';
const urlParams = new URLSearchParams(window.location.search);

// Retrieve specific parameters
const protectedUrlSuffix = urlParams.get('suffix');

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

workspaceField.focus();

pastCredentialsTextarea.addEventListener('input', () => {
    const memoText = pastCredentialsTextarea.value;
    if (memoText.includes('workspaceId') && memoText.includes('password')) {
        const object = JSON.parse(memoText);
        workspaceField.value = object['workspaceId'];
        passwordField.value = object['password'];
        pastCredentialsTextarea.value = '';
    }
});

downloadBtn.addEventListener('click', function () {
    createSignedDownloadRequest(passwordField.value, workspaceField.value, protectedUrlSuffix).then(request => {
        console.log(request);
        if (window.showSaveFilePicker) {
            downloadProtectedBinary(request).then(() => {
                postDownloadProcessor();
            });
        } else {
            downloadProtectedBinarySilently(request).then(() => {
                if (loginContainer) {
                    loginContainer.remove();
                }
            });
        }
    });
});

function postDownloadProcessor() {
    if (loginContainer) {
        loginContainer.remove();
    }
    delay(1000).then(() => window.close());
}

function extractFileName(contentDisposition) {
    let filename = 'protected-binary.data';

    if (contentDisposition && contentDisposition.includes('filename=')) {
        filename = contentDisposition.split('filename=')[1].split(';')[0];
        filename = filename.replace(/['"]/g, '');
    }

    return filename;
}

async function downloadProtectedBinary(downloadRequest) {
    const response = await fetch(serverUrl + '/binary/protected', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(downloadRequest)
    });
    if (!response.ok) {
        console.error('Failed download protected binary attempt ' + response.statusText);
        return null;
    }
    console.log(response.headers.get('Content-Disposition'));
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

function showSpinnerInButton() {
    document.getElementById('download-spinner').style.display = 'flex';
    document.getElementById('download-message').textContent = 'Downloading...';
}

function showDownloadProgress() {
    progressBarContainer.style.display = 'block';
    downloadBtn.style.display = 'none';
}

async function downloadProtectedBinarySilently(downloadRequest) {
    //showSpinnerInButton();
    showDownloadProgress();
    const response = await fetch(serverUrl + '/binary/protected', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(downloadRequest)
    });
    if (!response.ok) {
        console.error('Failed download protected binary attempt ' + response.statusText);
        return null;
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
    const blob = new Blob(chunks, {type: response.headers.get('content-type')});
    //const blob = new Blob([await response.arrayBuffer()], {type: response.headers.get('content-type')});

    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = binaryFileName;
    document.body.appendChild(a);
    a.click();

    // Clean up
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
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

