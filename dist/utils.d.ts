/**
 * Ideogram API Service Utility Functions
 *
 * Utility functions for Ideogram image generation, including file I/O,
 * image handling, FormData building, and data transformations.
 */
import type { ImageDimensions } from './types/index.js';
/** Coerce a caught value to an Error (a non-Error keeps its `message`, else its string form). */
export declare function toError(e: unknown): Error;
/** True for an error-like object carrying a Node system error `code` (ENOENT, EACCES, ...). */
export declare function isErrnoException(e: unknown): e is NodeJS.ErrnoException;
/**
 * Validate image URL for security.
 * Enforces HTTPS and blocks private IPs, localhost, and cloud metadata endpoints.
 *
 * The address check parses the URL (WHATWG), so every spelling of an address
 * (hex or dotted IPv4-mapped IPv6, 0x7f.1, 2130706433) reaches it in one form.
 * A host name is resolved and EVERY address it returns must be public.
 *
 * Limit: this validates the addresses the name resolves to now. It does not pin
 * the later fetch to them, so a host that answers differently between this
 * check and the fetch (DNS rebinding) is not prevented.
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
 * @returns The response body
 * @throws Error if `maxBytes` is not an integer >= 1 or `timeoutMs` is not an integer from 1 to 2147483647
 *   (before any request is sent), if the URL fails validation, the download fails, or the body exceeds `maxBytes`
 *
 * @example
 * const bytes = await downloadBuffer('https://ideogram.ai/api/images/ephemeral/x.png', { timeoutMs: 30000 });
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
 * @returns Resolves once the file is fully written
 * @throws Error if `maxBytes` or `timeoutMs` is out of range (before any request is sent), if the
 *   download fails or exceeds `maxBytes`; any partial file is
 *   removed (best effort) before the original error is rethrown
 *
 * @example
 * await downloadToFile('https://ideogram.ai/api/videos/x.mp4', 'out/x.mp4', { timeoutMs: 600000 });
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
 * Set the level of the module logger: file loading, DNS and download checks
 * and the CLI's own messages. Library default is 'warn'; logs go to stderr.
 * Also becomes the default level of `IdeogramAPI` instances created AFTER this
 * call; an existing instance keeps its own level (change it with
 * `IdeogramAPI#setLogLevel`).
 *
 * @param level - Log level (debug, info, warn, error)
 */
export declare function setLogLevel(level: string): void;
export {};
//# sourceMappingURL=utils.d.ts.map