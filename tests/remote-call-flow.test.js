const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto, createHash, createHmac } = require('node:crypto');

const securitySource = fs.readFileSync(require.resolve('../js/security-utils.js'), 'utf8');
const connectionSource = fs.readFileSync(require.resolve('../js/remote-call-connection.js'), 'utf8');
const clients = new Map();
const aliases = new Map();
let nextId = 0;

class ClientFilter {
  constructor(workSpaceId, accountId, deviceId, applicationId) {
    Object.assign(this, { workSpaceId, accountId, deviceId, applicationId });
  }
  hashCode() { return `${this.workSpaceId}:${this.applicationId}:${this.deviceId}`; }
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

function makePage(urlString, options = {}) {
  const url = new URL(urlString);
  const clock = { now: () => performance.now() * 10 + (options.clockOffset ?? (url.searchParams.has('source-host') ? 125000 : 50000)) };
  const dom = new Map();
  const byId = id => {
    if (!dom.has(id)) dom.set(id, element());
    return dom.get(id);
  };
  byId('encryptMedia').checked = true;
  byId('verificationPanel').hidden = true;
  byId('copyJointLinkButton').disabled = true;
  const page = { url, dom, byId, started: false, mediaSecrets: [], errors: [], signals: [], delayLookups: false };
  const windowHandlers = new Map();
  const window = {
    location: url, innerWidth: 1200, innerHeight: 850, setInterval() {},
    addEventListener(type, fn) { windowHandlers.set(type, fn); }
  };
  page.window = window;
  page.mediaFrames = new Map();
  page.streamFailures = [];
  page.emitChannel = (kind, fields) => windowHandlers.get('message')({
    source: page.mediaFrames.get(kind).contentWindow, origin: url.origin,
    data: { kind, ...fields }
  });
  const document = {
    visibilityState: 'visible',
    getElementById: byId,
    addEventListener() {},
    createElement(tag) {
      assert.equal(tag, 'iframe');
      const iframe = element();
      iframe.contentWindow = {
        postMessage(message) {
          if (message.type === 'remote-call:init') iframe.init = message;
          if (message.type === 'remote-call:finish') queueMicrotask(() => page.emitChannel(message.kind, { type: 'remote-call:finished', count: 0 }));
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
          page.mediaFrames.set(kind, iframe);
          const client = new ClientFilter(`REMOTE_CALL_${kind.toUpperCase()}_STREAM`, iframe.init.clientId, iframe.init.clientId, iframe.init.remoteCallId);
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
      const signal = JSON.parse(Buffer.from(message.slice('remote-call-v10:'.length), 'base64url').toString());
      page.signals.push(signal);
      const target = clients.get(to.hashCode());
      if (!target) throw new Error('Unknown destination');
      const delivered = page.transformSignal ? await page.transformSignal(signal) : signal;
      if (delivered === null) return;
      const payload = `remote-call-v10:${Buffer.from(JSON.stringify(delivered)).toString('base64url')}`;
      queueMicrotask(() => target.PushcaClient.onMessageHandler(null, payload));
    }
  };
  page.PushcaClient = PushcaClient;
  window.RemoteCallMedia = {
    async prepare() { return { audio: 'audio/webm', video: 'video/webm' }; },
    async ensureReady() { page.readinessChecks = (page.readinessChecks || 0) + 1; },
    async start(_send, agreedStart) { page.started = true; page.actualStart = clock.now(); page.agreedStart = agreedStart; },
    async stop() { page.stopped = true; return { audio: 0, video: 0 }; },
    async abort() { page.aborted = true; return { audio: 0, video: 0 }; },
    scheduleStart(time, callback) {
      const timer = setTimeout(callback, Math.max(0, time - clock.now()) / 10);
      return () => clearTimeout(timer);
    },
    setCallStartTime(time) { page.scheduledStart = time; },
    getRecordingStartTimes() { return { audio: page.actualStart, video: page.actualStart }; },
    setPeerRecordingStartTimes(times) { page.peerActualStarts = times; },
    restartRemotePlayer(kind, restart) { (page.restarts ||= []).push({ kind, ...restart }); },
    disableRemoteVideo() { page.videoDisabled = true; },
    async disableOutgoingVideo() { page.outgoingVideoDisabled = true; },
    async reduceTransportQuality(kind, reduction) { return { generation: reduction, firstIndex: 10,
      mimeType: `${kind}/webm`, bitrate: kind === 'audio' ? 42880 : 700000, quality: 'medium' }; },
    setPeerMimeTypes() {}, receiveChunk() {}, finishRemote() {}, markCallEnded() {},
    failRemoteStream(kind, message) { page.streamFailures.push({ kind, message }); }
  };
  const context = vm.createContext({
    window, document, navigator: { userAgent: 'Test', maxTouchPoints: 0 },
    crypto: webcrypto, URL, URLSearchParams, TextEncoder, TextDecoder, Uint8Array,
    atob, btoa, setTimeout: (fn, delay) => setTimeout(fn, delay / 10), clearTimeout, queueMicrotask, performance: clock,
    ClientFilter, PushcaClient, WaiterResponseType: { SUCCESS: 'success' },
    CallableFuture: { async callAsynchronously(_ms, hash) { return { type: 'success', body: `alias:${hash}` }; } },
    uuid: { v4: () => ({ toString: () => `id-${++nextId}` }) },
    encodeToBase64UrlSafe: s => Buffer.from(s).toString('base64url'),
    decodeFromBase64UrlSafe: s => Buffer.from(s, 'base64url').toString(),
    console: { error: (...args) => page.errors.push(args), warn: (...args) => page.errors.push(args) }
  });
  if (options.forbidCalendarClock) {
    const forbidden = () => { throw new Error('Start synchronization must not read calendar or wall-clock time'); };
    context.Date = new Proxy(Date, { get: forbidden, apply: forbidden, construct: forbidden });
    context.Intl = new Proxy(Intl, { get: forbidden });
  }
  vm.runInContext(securitySource, context);
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

test('default encrypted call wraps its secret without displaying a comparison code', async () => {
  const caller = makePage('https://example.test/remote-call.html');
  await until(() => !!caller.byId('jointLink').value, 'invitation');
  const link = new URL(caller.byId('jointLink').value);
  assert.deepEqual([...link.searchParams.keys()], ['source-host']);
  assert.deepEqual(Object.keys(JSON.parse(Buffer.from(link.searchParams.get('source-host'), 'base64url').toString())),
    ['workSpaceId', 'accountId', 'deviceId', 'applicationId']);
  assert.doesNotMatch(link.href, /call-public-key|call-key|callSecret|privateKey|wrappedSecret/);
  assert.equal(new URLSearchParams(link.hash.slice(1)).get('extra-security'), '0');

  const receiver = makePage(link.href);
  await until(() => !!receiver.byId('joinNameForm').addEventListener, 'receiver form');
  await receiver.byId('joinNameForm').emit('submit');
  await until(() => caller.started && receiver.started, 'encrypted call');
  const join = receiver.signals.find(signal => signal.type === 'JOIN');
  const offer = caller.signals.find(signal => signal.type === 'OFFER');
  assert.equal(typeof join.publicKey, 'string');
  assert.equal(typeof offer.wrappedSecret, 'string');
  assert.equal(join.extraSecurity, false);
  assert.equal(offer.extraSecurity, false);
  assert.doesNotMatch(JSON.stringify([...caller.signals, ...receiver.signals]), /privateKey|mediaSecret/);
  assert.equal(caller.byId('verificationPanel').hidden, true);
  assert.equal(receiver.byId('verificationPanel').hidden, true);
  assert.deepEqual(caller.mediaSecrets[0], receiver.mediaSecrets[0]);
  assert.deepEqual(caller.errors, []);
  assert.deepEqual(receiver.errors, []);
});

test('extra security requires matching code confirmation from both people', async () => {
  const caller = makePage('https://example.test/remote-call.html');
  await until(() => !!caller.byId('jointLink').value, 'invitation');
  caller.byId('extraSecurity').checked = true;
  await caller.byId('extraSecurity').emit('change');
  const link = new URL(caller.byId('jointLink').value);
  assert.equal(new URLSearchParams(link.hash.slice(1)).get('extra-security'), '1');
  const receiver = makePage(link.href);
  await receiver.byId('joinNameForm').emit('submit');
  await until(() => !receiver.byId('verificationPanel').hidden && !caller.byId('verificationPanel').hidden,
    'both verification codes');
  assert.equal(receiver.byId('extraSecurity').checked, true);
  assert.equal(receiver.byId('extraSecurity').disabled, true);
  assert.equal(caller.byId('verificationCode').textContent, receiver.byId('verificationCode').textContent);
  assert.equal(caller.started, false);
  assert.equal(receiver.started, false);
  await caller.byId('verifyCallButton').emit('click');
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(caller.started, false);
  assert.equal(receiver.started, false);
  await receiver.byId('verifyCallButton').emit('click');
  await until(() => caller.started && receiver.started, 'verified call');
  assert.equal(caller.byId('verificationPanel').hidden, true);
  assert.equal(receiver.byId('verificationPanel').hidden, true);
  assert.deepEqual(caller.mediaSecrets[0], receiver.mediaSecrets[0]);
  assert.deepEqual(caller.errors, []);
  assert.deepEqual(receiver.errors, []);
});

test('a forged start is ignored before both people confirm', async () => {
  const caller = makePage('https://example.test/remote-call.html');
  await until(() => !!caller.byId('jointLink').value, 'public invitation');
  caller.byId('extraSecurity').checked = true;
  await caller.byId('extraSecurity').emit('change');
  const receiver = makePage(caller.byId('jointLink').value);
  await receiver.byId('joinNameForm').emit('submit');
  await until(() => !receiver.byId('verificationPanel').hidden && !caller.byId('verificationPanel').hidden,
    'both verification codes');

  const forged = { protocol: 'REMOTE_CALL_V10', type: 'START', encrypted: true,
    videoAlias: 'attacker', audioAlias: 'attacker', auth: 'A'.repeat(43) };
  receiver.PushcaClient.onMessageHandler(null, `remote-call-v10:${Buffer.from(JSON.stringify(forged)).toString('base64url')}`);
  assert.equal(caller.started, false);
  assert.equal(receiver.started, false);
  await receiver.byId('verifyCallButton').emit('click');
  await caller.byId('verifyCallButton').emit('click');
  await until(() => caller.started && receiver.started, 'verified call');
  assert.deepEqual(caller.errors, []);
  assert.deepEqual(receiver.errors, []);
});

test('an unencrypted invitation still joins without exchanging call keys', async () => {
  const caller = makePage('https://example.test/remote-call.html');
  await until(() => !!caller.byId('jointLink').value, 'invitation');
  caller.byId('encryptMedia').checked = false;
  await caller.byId('encryptMedia').emit('change');
  const link = caller.byId('jointLink').value;
  assert.match(link, /e2e=0/);
  assert.equal(caller.byId('extraSecurity').checked, false);
  assert.equal(caller.byId('extraSecurity').disabled, true);
  const receiver = makePage(link);
  await receiver.byId('joinNameForm').emit('submit');
  await until(() => caller.started && receiver.started, 'unencrypted call');
  assert.equal(receiver.signals.find(signal => signal.type === 'JOIN').publicKey, undefined);
  assert.equal(caller.signals.find(signal => signal.type === 'OFFER').wrappedSecret, undefined);
  assert.equal(caller.mediaSecrets.length, 0);
  assert.equal(receiver.mediaSecrets.length, 0);
  assert.deepEqual(caller.errors, []);
  assert.deepEqual(receiver.errors, []);
});

async function attackerKeyPair() {
  const pair = await webcrypto.subtle.generateKey({
    name: 'RSA-OAEP', modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256'
  }, true, ['encrypt', 'decrypt']);
  return { ...pair, publicString: Buffer.from(await webcrypto.subtle.exportKey('spki', pair.publicKey)).toString('base64') };
}

function joinProof(linkKey, join) {
  return createHmac('sha256', Buffer.from(linkKey, 'base64url'))
    .update(JSON.stringify(['remote-call-v10/join', join.managerAlias, join.publicKey, join.commitment ?? null]))
    .digest('base64url');
}

test('the joint link carries a link key only in its fragment', async () => {
  const caller = makePage('https://example.test/remote-call.html');
  await until(() => !!caller.byId('jointLink').value, 'invitation');
  const link = new URL(caller.byId('jointLink').value);
  assert.match(new URLSearchParams(link.hash.slice(1)).get('link-key'), /^[A-Za-z0-9_-]{43}$/);
  assert.equal(link.searchParams.has('link-key'), false);
  caller.byId('encryptMedia').checked = false;
  await caller.byId('encryptMedia').emit('change');
  assert.equal(new URLSearchParams(new URL(caller.byId('jointLink').value).hash.slice(1)).has('link-key'), false);
});

test('an encrypted joint link without a valid link key is invalid', async () => {
  const caller = makePage('https://example.test/remote-call.html');
  await until(() => !!caller.byId('jointLink').value, 'invitation');
  const link = new URL(caller.byId('jointLink').value);
  const settings = new URLSearchParams(link.hash.slice(1));
  settings.set('link-key', 'too-short');
  link.hash = settings.toString();
  const receiver = makePage(link.href);
  await receiver.byId('joinNameForm').emit('submit');
  await until(() => receiver.byId('connectionStatus').textContent === 'Invalid joint link.', 'invalid link');
  assert.equal(receiver.signals.length, 0);
});

test('a relay that substitutes the receiver public key is rejected by the caller', async () => {
  const attacker = await attackerKeyPair();
  const caller = makePage('https://example.test/remote-call.html');
  await until(() => !!caller.byId('jointLink').value, 'invitation');
  const receiver = makePage(caller.byId('jointLink').value);
  receiver.transformSignal = signal => signal.type === 'JOIN'
    ? { ...signal, publicKey: attacker.publicString } : signal;
  await receiver.byId('joinNameForm').emit('submit');
  await until(() => receiver.byId('connectionStatus').textContent.includes('could not be verified'), 'rejection');
  assert.equal(caller.signals.some(signal => signal.type === 'OFFER'), false);
  assert.equal(caller.mediaSecrets.length, 0);
  assert.equal(caller.started, false);
  assert.equal(receiver.started, false);
});

test('a relay that forges the offer for the real receiver key is rejected by the receiver', async () => {
  const caller = makePage('https://example.test/remote-call.html');
  await until(() => !!caller.byId('jointLink').value, 'invitation');
  const receiver = makePage(caller.byId('jointLink').value);
  caller.transformSignal = async signal => {
    if (signal.type !== 'OFFER') return signal;
    const realPublic = await webcrypto.subtle.importKey('spki',
      Buffer.from(receiver.signals.find(item => item.type === 'JOIN').publicKey, 'base64'),
      { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
    const relaySecret = Buffer.from(webcrypto.getRandomValues(new Uint8Array(32))).toString('base64');
    const wrapped = await webcrypto.subtle.encrypt({ name: 'RSA-OAEP' }, realPublic, Buffer.from(relaySecret));
    return { ...signal, wrappedSecret: Buffer.from(wrapped).toString('base64') };
  };
  await receiver.byId('joinNameForm').emit('submit');
  await until(() => receiver.byId('connectionStatus').textContent.includes('caller could not be verified'), 'forged offer');
  assert.equal(receiver.mediaSecrets.length, 0);
  assert.equal(caller.started, false);
  assert.equal(receiver.started, false);
});

test('a security code nonce that does not open the receiver commitment ends the call', async () => {
  const caller = makePage('https://example.test/remote-call.html');
  await until(() => !!caller.byId('jointLink').value, 'invitation');
  caller.byId('extraSecurity').checked = true;
  await caller.byId('extraSecurity').emit('change');
  const link = caller.byId('jointLink').value;
  const linkKey = new URLSearchParams(new URL(link).hash.slice(1)).get('link-key');
  const receiver = makePage(link);
  // Even a relay that knows the joint link cannot swap the committed nonce after seeing the caller nonce.
  receiver.transformSignal = signal => {
    if (signal.type !== 'JOIN') return signal;
    const forged = { ...signal, commitment: createHash('sha256').update(Buffer.alloc(32, 7)).digest('base64url') };
    return { ...forged, keyProof: joinProof(linkKey, forged) };
  };
  await receiver.byId('joinNameForm').emit('submit');
  await until(() => caller.byId('connectionStatus').textContent.includes('does not match its commitment'), 'mismatch');
  assert.equal(caller.byId('verificationPanel').hidden, true);
  assert.equal(caller.started, false);
  assert.equal(receiver.started, false);
});

test('an invitation with mismatched encryption is rejected without ending the caller', async () => {
  const caller = makePage('https://example.test/remote-call.html');
  await until(() => !!caller.byId('jointLink').value, 'invitation');
  const link = new URL(caller.byId('jointLink').value);
  link.hash = 'e2e=0&extra-security=0';
  const receiver = makePage(link.href);
  await receiver.byId('joinNameForm').emit('submit');
  await until(() => receiver.byId('connectionStatus').textContent.includes('settings changed'), 'rejection');
  assert.equal(caller.byId('copyJointLinkButton').disabled, false);
  assert.equal(caller.started, false);
  assert.equal(receiver.started, false);
});

test('an invitation with a changed extra-security setting is rejected', async () => {
  const caller = makePage('https://example.test/remote-call.html');
  await until(() => !!caller.byId('jointLink').value, 'invitation');
  caller.byId('extraSecurity').checked = true;
  await caller.byId('extraSecurity').emit('change');
  const link = new URL(caller.byId('jointLink').value);
  const linkKey = new URLSearchParams(link.hash.slice(1)).get('link-key');
  link.hash = new URLSearchParams({ e2e: '1', 'extra-security': '0', 'link-key': linkKey }).toString();
  const receiver = makePage(link.href);
  await receiver.byId('joinNameForm').emit('submit');
  await until(() => receiver.byId('connectionStatus').textContent.includes('settings changed'), 'rejection');
  assert.equal(caller.started, false);
  assert.equal(receiver.started, false);
});

test('turning encryption off also turns extra security off', async () => {
  const caller = makePage('https://example.test/remote-call.html');
  await until(() => !!caller.byId('jointLink').value, 'invitation');
  caller.byId('extraSecurity').checked = true;
  await caller.byId('extraSecurity').emit('change');
  caller.byId('encryptMedia').checked = false;
  await caller.byId('encryptMedia').emit('change');
  const settings = new URLSearchParams(new URL(caller.byId('jointLink').value).hash.slice(1));
  assert.equal(settings.get('e2e'), '0');
  assert.equal(settings.get('extra-security'), '0');
  assert.equal(caller.byId('extraSecurity').checked, false);
  assert.equal(caller.byId('extraSecurity').disabled, true);
});


test('a corrupt received video chunk stops only remote video and preserves the connected call', async () => {
  const caller = makePage('https://example.test/remote-call.html');
  await until(() => !!caller.byId('jointLink').value, 'invitation');
  const receiver = makePage(caller.byId('jointLink').value);
  await receiver.byId('joinNameForm').emit('submit');
  await until(() => caller.started && receiver.started, 'call');
  receiver.emitChannel('video', { type: 'remote-call:error', scope: 'receive', message: 'Video authentication failed' });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(receiver.streamFailures, [{ kind: 'video', message: 'Video authentication failed' }]);
  assert.equal(receiver.signals.some(signal => signal.type === 'STOP'), false);
  assert.equal(caller.signals.some(signal => signal.type === 'STOP'), false);
});


test('twenty acknowledged probes agree on a future start across different monotonic clock origins', async () => {
  const caller = makePage('https://example.test/remote-call.html', { clockOffset: 400000 });
  await until(() => !!caller.byId('jointLink').value, 'invitation');
  const receiver = makePage(caller.byId('jointLink').value, { clockOffset: 7200000 });
  await receiver.byId('joinNameForm').emit('submit');
  await until(() => caller.started && receiver.started, 'synchronized call');
  assert.equal(caller.signals.filter(signal => signal.type === 'CALL_LATENCY_TEST').length, 20);
  assert.equal(receiver.signals.filter(signal => signal.type === 'CALL_LATENCY_ACK').length, 20);
  const sync = caller.window.RemoteCallConnection.getSynchronization();
  assert.equal(sync.samples.length, 20);
  assert.notEqual(caller.mediaFrames.get('audio').init.clientId, caller.mediaFrames.get('video').init.clientId);
  assert.notEqual(receiver.mediaFrames.get('audio').init.clientId, receiver.mediaFrames.get('video').init.clientId);
  const sorted = [...sync.samples].sort((a, b) => a - b);
  assert.equal(sync.medianRTT, (sorted[9] + sorted[10]) / 2);
  assert.equal(sync.estimatedOneWayLatency, sync.medianRTT / 2);
  assert.ok(Math.abs((receiver.agreedStart - caller.agreedStart) - sync.clockOffset) < 0.01);
  assert.ok(Math.abs(sync.clockOffset - 6800000) < 100);
  assert.ok(caller.actualStart >= caller.agreedStart);
  assert.ok(receiver.actualStart >= receiver.agreedStart);
  for (const signal of [...caller.signals, ...receiver.signals].filter(signal => signal.type.startsWith('CALL_'))) {
    assert.match(signal.auth, /^[A-Za-z0-9_-]{43}$/);
  }
  assert.deepEqual(caller.errors, []);
  assert.deepEqual(receiver.errors, []);
});


// A time-zone change cannot affect synchronization when neither participant
// reads calendar time. Clock origins are independently offset, not time zones.
for (const direction of ['ahead', 'behind']) {
  test(`start alignment ignores calendar time with the callee clock origin 26 hours ${direction}`, async () => {
    const earlierOrigin = 400000;
    const laterOrigin = earlierOrigin + 26 * 60 * 60 * 1000;
    const callerOrigin = direction === 'ahead' ? earlierOrigin : laterOrigin;
    const calleeOrigin = direction === 'ahead' ? laterOrigin : earlierOrigin;
    const caller = makePage('https://example.test/remote-call.html', {
      clockOffset: callerOrigin, forbidCalendarClock: true
    });
    await until(() => !!caller.byId('jointLink').value, 'invitation');
    const callee = makePage(caller.byId('jointLink').value, {
      clockOffset: calleeOrigin, forbidCalendarClock: true
    });
    await callee.byId('joinNameForm').emit('submit');
    await until(() => caller.started && callee.started, 'call without calendar clock access');

    const callerSync = caller.window.RemoteCallConnection.getSynchronization();
    const calleeSync = callee.window.RemoteCallConnection.getSynchronization();
    assert.equal(callerSync.samples.length, 20);
    assert.equal(callerSync.localStartTime, calleeSync.peerStartTime);
    assert.equal(calleeSync.localStartTime, callerSync.peerStartTime);
    // Remove the artificial origins to compare both deadlines on the same clock.
    const deadlineSkew = (callee.agreedStart - calleeOrigin) - (caller.agreedStart - callerOrigin);
    const actualSkew = (callee.actualStart - calleeOrigin) - (caller.actualStart - callerOrigin);
    assert.ok(Math.abs(deadlineSkew) < 100, `Deadline skew: ${deadlineSkew} ms`);
    assert.ok(Math.abs(actualSkew) < 250, `Actual start skew: ${actualSkew} ms`);
    assert.ok(caller.actualStart >= caller.agreedStart);
    assert.ok(callee.actualStart >= callee.agreedStart);
    assert.deepEqual(caller.errors, []);
    assert.deepEqual(callee.errors, []);
  });
}

async function unencryptedPair() {
  const caller = makePage('https://example.test/remote-call.html');
  await until(() => !!caller.byId('jointLink').value, 'invitation');
  caller.byId('encryptMedia').checked = false;
  await caller.byId('encryptMedia').emit('change');
  return { caller, receiver: makePage(caller.byId('jointLink').value) };
}

test('a stale start proposal is rejected and a new proposal must be acknowledged', async () => {
  const { caller, receiver } = await unencryptedPair();
  let stale = false;
  receiver.transformSignal = signal => {
    if (signal.type !== 'CALL_START_PROPOSAL' || stale) return signal;
    stale = true;
    return { ...signal, callerStartTime: signal.callerStartTime - 4999, calleeStartTime: signal.calleeStartTime - 4999 };
  };
  await receiver.byId('joinNameForm').emit('submit');
  await until(() => caller.started && receiver.started, 'renegotiated call');
  const proposals = receiver.signals.filter(signal => signal.type === 'CALL_START_PROPOSAL');
  assert.equal(proposals.length, 2);
  assert.equal(caller.signals.filter(signal => signal.type === 'CALL_START_REJECT').length, 1);
  assert.equal(caller.signals.find(signal => signal.type === 'CALL_START_ACK').proposalId, proposals[1].proposalId);
});

for (const mismatch of ['id', 'index']) {
  test(`a latency ACK with the wrong ${mismatch} cannot unblock synchronization`, async () => {
    const { caller, receiver } = await unencryptedPair();
    receiver.transformSignal = signal => signal.type === 'CALL_LATENCY_ACK'
      ? { ...signal, [mismatch]: mismatch === 'id' ? 'another-measurement' : signal.index + 1 }
      : signal;
    await receiver.byId('joinNameForm').emit('submit');
    await until(() => caller.byId('connectionStatus').textContent.includes('probe 1/20'), 'probe ACK timeout');
    assert.equal(caller.window.RemoteCallConnection.getSynchronization().samples.length, 0);
    assert.equal(caller.started, false);
    assert.equal(receiver.started, false);
    assert.equal(caller.signals.some(signal => signal.type === 'CALL_CLOCK_SYNC'), false);
    assert.equal(caller.aborted, true);
    await until(() => receiver.stopped, 'remote cancellation');
  });
}

test('missing start confirmation aborts the caller instead of recording at an unconfirmed time', async () => {
  const { caller, receiver } = await unencryptedPair();
  receiver.transformSignal = signal => signal.type === 'CALL_START_CONFIRMED' ? null : signal;
  await receiver.byId('joinNameForm').emit('submit');
  await until(() => caller.byId('connectionStatus').textContent.includes('confirmation did not arrive'), 'confirmation timeout');
  assert.equal(caller.started, false);
  assert.equal(caller.aborted, true);
  await until(() => receiver.stopped, 'remote abort');
});

test('video congestion disables only video and audio congestion ends both participants with a reason', async () => {
  const { caller, receiver } = await unencryptedPair();
  await receiver.byId('joinNameForm').emit('submit');
  await until(() => caller.started && receiver.started, 'call');
  caller.emitChannel('video', { type: 'remote-call:congestion', action: 'disable', reductions: 2 });
  await until(() => receiver.videoDisabled, 'remote video disable');
  assert.equal(caller.outgoingVideoDisabled, true);
  assert.equal(caller.stopped, undefined);
  caller.emitChannel('audio', { type: 'remote-call:congestion', action: 'terminate', reductions: 2 });
  await until(() => receiver.stopped, 'audio congestion stop');
  assert.match(caller.signals.find(signal => signal.type === 'STOP').reason, /too slow/);
});

test('encoder adaptation notifies and restarts only the affected remote player', async () => {
  const { caller, receiver } = await unencryptedPair();
  await receiver.byId('joinNameForm').emit('submit');
  await until(() => caller.started && receiver.started, 'call');
  caller.emitChannel('audio', { type: 'remote-call:congestion', action: 'reduce', reductions: 1, generation: 1 });
  await until(() => receiver.restarts?.length === 1, 'audio restart');
  assert.equal(receiver.restarts[0].kind, 'audio');
  assert.equal(receiver.restarts[0].generation, 1);
  assert.equal(receiver.restarts[0].bitrate, 42880);
});


test('delivery averages render per stream from channel reports, including small chunks and an empty window', async () => {
  const { caller, receiver } = await unencryptedPair();
  await receiver.byId('joinNameForm').emit('submit');
  await until(() => caller.started && receiver.started, 'call');
  caller.emitChannel('audio', { type: 'remote-call:queue', deliverySampleCount: 3,
    averageChunkSizeBytes: 1.25 * 1048576, averageDeliveryLatencyMs: 200.4 });
  assert.equal(caller.byId('audioChunkDelivery').textContent, 'Audio: 1.25 MB / 200 ms');
  caller.emitChannel('video', { type: 'remote-call:queue', deliverySampleCount: 5,
    averageChunkSizeBytes: 10 * 1048576, averageDeliveryLatencyMs: 300.6 });
  assert.equal(caller.byId('videoChunkDelivery').textContent, 'Video: 10 MB / 301 ms');
  assert.equal(caller.byId('audioChunkDelivery').textContent, 'Audio: 1.25 MB / 200 ms');
  assert.equal(caller.window.RemoteCallConnection.getTransportDiagnostics().video.averageDeliveryLatencyMs, 300.6);
  caller.emitChannel('audio', { type: 'remote-call:queue', deliverySampleCount: 5,
    averageChunkSizeBytes: 4096, averageDeliveryLatencyMs: 0 });
  assert.equal(caller.byId('audioChunkDelivery').textContent, 'Audio: 0.00391 MB / 0 ms');
  caller.emitChannel('audio', { type: 'remote-call:queue', deliverySampleCount: 0,
    averageChunkSizeBytes: null, averageDeliveryLatencyMs: null });
  assert.equal(caller.byId('audioChunkDelivery').textContent, 'Audio: —');
  caller.emitChannel('audio', { type: 'remote-call:queue', deliverySampleCount: 5,
    averageChunkSizeBytes: NaN, averageDeliveryLatencyMs: 200 });
  assert.equal(caller.byId('audioChunkDelivery').textContent, 'Audio: —');
  assert.equal(caller.byId('videoChunkDelivery').textContent, 'Video: 10 MB / 301 ms');
  await caller.window.RemoteCallConnection.stopCall();
});
