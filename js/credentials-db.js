const dbNamePrefix = "UfsCredentials";
let dbName;
const credentialsStoreName = "binaryCredentials";
let IndexDbDeviceId;
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

function openDataBase(deviceFpId, onSuccessHandler) {
    IndexDbDeviceId = deviceFpId;

    dbName = `${dbNamePrefix}_${IndexDbDeviceId}`;
    const request = indexedDB.open(dbName, 1);

    request.onerror = function (event) {
        console.error("Database error: ", event.target.error);
    };

    request.onupgradeneeded = function (event) {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(credentialsStoreName)) {
            const objectStore = db.createObjectStore(credentialsStoreName, {keyPath: "signatureHash"});
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

//==============================Binary Passwords queries=============================
function saveCredentials(signatureHash, credentials, onSuccessHandler, onErrorHandler) {
    const db = getActiveDb();
    if (!db) {
        console.error('Binary passwords DB is not open');
    }
    const transaction = db.transaction([credentialsStoreName], "readwrite");
    const store = transaction.objectStore(credentialsStoreName);
    const timestamp = new Date().getTime();
    const data = {
        signatureHash: signatureHash,
        credentials: credentials,
        timestamp: timestamp
    };
    const request = store.put(data);

    request.onsuccess = function () {
        console.log(`Credentials for owner with signature hash ${signatureHash} were successfully added to the database`);
        if (typeof onSuccessHandler === 'function') {
            onSuccessHandler();
        }
    };

    request.onerror = function (event) {
        console.error(`Failed attempt of adding Credentials for owner with signature hash ${signatureHash} to the database`, event.target.error);
        if (typeof onErrorHandler === 'function') {
            onErrorHandler(event);
        }
    };
}

function getCredentials(signatureHash, credentialsConsumer, errorConsumer) {
    const db = getActiveDb();
    if (!db) {
        console.error('Binary passwords DB is not open');
        return;
    }
    const transaction = db.transaction([credentialsStoreName], "readonly");
    const store = transaction.objectStore(credentialsStoreName);
    const request = store.get(signatureHash);

    request.onsuccess = function (event) {
        const result = event.target.result;
        if (!result) {
            console.warn(`No credentials were found for owner with signature hash ${signatureHash}`);
            if (typeof credentialsConsumer === 'function') {
                credentialsConsumer(null);
            }
            return;
        }
        if (typeof credentialsConsumer === 'function') {
            credentialsConsumer(result.credentials);
        }
    };

    request.onerror = function (event) {
        console.error(`Failed to retrieve credentials for owner with signature hash ${signatureHash}`, event.target.error);
        if (typeof errorConsumer === 'function') {
            errorConsumer(event);
        }
    };
}

function removeCredentials(signatureHash, onSuccessHandler) {
    const db = getActiveDb();
    if (!db) {
        console.error('Binary passwords DB is not open');
        return;
    }

    const transaction = db.transaction([credentialsStoreName], "readwrite");
    const store = transaction.objectStore(credentialsStoreName);
    const request = store.delete(signatureHash);

    request.onsuccess = function () {
        console.log(`Credentials for owner with signature hash ${signatureHash} was successfully removed from the database`);
        if (typeof onSuccessHandler === 'function') {
            onSuccessHandler();
        }
    };

    request.onerror = function (event) {
        console.error(`Failed to remove Credentials for owner with signature hash ${signatureHash}`, event.target.error);
    };
}

function clearAllCredentials() {
    const db = getActiveDb();
    if (!db) {
        console.error('Binary passwords DB is not open');
    }
    // Open a read-write transaction on your database
    const transaction = db.transaction([credentialsStoreName], "readwrite");

    // Get the object store from the transaction
    const store = transaction.objectStore(credentialsStoreName);

    // Request to clear all the entries in the store
    const request = store.clear();

    request.onsuccess = function () {
        console.log("All credentials have been successfully removed from the Binary passwords store.");
    };

    request.onerror = function (event) {
        console.error("Error clearing the Binary passwords store:", event.target.error);
    };
}

//===================================================================================

async function saveCredentialsToDb(signatureHash, credentials) {
    const result = await CallableFuture.callAsynchronously(2000, null, function (waiterId) {
        saveCredentials(
            signatureHash,
            credentials,
            function () {
                CallableFuture.releaseWaiterIfExistsWithSuccess(waiterId, "true");
            },
            function (err) {
                CallableFuture.releaseWaiterIfExistsWithError(waiterId, err);
            }
        );
    });
    return WaiterResponseType.SUCCESS === result.type;
}

async function getCredentialsFromDb(signatureHash) {
    const result = await CallableFuture.callAsynchronously(2000, null, function (waiterId) {
        getCredentials(
            signatureHash,
            function (credentials) {
                CallableFuture.releaseWaiterIfExistsWithSuccess(waiterId, credentials);
            },
            function (err) {
                CallableFuture.releaseWaiterIfExistsWithError(waiterId, err);
            }
        );
    });
    if ((WaiterResponseType.SUCCESS === result.type) && result.body) {
        return result.body;
    } else {
        return null;
    }
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