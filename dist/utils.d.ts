/**
 * Ideogram API Service Utility Functions
 *
 * Utility functions for Ideogram image generation, including file I/O,
 * image handling, FormData building, and data transformations.
 */
import winston from 'winston';
import FormData from 'form-data';
import type { SpinnerObject } from './types/index.js';
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
 * FormData parameters type.
 */
interface FormDataParams {
    [key: string]: unknown;
}
/**
 * Create FormData for multipart/form-data requests.
 * Handles text fields, image files, and JSON objects.
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