class CreatePrivateUrlSuffixRequest {
    constructor(workspaceId, binaryId) {
        this.workspaceId = workspaceId;
        this.binaryId = binaryId;
    }
}

class JoinTransferGroupRequest {
    constructor(deviceId, publicKeyStr) {
        this.deviceId = deviceId;
        this.publicKeyStr = publicKeyStr;
    }

    static fromJsonString(jsonString) {
        const jsonObject = typeof jsonString === 'string' ? JSON.parse(jsonString) : jsonString;
        return new JoinTransferGroupRequest(
            jsonObject.deviceId,
            jsonObject.publicKeyStr
        );
    }
}

class DownloadProtectedBinaryRequest {
    constructor(suffix, exp, signature, binaryId, passwordHash) {
        this.suffix = suffix;
        this.exp = exp;
        this.signature = signature;
        this.binaryId = binaryId;
        this.passwordHash = passwordHash;
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

    async toTransferableString(pwd, salt) {
        const encryptedKey = await encryptPrivateKey(this.base64Key, this.base64IV, pwd, salt);
        return encodeToBase64UrlSafe(JSON.stringify({
            base64Key: encryptedKey,
            base64IV: this.base64IV
        }));
    }

    static async fromTransferableString(transferableString, password, salt) {
        const jsonString = decodeFromBase64UrlSafe(transferableString);
        const jsonObject = typeof jsonString === 'string' ? JSON.parse(jsonString) : jsonString;
        const decryptedKey = await decryptPrivateKey(jsonObject.base64Key, password, salt, jsonObject.base64IV);
        return new EncryptionContract(
            decryptedKey,
            jsonObject.base64IV
        );
    }
}

async function calculateSignatureSha256(inputString) {
    const encoder = new TextEncoder();
    const data = encoder.encode(inputString);
    const hashBuffer = await window.crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function calculateSha256(content) {
    const hashBuffer = await crypto.subtle.digest('SHA-256', content);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return btoa(String.fromCharCode.apply(null, hashArray));
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

async function generateAESKeyFromPassword(password, salt) {
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
        {name: "AES-GCM", length: 256},
        true,
        ["encrypt", "decrypt"]
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

async function generateEncryptionContract() {
    const key = await crypto.subtle.generateKey(
        {
            name: "AES-GCM",
            length: 256 // AES key length (256 bits)
        },
        true, // extractable key (you can export it)
        ["encrypt", "decrypt"] // allowed key usages
    ); // Generate AES-GCM key
    const iv = window.crypto.getRandomValues(new Uint8Array(12)); // Generate random 12-byte IV

    // Convert the key to a base64 string to allow sharing/storing
    const exportedKey = await crypto.subtle.exportKey("raw", key);
    return new EncryptionContract(arrayBufferToBase64(exportedKey), arrayBufferToBase64(iv));
}

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
        data: new Blob([new Uint8Array(encryptedContent)], {type: "application/octet-stream"}),
        dataBase64: arrayBufferToBase64(encryptedContent)
    }
}

async function encryptWithAESUsingContract(input /* ArrayBuffer */, encryptionContract) {
    // Convert base64-encoded key and IV back to ArrayBuffer
    const keyBuffer = base64ToArrayBuffer(encryptionContract.base64Key);
    const iv = base64ToArrayBuffer(encryptionContract.base64IV);

    // Import the AES key from the ArrayBuffer
    const key = await crypto.subtle.importKey(
        "raw",
        keyBuffer,
        {
            name: "AES-GCM",
            length: 256
        },
        false, // non-extractable (you don't need to export it again)
        ["encrypt", "decrypt"]
    );

    // Encrypt the input data
    return await window.crypto.subtle.encrypt(
        {
            name: "AES-GCM",
            iv: iv
        },
        key,
        input
    );
}

async function encryptBinaryChunk(input /* ArrayBuffer */, encryptionContract,
                                  requiredSize = MemoryBlock.MB_ENC, emptyByte = 0) {
    const encData = await encryptWithAESUsingContract(input, encryptionContract);
    const sizePrefix = bytesToArrayBuffer(intToBytes(encData.byteLength));
    const encDataWithSizePrefix = concatArrayBuffers([sizePrefix, encData]);

    if (encDataWithSizePrefix.byteLength > requiredSize) {
        alert("Encrypted block is too big!!!");
        return encDataWithSizePrefix;
    }

    if (encDataWithSizePrefix.byteLength === requiredSize) {
        return encDataWithSizePrefix;
    }

    const newBuffer = new ArrayBuffer(requiredSize);
    const newView = new Uint8Array(newBuffer);

    // Copy the original buffer's data into the new buffer
    const originalView = new Uint8Array(encDataWithSizePrefix);
    newView.set(originalView);

    // Fill the additional space with the empty byte
    newView.fill(emptyByte, encDataWithSizePrefix.byteLength);

    return newBuffer;
}

async function encryptSlicesWithAES(slices) {
    return await encryptWithAES(concatArrayBuffers(slices));
}

async function decryptBinaryChunk(arrayBuffer, encryptionContract, intSize = 4) {
    if (arrayBuffer.byteLength < intSize) {
        throw new Error("Buffer is too small to contain the length integer.");
    }
    // Extract the first 'intSize' bytes as an ArrayBuffer for the length
    const lengthBuffer = arrayBuffer.slice(0, intSize);
    const length = bytesToInt(lengthBuffer);

    // Ensure the length is valid
    if (length > arrayBuffer.byteLength - intSize) {
        throw new Error("Invalid length or buffer, it is too small for the given length.");
    }

    // Copy the next 'length' bytes from the buffer to a new ArrayBuffer
    const encDataBuffer = new ArrayBuffer(length);
    const newBufferView = new Uint8Array(encDataBuffer);
    const originalView = new Uint8Array(arrayBuffer);

    newBufferView.set(originalView.slice(intSize, intSize + length));

    return await decryptAESToArrayBuffer(encDataBuffer, encryptionContract.base64Key, encryptionContract.base64IV);
}

async function decryptAESToArrayBuffer(arrayBuffer, base64Key, base64IV) {
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

    try {
        return await crypto.subtle.decrypt(
            {
                name: "AES-GCM",
                iv: iv
            },
            key,
            arrayBuffer
        );
    } catch (error) {
        console.error("Error during decryption:", error);
    }
}

async function decryptChunkByChunk(slices, encryptionContract) {
    const decChunks = [];

    const encryptedContent = concatArrayBuffers(slices);
    if (encryptedContent.byteLength < MemoryBlock.MB_ENC) {
        throw new Error("Buffer is too small to contain encrypted block.");
    }
    const encChunks = splitArrayBuffer(encryptedContent, MemoryBlock.MB_ENC);

    for (let i = 0; i < encChunks.length; i++) {
        const decChunk = await decryptBinaryChunk(encChunks[i], encryptionContract);
        decChunks.push(decChunk);
    }
    return new Blob(decChunks, {type: 'application/octet-stream'});
}

async function decryptAES(slices, base64Key, base64IV, contentType = "application/octet-stream") {
    // Convert slices to ArrayBuffer
    const encryptedContent = concatArrayBuffers(slices);

    // Perform decryption
    const decryptedContent = await decryptAESToArrayBuffer(encryptedContent, base64Key, base64IV)

    // Convert decrypted ArrayBuffer back to Blob for download or further use
    return new Blob([new Uint8Array(decryptedContent)], {type: contentType});
}

async function encryptPrivateKey(base64Key, base64IV, pwd, salt) {
    const aesKey = base64ToArrayBuffer(base64Key);
    const iv = base64ToArrayBuffer(base64IV);

    const key = await generateAESKeyFromPassword(pwd, salt);
    const encryptedKey = await window.crypto.subtle.encrypt(
        {
            name: "AES-GCM",
            iv: iv
        },
        key,
        aesKey
    );
    return arrayBufferToBase64(encryptedKey);
}

async function decryptPrivateKey(base64EncryptedKey, pwd, salt, base64IV) {
    const encryptedKey = base64ToArrayBuffer(base64EncryptedKey);
    const iv = base64ToArrayBuffer(base64IV);
    const key = await generateAESKeyFromPassword(pwd, salt);

    // Decrypt the private key
    const decryptedKey = await window.crypto.subtle.decrypt(
        {
            name: "AES-GCM",
            iv: iv
        },
        key,
        encryptedKey
    );

    return arrayBufferToBase64(decryptedKey);
}

//======================================================================================================================
//==================== Asymmetric password based encryption ============================================================
async function generateRSAKeyPair() {
    return await crypto.subtle.generateKey(
        {
            name: "RSA-OAEP", // Use RSA for encryption/decryption
            modulusLength: 2048,
            publicExponent: new Uint8Array([0x01, 0x00, 0x01]),
            hash: "SHA-256",
        },
        true,
        ["encrypt", "decrypt"]
    );
}

async function encryptWithPublicKey(publicKey, data) {
    const encodedData = new TextEncoder().encode(data);
    const encrypted = await crypto.subtle.encrypt(
        {name: "RSA-OAEP"},
        publicKey,
        encodedData
    );
    return btoa(String.fromCharCode(...new Uint8Array(encrypted))); // Return encrypted data as Base64
}

async function decryptWithPrivateKey(privateKey, encryptedBase64) {
    const encryptedData = Uint8Array.from(
        atob(encryptedBase64),
        (c) => c.charCodeAt(0)
    );
    const decrypted = await crypto.subtle.decrypt(
        {name: "RSA-OAEP"},
        privateKey,
        encryptedData
    );
    return new TextDecoder().decode(decrypted); // Return decrypted string
}

async function exportPublicKey(key) {
    const exported = await crypto.subtle.exportKey("spki", key);
    return btoa(String.fromCharCode(...new Uint8Array(exported))); // Return Base64 encoded public key
}

async function importPublicKeyFromString(publicKeyString) {
    // Decode the Base64 string to a binary format
    const binaryDer = Uint8Array.from(atob(publicKeyString), (c) => c.charCodeAt(0));

    // Import the binary data as an RSA public key
    return crypto.subtle.importKey(
        "spki", // Key format
        binaryDer.buffer, // Key data
        {
            name: "RSA-OAEP",
            hash: "SHA-256", // Must match the hash used during key generation
        },
        true, // Key can be exported again
        ["encrypt"] // Usages for the key
    );
}

//======================================================================================================================