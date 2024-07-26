const dbNamePrefix = "UfsData";
let dbName;
const binaryChunksStoreName = "binaryChunks";
const binaryManifestsStoreName = "binaryManifests";
const IndexDbDeviceId = "calculatedDeviceFingerPrint11";
const dbRegistry = new Map();

navigator.storage.estimate().then(estimate => {
    if (estimate.quota < MemoryBlock.GB) {
        navigator.storage.requestQuota('persistent', MemoryBlock.GB)
            .then(grantedBytes => {
                console.log('Quota granted:', grantedBytes);
            })
            .catch(error => {
                console.error('Error requesting quota:', error);
            });
    } else {
        console.log(`Index DB quota: ${estimate.quota}`);
    }
});

function openDataBase(onSuccessHandler) {
    dbName = `${dbNamePrefix}_${IndexDbDeviceId}`;
    const request = indexedDB.open(dbName, 1);

    request.onerror = function (event) {
        console.error("Database error: ", event.target.error);
    };

    request.onupgradeneeded = function (event) {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(binaryChunksStoreName)) {
            const objectStore = db.createObjectStore(binaryChunksStoreName, {keyPath: ['binaryId', 'orderN']});
            objectStore.createIndex("timestampIdx", "timestamp", {unique: false});
            objectStore.createIndex("binaryIdIdx", "binaryId", {unique: false});
            //console.log(`Store ${binaryChunksStoreName} was created`);
        }
        if (!db.objectStoreNames.contains(binaryManifestsStoreName)) {
            const objectStore = db.createObjectStore(binaryManifestsStoreName, {keyPath: "binaryId"});
            objectStore.createIndex("fileName", "fileName", {unique: true});
            objectStore.createIndex("timestampIdx", "timestamp", {unique: false});
            //console.log(`Store ${binaryManifestsStoreName} was created`);
        }
    };

    request.onsuccess = function (event) {
        const db = event.target.result;
        dbRegistry.set(IndexDbDeviceId, db);
        console.log(`Database ${dbName} opened successfully`);
        if (typeof onSuccessHandler === 'function') {
            onSuccessHandler();
        }
    };
}

function closeDataBase() {
    try {
        const db = dbRegistry.get(IndexDbDeviceId);
        if (db) {
            db.close();
        }
    } catch (error) {
    }
}

function getActiveDb() {
    if (isEmpty(IndexDbDeviceId)) {
        return null;
    }
    return dbRegistry.get(IndexDbDeviceId);
}

//==============================Binary Manifests queries=============================
function saveBinaryManifest(binaryManifest, onSuccessHandler, onErrorHandler) {
    const db = getActiveDb();
    if (!db) {
        console.error('Binary chunks DB is not open');
    }
    const transaction = db.transaction([binaryManifestsStoreName], "readwrite");
    const store = transaction.objectStore(binaryManifestsStoreName);
    const timestamp = new Date().getTime();
    const totalSize = binaryManifest.getTotalSize();
    const data = {
        binaryId: binaryManifest.id,
        fileName: binaryManifest.name,
        manifest: JSON.stringify(binaryManifest.toJSON()),
        totalSize: totalSize,
        timestamp: timestamp
    };
    const request = store.put(data);

    request.onsuccess = function () {
        console.log(`Manifest for binary with id ${binaryManifest.id} was successfully added to the database`);
        if (typeof onSuccessHandler === 'function') {
            onSuccessHandler();
        }
    };

    request.onerror = function (event) {
        console.error(`Failed attempt of adding Manifest for binary with id ${binaryManifest.id} to the database`, event.target.error);
        if (typeof onErrorHandler === 'function') {
            onErrorHandler(event);
        }
    };
}

function getManifest(binaryId, manifestConsumer, errorConsumer) {
    const db = getActiveDb();
    if (!db) {
        console.error('Binary chunks DB is not open');
        return;
    }
    const transaction = db.transaction([binaryManifestsStoreName], "readonly");
    const store = transaction.objectStore(binaryManifestsStoreName);
    const request = store.get(binaryId);

    request.onsuccess = function (event) {
        const result = event.target.result;
        if (!result) {
            console.warn(`No manifest were found for binary with id ${binaryId}`);
            if (typeof manifestConsumer === 'function') {
                manifestConsumer(null);
            }
            return;
        }
        const manifest = BinaryManifest.fromJSON(result.manifest, result.totalSize);
        if (typeof manifestConsumer === 'function') {
            manifestConsumer(manifest);
        }
    };

    request.onerror = function (event) {
        console.error(`Failed to retrieve manifest for binary with id ${binaryId}`, event.target.error);
        if (typeof errorConsumer === 'function') {
            errorConsumer(event);
        }
    };
}

function getAllManifests(manifestsConsumer) {
    const db = getActiveDb();
    if (!db) {
        console.error('Binary chunks DB is not open');
        return;
    }

    const transaction = db.transaction([binaryManifestsStoreName], "readonly");
    const store = transaction.objectStore(binaryManifestsStoreName);
    const request = store.getAll();

    request.onsuccess = function (event) {
        const results = event.target.result;
        //console.log('All binary manifests retrieved successfully', results);
        const manifests = results.map(record => BinaryManifest.fromJSON(record.manifest, record.totalSize));
        if (manifestsConsumer) {
            manifestsConsumer(manifests);
        }
    };

    request.onerror = function (event) {
        console.error('Failed to retrieve binary manifests', event.target.error);
    };
}

function removeBinaryManifest(binaryId, onSuccessHandler) {
    const db = getActiveDb();
    if (!db) {
        console.error('Binary chunks DB is not open');
        return;
    }

    const transaction = db.transaction([binaryManifestsStoreName], "readwrite");
    const store = transaction.objectStore(binaryManifestsStoreName);
    const request = store.delete(binaryId);

    request.onsuccess = function () {
        console.log(`Manifest for binary with id ${binaryId} was successfully removed from the database`);
        if (typeof onSuccessHandler === 'function') {
            onSuccessHandler();
        }
    };

    request.onerror = function (event) {
        console.error(`Failed to remove Manifest for binary with id ${binaryId}`, event.target.error);
    };
}

function clearAllManifests() {
    const db = getActiveDb();
    if (!db) {
        console.error('Binary chunks DB is not open');
    }
    // Open a read-write transaction on your database
    const transaction = db.transaction([binaryManifestsStoreName], "readwrite");

    // Get the object store from the transaction
    const store = transaction.objectStore(binaryManifestsStoreName);

    // Request to clear all the entries in the store
    const request = store.clear();

    request.onsuccess = function () {
        console.log("All entries have been successfully removed from the Binary manifests store.");
    };

    request.onerror = function (event) {
        console.error("Error clearing the Binary manifests store:", event.target.error);
    };
}

//===================================================================================
//==============================Binary Chunks queries================================
function saveBinaryChunk(binaryId, order, chunkBlob) {
    const db = getActiveDb();
    if (!db) {
        console.error('Binary chunks DB is not open');
    }
    const transaction = db.transaction([binaryChunksStoreName], "readwrite");
    const store = transaction.objectStore(binaryChunksStoreName);
    const timestamp = new Date().getTime();
    const data = {
        binaryId: binaryId,
        orderN: order,
        chunk: chunkBlob,
        timestamp: timestamp
    };
    const request = store.put(data);

    request.onsuccess = function () {
        console.log(`Binary chunk was successfully added to DB: binaryId = ${binaryId}, order = ${order}`);
    };

    request.onerror = function (event) {
        console.error("Error adding binary chunk to the database", event.target.error);
    };
}

function getBinaryChunk(binaryId, order, chunkConsumer) {
    const db = getActiveDb();
    if (!db) {
        console.error('Binary chunks DB is not open');
    }
    const transaction = db.transaction([binaryChunksStoreName], "readonly");
    const store = transaction.objectStore(binaryChunksStoreName);
    const request = store.get([binaryId, order]);

    request.onsuccess = function () {
        if (!request.result) {
            console.error(`Binary chunk record was not found: binaryId = ${binaryId}, order = ${order}`);
            return;
        }
        const chunkBlob = request.result.chunk;
        if (chunkBlob) {
            if (typeof chunkConsumer === 'function') {
                chunkConsumer(chunkBlob);
            }
        } else {
            console.error(`Binary chunk was not found: binaryId = ${binaryId}, order = ${order}`);
        }
    };

    request.onerror = function (event) {
        console.error(`Error during load binary chunk attempt: binaryId = ${binaryId}, order = ${order}`, event.target.error);
    };
}

function removeAllRecordsWithBinaryId(binaryId, onSuccessHandler) {
    const db = getActiveDb();
    if (!db) {
        console.error('Binary chunks DB is not open');
    }
    const transaction = db.transaction([binaryChunksStoreName], "readwrite");
    const store = transaction.objectStore(binaryChunksStoreName);
    const index = store.index("binaryIdIdx");
    const request = index.openCursor(IDBKeyRange.only(binaryId));

    request.onsuccess = function (event) {
        const cursor = event.target.result;
        if (cursor) {
            store.delete(cursor.primaryKey).onsuccess = () => {
                //console.log(`Deleted record with key ${cursor.primaryKey}`);
                cursor.continue();
            };
        } else {
            console.log(`All records with binaryId ${binaryId} have been deleted`);
            if (typeof onSuccessHandler === 'function') {
                onSuccessHandler();
            }
        }
    };

    request.onerror = function (event) {
        console.error(`Error during remove all records with binaryId = ${binaryId} attempt`, event.target.error);
    };
}


function clearAllBinaries() {
    const db = getActiveDb();
    if (!db) {
        console.error('Binary chunks DB is not open');
    }
    // Open a read-write transaction on your database
    const transaction = db.transaction([binaryChunksStoreName], "readwrite");

    // Get the object store from the transaction
    const store = transaction.objectStore(binaryChunksStoreName);

    // Request to clear all the entries in the store
    const request = store.clear();

    request.onsuccess = function () {
        console.log("All entries have been successfully removed from the Binary chunks store.");
    };

    request.onerror = function (event) {
        console.error("Error clearing the Binary chunks store:", event.target.error);
    };
}

//=====================================================================================

function removeBinary(binaryId, onSuccessHandler) {
    removeAllRecordsWithBinaryId(binaryId, function () {
        removeBinaryManifest(binaryId, onSuccessHandler);
    });
}

window.addEventListener('beforeunload', function () {
    try {
        const db = getActiveDb();
        if (db) {
            db.close();
        }
    } catch (error) {
    }
});