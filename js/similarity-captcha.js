// ============================================================================
// CONFIGURATION & CONSTANTS
// ============================================================================

const CaptchaConfig = {
    // Server Configuration
    SERVER_URL: 'https://secure.fileshare.ovh',
    WS_URL: 'wss://secure.fileshare.ovh:31085',
    BRAND_URL: 'https://sl-st.com',

    // Application Settings
    WORKSPACE_ID: 'SecureFileShare',
    ACCOUNT_ID: 'dynamic-captcha',
    APP_ID: 'PUZZLE_CAPTCHA_APP',

    // Timing Constants (ms)
    HINT_DISPLAY_DURATION: 2000,
    RELOAD_DELAY: 1500,
    VERIFICATION_DELAY: 2000,
    STATE_UPDATE_DELAY: 10,
    LOAD_CHECK_INTERVAL: 100,
    CAPTCHA_TIMEOUT: 600000,
    IMAGE_LOAD_DELAY: 300,
    DOUBLE_TAP_THRESHOLD: 300,

    // Loading Attempts
    MAX_LOAD_ATTEMPTS: 50,

    // Piece Configuration
    MIN_PIECE_LENGTH: 300,
    DEFAULT_PIECE_LENGTH: 300,

    // Display Offsets
    DESKTOP_PIECE_OFFSET_X: 100,
    DESKTOP_PIECE_OFFSET_Y: 100,
    MOBILE_PIECE_OFFSET_X: 200,
    MOBILE_PIECE_OFFSET_Y: 200,
    IOS_PIECE_OFFSET_X: 80,
    IOS_PIECE_OFFSET_Y: 80,

    // Performance
    THROTTLE_FPS: 60,
    THROTTLE_MS: 16, // ~60fps

    // Device Detection
    MOBILE_WIDTH_THRESHOLD: 500,
    MOBILE_TOUCH_POINTS: 1,

    // Pointer IDs
    MOUSE_POINTER_ID: 1,

    // DOM Element IDs
    DOM_IDS: {
        CANVAS: 'puzzleCaptchaArea',
        PIECE: 'selectedCaptchaPiece',
        ERROR: 'errorMessage',
        BRAND: 'brandNameDiv',
        HINT: 'captchaHint'
    },

    // Messages
    MESSAGES: {
        TASK_HINT: 'Task: find matching shapes and drag one onto its pair to align them.',
        ERROR: 'You can try better next time!',
        SUCCESS: 'Your Human token was assigned. Amazing job!',
        WRONG_PIECE: 'Wrong piece selected, reloading'
    }
};

// ============================================================================
// UTILITY CLASSES
// ============================================================================

/**
 * Device detection and environment utilities
 */
class DeviceDetector {
    static isMobile() {
        return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) ||
            (navigator.maxTouchPoints && navigator.maxTouchPoints > CaptchaConfig.MOBILE_TOUCH_POINTS) ||
            window.innerWidth <= CaptchaConfig.MOBILE_WIDTH_THRESHOLD;
    }

    static isIOS() {
        return /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
            (navigator.platform && /iPad|iPhone|iPod/.test(navigator.platform));
    }

    static getEventCoordinates(event) {
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

    static createSyntheticPointerEvent(type, mouseEvent) {
        return new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            isPrimary: true,
            pointerId: CaptchaConfig.MOUSE_POINTER_ID,
            pointerType: 'mouse',
            clientX: mouseEvent.clientX,
            clientY: mouseEvent.clientY,
            isTrusted: mouseEvent.isTrusted
        });
    }

    static createSyntheticPointerEventFromTouch(type, touchEvent) {
        const touch = touchEvent.touches ? touchEvent.touches[0] : touchEvent.changedTouches[0];
        return new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            isPrimary: true,
            pointerId: touch.identifier + 2,
            pointerType: 'touch',
            clientX: touch.clientX,
            clientY: touch.clientY,
            isTrusted: touchEvent.isTrusted
        });
    }
}

/**
 * Simple promise-based delay utility
 */
class TimeUtils {
    static delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

/**
 * URL parameter parser
 */
class URLParamParser {
    constructor() {
        this.params = new URLSearchParams(window.location.search);
    }

    get(key) {
        return this.params.get(key);
    }

    has(key) {
        return this.params.has(key);
    }

    getInt(key, defaultValue) {
        const value = this.params.get(key);
        return value ? parseInt(value, 10) : defaultValue;
    }
}

// ============================================================================
// STATE MANAGEMENT
// ============================================================================

/**
 * Manages the application state
 * Single Responsibility: State management only
 */
class CaptchaState {
    constructor(urlParser) {
        this.captchaId = uuid.v4().toString();
        this.pageId = urlParser.get('page-id') || uuid.v4().toString();
        this.backendUrl = urlParser.get('backend-url');
        this.embedded = urlParser.has('page-id');

        const pieceLengthParam = urlParser.getInt('piece-length', CaptchaConfig.DEFAULT_PIECE_LENGTH);
        this.pieceLength = Math.max(pieceLengthParam, CaptchaConfig.MIN_PIECE_LENGTH);

        this.showTask = true;
        this.skipDemo = true;
        this.loaded = false;
        this.blocked = false;
        this.isVerifying = false;
        this.correctOptionWasSelected = false;

        this.startPoint = {x: 0, y: 0};
        this.pieceStartPoint = {x: 0, y: 0};
    }

    markLoaded() {
        this.loaded = true;
    }

    setStartPoint(x, y) {
        this.startPoint = {x, y};
    }

    setPieceStartPoint(x, y) {
        this.pieceStartPoint = {x, y};
    }

    setVerifying(isVerifying) {
        this.isVerifying = isVerifying;
    }

    setCorrectOptionSelected(isCorrect) {
        this.correctOptionWasSelected = isCorrect;
    }

    reset() {
        this.correctOptionWasSelected = false;
        this.isVerifying = false;
    }
}

/**
 * Manages drag state
 * Single Responsibility: Drag state only
 */
class DragState {
    constructor() {
        this.isDragging = false;
        this.activePointerId = null;
        this.lastMoveTime = 0;

        // iOS needs smaller offset for better visibility
        if (DeviceDetector.isIOS()) {
            this.pieceOffsetX = CaptchaConfig.IOS_PIECE_OFFSET_X;
            this.pieceOffsetY = CaptchaConfig.IOS_PIECE_OFFSET_Y;
        } else if (DeviceDetector.isMobile()) {
            this.pieceOffsetX = CaptchaConfig.MOBILE_PIECE_OFFSET_X;
            this.pieceOffsetY = CaptchaConfig.MOBILE_PIECE_OFFSET_Y;
        } else {
            this.pieceOffsetX = CaptchaConfig.DESKTOP_PIECE_OFFSET_X;
            this.pieceOffsetY = CaptchaConfig.DESKTOP_PIECE_OFFSET_Y;
        }
    }

    startDrag(pointerId) {
        this.isDragging = true;
        this.activePointerId = pointerId;
    }

    endDrag() {
        this.isDragging = false;
        this.activePointerId = null;
    }

    shouldThrottle() {
        const now = Date.now();
        if (now - this.lastMoveTime < CaptchaConfig.THROTTLE_MS) {
            return true;
        }
        this.lastMoveTime = now;
        return false;
    }

    isActivePointer(pointerId) {
        return pointerId === this.activePointerId;
    }
}

// ============================================================================
// UI MANAGEMENT
// ============================================================================

/**
 * Manages UI updates and DOM manipulation
 * Single Responsibility: UI operations
 */
class UIManager {
    constructor(elements) {
        this.canvas = elements.canvas;
        this.piece = elements.piece;
        this.errorMsg = elements.errorMsg;
        this.brand = elements.brand;
    }

    showPiece(x, y, offsetX, offsetY) {
        this.piece.style.display = 'block';
        this.piece.style.left = `${x - offsetX}px`;
        this.piece.style.top = `${y - offsetY}px`;
        this.piece.style.pointerEvents = 'none';
    }

    hidePiece() {
        this.piece.style.display = 'none';
        this.piece.style.pointerEvents = 'none';
    }

    updatePiecePosition(x, y, offsetX, offsetY) {
        requestAnimationFrame(() => {
            this.piece.style.left = `${x - offsetX}px`;
            this.piece.style.top = `${y - offsetY}px`;
        });
    }

    updatePiecePositionDirect(x, y, offsetX, offsetY) {
        // Direct update without requestAnimationFrame for iOS responsiveness
        this.piece.style.left = `${x - offsetX}px`;
        this.piece.style.top = `${y - offsetY}px`;
    }

    addDraggingClass() {
        document.body.classList.add('dragging');
    }

    removeDraggingClass() {
        document.body.classList.remove('dragging');
    }

    hideCanvas() {
        this.canvas.style.display = 'none';
    }

    showError(message, color = null) {
        if (color) {
            this.errorMsg.style.color = color;
        }
        this.errorMsg.textContent = message;
        this.errorMsg.style.display = 'block';
    }

    showBrand() {
        this.brand.style.display = 'flex';
    }

    getPieceRect() {
        return this.piece.getBoundingClientRect();
    }

    loadPieceImage(blobUrl) {
        return new Promise((resolve, reject) => {
            this.piece.src = blobUrl;
            this.piece.onload = () => {
                URL.revokeObjectURL(blobUrl);
                resolve();
            };
            this.piece.onerror = () => {
                URL.revokeObjectURL(blobUrl);
                reject(new Error('Failed to load piece image'));
            };
        });
    }

    loadCanvasImage(blobUrl) {
        const ctx = this.canvas.getContext('2d');
        const img = new Image();

        return new Promise((resolve, reject) => {
            img.onload = () => {
                this.canvas.width = img.naturalWidth;
                this.canvas.height = img.naturalHeight;
                this.canvas.style.width = `${img.naturalWidth}px`;
                this.canvas.style.height = `${img.naturalHeight}px`;
                ctx.drawImage(img, 0, 0);
                URL.revokeObjectURL(blobUrl);
                resolve();
            };
            img.onerror = () => {
                URL.revokeObjectURL(blobUrl);
                reject(new Error('Failed to load canvas image'));
            };
            img.src = blobUrl;
        });
    }

    getCanvasRelativeCoordinates(clientX, clientY) {
        const rect = this.canvas.getBoundingClientRect();
        return {
            x: clientX - rect.left,
            y: clientY - rect.top
        };
    }
}

/**
 * Manages CSS styles injection
 * Single Responsibility: Style management
 */
class StyleManager {
    static injectCompatibilityStyles() {
        const style = document.createElement('style');
        style.textContent = `
            #${CaptchaConfig.DOM_IDS.CANVAS} {
                touch-action: none;
                -webkit-user-select: none;
                user-select: none;
                -webkit-touch-callout: none;
                -webkit-tap-highlight-color: transparent;
            }
            #${CaptchaConfig.DOM_IDS.PIECE} {
                touch-action: manipulation;
                -webkit-user-select: none;
                user-select: none;
                -webkit-touch-callout: none;
                -webkit-tap-highlight-color: transparent;
                pointer-events: none;
            }
            body.dragging {
                overflow: hidden;
                -webkit-overflow-scrolling: auto;
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

    static initializeMobileSettings() {
        if (!DeviceDetector.isMobile()) return;

        document.body.style.touchAction = 'none';
        document.body.style.userSelect = 'none';
        document.body.style.webkitUserSelect = 'none';
        document.body.style.webkitTouchCallout = 'none';

        // Prevent zoom on double tap
        let lastTouchEnd = 0;
        document.addEventListener('touchend', (event) => {
            const now = Date.now();
            if (now - lastTouchEnd <= CaptchaConfig.DOUBLE_TAP_THRESHOLD) {
                event.preventDefault();
            }
            lastTouchEnd = now;
        }, false);

        // Prevent pinch zoom
        document.addEventListener('touchstart', (event) => {
            if (event.touches.length > 1) {
                event.preventDefault();
            }
        }, {passive: false});

        document.addEventListener('gesturestart', (event) => {
            event.preventDefault();
        }, {passive: false});
    }
}

// ============================================================================
// DRAG CONTROLLER
// ============================================================================

/**
 * Controls drag and drop logic
 * Single Responsibility: Drag operations
 */
class DragController {
    constructor(captchaState, dragState, uiManager, verificationCallback) {
        this.captchaState = captchaState;
        this.dragState = dragState;
        this.ui = uiManager;
        this.verificationCallback = verificationCallback;
        this.targetElement = null; // Store element for pointer capture
    }

    handlePointerDown(event, targetElement = null) {
        // Validate event
        if (event.isPrimary === false || !event.isTrusted || this.dragState.isDragging) {
            return;
        }

        // Check if correct option was selected
        if (!this.captchaState.correctOptionWasSelected) {
            return;
        }

        // Start drag
        this.dragState.startDrag(event.pointerId);
        this.ui.addDraggingClass();
        this.targetElement = targetElement;

        // CRITICAL FOR iOS: Set pointer capture
        if (targetElement && targetElement.setPointerCapture) {
            try {
                targetElement.setPointerCapture(event.pointerId);
                console.log('Pointer captured:', event.pointerId);
            } catch (e) {
                console.warn('Could not capture pointer:', e);
            }
        }

        const {x, y} = DeviceDetector.getEventCoordinates(event);
        this.ui.showPiece(x, y, this.dragState.pieceOffsetX, this.dragState.pieceOffsetY);

        const rect = this.ui.getPieceRect();
        this.captchaState.setPieceStartPoint(rect.left, rect.top);
        this.captchaState.setCorrectOptionSelected(false);

        event.preventDefault();
        event.stopPropagation();
    }

    handlePointerMove(event) {
        // Validate
        if (!this.dragState.isActivePointer(event.pointerId) ||
            !event.isTrusted ||
            !this.dragState.isDragging) {
            return;
        }

        // iOS needs immediate updates, desktop can throttle
        const isTouch = event.pointerType === 'touch' || DeviceDetector.isMobile();
        if (!isTouch && this.dragState.shouldThrottle()) {
            return;
        }

        const {x, y} = DeviceDetector.getEventCoordinates(event);
        // Direct update for touch (no requestAnimationFrame delay)
        this.ui.updatePiecePositionDirect(x, y, this.dragState.pieceOffsetX, this.dragState.pieceOffsetY);

        event.preventDefault();
        event.stopPropagation();
    }

    handlePointerUp(event) {
        // Validate
        if (!this.dragState.isActivePointer(event.pointerId) ||
            !this.dragState.isDragging ||
            !event.isTrusted) {
            return;
        }

        // Release pointer capture
        if (this.targetElement && this.targetElement.releasePointerCapture) {
            try {
                this.targetElement.releasePointerCapture(event.pointerId);
                console.log('Pointer released:', event.pointerId);
            } catch (e) {
                // Already released or not captured
            }
        }

        this.dragState.endDrag();
        this.ui.removeDraggingClass();

        const rect = this.ui.getPieceRect();
        this.ui.hidePiece();

        const finalX = Math.round(this.captchaState.startPoint.x +
            (rect.left - this.captchaState.pieceStartPoint.x));
        const finalY = Math.round(this.captchaState.startPoint.y +
            (rect.top - this.captchaState.pieceStartPoint.y));

        console.log('Drag completed at:', {x: finalX, y: finalY});

        // Verify asynchronously
        this.verifyDragPosition(finalX, finalY);

        event.preventDefault();
        event.stopPropagation();
    }

    async verifyDragPosition(finalX, finalY) {
        await TimeUtils.delay(CaptchaConfig.STATE_UPDATE_DELAY);

        try {
            await this.verificationCallback(
                finalX - this.dragState.pieceOffsetX,
                finalY - this.dragState.pieceOffsetY
            );
        } catch (error) {
            console.error('Verification error:', error);
        }
    }

    handleTouchCancel() {
        if (!this.dragState.isDragging) return;

        // Release pointer capture if active
        if (this.targetElement && this.targetElement.releasePointerCapture && this.dragState.activePointerId) {
            try {
                this.targetElement.releasePointerCapture(this.dragState.activePointerId);
            } catch (e) {
                // Already released
            }
        }

        this.dragState.endDrag();
        this.ui.removeDraggingClass();
        this.ui.hidePiece();
    }
}

// ============================================================================
// CANVAS INTERACTION CONTROLLER
// ============================================================================

/**
 * Handles canvas piece selection
 * Single Responsibility: Canvas interaction logic
 */
class CanvasInteractionController {
    constructor(captchaState, dragState, uiManager, dragController, verificationCallback, failureCallback) {
        this.captchaState = captchaState;
        this.dragState = dragState;
        this.ui = uiManager;
        this.dragController = dragController;
        this.verificationCallback = verificationCallback;
        this.failureCallback = failureCallback;
    }

    createClickHandler() {
        return async (event) => {
            // Prevent concurrent verifications
            if (this.captchaState.isVerifying || this.dragState.isDragging || !event.isPrimary) {
                return;
            }

            this.captchaState.setVerifying(true);

            try {
                const {x: clientX, y: clientY} = DeviceDetector.getEventCoordinates(event);
                const {x, y} = this.ui.getCanvasRelativeCoordinates(clientX, clientY);

                this.captchaState.setStartPoint(x, y);
                console.log('Canvas click detected at:', {x, y});

                const isCorrect = await this.verificationCallback(x, y);
                this.captchaState.setCorrectOptionSelected(isCorrect);

                console.log('Verification result:', isCorrect);

                event.preventDefault();
                event.stopPropagation();

                if (isCorrect) {
                    // Create synthetic pointer event to start drag
                    const pointerEvent = new PointerEvent('pointerdown', {
                        bubbles: true,
                        cancelable: true,
                        isPrimary: true,
                        pointerId: event.pointerId || (event.touches ? event.touches[0].identifier : CaptchaConfig.MOUSE_POINTER_ID),
                        pointerType: event.pointerType || (event.touches ? 'touch' : 'mouse'),
                        clientX: clientX,
                        clientY: clientY,
                        isTrusted: event.isTrusted
                    });
                    // Pass canvas element for pointer capture
                    this.dragController.handlePointerDown(pointerEvent, event.target || this.ui.canvas);
                } else {
                    console.log(CaptchaConfig.MESSAGES.WRONG_PIECE);
                    this.failureCallback(true);
                }
            } catch (error) {
                console.error('Piece selection error:', error);
                this.captchaState.setCorrectOptionSelected(false);
                this.failureCallback(true);
            } finally {
                this.captchaState.setVerifying(false);
            }
        };
    }
}

// ============================================================================
// EVENT COORDINATOR
// ============================================================================

/**
 * Coordinates all event listeners
 * Single Responsibility: Event delegation and coordination
 */
class EventCoordinator {
    constructor(dragController) {
        this.dragController = dragController;
        this.passiveOptions = {passive: false};
    }

    setupPointerEvents() {
        // Skip pointer events on iOS - use touch events instead
        if (DeviceDetector.isIOS()) {
            console.log('iOS detected - using touch events instead of pointer events');
            return;
        }

        document.addEventListener('pointerdown',
            (e) => this.dragController.handlePointerDown(e, e.target), this.passiveOptions);
        document.addEventListener('pointermove',
            (e) => this.dragController.handlePointerMove(e), this.passiveOptions);
        document.addEventListener('pointerup',
            (e) => this.dragController.handlePointerUp(e), this.passiveOptions);
        document.addEventListener('pointercancel',
            (e) => this.dragController.handlePointerUp(e), this.passiveOptions);
    }

    setupTouchFallbacks(dragState) {
        // On iOS, use touch events directly instead of pointer events
        const isIOS = DeviceDetector.isIOS();

        document.addEventListener('touchstart', (event) => {
            if (isIOS && this.dragController.captchaState.correctOptionWasSelected) {
                // Convert to pointer event for iOS
                const pointerEvent = DeviceDetector.createSyntheticPointerEventFromTouch('pointerdown', event);
                this.dragController.handlePointerDown(pointerEvent, event.target);
                event.preventDefault();
                return;
            }

            // Fallback for non-iOS devices
            if (this.dragController.captchaState.correctOptionWasSelected && event.isPrimary !== false) {
                event.preventDefault();
            }
        }, this.passiveOptions);

        document.addEventListener('touchmove', (event) => {
            if (isIOS && dragState.isDragging) {
                const pointerEvent = DeviceDetector.createSyntheticPointerEventFromTouch('pointermove', event);
                this.dragController.handlePointerMove(pointerEvent);
                event.preventDefault();
                return;
            }

            if (dragState.isDragging) {
                event.preventDefault();
            }
        }, this.passiveOptions);

        document.addEventListener('touchend', (event) => {
            if (isIOS && dragState.isDragging) {
                const pointerEvent = DeviceDetector.createSyntheticPointerEventFromTouch('pointerup', event);
                this.dragController.handlePointerUp(pointerEvent);
                event.preventDefault();
                return;
            }

            if (dragState.isDragging) {
                event.preventDefault();
            }
        }, this.passiveOptions);

        document.addEventListener('touchcancel', (event) => {
            if (dragState.isDragging) {
                this.dragController.handleTouchCancel();
                event.preventDefault();
            }
        }, this.passiveOptions);
    }

    setupMouseFallbacks(dragState) {
        document.addEventListener('mousedown', (event) => {
            const pointerEvent = DeviceDetector.createSyntheticPointerEvent('pointerdown', event);
            this.dragController.handlePointerDown(pointerEvent, event.target);
        }, this.passiveOptions);

        document.addEventListener('mousemove', (event) => {
            if (!dragState.isDragging) return;
            const pointerEvent = DeviceDetector.createSyntheticPointerEvent('pointermove', event);
            this.dragController.handlePointerMove(pointerEvent);
        }, this.passiveOptions);

        document.addEventListener('mouseup', (event) => {
            if (!dragState.isDragging) return;
            const pointerEvent = DeviceDetector.createSyntheticPointerEvent('pointerup', event);
            this.dragController.handlePointerUp(pointerEvent);
        }, this.passiveOptions);
    }

    setupPreventionHandlers(dragState) {
        // Prevent context menu on long press
        document.addEventListener('contextmenu', (event) => {
            if (dragState.isDragging) {
                event.preventDefault();
            }
        });

        // Prevent text selection during drag
        document.addEventListener('selectstart', (event) => {
            if (dragState.isDragging) {
                event.preventDefault();
            }
        });

        // Prevent drag image on desktop
        document.addEventListener('dragstart', (event) => {
            event.preventDefault();
        });
    }

    setupAllEventListeners(dragState) {
        this.setupPointerEvents();
        this.setupTouchFallbacks(dragState);
        this.setupMouseFallbacks(dragState);
        this.setupPreventionHandlers(dragState);
    }
}

// ============================================================================
// WEBSOCKET ADAPTER
// ============================================================================

/**
 * Adapts WebSocket client for captcha operations
 * Single Responsibility: WebSocket communication
 */
class WebSocketAdapter {
    constructor(captchaState, wsClient) {
        this.state = captchaState;
        this.client = wsClient;
    }

    async verifyPieceSelection(x, y) {
        const result = await this.client.verifySelectedPieceOfPuzzleCaptcha(
            this.state.captchaId,
            this.state.pageId,
            x,
            y
        );
        return JSON.parse(result).body === 'true';
    }

    async verifyDragPosition(x, y) {
        await this.client.verifyPuzzleCaptcha(
            this.state.captchaId,
            this.state.pageId,
            x,
            y
        );
    }

    async requestPuzzle() {
        await this.client.RequestPuzzleCaptcha(
            this.state.captchaId,
            this.state.pieceLength
        );
    }

    isOpen() {
        return this.client.isOpen();
    }

    stop() {
        this.client.stopWebSocket();
    }

    async connect() {
        if (this.isOpen()) return;

        const clientFilter = new ClientFilter(
            CaptchaConfig.WORKSPACE_ID,
            CaptchaConfig.ACCOUNT_ID,
            this.state.embedded ? uuid.v4().toString() : this.state.pageId,
            CaptchaConfig.APP_ID
        );

        await this.client.openWsConnection(
            CaptchaConfig.WS_URL,
            clientFilter,
            (clientObj) => new ClientFilter(
                clientObj.workSpaceId,
                clientObj.accountId,
                clientObj.deviceId,
                clientObj.applicationId
            )
        );
    }
}

// ============================================================================
// APPLICATION ORCHESTRATOR
// ============================================================================

/**
 * Main application class that orchestrates all components
 * Single Responsibility: Application lifecycle and coordination
 */
class PuzzleCaptchaApp {
    constructor() {
        // Initialize DOM elements
        this.elements = {
            canvas: document.getElementById(CaptchaConfig.DOM_IDS.CANVAS),
            piece: document.getElementById(CaptchaConfig.DOM_IDS.PIECE),
            errorMsg: document.getElementById(CaptchaConfig.DOM_IDS.ERROR),
            brand: document.getElementById(CaptchaConfig.DOM_IDS.BRAND)
        };

        // Initialize components
        this.urlParser = new URLParamParser();
        this.captchaState = new CaptchaState(this.urlParser);
        this.dragState = new DragState();
        this.uiManager = new UIManager(this.elements);
        this.wsAdapter = new WebSocketAdapter(this.captchaState, PushcaClient);

        // Create controllers
        this.dragController = new DragController(
            this.captchaState,
            this.dragState,
            this.uiManager,
            (x, y) => this.handleDragVerification(x, y)
        );

        this.canvasController = new CanvasInteractionController(
            this.captchaState,
            this.dragState,
            this.uiManager,
            this.dragController,
            (x, y) => this.wsAdapter.verifyPieceSelection(x, y),
            (showError) => this.reloadOnFail(showError)
        );

        this.eventCoordinator = new EventCoordinator(this.dragController);

        // Setup WebSocket handlers
        this.setupWebSocketHandlers();
    }

    async initialize() {
        // Inject styles
        StyleManager.injectCompatibilityStyles();
        StyleManager.initializeMobileSettings();

        // Setup events
        this.eventCoordinator.setupAllEventListeners(this.dragState);

        // Setup brand click
        if (this.elements.brand) {
            this.elements.brand.addEventListener('click', () => {
                window.open(CaptchaConfig.BRAND_URL, '_blank');
            });
        }

        // Setup timeout
        TimeUtils.delay(CaptchaConfig.CAPTCHA_TIMEOUT).then(() => {
            this.reloadOnFail(true);
        });
    }

    async handleDragVerification(x, y) {
        await this.wsAdapter.verifyDragPosition(x, y);
        await TimeUtils.delay(CaptchaConfig.VERIFICATION_DELAY);

        if (this.wsAdapter.isOpen()) {
            this.reloadOnFail(true);
        }
    }

    reloadOnFail(showError) {
        this.wsAdapter.stop();

        if (showError) {
            this.uiManager.hideCanvas();
            this.uiManager.showError(CaptchaConfig.MESSAGES.ERROR);
        }

        TimeUtils.delay(CaptchaConfig.RELOAD_DELAY).then(() => {
            const url = new URL(window.location.href);
            url.searchParams.set('hide-task', 'true');
            window.location.href = url.toString();
        });
    }

    setupWebSocketHandlers() {
        // On WebSocket open
        PushcaClient.onOpenHandler = async () => {
            await this.wsAdapter.requestPuzzle();

            let attempts = 0;
            while (!this.captchaState.loaded) {
                await TimeUtils.delay(CaptchaConfig.LOAD_CHECK_INTERVAL);
                attempts++;
                if (attempts > CaptchaConfig.MAX_LOAD_ATTEMPTS) {
                    this.reloadOnFail(false);
                    return;
                }
            }

            await TimeUtils.delay(CaptchaConfig.IMAGE_LOAD_DELAY);
        };

        // On token received
        PushcaClient.onHumanTokenHandler = (token) => {
            console.log(`Human token received: ${token}`);
            this.wsAdapter.stop();
            this.uiManager.hideCanvas();
            this.uiManager.showError(CaptchaConfig.MESSAGES.SUCCESS, 'green');

            if (!this.captchaState.embedded) {
                // Error message shown for non-embedded mode
            }

            TimeUtils.delay(CaptchaConfig.RELOAD_DELAY).then(() => {
                location.reload();
            });
        };

        // On puzzle data received
        PushcaClient.onPuzzleCaptchaSetHandler = async (binaryWithHeader) => {
            const blob = new Blob([binaryWithHeader.payload], {type: 'image/png'});
            const blobUrl = URL.createObjectURL(blob);

            if (this.captchaState.loaded) {
                // Load piece image
                await this.uiManager.loadPieceImage(blobUrl);
            } else {
                // Load canvas image
                await this.uiManager.loadCanvasImage(blobUrl);

                // Setup canvas click handler
                const clickHandler = this.canvasController.createClickHandler();
                this.elements.canvas.addEventListener('pointerdown', clickHandler, {passive: false});
                this.elements.canvas.addEventListener('touchstart', clickHandler, {passive: false});
                this.elements.canvas.addEventListener('mousedown', clickHandler, {passive: false});

                this.captchaState.markLoaded();
                console.log('Puzzle image loaded successfully');
            }
        };
    }

    async start() {
        this.elements.brand.title = CaptchaConfig.MESSAGES.TASK_HINT;

        const hintElement = document.getElementById(CaptchaConfig.DOM_IDS.HINT);

        if (!this.captchaState.showTask) {
            if (hintElement) hintElement.remove();
            this.uiManager.showBrand();
            await this.wsAdapter.connect();
            return;
        }

        if (this.captchaState.skipDemo) {
            this.uiManager.showBrand();
            if (hintElement) {
                hintElement.style.display = 'flex';
                await TimeUtils.delay(CaptchaConfig.HINT_DISPLAY_DURATION);
                hintElement.remove();
            }
            await this.wsAdapter.connect();
        }
    }
}

// ============================================================================
// APPLICATION BOOTSTRAP
// ============================================================================

// Create and initialize application
let captchaApp;

function initializeApplication() {
    captchaApp = new PuzzleCaptchaApp();
    captchaApp.initialize();
}

// Start when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeApplication);
} else {
    initializeApplication();
}

// Start application flow when DOM content is loaded
window.addEventListener("DOMContentLoaded", async () => {
    if (captchaApp) {
        await captchaApp.start();
    }
});

