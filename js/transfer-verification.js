// Optional receiver verification (2FA) for direct transfers.
// The sender commits to a nonce before the receiver picks its group credentials and nonce, then reveals it;
// both sides derive the same 8-digit code only if no relay replaced either side, and a relay gets one guess
// instead of an offline search. After the sender confirms a code, the derived key pairs the two pages so
// later transfers between them are authenticated with a proof instead of a new code.
const TransferVerification = (() => {
    const encoder = new TextEncoder();
    const PENDING_LIMIT = 32;
    const revealPrefix = 'transfer-verification::reveal::';
    const pendingReceipts = new Map(); // binary ID -> receiver state awaiting the sender nonce
    const pairedSenders = new Map(); // sender public key -> key of the last displayed code
    const pairedReceivers = new Map(); // receiver client hash code -> key of the last confirmed code

    const toBase64Url = bytes => btoa(String.fromCharCode(...bytes))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const fromBase64Url = value => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='),
        character => character.charCodeAt(0));
    // Nonces, commitments and proofs are 32 bytes in unpadded base64url.
    const isKey = value => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);

    function randomKey() {
        return toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
    }

    async function commit(nonce) {
        return toBase64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', fromBase64Url(nonce))));
    }

    // Only the two pages know the group credentials: they are RSA-encrypted to the sender public key.
    async function sessionKey(name, pwd) {
        const material = await crypto.subtle.digest('SHA-256',
            encoder.encode(JSON.stringify(['transfer-v1/key', name, pwd])));
        return crypto.subtle.importKey('raw', material, {name: 'HMAC', hash: 'SHA-256'}, false, ['sign', 'verify']);
    }

    async function tag(key, parts) {
        return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(JSON.stringify(parts))));
    }

    async function code(key, publicKeyStr, binaryId, receiverNonce, senderNonce) {
        const digest = await tag(key, ['transfer-v1/verification', publicKeyStr, binaryId, receiverNonce, senderNonce]);
        const number = ((digest[0] * 0x1000000 + digest[1] * 0x10000 + digest[2] * 0x100 + digest[3]) % 100000000)
            .toString().padStart(8, '0');
        return `${number.slice(0, 4)} ${number.slice(4)}`;
    }

    const proofParts = (publicKeyStr, binaryId, encryptedResult) =>
        ['transfer-v1/proof', publicKeyStr, binaryId, encryptedResult];

    // Receiver: extra response fields when the request asks for verification.
    async function receiverFields(request, name, pwd, encryptedResult) {
        if (!isKey(request.commitment) || typeof request.binaryId !== 'string') return {};
        const nonce = randomKey();
        pendingReceipts.set(request.binaryId, {
            commitment: request.commitment, nonce, publicKeyStr: request.publicKeyStr, key: await sessionKey(name, pwd)
        });
        while (pendingReceipts.size > PENDING_LIMIT) pendingReceipts.delete(pendingReceipts.keys().next().value);
        const paired = pairedSenders.get(request.publicKeyStr);
        return {
            nonce,
            ...(paired ? {proof: toBase64Url(await tag(paired, proofParts(request.publicKeyStr, request.binaryId, encryptedResult)))} : {})
        };
    }

    // Receiver: the code to display once the sender reveals a nonce matching its commitment, otherwise null.
    async function receiverCode(message) {
        if (typeof message !== 'string' || !message.startsWith(revealPrefix)) return null;
        let reveal;
        try {
            reveal = JSON.parse(message.slice(revealPrefix.length));
        } catch {
            return null;
        }
        const pending = pendingReceipts.get(reveal?.binaryId);
        if (!pending || !isKey(reveal.nonce) || await commit(reveal.nonce) !== pending.commitment) return null;
        pendingReceipts.delete(reveal.binaryId);
        pairedSenders.set(pending.publicKeyStr, pending.key);
        return code(pending.key, pending.publicKeyStr, reveal.binaryId, pending.nonce, reveal.nonce);
    }

    function revealMessage(binaryId, senderNonce) {
        return `${revealPrefix}${JSON.stringify({binaryId, nonce: senderNonce})}`;
    }

    // Sender: {paired: true} when a previously confirmed receiver proved itself; {code, confirm()} when a new
    // code must be compared; null when the receiver page does not support verification.
    async function checkReceiver(receiverId, binaryId, senderNonce, response) {
        const paired = pairedReceivers.get(receiverId);
        if (paired && isKey(response.proof) && await crypto.subtle.verify('HMAC', paired, fromBase64Url(response.proof),
            encoder.encode(JSON.stringify(proofParts(response.publicKeyStr, binaryId, response.encryptedResult))))) {
            return {paired: true};
        }
        if (!isKey(response.nonce)) return null;
        const key = await sessionKey(response.name, response.pwd);
        return {
            code: await code(key, response.publicKeyStr, binaryId, response.nonce, senderNonce),
            confirm: () => pairedReceivers.set(receiverId, key)
        };
    }

    return {revealPrefix, randomKey, commit, receiverFields, receiverCode, revealMessage, checkReceiver};
})();
