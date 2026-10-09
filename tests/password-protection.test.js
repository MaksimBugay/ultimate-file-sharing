const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const sources = ['../js/common-utils.js', '../js/security-utils.js']
  .map(file => fs.readFileSync(require.resolve(file), 'utf8'))
  .join('\n');

function page() {
  const context = vm.createContext({
    crypto: webcrypto, TextEncoder, TextDecoder, Uint8Array, Uint32Array, ArrayBuffer, DataView, Blob,
    btoa, atob, console, window: { crypto: webcrypto, btoa, atob },
    // Security-relevant values must never come from Math.random.
    Math: Object.assign(Object.create(Math), { random: () => { throw new Error('Math.random used'); } })
  });
  vm.runInContext(sources, context);
  return context;
}

const salt = 'workspace-fingerprint';

async function protectedContract(context, password, version) {
  return vm.runInContext(`(async () => {
    const contract = await generateEncryptionContract();
    return contract.toTransferableString(${JSON.stringify(password)}, stringToByteArray(${JSON.stringify(salt)}),
      ${JSON.stringify(version)});
  })()`, context);
}

const passwordHash = (context, password, saltValue, contract) => vm.runInContext(
  `calculatePasswordHash(${JSON.stringify(password)}, stringToByteArray(${JSON.stringify(saltValue)}),
    ${JSON.stringify(contract)})`, context);

const sha256 = (context, password) => vm.runInContext(
  `calculateSha256(stringToArrayBuffer(${JSON.stringify(password)}))`, context);

test('generated passwords use the cryptographic generator and every character class', () => {
  const context = page();
  const passwords = Array.from({ length: 50 }, () => vm.runInContext('generateStrongPassword(32)', context));
  for (const password of passwords) {
    assert.equal(password.length, 32);
    assert.match(password, /[A-Z]/);
    assert.match(password, /[a-z]/);
    assert.match(password, /[0-9]/);
    assert.match(password, /[^A-Za-z0-9]/);
  }
  assert.equal(new Set(passwords).size, passwords.length);
});

test('new protected files get a salted verifier instead of the plain SHA-256 of the password', async () => {
  const context = page();
  const contract = await protectedContract(context, 'secret', vm.runInContext('PASSWORD_VERIFIER_VERSION', context));
  const verifier = await passwordHash(context, 'secret', salt, contract);
  assert.match(verifier, /^[A-Za-z0-9+/]{43}=$/, 'same shape as the SHA-256 the server stored before');
  assert.notEqual(verifier, await sha256(context, 'secret'));
  assert.equal(await passwordHash(page(), 'secret', salt, contract), verifier, 'the download page derives the same value');
  assert.notEqual(await passwordHash(context, 'secret', 'other-workspace', contract), verifier);
  assert.notEqual(await passwordHash(context, 'Secret', salt, contract), verifier);
});

test('files uploaded before the verifier keep the SHA-256 password hash', async () => {
  const context = page();
  const legacyContract = await protectedContract(context, 'secret', null);
  assert.equal(await passwordHash(context, 'secret', salt, legacyContract), await sha256(context, 'secret'));
  assert.equal(await passwordHash(context, 'secret', salt, null), await sha256(context, 'secret'));
  assert.equal(await passwordHash(context, 'secret', salt, 'not-a-contract'), await sha256(context, 'secret'));
});

test('a versioned contract still opens with the password on older and newer pages', async () => {
  const context = page();
  const contract = await protectedContract(context, 'secret', 2);
  const opened = await vm.runInContext(`EncryptionContract.fromTransferableString(${JSON.stringify(contract)},
    'secret', stringToByteArray(${JSON.stringify(salt)}))`, context);
  assert.equal(Buffer.from(opened.base64Key, 'base64').length, 32);
  await assert.rejects(vm.runInContext(`EncryptionContract.fromTransferableString(${JSON.stringify(contract)},
    'wrong', stringToByteArray(${JSON.stringify(salt)}))`, context));
});
