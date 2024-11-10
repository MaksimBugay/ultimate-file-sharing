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
        alert(`Cannot create manifest for file ${file.name}`);
        return;
    }
    const manifest = createManifestResult.body;
    await readFileSequentially(file, async function (inOrder, arrayBuffer) {
        const order = inOrder - 1;
        let result = await chunkToDatagram(order, arrayBuffer);
        if ((WaiterResponseType.SUCCESS === result.type) && result.body) {
            const datagram = result.body;
            manifest.appendDatagram(datagram);
        } else {
            console.log(`Cannot append binary chunk: name ${manifest.name}, order ${order}`);
            return false;
        }
        const blob = new Blob([arrayBuffer], {type: manifest.type});
        saveBinaryChunk(manifest.id, order, blob);
        result = await PushcaClient.cacheBinaryChunkInCloud(manifest.id, order, arrayBuffer);
        return WaiterResponseType.SUCCESS === result.type
    }, `Failed share file attempt: ${file.name}`);

    await cacheBinaryManifestInCloud(manifest);
    const result = saveBinaryManifestToDatabase(manifest);
    if (WaiterResponseType.ERROR === result.type) {
        showErrorMsg(result.body, function () {
            removeBinary(binaryId, function () {
                console.log(`Binary with id ${binaryId} was completely removed from DB`);
            });
        });
        return;
    }
    addManifestToManagerGrid(manifest);
}


