const test = require('node:test');
const assert = require('node:assert/strict');

const callCrypto = require('../js/remote-call-crypto.js');

test('two call participants derive the same media secret and verification code', async () => {
  const caller = await callCrypto.generateKeyPair();
  const receiver = await callCrypto.generateKeyPair();
  assert.equal(caller.privateKey.extractable, false);
  assert.equal(receiver.privateKey.extractable, false);

  const publicInvite = callCrypto.encode(caller.publicKey);
  assert.equal(callCrypto.decodePublicKey(publicInvite).length, 65);
  assert.equal(publicInvite.length, 87);

  const a = await callCrypto.deriveSession(caller, caller.publicKey, receiver.publicKey, 'caller');
  const b = await callCrypto.deriveSession(receiver, caller.publicKey, receiver.publicKey, 'receiver');
  assert.deepEqual(a.mediaSecret, b.mediaSecret);
  assert.match(a.verificationCode, /^\d{4} \d{4}$/);
  assert.equal(a.verificationCode, b.verificationCode);

  const signal = { protocol: 'REMOTE_CALL_V7', type: 'START', videoAlias: 'video' };
  signal.auth = await callCrypto.signSignal(a.controlKey, signal);
  assert.equal(await callCrypto.verifySignal(b.controlKey, signal), true);
  assert.equal(await callCrypto.verifySignal(b.controlKey, { ...signal, videoAlias: 'attacker' }), false);
});

test('a substituted public key cannot authenticate the original participant', async () => {
  const caller = await callCrypto.generateKeyPair();
  const receiver = await callCrypto.generateKeyPair();
  const attacker = await callCrypto.generateKeyPair();
  const real = await callCrypto.deriveSession(receiver, caller.publicKey, receiver.publicKey, 'receiver');
  const substituted = await callCrypto.deriveSession(caller, caller.publicKey, attacker.publicKey, 'caller');
  const tag = await callCrypto.signSignal(substituted.controlKey, { protocol: 'REMOTE_CALL_V7', type: 'VERIFY' });
  assert.equal(await callCrypto.verifySignal(real.controlKey, { protocol: 'REMOTE_CALL_V7', type: 'VERIFY', auth: tag }), false);
  assert.notDeepEqual(real.mediaSecret, substituted.mediaSecret);
});

test('malformed invitation public keys are rejected', () => {
  assert.throws(() => callCrypto.decodePublicKey('not-a-public-key'));
  const bad = new Uint8Array(65);
  assert.throws(() => callCrypto.decodePublicKey(callCrypto.encode(bad)));
});
