//CaptchaSetBinaries

class CaptchaSetBinaries {
    constructor(captcha, results) {
        this.captcha = captcha;
        this.results = results;
    }

    static fromBytes(arrayBuffer) {
        const payloadStr = arrayBufferToString(arrayBuffer);
        const parts = payloadStr.split("::");

        const captcha = base64ToArrayBuffer(parts[0]);

        const results = parts[1]
            .split("|")
            .map(base64String => base64ToArrayBuffer(base64String));

        return new CaptchaSetBinaries(captcha, results);
    }
}

const DynamicCaptcha = {}
DynamicCaptcha.serverUrl = 'https://secure.fileshare.ovh';
DynamicCaptcha.wsUrl = 'wss://secure.fileshare.ovh:31085';
DynamicCaptcha.pageId = uuid.v4().toString();
DynamicCaptcha.backendUrl = null;
DynamicCaptcha.blocked = false;

const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get('page-id')) {
    DynamicCaptcha.pageId = urlParams.get('page-id');
}

if (urlParams.get('backend-url')) {
    DynamicCaptcha.backendUrl = urlParams.get('backend-url');
}

const displayCaptchaContainer = document.getElementById("displayCaptchaContainer");
const captchaImage = document.getElementById("captchaImage");
const resultsContainer = document.getElementById("resultsContainer");
const errorMessage = document.getElementById('errorMessage');

delay(60_000).then(() => {
    PushcaClient.stopWebSocket();
    displayCaptchaContainer.style.display = 'none';
    errorMessage.textContent = `You can try better next time!`;
    errorMessage.style.display = 'block';
});

PushcaClient.onHumanTokenHandler = function (token) {
    PushcaClient.stopWebSocket();
    displayCaptchaContainer.style.display = 'none';
    errorMessage.textContent = `Congratulations! You've successfully proven your humanity and unlocked your unique human token. Amazing job!`;
    errorMessage.style.display = 'block';
}
PushcaClient.onCaptchaSetHandler = async function (binaryWithHeader) {
    const captchaId = binaryWithHeader.binaryId;
    const captchaBinaries = CaptchaSetBinaries.fromBytes(
        binaryWithHeader.payload
    );
    const blob = new Blob([captchaBinaries.captcha], {type: 'image/png'});
    const blobUrl = URL.createObjectURL(blob);
    captchaImage.src = blobUrl;
    captchaImage.onload = function () {
        captchaImage.style.display = 'block';
        URL.revokeObjectURL(blobUrl);
    };

    const existingButtons = document.querySelectorAll('.dynamic-button');
    existingButtons.forEach(button => {
        const removeEvent = new Event('remove', {bubbles: true});
        button.dispatchEvent(removeEvent);
        button.remove();
    });
    DynamicCaptcha.blocked = false;
    captchaBinaries.results.forEach((arrayBuffer, index) => {
        addResults(captchaId, arrayBuffer, index);
    });
};

function addResults(captchaId, arrayBuffer, index) {
    const blob = new Blob([arrayBuffer], {type: 'image/png'});
    const blobUrl = URL.createObjectURL(blob);

    const button = document.createElement('button');
    button.classList.add('dynamic-button');
    button.style.backgroundImage = `url('${blobUrl}')`;

    button.addEventListener('click', async function () {
        if (DynamicCaptcha.blocked) {
            return;
        }
        DynamicCaptcha.blocked = true;
        await PushcaClient.CaptchaVerify(
            captchaId,
            DynamicCaptcha.pageId,
            index,
            DynamicCaptcha.backendUrl
        );
        //alert(`Button ${captchaId}/${index + 1} clicked!`);
    });

    resultsContainer.appendChild(button);

    button.addEventListener('remove', () => {
        URL.revokeObjectURL(blobUrl);
    });
}

openWsConnection();

//================================== Web socket connection =============================================================

async function openWsConnection() {
    if (!PushcaClient.isOpen()) {
        const pClient = new ClientFilter(
            "SecureFileShare",
            "dynamic-captcha",
            DynamicCaptcha.backendUrl ? uuid.v4().toString() : DynamicCaptcha.pageId,
            "CAPTCHA_APP"
        );
        await PushcaClient.openWsConnection(
            DynamicCaptcha.wsUrl,
            pClient,
            function (clientObj) {
                return new ClientFilter(
                    clientObj.workSpaceId,
                    clientObj.accountId,
                    clientObj.deviceId,
                    clientObj.applicationId
                );
            }
        );
    }
}

//======================================================================================================================
