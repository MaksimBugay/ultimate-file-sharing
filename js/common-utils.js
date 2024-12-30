const MemoryBlock = Object.freeze({
    MB: 1024 * 1024,
    MB_ENC: 1075 * 1075,
    MB10: 10 * 1024 * 1024,
    MB100: 100 * 1024 * 1024,
    GB: 1024 * 1024 * 1024
});

function delay(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function isMobile() {
    const userAgent = /Mobi|Android/i.test(navigator.userAgent);
    const smallScreen = window.innerWidth <= 800 && window.innerHeight <= 1280;
    const touchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

    return userAgent && smallScreen && touchDevice;
}

function isStringPresentNumber(value) {
    return /^-?\d+$/.test(value.trim());
}

function isBase64(string) {
    try {
        atob(string);
        return true;
    } catch (e) {
        return false;
    }
}

function generateStrongPassword(length = 12) {
    const upperCase = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const lowerCase = "abcdefghijklmnopqrstuvwxyz";
    const numbers = "0123456789";
    const specialChars = "!@#$%^&*()-_=+[]{}|;:',.<>?";

    // Ensure password contains at least one character from each set
    const allChars = upperCase + lowerCase + numbers + specialChars;

    let password = "";
    password += upperCase.charAt(Math.floor(Math.random() * upperCase.length));
    password += lowerCase.charAt(Math.floor(Math.random() * lowerCase.length));
    password += numbers.charAt(Math.floor(Math.random() * numbers.length));
    password += specialChars.charAt(Math.floor(Math.random() * specialChars.length));

    // Fill the rest of the password with random characters
    for (let i = 4; i < length; i++) {
        password += allChars.charAt(Math.floor(Math.random() * allChars.length));
    }

    // Shuffle the password for randomness
    password = password.split('').sort(() => Math.random() - 0.5).join('');

    return password;
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

function stringToByteArray(str) {
    const encoder = new TextEncoder();
    return encoder.encode(str);
}

function stringToArrayBuffer(str) {
    const encoder = new TextEncoder();
    const uint8Array = encoder.encode(str);
    return uint8Array.buffer;
}

function arrayBufferToString(buffer) {
    const decoder = new TextDecoder();
    return decoder.decode(buffer);
}

function byteArrayToString(byteArray) {
    const decoder = new TextDecoder();
    return decoder.decode(byteArray);
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
    return uint8Array;
}

function bytesToShortInt(arrayBuffer) {
    if (arrayBuffer.byteLength !== 1) {
        throw new Error(`Invalid byte array length ${arrayBuffer.byteLength}. Must be 1 byte.`);
    }
    const view = new DataView(arrayBuffer);
    return view.getInt8(0);
}

function booleanToBytes(bool) {
    const shortInt = bool ? 1 : 0;
    return shortIntToBytes(shortInt);
}

function bytesToBoolean(uint8Array) {
    return bytesToShortInt(uint8Array) === 1;
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

function bytesToUuid(bytes) {
    // Ensure bytes is a Uint8Array
    bytes = new Uint8Array(bytes);

    // Create a DataView for efficient byte manipulation
    const view = new DataView(bytes.buffer);

    // Extract msb and lsb
    const msb = view.getBigUint64(0, false); // false for big-endian
    const lsb = view.getBigUint64(8, false);

    // Convert to hex strings
    const msbHex = msb.toString(16).padStart(16, '0');
    const lsbHex = lsb.toString(16).padStart(16, '0');

    // Construct the UUID string
    return `${msbHex.substring(0, 8)}-${msbHex.substring(8, 12)}-${msbHex.substring(12, 16)}-${lsbHex.substring(0, 4)}-${lsbHex.substring(4, 16)}`;
}

function bytesToArrayBuffer(byteArray) {
    // Create a new ArrayBuffer with the size of the byte array
    const buffer = new ArrayBuffer(byteArray.length);

    // Create a Uint8Array view on the ArrayBuffer
    const uint8Array = new Uint8Array(buffer);

    // Set the byte array values to the Uint8Array
    uint8Array.set(byteArray);

    return buffer;
}

function concatArrayBuffers(buffers) {
    // Calculate the total length of all buffers
    const totalLength = buffers.reduce((acc, buffer) => acc + buffer.byteLength, 0);

    // Create a new ArrayBuffer with the total length
    const resultBuffer = new ArrayBuffer(totalLength);

    // Create a Uint8Array view for the result buffer
    const resultView = new Uint8Array(resultBuffer);

    // Keep track of the current offset in the result buffer
    let offset = 0;

    // Copy each buffer into the result buffer
    buffers.forEach(buffer => {
        const bufferView = new Uint8Array(buffer);
        resultView.set(bufferView, offset);
        offset += buffer.byteLength;
    });

    return resultBuffer;
}

function arrayBuffersAreEqual(buffer1, buffer2) {
    if (buffer1.byteLength !== buffer2.byteLength) {
        return false;
    }

    const view1 = new Uint8Array(buffer1);
    const view2 = new Uint8Array(buffer2);

    for (let i = 0; i < view1.length; i++) {
        if (view1[i] !== view2[i]) {
            return false;
        }
    }

    return true;
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

function popFirstNBytesFromArrayBuffer(arrayBuffer, n) {
    const byteArray = new Uint8Array(arrayBuffer);
    const poppedBytes = byteArray.slice(0, n);
    return poppedBytes.buffer;
}

function removeFirstNBytesFromArrayBuffer(arrayBuffer, n) {
    const byteArray = new Uint8Array(arrayBuffer);
    return byteArray.slice(n).buffer;
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

function isArrayEmpty(arr) {
    return !isNotEmpty(arr);
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

function printPreciseDateTime(dt) {
    const dateTime = new Date(dt);
    const year = dateTime.getFullYear();
    const month = String(dateTime.getMonth() + 1).padStart(2, '0'); // Months are 0-indexed, add 1 to get the correct month
    const day = String(dateTime.getDate()).padStart(2, '0');
    const hours = String(dateTime.getHours()).padStart(2, '0');
    const minutes = String(dateTime.getMinutes()).padStart(2, '0');
    const seconds = String(dateTime.getSeconds()).padStart(2, '0');

    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
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

function downloadFile(blob, fileName) {
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();

    // Clean up
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

//---------------------------------------------------------------------------------------

function hasParentWithIdOrClass(element, idOrClassList) {
    if (!element) {
        return false;
    }
    for (let i = 0; i < idOrClassList.length; i++) {
        const match = element.closest(`#${idOrClassList[i]}, .${idOrClassList[i]}`)
        if (match) {
            return true;
        }
    }
    return false;
}

function swapElements(element1, element2) {
    // Ensure both elements exist
    if (!element1 || !element2) {
        console.error("One or both elements not found.");
        return;
    }

    // Create a temporary placeholder to swap elements
    const tempPlaceholder = document.createElement('div');
    element1.parentNode.insertBefore(tempPlaceholder, element1);

    // Perform the swap
    element2.parentNode.insertBefore(element1, element2);
    tempPlaceholder.parentNode.insertBefore(element2, tempPlaceholder);

    // Remove the temporary placeholder
    tempPlaceholder.parentNode.removeChild(tempPlaceholder);
}

function printAllParents(el0, maxDeep) {
    const pMaxDeep = maxDeep ? maxDeep : 1000;
    let elP = el0.parentElement;
    let level = 0;
    while (elP) {
        level += 1;
        console.log(`Parent: level=${level}, height=${elP.getBoundingClientRect().height}`);
        console.log(elP);
        if (level > pMaxDeep) {
            return;
        }
        elP = elP.parentElement;
    }
}

//===================================== Geo API lookup =================================================================
async function geoLookup(ip, clusterBaseUrl) {
    const url = `${clusterBaseUrl}/binary/resolve-ip`;
    const payload = {
        ip: ip
    };

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }

        return await response.json();
    } catch (error) {
        console.error("Error querying the API:", error);
        return null;
    }
}

function getCountryWithFlagInnerHtml(countryCode, countryName) {
    const flagUrl = `https://flagcdn.com/w40/${countryCode.toLowerCase()}.png`;
    return `<div style="display: flex"> <img style="margin-right: 10px; border: 1px solid black;" src="${flagUrl}" alt="Estonia Flag" /> ${countryName}</div>`;
}

//======================================================================================================================