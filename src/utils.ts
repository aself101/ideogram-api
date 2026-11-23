/**
 * Ideogram API Service Utility Functions
 *
 * Utility functions for Ideogram image generation, including file I/O,
 * image handling, FormData building, and data transformations.
 */

import fs from 'fs/promises';
import { logger, normalizeLogLevel } from './logger.js';
import { assertMaxBytes, assertTimerMs, fetchFollowingRedirects, readBodyWithLimit, streamToFile } from './http.js';
import { imageSize } from 'image-size';
import { imageSizeFromFile } from 'image-size/fromFile';
import { lookup } from 'dns/promises';
import { BlockList, isIPv4, isIPv6 } from 'net';
import type { ImageDimensions } from './types/index.js';

/** Coerce a caught value to an Error (a non-Error keeps its `message`, else its string form). */
export function toError(e: unknown): Error {
  if (e instanceof Error) return e;
  if (typeof e === 'object' && e !== null && typeof (e as { message?: unknown }).message === 'string') {
    return new Error((e as { message: string }).message, { cause: e });
  }
  return new Error(String(e), { cause: e });
}

/** True for an error-like object carrying a Node system error `code` (ENOENT, EACCES, ...). */
export function isErrnoException(e: unknown): e is NodeJS.ErrnoException {
  return typeof e === 'object' && e !== null && typeof (e as { code?: unknown }).code === 'string';
}

/**
 * Address ranges a download must never reach: loopback, unspecified, private,
 * link-local (cloud metadata), CGNAT, IETF/benchmarking, multicast, reserved
 * (240/4, which includes the broadcast address), the documentation ranges, and
 * the IPv6 transition ranges (local-use NAT64, SIIT, Teredo). IPv4-mapped IPv6
 * is unwrapped to IPv4 before this list is consulted (see unwrapMappedIPv4), as
 * are NAT64 (64:ff9b::/96) and 6to4 (2002::/16): their embedded IPv4 address
 * is what gets checked (see embeddedIPv4).
 */
const BLOCKED_ADDRESSES = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8], // "this network", includes 0.0.0.0
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // CGNAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, AWS/GCP/Azure metadata
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, includes 255.255.255.255
  ['192.0.2.0', 24], // documentation (TEST-NET-1)
  ['198.51.100.0', 24], // documentation (TEST-NET-2)
  ['203.0.113.0', 24], // documentation (TEST-NET-3)
] as const) {
  BLOCKED_ADDRESSES.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
  ['::', 96], // unspecified (::), loopback (::1) and the deprecated IPv4-compatible range
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['ff00::', 8], // multicast
  // 64:ff9b::/96 (NAT64) and 2002::/16 (6to4) embed an IPv4 address; isBlockedIP
  // checks that address instead (embeddedIPv4), so neither prefix is listed here.
  ['64:ff9b:1::', 48], // local-use NAT64: blocked outright
  ['::ffff:0:0:0', 96], // IPv4-translated (SIIT)
  ['2001::', 32], // Teredo
  ['2001:db8::', 32], // documentation
] as const) {
  BLOCKED_ADDRESSES.addSubnet(network, prefix, 'ipv6');
}

/**
 * If `ip` is an IPv4-mapped IPv6 address (::ffff:a.b.c.d), in any spelling
 * (dotted, hex, uncompressed), return the IPv4 address; otherwise return `ip`
 * unchanged (lower-cased, brackets and a zone id removed). The WHATWG URL
 * parser is the normalizer: it turns every spelling into the compressed hex
 * form, so one pattern covers them all.
 */
function unwrapMappedIPv4(ip: string): string {
  const bare = ip.replace(/^\[|\]$/g, '').split('%')[0].toLowerCase();
  if (!isIPv6(bare)) return bare;
  let normalized = bare;
  try {
    normalized = new URL(`http://[${bare}]/`).hostname.replace(/^\[|\]$/g, '');
  } catch {
    // AUDIT-OK(no_empty_catch): isIPv6 accepted the text, so this cannot fail; if it ever did, the un-normalized text is still checked below
  }
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(normalized);
  if (!mapped) return normalized;
  const high = parseInt(mapped[1], 16);
  const low = parseInt(mapped[2], 16);
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
}

/**
 * The IPv4 address embedded in a NAT64 (64:ff9b::/96, last 32 bits) or 6to4
 * (2002::/16, bits 16-47) IPv6 address, or undefined for any other address.
 * Takes the compressed hex form the URL parser produces. A DNS64 network
 * synthesizes 64:ff9b::a.b.c.d for a public IPv4-only host, so the embedded
 * address decides. 64:ff9b:1::/48 (local-use NAT64) does not match and stays blocked.
 */
function embeddedIPv4(ipv6: string): string | undefined {
  const [head, tail, extra] = ipv6.split('::');
  if (extra !== undefined) return undefined;
  const front = head === '' ? [] : head.split(':');
  const back = tail === undefined || tail === '' ? [] : tail.split(':');
  let groups: string[];
  if (tail === undefined) {
    groups = front;
  } else {
    const missing = 8 - front.length - back.length;
    if (missing < 1) return undefined;
    groups = [...front, ...new Array<string>(missing).fill('0'), ...back];
  }
  if (groups.length !== 8 || !groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return undefined;
  const h = groups.map((g) => parseInt(g, 16));
  const dotted = (high: number, low: number) => `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
  if (h[0] === 0x64 && h[1] === 0xff9b && h.slice(2, 6).every((v) => v === 0)) return dotted(h[6], h[7]);
  if (h[0] === 0x2002) return dotted(h[1], h[2]);
  return undefined;
}

/**
 * Check whether an IP address (IPv4 or IPv6, brackets allowed) is in a blocked
 * range. An unparseable address is blocked: it cannot be shown to be public.
 *
 * @param ip - IP address to check
 * @returns True if the address is blocked, false if it is a routable public address
 */
function isBlockedIP(ip: string): boolean {
  const address = unwrapMappedIPv4(ip);
  if (isIPv4(address)) return BLOCKED_ADDRESSES.check(address, 'ipv4');
  if (isIPv6(address)) {
    const embedded = embeddedIPv4(address);
    if (embedded !== undefined && isIPv4(embedded)) return BLOCKED_ADDRESSES.check(embedded, 'ipv4');
    return BLOCKED_ADDRESSES.check(address, 'ipv6');
  }
  return true;
}

/** True when `ip` is IPv4 loopback (127/8), after unwrapping an IPv4-mapped IPv6 spelling. */
function isLoopbackIPv4(ip: string): boolean {
  const address = unwrapMappedIPv4(ip);
  return isIPv4(address) && address.startsWith('127.');
}

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
export async function validateImageUrl(url: string): Promise<string> {
  let parsed: URL;

  try {
    parsed = new URL(url);
  } catch (error) {
    throw new Error(`Invalid URL: ${url}`, { cause: error });
  }

  // Only allow HTTPS (not HTTP)
  if (parsed.protocol !== 'https:') {
    throw new Error('Only HTTPS URLs are allowed for security reasons');
  }

  const hostname = parsed.hostname.toLowerCase();
  const cleanHostname = hostname.replace(/^\[|\]$/g, '').replace(/\.$/, ''); // no IPv6 brackets, no trailing dot

  // First check if hostname itself is blocked (before DNS resolution)
  const blockedHosts = ['localhost', 'metadata.google.internal', 'metadata'];
  if (blockedHosts.includes(cleanHostname)) {
    logger.warn(`SECURITY: Blocked access to prohibited hostname: ${hostname}`);
    throw new Error(`Access to cloud metadata endpoints is not allowed (host ${hostname}). Use a public HTTPS URL.`);
  }

  // Check if hostname is already an IP address (not a domain name)
  if (isIPv4(cleanHostname) || isIPv6(cleanHostname)) {
    if (isBlockedIP(cleanHostname)) {
      if (isIPv6(cleanHostname) && isLoopbackIPv4(cleanHostname)) {
        logger.warn(`SECURITY: Blocked IPv4-mapped IPv6 localhost: ${hostname}`);
        throw new Error(`Access to localhost is not allowed (host ${hostname}). Use a public HTTPS URL.`);
      }
      logger.warn(`SECURITY: Blocked access to private/internal IP: ${hostname}`);
      throw new Error(
        `Access to internal/private IP addresses is not allowed (host ${hostname}). Use a public HTTPS URL.`
      );
    }
    return url;
  }

  // Hostname is a domain name: resolve it and require every answer to be public.
  let addresses: string[];
  try {
    logger.debug(`Resolving DNS for hostname: ${hostname}`);
    const answers = await lookup(hostname, { all: true });
    // `all: true` yields an array; a single { address } is accepted too (older test doubles).
    addresses = (Array.isArray(answers) ? answers : [answers]).map((a) => a.address);
  } catch (error) {
    const err = toError(error);
    if (isErrnoException(error) && error.code === 'ENOTFOUND') {
      logger.warn(`SECURITY: Domain ${hostname} could not be resolved`);
      throw new Error(`Domain ${hostname} could not be resolved`, { cause: error });
    }
    logger.warn(`SECURITY: DNS lookup failed for ${hostname}: ${err.message}`);
    throw new Error(`Failed to validate domain ${hostname}: ${err.message}`, { cause: error });
  }
  if (addresses.length === 0) {
    throw new Error(`Failed to validate domain ${hostname}: DNS returned no addresses`);
  }
  logger.debug(`DNS resolved ${hostname} → ${addresses.join(', ')}`);
  const blocked = addresses.find((address) => isBlockedIP(address));
  if (blocked !== undefined) {
    logger.warn(`SECURITY: DNS resolution of ${hostname} points to blocked IP: ${blocked}`);
    throw new Error(
      `Domain ${hostname} resolves to internal/private IP address (${blocked}). Use a URL whose host resolves only to public addresses.`
    );
  }
  logger.debug(`DNS validation passed for ${hostname}`);

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
    const code = isErrnoException(error) ? error.code : undefined;
    if (code === 'ENOENT') {
      throw new Error(`Image file not found: ${filepath}`, { cause: error });
    } else if (code === 'EACCES') {
      throw new Error(`Permission denied reading image file: ${filepath}`, { cause: error });
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
    dimensions = await getImageDimensions(imageSource);
  } catch (error) {
    // image-size reports a non-image as a buffer-bounds error; say what it is instead.
    // Any format image-size reads (BMP included) still passes, as before.
    if (typeof imageSource === 'string') await validateImagePath(imageSource);
    else if (Buffer.isBuffer(imageSource) && !detectImageType(imageSource)) {
      throw new Error('Buffer does not appear to be a valid image (PNG, JPEG, WebP, or GIF)', { cause: error });
    }
    throw error;
  }
  const { width, height } = dimensions;

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
export async function getImageDimensions(imageSource: string | Buffer): Promise<ImageDimensions> {
  try {
    if (Buffer.isBuffer(imageSource) || ArrayBuffer.isView(imageSource)) {
      // Accept Buffer/Uint8Array inputs: view the same bytes (no copy) as a plain Uint8Array
      const result = imageSize(
        new Uint8Array(imageSource.buffer, imageSource.byteOffset, imageSource.byteLength)
      );
      if (!result.width || !result.height) {
        throw new Error('Could not determine image dimensions (input: Buffer)');
      }
      return { width: result.width, height: result.height };
    } else if (typeof imageSource === 'string') {
      // Paths require async helper
      const result = await imageSizeFromFile(imageSource);
      if (!result.width || !result.height) {
        throw new Error(`Could not determine image dimensions (input: ${imageSource})`);
      }
      return { width: result.width, height: result.height };
    }
    throw new Error(`Unsupported image input (type: ${imageSource === null ? 'null' : typeof imageSource})`);
  } catch (error) {
    throw new Error(`Unable to read image dimensions: ${toError(error).message}`, { cause: error });
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
    throw new Error(
      `Image file size exceeds maximum of 50MB (${(buffer.length / 1024 / 1024).toFixed(1)}MB: ${imagePath}). Resize or compress the image.`
    );
  }

  return buffer;
}

/** A URL for a log line: origin and path only, so a signed query string never reaches a log. */
function describeUrlForLog(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return '(unparseable URL)';
  }
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
  logger.debug(`Downloading image from URL: ${describeUrlForLog(imageUrl)}`);

  // validateImageUrl runs on the URL and on every redirect target (up to 5).
  const response = await fetchFollowingRedirects(imageUrl, {
    validate: validateImageUrl,
    timeoutMs: 60000,
  });

  // Validate Content-Type header
  const allowedMimeTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
  const contentType = response.headers.get('content-type')?.split(';')[0].trim();

  if (!contentType || !allowedMimeTypes.includes(contentType)) {
    // AUDIT-OK(no_empty_catch): the Content-Type error is already decided; a failed cancel adds nothing
    await response.body?.cancel().catch(() => undefined);
    throw new Error(
      `Invalid Content-Type: ${contentType}. Expected image/* (png, jpeg, webp, gif)`
    );
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
 * @returns The response body
 * @throws Error if `maxBytes` is not an integer >= 1 or `timeoutMs` is not an integer from 1 to 2147483647
 *   (before any request is sent), if the URL fails validation, the download fails, or the body exceeds `maxBytes`
 *
 * @example
 * const bytes = await downloadBuffer('https://ideogram.ai/api/images/ephemeral/x.png', { timeoutMs: 30000 });
 */
export async function downloadBuffer(
  url: string,
  options: { maxBytes?: number; timeoutMs?: number } = {}
): Promise<Buffer> {
  const timeoutMs = options.timeoutMs ?? 60000;
  const maxBytes = options.maxBytes ?? 200 * 1024 * 1024;
  // Both are checked before any request is sent.
  assertTimerMs('timeoutMs', timeoutMs);
  assertMaxBytes('maxBytes', maxBytes);
  const response = await fetchFollowingRedirects(url, { validate: validateImageUrl, timeoutMs });
  return readBodyWithLimit(response, maxBytes);
}

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
export async function downloadToFile(
  url: string,
  outputPath: string,
  options: { maxBytes?: number; timeoutMs?: number } = {}
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 300000;
  const maxBytes = options.maxBytes ?? 2 * 1024 * 1024 * 1024;
  // Both are checked before any request is sent.
  assertTimerMs('timeoutMs', timeoutMs);
  assertMaxBytes('maxBytes', maxBytes);
  const response = await fetchFollowingRedirects(url, { validate: validateImageUrl, timeoutMs });
  await streamToFile(response, outputPath, maxBytes);
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
export function detectImageType(
  buffer: Buffer
): { extension: string; mimeType: string } | null {
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
export function detectAudioType(
  buffer: Buffer
): { extension: string; mimeType: string } | null {
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
export async function loadAudioAsBuffer(audioPath: string): Promise<Buffer> {
  let buffer: Buffer;
  try {
    buffer = await fs.readFile(audioPath);
  } catch (error) {
    const code = isErrnoException(error) ? error.code : undefined;
    if (code === 'ENOENT') throw new Error(`Audio file not found: ${audioPath}`, { cause: error });
    if (code === 'EACCES') throw new Error(`Permission denied reading audio file: ${audioPath}`, { cause: error });
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
function appendFile(formData: FormData, key: string, buffer: Buffer): void {
  const type = detectImageType(buffer) ?? detectAudioType(buffer);
  const prefix = type?.mimeType.startsWith('audio/') ? 'audio' : 'image';
  const blob = new Blob([new Uint8Array(buffer)], { type: type?.mimeType ?? 'image/jpeg' });
  formData.append(key, blob, `${prefix}.${type?.extension ?? 'jpg'}`);
}

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
export function buildFormData(params: FormDataParams): FormData {
  const formData = new FormData();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) {
      continue; // Skip undefined/null values
    }

    if (Buffer.isBuffer(value)) {
      // Buffer: Append as file, named and typed after its magic bytes
      appendFile(formData, key, value);
    } else if (typeof value === 'object' && !Array.isArray(value)) {
      // Object: Convert to JSON string
      formData.append(key, JSON.stringify(value));
    } else if (Array.isArray(value)) {
      // Array: Append each item separately (for multiple images or style_codes)
      value.forEach((item) => {
        if (Buffer.isBuffer(item)) {
          appendFile(formData, key, item);
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
 * Set the level of the module logger: file loading, DNS and download checks
 * and the CLI's own messages. Library default is 'warn'; logs go to stderr.
 * Also becomes the default level of `IdeogramAPI` instances created AFTER this
 * call; an existing instance keeps its own level (change it with
 * `IdeogramAPI#setLogLevel`).
 *
 * @param level - Log level (debug, info, warn, error)
 */
export function setLogLevel(level: string): void {
  logger.level = normalizeLogLevel(level);
}

