const dbNamePrefix = "UfsData";
let dbName;
const binaryChunksStoreName = "binaryChunks";
const binaryManifestsStoreName = "binaryManifests";
const IndexDbDeviceId = "calculatedDeviceFingerPrint1";
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
            const objectStore = db.createObjectStore(binaryChunksStoreName, {keyPath: ["binaryId", "orderN"]});
            objectStore.createIndex("timestampIdx", "timestamp", {unique: false});
            objectStore.createIndex("binaryIdIdx", "binaryId", {unique: false});
            //console.log(`Store ${binaryChunksStoreName} was created`);
        }
        if (!db.objectStoreNames.contains(binaryManifestsStoreName)) {
            const objectStore = db.createObjectStore(binaryManifestsStoreName, {keyPath: "binaryId"});
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
function addBinaryManifest(binaryManifest) {
    const db = getActiveDb();
    if (!db) {
        console.error('Binary chunks DB is not open');
    }
    const transaction = db.transaction([binaryManifestsStoreName], "readwrite");
    const store = transaction.objectStore(binaryManifestsStoreName);
    const timestamp = new Date().getTime();
    const data = {
        binaryId: binaryManifest.id,
        manifest: JSON.stringify(binaryManifest),
        totalSize: calculateTotalSize(binaryManifest.datagrams),
        timestamp: timestamp
    };
    const request = store.put(data);

    request.onsuccess = function () {
        console.log(`Manifest for binary with id ${binaryManifest.id} was successfully added to the database`);
    };

    request.onerror = function (event) {
        console.error("Failed attempt of adding Manifest for binary with id ${binaryId} to the database", event.target.error);
    };
}

//===================================================================================
//==============================Binary Chunks queries================================
function addBinaryChunk(binaryId, order, chunkBlob) {
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
        //console.log("Screenshot added to the database successfully with custom ID:", postId);
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

function removeAllRecordsWithBinaryId(binaryId, callback) {
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
            if (callback) {
                callback();
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
        console.log("All entries have been successfully removed from the store.");
    };

    request.onerror = function (event) {
        console.error("Error clearing the store:", event.target.error);
    };
}

//=====================================================================================
window.addEventListener('beforeunload', function () {
    try {
        const db = getActiveDb();
        if (db) {
            db.close();
        }
    } catch (error) {
    }
});