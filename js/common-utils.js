const MemoryBlock = Object.freeze({
    MB: 1024 * 1024,
    MB_ENC: 1075 * 1075,
    MB10: 10 * 1024 * 1024,
    MB100: 100 * 1024 * 1024,
    GB: 1024 * 1024 * 1024
});

class ProgressBarWidget {
    constructor(pbContainer, pbProgress, pbProgressPercentage) {
        this.pbContainer = pbContainer;
        this.pbProgress = pbProgress;
        this.pbProgressPercentage = pbProgressPercentage;
    }

    reset() {
        this.setProgress(0);
    }

    setProgress(progress) {
        this.pbProgress.value = progress;
        this.pbProgressPercentage.textContent = `${progress}%`;
    }
}

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
    const decoder = new TextDecoder("utf-8");
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

async function blobToArrayBuffers(blob, chunkSize) {
    const arrayBuffers = [];
    const totalSize = blob.size;
    let offset = 0;

    while (offset < totalSize) {
        const chunk = blob.slice(offset, offset + chunkSize);
        const arrayBuffer = await chunk.arrayBuffer();
        arrayBuffers.push(arrayBuffer);
        offset += chunkSize;
    }

    return arrayBuffers;
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
    if (!(element instanceof Element) || !Array.isArray(idOrClassList) || idOrClassList.length === 0) {
        return false;
    }

    for (let i = 0; i < idOrClassList.length; i++) {
        let match = element.closest(`#${idOrClassList[i]}`);
        if (match) {
            return true;
        }
        match = element.closest(`.${idOrClassList[i]}`);
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

function getCountryWithFlagInnerHtml(countryCode, countryName) {
    const flagUrl = `https://flagcdn.com/w40/${countryCode.toLowerCase()}.png`;
    return `<div style="display: flex"> <img style="margin-right: 10px; border: 1px solid black;" src="${flagUrl}" alt="Estonia Flag" /> ${countryName}</div>`;
}

/*function getCountryFlagImage(countryCode) {
    const flagUrl = `https://flagcdn.com/w40/${countryCode.toLowerCase()}.png`;
    return `<img style="margin-right: 10px; border: 1px solid black;" src="${flagUrl}" alt="CountryFlag" />`;
}*/

function getCountryFlagImage(langCode) {
    const baseFlagUrl = "https://flagcdn.com"; // Example flag source
    const supportedFlags = {
        en: "us", es: "es", fr: "fr", de: "de", zh: "cn", ru: "ru", ja: "jp",
        it: "it", pt: "pt", ar: "sa", hi: "in", ko: "kr", tr: "tr", nl: "nl",
        sv: "se", pl: "pl", vi: "vn", id: "id", th: "th", uk: "ua", ms: "my",
        tl: "ph", fa: "ir", ro: "ro", hu: "hu", cs: "cz", el: "gr", da: "dk",
        fi: "fi", no: "no"
    };

    const countryCode = supportedFlags[langCode];
    return countryCode
        ? `<img src="${baseFlagUrl}/${countryCode}.svg" alt="${langCode}" class="flag">`
        : `<span class="flag">🏳️</span>`;
}
//======================================================================================================================

//=================================prevent screen lock on mobile========================================================
async function requestWakeLock(propertiesHolder) {
    if (!isMobile()) {
        return;
    }
    try {
        propertiesHolder.wakeLock = await navigator.wakeLock.request('screen');
        console.log('Wake lock is active.');

        // Listen for the wake lock release event
        propertiesHolder.wakeLock.addEventListener('release', () => {
            console.log('Wake lock was released.');
        });
    } catch (err) {
        console.error(`Failed to request wake lock: ${err.message}`);
    }
}

function releaseWakeLock(propertiesHolder) {
    if (!isMobile()) {
        return;
    }
    if (propertiesHolder.wakeLock !== null) {
        propertiesHolder.wakeLock.release().then(() => {
            propertiesHolder.wakeLock = null;
            console.log('Wake lock has been released.');
        });
    }
}

//======================================================================================================================

//=============================Element visibility on screen=============================================================
/**
 * Helper function to calculate element visibility data
 * @param {HTMLElement} element - The DOM element to check
 * @returns {Object} - Object containing visibility data
 */
function calculateVisibilityData(element) {
    if (!element || !element.getBoundingClientRect) {
        return null;
    }

    // Get element's bounding rectangle
    const rect = element.getBoundingClientRect();

    // Get viewport dimensions with cross-browser compatibility
    const viewportWidth = Math.max(
        document.documentElement.clientWidth || 0,
        window.innerWidth || 0
    );

    const viewportHeight = Math.max(
        document.documentElement.clientHeight || 0,
        window.innerHeight || 0
    );

    // Calculate visible area
    const visibleLeft = Math.max(0, rect.left);
    const visibleTop = Math.max(0, rect.top);
    const visibleRight = Math.min(viewportWidth, rect.right);
    const visibleBottom = Math.min(viewportHeight, rect.bottom);

    // Calculate visible dimensions
    const visibleWidth = Math.max(0, visibleRight - visibleLeft);
    const visibleHeight = Math.max(0, visibleBottom - visibleTop);

    // Calculate element dimensions
    const elementWidth = rect.width || rect.right - rect.left;
    const elementHeight = rect.height || rect.bottom - rect.top;

    // Handle edge cases
    if (elementWidth <= 0 || elementHeight <= 0) {
        return {
            rect: rect,
            visibilityRatio: 0,
            visibilityPercentage: 0,
            isVisible: false,
            viewportWidth: viewportWidth,
            viewportHeight: viewportHeight
        };
    }

    // Calculate visibility ratio
    const visibleArea = visibleWidth * visibleHeight;
    const totalArea = elementWidth * elementHeight;
    const visibilityRatio = visibleArea / totalArea;

    return {
        rect: rect,
        visibilityRatio: visibilityRatio,
        visibilityPercentage: Math.round(visibilityRatio * 100),
        isVisible: visibilityRatio > 0,
        viewportWidth: viewportWidth,
        viewportHeight: viewportHeight
    };
}
/**
 * Checks if an HTML element is fully visible within the viewport
 * Works across all browsers including mobile and tablets
 *
 * @param {HTMLElement} element - The DOM element to check
 * @param {Object} options - Optional configuration object
 * @param {number} options.threshold - Percentage of element that must be visible (0-1, default: 1 for fully visible)
 * @param {number} options.rootMargin - Margin around the viewport in pixels (default: 0)
 * @returns {boolean} - True if element is fully (or threshold) visible, false otherwise
 */
function isElementFullyVisible(element, options) {
    // Handle undefined or null options
    if (!options) {
        options = {};
    }

    // Set defaults for undefined properties
    const threshold = (typeof options.threshold === 'number') ? options.threshold : 1;
    const rootMargin = (typeof options.rootMargin === 'number') ? options.rootMargin : 0;

    // Get visibility data using helper function
    const visibilityData = calculateVisibilityData(element);

    // Validate input
    if (!visibilityData) {
        console.warn('Invalid element provided to isElementFullyVisible');
        return false;
    }

    // Apply root margin if specified
    if (rootMargin !== 0) {
        const adjustedRect = {
            top: visibilityData.rect.top + rootMargin,
            left: visibilityData.rect.left + rootMargin,
            bottom: visibilityData.rect.bottom - rootMargin,
            right: visibilityData.rect.right - rootMargin
        };

        return (
            adjustedRect.top >= 0 &&
            adjustedRect.left >= 0 &&
            adjustedRect.bottom <= visibilityData.viewportHeight &&
            adjustedRect.right <= visibilityData.viewportWidth
        ) && visibilityData.visibilityRatio >= threshold;
    }

    // Standard visibility check
    return visibilityData.visibilityRatio >= threshold;
}
/**
 * Alternative implementation using Intersection Observer API for better performance
 * (Modern browsers only - falls back to the above function for older browsers)
 *
 * @param {HTMLElement} element - The DOM element to check
 * @param {Function} callback - Callback function that receives visibility status
 * @param {Object} options - Optional configuration object
 * @param {number} options.threshold - Percentage of element that must be visible (0-1, default: 1)
 * @param {string} options.rootMargin - Margin around the viewport (CSS-style string, default: '0px')
 * @returns {IntersectionObserver|null} - Observer instance or null if not supported
 */
function observeElementVisibility(element, callback, options) {
    // Handle undefined or null options
    if (!options) {
        options = {};
    }
    // Check if Intersection Observer is supported
    if (!window.IntersectionObserver) {
        // Fallback for older browsers
        console.warn('IntersectionObserver not supported, using fallback method');
        const checkVisibility = function() {
            const isVisible = isElementFullyVisible(element, options);
            callback(isVisible, element);
        };

        // Set up polling fallback
        const intervalId = setInterval(checkVisibility, 100);
        checkVisibility(); // Initial check

        return {
            disconnect: function() { clearInterval(intervalId); },
            unobserve: function() { clearInterval(intervalId); }
        };
    }

    const observer = new IntersectionObserver(function(entries) {
        entries.forEach(function(entry) {
            const isFullyVisible = entry.intersectionRatio >= (options.threshold || 1);
            callback(isFullyVisible, entry.target, entry);
        });
    }, {
        threshold: options.threshold || 1,
        rootMargin: options.rootMargin || '0px'
    });

    observer.observe(element);
    return observer;
}
/**
 * Simple one-shot check function - most commonly used
 *
 * @param {HTMLElement|string} element - DOM element or CSS selector
 * @returns {boolean} - True if element is fully visible
 */
function isFullyVisible(element) {
    // Handle string selector
    if (typeof element === 'string') {
        element = document.querySelector(element);
    }

    return isElementFullyVisible(element);
}
/**
 * Check if element is partially visible (any part visible)
 *
 * @param {HTMLElement|string} element - DOM element or CSS selector
 * @returns {boolean} - True if any part of element is visible
 */
function isPartiallyVisible(element) {
    // Handle string selector
    if (typeof element === 'string') {
        element = document.querySelector(element);
    }

    return isElementFullyVisible(element, { threshold: 0 });
}
/**
 * Get visibility percentage of an element
 *
 * @param {HTMLElement|string} element - DOM element or CSS selector
 * @returns {number} - Visibility percentage (0-100)
 */
function getVisibilityPercentage(element) {
    // Handle string selector
    if (typeof element === 'string') {
        element = document.querySelector(element);
    }

    // Get visibility data using helper function
    const visibilityData = calculateVisibilityData(element);

    if (!visibilityData) {
        return 0;
    }

    return visibilityData.visibilityPercentage;
}
/**
 * Get detailed visibility information about an element
 *
 * @param {HTMLElement|string} element - DOM element or CSS selector
 * @returns {Object|null} - Detailed visibility data object or null if invalid element
 */
function getVisibilityInfo(element) {
    // Handle string selector
    if (typeof element === 'string') {
        element = document.querySelector(element);
    }

    // Get visibility data using helper function
    return calculateVisibilityData(element);
}
// Example usage:
/*
// Basic usage
const myDiv = document.getElementById('myDiv');
if (isFullyVisible(myDiv)) {
    console.log('Div is fully visible!');
}
// Using CSS selector
if (isFullyVisible('#myDiv')) {
    console.log('Div is fully visible!');
}
// Check partial visibility
if (isPartiallyVisible('#myDiv')) {
    console.log('Div is at least partially visible!');
}
// Get visibility percentage
const visibilityPercent = getVisibilityPercentage('#myDiv');
console.log('Div is ' + visibilityPercent + '% visible');
// Get detailed visibility information
const visibilityInfo = getVisibilityInfo('#myDiv');
if (visibilityInfo) {
    console.log('Visibility ratio:', visibilityInfo.visibilityRatio);
    console.log('Visibility percentage:', visibilityInfo.visibilityPercentage);
    console.log('Element rect:', visibilityInfo.rect);
    console.log('Viewport size:', visibilityInfo.viewportWidth + 'x' + visibilityInfo.viewportHeight);
}
// Advanced usage with options
const isVisible = isElementFullyVisible(myDiv, {
    threshold: 0.8, // 80% of element must be visible
    rootMargin: 10  // 10px margin around viewport
});
// Using Intersection Observer for performance (modern browsers)
const observer = observeElementVisibility(myDiv, function(isVisible, element) {
    if (isVisible) {
        console.log('Element became fully visible!');
        element.classList.add('visible');
    } else {
        console.log('Element is no longer fully visible');
        element.classList.remove('visible');
    }
}, {
    threshold: 1.0, // Must be 100% visible
    rootMargin: '0px'
});
// Clean up observer when done
// observer.disconnect();
*/
//======================================================================================================================