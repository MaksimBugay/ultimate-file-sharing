//PuzzleCaptchaSetBinaries
const PuzzleCaptcha = {}
PuzzleCaptcha.initiated = false;
PuzzleCaptcha.solvingAttempt = 1;
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
if (urlParams.get('piece-length')) {
    PuzzleCaptcha.pieceLength = urlParams.get('piece-length');
    if (PuzzleCaptcha.pieceLength < 300) {
        PuzzleCaptcha.pieceLength = 300;
    }
} else {
    PuzzleCaptcha.pieceLength = 300;
}
PuzzleCaptcha.showTask = true;
PuzzleCaptcha.skipDemo = true;

const puzzleCaptchaArea = document.getElementById("puzzleCaptchaArea");
const selectedCaptchaPiece = document.getElementById("selectedCaptchaPiece");
const errorMessage = document.getElementById('errorMessage');
const brandNameDiv = document.getElementById("brandNameDiv");
const showTaskBtn = document.getElementById("showTaskBtn");
const viewDemoBtn = document.getElementById("viewDemoBtn");
const captchaHint = document.getElementById('captchaHint');
const captchaCaptionContainer = document.getElementById("captchaCaptionContainer");

function showTask() {
    delay(500).then(() => {
        captchaHint.style.display = 'flex';
        delay(5000).then(() => {
            captchaHint.style.display = 'none';
        });
    });
}

showTaskBtn.addEventListener("click", function () {
    showTask();
});

showTaskBtn.addEventListener(
    "touchstart",
    function (event) {
        event.preventDefault();
        showTask();
    },
    {passive: false}
);

function viewDemo() {
    delay(300).then(() => {
        window.open(
            "https://secure.fileshare.ovh/videos/similarity-captcha-demo.mp4",
            "_blank"
        );
    });
}

viewDemoBtn.addEventListener("click", function () {
    viewDemo();
});

viewDemoBtn.addEventListener(
    "touchstart",
    function (event) {
        event.preventDefault();
        viewDemo();
    },
    {passive: false}
);

async function removeTaskElementsAndStart() {
    if (captchaHint) {
        captchaHint.style.display = "none";
    }
    captchaCaptionContainer.style.display = 'flex';
    await openWsConnection();
}

async function showCaptchaHintAndStart() {
    await openWsConnection();
    captchaCaptionContainer.style.display = 'flex';
    if (captchaHint && (!PuzzleCaptcha.initiated)) {
        showTask();
        PuzzleCaptcha.initiated = true;
    }
}

window.addEventListener("DOMContentLoaded", async function () {
    brandNameDiv.title = "Task: find matching shapes and drag one onto its pair to align them.";

    if (!PuzzleCaptcha.showTask) {
        await removeTaskElementsAndStart();
        return;
    }

    if (PuzzleCaptcha.skipDemo) {
        await showCaptchaHintAndStart();
    }
});

// Add CSS styles for iOS/macOS compatibility
function addCompatibilityStyles() {
    const style = document.createElement('style');
    style.textContent = `
        #puzzleCaptchaArea, #selectedCaptchaPiece {
            touch-action: none;
            -webkit-user-select: none;
            user-select: none;
            -webkit-touch-callout: none;
            -webkit-tap-highlight-color: transparent;
        }
        body.dragging {
            overflow: hidden;
            position: fixed;
            width: 100%;
            -webkit-overflow-scrolling: touch;
        }
        * {
            -webkit-touch-callout: none;
            -webkit-user-select: none;
            -khtml-user-select: none;
            -moz-user-select: none;
            -ms-user-select: none;
            user-select: none;
        }
    `;
    document.head.appendChild(style);
}

// Improved mobile detection
function isMobile() {
    return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) ||
        (navigator.maxTouchPoints && navigator.maxTouchPoints > 1) ||
        window.innerWidth <= 500;
}

// Fixed coordinate calculation for iOS/macOS
function getEventCoordinates(event) {
    let clientX, clientY;

    if (event.touches && event.touches.length > 0) {
        clientX = event.touches[0].clientX;
        clientY = event.touches[0].clientY;
    } else if (event.changedTouches && event.changedTouches.length > 0) {
        clientX = event.changedTouches[0].clientX;
        clientY = event.changedTouches[0].clientY;
    } else {
        clientX = event.clientX || event.pageX;
        clientY = event.clientY || event.pageY;
    }

    return {x: clientX, y: clientY};
}


let pieceDisplayDeltaX = 100;
let pieceDisplayDeltaY = 100;
if (isMobile()) {
    pieceDisplayDeltaX = 200;
    pieceDisplayDeltaY = 200;
}

let isDragging = false;
let lastMoveTime = 0;

// Initialize mobile-specific settings
function initializeMobileSettings() {
    if (isMobile()) {
        document.body.style.touchAction = 'none';
        document.body.style.userSelect = 'none';
        document.body.style.webkitUserSelect = 'none';
        document.body.style.webkitTouchCallout = 'none';
        pieceDisplayDeltaY = 100;

        // Prevent zoom on double tap
        let lastTouchEnd = 0;
        document.addEventListener('touchend', function (event) {
            const now = (new Date()).getTime();
            if (now - lastTouchEnd <= 300) {
                event.preventDefault();
            }
            lastTouchEnd = now;
        }, false);

        // Prevent pinch zoom
        document.addEventListener('touchstart', function (event) {
            if (event.touches.length > 1) {
                event.preventDefault();
            }
        }, {passive: false});

        document.addEventListener('gesturestart', function (event) {
            event.preventDefault();
        }, {passive: false});
    }
}

function puzzleCaptchaPointerDown() {
    return function (event) {
        if (!event.isTrusted) return;
        if (PuzzleCaptcha.correctOptionWasSelected) {
            isDragging = true;
            document.body.classList.add('dragging');

            const {x, y} = getEventCoordinates(event);
            const absX = x;
            const absY = y;

            selectedCaptchaPiece.style.display = 'block';
            selectedCaptchaPiece.style.left = `${absX - pieceDisplayDeltaX}px`;
            selectedCaptchaPiece.style.top = `${absY - pieceDisplayDeltaY}px`;
            selectedCaptchaPiece.style.pointerEvents = 'none'; // Prevent interference

            const rect = selectedCaptchaPiece.getBoundingClientRect();
            PuzzleCaptcha.pieceStartPoint = {x: rect.left, y: rect.top};
            PuzzleCaptcha.correctOptionWasSelected = false;
            event.preventDefault();
            event.stopPropagation();
        }
    };
}

function puzzleCaptchaPointerMove() {
    return function (event) {
        if (!event.isTrusted) return;
        if (!isDragging) return;
        const now = Date.now();
        if (now - lastMoveTime < 16) return; // ~60fps throttling
        lastMoveTime = now;
        const {x, y} = getEventCoordinates(event);
        const absX = x;
        const absY = y;

        requestAnimationFrame(() => {
            selectedCaptchaPiece.style.left = `${absX - pieceDisplayDeltaX}px`;
            selectedCaptchaPiece.style.top = `${absY - pieceDisplayDeltaY}px`;
        });
        event.preventDefault();
        event.stopPropagation();
    };
}

function puzzleCaptchaPointerUp() {
    return async function (event) {
        if (!isDragging) return;
        isDragging = false;
        if (!event.isTrusted) return;

        document.body.classList.remove('dragging');
        const rect = selectedCaptchaPiece.getBoundingClientRect();
        selectedCaptchaPiece.style.display = 'none';
        selectedCaptchaPiece.style.pointerEvents = 'auto';

        const finalX = Math.round(PuzzleCaptcha.startPoint.x + (rect.left - PuzzleCaptcha.pieceStartPoint.x));
        const finalY = Math.round(PuzzleCaptcha.startPoint.y + (rect.top - PuzzleCaptcha.pieceStartPoint.y));
        console.log({x: finalX, y: finalY});

        try {
            await PushcaClient.verifyPuzzleCaptcha(
                PuzzleCaptcha.captchaId, PuzzleCaptcha.pageId, finalX - pieceDisplayDeltaX, finalY - pieceDisplayDeltaY
            );
        } catch (error) {
            console.error('Verification error:', error);
        }
        await delay(2000);
        if (PushcaClient.isOpen()) {
            reloadOnFail(true);
        }

        event.preventDefault();
        event.stopPropagation();
    };
}

// Setup event listeners with proper options

function supportsMouseEvents() {
    return 'onmousedown' in window &&
        'onmousemove' in window &&
        'onmouseup' in window;
}

function hasMousePointer() {
    return matchMedia("(pointer: fine)").matches;
}

function isDesktopMouseAvailable() {
    return supportsMouseEvents() && hasMousePointer();
}

function setupEventListeners() {
    const passiveOptions = {passive: false}; // Non-passive for preventDefault to work

    if (isDesktopMouseAvailable()) {
        // Mouse events for desktop
        document.addEventListener('mousedown', puzzleCaptchaPointerDown());
        document.addEventListener('mousemove', puzzleCaptchaPointerMove());
        document.addEventListener('mouseup', puzzleCaptchaPointerUp());
    } else {
        // Touch events for mobile
        document.addEventListener('touchstart', function (event) {
            event.preventDefault();
            puzzleCaptchaPointerDown()(event);
        }, passiveOptions);
        document.addEventListener('touchmove', function (event) {
            event.preventDefault();
            puzzleCaptchaPointerMove()(event);
        }, passiveOptions);
        document.addEventListener('touchend', async function (event) {
            event.preventDefault();
            await puzzleCaptchaPointerUp()(event);
        }, passiveOptions);
        document.addEventListener('touchcancel', async function (event) {
            event.preventDefault();
            await puzzleCaptchaPointerUp()(event);
        }, passiveOptions);
    }

    // Prevent context menu on long press (iOS)
    document.addEventListener('contextmenu', function (event) {
        if (isDragging) {
            event.preventDefault();
        }
    });

    // Prevent text selection during drag
    document.addEventListener('selectstart', function (event) {
        if (isDragging) {
            event.preventDefault();
        }
    });

    // Prevent drag image on desktop
    document.addEventListener('dragstart', function (event) {
        event.preventDefault();
    });
}

function drawPiece(x, y) {
    const ctx = puzzleCaptchaArea.getContext('2d');
    const img = new Image();
    img.onload = function () {
        ctx.drawImage(img, x, y);
    };
    img.src = selectedCaptchaPiece.src;
}

// Fixed canvas touch handling
function selectPuzzleCaptchaPiecePointerDown() {
    return async function (event) {
        const rect = this.getBoundingClientRect();

        let x, y;
        if (event.touches && event.touches.length > 0) {
            // Mobile touch - use getBoundingClientRect for accurate positioning
            const touch = event.touches[0];
            x = touch.clientX - rect.left;
            y = touch.clientY - rect.top;
        } else {
            // Desktop mouse
            x = event.clientX - rect.left;
            y = event.clientY - rect.top;
        }

        PuzzleCaptcha.startPoint = {x: x, y: y};
        console.log(PuzzleCaptcha.startPoint);
        try {
            const result = await PushcaClient.verifySelectedPieceOfPuzzleCaptcha(
                PuzzleCaptcha.captchaId, PuzzleCaptcha.pageId, x, y
            );
            PuzzleCaptcha.correctOptionWasSelected = JSON.parse(result).body === 'true';
        } catch (error) {
            console.error('Verification error:', error);
            PuzzleCaptcha.correctOptionWasSelected = false;
        }
        event.preventDefault();
        event.stopPropagation();
        if (PuzzleCaptcha.correctOptionWasSelected) {
            puzzleCaptchaPointerDown()(event);
        } else {
            if (PuzzleCaptcha.solvingAttempt < 2) {
                PuzzleCaptcha.solvingAttempt = PuzzleCaptcha.solvingAttempt + 1;
                errorMessage.textContent = `Selected shape has no sibling, one attempt left`;
                errorMessage.style.display = 'block';
                delay(3000).then(() => errorMessage.style.display = 'none');
            } else {
                reloadOnFail(true);
            }
        }
    };
}

// Initialize everything
function initializePuzzleCaptcha() {
    addCompatibilityStyles();
    initializeMobileSettings();
    setupEventListeners();

    // Brand name click handler
    if (brandNameDiv) {
        brandNameDiv.addEventListener('click', function () {
            window.open("https://sl-st.com", '_blank');
        });
    }

    // Timeout handler
    delay(60_000).then(() => {
        reloadOnFail(true);
    });
}

function reloadOnFail(showError) {
    PushcaClient.stopWebSocket();
    if (showError) {
        errorMessage.textContent = `You can try better next time!`;
        errorMessage.style.display = 'block';
    }
    sendChallengeWasNotSolvedEvent().then(
        () => {
            delay(5000).then(
                () => {
                    puzzleCaptchaArea.style.display = 'none';
                    const url = new URL(window.location.href);
                    url.searchParams.set('hide-task', 'true');
                    window.location.href = url.toString();
                }
            );
        }
    );
}

// WebSocket handlers
PushcaClient.onOpenHandler = async function () {
    await PushcaClient.RequestPuzzleCaptcha(PuzzleCaptcha.captchaId, PuzzleCaptcha.pieceLength);

    let numberOfAttempt = 0;
    while (!PuzzleCaptcha.loaded) {
        await delay(100);
        numberOfAttempt++;
        if (numberOfAttempt > 50) {
            reloadOnFail(false);
        }
    }
    await delay(300);
}

PushcaClient.onHumanTokenHandler = function (token) {
    console.log(`Human token was received: ${token}`)
    PushcaClient.stopWebSocket();
    puzzleCaptchaArea.style.display = 'none';
    errorMessage.style.color = "green";
    errorMessage.textContent = `Your Human token was assigned. Amazing job!`;
    if (!PuzzleCaptcha.embedded) {
        errorMessage.style.display = 'block';
    }

    delay(1500).then(() => {
        location.reload();
    });
}
PushcaClient.onPuzzleCaptchaSetHandler = async function (binaryWithHeader) {
    const puzzleCaptchaData = binaryWithHeader.payload;
    const blob = new Blob([puzzleCaptchaData], {type: 'image/png'});
    const blobUrl = URL.createObjectURL(blob);
    //downloadFile(blob, "similarity_challenge_grid.png");
    if (PuzzleCaptcha.loaded) {
        selectedCaptchaPiece.src = blobUrl;
        selectedCaptchaPiece.onload = function () {
            URL.revokeObjectURL(blobUrl);
        };
        selectedCaptchaPiece.onerror = function () {
            URL.revokeObjectURL(blobUrl);
        };
    } else {
        const ctx = puzzleCaptchaArea.getContext('2d');
        const img = new Image();
        img.onload = function () {
            // Set canvas size to exact image dimensions
            puzzleCaptchaArea.width = img.naturalWidth;
            puzzleCaptchaArea.height = img.naturalHeight;

            puzzleCaptchaArea.style.width = `${img.naturalWidth}px`;
            puzzleCaptchaArea.style.height = `${img.naturalHeight}px`;

            // Draw image at exact size
            ctx.drawImage(img, 0, 0);
            URL.revokeObjectURL(blobUrl);

            // Add event listener after image is loaded
            if (isMobile()) {
                puzzleCaptchaArea.addEventListener('touchstart', selectPuzzleCaptchaPiecePointerDown(), {passive: false});
            } else {
                puzzleCaptchaArea.addEventListener('mousedown', selectPuzzleCaptchaPiecePointerDown());
            }

            PuzzleCaptcha.loaded = true;
            //alert(`${rect.width} : ${rect.height} [${this.width} : ${this.height}]`);
            //610x1280
        };
        img.onerror = function () {
            URL.revokeObjectURL(blobUrl);
            console.error('Failed to load puzzle image');
        };
        img.src = blobUrl;
    }
    await sendChallengeStartedAcknowledge();
};

async function sendChallengeStartedAcknowledge() {
    await sendChallengeEventMessage("VISUAL_SIMILARITY_CHALLENGE_WAS_STARTED");
}

async function sendChallengeWasNotSolvedEvent() {
    await sendChallengeEventMessage("VISUAL_SIMILARITY_CHALLENGE_WAS_NOT_SOLVED");
}

async function sendChallengeEventMessage(eventType) {
    if (!PuzzleCaptcha.pageId) {
        return;
    }
    const pClient = new ClientFilter(
        "SecureFileShare",
        "dynamic-captcha",
        PuzzleCaptcha.pageId,
        "CAPTCHA_CLIENT"
    );
    await PushcaClient.broadcastMessage(
        null,
        pClient,
        false,
        `${eventType}::${PuzzleCaptcha.pageId}`
    );
}


// WebSocket connection
async function openWsConnection() {
    if (!PushcaClient.isOpen()) {
        const pClient = new ClientFilter(
            "SecureFileShare",
            "dynamic-captcha",
            PuzzleCaptcha.pageId,
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

// Helper function for delay
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializePuzzleCaptcha);
} else {
    initializePuzzleCaptcha();
}












