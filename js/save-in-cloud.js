SaveInCloudHelper = {}
SaveInCloudHelper.blockSize = MemoryBlock.MB;

async function cacheBinaryManifestInCloud(binaryManifest) {
    return await PushcaClient.cacheBinaryChunkInCloud(
        binaryManifest.id,
        1_000_000,
        stringToArrayBuffer(
            arrayBufferToBase64(
                stringToArrayBuffer(JSON.stringify(binaryManifest.toJSON()))
            )
        )
    );
}

SaveInCloudHelper.cacheBlobInCloud = async function (name, type, blob, storeInCloud) {
    return await SaveInCloudHelper.cacheContentInCloud(
        name, type, blob.size,
        async function (manifest, storeInCloud) {
            const chunks = await blobToArrayBuffers(blob, MemoryBlock.MB);
            let pipeWasBroken = false;
            await executeWithShowProgressBar(async function () {
                for (let i = 0; i < chunks.length; i++) {
                    const progress = Math.round(((i + 1) / chunks.length) * 100);
                    mmDownloadProgress.value = progress;
                    mmProgressPercentage.textContent = `${progress}%`;
                    const processChunkResult = await processBinaryChunk(manifest, i + 1, chunks[i], storeInCloud);
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
            return !pipeWasBroken;
        },
        storeInCloud
    );
}

SaveInCloudHelper.cacheFileInCloud = async function (file, storeInCloud) {
    return await SaveInCloudHelper.cacheContentInCloud(
        file.name, file.type, file.size,
        async function (manifest, storeInCloud) {
            return await readFileSequentially(file, async function (inOrder, arrayBuffer) {
                return await processBinaryChunk(manifest, inOrder, arrayBuffer, storeInCloud);
            }, `Failed share file attempt: ${file.name}`);
        },
        storeInCloud
    );
}
SaveInCloudHelper.cacheContentInCloud = async function (name, type, size, splitAndStoreProcessor, storeInCloud) {
    const binaryId = uuid.v4().toString();
    const createManifestResult = await createBinaryManifest(binaryId, name, type, null, null, storeInCloud);
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
    const processFileResult = await splitAndStoreProcessor(manifest, storeInCloud);

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

async function processBinaryChunk(manifest, inOrder, arrayBuffer, storeInCloud) {
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
    }
    const blob = new Blob([arrayBuffer], {type: manifest.type});
    result = await saveBinaryChunkToDatabase(manifest.id, order, blob);
    return WaiterResponseType.SUCCESS === result.type
}