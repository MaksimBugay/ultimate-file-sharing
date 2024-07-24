const dbNamePrefix = "UfsData";
let dbName;
const storeName = "binaryChunks";
const IndexDbDeviceId = "calculatedDeviceFingerPrint";
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
        if (!db.objectStoreNames.contains(storeName)) {
            const objectStore = db.createObjectStore(storeName, {keyPath: "id"});
            objectStore.createIndex("timestamp", "timestamp", {unique: false});
            //console.log(`Store ${storeName} was created`);
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

function addBinaryChunk(chunkId, chunkBlob) {
    const db = getActiveDb();
    if (!db) {
        console.error('No open database for active account');
    }
    const transaction = db.transaction([storeName], "readwrite");
    const store = transaction.objectStore(storeName);
    const timestamp = new Date().getTime();
    const request = store.put({
        id: chunkId,
        chunk: chunkBlob,
        timestamp: timestamp
    });

    request.onsuccess = function () {
        //console.log("Screenshot added to the database successfully with custom ID:", postId);
    };

    request.onerror = function (event) {
        console.error("Error adding binary chunk to the database", event.target.error);
    };
}

function getBinaryChunk(chunkId, chunkConsumer) {
    const db = getActiveDb();
    if (!db) {
        console.error('No open database for active account');
    }
    const transaction = db.transaction([storeName], "readonly");
    const store = transaction.objectStore(storeName);
    const request = store.get(chunkId);

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
            console.error(`No preview image found for the specified post ID ${postId}.`);
        }
    };

    request.onerror = function (event) {
        console.error(`Error retrieving binary chunk from the database for the specified chunk ID ${chunkId}`, event.target.error);
    };
}

function clearAllBinaries() {
    const db = getActiveDb();
    if (!db) {
        console.error('No open database for active device id');
    }
    // Open a read-write transaction on your database
    const transaction = db.transaction([storeName], "readwrite");

    // Get the object store from the transaction
    const store = transaction.objectStore(storeName);

    // Request to clear all the entries in the store
    const request = store.clear();

    request.onsuccess = function () {
        console.log("All entries have been successfully removed from the store.");
    };

    request.onerror = function (event) {
        console.error("Error clearing the store:", event.target.error);
    };
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