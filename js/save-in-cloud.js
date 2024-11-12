SaveInCloudHelper = {}
SaveInCloudHelper.blockSize = MemoryBlock.MB;

async function cacheBinaryManifestInCloud(binaryManifest) {
    await PushcaClient.cacheBinaryChunkInCloud(
        binaryManifest.id,
        1_000_000,
        stringToArrayBuffer(
            arrayBufferToBase64(
                stringToArrayBuffer(JSON.stringify(binaryManifest.toJSON()))
            )
        )
    );
}

SaveInCloudHelper.cacheFileInCloud = async function cacheFileInCloud(file) {
    const binaryId = uuid.v4().toString();
    const createManifestResult = await createBinaryManifest(binaryId, file.name, file.type, null, null);
    if ((WaiterResponseType.ERROR === createManifestResult.type) && createManifestResult.body) {
        showErrorMsg(`Cannot create manifest for file ${file.name}`, null);
        return false;
    }
    const manifest = createManifestResult.body;
    const saveResult = await saveBinaryManifestToDatabase(manifest);
    if (WaiterResponseType.ERROR === saveResult.type) {
        showErrorMsg(saveResult.body.body, null);
        return false;
    }
    const processFileResult = await readFileSequentially(file, async function (inOrder, arrayBuffer) {
        return await processBinaryChunk(manifest, inOrder, arrayBuffer);
    }, `Failed share file attempt: ${file.name}`);

    if (!processFileResult) {
        return false;
    }

    await cacheBinaryManifestInCloud(manifest);
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

async function processBinaryChunk(manifest, inOrder, arrayBuffer) {
    const order = inOrder - 1;
    let result = await chunkToDatagram(order, arrayBuffer);
    if ((WaiterResponseType.SUCCESS === result.type) && result.body) {
        const datagram = result.body;
        manifest.appendDatagram(datagram);
    } else {
        console.log(`Cannot append binary chunk: name ${manifest.name}, order ${order}`);
        return false;
    }
    result = await PushcaClient.cacheBinaryChunkInCloud(manifest.id, order, arrayBuffer);
    if (WaiterResponseType.ERROR === result.type) {
        return false;
    }
    const blob = new Blob([arrayBuffer], {type: manifest.type});
    result = await saveBinaryChunkToDatabase(manifest.id, order, blob);
    return WaiterResponseType.SUCCESS === result.type
}
