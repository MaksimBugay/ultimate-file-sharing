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

// PBKDF2-SHA-256 iterations of the message key and of the lookup verifier (wire format version 2; version 1 used
// 100,000 iterations and a plain SHA-256 of the password for lookups, and is no longer read).
const SECRET_MESSAGE_ITERATIONS = 600000;
const SECRET_MESSAGE_FORMAT_VERSION = 2;
// The verifier is sent to the server, so its salt differs from the key's: the same password and workspace must never
// give the server the message key.
const SECRET_MESSAGE_VERIFIER_SALT_PREFIX = 'secret-message-verifier:';

// Values derived from the last password and workspace. Each takes a noticeable moment (600,000 iterations), and auto
// decoding needs them for every lookup; other credentials replace them.
let derivedCredentials = null;
let derivedValues = new Map();

function derivedOnce(name, pwd, workspaceId, compute) {
    const credentials = JSON.stringify([pwd, workspaceId]);
    if (credentials !== derivedCredentials) {
        derivedCredentials = credentials;
        derivedValues = new Map();
    }
    const values = derivedValues;
    if (!values.has(name)) {
        const value = compute();
        values.set(name, value);
        // A failed derivation is tried again next time.
        value.catch(() => { if (values.get(name) === value) values.delete(name); });
    }
    return values.get(name);
}

async function pbkdf2Base64(pwd, salt, iterations) {
    const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(pwd), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({name: 'PBKDF2', salt, iterations, hash: 'SHA-256'}, material, 256);
    return arrayBufferToBase64(bits);
}

/** Base64 AES-256 message key: PBKDF2 of the password with the UTF-8 workspace ID as the salt. */
function secretMessageKey(pwd, workspaceId) {
    return derivedOnce('key', pwd, workspaceId,
        () => pbkdf2Base64(pwd, new TextEncoder().encode(workspaceId), SECRET_MESSAGE_ITERATIONS));
}

/**
 * Base64 lookup verifier sent to the server instead of the password: as slow to test as the message key, salted with
 * the workspace ID, so a copy of the server's data does not allow fast password guessing.
 */
function secretMessagePasswordVerifier(pwd, workspaceId) {
    return derivedOnce('verifier', pwd, workspaceId, () => pbkdf2Base64(pwd,
        new TextEncoder().encode(SECRET_MESSAGE_VERIFIER_SALT_PREFIX + workspaceId), SECRET_MESSAGE_ITERATIONS));
}

/**
 * Encrypt ZIP bytes using security-utils.js and browser Web Crypto (HTTPS/localhost).
 * The UTF-8 workspace ID is the PBKDF2 salt; each encryption uses a fresh IV.
 * Wire format: version (1 byte, currently 2), IV (12 bytes), ciphertext + GCM tag.
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
    const key = await secretMessageKey(pwd, workspaceId);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const contract = new EncryptionContract(key, arrayBufferToBase64(iv));
    const ciphertext = await encryptWithAESUsingContract(zipBytes, contract);
    const encryptedBytes = new Uint8Array(1 + iv.length + ciphertext.byteLength);
    encryptedBytes[0] = SECRET_MESSAGE_FORMAT_VERSION;
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
    if (bytes.length < 29 || bytes[0] !== SECRET_MESSAGE_FORMAT_VERSION) {
        throw new Error('Invalid or unsupported encrypted ZIP format');
    }
    const key = await secretMessageKey(pwd, workspaceId);
    const decrypted = await decryptAESToArrayBuffer(bytes.subarray(13), key, arrayBufferToBase64(bytes.subarray(1, 13)));
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
/** Normalize public phrase context to the backend's ConversationDetails contract. */
function normalizePublicConversationDetails(details) {
    if (!details || typeof details !== 'object' || Array.isArray(details)) {
        throw new TypeError('Conversation details must be an object');
    }
    const topic = details.topic ?? 'Weather';
    const style = details.style ?? 'Informal/Casual';
    if (typeof topic !== 'string' || typeof style !== 'string') {
        throw new TypeError('Conversation topic and style must be strings');
    }
    if (topic.length > 500) {
        throw new Error('Conversation topic must be at most 500 characters');
    }
    if (style.length > 100) {
        throw new Error('Conversation style must be at most 100 characters');
    }
    const history = details.history ?? [];
    if (!Array.isArray(history) || history.some(message => typeof message !== 'string')) {
        throw new TypeError('Conversation history must be a list of message strings');
    }
    if (history.reduce((total, message) => total + message.length, 0) > 1500) {
        throw new Error('Conversation history must be at most 1500 characters in total');
    }
    const prohibitedMessages = details.prohibitedMessages ?? [];
    if (!Array.isArray(prohibitedMessages) || prohibitedMessages.some(message => typeof message !== 'string')) {
        throw new TypeError('Conversation prohibited messages must be a list of message strings');
    }
    if (prohibitedMessages.reduce((total, message) => total + message.length, 0) > 1500) {
        throw new Error('Conversation prohibited messages must be at most 1500 characters in total');
    }
    const language = details.locale ?? 'en';
    if (typeof language !== 'string') throw new TypeError('Conversation language must be a locale string');
    let locale;
    try { [locale] = Intl.getCanonicalLocales(language.trim().replace(/_/g, '-') || 'en'); }
    catch (_) { throw new Error('Conversation language must be a valid locale, such as en or uk'); }
    return {topic: topic.trim() || 'Weather', style: style.trim() || 'Informal/Casual',
        history: [...history], prohibitedMessages: [...prohibitedMessages], locale};
}

function validateSecretMessageIdentifiers(workspaceId, ownerSignature) {
    if (typeof workspaceId === 'string' && workspaceId.length > 100) {
        throw new Error('Workspace ID must be at most 100 characters');
    }
    if (ownerSignature != null && (typeof ownerSignature !== 'string' || ownerSignature.length > 200)) {
        throw new Error('Owner signature must be a string of at most 200 characters');
    }
}

/**
 * Encrypt text and save it through the secret-message REST API.
 * Uses PushcaClient.clusterBaseUrl; the server receives encrypted bytes and the
 * Base64 password verifier (secretMessagePasswordVerifier), never the plaintext message or password.
 * @param {string} input
 * @param {string} pwd
 * @param {string} workspaceId
 * @param {string|null} [ownerSignature=null]
 * @param {{topic?: string, style?: string, history?: string[], prohibitedMessages?: string[], locale?: string|null}|null} [publicConversationDetails=null]
 * Public context sent to the server to guide phrase generation (not encrypted).
 * @returns {Promise<string>} Public phrase returned by the server.
 */
async function textToSecreteMessagePublicPhrase(input, pwd, workspaceId, ownerSignature = null, publicConversationDetails = null) {
    validateSecretMessageIdentifiers(workspaceId, ownerSignature);
    const context = publicConversationDetails === null ? null : normalizePublicConversationDetails(publicConversationDetails);
    const messageBytes = await textIntoSecretMessageBytes(input, pwd, workspaceId);
    if (messageBytes.byteLength > 32 * 1024) {
        throw new Error('Encrypted secret message exceeds the 32 KiB API limit');
    }
    const passwordHash = await secretMessagePasswordVerifier(pwd, workspaceId);
    const url = PushcaClient.clusterBaseUrl.replace(/\/$/, '') + '/pushca/secret-message/save';
    const options = {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            message: byteArrayToBase64(messageBytes), workspaceId, passwordHash, ownerSignature,
            ...(context === null ? {} : {publicConversationDetails: context})
        })
    };
    let response;
    // One initial request plus at most three retries, only for phrase collisions.
    for (let retry = 0; retry <= 3; retry++) {
        response = await fetch(url, options);
        if (response.ok) break;
        let errorBody;
        let emptyBody = false;
        try {
            if (typeof response.text === 'function') {
                const body = await response.text();
                emptyBody = !body.trim();
                if (!emptyBody) errorBody = JSON.parse(body);
            } else {
                errorBody = await response.json();
            }
        } catch (_) { /* Preserve the HTTP error for non-JSON responses. */ }
        // The backend documents this collision but may return an empty 409 body.
        const collision = response.status === 409 &&
            (emptyBody || errorBody?.description === 'Public phrase is already used');
        if (!collision || retry === 3) {
            const description = collision ? 'Public phrase is already used' :
                errorBody?.description || errorBody?.detail || errorBody?.message;
            const detail = typeof description === 'string' ? `: ${description.slice(0, 300)}` : '';
            throw new Error(`Failed to save secret message (HTTP ${response.status})${detail}`);
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
    if (publicPhrase.length > 5000) {
        throw new Error('Public phrase must be at most 5000 characters');
    }
    validateSecretMessageIdentifiers(workspaceId, ownerSignature);
    if (typeof pwd !== 'string' || pwd.length === 0 ||
        typeof workspaceId !== 'string' || workspaceId.length === 0) {
        throw new TypeError('Password and workspace ID must be nonempty strings');
    }
    const passwordHash = await secretMessagePasswordVerifier(pwd, workspaceId);
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
