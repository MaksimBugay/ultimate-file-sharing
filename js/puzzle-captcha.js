//PuzzleCaptchaSetBinaries

class PuzzleCaptchaSetBinaries {
    constructor(puzzleArea, selectedPiece) {
        this.puzzleArea = puzzleArea;
        this.selectedPiece = selectedPiece;
    }

    static fromBytes(arrayBuffer) {
        return new PuzzleCaptchaSetBinaries(arrayBuffer, null);
    }
}

const PuzzleCaptcha = {}
PuzzleCaptcha.serverUrl = 'https://secure.fileshare.ovh';
PuzzleCaptcha.wsUrl = 'wss://secure.fileshare.ovh:31085';
PuzzleCaptcha.captchaId = uuid.v4().toString();
PuzzleCaptcha.pageId = uuid.v4().toString();
PuzzleCaptcha.backendUrl = null;
PuzzleCaptcha.blocked = false;
PuzzleCaptcha.embedded = false;

const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get('page-id')) {
    PuzzleCaptcha.pageId = urlParams.get('page-id');
    PuzzleCaptcha.embedded = true;
}

if (urlParams.get('backend-url')) {
    PuzzleCaptcha.backendUrl = urlParams.get('backend-url');
}

const displayCaptchaContainer = document.getElementById("displayCaptchaContainer");
const puzzleCaptchaArea = document.getElementById("puzzleCaptchaArea");
const errorMessage = document.getElementById('errorMessage');
const brandNameDiv = document.getElementById("brandNameDiv");

brandNameDiv.addEventListener('click', function () {
    window.open("https://sl-st.com", '_blank');
});

delay(600_000).then(() => {
    PushcaClient.stopWebSocket();
    displayCaptchaContainer.style.display = 'none';
    errorMessage.textContent = `You can try better next time!`;
    errorMessage.style.display = 'block';
});

PushcaClient.onOpenHandler = async function () {
    await PushcaClient.RequestPuzzleCaptcha(PuzzleCaptcha.captchaId, 200);
}

PushcaClient.onHumanTokenHandler = function (token) {
    PushcaClient.stopWebSocket();
    displayCaptchaContainer.style.display = 'none';
    errorMessage.textContent = `Congratulations! You've successfully proven your humanity and unlocked your unique human token. Amazing job!`;
    errorMessage.style.display = 'block';
}
PushcaClient.onPuzzleCaptchaSetHandler = async function (binaryWithHeader) {
    const captchaBinaries = PuzzleCaptchaSetBinaries.fromBytes(
        binaryWithHeader.payload
    );
    const blob = new Blob([captchaBinaries.puzzleArea], {type: 'image/png'});
    const blobUrl = URL.createObjectURL(blob);

    const ctx = puzzleCaptchaArea.getContext('2d');
    const img = new Image();
    img.onload = function() {
        // Set canvas size to exact image dimensions
        puzzleCaptchaArea.width = img.naturalWidth;
        puzzleCaptchaArea.height = img.naturalHeight;
        // Draw image at exact size
        ctx.drawImage(img, 0, 0);

        URL.revokeObjectURL(blobUrl);
    };
    puzzleCaptchaArea.addEventListener('click', async function(event) {
        const rect = this.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        console.log(`Canvas coordinates: x=${Math.round(x)}, y=${Math.round(y)}`);

        const result = await PushcaClient.verifySelectedPieceOfPuzzleCaptcha(
            PuzzleCaptcha.captchaId, PuzzleCaptcha.pageId, x, y
        );
        console.log(result);
    });
    img.src = blobUrl;
};


openWsConnection();

//================================== Web socket connection =============================================================

async function openWsConnection() {
    if (!PushcaClient.isOpen()) {
        const pClient = new ClientFilter(
            "SecureFileShare",
            "dynamic-captcha",
            PuzzleCaptcha.embedded ? uuid.v4().toString() : PuzzleCaptcha.pageId,
            "PUZZLE_CAPTCHA_APP"
        );
        await PushcaClient.openWsConnection(
            PuzzleCaptcha.wsUrl,
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
