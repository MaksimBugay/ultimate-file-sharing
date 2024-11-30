SaveInCloudHelper = {}
SaveInCloudHelper.blockSize = MemoryBlock.MB;

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

SaveInCloudHelper.cacheBlobInCloud = async function (name, type, readMeText, blob, storeInCloud, password = null) {
    return await SaveInCloudHelper.cacheContentInCloud(
        name, type, blob.size, readMeText,
        async function (manifest, storeInCloud, encryptionContract) {
            const chunks = await blobToArrayBuffers(blob, MemoryBlock.MB);
            let pipeWasBroken = false;
            await executeWithShowProgressBar(async function () {
                for (let i = 0; i < chunks.length; i++) {
                    const progress = Math.round(((i + 1) / chunks.length) * 100);
                    mmDownloadProgress.value = progress;
                    mmProgressPercentage.textContent = `${progress}%`;
                    const processChunkResult = await processBinaryChunk(
                        manifest,
                        i + 1,
                        chunks[i],
                        storeInCloud,
                        encryptionContract
                    );
                    if (!processChunkResult) {
                        showErrorMsg(
                            `Failed share file attempt: ${name}`,
                            function () {
                                mmDownloadProgress.value = 0;
                                mmProgressPercentage.textContent = `0%`;
                                afterTransferDoneHandler();
                            }
                        );
                        pipeWasBroken = true;
                        return;
                    }
                }
            });
            chunks.length = 0;
            return !pipeWasBroken;
        },
        storeInCloud,
        password
    );
}

SaveInCloudHelper.cacheFileInCloud = async function (file, readMeText, storeInCloud, password = null) {
    return await SaveInCloudHelper.cacheContentInCloud(
        file.name, file.type, file.size, readMeText,
        async function (manifest, storeInCloud, encryptionContract) {
            return await readFileSequentially(file, async function (inOrder, arrayBuffer) {
                return await processBinaryChunk(manifest, inOrder, arrayBuffer, storeInCloud, encryptionContract);
            }, `Failed share file attempt: ${file.name}`);
        },
        storeInCloud,
        password
    );
}
SaveInCloudHelper.cacheContentInCloud = async function (name, type, size, inReadMeText, splitAndStoreProcessor, storeInCloud, password) {
    let readMeText = inReadMeText;
    if (Fileshare.defaultReadMeText === inReadMeText){
        readMeText = `name = ${name}; size = ${Math.round(size / MemoryBlock.MB)} Mb; content-type = ${type}`;
    }
    const binaryId = uuid.v4().toString();
    const encryptionContract = password ? await generateEncryptionContract() : null;
    const createManifestResult = await createBinaryManifest(
        binaryId,
        name,
        type,
        readMeText,
        password,
        encryptionContract,
        storeInCloud
    );
    if ((WaiterResponseType.ERROR === createManifestResult.type) && createManifestResult.body) {
        showErrorMsg(`Cannot create manifest for file ${name}`, null);
        return false;
    }
    const manifest = createManifestResult.body;
    const saveResult = await saveBinaryManifestToDatabase(manifest);
    if (WaiterResponseType.ERROR === saveResult.type) {
        showErrorMsg(saveResult.body.body, null);
        return false;
    }
    const processFileResult = await splitAndStoreProcessor(manifest, storeInCloud, encryptionContract);

    if (!processFileResult) {
        removeBinary(binaryId, function () {
            console.log(`Binary with id ${binaryId} was completely removed from DB`);
        });
        return false;
    }
    if (storeInCloud) {
        const cacheInCloudResult = await cacheBinaryManifestInCloud(manifest);
        if (WaiterResponseType.ERROR === cacheInCloudResult.type) {
            return false;
        }
    }
    const result = await saveBinaryManifestToDatabase(manifest);
    if (WaiterResponseType.ERROR === result.type) {
        showErrorMsg(result.body.body, function () {
            removeBinary(binaryId, function () {
                console.log(`Binary with id ${binaryId} was completely removed from DB`);
            });
        });
        return false;
    }
    addManifestToManagerGrid(manifest);
    return true;
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
