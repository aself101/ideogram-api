/**
 * Ideogram API Service Utility Functions
 *
 * Utility functions for Ideogram image generation, including file I/O,
 * image handling, FormData building, and data transformations.
 */
import fs from 'fs/promises';
import path from 'path';
import winston from 'winston';
import { fetchFollowingRedirects, readBodyWithLimit, streamToFile } from './http.js';
import { imageSize } from 'image-size';
import { imageSizeFromFile } from 'image-size/fromFile';
import { lookup } from 'dns/promises';
import { isIPv4, isIPv6 } from 'net';
/** Coerce a caught value to an Error (a non-Error keeps its `message`, else its string form). */
export function toError(e) {
    if (e instanceof Error)
        return e;
    if (typeof e === 'object' && e !== null && typeof e.message === 'string') {
        return new Error(e.message);
    }
    return new Error(String(e));
}
/** True for an error-like object carrying a Node system error `code` (ENOENT, EACCES, ...). */
export function isErrnoException(e) {
    return typeof e === 'object' && e !== null && typeof e.code === 'string';
}
// Configure module logger
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(winston.format.timestamp(), winston.format.printf(({ timestamp, level, message }) => {
        return `${timestamp} - ${level.toUpperCase()} - ${message}`;
    })),
    transports: [new winston.transports.Console()],
});
/**
 * Helper function to check if an IP address is blocked (private/internal).
 *
 * @param ip - IP address to check (IPv4 or IPv6)
 * @returns True if IP is blocked, false otherwise
 */
function isBlockedIP(ip) {
    // Remove IPv6 bracket notation
    const cleanIP = ip.replace(/^\[|\]$/g, '');
    // Block localhost variations
    if (cleanIP === 'localhost' || cleanIP === '127.0.0.1' || cleanIP === '::1') {
        return true;
    }
    // Block cloud metadata endpoints
    const blockedHosts = ['metadata.google.internal', 'metadata', '169.254.169.254'];
    if (blockedHosts.includes(cleanIP)) {
        return true;
    }
    // Block private IP ranges and special addresses
    const blockedPatterns = [
        /^127\./, // Loopback
        /^10\./, // Private Class A
        /^172\.(1[6-9]|2[0-9]|3[0-1])\./, // Private Class B
        /^192\.168\./, // Private Class C
        /^169\.254\./, // Link-local (AWS metadata)
        /^0\./, // Invalid range
        /^::1$/, // IPv6 loopback
        /^fe80:/, // IPv6 link-local
        /^fc00:/, // IPv6 unique local
        /^fd00:/, // IPv6 unique local
    ];
    return blockedPatterns.some((pattern) => pattern.test(cleanIP));
}
/**
 * Validate image URL for security.
 * Enforces HTTPS and blocks private IPs, localhost, and cloud metadata endpoints.
 *
 * DNS Resolution: This function performs DNS resolution to prevent DNS rebinding attacks,
 * where a domain might resolve to different IPs between validation time and request time.
 *
 * @param url - URL to validate
 * @returns The validated URL
 * @throws Error if URL is invalid or insecure
 */
export async function validateImageUrl(url) {
    // First check for IPv4-mapped IPv6 in the original URL string (before URL parsing normalizes it)
    // This prevents SSRF bypass via https://[::ffff:127.0.0.1] or https://[::ffff:169.254.169.254]
    const ipv6MappedMatch = url.match(/\[::ffff:(\d+\.\d+\.\d+\.\d+)\]/i);
    if (ipv6MappedMatch) {
        const extractedIPv4 = ipv6MappedMatch[1];
        logger.warn(`SECURITY: Detected IPv4-mapped IPv6 address in URL: ${url} → ${extractedIPv4}`);
        // Validate the extracted IPv4 directly
        if (extractedIPv4 === '127.0.0.1' || extractedIPv4.startsWith('127.')) {
            logger.warn(`SECURITY: Blocked IPv4-mapped IPv6 localhost: ${url}`);
            throw new Error('Access to localhost is not allowed');
        }
        // Check against private IP patterns
        const privatePatterns = [
            /^10\./, // Private Class A
            /^172\.(1[6-9]|2[0-9]|3[0-1])\./, // Private Class B
            /^192\.168\./, // Private Class C
            /^169\.254\./, // Link-local (AWS metadata)
            /^0\./, // Invalid range
        ];
        if (privatePatterns.some((pattern) => pattern.test(extractedIPv4))) {
            logger.warn(`SECURITY: Blocked IPv4-mapped IPv6 private IP: ${url}`);
            throw new Error('Access to internal/private IP addresses is not allowed');
        }
    }
    let parsed;
    try {
        parsed = new URL(url);
    }
    catch {
        throw new Error(`Invalid URL: ${url}`);
    }
    // Only allow HTTPS (not HTTP)
    if (parsed.protocol !== 'https:') {
        throw new Error('Only HTTPS URLs are allowed for security reasons');
    }
    const hostname = parsed.hostname.toLowerCase();
    const cleanHostname = hostname.replace(/^\[|\]$/g, ''); // Remove IPv6 brackets
    // First check if hostname itself is blocked (before DNS resolution)
    const blockedHosts = ['localhost', 'metadata.google.internal', 'metadata'];
    if (blockedHosts.includes(cleanHostname)) {
        logger.warn(`SECURITY: Blocked access to prohibited hostname: ${hostname}`);
        throw new Error('Access to cloud metadata endpoints is not allowed');
    }
    // Check if hostname is already an IP address (not a domain name)
    if (isIPv4(cleanHostname) || isIPv6(cleanHostname)) {
        if (isBlockedIP(cleanHostname)) {
            logger.warn(`SECURITY: Blocked access to private/internal IP: ${hostname}`);
            throw new Error('Access to internal/private IP addresses is not allowed');
        }
    }
    else {
        // Hostname is a domain name - perform DNS resolution to prevent DNS rebinding
        try {
            logger.debug(`Resolving DNS for hostname: ${hostname}`);
            const { address } = await lookup(hostname);
            logger.debug(`DNS resolved ${hostname} → ${address}`);
            if (isBlockedIP(address)) {
                logger.warn(`SECURITY: DNS resolution of ${hostname} points to blocked IP: ${address}`);
                throw new Error(`Domain ${hostname} resolves to internal/private IP address`);
            }
            logger.debug(`DNS validation passed for ${hostname} (resolved to ${address})`);
        }
        catch (error) {
            const err = toError(error);
            if (isErrnoException(error) && error.code === 'ENOTFOUND') {
                logger.warn(`SECURITY: Domain ${hostname} could not be resolved`);
                throw new Error(`Domain ${hostname} could not be resolved`);
            }
            else if (err.message && err.message.includes('resolves to internal')) {
                // Re-throw our custom error about blocked IPs
                throw error;
            }
            else {
                logger.warn(`SECURITY: DNS lookup failed for ${hostname}: ${err.message}`);
                throw new Error(`Failed to validate domain ${hostname}: ${err.message}`);
            }
        }
    }
    return url;
}
/**
 * Validate image file path.
 * Checks file exists, is readable, and has valid image magic bytes.
 *
 * @param filepath - Path to image file
 * @returns Validated filepath
 * @throws Error if file doesn't exist, isn't readable, or isn't a valid image
 */
export async function validateImagePath(filepath) {
    try {
        const buffer = await fs.readFile(filepath);
        // Check file size (must be > 0)
        if (buffer.length === 0) {
            throw new Error(`Image file is empty: ${filepath}`);
        }
        // Check magic bytes for common image formats
        const magicBytes = buffer.slice(0, 4);
        const isPNG = magicBytes[0] === 0x89 &&
            magicBytes[1] === 0x50 &&
            magicBytes[2] === 0x4e &&
            magicBytes[3] === 0x47;
        const isJPEG = magicBytes[0] === 0xff && magicBytes[1] === 0xd8 && magicBytes[2] === 0xff;
        const isWebP = buffer.slice(8, 12).toString() === 'WEBP';
        const isGIF = magicBytes.slice(0, 3).toString() === 'GIF';
        if (!isPNG && !isJPEG && !isWebP && !isGIF) {
            throw new Error(`File does not appear to be a valid image (PNG, JPEG, WebP, or GIF): ${filepath}`);
        }
        return filepath;
    }
    catch (error) {
        const code = isErrnoException(error) ? error.code : undefined;
        if (code === 'ENOENT') {
            throw new Error(`Image file not found: ${filepath}`);
        }
        else if (code === 'EACCES') {
            throw new Error(`Permission denied reading image file: ${filepath}`);
        }
        throw error;
    }
}
/**
 * Ensure an image is perfectly square by checking its dimensions.
 *
 * @param imageSource - Path to the image file or an in-memory Buffer
 * @throws Error if the image is not square or cannot be read
 *
 * @example
 * await assertSquareImage('./square.png');
 * await assertSquareImage(imageBuffer);
 */
export async function assertSquareImage(imageSource) {
    const { width, height } = await getImageDimensions(imageSource);
    if (width !== height) {
        throw new Error(`Image must be square. Received ${width}x${height}`);
    }
}
/**
 * Read an image's width and height from a file path or Buffer.
 *
 * @param imageSource - Path to an image file, or its bytes
 * @returns `{ width, height }`
 * @throws Error if the dimensions cannot be read
 *
 * @example
 * const { width, height } = await getImageDimensions('./photo.png');
 */
export async function getImageDimensions(imageSource) {
    try {
        if (Buffer.isBuffer(imageSource) || ArrayBuffer.isView(imageSource)) {
            // Accept Buffer/Uint8Array inputs: view the same bytes (no copy) as a plain Uint8Array
            const result = imageSize(new Uint8Array(imageSource.buffer, imageSource.byteOffset, imageSource.byteLength));
            if (!result.width || !result.height) {
                throw new Error('Could not determine image dimensions (input: Buffer)');
            }
            return { width: result.width, height: result.height };
        }
        else if (typeof imageSource === 'string') {
            // Paths require async helper
            const result = await imageSizeFromFile(imageSource);
            if (!result.width || !result.height) {
                throw new Error(`Could not determine image dimensions (input: ${imageSource})`);
            }
            return { width: result.width, height: result.height };
        }
        throw new Error(`Unsupported image input (type: ${imageSource === null ? 'null' : typeof imageSource})`);
    }
    catch (error) {
        throw new Error(`Unable to read image dimensions: ${toError(error).message}`);
    }
}
/**
 * Load image file as Buffer for multipart/form-data.
 * Validates file exists and is a valid image format.
 *
 * @param imagePath - Path to local image file
 * @returns Image data as Buffer
 * @throws Error if image cannot be loaded or validated
 *
 * @example
 * const imageBuffer = await loadImageAsBuffer('./photo.jpg');
 */
export async function loadImageAsBuffer(imagePath) {
    // Validate image first
    await validateImagePath(imagePath);
    // Read as buffer
    const buffer = await fs.readFile(imagePath);
    // Validate file size (50MB max as per security requirements)
    if (buffer.length > 50 * 1024 * 1024) {
        throw new Error('Image file size exceeds maximum of 50MB');
    }
    return buffer;
}
/**
 * Download image from URL and return as Buffer.
 * Validates URL for security before downloading.
 *
 * @param imageUrl - HTTPS URL to image
 * @returns Image data as Buffer
 * @throws Error if download fails or validation fails
 *
 * @example
 * const imageBuffer = await downloadImageAsBuffer('https://example.com/image.jpg');
 */
export async function downloadImageAsBuffer(imageUrl) {
    logger.debug(`Downloading image from URL: ${imageUrl}`);
    // validateImageUrl runs on the URL and on every redirect target (up to 5).
    const response = await fetchFollowingRedirects(imageUrl, {
        validate: validateImageUrl,
        timeoutMs: 60000,
    });
    // Validate Content-Type header
    const allowedMimeTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
    const contentType = response.headers.get('content-type')?.split(';')[0].trim();
    if (!contentType || !allowedMimeTypes.includes(contentType)) {
        await response.body?.cancel().catch(() => undefined);
        throw new Error(`Invalid Content-Type: ${contentType}. Expected image/* (png, jpeg, webp, gif)`);
    }
    return readBodyWithLimit(response, 50 * 1024 * 1024);
}
/**
 * Download a generated result into memory, with SSRF checks on the URL and
 * every redirect. Unlike downloadImageAsBuffer it does not check the
 * Content-Type (Ideogram's result URLs are trusted to serve what they name).
 *
 * @param url - HTTPS URL of the result
 * @param options - `maxBytes` (default 200MB, for 8k transparent PNGs) and `timeoutMs` (default 60s)
 */
export async function downloadBuffer(url, options = {}) {
    const response = await fetchFollowingRedirects(url, {
        validate: validateImageUrl,
        timeoutMs: options.timeoutMs ?? 60000,
    });
    return readBodyWithLimit(response, options.maxBytes ?? 200 * 1024 * 1024);
}
/**
 * Stream a generated result (a video, an SVG) to a file without holding it in
 * memory, with SSRF checks on the URL and every redirect.
 *
 * @param url - HTTPS URL of the result
 * @param outputPath - File to write (parent directories are created)
 * @param options - `maxBytes` (default 2GB) and `timeoutMs` (default 5 minutes)
 * @throws Error if the download fails or exceeds `maxBytes`; any partial file is
 *   removed (best effort) before the original error is rethrown
 */
export async function downloadToFile(url, outputPath, options = {}) {
    const response = await fetchFollowingRedirects(url, {
        validate: validateImageUrl,
        timeoutMs: options.timeoutMs ?? 300000,
    });
    await streamToFile(response, outputPath, options.maxBytes ?? 2 * 1024 * 1024 * 1024);
}
/**
 * Detect an image's format from its magic bytes.
 * Used to give multipart file parts a filename and Content-Type that match
 * their bytes. Returns null for anything that is not PNG, JPEG, WebP or GIF.
 *
 * @param buffer - Image bytes
 * @returns `{ extension, mimeType }`, or null when the format is not recognized
 *
 * @example
 * detectImageType(pngBuffer); // { extension: 'png', mimeType: 'image/png' }
 */
export function detectImageType(buffer) {
    if (buffer.length >= 4 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
        return { extension: 'png', mimeType: 'image/png' };
    }
    if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
        return { extension: 'jpg', mimeType: 'image/jpeg' };
    }
    if (buffer.length >= 12 && buffer.slice(0, 4).toString() === 'RIFF' && buffer.slice(8, 12).toString() === 'WEBP') {
        return { extension: 'webp', mimeType: 'image/webp' };
    }
    if (buffer.length >= 3 && buffer.slice(0, 3).toString() === 'GIF') {
        return { extension: 'gif', mimeType: 'image/gif' };
    }
    return null;
}
/**
 * Detect an audio file's format from its magic bytes: WAV (`RIFF....WAVE`) or
 * MP3 (an `ID3` tag, or an MPEG audio frame sync). Returns null otherwise.
 * Video reference endpoints accept MP3 and WAV only.
 *
 * @example
 * detectAudioType(wavBuffer); // { extension: 'wav', mimeType: 'audio/wav' }
 */
export function detectAudioType(buffer) {
    if (buffer.length >= 12 && buffer.slice(0, 4).toString() === 'RIFF' && buffer.slice(8, 12).toString() === 'WAVE') {
        return { extension: 'wav', mimeType: 'audio/wav' };
    }
    if (buffer.length >= 3 && buffer.slice(0, 3).toString() === 'ID3') {
        return { extension: 'mp3', mimeType: 'audio/mpeg' };
    }
    // MPEG audio frame header: 11 sync bits set. JPEG (FF D8) does not match
    // because 0xD8 & 0xE0 is 0xC0.
    if (buffer.length >= 2 && buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) {
        return { extension: 'mp3', mimeType: 'audio/mpeg' };
    }
    return null;
}
/**
 * Load an MP3 or WAV file for a video reference upload.
 * Checks the magic bytes and the 15MB per-file limit both video models share.
 * Duration limits (2-15s on MiniMax H3, 2-30s on Seedance 2.5) are enforced
 * by the API, not here.
 *
 * @throws Error if the file is missing, empty, not MP3/WAV, or over 15MB
 */
export async function loadAudioAsBuffer(audioPath) {
    let buffer;
    try {
        buffer = await fs.readFile(audioPath);
    }
    catch (error) {
        const code = isErrnoException(error) ? error.code : undefined;
        if (code === 'ENOENT')
            throw new Error(`Audio file not found: ${audioPath}`);
        if (code === 'EACCES')
            throw new Error(`Permission denied reading audio file: ${audioPath}`);
        throw error;
    }
    if (buffer.length === 0) {
        throw new Error(`Audio file is empty: ${audioPath}`);
    }
    if (!detectAudioType(buffer)) {
        throw new Error(`File does not appear to be MP3 or WAV audio: ${audioPath}`);
    }
    if (buffer.length > 15 * 1024 * 1024) {
        throw new Error(`Audio file ${audioPath} exceeds the 15MB limit`);
    }
    return buffer;
}
/**
 * Append a file part named after its detected format (image, then audio).
 * Unrecognized bytes keep the historical `image.jpg` name and `image/jpeg`
 * type: form-data, before 2026-11-22, derived the type from that filename.
 */
function appendFile(formData, key, buffer) {
    const type = detectImageType(buffer) ?? detectAudioType(buffer);
    const prefix = type?.mimeType.startsWith('audio/') ? 'audio' : 'image';
    const blob = new Blob([new Uint8Array(buffer)], { type: type?.mimeType ?? 'image/jpeg' });
    formData.append(key, blob, `${prefix}.${type?.extension ?? 'jpg'}`);
}
/**
 * Create a native FormData for multipart/form-data requests.
 * Handles text fields, image and audio files (Buffers), and JSON objects.
 * Returned a `form-data` package instance before 2026-11-22.
 *
 * @param params - Parameters to add to FormData
 * @returns Populated FormData object
 *
 * @example
 * const formData = buildFormData({
 *   prompt: 'a cat',
 *   aspect_ratio: '1x1',
 *   num_images: 1
 * });
 */
export function buildFormData(params) {
    const formData = new FormData();
    for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === null) {
            continue; // Skip undefined/null values
        }
        if (Buffer.isBuffer(value)) {
            // Buffer: Append as file, named and typed after its magic bytes
            appendFile(formData, key, value);
        }
        else if (typeof value === 'object' && !Array.isArray(value)) {
            // Object: Convert to JSON string
            formData.append(key, JSON.stringify(value));
        }
        else if (Array.isArray(value)) {
            // Array: Append each item separately (for multiple images or style_codes)
            value.forEach((item) => {
                if (Buffer.isBuffer(item)) {
                    appendFile(formData, key, item);
                }
                else {
                    formData.append(key, String(item));
                }
            });
        }
        else {
            // Primitive: Append as-is
            formData.append(key, String(value));
        }
    }
    return formData;
}
/**
 * Save base64-encoded or raw Buffer image to file.
 * Creates output directory if it doesn't exist.
 *
 * @param imageData - Base64-encoded string or Buffer
 * @param outputPath - Path to save file
 * @returns Path to saved file
 *
 * @example
 * await saveImage(imageBuffer, 'output/image.png');
 * await saveImage(base64String, 'output/image.png');
 */
export async function saveImage(imageData, outputPath) {
    // Ensure directory exists
    const dir = path.dirname(outputPath);
    await fs.mkdir(dir, { recursive: true });
    let buffer;
    if (Buffer.isBuffer(imageData)) {
        // Already a buffer
        buffer = imageData;
    }
    else if (typeof imageData === 'string') {
        // Base64 string
        buffer = Buffer.from(imageData, 'base64');
    }
    else {
        throw new Error('imageData must be a Buffer or base64-encoded string');
    }
    // Write to file
    await fs.writeFile(outputPath, buffer);
    logger.debug(`Saved image to: ${outputPath}`);
    return outputPath;
}
/**
 * Generate a safe filename from a prompt and timestamp.
 * Removes special characters and limits length.
 *
 * @param prompt - Generation prompt
 * @param extension - File extension (default: 'png')
 * @param maxLength - Maximum filename length excluding extension (default: 50)
 * @returns Safe filename with timestamp
 *
 * @example
 * generateFilename('A beautiful sunset over mountains');
 * // '20250119_143022_beautiful-sunset-over-mountains.png'
 */
export function generateFilename(prompt, extension = 'png', maxLength = 50) {
    // Create timestamp prefix (YYYYMMDD_HHMMSS)
    const now = new Date();
    const timestamp = now
        .toISOString()
        .replace(/[-:]/g, '')
        .replace('T', '_')
        .split('.')[0];
    // Sanitize prompt: lowercase, remove special chars, replace spaces with hyphens
    const sanitized = prompt
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .trim()
        .replace(/\s+/g, '-')
        .substring(0, maxLength);
    // Sanitize extension: remove non-alphanumeric chars, limit length, default to 'png'
    const sanitizedExtension = extension
        .toLowerCase()
        .replace(/^\.+/, '') // Remove leading dots
        .replace(/[^a-z0-9]/g, '') // Remove non-alphanumeric
        .substring(0, 10) || 'png'; // Fallback to 'png' if empty after sanitization
    return `${timestamp}_${sanitized}.${sanitizedExtension}`;
}
/**
 * Ensure output directory exists.
 * Creates directory recursively if it doesn't exist.
 *
 * @param dirPath - Directory path to create
 * @returns Created directory path
 *
 * @example
 * await ensureDirectory('datasets/ideogram/generate-v3');
 */
export async function ensureDirectory(dirPath) {
    await fs.mkdir(dirPath, { recursive: true });
    return dirPath;
}
/**
 * Save metadata JSON file alongside image.
 *
 * @param metadataPath - Path to save JSON metadata
 * @param metadata - Metadata object
 * @returns Path to saved metadata file
 *
 * @example
 * await saveMetadata('output/image.json', { operation: 'generate', prompt: '...' });
 */
export async function saveMetadata(metadataPath, metadata) {
    const jsonContent = JSON.stringify(metadata, null, 2);
    await fs.writeFile(metadataPath, jsonContent, 'utf8');
    logger.debug(`Saved metadata to: ${metadataPath}`);
    return metadataPath;
}
/**
 * Pause execution for specified milliseconds.
 *
 * @param ms - Milliseconds to pause
 *
 * @example
 * await pause(2000); // Wait 2 seconds
 */
export function pause(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
/**
 * Create a spinner for long-running operations.
 * Returns an object with start(), stop(), and update() methods.
 *
 * @param message - Message to display with spinner
 * @returns Spinner object with start(), stop(), and update() methods
 *
 * @example
 * const spinner = createSpinner('Generating image...');
 * spinner.start();
 * // ... do work ...
 * spinner.stop('✓ Complete!');
 */
export function createSpinner(message) {
    const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    let frameIndex = 0;
    let interval = null;
    let currentMessage = message;
    return {
        start() {
            process.stdout.write('\n');
            interval = setInterval(() => {
                const frame = frames[frameIndex];
                process.stdout.write(`\r${frame} ${currentMessage}`);
                frameIndex = (frameIndex + 1) % frames.length;
            }, 80);
        },
        stop(finalMessage = null) {
            if (interval) {
                clearInterval(interval);
                interval = null;
            }
            process.stdout.write('\r');
            if (finalMessage) {
                process.stdout.write(`${finalMessage}\n`);
            }
            else {
                process.stdout.write('\r\x1b[K'); // Clear line
            }
        },
        update(newMessage) {
            currentMessage = newMessage;
        },
    };
}
/**
 * Set logger level.
 *
 * @param level - Log level (debug, info, warn, error)
 */
export function setLogLevel(level) {
    logger.level = level.toLowerCase();
}
export { logger };
//# sourceMappingURL=utils.js.map