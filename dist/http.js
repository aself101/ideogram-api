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
import { mkdir, unlink } from 'fs/promises';
import { dirname } from 'path';
import { Readable, Transform } from 'stream';
import { pipeline } from 'stream/promises';
import { logger } from './logger.js';
const MB = 1024 * 1024;
/** Largest delay Node's timers accept (2^31 - 1 ms, about 24.8 days); longer ones fire at once. */
export const MAX_TIMER_MS = 2147483647;
/**
 * Require a timeout or interval to be a finite integer in 1..MAX_TIMER_MS.
 * NaN, Infinity, fractions, zero, negatives and anything over the timer limit
 * (which Node would silently turn into a 1 ms timer) throw before any work starts.
 */
export function assertTimerMs(name, value) {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > MAX_TIMER_MS) {
        throw new Error(`${name} must be an integer between 1 and ${MAX_TIMER_MS} ms (got ${String(value)})`);
    }
}
/**
 * Require a byte cap to be a finite integer of at least 1. NaN, Infinity,
 * zero, negatives and fractions throw: a NaN cap would compare false against
 * every size and never fire, so the "limit" would silently not exist.
 */
export function assertMaxBytes(name, value) {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
        throw new Error(`${name} must be a finite integer of at least 1 byte (got ${String(value)})`);
    }
}
/**
 * Describe a value for an error message without echoing it: its type, and for
 * numbers and booleans the value itself. Strings are reported by length only
 * (a string argument may hold a key or a private prompt).
 */
export function describeValue(value) {
    if (value === null)
        return 'null';
    if (Array.isArray(value))
        return `an array of ${value.length}`;
    if (typeof value === 'string')
        return value === '' ? 'an empty string' : `a string of ${value.length} characters`;
    if (typeof value === 'number' || typeof value === 'boolean')
        return `${typeof value} ${String(value)}`;
    return typeof value;
}
/** Approximate multipart overhead per part (boundary, headers, CRLFs). */
const PART_OVERHEAD_BYTES = 256;
/**
 * Size of a FormData body: every part's bytes plus a fixed per-part allowance
 * for the multipart framing. Close enough to compare with a ceiling that
 * already carries a 1MB margin.
 */
export function formDataSize(form) {
    let total = 0;
    for (const [, value] of form.entries()) {
        total += PART_OVERHEAD_BYTES;
        total += typeof value === 'string' ? Buffer.byteLength(value) : value.size;
    }
    return total;
}
/** Thrown when a response body exceeds its size cap. */
export class ResponseTooLargeError extends Error {
    constructor(maxBytes) {
        super(`Response exceeds the ${(maxBytes / MB).toFixed(0)}MB limit`);
        this.name = 'ResponseTooLargeError';
    }
}
/**
 * Reject early when the server declares a body larger than the cap. The body
 * is cancelled first so the connection is released, not left streaming.
 */
async function checkDeclaredLength(response, maxBytes) {
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) {
        // AUDIT-OK(no_empty_catch): the size error below is already decided; a failed cancel adds nothing
        await response.body?.cancel().catch(() => undefined);
        throw new ResponseTooLargeError(maxBytes);
    }
}
/**
 * Remove a file that a failed write left behind. A file that is already gone
 * (ENOENT, or ENOTDIR when a parent of the path is a file) is fine. Any other failure leaves the file on disk: it is logged
 * with the path and `false` is returned, never swallowed. Returns true when the
 * file is gone afterwards.
 *
 * @param what - Noun phrase for the warning, e.g. "the partial download"
 */
export async function discardFile(filePath, what) {
    try {
        await unlink(filePath);
        return true;
    }
    catch (unlinkError) {
        // ENOENT: already gone. ENOTDIR: a parent of the path is a file, so the path cannot exist.
        const code = unlinkError?.code;
        if (code === 'ENOENT' || code === 'ENOTDIR')
            return true;
        const reason = unlinkError instanceof Error ? unlinkError.message : String(unlinkError);
        logger.warn(`Could not remove ${what} ${filePath}: ${reason}. Delete it manually.`);
        return false;
    }
}
/** Count bytes through a stream and fail once they pass the cap. */
function byteLimit(maxBytes) {
    let seen = 0;
    return new Transform({
        transform(chunk, _enc, done) {
            seen += chunk.length;
            if (seen > maxBytes)
                done(new ResponseTooLargeError(maxBytes));
            else
                done(null, chunk);
        },
    });
}
/**
 * Read a response body into a Buffer, stopping as soon as it passes `maxBytes`
 * (a declared Content-Length is checked first; a body without one is counted
 * as it streams).
 */
export async function readBodyWithLimit(response, maxBytes) {
    assertMaxBytes('maxBytes', maxBytes);
    await checkDeclaredLength(response, maxBytes);
    if (!response.body)
        return Buffer.alloc(0);
    const chunks = [];
    let seen = 0;
    const reader = response.body.getReader();
    for (;;) {
        const { done, value } = await reader.read();
        if (done)
            break;
        seen += value.byteLength;
        if (seen > maxBytes) {
            // AUDIT-OK(no_empty_catch): the size error is already decided; a failed cancel adds nothing
            await reader.cancel().catch(() => undefined);
            throw new ResponseTooLargeError(maxBytes);
        }
        chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks);
}
/**
 * Stream a response body to a file, failing past `maxBytes`. On any failure
 * (size cap exceeded, stream error, write error) the partial file is removed
 * and the original error is rethrown. If the removal itself fails (anything but
 * ENOENT), a warning names the leftover file and the rethrown error carries its
 * path as `partialFile`. A declared Content-Length
 * over the cap fails before the file is created.
 */
export async function streamToFile(response, outputPath, maxBytes) {
    assertMaxBytes('maxBytes', maxBytes);
    await checkDeclaredLength(response, maxBytes);
    if (!response.body) {
        throw new Error(`Response has no body (HTTP ${response.status}) to write to ${outputPath}`);
    }
    try {
        await mkdir(dirname(outputPath), { recursive: true });
        await pipeline(Readable.fromWeb(response.body), byteLimit(maxBytes), createWriteStream(outputPath));
    }
    catch (error) {
        // Nothing to clean up when the file was never created (ENOENT). Any other
        // failure leaves a partial file behind: discardFile warns, and the original
        // error is still the one thrown.
        if (!(await discardFile(outputPath, 'the partial download')) && error !== null && typeof error === 'object') {
            // Reflect.set returns false (never throws) on a frozen error; the warning already names the file.
            Reflect.set(error, 'partialFile', outputPath);
        }
        throw error;
    }
}
/**
 * GET a URL, following redirects by hand so `validate` (the SSRF check) runs
 * on every hop, up to `maxRedirects` (default 5). The timeout covers the whole
 * chain. Throws on a non-2xx final response.
 */
export async function fetchFollowingRedirects(url, options) {
    assertTimerMs('timeoutMs', options.timeoutMs);
    const maxRedirects = options.maxRedirects ?? 5;
    const signal = AbortSignal.timeout(options.timeoutMs);
    let current = url;
    for (let hop = 0;; hop++) {
        const target = await options.validate(current);
        const response = await fetch(target, { redirect: 'manual', signal });
        if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
            // AUDIT-OK(no_empty_catch): the redirect is followed or refused regardless; a failed cancel changes nothing
            await response.body?.cancel().catch(() => undefined);
            if (hop >= maxRedirects) {
                throw new Error(`Too many redirects (more than ${maxRedirects})`);
            }
            current = new URL(response.headers.get('location'), target).href;
            continue;
        }
        if (!response.ok) {
            // AUDIT-OK(no_empty_catch): the status error is already decided; a failed cancel adds nothing
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
export function describeNetworkError(error, timeoutMs) {
    const err = error;
    if (err?.name === 'TimeoutError') {
        return { message: `Request timed out${timeoutMs ? ` after ${timeoutMs}ms` : ''}`, code: 'ETIMEDOUT' };
    }
    const code = err?.cause?.code;
    const reason = err?.cause?.message || err?.message || 'no response';
    return { message: reason, code };
}
//# sourceMappingURL=http.js.map