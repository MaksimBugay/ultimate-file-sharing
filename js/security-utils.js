async function generateKeyFromPassword(password) {
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
        "raw",
        encoder.encode(password),
        {name: "PBKDF2"},
        false,
        ["deriveKey"]
    );

    const salt = crypto.getRandomValues(new Uint8Array(16)); // Use a constant salt if you need the same key every time
    return await crypto.subtle.deriveKey(
        {
            name: "PBKDF2",
            salt: salt,
            iterations: 100000,
            hash: "SHA-256"
        },
        keyMaterial,
        {name: "HMAC", hash: "SHA-256", length: 256},
        true,
        ["sign", "verify"]
    );
}

async function verifySignature(key, data, signature) {
    // Convert the data and signature to ArrayBuffer
    const dataArrayBuffer = new TextEncoder().encode(data);
    const signatureArrayBuffer = urlSafeBase64ToArrayBuffer(signature);

    // Verify the signature
    return await crypto.subtle.verify(
        "HMAC",
        key,
        signatureArrayBuffer,
        dataArrayBuffer
    );
}


async function signString(key, message) {
    const encoder = new TextEncoder();
    const data = encoder.encode(message);

    return await crypto.subtle.sign(
        "HMAC",
        key,
        data
    );
}

function arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
}

function arrayBufferToUrlSafeBase64(buffer) {
    return arrayBufferToBase64(buffer)
        .replace(/\+/g, '-') // Replace + with -
        .replace(/\//g, '_') // Replace / with _
        .replace(/=+$/, ''); // Remove trailing =
}

function base64ToArrayBuffer(base64) {
    const binary_string = window.atob(base64);
    const len = binary_string.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binary_string.charCodeAt(i);
    }
    return bytes.buffer;
}

function urlSafeBase64ToArrayBuffer(urlSafeBase64) {
    const base64 = urlSafeBase64
        .replace(/-/g, '+') // Replace - with +
        .replace(/_/g, '/'); // Replace _ with /

    // Add the correct padding at the end of the base64 string
    const paddedBase64 = base64.padEnd(base64.length + (4 - (base64.length % 4)) % 4, '=');

    return base64ToArrayBuffer(paddedBase64);
}