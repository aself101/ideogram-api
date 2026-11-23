/**
 * File and terminal helpers for the CLI (src/program.ts, src/cli-v2.ts).
 *
 * Moved out of `ideogram-api/utils` in 2.0: they serve the command line, not
 * library callers, so they are not part of the public surface (this module is
 * not in package.json `exports`).
 */

import dotenv from 'dotenv';
import fs from 'fs/promises';
import { readFileSync } from 'fs';
import { homedir } from 'os';
import path from 'path';
import { logger } from './logger.js';
import { isErrnoException, toError } from './utils.js';
import type { SpinnerObject } from './types/index.js';

/**
 * Set process.env.IDEOGRAM_API_KEY from a .env file, for the CLI only.
 *
 * Until 2.0 the library loaded the cwd .env and ~/.ideogram/.env into
 * process.env at import, every variable in them. Now only the CLI reads them,
 * and only IDEOGRAM_API_KEY is taken (via `dotenv.parse`, which does not touch
 * process.env). Precedence is unchanged: an IDEOGRAM_API_KEY already in the
 * environment wins (even an empty one, as before), then the first file that
 * defines the key: `<cwd>/.env`, then `<home>/.ideogram/.env`. The --api-key
 * flag outranks all of these (getIdeogramApiKey).
 *
 * A missing file is normal and silent; any other read or parse failure is
 * logged with the path and the next file is tried.
 *
 * @returns The file the key was taken from, or undefined if none supplied it
 */
export function loadDotenvApiKey(cwd: string = process.cwd(), home: string = homedir()): string | undefined {
  if (Object.prototype.hasOwnProperty.call(process.env, 'IDEOGRAM_API_KEY')) return undefined;
  for (const file of [path.join(cwd, '.env'), path.join(home, '.ideogram', '.env')]) {
    let parsed: Record<string, string>;
    try {
      parsed = dotenv.parse(readFileSync(file));
    } catch (error) {
      if (!(isErrnoException(error) && error.code === 'ENOENT')) {
        logger.warn(`Could not read ${file}: ${toError(error).message}`);
      }
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(parsed, 'IDEOGRAM_API_KEY')) {
      process.env.IDEOGRAM_API_KEY = parsed.IDEOGRAM_API_KEY;
      return file;
    }
  }
  return undefined;
}

/**
 * Create an empty file at `filePath` that nothing else owns, and return its
 * path. If the name is taken, `-2`, `-3`, ... is inserted before the extension
 * until one is free (created with the `wx` flag, so two writers cannot claim
 * the same name). The caller then writes to the returned path. Two results with
 * the same timestamp and prompt therefore never overwrite each other.
 *
 * @param filePath - Preferred path; its directory is created if missing
 * @returns The path that was claimed
 */
export async function claimPath(filePath: string): Promise<string> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const { dir, name, ext } = path.parse(filePath);
  for (let n = 1; n <= 10000; n++) {
    const candidate = n === 1 ? filePath : path.join(dir, `${name}-${n}${ext}`);
    try {
      const handle = await fs.open(candidate, 'wx');
      await handle.close();
      return candidate;
    } catch (error) {
      if (isErrnoException(error) && error.code === 'EEXIST') continue;
      throw error;
    }
  }
  throw new Error(`Could not find an unused file name for ${filePath}`);
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
 * @param maxLength - Maximum length of the sanitized prompt part (default: 50)
 * @param index - Optional 1-based item number, appended as `-N` AFTER the prompt
 *   part is truncated, so every item of a run keeps a distinct name however long
 *   the prompt is
 * @returns Safe filename with timestamp
 *
 * @example
 * generateFilename('A beautiful sunset over mountains');
 * // '20250119_143022_beautiful-sunset-over-mountains.png'
 */
export function generateFilename(
  prompt: string,
  extension = 'png',
  maxLength = 50,
  index?: number
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

  const suffix = index === undefined ? '' : `-${index}`;
  return `${timestamp}_${sanitized}${suffix}.${sanitizedExtension}`;
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
