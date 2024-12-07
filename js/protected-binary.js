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

async function fetchProtectedBinaryDescription(suffix) {
    const url = serverUrl + `/binary/binary-manifest/protected/${suffix}`;
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
        console.error('Error fetching protected binary description:', error);
        return null;
    }
}

const ownerSignatureLabel = document.getElementById('ownerSignatureLabel');

const serverUrl = 'https://secure.fileshare.ovh';
const urlParams = new URLSearchParams(window.location.search);

// Retrieve specific parameters
let protectedUrlSuffix = decodeURIComponent(urlParams.get('suffix'));
let encryptionContractStr;
let signatureHash;

const suffixParts = protectedUrlSuffix.split('|');
if (suffixParts.length > 1) {
    protectedUrlSuffix = suffixParts[0];
    console.log(`Protected url suffix: ${protectedUrlSuffix}`);
    if (protectedUrlSuffix) {
        fetchProtectedBinaryDescription(protectedUrlSuffix).then(readMeText => {
            const readMeTextMemo = document.getElementById("readMeTextMemo");
            if (readMeTextMemo) {
                readMeTextMemo.textContent = readMeText;
            }
        });
    }
    encryptionContractStr = suffixParts[1];
}
if (suffixParts.length > 2) {
    signatureHash = suffixParts[2];
    generateHasAndConvertToReadableSignature(signatureHash).then((signaturePhrase) => {
        if (signaturePhrase) {
            ownerSignatureLabel.textContent = `Owner signature: ${signaturePhrase}`;
        }
    })
}

const passwordField = document.getElementById('password');
const workspaceField = document.getElementById('workSpaceId');
const downloadBtn = document.getElementById('downloadBtn');
const togglePasswordBtn = document.getElementById('togglePassword');
const openInBrowserCheckbox = document.getElementById("openInBrowserCheckbox");
const reuseCredentialsCheckbox = document.getElementById("reuseCredentialsCheckbox");
const progressBar = document.getElementById("downloadProgress");
const progressPercentage = document.getElementById("progressPercentage");
const loginContainer = document.querySelector('.login-container');
const contentContainer = document.getElementById('contentContainer');
const contentText = document.getElementById('contentText');
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
    pastCredentialsTextarea.style.display = 'none';
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
        if (signatureHash && object['signature'] && (signatureHash !== object['signature'])) {
            loginContainer.remove();
            errorMessage.textContent = "The provided signature does not match the content owner's signature!";
            errorMessage.style.display = 'block';
            return;
        }
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
        if (window.showSaveFilePicker && (!openInBrowserCheckbox.checked)) {
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

async function postDownloadProcessor(result) {
    if (loginContainer) {
        if ('RESPONSE_WITH_ERROR' === result) {
            removeCredentials(signatureHash);
        } else {
            if (reuseCredentialsCheckbox.checked) {
                await saveCredentialsToDb(
                    signatureHash,
                    JSON.stringify({workspaceId: workspaceField.value, password: passwordField.value})
                );
            }
        }
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

async function downloadBinaryStream(response, binaryFileName, contentLength, writable) {
    const reader = response.body.getReader();

    const encryptionContract = await EncryptionContract.fromTransferableString(
        encryptionContractStr,
        passwordField.value,
        stringToByteArray(workspaceField.value)
    );
    const receiveQueue = [];
    let processingNotStarted = true;
    while (true) {
        const {value, done} = await reader.read();

        if (value && (value.byteLength > 0)) {
            receiveQueue.push(value);
        }
        if (processingNotStarted) {
            processChunkQueue(receiveQueue, contentLength, writable, encryptionContract).then(result => {
                if (!result) {
                    alert("Data is unavailable");
                    writable.close();
                }
            });
            processingNotStarted = false;
        }

        if (done) {
            break;
        }
    }
}

async function processChunkQueue(receiveQueue, contentLength, writable, encryptionContract, maxWaitTime = 180000) {
    let dataBlock = null;
    let encChunk;
    let chunk;
    let writtenNumberOfChunks = 0;
    const totalNumberOfChunks = Math.ceil(contentLength / MemoryBlock.MB_ENC);
    console.log(`Content length = ${contentLength}, total number of chunks = ${totalNumberOfChunks}`);

    while ((writtenNumberOfChunks < totalNumberOfChunks) && Math.abs(totalNumberOfChunks - writtenNumberOfChunks) > 0.1) {
        const startTime = Date.now();
        let firstBlock = receiveQueue.shift();
        while (!firstBlock) {
            if (Date.now() - startTime >= maxWaitTime) {
                return false;
            }
            await delay(100);
            firstBlock = receiveQueue.shift();
        }

        dataBlock = (dataBlock && (dataBlock.byteLength > 0)) ? concatArrayBuffers([dataBlock, firstBlock]) : firstBlock;

        while (dataBlock.byteLength >= MemoryBlock.MB_ENC) {
            encChunk = popFirstNBytesFromArrayBuffer(dataBlock, MemoryBlock.MB_ENC);
            dataBlock = removeFirstNBytesFromArrayBuffer(dataBlock, MemoryBlock.MB_ENC);

            chunk = await decryptBinaryChunk(encChunk, encryptionContract);

            writtenNumberOfChunks = writtenNumberOfChunks + 1;
            await writable.write({type: 'write', data: chunk});
            //console.log(`Chunk ${writtenNumberOfChunks} was processed`);

            if (contentLength) {
                const percentComplete = Math.round((writtenNumberOfChunks / totalNumberOfChunks) * 100);
                progressBar.value = percentComplete;
                progressPercentage.textContent = `${percentComplete}%`;
            } else {
                // If content-length is not available, we can't calculate progress
                progressBar.removeAttribute('value');
                progressBar.textContent = 'Downloading...';
            }
        }
    }

    // Close the writable stream
    await writable.close();
    return true;
}

async function downloadProtectedBinary(downloadRequest) {
    const response = await loadBinaryResponse(downloadRequest);
    if (response === null) {
        return 'RESPONSE_WITH_ERROR';
    }
    const contentType = response.headers.get('content-type');
    const contentLength = response.headers.get('content-length');
    const binaryFileName = extractFileName(response.headers.get('Content-Disposition'));

    // Open the file for writing
    const options = {
        suggestedName: binaryFileName
    };
    const fileHandle = await window.showSaveFilePicker(options);
    const writable = await fileHandle.createWritable();

    showDownloadProgress();

    await downloadBinaryStream(response, binaryFileName, contentLength, writable);

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
        if ('text/plain' === contentType) {
            const reader = new FileReader();
            const textDecoder = new TextDecoder("utf-8");

            reader.onload = function () {
                const resultBuffer = reader.result;

                if (resultBuffer instanceof ArrayBuffer) {
                    contentText.textContent = textDecoder.decode(resultBuffer);
                    contentText.style.display = 'block';
                    contentContainer.style.display = 'block';
                } else {
                    console.error("Error: Expected ArrayBuffer, but got something else");
                }
            };

            reader.readAsArrayBuffer(blob);
            return;
        }
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

FingerprintJS.load().then(fp => {
    fp.get().then(result => {
        openDataBase(result.visitorId, function () {
            if (signatureHash) {
                applyCredentialsFromDb(signatureHash);
            }
        });
    });
});

async function applyCredentialsFromDb(signatureHash) {
    await delay(2000);
    const credentials = await getCredentialsFromDb(signatureHash);
    if (credentials) {
        const jsonObj = JSON.parse(credentials);
        workspaceField.value = jsonObj.workspaceId;
        passwordField.value = jsonObj.password;
        //downloadSharedBinary();
    }
}
