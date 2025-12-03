/**
 * Ideogram API Service Utility Functions
 *
 * Utility functions for Ideogram image generation, including file I/O,
 * image handling, FormData building, and data transformations.
 */

import fs from 'fs/promises';
import path from 'path';
import winston from 'winston';
import axios from 'axios';
import FormData from 'form-data';
import { imageSize } from 'image-size';
import { imageSizeFromFile } from 'image-size/fromFile';
import { lookup } from 'dns/promises';
import { isIPv4, isIPv6 } from 'net';
import type { SpinnerObject, ImageDimensions } from './types/index.js';

// Configure module logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => {
      return `${timestamp} - ${level.toUpperCase()} - ${message}`;
    })
  ),
  transports: [new winston.transports.Console()],
});

/**
 * Helper function to check if an IP address is blocked (private/internal).
 *
 * @param ip - IP address to check (IPv4 or IPv6)
 * @returns True if IP is blocked, false otherwise
 */
function isBlockedIP(ip: string): boolean {
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
export async function validateImageUrl(url: string): Promise<string> {
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

  let parsed: URL;

  try {
    parsed = new URL(url);
  } catch {
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
  } else {
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
    } catch (error) {
      const err = error as NodeJS.ErrnoException & { message?: string };
      if (err.code === 'ENOTFOUND') {
        logger.warn(`SECURITY: Domain ${hostname} could not be resolved`);
        throw new Error(`Domain ${hostname} could not be resolved`);
      } else if (err.message && err.message.includes('resolves to internal')) {
        // Re-throw our custom error about blocked IPs
        throw error;
      } else {
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
export async function validateImagePath(filepath: string): Promise<string> {
  try {
    const buffer = await fs.readFile(filepath);

    // Check file size (must be > 0)
    if (buffer.length === 0) {
      throw new Error(`Image file is empty: ${filepath}`);
    }

    // Check magic bytes for common image formats
    const magicBytes = buffer.slice(0, 4);
    const isPNG =
      magicBytes[0] === 0x89 &&
      magicBytes[1] === 0x50 &&
      magicBytes[2] === 0x4e &&
      magicBytes[3] === 0x47;
    const isJPEG = magicBytes[0] === 0xff && magicBytes[1] === 0xd8 && magicBytes[2] === 0xff;
    const isWebP = buffer.slice(8, 12).toString() === 'WEBP';
    const isGIF = magicBytes.slice(0, 3).toString() === 'GIF';

    if (!isPNG && !isJPEG && !isWebP && !isGIF) {
      throw new Error(
        `File does not appear to be a valid image (PNG, JPEG, WebP, or GIF): ${filepath}`
      );
    }

    return filepath;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') {
      throw new Error(`Image file not found: ${filepath}`);
    } else if (err.code === 'EACCES') {
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
export async function assertSquareImage(imageSource: string | Buffer): Promise<void> {
  let dimensions: ImageDimensions;

  try {
    if (Buffer.isBuffer(imageSource) || ArrayBuffer.isView(imageSource)) {
      // Accept Buffer/Uint8Array inputs directly
      const result = imageSize(imageSource as Buffer);
      if (!result.width || !result.height) {
        throw new Error('Could not determine image dimensions');
      }
      dimensions = { width: result.width, height: result.height };
    } else if (typeof imageSource === 'string') {
      // Paths require async helper
      const result = await imageSizeFromFile(imageSource);
      if (!result.width || !result.height) {
        throw new Error('Could not determine image dimensions');
      }
      dimensions = { width: result.width, height: result.height };
    } else {
      throw new Error('Unsupported image input');
    }
  } catch (error) {
    const err = error as Error;
    throw new Error(`Unable to read image dimensions: ${err.message}`);
  }

  const { width, height } = dimensions;

  if (width !== height) {
    throw new Error(`Image must be square. Received ${width}x${height}`);
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
export async function loadImageAsBuffer(imagePath: string): Promise<Buffer> {
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
export async function downloadImageAsBuffer(imageUrl: string): Promise<Buffer> {
  // Validate URL first
  const validatedUrl = await validateImageUrl(imageUrl);

  logger.debug(`Downloading image from URL: ${validatedUrl}`);

  const response = await axios.get<ArrayBuffer>(validatedUrl, {
    responseType: 'arraybuffer',
    timeout: 60000, // 60 seconds
    maxContentLength: 50 * 1024 * 1024, // 50MB max
    maxRedirects: 5,
  });

  // Validate Content-Type header
  const allowedMimeTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
  const contentType = response.headers['content-type']?.split(';')[0].trim();

  if (!contentType || !allowedMimeTypes.includes(contentType)) {
    throw new Error(
      `Invalid Content-Type: ${contentType}. Expected image/* (png, jpeg, webp, gif)`
    );
  }

  return Buffer.from(response.data);
}

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
export function buildFormData(params: FormDataParams): FormData {
  const formData = new FormData();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) {
      continue; // Skip undefined/null values
    }

    if (Buffer.isBuffer(value)) {
      // Buffer: Append as file
      formData.append(key, value, { filename: 'image.jpg' });
    } else if (typeof value === 'object' && !Array.isArray(value)) {
      // Object: Convert to JSON string
      formData.append(key, JSON.stringify(value));
    } else if (Array.isArray(value)) {
      // Array: Append each item separately (for multiple images or style_codes)
      value.forEach((item) => {
        if (Buffer.isBuffer(item)) {
          formData.append(key, item, { filename: 'image.jpg' });
        } else {
          formData.append(key, String(item));
        }
      });
    } else {
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
export async function saveImage(imageData: string | Buffer, outputPath: string): Promise<string> {
  // Ensure directory exists
  const dir = path.dirname(outputPath);
  await fs.mkdir(dir, { recursive: true });

  let buffer: Buffer;

  if (Buffer.isBuffer(imageData)) {
    // Already a buffer
    buffer = imageData;
  } else if (typeof imageData === 'string') {
    // Base64 string
    buffer = Buffer.from(imageData, 'base64');
  } else {
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
export function generateFilename(
  prompt: string,
  extension = 'png',
  maxLength = 50
): string {
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
  const sanitizedExtension =
    extension
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
export async function ensureDirectory(dirPath: string): Promise<string> {
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
export async function saveMetadata(
  metadataPath: string,
  metadata: Record<string, unknown>
): Promise<string> {
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
export function pause(ms: number): Promise<void> {
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
export function createSpinner(message: string): SpinnerObject {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let frameIndex = 0;
  let interval: ReturnType<typeof setInterval> | null = null;
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

    stop(finalMessage: string | null = null) {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
      process.stdout.write('\r');
      if (finalMessage) {
        process.stdout.write(`${finalMessage}\n`);
      } else {
        process.stdout.write('\r\x1b[K'); // Clear line
      }
    },

    update(newMessage: string) {
      currentMessage = newMessage;
    },
  };
}

/**
 * Set logger level.
 *
 * @param level - Log level (debug, info, warn, error)
 */
export function setLogLevel(level: string): void {
  logger.level = level.toLowerCase();
}

export { logger };
