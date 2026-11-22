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
/** Largest delay Node's timers accept (2^31 - 1 ms, about 24.8 days); longer ones fire at once. */
export declare const MAX_TIMER_MS = 2147483647;
/**
 * Require a timeout or interval to be a finite integer in 1..MAX_TIMER_MS.
 * NaN, Infinity, fractions, zero, negatives and anything over the timer limit
 * (which Node would silently turn into a 1 ms timer) throw before any work starts.
 */
export declare function assertTimerMs(name: string, value: unknown): asserts value is number;
/**
 * Size of a FormData body: every part's bytes plus a fixed per-part allowance
 * for the multipart framing. Close enough to compare with a ceiling that
 * already carries a 1MB margin.
 */
export declare function formDataSize(form: FormData): number;
/** Thrown when a response body exceeds its size cap. */
export declare class ResponseTooLargeError extends Error {
    constructor(maxBytes: number);
}
/**
 * Remove a file that a failed write left behind. A file that is already gone
 * (ENOENT) is fine. Any other failure leaves the file on disk: it is logged
 * with the path and `false` is returned, never swallowed. Returns true when the
 * file is gone afterwards.
 *
 * @param what - Noun phrase for the warning, e.g. "the partial download"
 */
export declare function discardFile(filePath: string, what: string): Promise<boolean>;
/**
 * Read a response body into a Buffer, stopping as soon as it passes `maxBytes`
 * (a declared Content-Length is checked first; a body without one is counted
 * as it streams).
 */
export declare function readBodyWithLimit(response: Response, maxBytes: number): Promise<Buffer>;
/**
 * Stream a response body to a file, failing past `maxBytes`. On any failure
 * (size cap exceeded, stream error, write error) the partial file is removed
 * and the original error is rethrown. If the removal itself fails (anything but
 * ENOENT), a warning names the leftover file and the rethrown error carries its
 * path as `partialFile`. A declared Content-Length
 * over the cap fails before the file is created.
 */
export declare function streamToFile(response: Response, outputPath: string, maxBytes: number): Promise<void>;
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
export declare function fetchFollowingRedirects(url: string, options: SafeFetchOptions): Promise<Response>;
/**
 * Describe a fetch failure that produced no HTTP response. Node reports most
 * of these as `TypeError: fetch failed` with the real reason on `cause`.
 */
export declare function describeNetworkError(error: unknown, timeoutMs?: number): {
    message: string;
    code?: string;
};
//# sourceMappingURL=http.d.ts.map