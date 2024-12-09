
const receiveQueue = [];

/*pastCredentialsTextarea.addEventListener('blur', function () {
    //pastCredentialsTextarea.style.visibility = 'hidden';
});*/

setPastCredentialsHandler(downloadSharedBinary);

setPressEnterKeyHandler(downloadSharedBinary);

setDownloadBtnHandler(downloadSharedBinary);

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
    let contentLength = response.headers.get("X-Total-Size");
    if (!contentLength) {
        contentLength = response.headers.get('content-length');
    }
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

async function downloadProtectedBinarySilently(downloadRequest) {
    //showSpinnerInButton();
    showDownloadProgress();
    const response = await loadBinaryResponse(downloadRequest);
    if (response === null) {
        return 'RESPONSE_WITH_ERROR';
    }
    const contentType = response.headers.get('content-type');
    let contentLength = response.headers.get("X-Total-Size");
    if (!contentLength) {
        contentLength = response.headers.get('content-length');
    }
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

