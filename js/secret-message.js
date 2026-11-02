/**
 * Compress text into a ZIP containing message.txt, entirely in the browser.
 * Load js/jszip.min.js before calling these helpers.
 * @param {string} input
 * @returns {Promise<Uint8Array>} ZIP archive bytes (DEFLATE compressed).
 */
async function zipText(input) {
    if (typeof input !== 'string') {
        throw new TypeError('zipText expects a string');
    }
    if (typeof JSZip === 'undefined') {
        throw new Error('Load js/jszip.min.js before using zipText');
    }
    const zip = new JSZip();
    zip.file('message.txt', input);
    return zip.generateAsync({type: 'uint8array', compression: 'DEFLATE'});
}

/**
 * Read UTF-8 text from message.txt in a ZIP produced by zipText.
 * Rejects invalid archives, failed CRC checks, and missing message.txt entries.
 * @param {Uint8Array|ArrayBuffer} zipBytes
 * @returns {Promise<string>}
 */
async function unZipText(zipBytes) {
    if (!(zipBytes instanceof Uint8Array) && !(zipBytes instanceof ArrayBuffer)) {
        throw new TypeError('unZipText expects a Uint8Array or ArrayBuffer');
    }
    if (typeof JSZip === 'undefined') {
        throw new Error('Load js/jszip.min.js before using unZipText');
    }
    const zip = await JSZip.loadAsync(zipBytes, {checkCRC32: true});
    const message = zip.file('message.txt');
    if (!message) {
        throw new Error('ZIP archive does not contain message.txt');
    }
    return message.async('string');
}

/**
 * Encrypt ZIP bytes using security-utils.js and browser Web Crypto (HTTPS/localhost).
 * The UTF-8 workspace ID is the PBKDF2 salt; each encryption uses a fresh IV.
 * Wire format: version (1 byte, currently 1), IV (12 bytes), ciphertext + GCM tag.
 * @param {Uint8Array|ArrayBuffer} zipBytes
 * @param {string} pwd Nonempty password, used verbatim.
 * @param {string} workspaceId Nonempty workspace ID, used verbatim as the salt.
 * @returns {Promise<Uint8Array>}
 */
async function encryptZipBytes(zipBytes, pwd, workspaceId) {
    if (!(zipBytes instanceof Uint8Array) && !(zipBytes instanceof ArrayBuffer)) {
        throw new TypeError('encryptZipBytes expects a Uint8Array or ArrayBuffer');
    }
    if (typeof pwd !== 'string' || pwd.length === 0 ||
        typeof workspaceId !== 'string' || workspaceId.length === 0) {
        throw new TypeError('Password and workspace ID must be nonempty strings');
    }
    const key = await generateAESKeyFromPassword(pwd, new TextEncoder().encode(workspaceId));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const contract = new EncryptionContract(
        arrayBufferToBase64(await crypto.subtle.exportKey('raw', key)),
        arrayBufferToBase64(iv)
    );
    const ciphertext = await encryptWithAESUsingContract(zipBytes, contract);
    const encryptedBytes = new Uint8Array(1 + iv.length + ciphertext.byteLength);
    encryptedBytes[0] = 1;
    encryptedBytes.set(iv, 1);
    encryptedBytes.set(new Uint8Array(ciphertext), 13);
    return encryptedBytes;
}

/**
 * Decrypt bytes produced by encryptZipBytes using the same password and workspace ID.
 * Requires security-utils.js. Rejects malformed data and authentication failures.
 * @param {Uint8Array|ArrayBuffer} encryptedBytes
 * @param {string} pwd
 * @param {string} workspaceId
 * @returns {Promise<Uint8Array>} Original ZIP bytes, ready for unZipText.
 */
async function decryptZipBytes(encryptedBytes, pwd, workspaceId) {
    if (!(encryptedBytes instanceof Uint8Array) && !(encryptedBytes instanceof ArrayBuffer)) {
        throw new TypeError('decryptZipBytes expects a Uint8Array or ArrayBuffer');
    }
    if (typeof pwd !== 'string' || pwd.length === 0 ||
        typeof workspaceId !== 'string' || workspaceId.length === 0) {
        throw new TypeError('Password and workspace ID must be nonempty strings');
    }
    // Copy the input so it cannot change while the password key is being derived.
    const bytes = new Uint8Array(encryptedBytes).slice();
    // Version + 12-byte IV + 16-byte authentication tag (even for empty plaintext).
    if (bytes.length < 29 || bytes[0] !== 1) {
        throw new Error('Invalid or unsupported encrypted ZIP format');
    }
    const key = await generateAESKeyFromPassword(pwd, new TextEncoder().encode(workspaceId));
    const decrypted = await decryptAESToArrayBuffer(
        bytes.subarray(13),
        arrayBufferToBase64(await crypto.subtle.exportKey('raw', key)),
        arrayBufferToBase64(bytes.subarray(1, 13))
    );
    // The shared helper logs authentication errors and returns undefined.
    if (decrypted === undefined) {
        throw new Error('Unable to decrypt ZIP: invalid credentials or corrupted data');
    }
    return new Uint8Array(decrypted);
}

//======================================================================================================================

/**
 * ZIP text, then encrypt it with the password and workspace ID salt.
 * Requires jszip.min.js and security-utils.js in the browser.
 * @param {string} input
 * @param {string} pwd
 * @param {string} workspaceId
 * @returns {Promise<Uint8Array>}
 */
async function textIntoSecretMessageBytes(input, pwd, workspaceId) {
    const zipBytes = await zipText(input);
    return encryptZipBytes(zipBytes, pwd, workspaceId);
}

/**
 * Decrypt a secret message, then extract its original text from the ZIP.
 * Rejects invalid credentials, tampered payloads, and invalid ZIP content.
 * @param {Uint8Array|ArrayBuffer} secretMessageBytes
 * @param {string} pwd
 * @param {string} workspaceId
 * @returns {Promise<string>}
 */
async function secretMessageBytesToText(secretMessageBytes, pwd, workspaceId) {
    const zipBytes = await decryptZipBytes(secretMessageBytes, pwd, workspaceId);
    return unZipText(zipBytes);
}

//====================================with REST API calls===============================================================
/**
 * Encrypt text and save it through the secret-message REST API.
 * Uses PushcaClient.clusterBaseUrl; the server receives encrypted bytes and a
 * Base64 SHA-256 password hash, never the plaintext message or password.
 * @param {string} input
 * @param {string} pwd
 * @param {string} workspaceId
 * @param {string|null} [ownerSignature=null]
 * @returns {Promise<string>} Public phrase returned by the server.
 */
async function textToSecreteMessagePublicPhrase(input, pwd, workspaceId, ownerSignature = null) {
    const messageBytes = await textIntoSecretMessageBytes(input, pwd, workspaceId);
    if (messageBytes.byteLength > 8 * 1024) {
        throw new Error('Encrypted secret message exceeds the 8 KiB API limit');
    }
    const passwordHash = await calculateSha256(new TextEncoder().encode(pwd));
    const url = PushcaClient.clusterBaseUrl.replace(/\/$/, '') + '/pushca/secret-message/save';
    const options = {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            message: byteArrayToBase64(messageBytes), workspaceId, passwordHash, ownerSignature
        })
    };
    let response;
    // One initial request plus at most three retries, only for phrase collisions.
    for (let retry = 0; retry <= 3; retry++) {
        response = await fetch(url, options);
        if (response.ok) break;
        let errorBody;
        if (response.status === 409) {
            try { errorBody = await response.json(); } catch (_) { /* Not a collision response. */ }
        }
        const collision = response.status === 409 &&
            errorBody?.description === 'Public phrase is already used';
        if (!collision || retry === 3) {
            throw new Error(`Failed to save secret message (HTTP ${response.status})${collision ? ': Public phrase is already used' : ''}`);
        }
    }
    const result = await response.json();
    if (!result || typeof result.publicPhrase !== 'string' || !result.publicPhrase.trim()) {
        throw new Error('Secret message API returned an invalid public phrase');
    }
    return result.publicPhrase;
}

/**
 * Fetch encrypted message bytes by public phrase, then decrypt and unzip them.
 * Uses the same credentials, owner signature, and API base URL as the save helper.
 * @param {string} publicPhrase
 * @param {string} pwd
 * @param {string} workspaceId
 * @param {string|null} [ownerSignature=null]
 * @returns {Promise<string>} Original secret message text.
 */
async function secreteMessagePublicPhraseToText(publicPhrase, pwd, workspaceId, ownerSignature = null) {
    if (typeof publicPhrase !== 'string' || !publicPhrase.trim()) {
        throw new TypeError('Public phrase must be a nonempty string');
    }
    if (typeof pwd !== 'string' || pwd.length === 0 ||
        typeof workspaceId !== 'string' || workspaceId.length === 0) {
        throw new TypeError('Password and workspace ID must be nonempty strings');
    }
    const passwordHash = await calculateSha256(new TextEncoder().encode(pwd));
    const response = await fetch(PushcaClient.clusterBaseUrl.replace(/\/$/, '') + '/pushca/secret-message/fetch', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({workspaceId, passwordHash, ownerSignature, publicPhrase})
    });
    if (!response.ok) {
        throw new Error(`Failed to fetch secret message (HTTP ${response.status})`);
    }
    const result = await response.json();
    if (!result || typeof result.message !== 'string' || !result.message) {
        throw new Error('Secret message not found or API returned invalid message bytes');
    }
    const messageBytes = base64ToArrayBuffer(result.message);
    return secretMessageBytesToText(messageBytes, pwd, workspaceId);
}
