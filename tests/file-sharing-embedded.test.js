const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const thumbnailSource = fs.readFileSync(require.resolve('../js/thumbnail-generator.js'), 'utf8');
const sharingSource = fs.readFileSync(require.resolve('../js/file-sharing-embedded.js'), 'utf8');

function thumbnailHarness(fetchImpl) {
    const calls = [];
    const customThumbnail = new Blob(['custom'], {type: 'image/png'});
    const context = vm.createContext({
        console, fetch: fetchImpl,
        uuid: {v5: name => `id:${name}`},
        isImageContentType: type => type.startsWith('image/'),
        isVideoContentType: type => type.startsWith('video/'),
        createImageThumbnailFromSource: async () => { calls.push('image'); return customThumbnail; },
        createVideoThumbnailFromSource: async () => { calls.push('video'); return customThumbnail; },
        createDefaultTextThumbnail: async () => { calls.push('text'); return customThumbnail; }
    });
    // Avoid the unrelated canvas background preload in this isolated harness.
    vm.runInContext(thumbnailSource.replace(/imageUrlToBlob\("\.\.\/images\/text-background\.png"\)[\s\S]*?\.catch\(err => console.error\(err\)\);/, ''), context);
    return {calls, generate: context.ThumbnailGenerator.buildAndSaveThumbnail};
}

test('protected image thumbnail uploads the exact fetched bytes with the existing thumbnail identity', async () => {
    const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 255, 128]);
    const h = thumbnailHarness(async url => {
        assert.equal(url, 'https://secure.fileshare.ovh/images/protected-image-thumbnail.png');
        return new Response(bytes, {headers: {'Content-Type': 'image/png'}});
    });
    let uploaded;
    await h.generate('binary-id', new Blob(['private pixels']), 'private.png', 'image/png', 'description',
        async (...args) => { uploaded = args; }, 12345, true);
    assert.deepEqual(h.calls, []);
    assert.deepEqual(uploaded.slice(0, 4), ['id:thumbnail-binary-id.png', 'thumbnail', 'thumbnail-binary-id.png', 'image/png']);
    assert.deepEqual(Buffer.from(await uploaded[4].arrayBuffer()), bytes);
    assert.equal(uploaded[5], 12345);
});

for (const type of ['image/png', 'video/mp4', 'application/pdf']) {
    test(`${type} retains its custom thumbnail when appropriate`, async () => {
        const h = thumbnailHarness(() => { throw new Error('Unexpected placeholder fetch'); });
        let uploaded = false;
        await h.generate('binary-id', new Blob(['content']), 'file', type, 'description',
            async () => { uploaded = true; }, 12345, type !== 'image/png');
        assert.deepEqual(h.calls, [type === 'image/png' ? 'image' : type === 'video/mp4' ? 'video' : 'text']);
        assert.equal(uploaded, true);
    });
}

for (const failure of ['http', 'network']) {
    test(`protected image ${failure} failure never falls back to a custom thumbnail`, async () => {
        const h = thumbnailHarness(async () => {
            if (failure === 'network') throw new Error('Network failure');
            return new Response('missing', {status: 404});
        });
        let uploaded = false;
        await assert.rejects(h.generate('id', new Blob(['private pixels']), 'private.png', 'image/png', 'description',
            async () => { uploaded = true; }, 12345, true));
        assert.deepEqual(h.calls, []);
        assert.equal(uploaded, false);
    });
}

function sharingHarness() {
    const elements = new Map();
    const element = id => {
        if (!elements.has(id)) {
            const listeners = new Map();
            const attributes = new Map();
            elements.set(id, {
                id, style: {}, disabled: false, checked: false, value: '', hidden: false,
                classList: {add() {}, remove() {}, contains: () => false},
                addEventListener: (event, callback) => listeners.set(event, callback),
                dispatch: (event, detail = {}) => listeners.get(event)?.(detail),
                removeAttribute: name => attributes.delete(name),
                setAttribute: (name, value) => attributes.set(name, value),
                getAttribute: name => attributes.get(name),
                focus() { context.document.activeElement = this; }
            });
        }
        return elements.get(id);
    };
    let init, remoteCallback, finishDownload;
    const download = new Promise(resolve => { finishDownload = resolve; });
    const context = vm.createContext({
        console, URLSearchParams, URL, Blob,
        window: {location: {search: ''}, addEventListener() {}},
        document: {
            getElementById: element, querySelectorAll: () => [], querySelector: () => element('heading'),
            addEventListener: (event, callback) => { if (event === 'DOMContentLoaded') init = callback; }
        },
        ProgressBarWidget: class {setProgress() {}},
        SFSPUrlInput: {create: (...args) => { remoteCallback = args[4]; return {clear() {}}; }},
        FingerprintJS: {load: () => new Promise(() => {})}, PushcaClient: {},
        delay: () => new Promise(resolve => setImmediate(resolve)),
        requestWakeLock: async () => {}, releaseWakeLock() {},
        sendDownloadRemoteStreamRequestToBinaryProxy: () => download,
        uuid: {v4: () => 'binary-id'}, calculateDisplaySizeMb: () => 1,
        MemoryBlock: {MB: 1048576}
    });
    vm.runInContext(sharingSource, context);
    init();
    return {context, element, remote: () => remoteCallback('https://example.com/stream'), finishDownload};
}

for (const result of [null, 'https://example.com/shared']) {
    test(`remote download hides file selection until completion (${result ? 'success' : 'failure'})`, async () => {
        const h = sharingHarness();
        vm.runInContext('CallableFuture = {callAsynchronously: async () => ({type: "success"})}; WaiterResponseType = {SUCCESS: "success"};', h.context);
        h.element('remoteStreamTab').dispatch('click');
        const pending = h.remote();
        assert.equal(h.element('selectFilesSection').hidden, true);
        assert.equal(h.element('remoteStreamUrlSection').hidden, false);
        assert.equal(h.element('selectFilesTab').disabled, true);
        assert.equal(h.element('remoteStreamTab').disabled, true);
        h.element('selectFilesTab').dispatch('click');
        assert.equal(h.element('selectFilesSection').hidden, true);
        assert.equal(h.element('selectFilesSection').disabled, true);
        assert.equal(h.element('toolBarPasteArea').disabled, true);
        assert.equal(h.element('remoteStreamUrlSection').disabled, true);
        assert.equal(h.element('progressBarContainer').style.display, 'block');
        let shared = false;
        h.context.processAttempt = () => { shared = true; };
        await vm.runInContext('shareContent(processAttempt)', h.context);
        assert.equal(shared, false);
        h.finishDownload(result);
        await pending;
        assert.equal(h.element('selectFilesSection').hidden, true);
        assert.equal(h.element('remoteStreamUrlSection').hidden, false);
        assert.equal(h.element('selectFilesTab').disabled, false);
        assert.equal(h.element('remoteStreamTab').disabled, false);
        assert.equal(h.element('selectFilesSection').disabled, false);
        assert.equal(h.element('toolBarPasteArea').disabled, true);
        h.element('selectFilesTab').dispatch('click');
        assert.equal(h.element('selectFilesSection').hidden, false);
        assert.equal(h.element('remoteStreamUrlSection').hidden, true);
        assert.equal(h.element('toolBarPasteArea').disabled, false);
        assert.equal(h.element('remoteStreamUrlSection').disabled, false);
        assert.equal(h.element('progressBarContainer').style.display, 'none');
    });
}

for (const entryPoint of ['saveFileInCloud', 'saveBlobInCloud']) {
    test(`${entryPoint} passes password protection to thumbnail generation`, async () => {
        const h = sharingHarness();
        const observed = [];
        h.context.ThumbnailGenerator = {buildAndSaveThumbnail: async (...args) => { observed.push(args[7]); }};
        vm.runInContext('FileSharing.saveContentInCloud = async () => true; FileSharing.saveBlobWithIdInCloud = async () => true;', h.context);
        const blob = new Blob(['content'], {type: 'image/png'});
        blob.name = 'private.png';
        h.context.sample = blob;
        for (const password of ['secret', null]) {
            h.context.samplePassword = password;
            await vm.runInContext(entryPoint === 'saveFileInCloud'
                ? 'FileSharing.saveFileInCloud(sample, "description", false, samplePassword, 12345)'
                : 'FileSharing.saveBlobInCloud(sample.name, sample.type, "description", sample, false, samplePassword, 12345)', h.context);
        }
        assert.deepEqual(observed, [true, false]);
    });
}


test('failed protected thumbnail fetch restores upload controls and shows the error', async () => {
    const h = sharingHarness();
    h.context.processAttempt = async () => { throw new Error('Cannot load protected image thumbnail: HTTP 404'); };
    await vm.runInContext('shareContent(processAttempt)', h.context);
    assert.equal(h.element('selectFilesBtn').disabled, false);
    assert.equal(h.element('dropZone').disabled, false);
    assert.equal(h.element('fileTransferProgressBtn').style.display, 'none');
    assert.match(h.element('errorMsg').textContent, /Cannot load protected image thumbnail: HTTP 404/);
});


test('sharing tabs default to files and show only the selected panel', () => {
    const h = sharingHarness();
    const assertSelection = filesSelected => {
        assert.equal(h.element('selectFilesSection').hidden, !filesSelected);
        assert.equal(h.element('remoteStreamUrlSection').hidden, filesSelected);
        assert.equal(h.element('selectFilesTab').getAttribute('aria-selected'), String(filesSelected));
        assert.equal(h.element('remoteStreamTab').getAttribute('aria-selected'), String(!filesSelected));
        assert.equal(h.element('selectFilesTab').tabIndex, filesSelected ? 0 : -1);
        assert.equal(h.element('remoteStreamTab').tabIndex, filesSelected ? -1 : 0);
        assert.equal(h.element('toolBarPasteArea').disabled, !filesSelected);
    };
    assertSelection(true);
    h.element('remoteStreamTab').dispatch('click');
    assertSelection(false);
    h.element('selectFilesTab').dispatch('click');
    assertSelection(true);
});

test('sharing tabs support arrow keys, Home and End with focus following selection', () => {
    const h = sharingHarness();
    for (const [from, key, to] of [
        ['selectFilesTab', 'ArrowRight', 'remoteStreamTab'],
        ['remoteStreamTab', 'ArrowRight', 'selectFilesTab'],
        ['selectFilesTab', 'ArrowLeft', 'remoteStreamTab'],
        ['remoteStreamTab', 'Home', 'selectFilesTab'],
        ['selectFilesTab', 'End', 'remoteStreamTab']
    ]) {
        let prevented = false;
        h.element(from).dispatch('keydown', {key, preventDefault: () => { prevented = true; }});
        assert.equal(prevented, true);
        assert.equal(h.context.document.activeElement, h.element(to));
        assert.equal(h.element(to).getAttribute('aria-selected'), 'true');
        assert.notEqual(h.element('selectFilesSection').hidden, h.element('remoteStreamUrlSection').hidden);
    }
});

test('password protection returns to files and disables the remote stream tab', () => {
    const h = sharingHarness();
    h.element('remoteStreamTab').dispatch('click');
    vm.runInContext('makeShareWithPasswordUiAdjustments()', h.context);
    assert.equal(h.element('remoteStreamTab').disabled, true);
    assert.equal(h.element('selectFilesSection').hidden, false);
    assert.equal(h.element('remoteStreamUrlSection').hidden, true);
    h.element('remoteStreamTab').dispatch('click');
    assert.equal(h.element('remoteStreamUrlSection').hidden, true);
    vm.runInContext('makeSharePublicUiAdjustments()', h.context);
    assert.equal(h.element('remoteStreamTab').disabled, false);
    assert.equal(h.element('remoteStreamUrlSection').hidden, true);
    h.element('remoteStreamTab').dispatch('click');
    assert.equal(h.element('remoteStreamUrlSection').hidden, false);
});

test('file sharing locks tab switching until cleanup', async () => {
    const h = sharingHarness();
    let finishUpload;
    h.context.processAttempt = () => new Promise(resolve => { finishUpload = resolve; });
    const pending = vm.runInContext('shareContent(processAttempt)', h.context);
    assert.equal(h.element('selectFilesTab').disabled, true);
    assert.equal(h.element('remoteStreamTab').disabled, true);
    h.element('remoteStreamTab').dispatch('click');
    assert.equal(h.element('selectFilesSection').hidden, false);
    finishUpload();
    await pending;
    assert.equal(h.element('selectFilesTab').disabled, false);
    assert.equal(h.element('remoteStreamTab').disabled, false);
    assert.equal(h.element('toolBarPasteArea').disabled, false);
});
