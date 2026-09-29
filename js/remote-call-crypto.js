(() => {
  'use strict';

  const subtle = crypto.subtle;
  const encoder = new TextEncoder();
  const protocol = 'REMOTE_CALL_V7';

  function bytes(...parts) {
    const length = parts.reduce((sum, part) => sum + part.length, 0);
    const result = new Uint8Array(length);
    let offset = 0;
    for (const part of parts) {
      result.set(part, offset);
      offset += part.length;
    }
    return result;
  }

  function encode(value) {
    return btoa(String.fromCharCode(...value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function decodePublicKey(value) {
    if (!/^[A-Za-z0-9_-]{87}$/.test(value || '')) throw new Error('Missing or invalid call public key');
    const raw = Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='), c => c.charCodeAt(0));
    if (raw.length !== 65 || raw[0] !== 4) throw new Error('Invalid call public key');
    return raw;
  }

  async function generateKeyPair() {
    const pair = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
    const publicKey = new Uint8Array(await subtle.exportKey('raw', pair.publicKey));
    return { privateKey: pair.privateKey, publicKey };
  }

  async function deriveSession(pair, callerPublic, receiverPublic, role) {
    if (!['caller', 'receiver'].includes(role)) throw new Error('Invalid call role');
    const peerPublic = role === 'caller' ? receiverPublic : callerPublic;
    const imported = await subtle.importKey('raw', peerPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const agreement = await subtle.deriveBits({ name: 'ECDH', public: imported }, pair.privateKey, 256);
    const transcript = bytes(encoder.encode(protocol), callerPublic, receiverPublic);
    const salt = await subtle.digest('SHA-256', transcript);
    const material = await subtle.importKey('raw', agreement, 'HKDF', false, ['deriveBits', 'deriveKey']);
    const mediaSecret = new Uint8Array(await subtle.deriveBits({
      name: 'HKDF', hash: 'SHA-256', salt, info: encoder.encode('remote-call-v7/media-secret')
    }, material, 256));
    const controlKey = await subtle.deriveKey({
      name: 'HKDF', hash: 'SHA-256', salt, info: encoder.encode('remote-call-v7/control')
    }, material, { name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign', 'verify']);
    const digest = new Uint8Array(await subtle.sign('HMAC', controlKey,
      bytes(encoder.encode('remote-call-v7/verification'), transcript)));
    const number = ((digest[0] * 0x1000000 + digest[1] * 0x10000 + digest[2] * 0x100 + digest[3]) % 100000000)
      .toString().padStart(8, '0');
    return { mediaSecret, controlKey, verificationCode: `${number.slice(0, 4)} ${number.slice(4)}` };
  }

  function unsigned(message) {
    const { auth, ...value } = message;
    return value;
  }

  async function signSignal(key, message) {
    const data = encoder.encode(JSON.stringify(unsigned(message)));
    return encode(new Uint8Array(await subtle.sign('HMAC', key, data)));
  }

  async function verifySignal(key, message) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(message?.auth || '')) return false;
    const tag = Uint8Array.from(atob(message.auth.replace(/-/g, '+').replace(/_/g, '/') + '='), c => c.charCodeAt(0));
    return subtle.verify('HMAC', key, tag, encoder.encode(JSON.stringify(unsigned(message))));
  }

  const api = { encode, decodePublicKey, generateKeyPair, deriveSession, signSignal, verifySignal };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.RemoteCallCrypto = api;
})();
