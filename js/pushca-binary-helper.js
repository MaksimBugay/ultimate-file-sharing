const BinaryType = Object.freeze({
    FILE: 0,
    MEDIA_STREAM: 1,
    BINARY_MESSAGE: 2,
    FILE_TRANSFER: 3,
    CACHE_BINARY: 4,
    PING: 5,
    CAPTCHA_SET: 6,
    PUZZLE_CAPTCHA_SET: 7
});

const DatagramState = Object.freeze({
    UNKNOWN: 0,
    LOADED: 1,
    CORRUPTED: 2
});

class Datagram {
    constructor(order, size, md5) {
        this.order = order;
        this.size = size;
        this.md5 = md5;
        this.state = DatagramState.UNKNOWN;
    }

    setBytes(bytes) {
        this.bytes = bytes;
        this.state = DatagramState.LOADED;
    }

    setState(datagramState) {
        this.state = datagramState;
    }
}

class BinaryManifest {
    constructor(id, name, mimeType, readMeText, sender, pusherInstanceId, datagrams,
                totalSize, timestamp, password, privateUrlSuffix, downloadCounter,
                base64Key, base64IV, cachedInCloud, forHuman) {
        this.id = id;
        this.name = name;
        this.mimeType = mimeType;
        this.readMeText = readMeText;
        this.sender = sender;
        this.pusherInstanceId = pusherInstanceId;
        this.datagrams = isArrayNotEmpty(datagrams) ? datagrams : [];
        this.totalSize = totalSize;
        this.created = timestamp ? timestamp : new Date().getTime();
        this.password = password;
        this.privateUrlSuffix = privateUrlSuffix;
        this.downloadCounter = downloadCounter ? downloadCounter : 0;
        this.base64Key = base64Key;
        this.base64IV = base64IV;
        this.cachedInCloud = cachedInCloud;
        this.forHuman = forHuman;
    }

    getPrivateUrlShortSuffix() {
        return this.privateUrlSuffix ? this.privateUrlSuffix.split(MessagePartsDelimiter)[0] : null;
    }

    getPrivateUrlLongSuffix() {
        if (!this.privateUrlSuffix) {
            return null;
        }
        const parts = this.privateUrlSuffix.split(MessagePartsDelimiter);
        return (parts.length > 1) ? parts[1] : null;
    }

    getTotalSize() {
        if (this.totalSize) {
            return this.totalSize;
        }
        this.totalSize = calculateTotalSize(this.datagrams);
        return this.totalSize;
    }

    resetTotalSize() {
        this.totalSize = null;
    }

    appendDatagram(datagram) {
        this.resetTotalSize();
        this.datagrams.push(datagram);
        this.totalSize = calculateTotalSize(this.datagrams);
    }

    setSender(sender) {
        this.sender = sender;
    }

    setPusherInstanceId(pusherInstanceId) {
        this.pusherInstanceId = pusherInstanceId;
    }

    getPublicUrl(workSpaceId, exposeWorkspaceId) {
        const serverUrl = PushcaClient.clusterBaseUrl;
        let downloadUrl;
        if (this.password) {
            const workspaceIdSuffix = exposeWorkspaceId ? `?workspace=${workSpaceId}` : '';
            downloadUrl = `${serverUrl}/binary/${this.getPrivateUrlShortSuffix()}${workspaceIdSuffix}`;
        } else {
            //downloadUrl = `${serverUrl}/binary/${workSpaceId}/${this.id}`;
            downloadUrl = `${serverUrl}/public-binary.html?w=${workSpaceId}&id=${this.id}`;
            if (this.forHuman){
                downloadUrl = `${downloadUrl}&human-only=true`;
            }
        }
        return downloadUrl;
    }

    async setChunkBytes(order, bytes) {
        const datagram = this.datagrams[order];
        return CallableFuture.callAsynchronously(2000, null, function (waiterId) {
            calculateSha256(bytes).then(md5 => {
                if (datagram.md5 === md5) {
                    datagram.setBytes(bytes);
                    CallableFuture.releaseWaiterIfExistsWithSuccess(waiterId, true);
                } else {
                    console.warn(`Corrupted chunk was received: binary id = ${this.id}, order = ${order}`);
                    datagram.setState(DatagramState.CORRUPTED);
                    CallableFuture.releaseWaiterIfExistsWithError(waiterId, false);
                }
            });
        });
    }

    isCompleted() {
        return this.datagrams.every(datagram => datagram.state === DatagramState.LOADED);
    }

    isFinalized() {
        return this.datagrams.every(datagram => datagram.state !== DatagramState.UNKNOWN);
    }

    isExpired() {
        return ((new Date().getTime()) - this.created) > 30 * 60 * 1000;
    }

    toJSON() {
        return {
            id: this.id,
            name: this.name,
            mimeType: this.mimeType,
            readMeText: this.readMeText,
            sender: this.sender,
            pusherInstanceId: this.pusherInstanceId,
            datagrams: this.datagrams
        };
    }

    toDbJSON() {
        return {
            id: this.id,
            name: this.name,
            mimeType: this.mimeType,
            readMeText: this.readMeText,
            sender: this.sender,
            pusherInstanceId: this.pusherInstanceId,
            datagrams: this.datagrams,
            password: this.password,
            privateUrlSuffix: this.privateUrlSuffix,
            base64Key: this.base64Key,
            base64IV: this.base64IV,
            cachedInCloud: this.cachedInCloud,
            forHuman: this.forHuman
        };
    }

    static fromObject(jsonObject, totalSize, timestamp, downloadCounter) {
        const sender = new ClientFilter(
            jsonObject.sender.workSpaceId,
            jsonObject.sender.accountId,
            jsonObject.sender.deviceId,
            jsonObject.sender.applicationId
        );
        let datagrams = [];
        if (isArrayNotEmpty(jsonObject.datagrams)) {
            datagrams = jsonObject.datagrams.map(obj => new Datagram(
                    obj.order,
                    obj.size,
                    obj.md5
                )
            );
        }
        return new BinaryManifest(
            jsonObject.id,
            jsonObject.name,
            jsonObject.mimeType,
            jsonObject.readMeText,
            sender,
            jsonObject.pusherInstanceId,
            datagrams,
            totalSize,
            timestamp,
            jsonObject.password,
            jsonObject.privateUrlSuffix,
            downloadCounter,
            jsonObject.base64Key,
            jsonObject.base64IV,
            jsonObject.cachedInCloud,
            jsonObject.forHuman
        );
    }

    static fromJSON(jsonString, totalSize, timestamp, downloadCounter) {
        const jsonObject = typeof jsonString === 'string' ? JSON.parse(jsonString) : jsonString;
        return this.fromObject(jsonObject, totalSize, timestamp, downloadCounter);
    }
}

class BinaryWithHeader {
    constructor(sourceBuffer) {
        this.binaryType = bytesToShortInt(copyBytes(sourceBuffer, 0, 1));
        this.destClientHash = bytesToInt(copyBytes(sourceBuffer, 1, 5));
        this.withAcknowledge = bytesToBoolean(copyBytes(sourceBuffer, 5, 6));
        this.binaryId = bytesToUuid(copyBytes(sourceBuffer, 6, 22));
        this.order = bytesToInt(copyBytes(sourceBuffer, 22, 26));
        this.payload = copyBytes(sourceBuffer, 26, sourceBuffer.byteLength);
    }

    getId() {
        return buildSharedFileChunkId(this.binaryId, this.order, this.destClientHash);
    }
}

const BinaryWaitingHall = new Map();

function buildSharedFileChunkId(binaryId, order, destHashCode) {
    return `${binaryId}-${order}-${destHashCode}`;
}

async function manifestToJsonObjectWithProtectedAttributes(manifest) {
    let encryptionContractStr = null;
    if (manifest.base64Key) {
        const ec = new EncryptionContract(manifest.base64Key, manifest.base64IV);
        const salt = stringToByteArray(Fileshare.workSpaceId);
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
        deviceSecret: Fileshare.deviceSecret,
        forHuman: manifest.forHuman
    };
}

async function getPrivateUrlSuffix(binaryIdHash) {
    let encryptionContractStr = null;
    const getManifestResult = await CallableFuture.callAsynchronously(2000, null, function (waiterId) {
        getManifestByRecordId(
            binaryIdHash,
            function (manifest) {
                CallableFuture.releaseWaiterIfExistsWithSuccess(waiterId, manifest);
            }, function (event) {
                CallableFuture.releaseWaiterIfExistsWithError(waiterId, event.target.error);
            }
        );
    });
    if ((WaiterResponseType.SUCCESS === getManifestResult.type) && getManifestResult.body) {
        const manifest = getManifestResult.body;
        if (manifest.base64Key) {
            const transferableManifest = await manifestToJsonObjectWithProtectedAttributes(manifest);
            encryptionContractStr = transferableManifest.encryptionContract;
        }
        return {
            privateUrlSuffix: manifest.getPrivateUrlLongSuffix(),
            encryptionContract: encryptionContractStr
        }
    } else {
        return null;
    }
}

async function addBinaryToStorage(binaryId, originalFileName, mimeType, arrayBuffer, sliceNumber, binaryManifest) {
    let result;
    if (!binaryManifest) {
        console.log(`Binary manifest was not provided: ${originalFileName}`);
        return null;
    }
    if (sliceNumber === 0) {
        result = await CallableFuture.callAsynchronously(2000, null, function (waiterId) {
            saveBinaryManifest(
                binaryManifest,
                function () {
                    CallableFuture.releaseWaiterIfExistsWithSuccess(waiterId, true);
                },
                function (event) {
                    showErrorMsg(event.target.error.message, null);
                    CallableFuture.releaseWaiterIfExistsWithError(waiterId, false);
                }
            );
        });
        if (WaiterResponseType.ERROR === result.type) {
            return null;
        }
    }
    const chunks = splitArrayBuffer(arrayBuffer, MemoryBlock.MB);
    for (let n = 0; n < chunks.length; n++) {
        const order = sliceNumber * 100 + n;
        const result = await addChunkToBinaryManifest(binaryManifest, order, chunks[n]);
        if ((WaiterResponseType.SUCCESS === result.type) && result.body) {
            binaryManifest = result.body;
        } else {
            console.log(`Cannot append binary chunk: name ${originalFileName}, order ${order}`);
            return null;
        }
        const blob = new Blob([chunks[n]], {type: mimeType});
        saveBinaryChunk(binaryId, order, blob);
        await PushcaClient.cacheBinaryChunkInCloud(binaryId, order, chunks[n]);
    }

    result = await CallableFuture.callAsynchronously(2000, null, function (waiterId) {
        saveBinaryManifest(
            binaryManifest,
            function () {
                CallableFuture.releaseWaiterIfExistsWithSuccess(waiterId, true);
            },
            function (event) {
                showErrorMsg(`Failed attempt to store manifest of binary with name ${binaryManifest.name}: ${event.target.error.message}`, null);
                removeAllRecordsWithBinaryId(binaryManifest.id);
                CallableFuture.releaseWaiterIfExistsWithError(waiterId, false);
            }
        );
    });
    if (WaiterResponseType.ERROR === result.type) {
        console.log(`Failed Save manifest attempt during binary upload: file name = ${originalFileName}`);
        return null;
    }
    return binaryManifest;
}

async function createBinaryManifest(id, name, mimeType, readMeText, password, encryptionContract, cachedInCloud, forHuman,
                                    inWorkSpaceId
) {
    if (!PushcaClient.ClientObj) {
        return new WaiterResponse(WaiterResponseType.ERROR, "Owner connection is absent");
    }
    const sender = new ClientFilter(
        PushcaClient.ClientObj.workSpaceId,
        PushcaClient.ClientObj.accountId,
        PushcaClient.ClientObj.deviceId,
        PushcaClient.ClientObj.applicationId
    );
    if (!password) {
        const binaryManifest = new BinaryManifest(
            id,
            name,
            mimeType,
            readMeText,
            sender,
            PushcaClient.pusherInstanceId,
            [],
            null,
            null,
            password,
            null,
            null,
            null,
            null,
            cachedInCloud,
            forHuman
        );
        return new WaiterResponse(WaiterResponseType.SUCCESS, binaryManifest);
    }

    const workSpaceId = inWorkSpaceId ? inWorkSpaceId : Fileshare.workSpaceId;
    return await CallableFuture.callAsynchronously(2000, null, function (waiteId) {
        createPrivateUrlSuffix(workSpaceId, id).then(privateUrlSuffix => {
            const binaryManifest = new BinaryManifest(
                id,
                name,
                mimeType,
                readMeText,
                sender,
                PushcaClient.pusherInstanceId,
                [],
                null,
                null,
                password,
                privateUrlSuffix,
                null,
                encryptionContract ? encryptionContract.base64Key : null,
                encryptionContract ? encryptionContract.base64IV : null,
                cachedInCloud,
                forHuman
            );
            CallableFuture.releaseWaiterIfExistsWithSuccess(waiteId, binaryManifest);
        });
    });
}


async function addChunkToBinaryManifest(binaryManifest, order, arrayBuffer) {

    return await CallableFuture.callAsynchronously(2000, null, function (waiterId) {
        chunk2Datagram(order, arrayBuffer, function (datagram) {
            if (datagram) {
                binaryManifest.appendDatagram(datagram);
                CallableFuture.releaseWaiterIfExistsWithSuccess(waiterId, binaryManifest);
            } else {
                CallableFuture.releaseWaiterIfExistsWithError(waiterId, "Cannot convert bytes to datagram");
            }
        });
    });
}

async function chunkToDatagram(order, arrayBuffer) {

    return await CallableFuture.callAsynchronously(2000, null, function (waiterId) {
        chunk2Datagram(order, arrayBuffer, function (datagram) {
            if (datagram) {
                CallableFuture.releaseWaiterIfExistsWithSuccess(waiterId, datagram);
            } else {
                CallableFuture.releaseWaiterIfExistsWithError(waiterId, "Cannot convert bytes to datagram");
            }
        });
    });
}

function chunk2Datagram(order, arrayBuffer, consumer) {
    if ((!arrayBuffer) || (arrayBuffer.byteLength === 0)) {
        if (typeof consumer === 'function') {
            consumer(null);
        }
        return;
    }

    calculateSha256(arrayBuffer).then(md5 => {
        if (typeof consumer === 'function') {
            consumer(
                new Datagram(order, arrayBuffer.byteLength, md5)
            );
        }
    });
}

function calculateClientHashCode(workSpaceId, accountId, deviceId, applicationId) {
    const formattedString = formatString("{0}@@{1}@@{2}@@{3}", workSpaceId, accountId, deviceId, applicationId);
    return calculateStringHashCode(formattedString);
}

function buildPushcaBinaryHeader(binaryType, destHashCode, withAcknowledge, binaryId, order) {
    return concatenateByteArrays(
        shortIntToBytes(binaryType),
        intToBytes(destHashCode),
        booleanToBytes(withAcknowledge),
        uuidToBytes(binaryId),
        intToBytes(order)
    );
}

function extractOrderFromBinaryWithHeader(sourceBuffer) {
    const orderBytes = copyBytes(sourceBuffer, 22, 26);
    return bytesToInt(orderBytes);
}

function calculateTotalSize(datagrams) {
    if (!isArrayNotEmpty(datagrams)) {
        return 0;
    }
    return datagrams.reduce((sum, datagram) => sum + datagram.size, 0);
}

async function saveBinaryManifestToDatabase(manifest) {
    return await CallableFuture.callAsynchronously(2000, null, function (waiterId) {
        saveBinaryManifest(
            manifest,
            function () {
                CallableFuture.releaseWaiterIfExistsWithSuccess(waiterId, true);
            },
            function (event) {
                const errorMessage = event.target.error ? event.target.error.message : 'Unknown error';
                CallableFuture.releaseWaiterIfExistsWithError(waiterId, errorMessage);
            }
        );
    });
}

async function saveBinaryChunkToDatabase(binaryId, order, chunkBlob) {
    return await CallableFuture.callAsynchronously(2000, null, function (waiterId) {
        saveBinaryChunk(
            binaryId,
            order,
            chunkBlob,
            function () {
                CallableFuture.releaseWaiterIfExistsWithSuccess(waiterId, true);
            },
            function (event) {
                const errorMessage = event.target.error ? event.target.error.message : 'Unknown error';
                CallableFuture.releaseWaiterIfExistsWithError(waiterId, errorMessage);
            }
        );
    });
}

async function processUploadBinaryAppeal(uploadBinaryAppeal) {
    const dest = new ClientFilter(
        uploadBinaryAppeal.sender.workSpaceId,
        uploadBinaryAppeal.sender.accountId,
        uploadBinaryAppeal.sender.deviceId,
        uploadBinaryAppeal.sender.applicationId
    );
    sendBinary(
        uploadBinaryAppeal.binaryId,
        uploadBinaryAppeal.manifestOnly,
        uploadBinaryAppeal.requestedChunks,
        dest);
}

async function sendBinary(binaryId, manifestOnly, requestedChunks, dest) {
    const destHashCode = calculateClientHashCode(
        dest.workSpaceId,
        dest.accountId,
        dest.deviceId,
        dest.applicationId
    );
    if (isArrayNotEmpty(requestedChunks)) {
        for (let i = 0; i < requestedChunks.length; i++) {
            await retrieveAndSendBinaryChunk(binaryId, requestedChunks[i], destHashCode, false);
        }
        return;
    }
    let manifest;
    let result = await CallableFuture.callAsynchronously(2000, null, function (waiterId) {
        getManifest(
            binaryId,
            function (manifest) {
                CallableFuture.releaseWaiterIfExistsWithSuccess(waiterId, manifest);
            }, function (event) {
                CallableFuture.releaseWaiterIfExistsWithError(waiterId, event.target.error);
            }
        );
    });
    if ((WaiterResponseType.SUCCESS === result.type) && result.body) {
        manifest = result.body;
    }
    if (!manifest) {
        console.warn(`Unknown binary with id ${binaryId}`)
        return;
    }
    manifest.setPusherInstanceId(PushcaClient.pusherInstanceId);
    manifest.setSender(PushcaClient.ClientObj);
    if (manifestOnly) {
        await PushcaClient.sendBinaryManifest(dest, manifest);
        incrementDownloadCounterOfManifestRecord(manifest.id);
        return;
    }
    for (let order = 0; order < manifest.datagrams.length; order++) {
        await retrieveAndSendBinaryChunk(binaryId, order, destHashCode, true);
    }
    console.log(`Successfully send binary with id ${binaryId}`);
}

async function retrieveAndSendBinaryChunk(binaryId, order, destHashCode, withAcknowledge) {
    const result = await CallableFuture.callAsynchronously(2000, null, function (waiterId) {
        getBinaryChunk(binaryId, order, function (arrayBuffer) {
            CallableFuture.releaseWaiterIfExistsWithSuccess(waiterId, arrayBuffer);
        });
    });
    if ((WaiterResponseType.ERROR === result.type) || (!result.body)) {
        console.warn(`Chunk ${order} of binary with id ${binaryId} not found`);
        return;
    }
    const chunk = await result.body.arrayBuffer();

    return await PushcaClient.sendBinaryChunk(
        binaryId,
        order,
        destHashCode,
        withAcknowledge,
        chunk
    );
}

function buildDownloadWaiterId(waiterId) {
    return `wd_${waiterId}`;
}

function buildSingleChunkDownloadWaiterId(waiterId) {
    return `wds_${waiterId}`;
}

function downloadBinary(chunks, fileName, mimeType) {
    const binaryBlob = new Blob(chunks, {type: mimeType});
    downloadFile(binaryBlob, fileName);
}

async function loadAllBinaryChunks(binaryId, totalNumberOfChunks, chunksConsumer) {
    const chunks = [];

    let order = 0;

    while (order < totalNumberOfChunks) {
        const result = await loadBinaryChunk(binaryId, order);
        if ((WaiterResponseType.SUCCESS === result.type) && result.body) {
            chunks.push(result.body);
        } else {
            console.error(`Binary data is corrupted or cannot be loaded: binaryId = ${binaryId}, order = ${order}`);
            return;
        }
        order += 1;
    }

    if (typeof chunksConsumer === 'function') {
        chunksConsumer(chunks);
    }
}

async function loadBinaryChunk(binaryId, order) {
    return await CallableFuture.callAsynchronously(3000, null, function (waiterId) {
        getBinaryChunk(binaryId, order, function (chunkBlob) {
            CallableFuture.releaseWaiterIfExistsWithSuccess(waiterId, chunkBlob);
        });
    });
}
