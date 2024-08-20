const serverUrl = 'https://vasilii.prodpushca.com:30443';
const urlParams = new URLSearchParams(window.location.search);

// Retrieve specific parameters
const protectedUrlSuffix = urlParams.get('suffix');

const passwordField = document.getElementById('password');
const workspaceField = document.getElementById('workSpaceId');
const downloadBtn = document.getElementById('downloadBtn');
const togglePasswordBtn = document.getElementById('togglePassword');

workspaceField.focus();

workspaceField.value = "cec7abf69bab9f5aa793bd1c0c101e99";
passwordField.value = "strongPassword";

downloadBtn.addEventListener('click', function () {
    createSignedDownloadRequest(passwordField.value, workspaceField.value, protectedUrlSuffix).then(request => {
        console.log(request);
        const url = `${serverUrl}/binary/protected/${request.suffix}?exp=${request.exp}&sgn=${request.signature}`;
        window.open(url, '_blank');
        const loginContainer = document.querySelector('.login-container');
        if (loginContainer) {
            loginContainer.remove();
        }
        delay(1000).then(() => window.close());
    });
});

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
    )

    return new DownloadProtectedBinaryRequest(
        request.suffix,
        request.exp,
        arrayBufferToUrlSafeBase64(signature)
    )
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

