/**
 * Ideogram API Service Utility Functions
 *
 * Utility functions for Ideogram image generation, including file I/O,
 * image handling, FormData building, and data transformations.
 */
import winston from 'winston';
import type { SpinnerObject, ImageDimensions } from './types/index.js';
/** Coerce a caught value to an Error (a non-Error keeps its `message`, else its string form). */
export declare function toError(e: unknown): Error;
/** True for an error-like object carrying a Node system error `code` (ENOENT, EACCES, ...). */
export declare function isErrnoException(e: unknown): e is NodeJS.ErrnoException;
declare const logger: winston.Logger;
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
export declare function validateImageUrl(url: string): Promise<string>;
/**
 * Validate image file path.
 * Checks file exists, is readable, and has valid image magic bytes.
 *
 * @param filepath - Path to image file
 * @returns Validated filepath
 * @throws Error if file doesn't exist, isn't readable, or isn't a valid image
 */
export declare function validateImagePath(filepath: string): Promise<string>;
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
export declare function assertSquareImage(imageSource: string | Buffer): Promise<void>;
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
export declare function getImageDimensions(imageSource: string | Buffer): Promise<ImageDimensions>;
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
export declare function loadImageAsBuffer(imagePath: string): Promise<Buffer>;
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
export declare function downloadImageAsBuffer(imageUrl: string): Promise<Buffer>;
/**
 * Download a generated result into memory, with SSRF checks on the URL and
 * every redirect. Unlike downloadImageAsBuffer it does not check the
 * Content-Type (Ideogram's result URLs are trusted to serve what they name).
 *
 * @param url - HTTPS URL of the result
 * @param options - `maxBytes` (default 200MB, for 8k transparent PNGs) and `timeoutMs` (default 60s)
 */
export declare function downloadBuffer(url: string, options?: {
    maxBytes?: number;
    timeoutMs?: number;
}): Promise<Buffer>;
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
export declare function downloadToFile(url: string, outputPath: string, options?: {
    maxBytes?: number;
    timeoutMs?: number;
}): Promise<void>;
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
export declare function detectImageType(buffer: Buffer): {
    extension: string;
    mimeType: string;
} | null;
/**
 * Detect an audio file's format from its magic bytes: WAV (`RIFF....WAVE`) or
 * MP3 (an `ID3` tag, or an MPEG audio frame sync). Returns null otherwise.
 * Video reference endpoints accept MP3 and WAV only.
 *
 * @example
 * detectAudioType(wavBuffer); // { extension: 'wav', mimeType: 'audio/wav' }
 */
export declare function detectAudioType(buffer: Buffer): {
    extension: string;
    mimeType: string;
} | null;
/**
 * Load an MP3 or WAV file for a video reference upload.
 * Checks the magic bytes and the 15MB per-file limit both video models share.
 * Duration limits (2-15s on MiniMax H3, 2-30s on Seedance 2.5) are enforced
 * by the API, not here.
 *
 * @throws Error if the file is missing, empty, not MP3/WAV, or over 15MB
 */
export declare function loadAudioAsBuffer(audioPath: string): Promise<Buffer>;
/**
 * FormData parameters type.
 */
interface FormDataParams {
    [key: string]: unknown;
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
export declare function buildFormData(params: FormDataParams): FormData;
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
export declare function saveImage(imageData: string | Buffer, outputPath: string): Promise<string>;
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
export declare function generateFilename(prompt: string, extension?: string, maxLength?: number): string;
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
export declare function ensureDirectory(dirPath: string): Promise<string>;
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
export declare function saveMetadata(metadataPath: string, metadata: Record<string, unknown>): Promise<string>;
/**
 * Pause execution for specified milliseconds.
 *
 * @param ms - Milliseconds to pause
 *
 * @example
 * await pause(2000); // Wait 2 seconds
 */
export declare function pause(ms: number): Promise<void>;
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
export declare function createSpinner(message: string): SpinnerObject;
/**
 * Set logger level.
 *
 * @param level - Log level (debug, info, warn, error)
 */
export declare function setLogLevel(level: string): void;
export { logger };
//# sourceMappingURL=utils.d.ts.map