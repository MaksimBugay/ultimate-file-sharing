/**
 * @fileoverview Advanced image thumbnail generator with modern ES6+ patterns
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
 * @typedef {Object} ImageMetadata
 * @property {string} fileName - Original file name
 * @property {number} fileSize - File size in bytes
 * @property {string} fileType - File MIME type
 * @property {Date} lastModified - Last modified date
 * @property {number} naturalWidth - Original image width
 * @property {number} naturalHeight - Original image height
 * @property {number} aspectRatio - Width to height ratio
 */

/**
 * @typedef {Object} ThumbnailResult
 * @property {Blob} blob - Generated thumbnail blob
 * @property {string} dataUrl - Data URL for immediate use
 * @property {number} size - Blob size in bytes
 * @property {string} type - Blob MIME type
 * @property {Dimensions} dimensions - Thumbnail dimensions
 * @property {number} compressionRatio - Compression ratio (0-1)
 * @property {number} processingTime - Processing time in milliseconds
 */

// Simplified approach - just the essential functions

/**
 * Creates a thumbnail from an image file (functional API)
 * @param {File} file - Image file from input element
 * @param {number|null} maxWidth - Maximum width (if null/undefined, calculated from height and aspect ratio)
 * @param {number|null} maxHeight - Maximum height (if null/undefined, calculated from width and aspect ratio)
 * @param {string} [outputFormat='image/jpeg'] - Output format
 * @param {number} [quality=0.8] - Image quality
 * @returns {Promise<Blob>} Promise resolving to thumbnail blob
 */
async function createImageThumbnail(file, maxWidth, maxHeight, outputFormat = 'image/jpeg', quality = 0.8) {
    // Direct implementation without external dependencies
    return new Promise((resolve, reject) => {
        if (!file || !(file instanceof File) || !file.type.startsWith('image/')) {
            reject(new Error('Invalid file: must be an image file'));
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

        const img = new Image();
        
        img.onload = function() {
            try {
                // Calculate dimensions based on provided constraints and aspect ratio
                const originalWidth = img.width;
                const originalHeight = img.height;
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

                // Create canvas and draw resized image
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                
                canvas.width = newWidth;
                canvas.height = newHeight;

                // Enable image smoothing for better quality
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';

                // Draw the image onto canvas with new dimensions
                ctx.drawImage(img, 0, 0, newWidth, newHeight);

                // Convert canvas to blob
                canvas.toBlob(
                    (blob) => {
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
                reject(new Error(`Failed to process image: ${error.message}`));
            }
        };

        img.onerror = function() {
            reject(new Error('Failed to load image'));
        };

        // Load the image from file
        const reader = new FileReader();
        reader.onload = function(e) {
            img.src = e.target.result;
        };
        reader.onerror = function() {
            reject(new Error('Failed to read file'));
        };
        reader.readAsDataURL(file);
    });
}

/**
 * Creates a square thumbnail (functional API)
 * @param {File} file - Image file from input element
 * @param {number} size - Square size (both width and height)
 * @param {string} [outputFormat='image/jpeg'] - Output format
 * @param {number} [quality=0.8] - Image quality
 * @returns {Promise<Blob>} Promise resolving to thumbnail blob
 */
async function createSquareImageThumbnail(file, size, outputFormat = 'image/jpeg', quality = 0.8) {
    return createImageThumbnail(file, size, size, outputFormat, quality);
}

/**
 * Creates a thumbnail with preview data (functional API)
 * @param {File} file - Image file from input element
 * @param {number} maxWidth - Maximum width
 * @param {number} maxHeight - Maximum height
 * @param {string} [outputFormat='image/jpeg'] - Output format
 * @param {number} [quality=0.8] - Image quality
 * @returns {Promise<Object>} Promise resolving to complete result
 */
async function createImageThumbnailWithPreview(file, maxWidth, maxHeight, outputFormat = 'image/jpeg', quality = 0.8) {
    const blob = await createImageThumbnail(file, maxWidth, maxHeight, outputFormat, quality);
    
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = function(e) {
            resolve({
                blob: blob,
                dataUrl: e.target.result,
                size: blob.size,
                type: blob.type
            });
        };
        reader.onerror = function() {
            reject(new Error('Failed to create data URL from blob'));
        };
        reader.readAsDataURL(blob);
    });
}

/**
 * Gets image metadata (functional API)
 * @param {File} file - Image file
 * @returns {Promise<Object>} Promise resolving to image metadata
 */
async function getImageMetadata(file) {
    return new Promise((resolve, reject) => {
        if (!file || !file.type.startsWith('image/')) {
            reject(new Error('Invalid file: must be an image file'));
            return;
        }

        const img = new Image();
        const cleanup = () => {
            if (img.src) {
                URL.revokeObjectURL(img.src);
            }
        };

        const handleLoad = () => {
            cleanup();
            resolve({
                fileName: file.name,
                fileSize: file.size,
                fileType: file.type,
                lastModified: new Date(file.lastModified),
                naturalWidth: img.naturalWidth,
                naturalHeight: img.naturalHeight,
                aspectRatio: img.naturalWidth / img.naturalHeight
            });
        };

        const handleError = () => {
            cleanup();
            reject(new Error('Failed to load image metadata'));
        };

        img.addEventListener('load', handleLoad, { once: true });
        img.addEventListener('error', handleError, { once: true });

        try {
            img.src = URL.createObjectURL(file);
        } catch (error) {
            cleanup();
            reject(new Error(`Failed to create image URL: ${error.message}`));
        }
    });
}

// Utilities are available globally

// Browser global compatibility
if (typeof window !== 'undefined') {
    window.createImageThumbnail = createImageThumbnail;
    window.createSquareImageThumbnail = createSquareImageThumbnail;
    window.createImageThumbnailWithPreview = createImageThumbnailWithPreview;
    window.getImageMetadata = getImageMetadata;
}

// CommonJS compatibility
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        createImageThumbnail,
        createSquareImageThumbnail, 
        createImageThumbnailWithPreview,
        getImageMetadata
    };
}

/**
 * Example usage:
 * 
 * // Class-based approach with configuration
 * const generator = new ImageThumbnailGenerator({
 *     timeout: 15000,
 *     enablePerformanceMonitoring: true
 * });
 * 
 * const result = await generator.createThumbnailWithDetails(file, {
 *     maxWidth: 300,
 *     maxHeight: 200,
 *     outputFormat: 'image/webp',
 *     quality: 0.9
 * });
 * 
 * // Functional approach - different dimension options
 * const blob1 = await createImageThumbnail(file, 200, 200, 'image/jpeg', 0.8); // Both dimensions
 * const blob2 = await createImageThumbnail(file, 200, null, 'image/jpeg', 0.8); // Width only, height calculated
 * const blob3 = await createImageThumbnail(file, null, 150, 'image/jpeg', 0.8); // Height only, width calculated
 * 
 * // Multiple sizes
 * const thumbnails = await generator.createMultipleThumbnails(file, [
 *     { width: 100, height: 100 },
 *     { width: 200, height: 200 },
 *     { width: 400, height: 300 }
 * ]);
 */