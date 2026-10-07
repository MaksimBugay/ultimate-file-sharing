const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../js/transfer-site.js'), 'utf8');

function harness({legacy = false, mobileViewport = false, mobileDevice = false, coarsePointer = false} = {}) {
    const elements = new Map();
    const documentEvents = new Map();
    const calls = [];
    const waiters = new Map();
    const control = {transfer: async () => {}, restore: async () => {}, lookup: async alias => ({alias}), selection: '', sanitize: text => text};
    let context, waiterId = 0;
    const listen = (events, type, listener) => events.set(type, [...(events.get(type) || []), listener]);
    const dispatch = async (events, type, event) => {
        for (const listener of events.get(type) || []) await listener(event);
    };
    function element(id) {
        if (legacy && ['selectFilesContainer', 'selectFilesSubContainer', 'transferIntro'].includes(id)) return null;
        if (!elements.has(id)) {
            const events = new Map();
            const classes = new Set();
            let value = '';
            elements.set(id, {
                id, style: {}, disabled: false, readOnly: false, hidden: false, files: [], textContent: '',
                selectionStart: 0, selectionEnd: 0, focusCalls: [],
                get value() { return value; },
                set value(next) { value = next == null ? '' : String(next); },
                classList: {
                    add: name => classes.add(name), remove: name => classes.delete(name),
                    contains: name => classes.has(name),
                    toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); }
                },
                addEventListener: (type, listener) => listen(events, type, listener),
                dispatch(type, details = {}) {
                    return dispatch(events, type, {target: this, buttons: 0, preventDefault() {}, stopPropagation() {}, ...details});
                },
                setAttribute(name, value) { this[name] = value; if (name === 'readonly') this.readOnly = true; },
                removeAttribute() {},
                getBoundingClientRect: () => ({width: 300, top: 0, left: 0}),
                focus(options) { if (!this.disabled) { this.focusCalls.push(options); context.document.activeElement = this; } },
                blur() { if (context.document.activeElement === this) context.document.activeElement = element('body'); },
                click() { return this.dispatch('click'); }
            });
        }
        return elements.get(id);
    }
    context = vm.createContext({
        URLSearchParams, Blob,
        console: {log() {}, warn() {}, error() {}},
        window: {
            location: {search: ''}, setInterval: () => 1, addEventListener() {},
            getSelection: () => ({toString: () => control.selection}),
            matchMedia: query => ({matches: mobileViewport || (coarsePointer && query.includes('(pointer: coarse)'))})
        },
        document: {
            getElementById: element,
            querySelector(selector) {
                if (selector === '.drop-zone-heading') return legacy ? null : element('heading');
                if (selector === '.consent-dialog.visible') {
                    return [...elements.values()].find(item => item.id.endsWith('Dialog') && item.classList.contains('visible')) || null;
                }
                return null;
            },
            addEventListener: (type, listener) => listen(documentEvents, type, listener),
            activeElement: null
        },
        isMobile: () => mobileDevice, hasParentWithIdOrClass: () => true,
        isNotEmpty: value => value != null && value !== '',
        ProgressBarWidget: class {}, FingerprintJS: {load: () => new Promise(() => {})},
        PushcaClient: {
            restoreBrokenWsConnection: () => control.restore(),
            connectionAliasLookup: alias => control.lookup(alias)
        },
        TransferFileHelper: {
            async transferBlobToVirtualHostBase(...args) { calls.push({kind: 'blob', args}); await control.transfer(); },
            async transferFileToVirtualHostBase(...args) { calls.push({kind: 'file', args}); await control.transfer(); }
        },
        DOMPurify: {sanitize: text => control.sanitize(text)},
        CallableFuture: {
            callAsynchronously(timeout, id, callback) {
                return new Promise(resolve => { const key = String(++waiterId); waiters.set(key, resolve); callback(key); });
            },
            releaseWaiterIfExistsWithSuccess(key, value) { waiters.get(key)({type: 'success', body: value}); }
        },
        WaiterResponseType: {SUCCESS: 'success'}, delay: async () => {}
    });
    context.document.activeElement = element('body');
    context.infoMsg = element('infoMsg');
    vm.runInContext(source, context);
    const run = code => vm.runInContext(code, context);
    const ready = () => {
        element('receiverVirtualHost').value = 'receiver.test';
        element('receiverVirtualHost').readOnly = true;
        run('setDeviceFromVirtualHost("sender.test")');
    };
    return {context, element, control, calls, ready, run,
        documentLoaded: () => dispatch(documentEvents, 'DOMContentLoaded', {}),
        documentMove: target => dispatch(documentEvents, 'mousemove', {target, buttons: 0})};
}

const clipboardEvent = items => ({clipboardData: {items}, preventDefault() {}, stopPropagation() {}});
const imageItem = () => {
    const blob = new Blob(['image bytes'], {type: 'image/png'});
    blob.name = 'example.png';
    return {kind: 'file', getAsFile: () => blob};
};
const settle = () => new Promise(resolve => setImmediate(resolve));

function assertEnabled(h, enabled) {
    for (const id of ['selectFilesBtn', 'toolBarPasteArea', 'dropZone']) assert.equal(h.element(id).disabled, !enabled, id);
    assert.equal(h.element('dropZone').classList.contains('disabled-zone'), !enabled);
}

test('the transfer introduction starts expanded on desktop without changing receiver focus', async () => {
    const h = harness();
    await h.documentLoaded();
    assert.equal(h.element('transferIntroContent').hidden, false);
    assert.equal(h.element('transferIntroToggle')['aria-expanded'], 'true');
    assert.equal(h.context.document.activeElement.id, 'receiverVirtualHost');
    assertEnabled(h, false);
});

test('the transfer introduction starts collapsed for mobile layouts and touch devices', async () => {
    for (const options of [{mobileViewport: true}, {mobileDevice: true}, {coarsePointer: true}]) {
        const h = harness(options);
        await h.documentLoaded();
        assert.equal(h.element('transferIntroContent').hidden, true);
        assert.equal(h.element('transferIntroToggle')['aria-expanded'], 'false');
        assert.equal(h.context.document.activeElement.id, 'receiverVirtualHost');
        assertEnabled(h, false);
    }
});

test('the introduction toggle hides its content and keeps transfers locked before peer resolution', async () => {
    const h = harness({mobileViewport: true});
    await h.documentLoaded();
    await h.element('transferIntroToggle').click();
    assert.equal(h.element('transferIntroContent').hidden, false);
    assert.equal(h.element('transferIntroToggle')['aria-expanded'], 'true');
    assertEnabled(h, false);
    await h.element('transferIntroToggle').click();
    assert.equal(h.element('transferIntroContent').hidden, true);
    assert.equal(h.element('transferIntroToggle')['aria-expanded'], 'false');
    assertEnabled(h, false);
    assert.deepEqual(h.calls, []);
});

test('page load and mouse movement retain receiver-input focus until the peer is resolved', async () => {
    for (const legacy of [false, true]) {
        const h = harness({legacy});
        await h.documentLoaded();
        assert.equal(h.context.document.activeElement.id, 'receiverVirtualHost');
        assertEnabled(h, false);
        h.element('ownerVirtualHost').focus();
        await h.documentMove(h.element('dropZone'));
        assert.equal(h.context.document.activeElement.id, 'receiverVirtualHost');
        await h.element('dropZone').dispatch('mousemove');
        assert.equal(h.context.document.activeElement.id, 'receiverVirtualHost');
    }
});

test('unresolved receiver focus does not interrupt an open dialog', async () => {
    const h = harness();
    await h.documentLoaded();
    h.element('hostDetailsDialog').classList.add('visible');
    h.element('hdCloseBtn').focus();
    await h.documentMove(h.element('dropZone'));
    assert.equal(h.context.document.activeElement.id, 'hdCloseBtn');
    assertEnabled(h, false);
});

test('pending and failed peer lookup keep paste and drop locked until successful resolution', async () => {
    const h = harness();
    await h.documentLoaded();
    h.run('setDeviceFromVirtualHost("sender.test")');
    let finishLookup;
    h.control.lookup = () => new Promise(resolve => { finishLookup = resolve; });
    h.element('receiverVirtualHost').value = 'pending.peer';
    await h.element('receiverVirtualHost').dispatch('input');
    assert.equal(h.element('receiverVirtualHost').readOnly, false);
    assertEnabled(h, false);
    await h.element('heading').dispatch('mousedown');
    await h.element('heading').dispatch('click');
    await h.element('toolBarPasteArea').dispatch('paste', clipboardEvent([imageItem()]));
    await h.element('dropZone').dispatch('dragenter');
    await h.element('dropZone').dispatch('dragover');
    await h.element('dropZone').dispatch('drop', {dataTransfer: {files: [imageItem().getAsFile()], clearData() {}}});
    assert.equal(h.context.document.activeElement.id, 'receiverVirtualHost');
    assert.equal(h.element('dropZone').classList.contains('dragover'), false);
    assert.equal(h.element('errorDialog').classList.contains('visible'), false);
    assert.deepEqual(h.calls, []);
    finishLookup(null);
    await settle();
    assertEnabled(h, false);
    assert.equal(h.context.document.activeElement.id, 'receiverVirtualHost');
    h.control.lookup = async () => ({alias: 'resolved.peer'});
    await h.element('receiverVirtualHost').dispatch('input');
    await settle();
    assert.equal(h.element('receiverVirtualHost').readOnly, true);
    assert.equal(h.element('receiverVirtualHost').value, 'resolved.peer');
    assertEnabled(h, true);
    assert.equal(h.context.document.activeElement.id, 'toolBarPasteArea');
});

test('file selection and paste require both connected host names', async () => {
    const h = harness();
    assertEnabled(h, false);
    await h.element('toolBarPasteArea').dispatch('paste', clipboardEvent([imageItem()]));
    assert.deepEqual(h.calls, []);
    h.ready();
    assertEnabled(h, true);
    h.run('setDeviceFromVirtualHost(null)');
    assertEnabled(h, false);
});

test('hovering the drop zone focuses paste without moving the page; moving elsewhere preserves focus', async () => {
    const h = harness(); h.ready();
    h.element('receiverVirtualHost').focus();
    await h.documentMove(h.element('ownerVirtualHost'));
    assert.equal(h.context.document.activeElement.id, 'receiverVirtualHost');
    await h.element('dropZone').dispatch('mousemove');
    assert.equal(h.context.document.activeElement.id, 'toolBarPasteArea');
    assert.equal(h.element('toolBarPasteArea').focusCalls.at(-1).preventScroll, true);
});

test('hover preserves page selections, input selections, and mouse drags', async () => {
    const h = harness(); h.ready();
    const input = h.element('ownerVirtualHost'); input.focus();
    h.control.selection = 'selected text';
    await h.element('dropZone').dispatch('mousemove');
    assert.equal(h.context.document.activeElement, input);
    h.control.selection = ''; input.selectionEnd = 4;
    await h.element('dropZone').dispatch('mousemove');
    assert.equal(h.context.document.activeElement, input);
    input.selectionEnd = 0;
    await h.element('dropZone').dispatch('mousemove', {buttons: 1});
    assert.equal(h.context.document.activeElement, input);
});

test('heading mouse down and click retain paste focus as on the sharing page', async () => {
    const h = harness(); h.ready();
    let prevented = false;
    await h.element('heading').dispatch('mousedown', {preventDefault: () => { prevented = true; }});
    assert.equal(prevented, true);
    assert.equal(h.context.document.activeElement.id, 'toolBarPasteArea');
    h.element('receiverVirtualHost').focus();
    await h.element('heading').dispatch('click');
    assert.equal(h.context.document.activeElement.id, 'toolBarPasteArea');
});

test('an open dialog blocks focus capture and clipboard transfer', async () => {
    const h = harness(); h.ready();
    h.element('hostDetailsDialog').classList.add('visible');
    h.element('hdCloseBtn').focus();
    await h.element('dropZone').dispatch('mousemove');
    await h.element('toolBarPasteArea').dispatch('paste', clipboardEvent([imageItem()]));
    assert.equal(h.context.document.activeElement.id, 'hdCloseBtn');
    assert.deepEqual(h.calls, []);
});

test('clipboard data is captured before asynchronous connection restoration', async () => {
    const h = harness(); h.ready();
    let readable = true, resume;
    h.control.restore = () => new Promise(resolve => { resume = resolve; });
    const file = imageItem().getAsFile();
    const pending = h.element('toolBarPasteArea').dispatch('paste', clipboardEvent([
        {kind: 'file', getAsFile: () => { assert.equal(readable, true); return file; }},
        {kind: 'string', getAsString: callback => { assert.equal(readable, true); callback('clipboard note'); }}
    ]));
    await settle();
    readable = false;
    resume(); await pending;
    assert.equal(h.calls.length, 2);
    assert.equal(await h.calls[1].args[0].text(), 'clipboard note');
});

test('clipboard files transfer to the selected receiver and preserve their names and types', async () => {
    const h = harness(); h.ready();
    await h.element('toolBarPasteArea').dispatch('paste', clipboardEvent([imageItem()]));
    assert.equal(h.calls.length, 1);
    const [blob, name, type, receiver, sender] = h.calls[0].args;
    assert.equal(await blob.text(), 'image bytes');
    assert.deepEqual([name, type, receiver, sender], ['example.png', 'image/png', 'receiver.test', 'sender.test']);
    assertEnabled(h, true);
    assert.match(h.element('infoMsg').textContent, /successfully transferred/);
});

test('clipboard text passes through sanitization before transfer as a text file', async () => {
    const h = harness(); h.ready();
    h.control.sanitize = text => { assert.equal(text, '<b>private note</b>'); return 'private note'; };
    await h.element('toolBarPasteArea').dispatch('paste', clipboardEvent([
        {kind: 'string', getAsString: callback => callback('<b>private note</b>')}
    ]));
    const [blob, name, type] = h.calls[0].args;
    assert.equal(await blob.text(), 'private note');
    assert.match(name, /^text-message-\d+\.txt$/);
    assert.equal(type, 'text/plain');
});

test('an active paste blocks overlapping paste and drop operations and releases the controls afterward', async () => {
    const h = harness(); h.ready();
    let finish;
    h.control.transfer = () => new Promise(resolve => { finish = resolve; });
    const pending = h.element('toolBarPasteArea').dispatch('paste', clipboardEvent([imageItem()]));
    await settle();
    assertEnabled(h, false);
    assert.notEqual(h.element('selectFilesSubContainer').style.display, 'none');
    await h.element('toolBarPasteArea').dispatch('paste', clipboardEvent([imageItem()]));
    await h.element('dropZone').dispatch('drop', {dataTransfer: {files: [imageItem().getAsFile()], clearData() {}}});
    assert.equal(h.calls.length, 1);
    finish(); await pending;
    assertEnabled(h, true);
    assert.equal(h.element('fileTransferProgressBtn').style.display, 'none');
});

test('an unavailable data channel aborts the transfer, cleans up, and allows recovery after reconnecting', async () => {
    for (const legacy of [false, true]) {
        const h = harness({legacy}); h.ready();
        h.control.restore = async () => h.run('setDeviceFromVirtualHost(null)');
        h.element('fileInput').value = 'previous selection';
        await h.element('toolBarPasteArea').dispatch('paste', clipboardEvent([imageItem()]));
        assert.deepEqual(h.calls, []);
        assert.equal(h.element('errorMsg').textContent, 'Failed file transfer attempt: Data channel is unavailable. Please reconnect.');
        assert.equal(h.element('errorDialog').classList.contains('visible'), true);
        assert.equal(h.run('FileTransfer.isTransferring'), false);
        assert.equal(h.element('fileInput').value, '');
        assert.equal(h.element('progressBarContainer').style.display, 'none');
        assert.equal(h.element('fileTransferProgressBtn').style.display, 'none');
        assertEnabled(h, false);
        h.control.restore = async () => {};
        h.run('setDeviceFromVirtualHost("sender.test")');
        await h.element('closeErrorBtn').click();
        assertEnabled(h, true);
        await h.element('toolBarPasteArea').dispatch('paste', clipboardEvent([imageItem()]));
        assert.equal(h.calls.length, 1);
        assertEnabled(h, true);
    }
});

test('failed clipboard transfers show the error and restore file selection', async () => {
    const h = harness(); h.ready();
    h.control.transfer = async () => { throw new Error('receiver disconnected'); };
    h.element('fileInput').value = 'previous selection';
    await h.element('toolBarPasteArea').dispatch('paste', clipboardEvent([imageItem()]));
    assert.match(h.element('errorMsg').textContent, /receiver disconnected/);
    assert.equal(h.element('errorDialog').classList.contains('visible'), true);
    assertEnabled(h, true);
    assert.equal(h.element('fileInput').value, '');
    assert.equal(h.element('progressBarContainer').style.display, 'none');
});

test('browse and drop use the same transfer lifecycle and stay usable for the legacy page', async () => {
    for (const legacy of [false, true]) {
        const h = harness({legacy}); h.ready();
        const file = imageItem().getAsFile();
        h.element('fileInput').value = 'selected.png';
        h.element('fileInput').files = [file];
        await h.element('fileInput').dispatch('change');
        await h.element('dropZone').dispatch('drop', {dataTransfer: {files: [file], clearData() {}}});
        assert.deepEqual(h.calls.map(call => call.kind), ['file', 'file']);
        assertEnabled(h, true);
        assert.equal(h.element('fileInput').value, '');
    }
});
