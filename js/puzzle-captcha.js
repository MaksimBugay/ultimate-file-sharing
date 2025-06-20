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

function puzzleCaptchaPointerDown() {
    return function (event) {
        const absX = event.pageX - 10;
        const absY = event.pageY - 10;
        if (PuzzleCaptcha.correctOptionWasSelected) {
            isDragging = true;
            selectedCaptchaPiece.style.display = 'block';
            selectedCaptchaPiece.style.left = `${absX}px`;
            selectedCaptchaPiece.style.top = `${absY}px`;
            const rect = selectedCaptchaPiece.getBoundingClientRect();
            PuzzleCaptcha.pieceStartPoint = {x: rect.left, y: rect.top};
            PuzzleCaptcha.correctOptionWasSelected = false;
        }
    };
}

document.addEventListener('mousedown', puzzleCaptchaPointerDown());
document.addEventListener('touchstart', puzzleCaptchaPointerDown());

function puzzleCaptchaPointerMove() {
    return function (event) {
        if (!isDragging) return;

        const now = Date.now();
        if (now - lastMoveTime < 100) return; // throttle: only every 100 ms
        lastMoveTime = now;

        const absX = event.pageX - 10;
        const absY = event.pageY - 10;
        selectedCaptchaPiece.style.left = `${absX}px`;
        selectedCaptchaPiece.style.top = `${absY}px`;
    };
}

document.addEventListener('mousemove', puzzleCaptchaPointerMove());
document.addEventListener('touchmove', puzzleCaptchaPointerMove());

function puzzleCaptchaPointerUp() {
    return async function (event) {
        isDragging = false;

        const rect = selectedCaptchaPiece.getBoundingClientRect();
        selectedCaptchaPiece.style.display = `none`;
        const finalX = Math.round(PuzzleCaptcha.startPoint.x + (rect.left - PuzzleCaptcha.pieceStartPoint.x)) - 10;
        const finalY = Math.round(PuzzleCaptcha.startPoint.y + (rect.top - PuzzleCaptcha.pieceStartPoint.y)) - 10;
        console.log({x: finalX, y: finalY});
        await PushcaClient.verifyPuzzleCaptcha(PuzzleCaptcha.captchaId, PuzzleCaptcha.pageId, finalX, finalY);

        //drawPiece(finalX, finalY);

        await delay(2000);

        if (PushcaClient.isOpen()) {
            PushcaClient.stopWebSocket();
            displayCaptchaContainer.style.display = 'none';
            errorMessage.textContent = `You can try better next time!`;
            errorMessage.style.display = 'block';
        }
    };
}

document.addEventListener('mouseup', puzzleCaptchaPointerUp());
document.addEventListener('touchend', puzzleCaptchaPointerUp());
document.addEventListener('touchcancel', puzzleCaptchaPointerUp());

function drawPiece(x, y) {
    const ctx = puzzleCaptchaArea.getContext('2d');
    const img = new Image();
    img.onload = function () {
        // Draw image at exact size
        ctx.drawImage(img, x, y);
    };
    img.src = selectedCaptchaPiece.src;
}

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
    await PushcaClient.RequestPuzzleCaptcha(PuzzleCaptcha.captchaId, 300);
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

            const result = await PushcaClient.verifySelectedPieceOfPuzzleCaptcha(
                PuzzleCaptcha.captchaId, PuzzleCaptcha.pageId, x, y
            );
            PuzzleCaptcha.correctOptionWasSelected = JSON.parse(result).body === 'true';
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
