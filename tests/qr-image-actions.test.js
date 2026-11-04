const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../js/file-sharing-embedded.js'), 'utf8');
const dialogSource = source.slice(source.indexOf('const infoDialog ='), source.indexOf('const errorDialog ='));

function harness({mobile = false, copyFails = false, shareFails = false, deferredCopy = false} = {}) {
    const elements = new Map();
    const links = [], shares = [], copied = [], released = [];
    const element = id => {
        if (!elements.has(id)) {
            const classes = new Set(), listeners = {};
            elements.set(id, {
                classList: {add: x => classes.add(x), remove: x => classes.delete(x), contains: x => classes.has(x)},
                addEventListener: (event, callback) => listeners[event] = callback,
                click: () => listeners.click?.(), appendChild() {}
            });
        }
        return elements.get(id);
    };
    const node = tag => ({tag, children: [], appendChild(child) {this.children.push(child);}});
    const printer = {
        document: {head: node('head'), body: node('body'), createElement: node},
        addEventListener() {}, focus() {}, print() {this.printed = true;}
    };
    let finishCopy;
    const context = vm.createContext({
        console: {log() {}, error() {}}, Blob, File, Uint8Array, atob, name: 'Shared content',
        FileSharing: {defaultReadMeText: 'Default description'}, isMobile: () => mobile,
        CallableFuture: {releaseWaiterIfExistsWithSuccess: id => released.push(id)},
        copyTextToClipboard: url => links.push(url),
        document: {getElementById: element, createElement: node},
        window: {open: () => printer},
        QRCode: {toDataURL: (url, options, callback) => callback(null, 'data:image/png;base64,iVBORw0KGgo=')},
        ClipboardItem: class {constructor(data) {this.data = data;}},
        navigator: {
            clipboard: {write: async items => {
                if (copyFails) throw new Error('Clipboard denied');
                if (deferredCopy) await new Promise(resolve => {finishCopy = resolve;});
                copied.push(items[0].data['image/png']);
            }},
            canShare: data => data.files.length === 1,
            share: async data => {
                shares.push(data);
                if (shareFails) throw new Error('Sharing cancelled');
            }
        }
    });
    vm.runInContext(dialogSource, context);
    context.showInfoMsg('dialog-id', 'Download link', 'https://example.com/file');
    return {context, element, links, shares, copied, released, printer, finishCopy: () => finishCopy()};
}

test('Copy closes the dialog and preserves PNG clipboard data without copying the link', async () => {
    const h = harness();
    await h.element('copyQrImageBtn').click();
    assert.equal(h.context.isInfoDialogVisible(), false);
    assert.equal(h.copied[0].type, 'image/png');
    assert.deepEqual(Buffer.from(await h.copied[0].arrayBuffer()), Buffer.from('89504e470d0a1a0a', 'hex'));
    assert.deepEqual(h.links, []);
    assert.deepEqual(h.shares, []);
    assert.deepEqual(h.released, ['dialog-id']);
    h.context.closeInfoDialog();
    assert.deepEqual(h.links, []);
});

test('mobile Copy shares the same PNG file without sharing or copying the URL', async () => {
    const h = harness({mobile: true});
    await h.element('copyQrImageBtn').click();
    assert.equal(h.context.isInfoDialogVisible(), false);
    assert.equal(h.shares.length, 1);
    const data = h.shares[0];
    assert.deepEqual(Object.keys(data), ['files']);
    assert.equal(data.files[0].name, 'fileshare-qr-code.png');
    assert.equal(data.files[0].type, 'image/png');
    assert.deepEqual(await data.files[0].arrayBuffer(), await h.copied[0].arrayBuffer());
    assert.deepEqual(h.links, []);
});

test('normal mobile close still copies and shares the link', () => {
    const h = harness({mobile: true});
    h.element('closeInfoBtn').click();
    assert.deepEqual(h.links, ['https://example.com/file']);
    assert.equal(h.shares[0].url, 'https://example.com/file');
    assert.equal(h.context.isInfoDialogVisible(), false);
});

test('clipboard denial keeps the dialog open and does not share anything', async () => {
    const h = harness({mobile: true, copyFails: true});
    await h.element('copyQrImageBtn').click();
    assert.equal(h.context.isInfoDialogVisible(), true);
    assert.match(h.element('infoMsg').textContent, /Could not copy/);
    assert.deepEqual(h.shares, []);
    assert.deepEqual(h.links, []);
});

test('cancelled mobile sharing preserves the image and leaves the dialog closed', async () => {
    const h = harness({mobile: true, shareFails: true});
    await h.element('copyQrImageBtn').click();
    assert.equal(h.context.isInfoDialogVisible(), false);
    assert.equal(h.copied.length, 1);
    assert.deepEqual(h.links, []);
});

test('a pending copy cannot close or share a newly opened dialog', async () => {
    const h = harness({mobile: true, deferredCopy: true});
    const pending = h.element('copyQrImageBtn').click();
    h.context.showInfoMsg('new-dialog', 'New link', 'https://example.com/new');
    h.finishCopy();
    await pending;
    assert.equal(h.context.isInfoDialogVisible(), true);
    assert.deepEqual(h.released, []);
    assert.deepEqual(h.shares, []);
});

for (const numberOfDownloads of [null, undefined, 3]) {
    test(`print includes the binary name and expiry, with optional download limit (${numberOfDownloads})`, () => {
        const h = harness();
        const manifest = {name: 'Report <draft> & final.pdf', expireAt: 1900000000, numberOfDownloads};
        h.context.showInfoMsg('print', 'Link', 'https://example.com/file', manifest);
        h.element('printQrImageBtn').click();
        const layout = h.printer.document.body.children[0];
        assert.deepEqual(layout.children.map(child => child.tag), ['h1', 'img', 'footer']);
        assert.equal(layout.children[0].textContent, 'Report <draft> & final');
        assert.equal(h.printer.document.title, 'Report <draft> & final');
        const footer = layout.children[2];
        const expiry = new Date(manifest.expireAt * 1000).toLocaleString(undefined, {
            year: 'numeric', month: 'short', day: 'numeric',
            hour: '2-digit', minute: '2-digit', timeZoneName: 'short'
        });
        assert.equal(footer.children[0].textContent, `Expires at: ${expiry}`);
        assert.equal(footer.children.length, numberOfDownloads == null ? 1 : 2);
        if (numberOfDownloads != null) assert.equal(footer.children[1].textContent, '3 allowed downloads');
        assert.equal(h.printer.printed, undefined);
        layout.children[1].onload();
        assert.equal(h.printer.printed, true);
    });
}

test('a new QR dialog does not reuse the previous binary print metadata', () => {
    const h = harness();
    h.context.showInfoMsg('old', 'Link', 'https://example.com/old', {name: 'Old file', expireAt: 1900000000, numberOfDownloads: 2});
    h.context.showInfoMsg('new', 'Link', 'https://example.com/new');
    h.element('printQrImageBtn').click();
    const layout = h.printer.document.body.children[0];
    assert.equal(layout.children[0].textContent, 'Shared content');
    assert.equal(layout.children[2].children[0].textContent, 'Expires at: Not specified');
    assert.equal(layout.children[2].children.length, 1);
});

for (const [name, mimeType, expected] of [
    ['Holiday.jpg', 'image/jpeg', 'Holiday'],
    ['Report.final.pdf', 'application/pdf', 'Report.final'],
    ['No extension', 'application/octet-stream', 'No extension'],
    ['.hidden', 'application/octet-stream', '.hidden'],
    ['message.txt', 'text/plain', 'Note'],
    ['message.txt', 'text/plain; charset=utf-8', 'Note']
]) {
    test(`printed title for ${name} (${mimeType}) is ${expected}`, () => {
        const h = harness();
        h.context.showInfoMsg('print', 'Link', 'https://example.com/file', {name, mimeType});
        h.element('printQrImageBtn').click();
        assert.equal(h.printer.document.title, expected);
        assert.equal(h.printer.document.body.children[0].children[0].textContent, expected);
    });
}

for (const [password, readMeText, included] of [
    ['secret', 'Private description\nSecond line', true],
    ['secret', 'Default description', false],
    ['secret', '', false],
    ['secret', '   ', false],
    [null, 'Public description', false]
]) {
    test(`printed description: private=${Boolean(password)}, readme=${JSON.stringify(readMeText)}`, () => {
        const h = harness();
        h.context.showInfoMsg('print', 'Link', 'https://example.com/file', {name: 'file.jpg', password, readMeText});
        h.element('printQrImageBtn').click();
        const footer = h.printer.document.body.children[0].children[2];
        assert.equal(footer.children.length, included ? 2 : 1);
        if (included) {
            assert.equal(footer.children[1].textContent, readMeText);
            assert.equal(footer.children[1].className, 'print-readme');
        }
    });
}
