const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {webcrypto} = require('node:crypto');
const source = fs.readFileSync(require.resolve('../js/secret-message-settings.js'), 'utf8');

function browser() {
    const records = new Map();
    // Model IndexedDB's structured cloning, including non-extractable CryptoKeys.
    const database = {
        close() {}, createObjectStore() {},
        transaction() {
            const transaction = {};
            transaction.objectStore = () => ({
                get: page => request(records.get(page)),
                put: (record, page) => { records.set(page, structuredClone(record)); return request(page); }
            });
            function request(value) {
                const result = {result: structuredClone(value)};
                queueMicrotask(() => transaction.oncomplete());
                return result;
            }
            return transaction;
        }
    };
    const context = vm.createContext({crypto: webcrypto, TextEncoder, TextDecoder, Uint8Array,
        indexedDB: {open() {
            const request = {result: database};
            queueMicrotask(() => { request.onupgradeneeded(); request.onsuccess(); });
            return request;
        }}
    });
    vm.runInContext('window = globalThis;', context);
    vm.runInContext(source, context);
    return {store: context.SecretMessageSettingsStore, records};
}
const settings = {version: 1, workspaceId: 'test-workspace', password: 'private password 🔑',
    ownerSignature: 'owner', publicConversationDetails: {topic: 'Travel', style: 'Friendly', history: ['Hello'], locale: 'uk'}};

test('saved settings restore all values while persisted password is encrypted and key cannot be exported', async () => {
    const {store, records} = browser();
    assert.equal(await store.load('/secret-message.html'), null);
    await store.save('/secret-message.html', settings);
    const record = records.get('/secret-message.html');
    assert.equal(record.key.extractable, false);
    assert.equal(record.key.algorithm.name, 'AES-GCM');
    await assert.rejects(webcrypto.subtle.exportKey('raw', record.key));
    assert.ok(!new TextDecoder().decode(record.ciphertext).includes(settings.password));
    assert.ok(!JSON.stringify(record).includes(settings.password));
    assert.deepEqual(JSON.parse(JSON.stringify(await store.load('/secret-message.html'))), settings);
});

test('saving changed settings replaces the snapshot with fresh encryption', async () => {
    const {store, records} = browser();
    await store.save('/page', settings);
    const first = records.get('/page');
    const next = {...settings, password: 'replacement password'};
    await store.save('/page', next);
    const second = records.get('/page');
    assert.notDeepEqual(first.iv, second.iv);
    assert.notDeepEqual(first.ciphertext, second.ciphertext);
    assert.equal((await store.load('/page')).password, next.password);
});

test('corrupted settings and encrypted snapshots transplanted to another page fail authentication', async () => {
    const {store, records} = browser();
    await store.save('/page', settings);
    const original = structuredClone(records.get('/page'));
    records.set('/other-page', structuredClone(original));
    await assert.rejects(store.load('/other-page'));
    new Uint8Array(records.get('/page').ciphertext)[0] ^= 1;
    await assert.rejects(store.load('/page'));
    records.set('/page', {...original, version: 999});
    await assert.rejects(store.load('/page'), /Unsupported saved settings version/);
});
