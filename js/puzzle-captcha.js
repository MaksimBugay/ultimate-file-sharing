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
if (urlParams.get('piece-length')) {
    PuzzleCaptcha.pieceLength = urlParams.get('piece-length');
} else {
    PuzzleCaptcha.pieceLength = 180;
}
if (urlParams.get('hide-task')) {
    PuzzleCaptcha.showTask = urlParams.get('hide-task') !== 'true';
} else {
    PuzzleCaptcha.showTask = true;
}
const displayCaptchaContainer = document.getElementById("displayCaptchaContainer");
const puzzleCaptchaArea = document.getElementById("puzzleCaptchaArea");
const selectedCaptchaPiece = document.getElementById("selectedCaptchaPiece");
const errorMessage = document.getElementById('errorMessage');
const brandNameDiv = document.getElementById("brandNameDiv");

window.addEventListener("DOMContentLoaded", async function () {
    brandNameDiv.title = "Task: Find the shape in the bottom section that exactly matches the shape at the top.\nInstructions: Drag the matching shape onto the top shape until it fully overlaps (100% alignment).";

    const puzzleCaptchaDemo = document.getElementById('puzzleCaptchaDemo');
    const captchaHint = document.getElementById('captchaHint');
    if (puzzleCaptchaDemo) {
        if (PuzzleCaptcha.showTask) {
            puzzleCaptchaDemo.addEventListener('play', function () {
                //console.log('▶️ Video has started playing.');
                brandNameDiv.style.display = 'none';
                if (captchaHint) {
                    captchaHint.remove();
                }
            });
            puzzleCaptchaDemo.addEventListener('ended', async function () {
                //console.log('🎬 Video has finished playing.');
                puzzleCaptchaDemo.remove();
                brandNameDiv.style.display = 'flex';
                await openWsConnection();
            });
        } else {
            if (captchaHint) {
                captchaHint.remove();
            }
            puzzleCaptchaDemo.remove();
            await openWsConnection();
        }
    } else {
        if (captchaHint) {
            if (PuzzleCaptcha.showTask) {
                await delay(3000);
            }
            captchaHint.remove();
            await openWsConnection();
        }
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

let pieceDisplayDeltaY = 50;
let pieceDisplayDeltaX = 20;
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
            const absX = x - 10;
            const absY = y - 10;

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
        const absX = x - 10;
        const absY = y - 10;

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

        const finalX = Math.round(PuzzleCaptcha.startPoint.x + (rect.left - PuzzleCaptcha.pieceStartPoint.x)) - 10;
        const finalY = Math.round(PuzzleCaptcha.startPoint.y + (rect.top - PuzzleCaptcha.pieceStartPoint.y)) - 10;
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
            reloadOnFail();
        }

        event.preventDefault();
        event.stopPropagation();
    };
}

// Setup event listeners with proper options for iOS
function setupEventListeners() {
    const passiveOptions = {passive: false}; // Non-passive for preventDefault to work

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
    // Mouse events for desktop
    document.addEventListener('mousedown', puzzleCaptchaPointerDown());
    document.addEventListener('mousemove', puzzleCaptchaPointerMove());
    document.addEventListener('mouseup', puzzleCaptchaPointerUp());

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

        // Account for canvas scaling and device pixel ratio
        const canvasScale = {
            x: this.width / rect.width,
            y: this.height / rect.height
        };

        x = x * canvasScale.x;
        y = y * canvasScale.y;

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
            reloadOnFail();
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
        reloadOnFail();
    });
}

function reloadOnFail() {
    PushcaClient.stopWebSocket();
    displayCaptchaContainer.style.display = 'none';
    errorMessage.textContent = `You can try better next time!`;
    errorMessage.style.display = 'block';
    delay(1500).then(() => {
        const url = new URL(window.location.href);
        url.searchParams.set('hide-task', 'true');
        window.location.href = url.toString();
    });
}

// WebSocket handlers
PushcaClient.onOpenHandler = async function () {
    await PushcaClient.RequestPuzzleCaptcha(PuzzleCaptcha.captchaId, PuzzleCaptcha.pieceLength);

    while (!PuzzleCaptcha.loaded) {
        await delay(100);
    }
    await delay(300);

    if (!isFullyVisible(displayCaptchaContainer)) {
        if (PuzzleCaptcha.pieceLength !== 140) {
            const url = new URL(window.location.href);
            url.searchParams.set('piece-length', '140');
            window.location.href = url.toString();
        }
    }
}
PushcaClient.onHumanTokenHandler = function (token) {
    PushcaClient.stopWebSocket();
    displayCaptchaContainer.style.display = 'none';
    errorMessage.textContent = `Congratulations! You've successfully proven your humanity and unlocked your unique human token ${token}. Amazing job!`;
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

            // Set CSS dimensions for proper scaling
            const maxWidth = Math.min(window.innerWidth * 0.9, img.naturalWidth);
            const scale = maxWidth / img.naturalWidth;
            puzzleCaptchaArea.style.width = `${img.naturalWidth * scale}px`;
            puzzleCaptchaArea.style.height = `${img.naturalHeight * scale}px`;

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
        };
        img.onerror = function () {
            URL.revokeObjectURL(blobUrl);
            console.error('Failed to load puzzle image');
        };
        img.src = blobUrl;
    }
};

// WebSocket connection
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













