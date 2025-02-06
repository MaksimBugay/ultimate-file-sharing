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

const serverUrl = 'https://secure.fileshare.ovh';
const wsUrl = 'wss://secure.fileshare.ovh:31085';

const captchaImage = document.getElementById("captchaImage");
const resultsContainer = document.getElementById("resultsContainer");

PushcaClient.onCaptchaSetHandler = async function (binaryWithHeader) {
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
    captchaBinaries.results.forEach((arrayBuffer, index) => {
        addResults(arrayBuffer, index);
    });
};

function addResults(arrayBuffer, index) {
    const blob = new Blob([arrayBuffer], {type: 'image/png'});
    const blobUrl = URL.createObjectURL(blob);

    const button = document.createElement('button');
    button.classList.add('dynamic-button');
    button.style.backgroundImage = `url('${blobUrl}')`;

    button.addEventListener('click', () => {
        alert(`Button ${index + 1} clicked!`);
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
            uuid.v4().toString(),
            "CAPTCHA_APP"
        );
        await PushcaClient.openWsConnection(
            wsUrl,
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
