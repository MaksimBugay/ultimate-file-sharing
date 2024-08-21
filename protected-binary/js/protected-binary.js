const serverUrl = 'https://vasilii.prodpushca.com:30443';
const urlParams = new URLSearchParams(window.location.search);

// Retrieve specific parameters
const protectedUrlSuffix = urlParams.get('suffix');
const binaryFileName = decodeURIComponent(urlParams.get('name'));

const passwordField = document.getElementById('password');
const workspaceField = document.getElementById('workSpaceId');
const downloadBtn = document.getElementById('downloadBtn');
const togglePasswordBtn = document.getElementById('togglePassword');
const progressBar = document.getElementById("downloadProgress");
const progressPercentage = document.getElementById("progressPercentage");
const loginContainer = document.querySelector('.login-container');
progressBarContainer = document.getElementById("progressBarContainer");

workspaceField.focus();

workspaceField.value = "cec7abf69bab9f5aa793bd1c0c101e99";
passwordField.value = "strongPassword";

downloadBtn.addEventListener('click', function () {
    createSignedDownloadRequest(passwordField.value, workspaceField.value, protectedUrlSuffix).then(request => {
        console.log(request);
        downloadProtectedBinary(request).then(() => {
            if (loginContainer) {
                loginContainer.remove();
            }
            delay(1000).then(() => window.close());
        });
    });
});

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
    const contentLength = response.headers.get('content-length');
    const reader = response.body.getReader();

    // Open the file for writing
    const options = {
        suggestedName: binaryFileName
    };
    const fileHandle = await window.showSaveFilePicker(options);
    const writable = await fileHandle.createWritable();
    progressBarContainer.style.visibility = 'visible';

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
    /*const blob = new Blob([await response.arrayBuffer()], { type: response.headers.get('content-type') });

    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = "reproducing.mov";
    document.body.appendChild(a);
    a.click();

    // Clean up
    document.body.removeChild(a);
    URL.revokeObjectURL(url);*/
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

