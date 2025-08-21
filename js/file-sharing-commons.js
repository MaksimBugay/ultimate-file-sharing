
FileSharingHelper = {}
FileSharingHelper.blockSize = MemoryBlock.MB;

//=======================================Prepare read-me text===========================================================
async function getReadMeText() {
    //return DOMPurify.sanitize(readMeTextMemo.innerHTML);
    const readMeText = DOMPurify.sanitize(readMeTextMemo.innerHTML);
    //const readMeText = readMeTextMemo.innerHTML;
    if (readMeTextMemo.innerHTML === readMeTextMemo.innerText) {
        return readMeText;
    } else {
        return await saveInnerHTMLAsBase64(readMeTextMemo.innerHTML);
    }
}

async function saveInnerHTMLAsBase64(innerHTML) {
    if (!innerHTML) {
        return null;
    }

    const blob = new Blob([innerHTML], {type: 'text/html;charset=utf-8'});
    const url = URL.createObjectURL(blob);

    try {
        const response = await fetch(url); // Wait for the response
        const arrayBuffer = await response.arrayBuffer();
        // Convert ArrayBuffer to Base64
        return arrayBufferToBase64(arrayBuffer);
    } catch (error) {
        console.error('Error converting HTML to base64:', error);
        return null;
    } finally {
        URL.revokeObjectURL(url);
    }
}

//======================================================================================================================

async function readFileSequentially(file, chunkHandler, errorMsg) {
    return await readFileSequentiallyBase(
        file, chunkHandler, errorMsg, FileSharing
    );
}

async function processBinaryChunk(manifest, inOrder, inArrayBuffer, storeInCloud, encryptionContract) {
    const arrayBuffer = encryptionContract ? await encryptBinaryChunk(inArrayBuffer, encryptionContract) : inArrayBuffer
    const order = inOrder - 1;
    let result = await chunkToDatagram(order, arrayBuffer);
    if ((WaiterResponseType.SUCCESS === result.type) && result.body) {
        const datagram = result.body;
        manifest.appendDatagram(datagram);
    } else {
        console.log(`Cannot append binary chunk: name ${manifest.name}, order ${order}`);
        return false;
    }
    if (storeInCloud) {
        result = await PushcaClient.cacheBinaryChunkInCloud(manifest.id, order, arrayBuffer);
        if (WaiterResponseType.ERROR === result.type) {
            return false;
        }
    } else {
        const blob = new Blob([arrayBuffer], {type: manifest.type});
        result = await saveBinaryChunkToDatabase(manifest.id, order, blob);
        if (WaiterResponseType.ERROR === result.type) {
            return false;
        }
    }
    return true;
}

async function cacheBinaryManifestInCloud(binaryManifest) {
    const manifestObject = await manifestToJsonObjectWithProtectedAttributes(binaryManifest);
    return await PushcaClient.cacheBinaryChunkInCloud(
        binaryManifest.id,
        1_000_000,
        stringToArrayBuffer(
            arrayBufferToBase64(
                stringToArrayBuffer(JSON.stringify(manifestObject))
            )
        )
    );
}

async function manifestToJsonObjectWithProtectedAttributes(manifest) {
    let encryptionContractStr = null;
    if (manifest.base64Key) {
        const ec = new EncryptionContract(manifest.base64Key, manifest.base64IV);
        const salt = stringToByteArray(FileSharing.deviceFpId);
        encryptionContractStr = await ec.toTransferableString(manifest.password, salt);
    }
    const passwordHash = manifest.password ? await calculateSha256(stringToArrayBuffer(manifest.password)) : null;
    //console.log(`Password hash = ${passwordHash}`);
    return {
        id: manifest.id,
        name: manifest.name,
        mimeType: manifest.mimeType,
        readMeText: manifest.readMeText,
        sender: manifest.sender,
        pusherInstanceId: manifest.pusherInstanceId,
        datagrams: manifest.datagrams,
        privateUrlSuffix: manifest.privateUrlSuffix,
        encryptionContract: encryptionContractStr,
        passwordHash: passwordHash,
        deviceSecret: FileSharing.deviceSecret,
        forHuman: manifest.forHuman
    };
}
function afterTransferDoneHandler() {
    progressBarContainer.style.display = 'none';
}

async function readFileSequentiallyBase(file, chunkHandler, errorMsg, propertiesHolder) {
    const progressBarWidget = propertiesHolder.progressBarWidget;
    const fileSize = file.size;
    let offset = 0;
    let sliceNumber = 0;
    let pipeWasBroken = false;

    async function readNextChunk() {
        const reader = new FileReader();

        reader.onload = async function (e) {
            const arrayBuffer = e.target.result;

            offset += FileSharingHelper.blockSize;
            sliceNumber++;

            let chunkHandlerResult = true;
            if (typeof chunkHandler === 'function') {
                chunkHandlerResult = await chunkHandler(sliceNumber, arrayBuffer);
            }

            if (chunkHandlerResult) {
                if (offset < fileSize) {
                    await readNextChunk();
                } else {
                    console.log('File read completed.');
                }
            } else {
                pipeWasBroken = true;
                console.log('Failed file chunk transfer attempt.');
                showErrorMsg(
                    errorMsg,
                    function () {
                        progressBarWidget.reset();
                        afterTransferDoneHandler();
                    }
                );
            }
        };

        reader.onerror = function (e) {
            console.error("Error reading file:", e);
        };

        const blob = file.slice(offset, offset + FileSharingHelper.blockSize);
        reader.readAsArrayBuffer(blob);
    }

    await executeWithShowProgressBar(async function (progressBarWidget) {
        readNextChunk();

        const totalNumberOfSlices = Math.ceil(fileSize / FileSharingHelper.blockSize)
        while ((!pipeWasBroken) && (sliceNumber < totalNumberOfSlices)) {
            const progress = Math.round((sliceNumber / totalNumberOfSlices) * 100);
            progressBarWidget.setProgress(progress);
            if (typeof propertiesHolder.extraProgressHandler === 'function') {
                propertiesHolder.extraProgressHandler();
            }
            await delay(100);
        }
    }, propertiesHolder);

    return !pipeWasBroken;
}

async function executeWithShowProgressBar(operation, propertiesHolder) {
    await requestWakeLock(propertiesHolder);
    const progressBarWidget = propertiesHolder.progressBarWidget
    progressBarWidget.pbContainer.style.display = 'block';
    if (typeof operation === 'function') {
        await operation(progressBarWidget);
    }
    progressBarWidget.pbProgress.value = 0;
    progressBarWidget.pbProgressPercentage.textContent = `0%`;
    progressBarWidget.pbContainer.style.display = 'none';
    releaseWakeLock(propertiesHolder);
}
