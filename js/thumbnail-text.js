/**
 * @fileoverview Text thumbnail generator with modern ES6+ patterns
 * @author Senior Frontend Developer
 * @version 1.0.0
 */

/**
 * @typedef {Object} TextThumbnailOptions
 * @property {number} width - Thumbnail width in pixels
 * @property {number} height - Thumbnail height in pixels
 * @property {string} [backgroundColor='#ffffff'] - Background color (hex, rgb, hsl, or named color)
 * @property {string} [textColor='#000000'] - Text color (hex, rgb, hsl, or named color)
 * @property {string} [fontFamily='Arial, sans-serif'] - Font family
 * @property {string} [fontWeight='normal'] - Font weight (normal, bold, lighter, bolder, 100-900)
 * @property {string} [textAlign='center'] - Text alignment (left, center, right)
 * @property {string} [verticalAlign='middle'] - Vertical alignment (top, middle, bottom)
 * @property {number} [padding=20] - Padding from edges in pixels
 * @property {number} [lineHeight=1.2] - Line height multiplier
 * @property {string} [outputFormat='image/png'] - Output format (image/png, image/jpeg, image/webp)
 * @property {number} [quality=1.0] - Image quality (0.1-1.0, only for lossy formats)
 * @property {boolean} [wordWrap=true] - Enable automatic word wrapping
 * @property {number} [maxLines=0] - Maximum number of lines (0 = unlimited)
 * @property {string} [textOverflow='...'] - Text to append when truncated
 */

/**
 * @typedef {Object} TextMetrics
 * @property {number} width - Text width in pixels
 * @property {number} height - Text height in pixels
 * @property {number} fontSize - Calculated font size
 * @property {number} lines - Number of text lines
 * @property {string[]} wrappedLines - Array of text lines after wrapping
 */

/**
 * @typedef {Object} TextThumbnailResult
 * @property {Blob} blob - Generated thumbnail blob
 * @property {string} dataUrl - Data URL for immediate use
 * @property {number} size - Blob size in bytes
 * @property {string} type - Blob MIME type
 * @property {TextMetrics} metrics - Text measurement information
 * @property {number} processingTime - Processing time in milliseconds
 */





/**
 * Adjust color brightness
 * @private
 */
function adjustColorBrightness(color, percent) {
    // Simple color adjustment for hex colors
    if (color.startsWith('#')) {
        const num = parseInt(color.replace('#', ''), 16);
        const amt = Math.round(2.55 * percent);
        const R = Math.max(0, Math.min(255, (num >> 16) + amt));
        const G = Math.max(0, Math.min(255, (num >> 8 & 0x00FF) + amt));
        const B = Math.max(0, Math.min(255, (num & 0x0000FF) + amt));
        return `#${(1 << 24 | R << 16 | G << 8 | B).toString(16).slice(1)}`;
    }
    return color; // Return original if not hex
}

/**
 * Creates a thumbnail image from text
 * @param {string} text - Text content to render
 * @param {TextThumbnailOptions} options - Thumbnail generation options
 * @returns {Promise<Blob>} Promise resolving to thumbnail blob
 */
async function createTextThumbnail(text, options = {}) {
    // Validate inputs
    if (typeof text !== 'string') {
        throw new Error('Text must be a string');
    }
    
    if (!text.trim()) {
        throw new Error('Text cannot be empty');
    }
    
    // Set default options
    const config = {
        width: 400,
        height: 300,
        backgroundColor: '#ffffff',
        textColor: '#000000',
        fontFamily: 'Arial, sans-serif',
        fontWeight: 'normal',
        textAlign: 'center',
        verticalAlign: 'middle',
        padding: 20,
        lineHeight: 1.2,
        outputFormat: 'image/png',
        quality: 1.0,
        wordWrap: true,
        maxLines: 0,
        textOverflow: '...',
        ...options
    };
    
    // Validate dimensions
    if (config.width <= 0 || config.height <= 0) {
        throw new Error('Width and height must be positive numbers');
    }
    
    // Validate quality
    if (config.quality < 0.1 || config.quality > 1.0) {
        throw new Error('Quality must be between 0.1 and 1.0');
    }
    
    return new Promise(async (resolve, reject) => {
        try {
            // Create canvas
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            
            canvas.width = config.width;
            canvas.height = config.height;
            
            // Create background
            ctx.fillStyle = config.backgroundColor;
            ctx.fillRect(0, 0, config.width, config.height);
            
            // Calculate available text area (70-80% of image space)
            const targetTextWidth = config.width * 0.75; // 75% of width
            const targetTextHeight = config.height * 0.75; // 75% of height
            const availableWidth = config.width - (config.padding * 2);
            const availableHeight = config.height - (config.padding * 2);
            
            // Calculate optimal font size and wrap text
            const textMetrics = calculateOptimalText(
                ctx, 
                text, 
                targetTextWidth, 
                targetTextHeight, 
                availableWidth, 
                availableHeight, 
                config
            );
            
            // Set font properties
            ctx.fillStyle = config.textColor;
            ctx.font = `${config.fontWeight} ${textMetrics.fontSize}px ${config.fontFamily}`;
            ctx.textAlign = config.textAlign;
            ctx.textBaseline = 'top';
            
            // Calculate starting position
            const startX = getHorizontalPosition(config.textAlign, config.width, config.padding);
            const startY = getVerticalPosition(
                config.verticalAlign, 
                config.height, 
                textMetrics.height, 
                config.padding
            );
            
            // Draw text lines
            textMetrics.wrappedLines.forEach((line, index) => {
                const lineY = startY + (index * textMetrics.lineHeight);
                ctx.fillText(line, startX, lineY);
            });
            
            // Convert to blob
            canvas.toBlob(
                (blob) => {
                    if (blob) {
                        resolve(blob);
                    } else {
                        reject(new Error('Failed to create thumbnail blob'));
                    }
                },
                config.outputFormat,
                config.quality
            );
            
        } catch (error) {
            reject(new Error(`Text thumbnail generation failed: ${error.message}`));
        }
    });
}

/**
 * Creates a text thumbnail with comprehensive result information
 * @param {string} text - Text content to render
 * @param {TextThumbnailOptions} options - Thumbnail generation options
 * @returns {Promise<TextThumbnailResult>} Promise resolving to complete result
 */
async function createTextThumbnailWithDetails(text, options = {}) {
    const startTime = performance.now();
    
    try {
        const blob = await createTextThumbnail(text, options);
        const processingTime = performance.now() - startTime;
        
        // Generate data URL
        const dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.onerror = () => reject(new Error('Failed to create data URL'));
            reader.readAsDataURL(blob);
        });
        
        // Create temporary canvas to measure text
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const config = { width: 400, height: 300, ...options };
        
        const targetTextWidth = config.width * 0.75;
        const targetTextHeight = config.height * 0.75;
        const availableWidth = config.width - ((config.padding || 20) * 2);
        const availableHeight = config.height - ((config.padding || 20) * 2);
        
        const metrics = calculateOptimalText(
            ctx, 
            text, 
            targetTextWidth, 
            targetTextHeight, 
            availableWidth, 
            availableHeight, 
            config
        );
        
        return {
            blob,
            dataUrl,
            size: blob.size,
            type: blob.type,
            metrics,
            processingTime
        };
        
    } catch (error) {
        throw new Error(`Detailed text thumbnail creation failed: ${error.message}`);
    }
}

/**
 * Creates a default text thumbnail with predefined user-friendly settings
 * Perfect for quick text thumbnails with optimal readability and visual appeal
 * @param {string} text - Text content to render
 * @param {Blob} [backgroundImageBlob] - Optional background image blob to use as background
 * @returns {Promise<Blob>} Promise resolving to thumbnail blob
 */
async function createDefaultTextThumbnail(text, backgroundImageBlob = null) {
    // Predefined settings optimized for excellent readability
    const defaultSettings = {
        width: 600,
        height: 400,
        backgroundColor: '#f8f9fa',      // Light gray - excellent readability
        textColor: '#2c3e50',            // Dark blue-gray - high contrast
        fontFamily: 'Arial, sans-serif', // Highly readable font
        fontWeight: '600',               // Semi-bold for better visibility
        textAlign: 'center',             // Centered for balanced composition
        verticalAlign: 'middle',         // Vertically centered
        padding: 50,                     // Generous padding for readability
        lineHeight: 1.4,                 // Comfortable line spacing
        outputFormat: 'image/png',       // PNG for text clarity
        quality: 1.0,                    // Maximum quality for crisp text
        wordWrap: true,                  // Enable word wrapping
        maxLines: 0,                     // Unlimited lines
        textOverflow: '...'              // Ellipsis for truncation
    };

    return createTextThumbnailWithBackground(text, defaultSettings, backgroundImageBlob);
}

/**
 * Creates a text thumbnail with optional background image
 * @param {string} text - Text content to render
 * @param {TextThumbnailOptions} options - Thumbnail generation options
 * @param {Blob} [backgroundImageBlob] - Optional background image blob
 * @returns {Promise<Blob>} Promise resolving to thumbnail blob
 */
async function createTextThumbnailWithBackground(text, options = {}, backgroundImageBlob = null) {
    // Validate inputs
    if (typeof text !== 'string') {
        throw new Error('Text must be a string');
    }
    
    if (!text.trim()) {
        throw new Error('Text cannot be empty');
    }
    
    // Set default options
    const config = {
        width: 400,
        height: 300,
        backgroundColor: '#ffffff',
        textColor: '#000000',
        fontFamily: 'Arial, sans-serif',
        fontWeight: 'normal',
        textAlign: 'center',
        verticalAlign: 'middle',
        padding: 20,
        lineHeight: 1.2,
        outputFormat: 'image/png',
        quality: 1.0,
        wordWrap: true,
        maxLines: 0,
        textOverflow: '...',
        ...options
    };
    
    // Validate dimensions
    if (config.width <= 0 || config.height <= 0) {
        throw new Error('Width and height must be positive numbers');
    }
    
    // Validate quality
    if (config.quality < 0.1 || config.quality > 1.0) {
        throw new Error('Quality must be between 0.1 and 1.0');
    }
    
    return new Promise(async (resolve, reject) => {
        try {
            // Create canvas
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            
            canvas.width = config.width;
            canvas.height = config.height;
            
            // Create background
            if (backgroundImageBlob) {
                // Use provided background image
                await drawBackgroundFromBlob(ctx, config.width, config.height, backgroundImageBlob, config.backgroundColor);
            } else {
                // Simple solid background
                ctx.fillStyle = config.backgroundColor;
                ctx.fillRect(0, 0, config.width, config.height);
            }
            
            // Calculate available text area (70-80% of image space)
            const targetTextWidth = config.width * 0.75; // 75% of width
            const targetTextHeight = config.height * 0.75; // 75% of height
            const availableWidth = config.width - (config.padding * 2);
            const availableHeight = config.height - (config.padding * 2);
            
            // Calculate optimal font size and wrap text
            const textMetrics = calculateOptimalText(
                ctx, 
                text, 
                targetTextWidth, 
                targetTextHeight, 
                availableWidth, 
                availableHeight, 
                config
            );
            
            // Set font properties
            ctx.fillStyle = config.textColor;
            ctx.font = `${config.fontWeight} ${textMetrics.fontSize}px ${config.fontFamily}`;
            ctx.textAlign = config.textAlign;
            ctx.textBaseline = 'top';
            
            // Calculate starting position
            const startX = getHorizontalPosition(config.textAlign, config.width, config.padding);
            const startY = getVerticalPosition(
                config.verticalAlign, 
                config.height, 
                textMetrics.height, 
                config.padding
            );
            
            // Draw text lines
            textMetrics.wrappedLines.forEach((line, index) => {
                const lineY = startY + (index * textMetrics.lineHeight);
                ctx.fillText(line, startX, lineY);
            });
            
            // Convert to blob
            canvas.toBlob(
                (blob) => {
                    if (blob) {
                        resolve(blob);
                    } else {
                        reject(new Error('Failed to create thumbnail blob'));
                    }
                },
                config.outputFormat,
                config.quality
            );
            
        } catch (error) {
            reject(new Error(`Text thumbnail generation failed: ${error.message}`));
        }
    });
}

/**
 * Draw background from image blob
 * @private
 */
async function drawBackgroundFromBlob(ctx, width, height, imageBlob, fallbackColor) {
    return new Promise((resolve) => {
        const backgroundImg = new Image();
        
        backgroundImg.onload = function() {
            try {
                // Draw the background image, scaled to cover the entire canvas
                ctx.drawImage(backgroundImg, 0, 0, width, height);
                
                // Add semi-transparent overlay for text readability
                ctx.fillStyle = 'rgba(248, 250, 252, 0.75)';
                ctx.fillRect(0, 0, width, height);
                
                // Clean up blob URL
                URL.revokeObjectURL(backgroundImg.src);
                resolve();
            } catch (error) {
                // Fallback to solid color
                URL.revokeObjectURL(backgroundImg.src);
                ctx.fillStyle = fallbackColor || '#f8f9fa';
                ctx.fillRect(0, 0, width, height);
                resolve();
            }
        };
        
        backgroundImg.onerror = function() {
            // Fallback to solid color
            URL.revokeObjectURL(backgroundImg.src);
            ctx.fillStyle = fallbackColor || '#f8f9fa';
            ctx.fillRect(0, 0, width, height);
            resolve();
        };
        
        // Create blob URL and load
        try {
            backgroundImg.src = URL.createObjectURL(imageBlob);
        } catch (error) {
            ctx.fillStyle = fallbackColor || '#f8f9fa';
            ctx.fillRect(0, 0, width, height);
            resolve();
        }
    });
}

/**
 * Creates a square text thumbnail
 * @param {string} text - Text content to render
 * @param {number} size - Square size (width and height)
 * @param {Omit<TextThumbnailOptions, 'width'|'height'>} [additionalOptions={}] - Additional options
 * @returns {Promise<Blob>} Promise resolving to thumbnail blob
 */
async function createSquareTextThumbnail(text, size, additionalOptions = {}) {
    return createTextThumbnail(text, {
        width: size,
        height: size,
        ...additionalOptions
    });
}

/**
 * Creates multiple text thumbnails with different configurations
 * @param {string} text - Text content to render
 * @param {TextThumbnailOptions[]} configurations - Array of configuration objects
 * @returns {Promise<Array<Blob|null>>} Promise resolving to array of thumbnail blobs
 */
async function createMultipleTextThumbnails(text, configurations) {
    const thumbnails = await Promise.allSettled(
        configurations.map(config => createTextThumbnail(text, config))
    );

    return thumbnails.map((result, index) => {
        if (result.status === 'fulfilled') {
            return result.value;
        } else {
            console.warn(`Failed to create text thumbnail with config ${index}:`, result.reason);
            return null;
        }
    });
}

/**
 * Calculate optimal font size and text wrapping
 * @private
 */
function calculateOptimalText(ctx, text, targetWidth, targetHeight, availableWidth, availableHeight, config) {
    const minFontSize = config.wordWrap ? 18 : 8; // Minimum 18px for readability when word wrap is enabled
    const maxFontSize = 200;
    let optimalFontSize = minFontSize;
    let wrappedLines = [];
    let actualLineHeight = 0;
    
    // Binary search for optimal font size
    let low = minFontSize;
    let high = maxFontSize;
    
    while (low <= high) {
        const fontSize = Math.floor((low + high) / 2);
        ctx.font = `${config.fontWeight} ${fontSize}px ${config.fontFamily}`;
        
        // Calculate actual line height based on font size
        const lineHeightPx = fontSize * config.lineHeight;
        
        // Try wrapping text at this font size
        const lines = wrapText(ctx, text, availableWidth, config);
        const totalHeight = lines.length * lineHeightPx;
        
        // Check if text fits within target area (70-80% of image)
        const maxLineWidth = Math.max(...lines.map(line => ctx.measureText(line).width));
        
        if (maxLineWidth <= targetWidth && totalHeight <= targetHeight && 
            maxLineWidth <= availableWidth && totalHeight <= availableHeight) {
            // This size works, try a larger one
            optimalFontSize = fontSize;
            wrappedLines = lines;
            actualLineHeight = lineHeightPx;
            low = fontSize + 1;
        } else {
            // This size is too big, try a smaller one
            high = fontSize - 1;
        }
    }
    
    // Ensure we have valid results and minimum font size
    if (wrappedLines.length === 0 || optimalFontSize < minFontSize) {
        optimalFontSize = Math.max(optimalFontSize, minFontSize);
        ctx.font = `${config.fontWeight} ${optimalFontSize}px ${config.fontFamily}`;
        wrappedLines = wrapText(ctx, text, availableWidth, config);
        actualLineHeight = optimalFontSize * config.lineHeight;
    }
    
    // Calculate actual text dimensions
    const textWidth = Math.max(...wrappedLines.map(line => ctx.measureText(line).width));
    const textHeight = wrappedLines.length * actualLineHeight;
    
    return {
        fontSize: optimalFontSize,
        wrappedLines: wrappedLines,
        width: textWidth,
        height: textHeight,
        lines: wrappedLines.length,
        lineHeight: actualLineHeight
    };
}

/**
 * Wrap text to fit within specified width
 * @private
 */
function wrapText(ctx, text, maxWidth, config) {
    if (!config.wordWrap) {
        const lines = text.split('\n');
        return config.maxLines > 0 ? lines.slice(0, config.maxLines) : lines;
    }
    
    const words = text.split(' ');
    const lines = [];
    let currentLine = '';
    
    for (const word of words) {
        const testLine = currentLine + (currentLine ? ' ' : '') + word;
        const metrics = ctx.measureText(testLine);
        
        if (metrics.width > maxWidth && currentLine) {
            lines.push(currentLine);
            currentLine = word;
            
            // Check max lines limit
            if (config.maxLines > 0 && lines.length >= config.maxLines) {
                // Truncate and add overflow indicator
                if (lines.length === config.maxLines) {
                    const lastLine = lines[lines.length - 1];
                    lines[lines.length - 1] = truncateLineWithOverflow(ctx, lastLine, maxWidth, config.textOverflow);
                }
                break;
            }
        } else {
            currentLine = testLine;
        }
    }
    
    if (currentLine && (!config.maxLines || lines.length < config.maxLines)) {
        lines.push(currentLine);
    }
    
    return lines;
}

/**
 * Truncate line and add overflow indicator
 * @private
 */
function truncateLineWithOverflow(ctx, line, maxWidth, overflow) {
    const overflowWidth = ctx.measureText(overflow).width;
    const availableWidth = maxWidth - overflowWidth;
    
    if (ctx.measureText(line).width <= maxWidth) {
        return line;
    }
    
    let truncated = '';
    const words = line.split(' ');
    
    for (const word of words) {
        const testLine = truncated + (truncated ? ' ' : '') + word;
        if (ctx.measureText(testLine).width <= availableWidth) {
            truncated = testLine;
        } else {
            break;
        }
    }
    
    return truncated + overflow;
}

/**
 * Get horizontal text position based on alignment
 * @private
 */
function getHorizontalPosition(textAlign, canvasWidth, padding) {
    switch (textAlign) {
        case 'left':
            return padding;
        case 'right':
            return canvasWidth - padding;
        case 'center':
        default:
            return canvasWidth / 2;
    }
}

/**
 * Get vertical text position based on alignment
 * @private
 */
function getVerticalPosition(verticalAlign, canvasHeight, textHeight, padding) {
    switch (verticalAlign) {
        case 'top':
            return padding;
        case 'bottom':
            return canvasHeight - padding - textHeight;
        case 'middle':
        default:
            return (canvasHeight - textHeight) / 2;
    }
}

// Browser global compatibility
if (typeof window !== 'undefined') {
    window.createTextThumbnail = createTextThumbnail;
    window.createDefaultTextThumbnail = createDefaultTextThumbnail;
    window.createTextThumbnailWithBackground = createTextThumbnailWithBackground;
    window.createTextThumbnailWithDetails = createTextThumbnailWithDetails;
    window.createSquareTextThumbnail = createSquareTextThumbnail;
    window.createMultipleTextThumbnails = createMultipleTextThumbnails;
}

// CommonJS compatibility
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        createTextThumbnail,
        createDefaultTextThumbnail,
        createTextThumbnailWithBackground,
        createTextThumbnailWithDetails,
        createSquareTextThumbnail,
        createMultipleTextThumbnails
    };
}

/**
 * Example usage:
 * 
 * // Simplest approach - just text, optimal defaults applied
 * const blob = await createDefaultTextThumbnail('Hello World!');
 * 
 * // With custom background image
 * const backgroundBlob = await fetch('images/my-background.jpg').then(r => r.blob());
 * const blobWithBg = await createDefaultTextThumbnail('Hello World!', backgroundBlob);
 * 
 * // Custom text thumbnail with background
 * const blob2 = await createTextThumbnailWithBackground('Custom Text', {
 *     width: 600,
 *     height: 400,
 *     textColor: '#ffffff',
 *     fontWeight: 'bold',
 *     padding: 60
 * }, backgroundBlob);
 * 
 * // Basic text thumbnail with custom options (no background)
 * const blob3 = await createTextThumbnail('Hello World!', {
 *     width: 400,
 *     height: 300,
 *     backgroundColor: '#3498db',
 *     textColor: '#ffffff'
 * });
 * 
 * // Square thumbnail for social media
 * const blob4 = await createSquareTextThumbnail('Square Text', 300, {
 *     backgroundColor: '#e74c3c',
 *     textColor: '#ffffff'
 * });
 * 
 * // With detailed metrics and performance data
 * const result = await createTextThumbnailWithDetails('Detailed Analysis', {
 *     width: 500,
 *     height: 350,
 *     wordWrap: true,
 *     maxLines: 3
 * });
 * 
 * console.log(`Generated in ${result.processingTime}ms`);
 * console.log(`Font size: ${result.metrics.fontSize}px`);
 * console.log(`Lines: ${result.metrics.lines}`);
 */
