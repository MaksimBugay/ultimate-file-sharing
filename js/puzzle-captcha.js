//PuzzleCaptchaSetBinaries

const PuzzleCaptcha = {}
PuzzleCaptcha.serverUrl = 'https://secure.fileshare.ovh';
PuzzleCaptcha.wsUrl = 'wss://secure.fileshare.ovh:31085';
PuzzleCaptcha.captchaId = uuid.v4().toString();
PuzzleCaptcha.pageId = uuid.v4().toString();
PuzzleCaptcha.backendUrl = null;
PuzzleCaptcha.blocked = false;
PuzzleCaptcha.embedded = false;
PuzzleCaptcha.loaded = false;
PuzzleCaptcha.correctOptionWasSelected = false;
PuzzleCaptcha.startPoint = {x: 0, y: 0};
PuzzleCaptcha.pieceStartPoint = {x: 0, y: 0}
PuzzleCaptcha.pieceCurrentPoint = {x: 0, y: 0}

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
const selectedCaptchaPiece = document.getElementById("selectedCaptchaPiece");
const errorMessage = document.getElementById('errorMessage');
const brandNameDiv = document.getElementById("brandNameDiv");

let isDragging = false;
let lastMoveTime = 0;
document.addEventListener('mousedown', function (event) {
    const absX = event.pageX - 10;
    const absY = event.pageY - 10;
    if (PuzzleCaptcha.correctOptionWasSelected) {
        isDragging = true;
        selectedCaptchaPiece.style.display = 'block';
        selectedCaptchaPiece.style.left = `${absX}px`;
        selectedCaptchaPiece.style.top = `${absY}px`;
        PuzzleCaptcha.pieceStartPoint = {x: absX, y: absY};
        PuzzleCaptcha.correctOptionWasSelected = false;
    }
});

document.addEventListener('mousemove', function (event) {
    if (!isDragging) return;

    const now = Date.now();
    if (now - lastMoveTime < 100) return; // throttle: only every 100 ms
    lastMoveTime = now;

    const absX = event.pageX - 10;
    const absY = event.pageY - 10;
    selectedCaptchaPiece.style.left = `${absX}px`;
    selectedCaptchaPiece.style.top = `${absY}px`;
    PuzzleCaptcha.pieceCurrentPoint = {x: absX, y: absY};
});
document.addEventListener('mouseup', function (event) {
    isDragging = false;
    selectedCaptchaPiece.style.display = `none`;

    const rect = selectedCaptchaPiece.getBoundingClientRect();
    const finalX = PuzzleCaptcha.startPoint.x + (PuzzleCaptcha.pieceCurrentPoint.x - PuzzleCaptcha.pieceStartPoint.x);
    const finalY = PuzzleCaptcha.startPoint.y + (PuzzleCaptcha.pieceCurrentPoint.y - PuzzleCaptcha.pieceStartPoint.y);
    console.log(`x = ${finalX}; y = ${finalY}`);
    //TODO just verify point now
});

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
    const puzzleCaptchaData = binaryWithHeader.payload;
    const blob = new Blob([puzzleCaptchaData], {type: 'image/png'});
    const blobUrl = URL.createObjectURL(blob);

    if (PuzzleCaptcha.loaded) {
        selectedCaptchaPiece.src = blobUrl;
        selectedCaptchaPiece.onload = function () {
            URL.revokeObjectURL(blobUrl);
        };
    } else {
        const ctx = puzzleCaptchaArea.getContext('2d');
        const img = new Image();
        img.onload = function () {
            // Set canvas size to exact image dimensions
            puzzleCaptchaArea.width = img.naturalWidth;
            puzzleCaptchaArea.height = img.naturalHeight;
            // Draw image at exact size
            ctx.drawImage(img, 0, 0);
            URL.revokeObjectURL(blobUrl);
        };
        puzzleCaptchaArea.addEventListener('mousedown', async function (event) {
            const rect = this.getBoundingClientRect();
            const x = event.clientX - rect.left;
            const y = event.clientY - rect.top;
            PuzzleCaptcha.startPoint = {x: x, y: y}
            console.log(`Canvas coordinates: x=${Math.round(x)}, y=${Math.round(y)}`);

            const result = await PushcaClient.verifySelectedPieceOfPuzzleCaptcha(
                PuzzleCaptcha.captchaId, PuzzleCaptcha.pageId, x, y
            );
            PuzzleCaptcha.correctOptionWasSelected = JSON.parse(result).body === 'true';
            console.log(result);
            document.dispatchEvent(event);
        });
        img.src = blobUrl;
        PuzzleCaptcha.loaded = true;
    }
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
