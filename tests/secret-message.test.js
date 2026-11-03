const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const JSZip = require('../js/jszip.min.js');
const { webcrypto } = require('node:crypto');

const source = fs.readFileSync(require.resolve('../js/secret-message.js'), 'utf8');
const library = fs.readFileSync(require.resolve('../js/jszip.min.js'), 'utf8');

const security = fs.readFileSync(require.resolve('../js/security-utils.js'), 'utf8');

function browser({ withLibrary = true, fetch: fetchImpl } = {}) {
    // Execute the browser bundle without require, module, Buffer, or Node APIs.
    const context = vm.createContext({
        Uint8Array, ArrayBuffer, setTimeout, clearTimeout,
        crypto: webcrypto, TextEncoder, btoa, atob, console: { error() {} },
        PushcaClient: { clusterBaseUrl: 'https://secure.fileshare.ovh' },
        fetch: fetchImpl || (() => { throw new Error('Unexpected network request'); })
    });
    vm.runInContext('globalThis.window = globalThis; globalThis.self = globalThis;', context);
    if (withLibrary) vm.runInContext(library, context);
    vm.runInContext(security, context);
    vm.runInContext(source, context);
    return context;
}

for (const input of ['', 'Hello, world!', 'Привіт 🌍 你好 café e\u0301\n\t\0', 'Repeated text 🌍 '.repeat(20000)]) {
    test(`browser ZIP round trip: ${input.length} characters`, async () => {
        const page = browser();
        const bytes = await page.zipText(input);
        assert.ok(bytes instanceof Uint8Array);
        assert.equal(bytes[0], 0x50);
        assert.equal(bytes[1], 0x4b);
        assert.equal(await page.unZipText(bytes), input);
        assert.equal(await page.unZipText(bytes.buffer), input);
    });
}

test('creates a compressed ZIP containing UTF-8 message.txt', async () => {
    const input = 'Compress this message! '.repeat(1000);
    const bytes = await browser().zipText(input);
    assert.ok(bytes.length < input.length / 10);
    const archive = await JSZip.loadAsync(bytes, { checkCRC32: true });
    assert.deepEqual(Object.keys(archive.files), ['message.txt']);
    assert.equal(await archive.file('message.txt').async('string'), input);
});

test('reads an externally created ZIP from a byte view with an offset', async () => {
    const archive = new JSZip();
    archive.file('message.txt', 'External ZIP: Привіт 🌍');
    const bytes = await archive.generateAsync({ type: 'uint8array' });
    const padded = new Uint8Array(bytes.length + 20);
    padded.set(bytes, 10);
    assert.equal(await browser().unZipText(padded.subarray(10, 10 + bytes.length)),
        'External ZIP: Привіт 🌍');
});

test('rejects invalid argument types', async () => {
    const page = browser();
    for (const input of [undefined, null, 123, {}, new Uint8Array()]) {
        await assert.rejects(page.zipText(input), /expects a string/);
    }
    for (const input of [undefined, null, 'bytes', [], {}, new DataView(new ArrayBuffer(4))]) {
        await assert.rejects(page.unZipText(input), /expects a Uint8Array or ArrayBuffer/);
    }
});

test('reports a missing browser library', async () => {
    const page = browser({ withLibrary: false });
    await assert.rejects(page.zipText('hello'), /Load js\/jszip.min.js/);
    await assert.rejects(page.unZipText(new Uint8Array()), /Load js\/jszip.min.js/);
});

test('rejects invalid and truncated ZIP data', async () => {
    const page = browser();
    await assert.rejects(page.unZipText(new Uint8Array()));
    await assert.rejects(page.unZipText(new TextEncoder().encode('not a zip')));
    const bytes = await page.zipText('hello');
    await assert.rejects(page.unZipText(bytes.subarray(0, bytes.length - 12)));
});

test('rejects archives without a message file', async () => {
    const page = browser();
    for (const name of ['other.txt', 'message.txt/']) {
        const archive = new JSZip();
        archive.file(name, 'hello');
        const bytes = await archive.generateAsync({ type: 'uint8array' });
        await assert.rejects(page.unZipText(bytes), /does not contain message.txt/);
    }
});

test('rejects corrupted file contents using the ZIP checksum', async () => {
    const archive = new JSZip();
    archive.file('message.txt', 'hello');
    const bytes = await archive.generateAsync({ type: 'uint8array', compression: 'STORE' });
    const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const dataOffset = 30 + header.getUint16(26, true) + header.getUint16(28, true);
    bytes[dataOffset] ^= 0xff;
    await assert.rejects(browser().unZipText(bytes), /CRC32 mismatch/);
});

const password = '  secret пароль 🔑  ';
const workspace = 'workspace-Привіт';

test('ZIP encrypt/decrypt round trip in separate browser contexts', async () => {
    const sender = browser();
    const receiver = browser();
    const text = 'Private message 🌍\n'.repeat(1000);
    const zip = await sender.zipText(text);
    const encrypted = await sender.encryptZipBytes(zip, password, workspace);
    assert.ok(encrypted instanceof Uint8Array);
    const decrypted = await receiver.decryptZipBytes(encrypted, password, workspace);
    assert.ok(decrypted instanceof Uint8Array);
    assert.deepEqual(decrypted, zip);
    assert.equal(await receiver.unZipText(decrypted), text);
});

test('uses the workspace ID directly as the PBKDF2 salt and a fresh IV', async () => {
    const page = browser();
    const input = new Uint8Array([0, 1, 127, 128, 255]);
    const first = await page.encryptZipBytes(input, password, workspace);
    const second = await page.encryptZipBytes(input, password, workspace);
    assert.notDeepEqual(first.subarray(1, 13), second.subarray(1, 13));
    assert.notDeepEqual(first, second);
    // Independently decrypt via Web Crypto to verify the format and exact salt.
    const material = await webcrypto.subtle.importKey('raw', new TextEncoder().encode(password),
        'PBKDF2', false, ['deriveKey']);
    const key = await webcrypto.subtle.deriveKey({ name: 'PBKDF2',
        salt: new TextEncoder().encode(workspace), iterations: 100000, hash: 'SHA-256' },
        material, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    for (const bytes of [first, second]) {
        assert.equal(bytes[0], 1);
        const plain = await webcrypto.subtle.decrypt(
            { name: 'AES-GCM', iv: bytes.subarray(1, 13) }, key, bytes.subarray(13));
        assert.deepEqual(new Uint8Array(plain), input);
    }
});

test('encryption accepts ArrayBuffers and byte views without including surrounding bytes', async () => {
    const page = browser();
    const input = new Uint8Array([99, 0, 128, 255, 99]);
    const original = input.slice();
    const encrypted = await page.encryptZipBytes(input.subarray(1, 4), password, workspace);
    const padded = new Uint8Array(encrypted.length + 20);
    padded.set(encrypted, 10);
    assert.deepEqual(await page.decryptZipBytes(padded.subarray(10, 10 + encrypted.length),
        password, workspace), input.subarray(1, 4));
    assert.deepEqual(await page.decryptZipBytes(encrypted.buffer, password, workspace), input.subarray(1, 4));
    const fromBuffer = await page.encryptZipBytes(input.buffer, password, workspace);
    assert.deepEqual(await page.decryptZipBytes(fromBuffer, password, workspace), input);
    assert.deepEqual(input, original);
    assert.deepEqual(padded.subarray(10, 10 + encrypted.length), encrypted);
});

test('empty bytes survive encryption and decryption', async () => {
    const page = browser();
    const encrypted = await page.encryptZipBytes(new Uint8Array(), password, workspace);
    assert.equal(encrypted.length, 29);
    assert.deepEqual(await page.decryptZipBytes(encrypted, password, workspace), new Uint8Array());
});

test('rejects incorrect passwords and workspace IDs', async () => {
    const page = browser();
    const encrypted = await page.encryptZipBytes(new Uint8Array([1, 2, 3]), password, workspace);
    for (const [pwd, id] of [['wrong', workspace], [password.trim(), workspace], [password, 'wrong']]) {
        await assert.rejects(page.decryptZipBytes(encrypted, pwd, id), /Unable to decrypt ZIP/);
    }
});

test('rejects modified IV, ciphertext, tag, truncated data, and unknown versions', async () => {
    const page = browser();
    const encrypted = await page.encryptZipBytes(new Uint8Array([1, 2, 3]), password, workspace);
    for (const offset of [1, 13, encrypted.length - 1]) {
        const corrupted = encrypted.slice();
        corrupted[offset] ^= 1;
        await assert.rejects(page.decryptZipBytes(corrupted, password, workspace), /Unable to decrypt ZIP/);
    }
    await assert.rejects(page.decryptZipBytes(encrypted.subarray(0, encrypted.length - 1),
        password, workspace), /Unable to decrypt ZIP/);
    const unsupported = encrypted.slice();
    unsupported[0] = 2;
    for (const malformed of [new Uint8Array(), encrypted.subarray(0, 28), unsupported]) {
        await assert.rejects(page.decryptZipBytes(malformed, password, workspace), /encrypted ZIP format/);
    }
});

test('encryption and decryption reject invalid inputs and empty credentials', async () => {
    const page = browser();
    for (const method of [page.encryptZipBytes, page.decryptZipBytes]) {
        for (const input of [undefined, null, 'bytes', [], {}, new DataView(new ArrayBuffer(4))]) {
            await assert.rejects(method(input, password, workspace), /expects a Uint8Array or ArrayBuffer/);
        }
        for (const invalid of [undefined, null, '', 123, {}]) {
            await assert.rejects(method(new Uint8Array(), invalid, workspace), /nonempty strings/);
            await assert.rejects(method(new Uint8Array(), password, invalid), /nonempty strings/);
        }
    }
});

for (const input of ['', 'Secret message', 'Привіт 🌍 你好 café e\u0301\n\t\0', 'Compress me! '.repeat(20000)]) {
    test(`secret message text round trip: ${input.length} characters`, async () => {
        const sender = browser();
        const receiver = browser();
        const bytes = await sender.textIntoSecretMessageBytes(input, password, workspace);
        assert.ok(bytes instanceof Uint8Array);
        assert.equal(await receiver.secretMessageBytesToText(bytes, password, workspace), input);
        assert.equal(await receiver.secretMessageBytesToText(bytes.buffer, password, workspace), input);
        // The wrapper output remains compatible with the individual helpers.
        const zip = await receiver.decryptZipBytes(bytes, password, workspace);
        assert.equal(await receiver.unZipText(zip), input);
    });
}

test('secret message wrappers propagate validation and authentication failures', async () => {
    const page = browser();
    await assert.rejects(page.textIntoSecretMessageBytes(null, password, workspace), /expects a string/);
    await assert.rejects(page.textIntoSecretMessageBytes('hello', '', workspace), /nonempty strings/);
    const bytes = await page.textIntoSecretMessageBytes('hello', password, workspace);
    for (const [pwd, id] of [['wrong', workspace], [password, 'wrong']]) {
        await assert.rejects(page.secretMessageBytesToText(bytes, pwd, id), /Unable to decrypt ZIP/);
    }
    const corrupted = bytes.slice();
    corrupted[corrupted.length - 1] ^= 1;
    await assert.rejects(page.secretMessageBytesToText(corrupted, password, workspace), /Unable to decrypt ZIP/);
    await assert.rejects(page.secretMessageBytesToText(new Uint8Array(), password, workspace), /encrypted ZIP format/);
});

test('secret message reader propagates invalid ZIP and missing message errors after decryption', async () => {
    const page = browser();
    const notZip = await page.encryptZipBytes(new TextEncoder().encode('not a zip'), password, workspace);
    await assert.rejects(page.secretMessageBytesToText(notZip, password, workspace));
    const archive = new JSZip();
    archive.file('other.txt', 'hello');
    const bytes = await archive.generateAsync({ type: 'uint8array' });
    const encrypted = await page.encryptZipBytes(bytes, password, workspace);
    await assert.rejects(page.secretMessageBytesToText(encrypted, password, workspace), /does not contain message.txt/);
});

test('public phrase request sends Base64 encrypted ZIP bytes, password hash, and nullable owner', async () => {
    const calls = [];
    const phrase = 'Meet me by the station.';
    const page = browser({ fetch: async (url, options) => {
        calls.push({ url, options });
        return { ok: true, json: async () => ({ publicPhrase: phrase }) };
    } });
    page.PushcaClient.clusterBaseUrl += '/';
    for (const owner of [undefined, null, 'test-owner']) {
        assert.equal(await page.textToSecreteMessagePublicPhrase('Private text 🌍', password, workspace, owner), phrase);
        const { url, options } = calls.at(-1);
        assert.equal(url, 'https://secure.fileshare.ovh/pushca/secret-message/save');
        assert.equal(options.method, 'POST');
        assert.equal(options.headers['Content-Type'], 'application/json');
        const body = JSON.parse(options.body);
        assert.deepEqual(Object.keys(body).sort(), ['message', 'ownerSignature', 'passwordHash', 'workspaceId']);
        assert.equal(body.workspaceId, workspace);
        assert.equal(body.ownerSignature, owner ?? null);
        const expectedHash = Buffer.from(await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(password))).toString('base64');
        assert.equal(body.passwordHash, expectedHash);
        assert.equal(await page.secretMessageBytesToText(new Uint8Array(Buffer.from(body.message, 'base64')),
            password, workspace), 'Private text 🌍');
        assert.ok(!options.body.includes(password));
        assert.ok(!options.body.includes('Private text'));
    }
});

test('public phrase request propagates HTTP, network, and invalid response errors', async () => {
    for (const status of [400, 409, 429, 500]) {
        const page = browser({ fetch: async () => ({ ok: false, status }) });
        await assert.rejects(page.textToSecreteMessagePublicPhrase('hello', password, workspace),
            new RegExp(`HTTP ${status}`));
    }
    const networkError = new Error('Network unavailable');
    const offline = browser({ fetch: async () => { throw networkError; } });
    await assert.rejects(offline.textToSecreteMessagePublicPhrase('hello', password, workspace),
        error => error === networkError);
    for (const result of [null, {}, { publicPhrase: null }, { publicPhrase: 123 }, { publicPhrase: '  ' }]) {
        const page = browser({ fetch: async () => ({ ok: true, json: async () => result }) });
        await assert.rejects(page.textToSecreteMessagePublicPhrase('hello', password, workspace), /invalid public phrase/);
    }
});

test('public phrase request rejects invalid text and credentials before sending', async () => {
    const page = browser();
    await assert.rejects(page.textToSecreteMessagePublicPhrase(null, password, workspace), /expects a string/);
    await assert.rejects(page.textToSecreteMessagePublicPhrase('hello', '', workspace), /nonempty strings/);
    await assert.rejects(page.textToSecreteMessagePublicPhrase('hello', password, ''), /nonempty strings/);
    // A large, poorly compressible message must not be sent past the server limit.
    const input = Buffer.from(webcrypto.getRandomValues(new Uint8Array(40000))).toString('base64');
    await assert.rejects(page.textToSecreteMessagePublicPhrase(input, password, workspace), /32 KiB API limit/);
});

// Run explicitly: RUN_SECRET_MESSAGE_LIVE=1 node --test tests/secret-message.test.js
// Creates an encrypted test message on the real service using fresh credentials.
test('live REST API round trip: text to public phrase to original text', {
    skip: process.env.RUN_SECRET_MESSAGE_LIVE !== '1', timeout: 60000
}, async () => {
    const page = browser({ fetch: (url, options) => fetch(url, {
        ...options, signal: AbortSignal.timeout(25000)
    }) });
    const liveWorkspace = `secret-message-test-${webcrypto.randomUUID()}`;
    const livePassword = webcrypto.randomUUID();
    const input = 'Browser secret-message integration test 🌍';
    // Omit ownerSignature to exercise the server default via explicit JSON null.
    const phrase = await page.textToSecreteMessagePublicPhrase(input, livePassword, liveWorkspace);
    assert.ok(phrase.trim());
    const receiver = browser({ fetch: (url, options) => fetch(url, {
        ...options, signal: AbortSignal.timeout(25000)
    }) });
    assert.equal(await receiver.secreteMessagePublicPhraseToText(phrase, livePassword, liveWorkspace), input);
});

test('public phrase reader posts lookup credentials and decrypts the returned Base64 message', async () => {
    const input = 'Private text 🌍\nПривіт';
    const bytes = await browser().textIntoSecretMessageBytes(input, password, workspace);
    const phrase = '  Meet me by the station.  ';
    const calls = [];
    const page = browser({ fetch: async (url, options) => {
        calls.push({ url, options });
        return { ok: true, json: async () => ({ message: Buffer.from(bytes).toString('base64') }) };
    } });
    page.PushcaClient.clusterBaseUrl += '/';
    for (const owner of [undefined, null, 'test-owner']) {
        assert.equal(await page.secreteMessagePublicPhraseToText(phrase, password, workspace, owner), input);
        const { url, options } = calls.at(-1);
        assert.equal(url, 'https://secure.fileshare.ovh/pushca/secret-message/fetch');
        assert.equal(options.method, 'POST');
        assert.equal(options.headers['Content-Type'], 'application/json');
        const passwordHash = Buffer.from(await webcrypto.subtle.digest('SHA-256',
            new TextEncoder().encode(password))).toString('base64');
        assert.deepEqual(JSON.parse(options.body), {
            workspaceId: workspace, passwordHash, ownerSignature: owner ?? null, publicPhrase: phrase
        });
        assert.ok(!options.body.includes(password));
    }
});

test('public phrase reader rejects invalid arguments before making a request', async () => {
    const page = browser();
    for (const phrase of [undefined, null, '', '  ', 123, {}]) {
        await assert.rejects(page.secreteMessagePublicPhraseToText(phrase, password, workspace), /Public phrase/);
    }
    for (const invalid of [undefined, null, '', 123, {}]) {
        await assert.rejects(page.secreteMessagePublicPhraseToText('phrase', invalid, workspace), /nonempty strings/);
        await assert.rejects(page.secreteMessagePublicPhraseToText('phrase', password, invalid), /nonempty strings/);
    }
});

test('public phrase reader propagates HTTP and network errors', async () => {
    for (const status of [400, 404, 429, 500]) {
        const page = browser({ fetch: async () => ({ ok: false, status }) });
        await assert.rejects(page.secreteMessagePublicPhraseToText('phrase', password, workspace),
            new RegExp(`HTTP ${status}`));
    }
    const networkError = new Error('Network unavailable');
    const page = browser({ fetch: async () => { throw networkError; } });
    await assert.rejects(page.secreteMessagePublicPhraseToText('phrase', password, workspace),
        error => error === networkError);
});

test('public phrase reader rejects missing messages, malformed data, and authentication failures', async () => {
    for (const result of [null, {}, { message: null }, { message: '' }, { message: 123 }]) {
        const page = browser({ fetch: async () => ({ ok: true, json: async () => result }) });
        await assert.rejects(page.secreteMessagePublicPhraseToText('phrase', password, workspace),
            /not found or API returned invalid message bytes/);
    }
    const encrypted = await browser().textIntoSecretMessageBytes('hello', password, workspace);
    encrypted[encrypted.length - 1] ^= 1;
    for (const message of ['!invalid base64!', 'AA==', Buffer.from(encrypted).toString('base64')]) {
        const page = browser({ fetch: async () => ({ ok: true, json: async () => ({ message }) }) });
        await assert.rejects(page.secreteMessagePublicPhraseToText('phrase', password, workspace));
    }
});

test('save retries phrase collisions up to three times with the same encrypted request', async () => {
    const bodies = [];
    const page = browser({ fetch: async (_url, options) => {
        bodies.push(options.body);
        return bodies.length < 4
            ? { ok: false, status: 409, json: async () => ({ description: 'Public phrase is already used' }) }
            : { ok: true, json: async () => ({ publicPhrase: 'A fresh phrase' }) };
    } });
    assert.equal(await page.textToSecreteMessagePublicPhrase('secret', password, workspace), 'A fresh phrase');
    assert.equal(bodies.length, 4);
    assert.equal(new Set(bodies).size, 1);
});

test('save stops after three collision retries', async () => {
    let calls = 0;
    const page = browser({ fetch: async () => {
        calls++;
        return { ok: false, status: 409, json: async () => ({ description: 'Public phrase is already used' }) };
    } });
    await assert.rejects(page.textToSecreteMessagePublicPhrase('secret', password, workspace), /HTTP 409.*Public phrase is already used/);
    assert.equal(calls, 4);
});

test('save does not retry other conflicts, malformed errors, or other HTTP statuses', async () => {
    for (const [status, json] of [
        [409, async () => ({ description: 'Different conflict' })],
        [409, async () => { throw new Error('Not JSON'); }],
        [500, async () => ({ description: 'Public phrase is already used' })]
    ]) {
        let calls = 0;
        const page = browser({ fetch: async () => { calls++; return { ok: false, status, json }; } });
        await assert.rejects(page.textToSecreteMessagePublicPhrase('secret', password, workspace), new RegExp(`HTTP ${status}`));
        assert.equal(calls, 1);
    }
});

test('save sends public conversation details separately from encrypted message content', async () => {
    let body;
    const page = browser({ fetch: async (_url, options) => {
        body = JSON.parse(options.body);
        return { ok: true, json: async () => ({ publicPhrase: 'Coffee by the station.' }) };
    } });
    const details = { topic: 'Travel', style: 'Friendly', history: ['Where shall we meet?', 'At the station.'] };
    await page.textToSecreteMessagePublicPhrase('Private plans 🌍', password, workspace, 'owner', details);
    assert.deepEqual(body.publicConversationDetails, { ...details, prohibitedMessages: [], locale: 'en' });
    assert.equal(await page.secretMessageBytesToText(new Uint8Array(Buffer.from(body.message, 'base64')),
        password, workspace), 'Private plans 🌍');
    assert.equal(body.ownerSignature, 'owner');
});

test('save supplies non-null context defaults even when the conversation panel is unused', async () => {
    let body;
    const page = browser({ fetch: async (_url, options) => {
        body = JSON.parse(options.body);
        return { ok: true, json: async () => ({ publicPhrase: 'A sunny afternoon.' }) };
    } });
    await page.textToSecreteMessagePublicPhrase('secret', password, workspace, null, { topic: ' ', style: '', history: [] });
    assert.deepEqual(body.publicConversationDetails, {
        topic: 'Weather', style: 'Informal/Casual', history: [], prohibitedMessages: [], locale: 'en'
    });
});

test('save rejects invalid public context before a request and accepts exact backend limits', async () => {
    const page = browser();
    for (const details of [[], 'context', { topic: 123 }, { style: false },
        { topic: 't'.repeat(501) }, { style: 's'.repeat(101) }, { history: 'message' },
        { history: [null] }, { history: ['a'.repeat(750), 'b'.repeat(751)] },
        { prohibitedMessages: ['a'.repeat(1501)] }]) {
        await assert.rejects(page.textToSecreteMessagePublicPhrase('secret', password, workspace, null, details), /Conversation/);
    }
    let body;
    const valid = browser({ fetch: async (_url, options) => {
        body = JSON.parse(options.body);
        return { ok: true, json: async () => ({ publicPhrase: 'A valid phrase.' }) };
    } });
    await valid.textToSecreteMessagePublicPhrase('secret', password, workspace, null,
        { topic: 't'.repeat(500), style: 's'.repeat(100), history: ['a'.repeat(750), 'b'.repeat(750)],
            prohibitedMessages: ['c'.repeat(750), 'd'.repeat(750)] });
    assert.equal(body.publicConversationDetails.topic.length, 500);
    assert.equal(body.publicConversationDetails.history.join('').length, 1500);
    assert.equal(body.publicConversationDetails.prohibitedMessages.join('').length, 1500);
});

test('save retries the backend empty-body 409 without losing public context', async () => {
    const bodies = [];
    const page = browser({ fetch: async (_url, options) => {
        bodies.push(options.body);
        return bodies.length < 4
            ? { ok: false, status: 409, text: async () => '' }
            : { ok: true, json: async () => ({ publicPhrase: 'New phrase.' }) };
    } });
    await page.textToSecreteMessagePublicPhrase('secret', password, workspace, null, { history: ['Public context'] });
    assert.equal(bodies.length, 4);
    assert.equal(new Set(bodies).size, 1);
    assert.deepEqual(JSON.parse(bodies[0]).publicConversationDetails.history, ['Public context']);
});

test('save includes a server description in a 500 error and does not retry it', async () => {
    let calls = 0;
    const page = browser({ fetch: async () => {
        calls++;
        return { ok: false, status: 500, text: async () => JSON.stringify({ description: 'Phrase generator unavailable' }) };
    } });
    await assert.rejects(page.textToSecreteMessagePublicPhrase('secret', password, workspace),
        /HTTP 500.*Phrase generator unavailable/);
    assert.equal(calls, 1);
});

test('live REST API round trip with public conversation details', {
    skip: process.env.RUN_SECRET_MESSAGE_LIVE !== '1', timeout: 60000
}, async () => {
    const page = browser({ fetch: (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(25000) }) });
    const id = `context-test-${webcrypto.randomUUID()}`;
    const pwd = webcrypto.randomUUID();
    const text = 'Synthetic encrypted context integration check 🌍';
    const phrase = await page.textToSecreteMessagePublicPhrase(text, pwd, id, null, {
        topic: 'Travel', style: 'Friendly', history: ['We are planning a train journey.', 'Shall we meet at the station?']
    });
    assert.ok(phrase.trim());
    assert.equal(await page.secreteMessagePublicPhraseToText(phrase, pwd, id), text);
});


test('public context uses English for omitted/null locale and canonicalizes a chosen language', async () => {
    let body;
    const page = browser({fetch: async (_url, options) => {
        body = JSON.parse(options.body);
        return {ok: true, json: async () => ({publicPhrase: 'A language-aware phrase.'})};
    }});
    for (const [locale, expected] of [[undefined, 'en'], [null, 'en'], ['', 'en'], ['uk', 'uk'], ['pt_BR', 'pt-BR']]) {
        await page.textToSecreteMessagePublicPhrase('secret', password, workspace, null, {locale});
        assert.equal(body.publicConversationDetails.locale, expected);
    }
    for (const locale of [123, [], {}, 'not a locale', 'en--US']) {
        await assert.rejects(browser().textToSecreteMessagePublicPhrase('secret', password, workspace, null, {locale}),
            /Conversation language/);
    }
});


test('save accepts exactly 32 KiB encrypted bytes and rejects one extra byte before sending', async () => {
    const bodies = [];
    const page = browser({ fetch: async (_url, options) => {
        bodies.push(JSON.parse(options.body));
        return { ok: true, json: async () => ({ publicPhrase: 'Public phrase.' }) };
    } });
    page.textIntoSecretMessageBytes = async () => new Uint8Array(32 * 1024);
    await page.textToSecreteMessagePublicPhrase('secret', password, workspace);
    assert.equal(Buffer.from(bodies[0].message, 'base64').length, 32 * 1024);
    page.textIntoSecretMessageBytes = async () => new Uint8Array(32 * 1024 + 1);
    await assert.rejects(page.textToSecreteMessagePublicPhrase('secret', password, workspace), /32 KiB/);
    assert.equal(bodies.length, 1);
});

test('save and fetch enforce workspace and owner limits before sending', async () => {
    const page = browser();
    for (const helper of [page.textToSecreteMessagePublicPhrase, page.secreteMessagePublicPhraseToText]) {
        await assert.rejects(helper('text', password, 'w'.repeat(101)), /Workspace ID.*100/);
        await assert.rejects(helper('text', password, workspace, 'o'.repeat(201)), /Owner signature.*200/);
    }
    await assert.rejects(page.secreteMessagePublicPhraseToText('p'.repeat(5001), password, workspace), /Public phrase.*5000/);
});

test('fetch accepts a 5000-character phrase and both APIs accept maximum length identifiers', async () => {
    const bodies = [];
    const longWorkspace = 'w'.repeat(100);
    const owner = 'o'.repeat(200);
    const phrase = 'p'.repeat(5000);
    const page = browser({ fetch: async (url, options) => {
        const body = JSON.parse(options.body);
        bodies.push(body);
        return { ok: true, json: async () => url.endsWith('/save')
            ? { publicPhrase: phrase } : { message: bodies[0].message } };
    } });
    assert.equal(await page.textToSecreteMessagePublicPhrase('secret', password, longWorkspace, owner), phrase);
    assert.equal(await page.secreteMessagePublicPhraseToText(phrase, password, longWorkspace, owner), 'secret');
    assert.equal(bodies[1].publicPhrase.length, 5000);
    for (const body of bodies) {
        assert.equal(body.workspaceId, longWorkspace);
        assert.equal(body.ownerSignature, owner);
    }
});
