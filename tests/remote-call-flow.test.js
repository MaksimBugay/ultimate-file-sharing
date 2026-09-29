const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const cryptoSource = fs.readFileSync(require.resolve('../js/remote-call-crypto.js'), 'utf8');
const connectionSource = fs.readFileSync(require.resolve('../js/remote-call-connection.js'), 'utf8');
const clients = new Map();
const aliases = new Map();
let nextId = 0;

class ClientFilter {
  constructor(workSpaceId, accountId, deviceId, applicationId) {
    Object.assign(this, { workSpaceId, accountId, deviceId, applicationId });
  }
  hashCode() { return `${this.applicationId}:${this.deviceId}`; }
}

function element(initial = {}) {
  const handlers = new Map();
  return {
    hidden: false, disabled: false, checked: false, value: '', textContent: '', style: {},
    ...initial,
    addEventListener(type, fn) { handlers.set(type, fn); },
    removeEventListener(type) { handlers.delete(type); },
    async emit(type, event = { preventDefault() {} }) { return handlers.get(type)?.(event); },
    setAttribute() {}, select() {}, reportValidity() {}, showModal() {}, close() {}
  };
}

function makePage(urlString) {
  const url = new URL(urlString);
  const dom = new Map();
  const byId = id => {
    if (!dom.has(id)) dom.set(id, element());
    return dom.get(id);
  };
  byId('encryptMedia').checked = true;
  byId('verificationPanel').hidden = true;
  byId('copyJointLinkButton').disabled = true;
  const page = { url, dom, byId, started: false, mediaSecrets: [], errors: [], delayLookups: false };
  const windowHandlers = new Map();
  const window = {
    location: url, innerWidth: 1200, innerHeight: 850, setInterval() {},
    addEventListener(type, fn) { windowHandlers.set(type, fn); }
  };
  page.window = window;
  const document = {
    visibilityState: 'visible',
    getElementById: byId,
    addEventListener() {},
    createElement(tag) {
      assert.equal(tag, 'iframe');
      const iframe = element();
      iframe.contentWindow = {
        postMessage(message) {
          if (message.type === 'remote-call:init' && message.encrypted) {
            page.mediaSecrets.push(Buffer.from(message.mediaSecret));
          }
        }
      };
      return iframe;
    },
    body: {
      append(iframe) {
        queueMicrotask(() => {
          iframe.emit('load');
          const kind = new URL(iframe.src).searchParams.get('kind');
          const client = new ClientFilter('remote-call', 'anonymous-sharing', `media-${++nextId}`, `REMOTE-CALL-${kind.toUpperCase()}`);
          const alias = `alias:${client.hashCode()}`;
          aliases.set(alias, client);
          windowHandlers.get('message')({
            source: iframe.contentWindow, origin: url.origin,
            data: { type: 'remote-call:alias', kind, alias }
          });
        });
      }
    }
  };
  const PushcaClient = {
    ClientObj: null,
    isOpen() { return !!this.ClientObj; },
    sendPing() {},
    async openWsConnection(_address, client) {
      this.ClientObj = client;
      clients.set(client.hashCode(), page);
      aliases.set(`alias:${client.hashCode()}`, client);
      this.onOpenHandler?.();
    },
    async connectionAliasLookup(alias) {
      if (page.delayLookups) await new Promise(resolve => setTimeout(resolve, 30));
      const client = aliases.get(alias);
      if (!client) throw new Error(`Unknown alias ${alias}`);
      return { client };
    },
    async broadcastMessage(_from, to, _secure, message) {
      const target = clients.get(to.hashCode());
      if (!target) throw new Error('Unknown destination');
      queueMicrotask(() => target.PushcaClient.onMessageHandler(null, message));
    }
  };
  page.PushcaClient = PushcaClient;
  window.RemoteCallMedia = {
    async prepare() { return { audio: 'audio/webm', video: 'video/webm' }; },
    async start() { page.started = true; },
    async stop() { return { audio: 0, video: 0 }; },
    async abort() { return { audio: 0, video: 0 }; },
    setPeerMimeTypes() {}, receiveChunk() {}, finishRemote() {}, markCallEnded() {}
  };
  const context = vm.createContext({
    window, document, navigator: { userAgent: 'Test', maxTouchPoints: 0 },
    crypto: webcrypto, URL, URLSearchParams, TextEncoder, Uint8Array,
    atob, btoa, setTimeout, queueMicrotask,
    ClientFilter, PushcaClient, WaiterResponseType: { SUCCESS: 'success' },
    CallableFuture: { async callAsynchronously(_ms, hash) { return { type: 'success', body: `alias:${hash}` }; } },
    uuid: { v4: () => ({ toString: () => `id-${++nextId}` }) },
    encodeToBase64UrlSafe: s => Buffer.from(s).toString('base64url'),
    decodeFromBase64UrlSafe: s => Buffer.from(s, 'base64url').toString(),
    console: { error: (...args) => page.errors.push(args), warn: (...args) => page.errors.push(args) }
  });
  vm.runInContext(cryptoSource, context);
  vm.runInContext(connectionSource, context);
  return page;
}

async function until(predicate, label) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > 4000) throw new Error(`Timed out waiting for ${label}`);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

test('joint link contains only a public key and both sides verify before starting media', async () => {
  const caller = makePage('https://example.test/remote-call.html');
  await until(() => !!caller.byId('jointLink').value, 'public invitation');
  const link = new URL(caller.byId('jointLink').value);
  assert.match(link.hash, /call-public-key=/);
  assert.doesNotMatch(link.href, /call-key=|callSecret|privateKey/);

  const receiver = makePage(link.href);
  await until(() => !!receiver.byId('joinNameForm').addEventListener, 'receiver form');
  await receiver.byId('joinNameForm').emit('submit');
  await until(() => !caller.byId('verificationPanel').hidden && !receiver.byId('verificationPanel').hidden, 'both verification codes');
  assert.equal(caller.byId('verificationCode').textContent, receiver.byId('verificationCode').textContent);
  assert.equal(caller.started, false);
  assert.equal(receiver.started, false);

  await caller.byId('verifyCallButton').emit('click');
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(caller.started, false);
  assert.equal(receiver.started, false);
  await receiver.byId('verifyCallButton').emit('click');
  await until(() => caller.started && receiver.started, 'both call streams');
  assert.equal(caller.byId('verificationPanel').hidden, true);
  assert.equal(receiver.byId('verificationPanel').hidden, true);
  assert.deepEqual(caller.mediaSecrets[0], receiver.mediaSecrets[0]);
  assert.deepEqual(caller.errors, []);
  assert.deepEqual(receiver.errors, []);
});

test('early confirmation is retained, while a forged start is ignored', async () => {
  const caller = makePage('https://example.test/remote-call.html');
  await until(() => !!caller.byId('jointLink').value, 'public invitation');
  caller.delayLookups = true;
  const receiver = makePage(caller.byId('jointLink').value);
  await receiver.byId('joinNameForm').emit('submit');
  await until(() => !receiver.byId('verificationPanel').hidden, 'receiver verification code');
  await receiver.byId('verifyCallButton').emit('click');

  const forged = { protocol: 'REMOTE_CALL_V7', type: 'START', encrypted: true,
    videoAlias: 'attacker', audioAlias: 'attacker', auth: 'A'.repeat(43) };
  caller.PushcaClient.onMessageHandler(null, `remote-call-v7:${Buffer.from(JSON.stringify(forged)).toString('base64url')}`);
  await until(() => !caller.byId('verificationPanel').hidden, 'caller verification code');
  assert.equal(caller.started, false);
  await caller.byId('verifyCallButton').emit('click');
  await until(() => caller.started && receiver.started, 'verified call');
  assert.deepEqual(caller.errors, []);
  assert.deepEqual(receiver.errors, []);
});
