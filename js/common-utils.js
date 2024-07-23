
const MemoryBlock = Object.freeze({
    MB: 1024 * 1024,
    GB: 1024 * 1024 * 1024
});

function delay(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function convertBlobToArrayBuffer(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = function (event) {
            const arrayBuffer = event.target.result;
            resolve(arrayBuffer);
        };
        reader.onerror = function (error) {
            reject(error);
        };
        reader.readAsArrayBuffer(blob);
    });
}

function formatString(template, ...values) {
    return template.replace(/{(\d+)}/g, function (match, number) {
        return typeof values[number] != 'undefined' ? values[number] : match;
    });
}

function calculateStringHashCode(s) {
    const utf8Encoder = new TextEncoder();
    const bytes = utf8Encoder.encode(s);
    let h = 0;
    for (const v of bytes) {
        h = 31 * h + (v & 0xff);
        h |= 0; // Convert to 32-bit integer
    }
    return h;
}

function intToBytes(int) {
    const buffer = new ArrayBuffer(4);
    const view = new DataView(buffer);
    view.setInt32(0, int, false); // false for big-endian, true for little-endian
    const int8Array = new Int8Array(buffer);
    return Array.from(int8Array);
}

function bytesToInt(sourceBuffer) {
    if (sourceBuffer.byteLength !== 4) {
        throw new Error('Invalid byte array length. Must be 4 bytes.');
    }
    const view = new DataView(sourceBuffer);
    return view.getInt32(0, false);
}

function shortIntToBytes(int) {
    if (int < 0 || int > 255) {
        throw new RangeError("Integer must be in the range 0 to 255.");
    }
    const uint8Array = new Uint8Array(1);
    uint8Array[0] = int;
    const int8Array = new Int8Array(uint8Array.buffer);
    return Array.from(int8Array);
}

function booleanToBytes(bool) {
    const shortInt = bool ? 1 : 0;
    return shortIntToBytes(shortInt);
}

function uuidToBytes(uuidStr) {
    // Parse the UUID string into a byte array
    const uuidBytes = uuid.parse(uuidStr);

    // Create a DataView to handle the bytes
    const buffer = new ArrayBuffer(16);
    const view = new DataView(buffer);

    // Copy the UUID bytes into the DataView
    for (let i = 0; i < 16; i++) {
        view.setUint8(i, uuidBytes[i]);
    }

    // Extract the most significant and least significant bits
    let msb = 0n;
    let lsb = 0n;
    for (let i = 0; i < 8; i++) {
        msb = (msb << 8n) | BigInt(view.getUint8(i));
    }
    for (let i = 8; i < 16; i++) {
        lsb = (lsb << 8n) | BigInt(view.getUint8(i));
    }

    // Write the msb and lsb back to the buffer in big-endian order
    view.setBigUint64(0, msb, false); // false for big-endian
    view.setBigUint64(8, lsb, false); // false for big-endian

    // Convert to signed bytes array
    const signedBytes = new Int8Array(buffer);
    return Array.from(signedBytes);
}

function concatenateByteArrays(...arrays) {
    // Calculate the total length of the concatenated array
    let totalLength = arrays.reduce((acc, array) => acc + array.length, 0);

    // Create a new ArrayBuffer with the total length
    let concatenatedArray = new Uint8Array(totalLength);

    // Copy each byte array into the new Uint8Array
    let offset = 0;
    arrays.forEach(array => {
        concatenatedArray.set(array, offset);
        offset += array.length;
    });

    return concatenatedArray;
}

function copyBytes(sourceBuffer, start, end) {
    if (start < 0 || end > sourceBuffer.byteLength || start > end) {
        throw new RangeError('Invalid start or end index.');
    }

    return sourceBuffer.slice(start, end);
}

function shiftFirstNBytes(sourceBuffer, n) {
    if (n >= sourceBuffer.byteLength) {
        return new ArrayBuffer(0); // Return an empty buffer if n is larger than the source buffer size
    }

    // Step 1: Create a new ArrayBuffer for the remaining bytes.
    const remainingBytesBuffer = new ArrayBuffer(sourceBuffer.byteLength - n);

    // Step 2: Create a new Uint8Array view for both the source and destination buffers.
    const sourceArray = new Uint8Array(sourceBuffer);
    const remainingBytesArray = new Uint8Array(remainingBytesBuffer);

    // Step 3: Copy the remaining bytes to the new buffer.
    remainingBytesArray.set(sourceArray.subarray(n));

    return remainingBytesBuffer;
}

function splitArrayBuffer(arrayBuffer, chunkSize) {
    const chunks = [];
    const numChunks = Math.ceil(arrayBuffer.byteLength / chunkSize);

    for (let i = 0; i < numChunks; i++) {
        const start = i * chunkSize;
        const end = Math.min(start + chunkSize, arrayBuffer.byteLength);
        const chunk = arrayBuffer.slice(start, end);
        chunks.push(chunk);
    }

    return chunks;
}

function isNotEmpty(x) {
    return (typeof x !== 'undefined') && x !== null && x !== undefined && x !== ''
}

function isEmpty(x) {
    return !isNotEmpty(x);
}

function isArrayNotEmpty(arr) {
    return arr !== null && arr !== undefined && Array.isArray(arr) && arr.length > 0;
}

function extractNumber(str) {
    const match = str.match(/\d+/);
    return match ? parseInt(match[0], 10) : null;
}

//-----------------------------printing--------------------------------------------------
function printDateTime(dt) {
    const dateTime = new Date(dt);
    const year = dateTime.getFullYear();
    const month = String(dateTime.getMonth() + 1).padStart(2, '0'); // Months are 0-indexed, add 1 to get the correct month
    const day = String(dateTime.getDate()).padStart(2, '0');
    const hours = String(dateTime.getHours()).padStart(2, '0');
    const minutes = String(dateTime.getMinutes()).padStart(2, '0');

    return `${year}-${month}-${day} ${hours}:${minutes}`;
}

function printObject(obj) {
    return Object.values(obj)
        .filter(value => value !== undefined && value !== null)
        .join('/');
}
//---------------------------------------------------------------------------------------
//----------------------------------------BASE64-----------------------------------------
function encodeToBase64UrlSafe(str) {
    // Encode UTF-8 string to Uint8Array
    const encoder = new TextEncoder();
    const uint8Array = encoder.encode(str);

    // Convert Uint8Array to binary string
    const binaryString = String.fromCharCode.apply(null, uint8Array);

    // Encode to standard Base64 string
    const base64 = btoa(binaryString);

    // Make the Base64 string URL safe
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeFromBase64UrlSafe(base64UrlSafe) {
    // Replace URL safe characters with Base64 standard characters
    let base64 = base64UrlSafe.replace(/-/g, '+').replace(/_/g, '/');

    // Add padding if necessary
    while (base64.length % 4) {
        base64 += '=';
    }

    // Decode from Base64 to binary string
    const binaryString = atob(base64);

    // Convert binary string to Uint8Array
    const uint8Array = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        uint8Array[i] = binaryString.charCodeAt(i);
    }

    // Decode UTF-8 Uint8Array to string
    const decoder = new TextDecoder();
    return decoder.decode(uint8Array);
}
//---------------------------------------------------------------------------------------

//---------------------------------FILES-------------------------------------------------
function getFileExtension(filename) {
    const parts = filename.split('.');
    return parts.length > 1 ? parts.pop() : '';
}

//---------------------------------------------------------------------------------------