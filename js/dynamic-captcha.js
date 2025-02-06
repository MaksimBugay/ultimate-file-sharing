
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
};

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
