/**
 * @fileoverview Advanced video thumbnail generator with modern ES6+ patterns
 * @author Senior Frontend Developer
 * @version 2.0.0
 */

// Use utility functions that will be available globally from thumbnail-utils.js
// No need to redeclare constants here

/**
 * @typedef {import('./thumbnail-utils.js').ThumbnailOptions} ThumbnailOptions
 * @typedef {import('./thumbnail-utils.js').Dimensions} Dimensions
 */

/**
 * @typedef {Object} VideoThumbnailOptions
 * @extends ThumbnailOptions
 * @property {number} [timeOffset=1] - Time in seconds to capture frame
 */

/**
 * @typedef {Object} VideoMetadata
 * @property {string} fileName - Original file name
 * @property {number} fileSize - File size in bytes
 * @property {string} fileType - File MIME type
 * @property {Date} lastModified - Last modified date
 * @property {number} duration - Video duration in seconds
 * @property {number} videoWidth - Video width in pixels
 * @property {number} videoHeight - Video height in pixels
 * @property {number} aspectRatio - Width to height ratio
 * @property {boolean} hasAudio - Whether video has audio track
 */

/**
 * @typedef {Object} VideoThumbnailResult
 * @property {Blob} blob - Generated thumbnail blob
 * @property {string} dataUrl - Data URL for immediate use
 * @property {number} size - Blob size in bytes
 * @property {string} type - Blob MIME type
 * @property {Dimensions} dimensions - Thumbnail dimensions
 * @property {number} captureTime - Actual time when frame was captured
 * @property {VideoMetadata} metadata - Video metadata
 * @property {number} processingTime - Processing time in milliseconds
 */

/**
 * Video thumbnail generator class with advanced features
 */
class VideoThumbnailGenerator {
    /**
     * @param {Object} [config={}] - Configuration options
     * @param {number} [config.timeout=60000] - Operation timeout in ms
     * @param {boolean} [config.enablePerformanceMonitoring=false] - Enable performance tracking
     * @param {number} [config.seekTimeout=10000] - Video seek timeout in ms
     */
    constructor(config = {}) {
        this.config = {
            timeout: 60000,
            seekTimeout: 10000,
            enablePerformanceMonitoring: false,
            ...config
        };
    }

    /**
     * Creates a thumbnail from a video file
     * @param {File} file - Video file from input element
     * @param {VideoThumbnailOptions} options - Thumbnail generation options
     * @returns {Promise<Blob>} Promise resolving to thumbnail blob
     * @throws {ThumbnailError} If generation fails
     */
    async createThumbnail(file, options) {
        const endTiming = this.config.enablePerformanceMonitoring ? 
            PerformanceMonitor.start('Video thumbnail generation') : null;

        try {
            // Validate inputs
            this._validateInputs(file, options);
            
            const normalizedOptions = this._normalizeOptions(options);
            
            // Load and process video
            const blob = await withTimeout(
                this._processVideo(file, normalizedOptions),
                this.config.timeout,
                'Video thumbnail generation'
            );

            endTiming?.();
            return blob;

        } catch (error) {
            endTiming?.();
            throw error instanceof ThumbnailError ? error : 
                new ThumbnailError(`Video processing failed: ${error.message}`, 'PROCESSING_FAILED', error);
        }
    }

    /**
     * Creates a thumbnail with comprehensive result information
     * @param {File} file - Video file from input element
     * @param {VideoThumbnailOptions} options - Thumbnail generation options
     * @returns {Promise<VideoThumbnailResult>} Promise resolving to complete result
     */
    async createThumbnailWithDetails(file, options) {
        const startTime = performance.now();
        
        try {
            const [blob, metadata] = await Promise.all([
                this.createThumbnail(file, options),
                this.getVideoMetadata(file)
            ]);
            
            const processingTime = performance.now() - startTime;
            
            // Generate data URL
            const dataUrl = await this._blobToDataUrl(blob);
            
            // Calculate actual capture time and dimensions
            const { maxWidth, maxHeight, timeOffset } = this._normalizeOptions(options);
            const captureTime = Math.min(timeOffset, Math.max(0, metadata.duration - 0.1));
            const dimensions = calculateThumbnailDimensions(
                metadata.videoWidth,
                metadata.videoHeight,
                maxWidth,
                maxHeight
            );

            return {
                blob,
                dataUrl,
                size: blob.size,
                type: blob.type,
                dimensions,
                captureTime,
                metadata,
                processingTime
            };

        } catch (error) {
            throw error instanceof ThumbnailError ? error : 
                new ThumbnailError(`Detailed thumbnail creation failed: ${error.message}`, 'PROCESSING_FAILED', error);
        }
    }

    /**
     * Creates a square thumbnail (equal width and height)
     * @param {File} file - Video file from input element
     * @param {number} size - Square size (width and height)
     * @param {Object} [additionalOptions={}] - Additional options
     * @returns {Promise<Blob>} Promise resolving to square thumbnail blob
     */
    async createSquareThumbnail(file, size, additionalOptions = {}) {
        return this.createThumbnail(file, {
            maxWidth: size,
            maxHeight: size,
            ...additionalOptions
        });
    }

    /**
     * Creates multiple thumbnails at different time points
     * @param {File} file - Video file from input element
     * @param {number[]} timeOffsets - Array of time offsets in seconds
     * @param {Omit<VideoThumbnailOptions, 'timeOffset'>} [baseOptions={}] - Base options
     * @returns {Promise<Array<Blob|null>>} Promise resolving to array of thumbnail blobs
     */
    async createMultipleThumbnails(file, timeOffsets, baseOptions = {}) {
        if (!Array.isArray(timeOffsets) || timeOffsets.length === 0) {
            throw new ThumbnailError('Time offsets must be a non-empty array', 'INVALID_TIME_OFFSETS');
        }

        // Validate time offsets
        for (const timeOffset of timeOffsets) {
            if (typeof timeOffset !== 'number' || timeOffset < 0) {
                throw new ThumbnailError(ERROR_MESSAGES.INVALID_TIME_OFFSET, 'INVALID_TIME_OFFSET');
            }
        }

        const thumbnails = await Promise.allSettled(
            timeOffsets.map(timeOffset => 
                this.createThumbnail(file, {
                    ...baseOptions,
                    timeOffset
                })
            )
        );

        return thumbnails.map((result, index) => {
            if (result.status === 'fulfilled') {
                return result.value;
            } else {
                console.warn(`Failed to create thumbnail at ${timeOffsets[index]}s:`, result.reason);
                return null;
            }
        });
    }

    /**
     * Creates thumbnails at evenly spaced intervals
     * @param {File} file - Video file from input element
     * @param {number} count - Number of thumbnails to create
     * @param {Omit<VideoThumbnailOptions, 'timeOffset'>} [baseOptions={}] - Base options
     * @returns {Promise<Array<Blob|null>>} Promise resolving to array of thumbnail blobs
     */
    async createTimelineThumbnails(file, count, baseOptions = {}) {
        if (!Number.isInteger(count) || count <= 0) {
            throw new ThumbnailError('Count must be a positive integer', 'INVALID_COUNT');
        }

        const metadata = await this.getVideoMetadata(file);
        const duration = metadata.duration;
        
        if (duration <= 0) {
            throw new ThumbnailError('Video has no duration', 'INVALID_DURATION');
        }

        // Calculate evenly spaced time points
        const timeOffsets = [];
        const interval = duration / (count + 1);
        
        for (let i = 1; i <= count; i++) {
            timeOffsets.push(interval * i);
        }

        return this.createMultipleThumbnails(file, timeOffsets, baseOptions);
    }

    /**
     * Extracts metadata from a video file
     * @param {File} file - Video file
     * @returns {Promise<VideoMetadata>} Promise resolving to video metadata
     */
    async getVideoMetadata(file) {
        this._validateFile(file);

        return new Promise((resolve, reject) => {
            const video = document.createElement('video');
            // Removed crossOrigin to avoid CORS issues with local blob URLs
            video.muted = true;
            video.preload = 'metadata';
            
            let videoUrl = null;

            const cleanup = () => {
                if (videoUrl) {
                    safeRevokeObjectURL(videoUrl);
                }
            };

            const handleLoadedMetadata = () => {
                try {
                    const metadata = {
                        fileName: file.name,
                        fileSize: file.size,
                        fileType: file.type,
                        lastModified: new Date(file.lastModified),
                        duration: video.duration,
                        videoWidth: video.videoWidth,
                        videoHeight: video.videoHeight,
                        aspectRatio: video.videoWidth / video.videoHeight,
                        hasAudio: this._detectAudioTrack(video)
                    };

                    cleanup();
                    resolve(metadata);
                } catch (error) {
                    cleanup();
                    reject(new ThumbnailError(`Failed to extract metadata: ${error.message}`, 'METADATA_EXTRACTION_FAILED', error));
                }
            };

            const handleError = () => {
                cleanup();
                reject(new ThumbnailError('Failed to load video metadata', 'METADATA_LOAD_FAILED'));
            };

            video.addEventListener('loadedmetadata', handleLoadedMetadata, { once: true });
            video.addEventListener('error', handleError, { once: true });

            try {
                videoUrl = URL.createObjectURL(file);
                video.src = videoUrl;
                video.load();
            } catch (error) {
                cleanup();
                reject(new ThumbnailError(`Failed to create video URL: ${error.message}`, 'URL_CREATION_FAILED', error));
            }
        });
    }

    /**
     * Private method to validate inputs
     * @private
     */
    _validateInputs(file, options) {
        this._validateFile(file);
        
        const validation = validateThumbnailOptions(options);
        if (!validation.isValid) {
            throw new ThumbnailError(validation.error, 'INVALID_OPTIONS');
        }

        const { timeOffset } = options;
        if (timeOffset !== undefined && (typeof timeOffset !== 'number' || timeOffset < 0)) {
            throw new ThumbnailError(ERROR_MESSAGES.INVALID_TIME_OFFSET, 'INVALID_TIME_OFFSET');
        }
    }

    /**
     * Private method to validate file
     * @private
     */
    _validateFile(file) {
        const validation = validateFile(file, SUPPORTED_VIDEO_FORMATS);
        if (!validation.isValid) {
            throw new ThumbnailError(validation.error, 'INVALID_FILE');
        }
    }

    /**
     * Private method to normalize options with defaults
     * @private
     */
    _normalizeOptions(options) {
        return {
            outputFormat: DEFAULT_OPTIONS.outputFormat,
            quality: DEFAULT_OPTIONS.quality,
            timeOffset: DEFAULT_OPTIONS.timeOffset,
            ...options
        };
    }

    /**
     * Private method to process video and create thumbnail
     * @private
     */
    async _processVideo(file, options) {
        const { maxWidth, maxHeight, timeOffset, outputFormat, quality } = options;

        return new Promise((resolve, reject) => {
            const video = document.createElement('video');
            // Removed crossOrigin to avoid CORS issues with local blob URLs
            video.muted = true;
            video.preload = 'metadata';
            
            let videoUrl = null;
            let seekTimeout = null;

            const cleanup = () => {
                if (videoUrl) {
                    safeRevokeObjectURL(videoUrl);
                }
                if (seekTimeout) {
                    clearTimeout(seekTimeout);
                }
            };

            const handleLoadedMetadata = () => {
                try {
                    // Calculate safe capture time
                    const safeCaptureTime = Math.min(timeOffset, Math.max(0, video.duration - 0.1));
                    
                    // Set up seek timeout
                    seekTimeout = setTimeout(() => {
                        cleanup();
                        reject(new ThumbnailError('Video seek operation timed out', 'SEEK_TIMEOUT'));
                    }, this.config.seekTimeout);

                    video.currentTime = safeCaptureTime;
                } catch (error) {
                    cleanup();
                    reject(new ThumbnailError(`Failed to seek video: ${error.message}`, 'SEEK_FAILED', error));
                }
            };

            const handleSeeked = async () => {
                if (seekTimeout) {
                    clearTimeout(seekTimeout);
                    seekTimeout = null;
                }

                try {
                    // Calculate dimensions
                    const { width: newWidth, height: newHeight } = calculateThumbnailDimensions(
                        video.videoWidth,
                        video.videoHeight,
                        maxWidth,
                        maxHeight
                    );

                    // Create optimized canvas
                    const { canvas, ctx } = createOptimizedCanvas(newWidth, newHeight);

                    // Draw video frame
                    ctx.drawImage(video, 0, 0, newWidth, newHeight);

                    // Convert to blob
                    const blob = await canvasToBlob(canvas, outputFormat, quality);
                    
                    cleanup();
                    resolve(blob);

                } catch (error) {
                    cleanup();
                    reject(new ThumbnailError(`Video frame processing failed: ${error.message}`, 'FRAME_PROCESSING_FAILED', error));
                }
            };

            const handleError = () => {
                cleanup();
                reject(new ThumbnailError('Failed to load video', 'VIDEO_LOAD_FAILED'));
            };

            const handleAbort = () => {
                cleanup();
                reject(new ThumbnailError('Video loading was aborted', 'VIDEO_LOAD_ABORTED'));
            };

            // Set up event listeners
            video.addEventListener('loadedmetadata', handleLoadedMetadata, { once: true });
            video.addEventListener('seeked', handleSeeked, { once: true });
            video.addEventListener('error', handleError, { once: true });
            video.addEventListener('abort', handleAbort, { once: true });

            try {
                videoUrl = URL.createObjectURL(file);
                video.src = videoUrl;
                video.load();
            } catch (error) {
                cleanup();
                reject(new ThumbnailError(`Failed to create video URL: ${error.message}`, 'URL_CREATION_FAILED', error));
            }
        });
    }

    /**
     * Private method to convert blob to data URL
     * @private
     */
    _blobToDataUrl(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            
            reader.onload = (e) => resolve(e.target.result);
            reader.onerror = () => reject(new ThumbnailError('Failed to create data URL', 'DATA_URL_CREATION_FAILED'));
            
            reader.readAsDataURL(blob);
        });
    }

    /**
     * Private method to detect audio track (basic implementation)
     * @private
     */
    _detectAudioTrack(video) {
        try {
            // This is a basic check - more sophisticated detection would require Web Audio API
            return video.mozHasAudio || 
                   Boolean(video.webkitAudioDecodedByteCount) ||
                   Boolean(video.audioTracks && video.audioTracks.length > 0);
        } catch {
            return false; // Assume no audio if detection fails
        }
    }
}

/**
 * Creates a thumbnail from a video file (functional API)
 * @param {File} file - Video file from input element
 * @param {number|null} maxWidth - Maximum width (if null/undefined, calculated from height and aspect ratio)
 * @param {number|null} maxHeight - Maximum height (if null/undefined, calculated from width and aspect ratio)
 * @param {number} [timeOffset=1] - Time offset in seconds
 * @param {string} [outputFormat='image/jpeg'] - Output format
 * @param {number} [quality=0.8] - Image quality
 * @returns {Promise<Blob>} Promise resolving to thumbnail blob
 */
async function createVideoThumbnail(file, maxWidth, maxHeight, timeOffset = 1, outputFormat = 'image/jpeg', quality = 0.8) {
    // Direct implementation without external dependencies
    return new Promise((resolve, reject) => {
        if (!isVideoFile(file)) {
            reject(new Error('Invalid file: must be a video file'));
            return;
        }

        // Allow null/undefined for one dimension - will be calculated from aspect ratio
        if ((maxWidth !== null && maxWidth !== undefined && maxWidth <= 0) || 
            (maxHeight !== null && maxHeight !== undefined && maxHeight <= 0)) {
            reject(new Error('Provided dimensions must be positive numbers'));
            return;
        }

        // At least one dimension must be provided
        if ((maxWidth === null || maxWidth === undefined) && 
            (maxHeight === null || maxHeight === undefined)) {
            reject(new Error('At least one dimension (width or height) must be provided'));
            return;
        }

        if (timeOffset < 0) {
            reject(new Error('Invalid time offset: must be non-negative'));
            return;
        }

        const video = document.createElement('video');
        // Removed crossOrigin to avoid CORS issues with local blob URLs
        video.muted = true;
        video.preload = 'metadata';
        
        let videoUrl = null;

        const cleanup = () => {
            if (videoUrl) {
                URL.revokeObjectURL(videoUrl);
            }
        };

        video.onloadedmetadata = function() {
            try {
                // Ensure time offset doesn't exceed video duration
                video.currentTime = Math.min(timeOffset, Math.max(0, video.duration - 0.1));
            } catch (error) {
                cleanup();
                reject(new Error(`Failed to seek video: ${error.message}`));
            }
        };

        video.onseeked = function() {
            try {
                // Calculate dimensions based on provided constraints and aspect ratio
                const originalWidth = video.videoWidth;
                const originalHeight = video.videoHeight;
                const aspectRatio = originalWidth / originalHeight;
                
                let newWidth, newHeight;
                
                if (maxWidth !== null && maxWidth !== undefined && 
                    maxHeight !== null && maxHeight !== undefined) {
                    // Both dimensions provided - fit within bounds maintaining aspect ratio
                    if (maxWidth / maxHeight > aspectRatio) {
                        newHeight = maxHeight;
                        newWidth = Math.round(maxHeight * aspectRatio);
                    } else {
                        newWidth = maxWidth;
                        newHeight = Math.round(maxWidth / aspectRatio);
                    }
                } else if (maxWidth !== null && maxWidth !== undefined) {
                    // Only width provided - calculate height from aspect ratio
                    newWidth = maxWidth;
                    newHeight = Math.round(maxWidth / aspectRatio);
                } else {
                    // Only height provided - calculate width from aspect ratio
                    newHeight = maxHeight;
                    newWidth = Math.round(maxHeight * aspectRatio);
                }

                // Create canvas and draw video frame
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                
                canvas.width = newWidth;
                canvas.height = newHeight;

                // Enable image smoothing for better quality
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';

                // Draw the video frame onto canvas with new dimensions
                ctx.drawImage(video, 0, 0, newWidth, newHeight);

                // Convert canvas to blob
                canvas.toBlob(
                    (blob) => {
                        cleanup();
                        if (blob) {
                            resolve(blob);
                        } else {
                            reject(new Error('Failed to create thumbnail blob'));
                        }
                    },
                    outputFormat,
                    quality
                );
            } catch (error) {
                cleanup();
                reject(new Error(`Failed to process video frame: ${error.message}`));
            }
        };

        video.onerror = function() {
            cleanup();
            reject(new Error('Failed to load video'));
        };

        video.onabort = function() {
            cleanup();
            reject(new Error('Video loading was aborted'));
        };

        video.onstalled = function() {
            cleanup();
            reject(new Error('Video loading stalled'));
        };

        // Load the video from file
        try {
            videoUrl = URL.createObjectURL(file);
            video.src = videoUrl;
            video.load();
        } catch (error) {
            cleanup();
            reject(new Error(`Failed to create video URL: ${error.message}`));
        }
    });
}

/**
 * Creates a square thumbnail (functional API)
 * @param {File} file - Video file from input element
 * @param {number} size - Square size
 * @param {number} [timeOffset=1] - Time offset in seconds
 * @param {string} [outputFormat='image/jpeg'] - Output format
 * @param {number} [quality=0.8] - Image quality
 * @returns {Promise<Blob>} Promise resolving to thumbnail blob
 */
async function createSquareVideoThumbnail(file, size, timeOffset = 1, outputFormat = 'image/jpeg', quality = 0.8) {
    return createVideoThumbnail(file, size, size, timeOffset, outputFormat, quality);
}

/**
 * Creates multiple thumbnails at different time points (functional API)
 * @param {File} file - Video file from input element
 * @param {number} maxWidth - Maximum width
 * @param {number} maxHeight - Maximum height
 * @param {number[]} timeOffsets - Array of time offsets in seconds
 * @param {string} [outputFormat='image/jpeg'] - Output format
 * @param {number} [quality=0.8] - Image quality
 * @returns {Promise<Array<Blob|null>>} Promise resolving to array of thumbnail blobs
 */
async function createMultipleVideoThumbnails(file, maxWidth, maxHeight, timeOffsets, outputFormat = 'image/jpeg', quality = 0.8) {
    const thumbnails = [];
    
    for (const timeOffset of timeOffsets) {
        try {
            const thumbnail = await createVideoThumbnail(file, maxWidth, maxHeight, timeOffset, outputFormat, quality);
            thumbnails.push(thumbnail);
        } catch (error) {
            console.warn(`Failed to create thumbnail at ${timeOffset}s:`, error);
            thumbnails.push(null); // Maintain array order
        }
    }
    
    return thumbnails;
}

/**
 * Creates a thumbnail with metadata (functional API)
 * @param {File} file - Video file from input element
 * @param {number} maxWidth - Maximum width
 * @param {number} maxHeight - Maximum height
 * @param {number} [timeOffset=1] - Time offset in seconds
 * @param {string} [outputFormat='image/jpeg'] - Output format
 * @param {number} [quality=0.8] - Image quality
 * @returns {Promise<Object>} Promise resolving to complete result
 */
async function createVideoThumbnailWithMetadata(file, maxWidth, maxHeight, timeOffset = 1, outputFormat = 'image/jpeg', quality = 0.8) {
    const [blob, metadata] = await Promise.all([
        createVideoThumbnail(file, maxWidth, maxHeight, timeOffset, outputFormat, quality),
        getVideoMetadata(file)
    ]);
    
    return {
        blob,
        metadata,
        captureTime: Math.min(timeOffset, Math.max(0, metadata.duration - 0.1))
    };
}

/**
 * Gets video metadata (functional API)
 * @param {File} file - Video file
 * @returns {Promise<Object>} Promise resolving to video metadata
 */
async function getVideoMetadata(file) {
    return new Promise((resolve, reject) => {
        if (!file || !file.type.startsWith('video/')) {
            reject(new Error('Invalid file: must be a video file'));
            return;
        }

        const video = document.createElement('video');
        // Removed crossOrigin to avoid CORS issues with local blob URLs
        video.muted = true;
        video.preload = 'metadata';
        
        let videoUrl = null;

        const cleanup = () => {
            if (videoUrl) {
                URL.revokeObjectURL(videoUrl);
            }
        };

        video.onloadedmetadata = function() {
            try {
                const metadata = {
                    duration: video.duration,
                    videoWidth: video.videoWidth,
                    videoHeight: video.videoHeight,
                    aspectRatio: video.videoWidth / video.videoHeight,
                    fileName: file.name,
                    fileSize: file.size,
                    fileType: file.type,
                    lastModified: new Date(file.lastModified)
                };
                
                cleanup();
                resolve(metadata);
            } catch (error) {
                cleanup();
                reject(new Error(`Failed to extract metadata: ${error.message}`));
            }
        };

        video.onerror = function() {
            cleanup();
            reject(new Error('Failed to load video metadata'));
        };

        try {
            videoUrl = URL.createObjectURL(file);
            video.src = videoUrl;
            video.load();
        } catch (error) {
            cleanup();
            reject(new Error(`Failed to create video URL: ${error.message}`));
        }
    });
}

// Utilities are available globally

// Browser global compatibility
if (typeof window !== 'undefined') {
    window.VideoThumbnailGenerator = VideoThumbnailGenerator;
    window.createVideoThumbnail = createVideoThumbnail;
    window.createSquareVideoThumbnail = createSquareVideoThumbnail;
    window.createMultipleVideoThumbnails = createMultipleVideoThumbnails;
    window.createVideoThumbnailWithMetadata = createVideoThumbnailWithMetadata;
    window.getVideoMetadata = getVideoMetadata;
}

// CommonJS compatibility
if (typeof module !== 'undefined' && module.exports) {
    // Fallback imports for CommonJS
    const utils = require('./thumbnail-utils.js');
    
    module.exports = {
        VideoThumbnailGenerator,
        createVideoThumbnail,
        createSquareVideoThumbnail,
        createMultipleVideoThumbnails,
        createVideoThumbnailWithMetadata,
        getVideoMetadata,
        calculateThumbnailDimensions: utils.calculateThumbnailDimensions,
        formatDuration: utils.formatDuration,
        ThumbnailError: utils.ThumbnailError
    };
}

/**
 * Example usage:
 * 
 * // Class-based approach with configuration
 * const generator = new VideoThumbnailGenerator({
 *     timeout: 30000,
 *     seekTimeout: 5000,
 *     enablePerformanceMonitoring: true
 * });
 * 
 * const result = await generator.createThumbnailWithDetails(file, {
 *     maxWidth: 300,
 *     maxHeight: 200,
 *     timeOffset: 5,
 *     outputFormat: 'image/webp',
 *     quality: 0.9
 * });
 * 
 * // Functional approach - different dimension options
 * const blob1 = await createVideoThumbnail(file, 300, 200, 2, 'image/jpeg', 0.8); // Both dimensions
 * const blob2 = await createVideoThumbnail(file, 300, null, 2, 'image/jpeg', 0.8); // Width only, height calculated
 * const blob3 = await createVideoThumbnail(file, null, 200, 2, 'image/jpeg', 0.8); // Height only, width calculated
 * 
 * // Timeline thumbnails
 * const timelineThumbnails = await generator.createTimelineThumbnails(file, 5, {
 *     maxWidth: 150,
 *     maxHeight: 100
 * });
 * 
 * // Multiple specific time points
 * const thumbnails = await createMultipleVideoThumbnails(file, 200, 200, [1, 5, 10, 15]);
 */