(() => {
    'use strict';
    const databaseName = 'SecretMessageSettings';
    const storeName = 'settings';
    function openDatabase() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(databaseName, 1);
            request.onupgradeneeded = () => request.result.createObjectStore(storeName);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }
    async function accessRecord(page, mode, record) {
        const db = await openDatabase();
        try {
            return await new Promise((resolve, reject) => {
                const transaction = db.transaction(storeName, mode);
                const store = transaction.objectStore(storeName);
                const request = mode === 'readonly' ? store.get(page) : store.put(record, page);
                transaction.oncomplete = () => resolve(request.result);
                transaction.onerror = () => reject(transaction.error);
                transaction.onabort = () => reject(transaction.error || new Error('Settings storage was interrupted.'));
            });
        } finally { db.close(); }
    }
    const context = page => new TextEncoder().encode(`secret-message-settings:v1:${page}`);
    window.SecretMessageSettingsStore = Object.freeze({
        async save(page, settings) {
            // IndexedDB structured-clones CryptoKey without exporting its key material.
            // A fresh non-extractable key and IV protect each saved snapshot at rest.
            const key = await crypto.subtle.generateKey({name: 'AES-GCM', length: 256}, false, ['encrypt', 'decrypt']);
            const iv = crypto.getRandomValues(new Uint8Array(12));
            const ciphertext = await crypto.subtle.encrypt({name: 'AES-GCM', iv, additionalData: context(page)},
                key, new TextEncoder().encode(JSON.stringify(settings)));
            await accessRecord(page, 'readwrite', {version: 1, key, iv, ciphertext});
        },
        async load(page) {
            const record = await accessRecord(page, 'readonly');
            if (!record) return null;
            if (record.version !== 1) throw new Error('Unsupported saved settings version.');
            const bytes = await crypto.subtle.decrypt({name: 'AES-GCM', iv: record.iv, additionalData: context(page)},
                record.key, record.ciphertext);
            return JSON.parse(new TextDecoder().decode(bytes));
        }
    });
})();
