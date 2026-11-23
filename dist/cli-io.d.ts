/**
 * File and terminal helpers for the CLI (src/program.ts, src/cli-v2.ts).
 *
 * Moved out of `ideogram-api/utils` in 2.0: they serve the command line, not
 * library callers, so they are not part of the public surface (this module is
 * not in package.json `exports`).
 */
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
export declare function loadDotenvApiKey(cwd?: string, home?: string): string | undefined;
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
export declare function claimPath(filePath: string): Promise<string>;
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
export declare function generateFilename(prompt: string, extension?: string, maxLength?: number, index?: number): string;
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
 * Returns an object with start(), stop(), and update() methods. Frames are
 * written only when stdout is a TTY; otherwise nothing is written until stop(),
 * which prints the final message once (so a log or pipe gets no frame noise).
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
//# sourceMappingURL=cli-io.d.ts.map