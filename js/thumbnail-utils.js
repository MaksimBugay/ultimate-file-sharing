/**
 * @fileoverview Shared utilities for thumbnail generation
 * @author Senior Frontend Developer
 * @version 2.0.0
 */

/**
 * @typedef {Object} Dimensions
 * @property {number} width - Width in pixels
 * @property {number} height - Height in pixels
 */

/**
 * @typedef {Object} ThumbnailOptions
 * @property {number} maxWidth - Maximum width for the thumbnail
 * @property {number} maxHeight - Maximum height for the thumbnail
 * @property {string} [outputFormat='image/jpeg'] - Output format
 * @property {number} [quality=0.8] - Image quality (0-1, only for lossy formats)
 */

/**
 * @typedef {Object} ValidationResult
 * @property {boolean} isValid - Whether validation passed
 * @property {string} [error] - Error message if validation failed
 */

// Constants
const SUPPORTED_IMAGE_FORMATS = new Set([
    'image/jpeg',
    'image/jpg', 
    'image/png',
    'image/webp',
    'image/gif',
    'image/bmp',
    'image/svg+xml'
]);

const SUPPORTED_VIDEO_FORMATS = new Set([
    'video/mp4',
    'video/webm',
    'video/ogg',
    'video/avi',
    'video/mov',
    'video/wmv',
    'video/flv',
    'video/mkv'
]);

const OUTPUT_FORMATS = new Set([
    'image/jpeg',
    'image/png', 
    'image/webp'
]);

const DEFAULT_OPTIONS = Object.freeze({
    outputFormat: 'image/jpeg',
    quality: 0.8,
    maxSize: 10 * 1024 * 1024, // 10MB
    timeOffset: 1,
    canvasPoolSize: 3
});

const ERROR_MESSAGES = Object.freeze({
    INVALID_FILE: 'Invalid file provided',
    INVALID_IMAGE: 'File must be a valid image',
    INVALID_VIDEO: 'File must be a valid video',
    INVALID_DIMENSIONS: 'Width and height must be positive numbers',
    INVALID_QUALITY: 'Quality must be between 0.1 and 1.0',
    INVALID_FORMAT: 'Unsupported output format',
    INVALID_TIME_OFFSET: 'Time offset must be non-negative',
    FILE_TOO_LARGE: 'File size exceeds maximum allowed size',
    LOAD_FAILED: 'Failed to load media file',
    PROCESSING_FAILED: 'Failed to process media file',
    BLOB_CREATION_FAILED: 'Failed to create output blob',
    CANVAS_CONTEXT_FAILED: 'Failed to get canvas 2D context'
});

/**
 * Custom error class for thumbnail operations
 */
class ThumbnailError extends Error {
    /**
     * @param {string} message - Error message
     * @param {string} [code] - Error code for programmatic handling
     * @param {Error} [cause] - Original error that caused this error
     */
    constructor(message, code = 'THUMBNAIL_ERROR', cause = null) {
        super(message);
        this.name = 'ThumbnailError';
        this.code = code;
        this.cause = cause;
        this.timestamp = new Date().toISOString();
    }
}

/**
 * Validates file input
 * @param {File} file - File to validate
 * @param {Set<string>} allowedTypes - Set of allowed MIME types
 * @param {number} [maxSize] - Maximum file size in bytes
 * @returns {ValidationResult} Validation result
 */
function validateFile(file, allowedTypes, maxSize = DEFAULT_OPTIONS.maxSize) {
    if (!file || !(file instanceof File)) {
        return { isValid: false, error: ERROR_MESSAGES.INVALID_FILE };
    }

    if (!allowedTypes.has(file.type)) {
        return { 
            isValid: false, 
            error: `Unsupported file type: ${file.type}. Supported types: ${Array.from(allowedTypes).join(', ')}` 
        };
    }

    if (file.size > maxSize) {
        return { 
            isValid: false, 
            error: `${ERROR_MESSAGES.FILE_TOO_LARGE} (${formatFileSize(file.size)} > ${formatFileSize(maxSize)})` 
        };
    }

    return { isValid: true };
}

/**
 * Validates thumbnail options
 * @param {ThumbnailOptions} options - Options to validate
 * @returns {ValidationResult} Validation result
 */
function validateThumbnailOptions(options) {
    const { maxWidth, maxHeight, outputFormat = DEFAULT_OPTIONS.outputFormat, quality = DEFAULT_OPTIONS.quality } = options;

    if (!Number.isInteger(maxWidth) || !Number.isInteger(maxHeight) || maxWidth <= 0 || maxHeight <= 0) {
        return { isValid: false, error: ERROR_MESSAGES.INVALID_DIMENSIONS };
    }

    if (!OUTPUT_FORMATS.has(outputFormat)) {
        return { isValid: false, error: ERROR_MESSAGES.INVALID_FORMAT };
    }

    if (typeof quality !== 'number' || quality < 0.1 || quality > 1.0) {
        return { isValid: false, error: ERROR_MESSAGES.INVALID_QUALITY };
    }

    return { isValid: true };
}

/**
 * Calculates thumbnail dimensions while maintaining aspect ratio
 * @param {number} originalWidth - Original media width
 * @param {number} originalHeight - Original media height  
 * @param {number} maxWidth - Maximum allowed width
 * @param {number} maxHeight - Maximum allowed height
 * @returns {Dimensions} Calculated dimensions
 * @throws {ThumbnailError} If dimensions are invalid
 */
function calculateThumbnailDimensions(originalWidth, originalHeight, maxWidth, maxHeight) {
    // Validate inputs
    if (!Number.isFinite(originalWidth) || !Number.isFinite(originalHeight) || 
        !Number.isFinite(maxWidth) || !Number.isFinite(maxHeight)) {
        throw new ThumbnailError(ERROR_MESSAGES.INVALID_DIMENSIONS, 'INVALID_DIMENSIONS');
    }

    if (originalWidth <= 0 || originalHeight <= 0 || maxWidth <= 0 || maxHeight <= 0) {
        throw new ThumbnailError(ERROR_MESSAGES.INVALID_DIMENSIONS, 'INVALID_DIMENSIONS');
    }

    const aspectRatio = originalWidth / originalHeight;
    const maxAspectRatio = maxWidth / maxHeight;
    
    let newWidth, newHeight;
    
    if (maxAspectRatio > aspectRatio) {
        // Height is the limiting factor
        newHeight = maxHeight;
        newWidth = Math.round(maxHeight * aspectRatio);
    } else {
        // Width is the limiting factor  
        newWidth = maxWidth;
        newHeight = Math.round(maxWidth / aspectRatio);
    }
    
    return { width: newWidth, height: newHeight };
}

/**
 * Creates and configures a canvas for thumbnail generation
 * @param {number} width - Canvas width
 * @param {number} height - Canvas height
 * @returns {Object} Object with canvas and context
 * @throws {ThumbnailError} If canvas creation fails
 */
function createOptimizedCanvas(width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) {
        throw new ThumbnailError(ERROR_MESSAGES.CANVAS_CONTEXT_FAILED, 'CANVAS_CONTEXT_FAILED');
    }
    
    // Configure for optimal quality
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    
    return { canvas, ctx };
}

/**
 * Converts canvas to blob with error handling
 * @param {HTMLCanvasElement} canvas - Canvas element
 * @param {string} outputFormat - Output format
 * @param {number} quality - Image quality
 * @returns {Promise<Blob>} Promise that resolves to blob
 * @throws {ThumbnailError} If blob creation fails
 */
function canvasToBlob(canvas, outputFormat, quality) {
    return new Promise((resolve, reject) => {
        canvas.toBlob(
            (blob) => {
                if (blob) {
                    resolve(blob);
                } else {
                    reject(new ThumbnailError(ERROR_MESSAGES.BLOB_CREATION_FAILED, 'BLOB_CREATION_FAILED'));
                }
            },
            outputFormat,
            quality
        );
    });
}

/**
 * Formats file size in human-readable format
 * @param {number} bytes - File size in bytes
 * @returns {string} Formatted file size
 */
function formatFileSize(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
    
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const threshold = 1024;
    
    let size = bytes;
    let unitIndex = 0;
    
    while (size >= threshold && unitIndex < units.length - 1) {
        size /= threshold;
        unitIndex++;
    }
    
    return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

/**
 * Formats duration in seconds to human-readable format
 * @param {number} seconds - Duration in seconds
 * @returns {string} Formatted duration (e.g., "1:23" or "1:23:45")
 */
function formatDuration(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
    
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Safely revokes object URL with error handling
 * @param {string} url - Object URL to revoke
 */
function safeRevokeObjectURL(url) {
    try {
        if (url && typeof url === 'string') {
            URL.revokeObjectURL(url);
        }
    } catch (error) {
        console.warn('Failed to revoke object URL:', error);
    }
}

/**
 * Creates a timeout promise for async operations
 * @param {number} ms - Timeout in milliseconds
 * @param {string} [operation='Operation'] - Operation name for error message
 * @returns {Promise} Promise that rejects after timeout
 */
function createTimeout(ms, operation = 'Operation') {
    return new Promise((_, reject) => {
        setTimeout(() => {
            reject(new ThumbnailError(`${operation} timed out after ${ms}ms`, 'TIMEOUT'));
        }, ms);
    });
}

/**
 * Races a promise against a timeout
 * @param {Promise} promise - Promise to race
 * @param {number} timeoutMs - Timeout in milliseconds
 * @param {string} [operation='Operation'] - Operation name
 * @returns {Promise} Promise that resolves/rejects with first completed operation
 */
function withTimeout(promise, timeoutMs, operation = 'Operation') {
    return Promise.race([
        promise,
        createTimeout(timeoutMs, operation)
    ]);
}

// Performance monitoring utilities
const PerformanceMonitor = {
    /**
     * Starts timing an operation
     * @param {string} label - Operation label
     * @returns {function} Function to end timing
     */
    start(label) {
        const startTime = performance.now();
        return () => {
            const duration = performance.now() - startTime;
            console.debug(`${label} completed in ${duration.toFixed(2)}ms`);
            return duration;
        };
    },

    /**
     * Measures memory usage
     * @returns {Object} Memory usage information
     */
    getMemoryUsage() {
        if (performance.memory) {
            return {
                used: formatFileSize(performance.memory.usedJSHeapSize),
                total: formatFileSize(performance.memory.totalJSHeapSize),
                limit: formatFileSize(performance.memory.jsHeapSizeLimit)
            };
        }
        return null;
    }
};

// Browser global compatibility
if (typeof window !== 'undefined') {
    window.ThumbnailError = ThumbnailError;
    window.calculateThumbnailDimensions = calculateThumbnailDimensions;
    window.formatFileSize = formatFileSize;
    window.formatDuration = formatDuration;
    window.SUPPORTED_IMAGE_FORMATS = SUPPORTED_IMAGE_FORMATS;
    window.SUPPORTED_VIDEO_FORMATS = SUPPORTED_VIDEO_FORMATS;
    window.OUTPUT_FORMATS = OUTPUT_FORMATS;
}

// Module exports for CommonJS compatibility
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        SUPPORTED_IMAGE_FORMATS,
        SUPPORTED_VIDEO_FORMATS,
        OUTPUT_FORMATS,
        DEFAULT_OPTIONS,
        ERROR_MESSAGES,
        ThumbnailError,
        validateFile,
        validateThumbnailOptions,
        calculateThumbnailDimensions,
        createOptimizedCanvas,
        canvasToBlob,
        formatFileSize,
        formatDuration,
        safeRevokeObjectURL,
        createTimeout,
        withTimeout,
        PerformanceMonitor
    };
}
