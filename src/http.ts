/**
 * HTTP primitives on native fetch (Node >= 22, the package minimum since 2.0).
 *
 * Replaces axios + form-data (removed 2026-11-22). axios enforced three limits
 * that fetch does not, so they are rebuilt here, each where the old option was:
 *
 * - request timeout   (axios `timeout`)           -> AbortSignal.timeout
 * - response size cap (axios `maxContentLength`)  -> readBodyWithLimit / streamToFile
 * - redirect limit    (axios `maxRedirects`)      -> fetchFollowingRedirects
 *
 * The request-body cap (axios `maxBodyLength`) became a size check before
 * sending: formDataSize totals the parts, and the caller compares it with the
 * endpoint's ceiling.
 *
 * Redirects behave differently from 1.x, deliberately. API calls refuse them
 * (`redirect: 'error'`), so the Api-Key header is never sent to another host;
 * follow-redirects (under axios) kept custom headers on a cross-host hop.
 * Downloads follow up to 5 redirects by hand and re-run the SSRF check on every
 * hop; 1.x checked only the first URL.
 */

import { createWriteStream } from 'fs';
import { mkdir } from 'fs/promises';
import { dirname } from 'path';
import { Readable, Transform } from 'stream';
import { pipeline } from 'stream/promises';
import type { ReadableStream as WebReadableStream } from 'stream/web';

const MB = 1024 * 1024;

/** Approximate multipart overhead per part (boundary, headers, CRLFs). */
const PART_OVERHEAD_BYTES = 256;

/**
 * Size of a FormData body: every part's bytes plus a fixed per-part allowance
 * for the multipart framing. Close enough to compare with a ceiling that
 * already carries a 1MB margin.
 */
export function formDataSize(form: FormData): number {
  let total = 0;
  for (const [, value] of form.entries()) {
    total += PART_OVERHEAD_BYTES;
    total += typeof value === 'string' ? Buffer.byteLength(value) : (value as Blob).size;
  }
  return total;
}

/** Thrown when a response body exceeds its size cap. */
export class ResponseTooLargeError extends Error {
  constructor(maxBytes: number) {
    super(`Response exceeds the ${(maxBytes / MB).toFixed(0)}MB limit`);
    this.name = 'ResponseTooLargeError';
  }
}

/** Reject early when the server declares a body larger than the cap. */
function checkDeclaredLength(response: Response, maxBytes: number): void {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new ResponseTooLargeError(maxBytes);
  }
}

/** Count bytes through a stream and fail once they pass the cap. */
function byteLimit(maxBytes: number): Transform {
  let seen = 0;
  return new Transform({
    transform(chunk: Buffer, _enc, done) {
      seen += chunk.length;
      if (seen > maxBytes) done(new ResponseTooLargeError(maxBytes));
      else done(null, chunk);
    },
  });
}

/**
 * Read a response body into a Buffer, stopping as soon as it passes `maxBytes`
 * (a declared Content-Length is checked first; a body without one is counted
 * as it streams).
 */
export async function readBodyWithLimit(response: Response, maxBytes: number): Promise<Buffer> {
  checkDeclaredLength(response, maxBytes);
  if (!response.body) return Buffer.alloc(0);
  const chunks: Buffer[] = [];
  let seen = 0;
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    seen += value.byteLength;
    if (seen > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new ResponseTooLargeError(maxBytes);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

/** Stream a response body to a file, failing (and leaving a partial file) past `maxBytes`. */
export async function streamToFile(response: Response, outputPath: string, maxBytes: number): Promise<void> {
  checkDeclaredLength(response, maxBytes);
  if (!response.body) throw new Error('Response has no body');
  await mkdir(dirname(outputPath), { recursive: true });
  await pipeline(
    Readable.fromWeb(response.body as unknown as WebReadableStream<Uint8Array>),
    byteLimit(maxBytes),
    createWriteStream(outputPath)
  );
}

/** Options for fetchFollowingRedirects. */
export interface SafeFetchOptions {
  /** Checks a URL before it is fetched (and each redirect target); returns the URL to use. */
  validate: (url: string) => Promise<string>;
  timeoutMs: number;
  maxRedirects?: number;
}

/**
 * GET a URL, following redirects by hand so `validate` (the SSRF check) runs
 * on every hop, up to `maxRedirects` (default 5). The timeout covers the whole
 * chain. Throws on a non-2xx final response.
 */
export async function fetchFollowingRedirects(url: string, options: SafeFetchOptions): Promise<Response> {
  const maxRedirects = options.maxRedirects ?? 5;
  const signal = AbortSignal.timeout(options.timeoutMs);
  let current = url;
  for (let hop = 0; ; hop++) {
    const target = await options.validate(current);
    const response = await fetch(target, { redirect: 'manual', signal });
    if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
      if (hop >= maxRedirects) {
        throw new Error(`Too many redirects (more than ${maxRedirects})`);
      }
      await response.body?.cancel().catch(() => undefined);
      current = new URL(response.headers.get('location') as string, target).href;
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(`Download failed with status code ${response.status}`);
    }
    return response;
  }
}

/**
 * Describe a fetch failure that produced no HTTP response. Node reports most
 * of these as `TypeError: fetch failed` with the real reason on `cause`.
 */
export function describeNetworkError(error: unknown, timeoutMs?: number): { message: string; code?: string } {
  const err = error as { name?: string; message?: string; cause?: { code?: string; message?: string } };
  if (err?.name === 'TimeoutError') {
    return { message: `Request timed out${timeoutMs ? ` after ${timeoutMs}ms` : ''}`, code: 'ETIMEDOUT' };
  }
  const code = err?.cause?.code;
  const reason = err?.cause?.message || err?.message || 'no response';
  return { message: reason, code };
}
