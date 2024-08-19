const serverUrl = 'https://vasilii.prodpushca.com:30443';
const urlParams = new URLSearchParams(window.location.search);

// Retrieve specific parameters
const protectedUrlSuffix = urlParams.get('suffix');
const canPlayType = urlParams.get('canPlayType');

const passwordField = document.getElementById('password');
const workspaceField = document.getElementById('workSpaceId');
const downloadBtn = document.getElementById('downloadBtn');

workspaceField.focus();

const workspaceId = "cec7abf69bab9f5aa793bd1c0c101e99";
const password = "strongPassword";

downloadBtn.addEventListener('click', function () {
    createSignedDownloadRequest(password, workspaceId, protectedUrlSuffix, canPlayType).then(request => {
        console.log(request);
        const url = `${serverUrl}/binary/protected/${request.suffix}?exp=${request.exp}&canPlayType=${request.canPlayType}&sgn=${request.signature}`;
        window.open(url, '_blank');
    });
});

async function createSignedDownloadRequest(pwd, workspaceId, suffix, canPlayType) {
    const request = new DownloadProtectedBinaryRequest(
        suffix,
        new Date().getTime() + 30000,
        canPlayType,
        null
    );

    const signature = await makeSignature(
        pwd,
        stringToByteArray(workspaceId),
        JSON.stringify(request.toSkipSignatureJSON())
    )

    return new DownloadProtectedBinaryRequest(
        request.suffix,
        request.exp,
        request.canPlayType,
        arrayBufferToUrlSafeBase64(signature)
    )
}


document.getElementById('togglePassword').addEventListener('click', function () {
    const toggleButton = document.getElementById('togglePassword');
    const type = passwordField.getAttribute('type') === 'password' ? 'text' : 'password';
    passwordField.setAttribute('type', type);
    toggleButton.textContent = type === 'password' ? 'Show' : 'Hide';
});

