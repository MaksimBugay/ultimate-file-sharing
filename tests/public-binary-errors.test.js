const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../js/public-binary.js'), 'utf8');
const functions = source.slice(0, source.indexOf("const serverUrl ="));

function harness(status, redirectUrl) {
    const redirects = [];
    const requests = [];
    let removed = false;
    const message = { style: {} };
    const manifest = { name: 'file.txt', mimeType: 'text/plain', datagrams: [] };
    const context = vm.createContext({
        serverUrl: 'https://secure.fileshare.ovh',
        console: { log() {}, error() {} },
        window: { location: { replace: url => redirects.push(url) } },
        document: { getElementById: () => ({ remove() { removed = true; } }) },
        errorMessage: message,
        fetch: async (url, options) => {
            requests.push({ url, options });
            return { ok: status === 200, status, redirected: Boolean(redirectUrl), url: redirectUrl,
                json: async () => {
                    assert.equal(redirectUrl, undefined, 'Do not parse a redirected HTML page as JSON');
                    return manifest;
                } };
        },
        isPlayableMedia() { assert.fail('Must not process media after manifest failure'); },
        webSocketAvailabilityCheck() { assert.fail('Must not open WebSockets after manifest failure'); }
    });
    vm.runInContext(functions, context);
    return { context, redirects, requests, message, manifest, removed: () => removed };
}

test('missing manifest navigates to the error page and stops the download flow', async () => {
    const h = harness(200, 'https://secure.fileshare.ovh/binary/download-limit-exceeded.html?error=binary-not-found');
    await h.context.openPublicBinaryInTheSameTab('workspace', 'missing', null, null);
    assert.deepEqual(h.redirects, [
        'https://secure.fileshare.ovh/binary/download-limit-exceeded.html?error=binary-not-found'
    ]);
    assert.equal(h.requests.length, 1);
});

test('redirect destination is controlled by the server, without client error-code mapping', async () => {
    const destination = 'https://secure.fileshare.ovh/binary/download-limit-exceeded.html';
    const h = harness(200, destination);
    await h.context.openPublicBinaryInTheSameTab('workspace', 'binary', null, null);
    assert.deepEqual(h.redirects, [destination]);
});

test('other manifest failures replace the waiting screen with a visible error', async () => {
    const h = harness(500);
    await h.context.openPublicBinaryInTheSameTab('workspace', 'binary', null, null);
    assert.equal(h.redirects.length, 0);
    assert.equal(h.removed(), true);
    assert.equal(h.message.style.display, 'block');
    assert.match(h.message.textContent, /Unable to load/);
});

test('successful manifest requests preserve the payload and verification credentials', async () => {
    const h = harness(200);
    assert.equal(await h.context.downloadPublicBinaryManifest('workspace', 'binary', 'page', 'token'), h.manifest);
    assert.deepEqual(JSON.parse(h.requests[0].options.body), {
        workspaceId: 'workspace', binaryId: 'binary', pageId: 'page', humanToken: 'token'
    });
    assert.equal(h.redirects.length, 0);
});

test('human-only flow stops before using a missing manifest', async () => {
    const h = harness(200, 'https://secure.fileshare.ovh/binary/download-limit-exceeded.html?error=binary-not-found');
    const start = source.indexOf('    async function prepareBinaryDownloading(');
    const end = source.indexOf('    async function savePublicBinaryAsFile(', start);
    vm.runInContext(`
        let manifest;
        async function fetchPublicBinaryDescription() { return null; }
        function showErrorMessage() {}
        ${source.slice(start, end)}
    `, h.context);
    assert.equal(await h.context.prepareBinaryDownloading('workspace', 'missing', 'page', 'token'), false);
    assert.equal(h.redirects.length, 1);
});

test('protected manifest fetch also follows the server redirect without decoding HTML', async () => {
    const source = fs.readFileSync(require.resolve('../js/protected-binary-ws.js'), 'utf8');
    const destination = 'https://secure.fileshare.ovh/binary/download-limit-exceeded.html?error=binary-not-found';
    const redirects = [];
    const context = vm.createContext({
        serverUrl: 'https://secure.fileshare.ovh',
        createSignedDownloadRequest: async () => ({}),
        window: { location: { replace: url => redirects.push(url) } },
        fetch: async () => ({ redirected: true, url: destination,
            json() { assert.fail('Do not parse an error page as a manifest'); } })
    });
    vm.runInContext(source.slice(source.indexOf('async function downloadProtectedBinaryManifest(')), context);
    assert.equal(await context.downloadProtectedBinaryManifest('password', 'workspace', 'suffix'), null);
    assert.deepEqual(redirects, [destination]);
});


for (const failure of ['network', 'invalid JSON']) {
    test(`${failure} manifest failures display an error and preserve the original exception`, async () => {
        const h = harness(200);
        const expected = new Error(failure);
        h.context.fetch = async () => {
            if (failure === 'network') throw expected;
            return {ok: true, json: async () => { throw expected; }};
        };
        await assert.rejects(h.context.downloadPublicBinaryManifest('workspace', 'binary', null, null),
            error => error === expected);
        assert.equal(h.removed(), true);
        assert.equal(h.message.style.display, 'block');
        assert.match(h.message.textContent, /Unable to load/);
    });
}
