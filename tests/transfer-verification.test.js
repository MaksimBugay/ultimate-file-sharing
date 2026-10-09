const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const source = fs.readFileSync(require.resolve('../js/transfer-verification.js'), 'utf8');

// Each page (sender, receiver or relay) gets its own module state.
function page() {
  const context = vm.createContext({ crypto: webcrypto, TextEncoder, Uint8Array, btoa, atob, JSON });
  vm.runInContext(source, context);
  return vm.runInContext('TransferVerification', context);
}

let nextBinary = 0;

// One handshake as transfer-commons and gateway-server perform it, with the relay able to alter messages.
async function handshake(sender, receiver, { receiverId = 'receiver', publicKeyStr = 'sender-public-key',
  credentials = { name: 'group', pwd: 'password' }, alterResponse = response => response } = {}) {
  const binaryId = `binary-${++nextBinary}`;
  const senderNonce = sender.randomKey();
  const request = { binaryId, publicKeyStr, commitment: await sender.commit(senderNonce) };
  const encryptedResult = `encrypted:${credentials.name}`;
  const fields = await receiver.receiverFields(request, credentials.name, credentials.pwd, encryptedResult);
  const response = alterResponse({ ...credentials, publicKeyStr, encryptedResult, ...fields });
  const check = await sender.checkReceiver(receiverId, binaryId, senderNonce, response);
  const receiverCode = check?.code ? await receiver.receiverCode(sender.revealMessage(binaryId, senderNonce)) : null;
  return { check, receiverCode, binaryId, senderNonce };
}

test('sender and receiver derive the same 8-digit code', async () => {
  const sender = page();
  const receiver = page();
  const { check, receiverCode } = await handshake(sender, receiver);
  assert.match(check.code, /^\d{4} \d{4}$/);
  assert.equal(receiverCode, check.code);
});

test('a confirmed receiver is paired and later transfers need no new code', async () => {
  const sender = page();
  const receiver = page();
  const first = await handshake(sender, receiver);
  first.check.confirm();
  const second = await handshake(sender, receiver, { credentials: { name: 'next', pwd: 'other' } });
  assert.deepEqual({ ...second.check }, { paired: true });
});

test('a code the sender did not confirm is asked again on the next transfer', async () => {
  const sender = page();
  const receiver = page();
  await handshake(sender, receiver);
  const second = await handshake(sender, receiver);
  assert.match(second.check.code, /^\d{4} \d{4}$/);
});

test('a relay with its own credentials on each side produces different codes', async () => {
  const sender = page();
  const receiver = page();
  const relayAsReceiver = page();
  const relayAsSender = page();
  const toSender = await handshake(sender, relayAsReceiver, { credentials: { name: 'relay-a', pwd: 'a' } });
  const toReceiver = await handshake(relayAsSender, receiver, {
    publicKeyStr: 'relay-public-key', credentials: { name: 'relay-b', pwd: 'b' }
  });
  assert.notEqual(toSender.check.code, toReceiver.receiverCode);
});

test('a paired sender does not accept a proof from a relay that lacks the pairing key', async () => {
  const sender = page();
  const receiver = page();
  (await handshake(sender, receiver)).check.confirm();
  const relay = page();
  const { check } = await handshake(sender, relay, {
    alterResponse: response => ({ ...response, proof: 'A'.repeat(43) })
  });
  assert.equal(check.paired, undefined);
  assert.match(check.code, /^\d{4} \d{4}$/);
});

test('the receiver shows no code for a nonce that does not open the commitment', async () => {
  const sender = page();
  const receiver = page();
  const binaryId = 'binary-commitment';
  const committed = sender.randomKey();
  await receiver.receiverFields({ binaryId, publicKeyStr: 'key', commitment: await sender.commit(committed) },
    'group', 'password', 'encrypted');
  assert.equal(await receiver.receiverCode(sender.revealMessage(binaryId, sender.randomKey())), null);
  assert.equal(await receiver.receiverCode('unrelated message'), null);
  assert.equal(await receiver.receiverCode(`${receiver.revealPrefix}{not json`), null);
  assert.match(await receiver.receiverCode(sender.revealMessage(binaryId, committed)), /^\d{4} \d{4}$/);
  assert.equal(await receiver.receiverCode(sender.revealMessage(binaryId, committed)), null, 'a reveal is used once');
});

test('requests without a commitment get no verification fields', async () => {
  const receiver = page();
  assert.deepEqual({ ...await receiver.receiverFields({ binaryId: 'b', publicKeyStr: 'k' }, 'g', 'p', 'e') }, {});
});

test('a sender requiring verification rejects a receiver page that does not support it', async () => {
  const sender = page();
  const { check } = await handshake(sender, page(), {
    alterResponse: ({ nonce, proof, ...response }) => response
  });
  assert.equal(check, null);
});
