class CreatePrivateUrlSuffixRequest {
    constructor(workspaceId, binaryId) {
        this.workspaceId = workspaceId;
        this.binaryId = binaryId;
    }
}

class DownloadProtectedBinaryRequest {
    constructor(suffix, exp, signature, binaryId) {
        this.suffix = suffix;
        this.exp = exp;
        this.signature = signature;
        this.binaryId = binaryId;
    }

    toSkipSignatureJSON() {
        return {
            suffix: this.suffix,
            exp: this.exp,
        };
    }

    static fromJsonString(jsonString) {
        const jsonObject = typeof jsonString === 'string' ? JSON.parse(jsonString) : jsonString;
        return new DownloadProtectedBinaryRequest(
            jsonObject.suffix,
            jsonObject.exp,
            jsonObject.signature,
            jsonObject.binaryId
        );
    }
}

class EncryptionContract {
    constructor(base64Key, base64IV) {
        this.base64Key = base64Key;
        this.base64IV = base64IV;
    }

    toTransferableString() {
        return encodeToBase64UrlSafe(JSON.stringify(this));
    }

    static fromTransferableString(transferableString) {
        const jsonString = decodeFromBase64UrlSafe(transferableString);
        const jsonObject = typeof jsonString === 'string' ? JSON.parse(jsonString) : jsonString;
        return new EncryptionContract(
            jsonObject.base64Key,
            jsonObject.base64IV
        );
    }
}

async function generateKeyFromPassword(password, salt) {
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
        "raw",
        encoder.encode(password),
        {name: "PBKDF2"},
        false,
        ["deriveKey"]
    );

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

async function verifySignatureWithKey(key, data, signature) {
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

async function makeSignature(pwd, salt, payload) {
    const key = await generateKeyFromPassword(pwd, salt);
    return await signString(key, payload);
}

async function verifySignature(pwd, salt, dataStr, signatureBase64) {
    const key = await generateKeyFromPassword(pwd, salt);
    return await verifySignatureWithKey(key, dataStr, signatureBase64);
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

async function createPrivateUrlSuffix(workspaceId, binaryId) {
    const response = await fetch(PushcaClient.clusterBaseUrl + '/binary/private/create-url-suffix', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(new CreatePrivateUrlSuffixRequest(workspaceId, binaryId))
    });
    if (!response.ok) {
        console.error('Failed create private URL suffix request ' + response.statusText);
        return null;
    }
    return response.text();
}

function byteArrayToBase64(byteArray) {
    let binaryString = '';
    for (let i = 0; i < byteArray.length; i++) {
        binaryString += String.fromCharCode(byteArray[i]);
    }
    return window.btoa(binaryString);
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

//======================================Encryption/Decryption===========================================================
async function encryptWithAES(input/*ArrayBuffer*/) {
    const key = await crypto.subtle.generateKey(
        {
            name: "AES-GCM",
            length: 256 // AES key length (256 bits)
        },
        true, // extractable key (you can export it)
        ["encrypt", "decrypt"] // allowed key usages
    ); // Generate AES-GCM key
    const iv = window.crypto.getRandomValues(new Uint8Array(12)); // Generate random 12-byte IV

    // Encrypt the file content
    const encryptedContent = await window.crypto.subtle.encrypt(
        {
            name: "AES-GCM",
            iv: iv
        },
        key,
        input
    );

    // Convert the key to a base64 string to allow sharing/storing
    const exportedKey = await crypto.subtle.exportKey("raw", key);
    return {
        encryptionContract: new EncryptionContract(arrayBufferToBase64(exportedKey), arrayBufferToBase64(iv)),
        data: new Blob([new Uint8Array(encryptedContent)], {type: "application/octet-stream"})
    }
}

async function encryptSlicesWithAES(slices){
    return await encryptWithAES(concatArrayBuffers(slices));
}
async function decryptAES(slices, base64Key, base64IV) {
    const key = await crypto.subtle.importKey(
        "raw",
        base64ToArrayBuffer(base64Key),
        {
            name: "AES-GCM"
        },
        false, // non-extractable
        ["decrypt"]
    );

    const iv = base64ToArrayBuffer(base64IV);

    // Convert slices to ArrayBuffer
    const encryptedContent = concatArrayBuffers(slices);

    // Perform decryption
    const decryptedContent = await crypto.subtle.decrypt(
        {
            name: "AES-GCM",
            iv: iv
        },
        key,
        encryptedContent
    );

    // Convert decrypted ArrayBuffer back to Blob for download or further use
    return new Blob([new Uint8Array(decryptedContent)], {type: "application/octet-stream"});
}
//======================================================================================================================