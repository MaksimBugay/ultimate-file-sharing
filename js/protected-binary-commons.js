const playableMediaTypes = [
    "video/mp4",
    'video/webm; codecs="vp8, opus"',
    'video/webm; codecs="vp9, opus"',
    "audio/webm"
];

const playableImageTypes = [
    "image/jpeg",
    "image/bmp",
    "image/png"
];

function isPlayableMedia(contentType) {
    // Remove the codec part from the contentType if it exists
    const baseContentType = contentType.split(';')[0].trim(); // Extract base type, e.g., "video/webm"

    // Check if the base content type exists in the playableMediaTypes array
    return playableMediaTypes.some(type => type.split(';')[0].trim() === baseContentType);
}

function canBeShownInBrowser(contentType) {
    return ('text/plain' === contentType) || playableImageTypes.includes(contentType) || isPlayableMedia(contentType);
}

//======================================================================================================================
async function fetchProtectedBinaryDescription(suffix) {
    const url = serverUrl + `/binary/binary-manifest/protected/${suffix}`;
    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            return null;
        }

        return await response.text();
    } catch (error) {
        console.error('Error fetching protected binary description:', error);
        return null;
    }
}

//======================================================================================================================

//========================================Initialization block =========================================================
const serverUrl = 'https://secure.fileshare.ovh';
const urlParams = new URLSearchParams(window.location.search);

let protectedUrlSuffix = decodeURIComponent(urlParams.get('suffix'));
let encryptionContractStr;
let signatureHash;

const suffixParts = protectedUrlSuffix.split('|');
if (suffixParts.length > 1) {
    protectedUrlSuffix = suffixParts[0];
    console.log(`Protected url suffix: ${protectedUrlSuffix}`);
    if (protectedUrlSuffix) {
        fetchProtectedBinaryDescription(protectedUrlSuffix).then(readMeText => {
            const readMeTextMemo = document.getElementById("readMeTextMemo");
            if (readMeTextMemo) {
                readMeTextMemo.textContent = readMeText;
            }
        });
    }
    encryptionContractStr = suffixParts[1];
}

const ownerSignatureLabel = document.getElementById('ownerSignatureLabel');
if (suffixParts.length > 2) {
    signatureHash = suffixParts[2];
    generateHashAndConvertToReadableSignature(signatureHash).then((signaturePhrase) => {
        if (signaturePhrase) {
            ownerSignatureLabel.textContent = `Owner signature: ${signaturePhrase}`;
        }
    })
}

//======================================================================================================================

//=============================== Element accessors ====================================================================
const passwordField = document.getElementById('password');
const workspaceField = document.getElementById('workSpaceId');
const downloadBtn = document.getElementById('downloadBtn');
const togglePasswordBtn = document.getElementById('togglePassword');
const openInBrowserCheckbox = document.getElementById("openInBrowserCheckbox");
const reuseCredentialsCheckbox = document.getElementById("reuseCredentialsCheckbox");
const progressBar = document.getElementById("downloadProgress");
const progressPercentage = document.getElementById("progressPercentage");
const loginContainer = document.querySelector('.login-container');
const contentContainer = document.getElementById('contentContainer');
const contentText = document.getElementById('contentText');
const contentTextContainer = document.getElementById("contentTextContainer");
const contentImage = document.getElementById("contentImage");
const contentVideoPlayer = document.getElementById('contentVideoPlayer');
const progressBarContainer = document.getElementById("progressBarContainer");
const pastCredentialsTextarea = document.getElementById('pastCredentials');
const errorMessage = document.getElementById('errorMessage');

//======================================================================================================================
function showErrorMessage(errorText) {
    loginContainer.remove();
    errorMessage.textContent = errorText;
    errorMessage.style.display = 'block';
}

function showDownloadProgress() {
    progressBarContainer.style.display = 'block';
    downloadBtn.style.display = 'none';
}
togglePasswordBtn.addEventListener('mousedown', function () {
    passwordField.setAttribute('type', 'text');
});

togglePasswordBtn.addEventListener('mouseup', function () {
    passwordField.setAttribute('type', 'password');
});

togglePasswordBtn.addEventListener('mouseleave', function () {
    passwordField.setAttribute('type', 'password');
});

// Toggle password visibility on mobile (touch events)
togglePasswordBtn.addEventListener('touchstart', function () {
    passwordField.setAttribute('type', 'text');
});

togglePasswordBtn.addEventListener('touchend', function () {
    passwordField.setAttribute('type', 'password');
});
//======================================================================================================================
if (urlParams.get('workspace')) {
    pastCredentialsTextarea.style.display = 'none';
    workspaceField.value = urlParams.get('workspace');
    passwordField.focus();
} else {
    pastCredentialsTextarea.focus();
}

function setPastCredentialsHandler(handler) {
    pastCredentialsTextarea.addEventListener('input', () => {
        const memoText = pastCredentialsTextarea.value;
        if (memoText.includes('workspaceId') && memoText.includes('password')) {
            const object = JSON.parse(memoText);
            workspaceField.value = object['workspaceId'];
            passwordField.value = object['password'];
            if (signatureHash && object['signature'] && (signatureHash !== object['signature'])) {
                showErrorMessage("The provided signature does not match the content owner's signature!");
                return;
            }
            pastCredentialsTextarea.value = '';
            if (typeof handler === 'function') {
                handler();
            }
        }
    });
}

function setPressEnterKeyHandler(handler) {
    document.addEventListener('keydown', function (event) {
        if (event.key === 'Enter') {
            event.preventDefault();
            event.stopPropagation();
            if ('password' === event.target.id || 'pastCredentials' === event.target.id || 'downloadBtn' === event.target.id) {
                if (typeof handler === 'function') {
                    handler();
                }
            }
        }
    });
}

function setDownloadBtnHandler(handler) {
    downloadBtn.addEventListener('click', function () {
        if (typeof handler === 'function') {
            handler();
        }
    });
}

//===================================== Download utils =================================================================

async function createSignedDownloadRequest(pwd, workspaceId, suffix) {
    const request = new DownloadProtectedBinaryRequest(
        suffix,
        new Date().getTime() + 30000,
        null
    );

    const signature = await makeSignature(
        pwd,
        stringToByteArray(workspaceId),
        JSON.stringify(request.toSkipSignatureJSON())
    );

    const passwordHash = await calculateSha256(stringToArrayBuffer(pwd));

    return new DownloadProtectedBinaryRequest(
        request.suffix,
        request.exp,
        arrayBufferToUrlSafeBase64(signature),
        null,
        passwordHash
    )
}
async function postDownloadProcessor(result) {
    if (loginContainer) {
        if ('RESPONSE_WITH_ERROR' === result) {
            removeCredentials(signatureHash);
        } else {
            if (reuseCredentialsCheckbox.checked) {
                await saveCredentialsToDb(
                    signatureHash,
                    JSON.stringify({workspaceId: workspaceField.value, password: passwordField.value})
                );
            }
        }
        loginContainer.remove();
    }
    if ('RESPONSE_WITH_ERROR' !== result) {
        if (!openInBrowserCheckbox.checked) {
            delay(1000).then(() => window.close());
        }
    }
}

function extractFileName(contentDisposition) {
    let filename = 'protected-binary.data';

    if (contentDisposition && contentDisposition.includes('filename=')) {
        filename = contentDisposition.split('filename=')[1].split(';')[0];
        filename = filename.replace(/['"]/g, '');
    }

    return filename;
}
//======================================================================================================================

//=================================== Credentials database =============================================================
FingerprintJS.load().then(fp => {
    fp.get().then(result => {
        openDataBase(result.visitorId, function () {
            if (signatureHash) {
                applyCredentialsFromDb(signatureHash);
            }
        });
    });
});

async function applyCredentialsFromDb(signatureHash) {
    const credentials = await getCredentialsFromDb(signatureHash);
    if (credentials) {
        const jsonObj = JSON.parse(credentials);
        workspaceField.value = jsonObj.workspaceId;
        passwordField.value = jsonObj.password;
        downloadBtn.focus();
    }
}

//======================================================================================================================

