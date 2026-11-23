/**
 * Ideogram API Wrapper
 *
 * Provides a unified interface for Ideogram image generation API:
 * - Generate (v3): Text-to-image generation
 * - Edit (v3): Image editing with masks
 * - Remix (v3): Image remixing with prompts
 * - Reframe (v3): Reframe square images to different resolutions
 * - Replace Background (v3): Replace image backgrounds
 * - Upscale: 2x / 4x / 8x (v2 upscaler since 2.0; the v1 endpoint was retired)
 * - Describe: Get descriptions of images
 *
 * v2 image endpoints (Ideogram 4.0 / 4.5 / 4.6 / automatic model selection):
 * - generateV4, generateV4Transparent, generateV4Custom (JSON bodies)
 * - generateV45, generateV46, generateAuto, preciseEditV45, preciseEditV46 (multipart)
 * v2 always-asynchronous endpoints (respond with a generation_id to poll):
 * - generateSvg (Ideogram Vector 1)
 * - minimaxH3TextToVideo / ImageToVideo / ReferenceToVideo
 * - seedance25TextToVideo / ImageToVideo / ReferenceToVideo
 * - getGeneration / waitForGeneration retrieve every async result
 * Every v2 method accepts `dryRun: true`, which asks Ideogram to price the
 * request instead of running it and resolves to a PriceQuote. The library checks
 * that a price quote came back; if the API ran the request instead, it throws
 * EDRYRUNIGNORED (possiblyBilled true) with the result on `error.result`.
 *
 * The v3 operations and the v2 image default (`async` unset) are synchronous.
 */

import winston from 'winston';
import {
  formDataSize,
  readBodyWithLimit,
  describeNetworkError,
  describeValue,
  assertTimerMs,
  sanitizeServerText,
  ResponseTooLargeError,
} from './http.js';
import { BASE_URL, ENDPOINTS, redactApiKey } from './config.js';
import { logger as moduleLogger, ALL_LOG_LEVELS, normalizeLogLevel } from './logger.js';
import { buildFormData, loadImageAsBuffer, loadAudioAsBuffer, assertSquareImage, toError } from './utils.js';
import type {
  GenerateV4Params,
  GenerateV4TransparentParams,
  GenerateV4CustomParams,
  GenerateV45Params,
  GenerateV46Params,
  GenerateAutoParams,
  PreciseEditV45Params,
  PreciseEditV46Params,
  GenerateSvgParams,
  MinimaxH3TextToVideoParams,
  MinimaxH3ImageToVideoParams,
  MinimaxH3ReferenceToVideoParams,
  Seedance25TextToVideoParams,
  Seedance25ImageToVideoParams,
  Seedance25ReferenceToVideoParams,
  V2Acknowledgement,
  V2ColorPalette,
  UpscaledImage,
  AudioInput,
  V2GenerationResponse,
  PriceQuote,
  GenerationStatus,
  GenerationDataItem,
  WaitForGenerationOptions,
  ImageInput,
  GeneratedImage,
  GenerateParams,
  EditParams,
  RemixParams,
  ReframeParams,
  ReplaceBackgroundParams,
  UpscaleParams,
  UpscaleResponse,
  DescribeParams,
  GenerationResponse,
  DescribeResponse,
  ImageData,
  Description,
  ApiErrorResponse,
} from './types/index.js';

/** Default request timeout for v1 (Ideogram 3.0) endpoints, unchanged since 1.0. */
const V1_TIMEOUT_MS = 120000;

/**
 * Default request timeout for v2 endpoints. Synchronous 4.5 / 8k / copyright-
 * detected requests can outlast two minutes, and a client-side timeout does not
 * cancel a billed generation. For long jobs prefer `async: true` + waitForGeneration.
 */
const V2_TIMEOUT_MS = 300000;

/** Request-body ceilings: the documented per-file maxima times the file count, plus 1MB for fields. */
const MB = 1024 * 1024;
const BODY_LIMITS = {
  v1: 50 * MB,
  json: 1 * MB,
  v4x: 6 * 25 * MB + MB, // 4.5 / 4.6: 5 images + mask
  auto: 10 * 25 * MB + MB,
  preciseEdit: 5 * 50 * MB + MB, // image + 4 references, or image + mask + 3
  upscale: 50 * MB + MB,
  // SVG documents no file count or size; this mirrors auto's ten sources at
  // the client's own 50MB-per-file loader cap. An assumption, not a spec value.
  svg: 10 * 50 * MB + MB,
  videoFrames: 2 * 50 * MB + MB, // first frame + end frame
  // MiniMax H3 allows 12 references across images and audio. Seedance 2.5
  // documents no count; the same ceiling is assumed.
  videoReferences: 12 * 50 * MB + MB,
} as const;

/**
 * Said once for a failed request that may have run and been charged. Messages
 * that carry it end with it exactly, so the CLI can tell it was already said.
 *
 * A stable exported constant: the exact trailing sentence of every
 * possibly-billed message, so a caller can test `error.message.endsWith(BILLING_NOTE)`.
 * Changing the wording is a breaking change.
 */
export const BILLING_NOTE = 'The request may have run and been billed. Check your usage before retrying.';

/** HTTP statuses a poll will keep getting: the id or request is wrong, or the key was rejected. */
const PERMANENT_POLL_STATUSES: readonly number[] = [400, 401, 403, 404, 410, 422];

/**
 * Whether polling the same generation again can still succeed after a failure.
 * An allowlist of permanent failures: HTTP 400, 404, 410, 422; 401 and 403 (the
 * same client cannot recover with a rejected key; fix the key and start a new
 * call); a response too large (code ERESPONSETOOLARGE); a generation that
 * finished as failed. Everything else is resumable: no response, timeout, 5xx,
 * 408, 425, 429, 402, any other 4xx, the wait deadline, an onPoll throw.
 */
export function classifyPollFailure(failure: {
  status?: number;
  code?: string;
  generationStatus?: string;
}): { resumable: boolean } {
  if (failure.generationStatus === 'failed') return { resumable: false };
  if (failure.code === 'ERESPONSETOOLARGE') return { resumable: false };
  if (failure.status !== undefined && PERMANENT_POLL_STATUSES.includes(failure.status)) {
    return { resumable: false };
  }
  return { resumable: true };
}

/** Bytes of an unparseable response body kept on the error. */
const BODY_EXCERPT_BYTES = 500;

/** Normalize a v2 color palette: a bare preset name becomes `{ name }`. */
function toPaletteObject(palette: V2ColorPalette | undefined): object | undefined {
  if (palette === undefined) return undefined;
  return typeof palette === 'string' ? { name: palette } : palette;
}

/**
 * Error thrown for a failed Ideogram API request.
 * Extends Error, so existing `catch (e) { e.message }` code keeps working.
 */
export class IdeogramAPIError extends Error {
  /** HTTP status, when the API answered. */
  readonly status?: number;
  /** v2 402/429: the account or usage limit that rejected the request. */
  readonly rejectReason?: string;
  /** v2 402/429 with reject_reason 'inflight_limit'. */
  readonly maxInflightRequests?: number;
  /** Polling: why an async generation failed (e.g. 'content_policy_violation'). */
  readonly failureReason?: string;
  /** Parsed response body, when there was one. */
  readonly body?: unknown;
  /**
   * A client-side classification of the failure: a network error code when no
   * response arrived ('ECONNRESET', 'ETIMEDOUT', ...), or 'ERESPONSETOOLARGE' /
   * 'EDRYRUNIGNORED' / 'EINVALIDARGUMENT' (waitForGeneration argument checks; and a network code from a failed body read) when a
   * response did arrive. Not an HTTP status; see `status` for that.
   */
  readonly code?: string;
  /**
   * True when the request, or the generation this error concerns, may have been
   * charged: the request was sent and its outcome is unknown (no response, an
   * unreadable or over-size body, a 5xx), or the error comes from
   * waitForGeneration (the generation was already submitted). False for 4xx
   * validation, auth and rate-limit answers, for anything thrown before the
   * request was sent, and for a failed status poll outside waitForGeneration
   * (a GET is never billed). Check usage before submitting again; never resubmit
   * to recover a generation.
   */
  readonly possiblyBilled: boolean;
  /**
   * True when calling getGeneration or waitForGeneration again with
   * `generationId` can still succeed. Everything that fails while polling is
   * resumable (no response or timeout, 5xx, 408, 425, 429, 402, any other 4xx,
   * the wait deadline, an onPoll callback that threw) except a permanent
   * failure: HTTP 400, 404, 410, 422, a response too large (code
   * ERESPONSETOOLARGE), a generation that finished as failed, and 401/403 (the
   * same client cannot recover with a rejected key: fix the key and start a
   * new call; the CLI prints that hint from the status). False (the default)
   * outside polling. See `classifyPollFailure`.
   */
  readonly resumable: boolean;
  /** The generation this error concerns (polling, or a dry run that was really run). */
  readonly generationId?: string;
  /**
   * Polling: the status string of a generation that finished unsuccessfully
   * ('failed'). Set only when the API reported it, so a failed generation is
   * told apart from a poll that failed (which can be resumed) even when the
   * API sent no failure_reason.
   */
  readonly generationStatus?: string;
  /**
   * Code 'EDRYRUNIGNORED': the parsed response the API returned instead of a
   * price quote, so a caller can still save or list what was billed.
   */
  readonly result?: unknown;

  constructor(
    message: string,
    details: {
      status?: number;
      rejectReason?: string;
      maxInflightRequests?: number;
      failureReason?: string;
      body?: unknown;
      code?: string;
      possiblyBilled?: boolean;
      resumable?: boolean;
      generationId?: string;
      generationStatus?: string;
      result?: unknown;
      cause?: unknown;
    } = {}
  ) {
    super(message, details.cause !== undefined ? { cause: details.cause } : undefined);
    this.code = details.code;
    this.possiblyBilled = details.possiblyBilled ?? false;
    this.resumable = details.resumable ?? false;
    this.generationId = details.generationId;
    this.generationStatus = details.generationStatus;
    this.result = details.result;
    this.name = 'IdeogramAPIError';
    this.status = details.status;
    this.rejectReason = details.rejectReason;
    this.maxInflightRequests = details.maxInflightRequests;
    this.failureReason = details.failureReason;
    this.body = details.body;
  }
}

/**
 * Pull a human-readable message out of an error body.
 * Ideogram answers in three shapes: `{error}` (v2 rule violations, 402/429, 404),
 * RFC 7807 `{title, detail, status}` (v2 schema validation), and `{message}`
 * (401, and v1). 1.x read only `message`, so v2 400s lost their reason.
 */
function errorMessageFrom(data: ApiErrorResponse | undefined, fallback: string): string {
  return sanitizeServerText(rawErrorMessageFrom(data, fallback));
}

function rawErrorMessageFrom(data: ApiErrorResponse | undefined, fallback: string): string {
  if (!data || typeof data !== 'object') return fallback;
  if (typeof data.error === 'string' && data.error) return data.error;
  if (data.detail !== undefined && data.detail !== null) {
    return typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail);
  }
  if (typeof data.message === 'string' && data.message) return data.message;
  if (typeof data.title === 'string' && data.title) return data.title;
  return fallback;
}

/** Copy only the defined entries of an object (v2 bodies omit unset fields so API defaults apply). */
function definedOnly(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== null));
}

/** Request options for the shared request path. */
interface RequestOptions {
  method: 'GET' | 'POST';
  endpoint: string;
  form?: FormData;
  json?: Record<string, unknown>;
  query?: Record<string, string>;
  timeoutMs: number;
  maxBodyBytes: number;
}

/**
 * Ideogram API wrapper class.
 * Supports all Ideogram generation and manipulation operations.
 */
export class IdeogramAPI {
  private apiKey: string;
  private baseUrl: string;
  private logger: winston.Logger;

  /**
   * Create a new Ideogram API client.
   *
   * @param apiKey - Ideogram API key
   * @param baseUrl - Base API URL (default: https://api.ideogram.ai)
   * @param logLevel - Logging level (debug, info, warn, error; case-insensitive,
   *   anything else throws). Defaults to the
   *   module logger's level: 'warn', or whatever `setLogLevel` from
   *   `ideogram-api/utils` last set. Logs go to stderr.
   * @throws Error if API key is not provided, base URL is not HTTPS or the log level is unknown
   *
   * @example
   * const api = new IdeogramAPI('your_api_key');
   * const api = new IdeogramAPI('your_api_key', 'https://api.ideogram.ai', 'debug');
   */
  constructor(apiKey: string, baseUrl: string = BASE_URL, logLevel: string = moduleLogger.level) {
    if (!apiKey) {
      throw new Error(
        'API key is required: pass it as the first argument, new IdeogramAPI(apiKey), e.g. new IdeogramAPI(process.env.IDEOGRAM_API_KEY)'
      );
    }

    // HTTPS enforcement for security
    if (!baseUrl.startsWith('https://')) {
      throw new Error('Base URL must use HTTPS protocol for security');
    }

    logLevel = normalizeLogLevel(logLevel);
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;

    // Configure logger
    this.logger = winston.createLogger({
      level: logLevel,
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, level, message }) => {
          return `${timestamp} - ${level.toUpperCase()} - ${message}`;
        })
      ),
      transports: [new winston.transports.Console({ stderrLevels: ALL_LOG_LEVELS })],
    });

    // Only log API key in debug mode to minimize exposure
    if (logLevel === 'debug') {
      this.logger.debug(`Ideogram API initialized (API key: ${redactApiKey(apiKey)})`);
    } else {
      this.logger.info('Ideogram API initialized');
    }
  }

  /**
   * Verify API key is set.
   * @throws Error if API key is missing
   */
  private _verifyApiKey(): void {
    if (!this.apiKey) {
      throw new Error(
        'API key not set. Initialize IdeogramAPI with your API key: new IdeogramAPI(process.env.IDEOGRAM_API_KEY).'
      );
    }
  }

  /**
   * Make a multipart POST to a v1 endpoint. Kept for the v3 methods.
   *
   * @param endpoint - API endpoint path
   * @param formData - FormData object with request parameters
   * @returns API response
   * @throws IdeogramAPIError if request fails
   */
  private async _makeRequest<T>(endpoint: string, formData: FormData): Promise<T> {
    return this._request<T>({
      method: 'POST',
      endpoint,
      form: formData,
      timeoutMs: V1_TIMEOUT_MS,
      maxBodyBytes: BODY_LIMITS.v1,
    });
  }

  /**
   * Make an HTTP request to the Ideogram API (JSON, multipart, or GET).
   * Handles size limits, response Content-Type validation and error mapping.
   */
  private async _request<T>(opts: RequestOptions): Promise<T> {
    this._verifyApiKey();
    // Before anything is sent: a bad timeout must not look like a request that may have been billed.
    assertTimerMs('timeoutMs', opts.timeoutMs);

    let url = `${this.baseUrl}${opts.endpoint}`;
    if (opts.query && Object.keys(opts.query).length > 0) {
      url += `?${new URLSearchParams(opts.query).toString()}`;
    }

    this.logger.debug(`Making ${opts.method} request to: ${url}`);

    // The body size is known before sending (Buffers have lengths), so the
    // ceiling is checked here, before anything is sent.
    const headers: Record<string, string> = { 'Api-Key': this.apiKey };
    let body: FormData | string | undefined;
    let bodyBytes = 0;
    if (opts.form) {
      body = opts.form; // fetch sets the multipart Content-Type and boundary
      bodyBytes = formDataSize(opts.form);
    } else if (opts.json) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(opts.json);
      bodyBytes = Buffer.byteLength(body);
    }
    if (bodyBytes > opts.maxBodyBytes) {
      throw new Error(
        `Request payload too large: ${(bodyBytes / MB).toFixed(2)}MB exceeds maximum of ${(opts.maxBodyBytes / MB).toFixed(0)}MB`
      );
    }

    // A failed status poll (GET) costs nothing; anything else that was sent may have been billed.
    const billable = opts.method !== 'GET';
    const billedNote = billable ? ' A generation may still have run and been billed. Check before retrying.' : '';
    let response: Response;
    try {
      response = await fetch(url, {
        method: opts.method,
        headers,
        body,
        signal: AbortSignal.timeout(opts.timeoutMs),
        // The API does not redirect; refusing keeps the Api-Key header from
        // following a redirect to another host.
        redirect: 'error',
      });
    } catch (error) {
      // No HTTP response. Node reports most of these as "fetch failed" with
      // the reason on `cause` (two live runs on 2026-11-22 surfaced only a bare
      // "Error"), so name the code and the billing uncertainty.
      const { message, code } = describeNetworkError(error, opts.timeoutMs);
      this.logger.error(
        `Request failed${code ? ` (${code})` : ''}: ${message}. No HTTP response was received.${billedNote}`
      );
      if (process.env.NODE_ENV === 'production') {
        throw new IdeogramAPIError(
          billable
            ? `Request failed. ${BILLING_NOTE}`
            : 'Request failed. Please check your connection and try again.',
          { code, possiblyBilled: billable, cause: error }
        );
      }
      throw new IdeogramAPIError(`Request failed${code ? ` (${code})` : ''}: ${message}`, {
        code,
        possiblyBilled: billable,
        cause: error,
      });
    }

    let raw: Buffer;
    try {
      raw = await readBodyWithLimit(response, 100 * MB);
    } catch (error) {
      if (error instanceof ResponseTooLargeError) {
        // The size cap fired after the response headers arrived: keep the HTTP
        // status, and say the request may have been billed like the other post-send paths.
        this.logger.error(
          `${error.message} (HTTP ${response.status}).${billedNote}`
        );
        throw new IdeogramAPIError(`${error.message} (HTTP ${response.status})`, {
          status: response.status,
          code: 'ERESPONSETOOLARGE',
          possiblyBilled: billable,
          cause: error,
        });
      }
      // Headers arrived but the body did not (timeout or reset mid-read). The
      // HTTP status is known, so keep it on the error.
      const { message, code } = describeNetworkError(error, opts.timeoutMs);
      this.logger.error(
        `Reading the response body failed (HTTP ${response.status})${code ? ` (${code})` : ''}: ${message}.${billedNote}`
      );
      throw new IdeogramAPIError(
        `Request failed while reading the response (HTTP ${response.status})${code ? ` (${code})` : ''}: ${message}`,
        { status: response.status, code, possiblyBilled: billable, cause: error }
      );
    }
    const contentType = response.headers.get('content-type') ?? '';

    if (!response.ok) {
      const status = response.status;
      let data: ApiErrorResponse | undefined;
      try {
        data = JSON.parse(raw.toString('utf8')) as ApiErrorResponse;
      } catch {
        // best effort: an error body that is not JSON; `raw` is kept as the body below
        data = undefined;
      }
      // Fallback text is "HTTP <status>". 1.x printed axios's "Request failed with status code <status>" here.
      const message = errorMessageFrom(data, `HTTP ${status}`);
      const rejectReason = typeof data?.reject_reason === 'string' ? data.reject_reason : undefined;
      // error.rejectReason and error.body stay raw; messages and log lines use the safe text.
      const shownReason = rejectReason === undefined ? undefined : sanitizeServerText(rejectReason);
      const details = {
        status,
        rejectReason,
        maxInflightRequests: data?.max_inflight_requests,
        body: data ?? raw.toString('utf8'),
        // A 5xx may be a failure after the work started; a 4xx answer was decided before any work.
        possiblyBilled: billable && status >= 500,
      };

      const serverBilledNote = details.possiblyBilled ? ` ${BILLING_NOTE}` : '';
      this.logger.error(`API request failed (${status}): ${message}${serverBilledNote}`);

      // Map HTTP status codes to user-friendly errors
      if (status === 400) {
        throw new IdeogramAPIError(`Invalid input: ${message}`, details);
      } else if (status === 401) {
        throw new IdeogramAPIError('Authentication failed. Check API key.', details);
      } else if (status === 402) {
        throw new IdeogramAPIError(
          `Payment required${shownReason ? ` (${shownReason})` : ''}: ${message}`,
          details
        );
      } else if (status === 403) {
        // Append the API's reason only when the body gave one (as 1.x did).
        const reason = errorMessageFrom(data, '');
        const suffix = reason ? ` ${reason}` : '';
        throw new IdeogramAPIError(`Not authorized to perform this operation.${suffix}`, details);
      } else if (status === 404) {
        throw new IdeogramAPIError(`Not found: ${message}`, details);
      } else if (status === 422) {
        throw new IdeogramAPIError(`Validation failed: ${message}`, details);
      } else if (status === 429) {
        const reason = shownReason ? ` (${shownReason})` : '';
        throw new IdeogramAPIError(`Rate limit exceeded. Too many requests.${reason}`, details);
      }

      // Sanitize error in production
      if (process.env.NODE_ENV === 'production') {
        throw new IdeogramAPIError(
          details.possiblyBilled
            ? `Operation failed (HTTP ${status}). ${BILLING_NOTE}`
            : `Operation failed (HTTP ${status}). Please try again.`,
          details
        );
      }

      // No body message: `message` is the bare "HTTP <status>", so do not say the status twice.
      const text =
        message !== `HTTP ${status}`
          ? `API error (${status}): ${message}${serverBilledNote}`
          : `API error (HTTP ${status})${serverBilledNote ? `.${serverBilledNote}` : ''}`;
      throw new IdeogramAPIError(text, details);
    }

    // Validate Content-Type of response
    if (!contentType.includes('application/json')) {
      this.logger.warn(`Unexpected Content-Type in response: ${contentType || '(none)'}`);
      this.logger.error(
        `Invalid response format (HTTP ${response.status}).${billedNote}`
      );
      throw new IdeogramAPIError(
        `Invalid response format from API (HTTP ${response.status}, Content-Type: ${contentType || '(none)'})`,
        { status: response.status, body: raw.toString('utf8', 0, BODY_EXCERPT_BYTES), possiblyBilled: billable }
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString('utf8'));
    } catch (error) {
      this.logger.error(
        `Invalid response format (HTTP ${response.status}): body is not valid JSON.${billedNote}`
      );
      throw new IdeogramAPIError(`Invalid response format from API: body is not valid JSON (HTTP ${response.status})`, {
        status: response.status,
        body: raw.toString('utf8', 0, BODY_EXCERPT_BYTES),
        possiblyBilled: billable,
        cause: error,
      });
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      const got = parsed === null ? 'null' : Array.isArray(parsed) ? 'array' : typeof parsed;
      this.logger.error(
        `Invalid response format (HTTP ${response.status}): expected a JSON object, got ${got}.${billedNote}`
      );
      throw new IdeogramAPIError(
        `Invalid response format from API: expected a JSON object, got ${got} (HTTP ${response.status})`,
        { status: response.status, body: parsed, possiblyBilled: billable }
      );
    }
    // A dry run must answer with a price quote. If the API ran the request for
    // real, it was (probably) billed: fail loudly, keep the result on the error.
    if (opts.query?.dry_run === 'true' && !isPriceQuote(parsed)) {
      const generationId = (parsed as { generation_id?: unknown }).generation_id;
      this.logger.error(
        `dry_run was requested but the API returned a real result (HTTP ${response.status}); it may have been billed.`
      );
      throw new IdeogramAPIError(
        'dry_run was requested but the API returned a real result; it may have been billed. The result is attached as error.result.',
        {
          status: response.status,
          code: 'EDRYRUNIGNORED',
          possiblyBilled: true,
          generationId: typeof generationId === 'string' ? generationId : undefined,
          result: parsed,
        }
      );
    }
    // Field-level shapes are trusted, not validated: the API's documented
    // response types are assumed, and only the top-level object check is made.
    return parsed as T;
  }

  /** Load a path-or-Buffer image input. */
  private async _loadImage(input: ImageInput): Promise<Buffer> {
    return Buffer.isBuffer(input) ? input : loadImageAsBuffer(input);
  }

  /** Load a list of path-or-Buffer image inputs; an empty list loads as undefined. */
  private async _loadImages(inputs: ImageInput[] | undefined): Promise<Buffer[] | undefined> {
    if (!inputs || inputs.length === 0) return undefined;
    return Promise.all(inputs.map((img) => this._loadImage(img)));
  }

  /** Load a list of path-or-Buffer MP3/WAV inputs; an empty list loads as undefined. */
  private async _loadAudios(inputs: AudioInput[] | undefined): Promise<Buffer[] | undefined> {
    if (!inputs || inputs.length === 0) return undefined;
    return Promise.all(inputs.map((a) => (Buffer.isBuffer(a) ? a : loadAudioAsBuffer(a))));
  }

  /** Query string for a v2 call. */
  private _v2Query(dryRun?: boolean): Record<string, string> | undefined {
    return dryRun ? { dry_run: 'true' } : undefined;
  }

  /** Log the outcome of a v2 call without assuming its shape. */
  private _logV2Result(
    label: string,
    result: V2GenerationResponse | V2Acknowledgement | PriceQuote
  ): void {
    if (isPriceQuote(result)) {
      this.logger.info(
        `${label} dry run: ${result.quantity} x ${result.billing_identifier} = $${(result.usd_micros / 1e6).toFixed(4)} (${result.credit_millis / 1000} credits, ${result.qualifier})`
      );
    } else if ('data' in result && result.data) {
      this.logger.info(`${label}: ${result.data.length} image(s) (generation ${result.generation_id})`);
    } else {
      this.logger.info(`${label}: accepted as generation ${result.generation_id}; poll to retrieve`);
    }
  }

  /**
   * Generate images with Ideogram 3.0.
   * Text-to-image generation with extensive customization options.
   *
   * @param params - Generation parameters
   * @returns Response with generated images
   * @throws Error if generation fails
   *
   * @example
   * const response = await api.generate({
   *   prompt: 'A serene mountain landscape at sunset',
   *   aspectRatio: '16x9',
   *   renderingSpeed: 'QUALITY'
   * });
   */
  async generate(params: GenerateParams): Promise<GenerationResponse> {
    this.logger.info('Generating images with Ideogram 3.0');
    this.logger.debug(`Prompt: "${params.prompt}"`);

    const formData = buildFormData({
      prompt: params.prompt,
      seed: params.seed,
      resolution: params.resolution,
      aspect_ratio: params.aspectRatio,
      rendering_speed: params.renderingSpeed || 'DEFAULT',
      magic_prompt: params.magicPrompt || 'AUTO',
      negative_prompt: params.negativePrompt,
      num_images: params.numImages || 1,
      color_palette: params.colorPalette,
      style_codes: params.styleCodes,
      style_type: params.styleType,
      style_preset: params.stylePreset,
    });

    const response = await this._makeRequest<GenerationResponse>(ENDPOINTS.GENERATE_V3, formData);

    this.logger.info(`Generated ${response.data?.length || 0} image(s) successfully`);

    return response;
  }

  /**
   * Edit image with Ideogram 3.0.
   * Edit images using masks with natural language prompts.
   *
   * @param params - Edit parameters
   * @returns Response with edited images
   * @throws Error if edit fails
   *
   * @example
   * const response = await api.edit({
   *   prompt: 'Change the sky to golden hour',
   *   image: './photo.jpg',
   *   mask: './mask.png'
   * });
   */
  async edit(params: EditParams): Promise<GenerationResponse> {
    this.logger.info('Editing image with Ideogram 3.0');
    this.logger.debug(`Prompt: "${params.prompt}"`);

    // Load image and mask
    const imageBuffer = Buffer.isBuffer(params.image)
      ? params.image
      : await loadImageAsBuffer(params.image);

    const maskBuffer = Buffer.isBuffer(params.mask)
      ? params.mask
      : await loadImageAsBuffer(params.mask);

    const formData = buildFormData({
      prompt: params.prompt,
      image: imageBuffer,
      mask: maskBuffer,
      magic_prompt: params.magicPrompt || 'AUTO',
      num_images: params.numImages || 1,
      seed: params.seed,
      rendering_speed: params.renderingSpeed || 'DEFAULT',
      style_type: params.styleType,
      style_preset: params.stylePreset,
      color_palette: params.colorPalette,
      style_codes: params.styleCodes,
    });

    const response = await this._makeRequest<GenerationResponse>(ENDPOINTS.EDIT_V3, formData);

    this.logger.info(`Edited image successfully (${response.data?.length || 0} results)`);

    return response;
  }

  /**
   * Remix image with Ideogram 3.0.
   * Transform images based on prompts while preserving certain characteristics.
   *
   * @param params - Remix parameters
   * @returns Response with remixed images
   * @throws Error if remix fails
   *
   * @example
   * const response = await api.remix({
   *   prompt: 'Transform into watercolor painting',
   *   image: './photo.jpg',
   *   imageWeight: 75
   * });
   */
  async remix(params: RemixParams): Promise<GenerationResponse> {
    this.logger.info('Remixing image with Ideogram 3.0');
    this.logger.debug(`Prompt: "${params.prompt}"`);

    // Load image
    const imageBuffer = Buffer.isBuffer(params.image)
      ? params.image
      : await loadImageAsBuffer(params.image);

    const formData = buildFormData({
      prompt: params.prompt,
      image: imageBuffer,
      image_weight: params.imageWeight,
      seed: params.seed,
      resolution: params.resolution,
      aspect_ratio: params.aspectRatio,
      rendering_speed: params.renderingSpeed || 'DEFAULT',
      magic_prompt: params.magicPrompt || 'AUTO',
      negative_prompt: params.negativePrompt,
      num_images: params.numImages || 1,
      color_palette: params.colorPalette,
      style_codes: params.styleCodes,
      style_type: params.styleType,
      style_preset: params.stylePreset,
    });

    const response = await this._makeRequest<GenerationResponse>(ENDPOINTS.REMIX_V3, formData);

    this.logger.info(`Remixed image successfully (${response.data?.length || 0} results)`);

    return response;
  }

  /**
   * Reframe image with Ideogram 3.0.
   * Reframe square images to different resolutions.
   *
   * @param params - Reframe parameters
   * @returns Response with reframed images
   * @throws Error if reframe fails
   *
   * @example
   * const response = await api.reframe({
   *   image: './square_photo.jpg',
   *   resolution: '1536x640'
   * });
   */
  async reframe(params: ReframeParams): Promise<GenerationResponse> {
    this.logger.info('Reframing image with Ideogram 3.0');

    await assertSquareImage(params.image);

    // Load image
    const imageBuffer = Buffer.isBuffer(params.image)
      ? params.image
      : await loadImageAsBuffer(params.image);

    const formData = buildFormData({
      image: imageBuffer,
      resolution: params.resolution,
      num_images: params.numImages || 1,
      seed: params.seed,
      rendering_speed: params.renderingSpeed || 'DEFAULT',
      style_preset: params.stylePreset,
      color_palette: params.colorPalette,
      style_codes: params.styleCodes,
    });

    const response = await this._makeRequest<GenerationResponse>(ENDPOINTS.REFRAME_V3, formData);

    this.logger.info(`Reframed image successfully (${response.data?.length || 0} results)`);

    return response;
  }

  /**
   * Replace background with Ideogram 3.0.
   * Replace image backgrounds while keeping foreground subjects.
   *
   * @param params - Replace background parameters
   * @returns Response with background-replaced images
   * @throws Error if operation fails
   *
   * @example
   * const response = await api.replaceBackground({
   *   prompt: 'A tropical beach at sunset',
   *   image: './portrait.jpg'
   * });
   */
  async replaceBackground(params: ReplaceBackgroundParams): Promise<GenerationResponse> {
    this.logger.info('Replacing background with Ideogram 3.0');
    this.logger.debug(`Prompt: "${params.prompt}"`);

    // Load image
    const imageBuffer = Buffer.isBuffer(params.image)
      ? params.image
      : await loadImageAsBuffer(params.image);

    const formData = buildFormData({
      prompt: params.prompt,
      image: imageBuffer,
      magic_prompt: params.magicPrompt || 'AUTO',
      num_images: params.numImages || 1,
      seed: params.seed,
      rendering_speed: params.renderingSpeed || 'DEFAULT',
      style_preset: params.stylePreset,
      color_palette: params.colorPalette,
      style_codes: params.styleCodes,
    });

    const response = await this._makeRequest<GenerationResponse>(
      ENDPOINTS.REPLACE_BACKGROUND_V3,
      formData
    );

    this.logger.info(`Replaced background successfully (${response.data?.length || 0} results)`);

    return response;
  }

  /**
   * Upscale an image 2x, 4x or 8x with Ideogram's v2 upscaler
   * (POST /v2/image/upscale/auto; Ideogram picks the model per request).
   *
   * Changed in 2.0: 1.x called the v1 /upscale endpoint, which Ideogram has
   * retired (every request answered 400 "The selected model version is no
   * longer supported", 2026-11-22). The v2 upscaler takes no prompt,
   * resemblance, detail, magic prompt or image count; passing one of those
   * throws, since the API would otherwise ignore it without a word.
   *
   * @param params - Image and options; `dryRun: true` returns a PriceQuote
   * @returns The upscaled image (sync), an acknowledgement to poll (`async`), or a PriceQuote
   * @throws Error if a 1.x-only field is passed or the image is missing
   *
   * @example
   * const res = await api.upscale({ image: './low_res.jpg', upscaleFactor: 'x4' });
   * console.log(res.width, res.height, extractImageUrls(res));
   */
  async upscale(params: UpscaleParams & { dryRun: true }): Promise<PriceQuote>;
  async upscale(params: UpscaleParams & { dryRun?: false }): Promise<UpscaleResponse>;
  async upscale(params: UpscaleParams): Promise<UpscaleResponse | PriceQuote>;
  async upscale(params: UpscaleParams): Promise<UpscaleResponse | PriceQuote> {
    const retired = ['prompt', 'resemblance', 'detail', 'magicPromptOption', 'numImages'].filter(
      (key) => key in params && Reflect.get(params, key) !== undefined
    );
    if (retired.length > 0) {
      throw new Error(
        `upscale() uses Ideogram's v2 upscaler since 2.0 (the v1 upscale model was retired) and does not accept ${retired.join(', ')}. ` +
          "Use upscaleFactor ('x2', 'x4' or 'x8') and seed."
      );
    }
    if (params.image === undefined || params.image === null) {
      throw new Error(
        `image is required: pass a file path or a Buffer as \`image\` (got ${describeValue(params.image)})`
      );
    }
    this.logger.info(`Upscaling image ${params.upscaleFactor ?? 'x2'}`);
    const formData = buildFormData({
      image: await this._loadImage(params.image),
      upscale_factor: params.upscaleFactor,
      seed: params.seed,
      async: params.async,
      webhook_url: params.webhookUrl,
    });
    const result = await this._request<UpscaleResponse | PriceQuote>({
      method: 'POST',
      endpoint: ENDPOINTS.UPSCALE_AUTO,
      query: this._v2Query(params.dryRun),
      form: formData,
      timeoutMs: params.timeoutMs ?? V2_TIMEOUT_MS,
      maxBodyBytes: BODY_LIMITS.upscale,
    });
    if (!isPriceQuote(result) && result.data) {
      this.logger.info(`Upscaled to ${result.width}x${result.height}`);
    } else {
      this._logV2Result('Upscale', result);
    }
    return result;
  }

  /**
   * Describe image.
   * Get text descriptions of image content.
   *
   * @param params - Describe parameters
   * @returns Response with descriptions
   * @throws Error if describe fails
   *
   * @example
   * const response = await api.describe({
   *   image: './photo.jpg',
   *   describeModelVersion: 'V_3'
   * });
   */
  async describe(params: DescribeParams): Promise<DescribeResponse> {
    this.logger.info('Describing image');

    // Load image
    const imageBuffer = Buffer.isBuffer(params.image)
      ? params.image
      : await loadImageAsBuffer(params.image);

    const formData = buildFormData({
      image_file: imageBuffer,
      describe_model_version: params.describeModelVersion,
    });

    const response = await this._makeRequest<DescribeResponse>(ENDPOINTS.DESCRIBE, formData);

    this.logger.info(`Described image successfully (${response.descriptions?.length || 0} descriptions)`);

    return response;
  }

  // ==================== v2: Ideogram 4.0 / 4.5 / auto ====================

  /**
   * Generate images with Ideogram 4.0 (JSON body).
   *
   * @param params - Generation parameters; `dryRun: true` returns a PriceQuote
   * @returns Generated images (sync), an acknowledgement to poll (`async`), or a PriceQuote
   *
   * @example
   * const res = await api.generateV4({ prompt: 'A lighthouse at dawn', resolution: '2048x2048' });
   * const quote = await api.generateV4({ prompt: 'A lighthouse at dawn', dryRun: true });
   */
  async generateV4(params: GenerateV4Params & { dryRun: true }): Promise<PriceQuote>;
  async generateV4(params: GenerateV4Params & { dryRun?: false }): Promise<V2GenerationResponse>;
  async generateV4(params: GenerateV4Params): Promise<V2GenerationResponse | PriceQuote>;
  async generateV4(params: GenerateV4Params): Promise<V2GenerationResponse | PriceQuote> {
    this.logger.info('Generating images with Ideogram 4.0');
    this.logger.debug(`Prompt: "${params.prompt}"`);
    const result = await this._request<V2GenerationResponse | PriceQuote>({
      method: 'POST',
      endpoint: ENDPOINTS.GENERATE_V4,
      query: this._v2Query(params.dryRun),
      json: definedOnly({
        prompt: params.prompt,
        magic_prompt: params.magicPrompt,
        seed: params.seed,
        num_images: params.numImages,
        resolution: params.resolution,
        rendering_speed: params.renderingSpeed,
        enable_copyright_detection: params.enableCopyrightDetection,
        async: params.async,
        webhook_url: params.webhookUrl,
      }),
      timeoutMs: params.timeoutMs ?? V2_TIMEOUT_MS,
      maxBodyBytes: BODY_LIMITS.json,
    });
    this._logV2Result('Ideogram 4.0', result);
    return result;
  }

  /**
   * Generate images on a transparent background with Ideogram 4.0 (PNG with alpha).
   *
   * @example
   * const res = await api.generateV4Transparent({ prompt: 'A cartoon fox mascot', outputResolution: '2k' });
   */
  async generateV4Transparent(params: GenerateV4TransparentParams & { dryRun: true }): Promise<PriceQuote>;
  async generateV4Transparent(params: GenerateV4TransparentParams & { dryRun?: false }): Promise<V2GenerationResponse>;
  async generateV4Transparent(params: GenerateV4TransparentParams): Promise<V2GenerationResponse | PriceQuote>;
  async generateV4Transparent(params: GenerateV4TransparentParams): Promise<V2GenerationResponse | PriceQuote> {
    this.logger.info('Generating transparent images with Ideogram 4.0');
    this.logger.debug(`Prompt: "${params.prompt}"`);
    const result = await this._request<V2GenerationResponse | PriceQuote>({
      method: 'POST',
      endpoint: ENDPOINTS.GENERATE_V4_TRANSPARENT,
      query: this._v2Query(params.dryRun),
      json: definedOnly({
        prompt: params.prompt,
        magic_prompt: params.magicPrompt,
        seed: params.seed,
        num_images: params.numImages,
        aspect_ratio: params.aspectRatio,
        output_resolution: params.outputResolution,
        rendering_speed: params.renderingSpeed,
        enable_copyright_detection: params.enableCopyrightDetection,
        async: params.async,
        webhook_url: params.webhookUrl,
      }),
      timeoutMs: params.timeoutMs ?? V2_TIMEOUT_MS,
      maxBodyBytes: BODY_LIMITS.json,
    });
    this._logV2Result('Ideogram 4.0 transparent', result);
    return result;
  }

  /**
   * Generate images with a custom Ideogram 4.0 model.
   *
   * @example
   * const res = await api.generateV4Custom({
   *   prompt: 'Product shot',
   *   customModelUri: 'model/my-model/version/1',
   * });
   */
  async generateV4Custom(params: GenerateV4CustomParams & { dryRun: true }): Promise<PriceQuote>;
  async generateV4Custom(params: GenerateV4CustomParams & { dryRun?: false }): Promise<V2GenerationResponse>;
  async generateV4Custom(params: GenerateV4CustomParams): Promise<V2GenerationResponse | PriceQuote>;
  async generateV4Custom(params: GenerateV4CustomParams): Promise<V2GenerationResponse | PriceQuote> {
    if (!params.customModelUri) {
      throw new Error(
        "customModelUri is required: pass the model as `customModelUri`, in the form 'model/<model_name>/version/<version_name>'"
      );
    }
    this.logger.info(`Generating images with custom model ${params.customModelUri}`);
    this.logger.debug(`Prompt: "${params.prompt}"`);
    const result = await this._request<V2GenerationResponse | PriceQuote>({
      method: 'POST',
      endpoint: ENDPOINTS.GENERATE_V4_CUSTOM,
      query: this._v2Query(params.dryRun),
      json: definedOnly({
        prompt: params.prompt,
        custom_model_uri: params.customModelUri,
        transparent_background: params.transparentBackground,
        magic_prompt: params.magicPrompt,
        seed: params.seed,
        num_images: params.numImages,
        resolution: params.resolution,
        rendering_speed: params.renderingSpeed,
        enable_copyright_detection: params.enableCopyrightDetection,
        async: params.async,
        webhook_url: params.webhookUrl,
      }),
      timeoutMs: params.timeoutMs ?? V2_TIMEOUT_MS,
      maxBodyBytes: BODY_LIMITS.json,
    });
    this._logV2Result('Ideogram 4.0 custom model', result);
    return result;
  }

  /** Shared body of the 4.5 and 4.6 generate methods (identical fields, different endpoints). */
  private async _generateV4x(
    label: string,
    endpoint: string,
    params: GenerateV45Params
  ): Promise<V2GenerationResponse | PriceQuote> {
    this.logger.info(`Generating images with ${label}`);
    this.logger.debug(`Prompt: "${params.prompt}"`);
    const images = await this._loadImages(params.images);
    const mask = params.mask !== undefined ? await this._loadImage(params.mask) : undefined;
    const formData = buildFormData({
      prompt: params.prompt,
      magic_prompt: params.magicPrompt,
      images,
      mask,
      size: params.size,
      background: params.background,
      quality: params.quality,
      seed: params.seed,
      num_images: params.numImages,
      enable_copyright_detection: params.enableCopyrightDetection,
      async: params.async,
      webhook_url: params.webhookUrl,
    });
    const result = await this._request<V2GenerationResponse | PriceQuote>({
      method: 'POST',
      endpoint,
      query: this._v2Query(params.dryRun),
      form: formData,
      timeoutMs: params.timeoutMs ?? V2_TIMEOUT_MS,
      maxBodyBytes: BODY_LIMITS.v4x,
    });
    this._logV2Result(label, result);
    return result;
  }

  /**
   * Generate with Ideogram 4.5, or edit source images with a prompt (multipart).
   * With `images`, the first image is edited and the rest are references;
   * `mask` marks the area to edit (black = edit, white = keep); the API does not reliably
   * confine the edit to that area, so check the result.
   *
   * @example
   * const res = await api.generateV45({ prompt: 'A poster that says OPEN LATE', quality: 'high' });
   * const edit = await api.generateV45({ prompt: 'Make it night', images: ['./street.jpg'] });
   */
  async generateV45(params: GenerateV45Params & { dryRun: true }): Promise<PriceQuote>;
  async generateV45(params: GenerateV45Params & { dryRun?: false }): Promise<V2GenerationResponse>;
  async generateV45(params: GenerateV45Params): Promise<V2GenerationResponse | PriceQuote>;
  async generateV45(params: GenerateV45Params): Promise<V2GenerationResponse | PriceQuote> {
    return this._generateV4x('Ideogram 4.5', ENDPOINTS.GENERATE_V45, params);
  }

  /**
   * Generate with Ideogram 4.6, or edit source images with a prompt (multipart).
   * Same fields as generateV45. 4.6 renders up to 4096x4096, adds the
   * 'auto_2k' / 'auto_4k' sizes, and runs 'very_low' quality without source images.
   *
   * @example
   * const res = await api.generateV46({ prompt: 'A poster that says OPEN LATE', size: 'auto_4k' });
   */
  async generateV46(params: GenerateV46Params & { dryRun: true }): Promise<PriceQuote>;
  async generateV46(params: GenerateV46Params & { dryRun?: false }): Promise<V2GenerationResponse>;
  async generateV46(params: GenerateV46Params): Promise<V2GenerationResponse | PriceQuote>;
  async generateV46(params: GenerateV46Params): Promise<V2GenerationResponse | PriceQuote> {
    return this._generateV4x('Ideogram 4.6', ENDPOINTS.GENERATE_V46, params);
  }

  /**
   * Generate with the model Ideogram picks for the request (multipart).
   * Accepts optional source images to edit. Does not support webhooks.
   * `styleType` and `colorPalette` narrow the choice to models that support
   * them, and cannot be combined with source images.
   *
   * @example
   * const res = await api.generateAuto({ prompt: 'A watercolor map of Lisbon', aspectRatio: '16x9' });
   * const styled = await api.generateAuto({ prompt: 'A logo', styleType: 'design', colorPalette: 'ember' });
   */
  async generateAuto(params: GenerateAutoParams & { dryRun: true }): Promise<PriceQuote>;
  async generateAuto(params: GenerateAutoParams & { dryRun?: false }): Promise<V2GenerationResponse>;
  async generateAuto(params: GenerateAutoParams): Promise<V2GenerationResponse | PriceQuote>;
  async generateAuto(params: GenerateAutoParams): Promise<V2GenerationResponse | PriceQuote> {
    this.logger.info('Generating images with automatic model selection');
    this.logger.debug(`Prompt: "${params.prompt}"`);
    const formData = buildFormData({
      prompt: params.prompt,
      images: await this._loadImages(params.images),
      negative_prompt: params.negativePrompt,
      style_type: params.styleType,
      // An object field goes as one JSON part, which the API parses (2026-11-22 dry run).
      color_palette: toPaletteObject(params.colorPalette),
      aspect_ratio: params.aspectRatio,
      resolution: params.resolution,
      resolution_tier: params.resolutionTier,
      magic_prompt: params.magicPrompt,
      num_images: params.numImages,
      seed: params.seed,
      async: params.async,
    });
    const result = await this._request<V2GenerationResponse | PriceQuote>({
      method: 'POST',
      endpoint: ENDPOINTS.GENERATE_AUTO,
      query: this._v2Query(params.dryRun),
      form: formData,
      timeoutMs: params.timeoutMs ?? V2_TIMEOUT_MS,
      maxBodyBytes: BODY_LIMITS.auto,
    });
    this._logV2Result('Auto model selection', result);
    return result;
  }

  /** Shared body of the 4.5 and 4.6 precise-edit methods (identical fields, different endpoints). */
  private async _preciseEditV4x(
    label: string,
    endpoint: string,
    params: PreciseEditV45Params
  ): Promise<V2GenerationResponse | PriceQuote> {
    if (params.image === undefined || params.image === null) {
      throw new Error(
        `image is required: pass a file path or a Buffer as \`image\` (got ${describeValue(params.image)})`
      );
    }
    this.logger.info(`Precise editing image with ${label}`);
    this.logger.debug(`Prompt: "${params.prompt}"`);
    const image = await this._loadImage(params.image);
    const refs = await this._loadImages(params.referenceImages);
    const mask = params.mask !== undefined ? await this._loadImage(params.mask) : undefined;
    const formData = buildFormData({
      prompt: params.prompt,
      image,
      reference_images: refs,
      mask,
      context_window: params.contextWindow,
      quality: params.quality,
      seed: params.seed,
      num_images: params.numImages,
      enable_copyright_detection: params.enableCopyrightDetection,
      async: params.async,
      webhook_url: params.webhookUrl,
    });
    const result = await this._request<V2GenerationResponse | PriceQuote>({
      method: 'POST',
      endpoint,
      query: this._v2Query(params.dryRun),
      form: formData,
      timeoutMs: params.timeoutMs ?? V2_TIMEOUT_MS,
      maxBodyBytes: BODY_LIMITS.preciseEdit,
    });
    this._logV2Result(`${label} precise edit`, result);
    return result;
  }

  /**
   * Precise edit with Ideogram 4.5: the result keeps the input image's exact
   * width and height, and unchanged pixels are copied from it. Editing the
   * whole image is bounded by 2048x2048 pixels; a larger image comes back
   * scaled down unless `contextWindow` confines the edit to a region.
   * `contextWindow` defaults to 'auto' (a region around the mask; without a
   * mask the whole image is edited).
   *
   * @example
   * const res = await api.preciseEditV45({
   *   prompt: 'Add round black sunglasses.',
   *   image: './photo_8k.png',
   *   mask: './mask_8k.png',
   * });
   */
  async preciseEditV45(params: PreciseEditV45Params & { dryRun: true }): Promise<PriceQuote>;
  async preciseEditV45(params: PreciseEditV45Params & { dryRun?: false }): Promise<V2GenerationResponse>;
  async preciseEditV45(params: PreciseEditV45Params): Promise<V2GenerationResponse | PriceQuote>;
  async preciseEditV45(params: PreciseEditV45Params): Promise<V2GenerationResponse | PriceQuote> {
    return this._preciseEditV4x('Ideogram 4.5', ENDPOINTS.PRECISE_EDIT_V45, params);
  }

  /**
   * Precise edit with Ideogram 4.6. Same fields as preciseEditV45; the whole-
   * image bound is 4096x4096 pixels (2048x2048 at 'very_low'), and an image
   * over 2048x2048 bills at the 4K price except at 'very_low'.
   *
   * @example
   * const res = await api.preciseEditV46({ prompt: 'Add a red scarf.', image: './photo_4k.png' });
   */
  async preciseEditV46(params: PreciseEditV46Params & { dryRun: true }): Promise<PriceQuote>;
  async preciseEditV46(params: PreciseEditV46Params & { dryRun?: false }): Promise<V2GenerationResponse>;
  async preciseEditV46(params: PreciseEditV46Params): Promise<V2GenerationResponse | PriceQuote>;
  async preciseEditV46(params: PreciseEditV46Params): Promise<V2GenerationResponse | PriceQuote> {
    return this._preciseEditV4x('Ideogram 4.6', ENDPOINTS.PRECISE_EDIT_V46, params);
  }

  // ==================== v2: always-asynchronous (SVG, video) ====================

  /** POST to an always-async endpoint and log the acknowledgement or quote. */
  private async _submitAsync(
    label: string,
    opts: Omit<RequestOptions, 'method' | 'timeoutMs'> & { timeoutMs?: number; dryRun?: boolean }
  ): Promise<V2Acknowledgement | PriceQuote> {
    const result = await this._request<V2Acknowledgement | PriceQuote>({
      method: 'POST',
      endpoint: opts.endpoint,
      query: this._v2Query(opts.dryRun),
      form: opts.form,
      json: opts.json,
      timeoutMs: opts.timeoutMs ?? V2_TIMEOUT_MS,
      maxBodyBytes: opts.maxBodyBytes,
    });
    this._logV2Result(label, result);
    return result;
  }

  /**
   * Generate SVG artwork with Ideogram Vector 1 (multipart). Always
   * asynchronous: resolves to a `generation_id`; retrieve the SVGs with
   * waitForGeneration, then extractSvgUrls.
   *
   * @example
   * const ack = await api.generateSvg({ prompt: 'A flat fox logo', useGradient: false });
   * const done = await api.waitForGeneration(ack.generation_id);
   * const urls = extractSvgUrls(done);
   */
  async generateSvg(params: GenerateSvgParams & { dryRun: true }): Promise<PriceQuote>;
  async generateSvg(params: GenerateSvgParams & { dryRun?: false }): Promise<V2Acknowledgement>;
  async generateSvg(params: GenerateSvgParams): Promise<V2Acknowledgement | PriceQuote>;
  async generateSvg(params: GenerateSvgParams): Promise<V2Acknowledgement | PriceQuote> {
    this.logger.info('Generating SVG with Ideogram Vector 1');
    this.logger.debug(`Prompt: "${params.prompt}"`);
    const ids = params.imageAssetIdentifiers;
    const formData = buildFormData({
      prompt: params.prompt,
      // The API reads this field as ONE part holding a JSON array; one object
      // per part is rejected ('asset_type' is not of type 'object'). Observed
      // by dry run 2026-11-22; the spec gives no multipart encoding for it.
      image_asset_identifiers: ids && ids.length > 0 ? JSON.stringify(ids) : undefined,
      images: await this._loadImages(params.images),
      aspect_ratio: params.aspectRatio,
      quality: params.quality,
      num_images: params.numImages,
      seed: params.seed,
      use_gradient: params.useGradient,
      private: params.private,
      target_collection_id: params.targetCollectionId,
      webhook_url: params.webhookUrl,
    });
    return this._submitAsync('Ideogram Vector 1 SVG', {
      endpoint: ENDPOINTS.GENERATE_SVG,
      form: formData,
      dryRun: params.dryRun,
      timeoutMs: params.timeoutMs,
      maxBodyBytes: BODY_LIMITS.svg,
    });
  }

  /**
   * Text to video with MiniMax H3 (JSON). Resolves to a `generation_id`;
   * retrieve the video with waitForGeneration, then extractVideoUrls.
   *
   * @example
   * const ack = await api.minimaxH3TextToVideo({ prompt: 'A red fox in snow', duration: 5, resolution: '768P' });
   */
  async minimaxH3TextToVideo(params: MinimaxH3TextToVideoParams & { dryRun: true }): Promise<PriceQuote>;
  async minimaxH3TextToVideo(params: MinimaxH3TextToVideoParams & { dryRun?: false }): Promise<V2Acknowledgement>;
  async minimaxH3TextToVideo(params: MinimaxH3TextToVideoParams): Promise<V2Acknowledgement | PriceQuote>;
  async minimaxH3TextToVideo(params: MinimaxH3TextToVideoParams): Promise<V2Acknowledgement | PriceQuote> {
    this.logger.info('Text to video with MiniMax H3');
    return this._submitAsync('MiniMax H3 text to video', {
      endpoint: ENDPOINTS.VIDEO_MINIMAX_H3_TEXT,
      json: definedOnly({
        prompt: params.prompt,
        aspect_ratio: params.aspectRatio,
        resolution: params.resolution,
        duration: params.duration,
        webhook_url: params.webhookUrl,
      }),
      dryRun: params.dryRun,
      timeoutMs: params.timeoutMs,
      maxBodyBytes: BODY_LIMITS.json,
    });
  }

  /**
   * Image to video with MiniMax H3 (multipart): animate `image` as the first
   * frame, optionally ending on `endImage`.
   *
   * @example
   * const ack = await api.minimaxH3ImageToVideo({ prompt: 'The camera pans right', image: './beach.png' });
   */
  async minimaxH3ImageToVideo(params: MinimaxH3ImageToVideoParams & { dryRun: true }): Promise<PriceQuote>;
  async minimaxH3ImageToVideo(params: MinimaxH3ImageToVideoParams & { dryRun?: false }): Promise<V2Acknowledgement>;
  async minimaxH3ImageToVideo(params: MinimaxH3ImageToVideoParams): Promise<V2Acknowledgement | PriceQuote>;
  async minimaxH3ImageToVideo(params: MinimaxH3ImageToVideoParams): Promise<V2Acknowledgement | PriceQuote> {
    if (params.image === undefined || params.image === null) {
      throw new Error(
        `image (the first frame) is required: pass a file path or a Buffer as \`image\` (got ${describeValue(params.image)})`
      );
    }
    this.logger.info('Image to video with MiniMax H3');
    const formData = buildFormData({
      prompt: params.prompt,
      image: await this._loadImage(params.image),
      end_image: params.endImage !== undefined ? await this._loadImage(params.endImage) : undefined,
      resolution: params.resolution,
      duration: params.duration,
      webhook_url: params.webhookUrl,
    });
    return this._submitAsync('MiniMax H3 image to video', {
      endpoint: ENDPOINTS.VIDEO_MINIMAX_H3_IMAGE,
      form: formData,
      dryRun: params.dryRun,
      timeoutMs: params.timeoutMs,
      maxBodyBytes: BODY_LIMITS.videoFrames,
    });
  }

  /**
   * Reference to video with MiniMax H3 (multipart). Address references in the
   * prompt by position: "Image 1", "Audio 1". Audio needs a reference image.
   *
   * @example
   * const ack = await api.minimaxH3ReferenceToVideo({
   *   prompt: 'Image 1 walks through a snowy forest',
   *   referenceImages: ['./character.png'],
   * });
   */
  async minimaxH3ReferenceToVideo(params: MinimaxH3ReferenceToVideoParams & { dryRun: true }): Promise<PriceQuote>;
  async minimaxH3ReferenceToVideo(params: MinimaxH3ReferenceToVideoParams & { dryRun?: false }): Promise<V2Acknowledgement>;
  async minimaxH3ReferenceToVideo(params: MinimaxH3ReferenceToVideoParams): Promise<V2Acknowledgement | PriceQuote>;
  async minimaxH3ReferenceToVideo(params: MinimaxH3ReferenceToVideoParams): Promise<V2Acknowledgement | PriceQuote> {
    this.logger.info('Reference to video with MiniMax H3');
    const formData = buildFormData({
      prompt: params.prompt,
      reference_images: await this._loadImages(params.referenceImages),
      reference_audios: await this._loadAudios(params.referenceAudios),
      aspect_ratio: params.aspectRatio,
      resolution: params.resolution,
      duration: params.duration,
      prompt_expansion_mode: params.promptExpansionMode,
      webhook_url: params.webhookUrl,
    });
    return this._submitAsync('MiniMax H3 reference to video', {
      endpoint: ENDPOINTS.VIDEO_MINIMAX_H3_REFERENCE,
      form: formData,
      dryRun: params.dryRun,
      timeoutMs: params.timeoutMs,
      maxBodyBytes: BODY_LIMITS.videoReferences,
    });
  }

  /**
   * Text to video with Seedance 2.5 (JSON), up to 1080p and 30 seconds.
   * `generateAudio`: Ideogram's docs say audio roughly doubles the cost; at 480p / 4 s it did not
   * change the quote or the bill (2026-11-22). Run `dryRun` to see the price.
   *
   * @example
   * const quote = await api.seedance25TextToVideo({ prompt: 'A red fox in snow', resolution: '1080p', dryRun: true });
   */
  async seedance25TextToVideo(params: Seedance25TextToVideoParams & { dryRun: true }): Promise<PriceQuote>;
  async seedance25TextToVideo(params: Seedance25TextToVideoParams & { dryRun?: false }): Promise<V2Acknowledgement>;
  async seedance25TextToVideo(params: Seedance25TextToVideoParams): Promise<V2Acknowledgement | PriceQuote>;
  async seedance25TextToVideo(params: Seedance25TextToVideoParams): Promise<V2Acknowledgement | PriceQuote> {
    this.logger.info('Text to video with Seedance 2.5');
    return this._submitAsync('Seedance 2.5 text to video', {
      endpoint: ENDPOINTS.VIDEO_SEEDANCE_25_TEXT,
      json: definedOnly({
        prompt: params.prompt,
        aspect_ratio: params.aspectRatio,
        resolution: params.resolution,
        duration: params.duration,
        generate_audio: params.generateAudio,
        webhook_url: params.webhookUrl,
      }),
      dryRun: params.dryRun,
      timeoutMs: params.timeoutMs,
      maxBodyBytes: BODY_LIMITS.json,
    });
  }

  /**
   * Image to video with Seedance 2.5 (multipart): animate `image` as the first
   * frame, optionally ending on `endImage`.
   *
   * @example
   * const ack = await api.seedance25ImageToVideo({ prompt: 'Waves roll in', image: './beach.png' });
   */
  async seedance25ImageToVideo(params: Seedance25ImageToVideoParams & { dryRun: true }): Promise<PriceQuote>;
  async seedance25ImageToVideo(params: Seedance25ImageToVideoParams & { dryRun?: false }): Promise<V2Acknowledgement>;
  async seedance25ImageToVideo(params: Seedance25ImageToVideoParams): Promise<V2Acknowledgement | PriceQuote>;
  async seedance25ImageToVideo(params: Seedance25ImageToVideoParams): Promise<V2Acknowledgement | PriceQuote> {
    if (params.image === undefined || params.image === null) {
      throw new Error(
        `image (the first frame) is required: pass a file path or a Buffer as \`image\` (got ${describeValue(params.image)})`
      );
    }
    this.logger.info('Image to video with Seedance 2.5');
    const formData = buildFormData({
      prompt: params.prompt,
      image: await this._loadImage(params.image),
      end_image: params.endImage !== undefined ? await this._loadImage(params.endImage) : undefined,
      resolution: params.resolution,
      duration: params.duration,
      generate_audio: params.generateAudio,
      webhook_url: params.webhookUrl,
    });
    return this._submitAsync('Seedance 2.5 image to video', {
      endpoint: ENDPOINTS.VIDEO_SEEDANCE_25_IMAGE,
      form: formData,
      dryRun: params.dryRun,
      timeoutMs: params.timeoutMs,
      maxBodyBytes: BODY_LIMITS.videoFrames,
    });
  }

  /**
   * Reference to video with Seedance 2.5 (multipart). Needs at least one
   * reference image; address references as "[Image1]".
   *
   * @example
   * const ack = await api.seedance25ReferenceToVideo({
   *   prompt: '[Image1] walks toward the camera',
   *   referenceImages: ['./character.png'],
   * });
   */
  async seedance25ReferenceToVideo(params: Seedance25ReferenceToVideoParams & { dryRun: true }): Promise<PriceQuote>;
  async seedance25ReferenceToVideo(params: Seedance25ReferenceToVideoParams & { dryRun?: false }): Promise<V2Acknowledgement>;
  async seedance25ReferenceToVideo(params: Seedance25ReferenceToVideoParams): Promise<V2Acknowledgement | PriceQuote>;
  async seedance25ReferenceToVideo(params: Seedance25ReferenceToVideoParams): Promise<V2Acknowledgement | PriceQuote> {
    this.logger.info('Reference to video with Seedance 2.5');
    const formData = buildFormData({
      prompt: params.prompt,
      reference_images: await this._loadImages(params.referenceImages),
      reference_audios: await this._loadAudios(params.referenceAudios),
      aspect_ratio: params.aspectRatio,
      resolution: params.resolution,
      duration: params.duration,
      generate_audio: params.generateAudio,
      webhook_url: params.webhookUrl,
    });
    return this._submitAsync('Seedance 2.5 reference to video', {
      endpoint: ENDPOINTS.VIDEO_SEEDANCE_25_REFERENCE,
      form: formData,
      dryRun: params.dryRun,
      timeoutMs: params.timeoutMs,
      maxBodyBytes: BODY_LIMITS.videoReferences,
    });
  }

  /**
   * Get the status (and, when complete, the results) of an async generation.
   *
   * @param generationId - The generation_id returned by a v2 request
   * @param options - `timeoutMs`: request timeout (default 120000)
   *
   * @example
   * const status = await api.getGeneration(res.generation_id);
   * if (status.status === 'completed') console.log(status.data);
   */
  async getGeneration(generationId: string, options: { timeoutMs?: number } = {}): Promise<GenerationStatus> {
    if (!generationId || typeof generationId !== 'string') {
      throw new Error(
        `generationId is required: pass the generation_id string from a v2 response (got ${describeValue(generationId)})`
      );
    }
    const timeoutMs = options.timeoutMs ?? V1_TIMEOUT_MS;
    assertTimerMs('timeoutMs', timeoutMs);
    try {
      return await this._request<GenerationStatus>({
        method: 'GET',
        endpoint: `${ENDPOINTS.GENERATIONS}/${encodeURIComponent(generationId)}`,
        timeoutMs,
        maxBodyBytes: BODY_LIMITS.json,
      });
    } catch (error) {
      if (error instanceof IdeogramAPIError) {
        // Name the generation and say whether asking again can work (a GET is never billed: possiblyBilled stays false).
        Object.assign(error, { generationId, resumable: classifyPollFailure(error).resumable });
      }
      throw error;
    }
  }

  /**
   * Poll a generation until it completes or fails.
   * A 429 while polling backs off (doubling the interval, at least 1s and up to 30s, and never
   * shorter than the interval in use) and keeps polling.
   *
   * @param generationId - The generation_id returned by a v2 request
   * @param options - Poll interval, overall timeout, per-poll callback
   * @returns The completed GenerationStatus (with `data`)
   * @throws IdeogramAPIError with code 'EINVALIDARGUMENT' (not resumable, not
   *   billed) if `generationId` is empty or `intervalMs` / `timeoutMs` is not an
   *   integer from 1 to 2147483647
   * @throws IdeogramAPIError with `failureReason` if the generation failed,
   *   or on timeout (the generation keeps running server-side)
   *
   * @example
   * const ack = await api.generateV45({ prompt: '...', async: true });
   * const done = await api.waitForGeneration(ack.generation_id);
   */
  async waitForGeneration(
    generationId: string,
    options: WaitForGenerationOptions = {}
  ): Promise<GenerationStatus> {
    const baseInterval = options.intervalMs ?? 2000;
    const timeoutMs = options.timeoutMs ?? 600000;
    try {
      if (!generationId || typeof generationId !== 'string') {
        throw new Error(
          `generationId is required: pass the generation_id string from a v2 response (got ${describeValue(generationId)})`
        );
      }
      assertTimerMs('intervalMs', baseInterval);
      assertTimerMs('timeoutMs', timeoutMs);
    } catch (error) {
      throw new IdeogramAPIError(toError(error).message, { code: 'EINVALIDARGUMENT', cause: error });
    }
    const deadline = Date.now() + timeoutMs;
    let interval = baseInterval;

    for (;;) {
      let status: GenerationStatus | undefined;
      try {
        // Never let one poll outlive the overall deadline.
        const pollTimeout = Math.max(1, Math.min(V1_TIMEOUT_MS, deadline - Date.now()));
        status = await this.getGeneration(generationId, { timeoutMs: pollTimeout });
        interval = baseInterval;
      } catch (error) {
        if (error instanceof IdeogramAPIError && error.status === 429) {
          // Double (at least 1s, at most 30s), but never poll sooner than the
          // current interval: a base interval above 30s must not be shortened.
          interval = Math.max(interval, Math.min(Math.max(interval * 2, 1000), 30000));
          this.logger.warn(`Rate limited while polling ${generationId}; retrying in ${interval}ms`);
        } else if (error instanceof IdeogramAPIError && error.code === 'ETIMEDOUT' && Date.now() >= deadline) {
          // The capped last poll ran into the overall deadline: that is the wait timing out.
          throw new IdeogramAPIError(
            `Timed out after ${timeoutMs}ms waiting for generation ${generationId} (it may still complete; poll getGeneration later)`,
            { generationId, possiblyBilled: true, resumable: true, cause: error }
          );
        } else if (error instanceof IdeogramAPIError) {
          // Polling again can succeed unless the failure is permanent (see classifyPollFailure).
          const httpStatus = error.status;
          const { resumable } = classifyPollFailure(error);
          let message: string;
          if (httpStatus === 404) {
            message = `Generation ${generationId} not found: check the id (if you submitted it, it may still have been billed)`;
          } else if (httpStatus === 401 || httpStatus === 403) {
            message = `${error.message} (while polling generation ${generationId}; fix the key, then resume with get-generation)`;
          } else if (!resumable) {
            message = `${error.message} (while polling generation ${generationId}; polling again will not succeed; if you submitted it, it may still have been billed)`;
          } else {
            message = `${error.message} (while polling generation ${generationId}; it may still complete, poll getGeneration later)`;
          }
          // The id names something that may have been submitted (and billed): never resubmit.
          throw new IdeogramAPIError(message, {
            status: error.status,
            rejectReason: error.rejectReason,
            maxInflightRequests: error.maxInflightRequests,
            failureReason: error.failureReason,
            body: error.body,
            code: error.code,
            possiblyBilled: true,
            resumable,
            generationId,
            cause: error,
          });
        } else {
          throw error;
        }
      }

      if (status) {
        try {
          options.onPoll?.(status);
        } catch (error) {
          // The generation was already submitted and billed: a throwing callback must not hide its id.
          throw new IdeogramAPIError(
            `onPoll callback threw while waiting for generation ${generationId} (it may still complete; poll getGeneration later): ${toError(error).message}`,
            { generationId, possiblyBilled: true, resumable: true, cause: error }
          );
        }
        if (status.status === 'completed') {
          return status;
        }
        if (status.status === 'failed') {
          throw new IdeogramAPIError(
            `Generation ${generationId} failed${status.failure_reason ? `: ${sanitizeServerText(String(status.failure_reason))}` : ''}`,
            {
              failureReason: status.failure_reason,
              body: status,
              generationId,
              generationStatus: status.status,
              possiblyBilled: true,
            }
          );
        }
      }

      if (Date.now() + interval > deadline) {
        throw new IdeogramAPIError(
          `Timed out after ${timeoutMs}ms waiting for generation ${generationId} (it may still complete; poll getGeneration later)`,
          { generationId, possiblyBilled: true, resumable: true }
        );
      }
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
  }

  /**
   * Set the log level of THIS client instance only (the logger that reports
   * request failures and polling). It does not touch the module logger that
   * `setLogLevel` from `ideogram-api/utils` controls (file loading, DNS and
   * download checks); that one only sets the default for instances created later.
   *
   * @param level - Log level (debug, info, warn, error; case-insensitive)
   * @throws Error if the level is unknown
   *
   * @example
   * api.setLogLevel('debug');
   */
  setLogLevel(level: string): void {
    this.logger.level = normalizeLogLevel(level);
  }
}

/**
 * Extract image URLs from Ideogram API response.
 * Works with all endpoint responses that return image data.
 *
 * @param response - Ideogram API response
 * @returns Array of image objects with URLs and metadata
 *
 * @example
 * const images = extractImages(response);
 * // [{ url: 'https://...', prompt: '...', resolution: '1024x1024', ... }]
 */
export function extractImages(response: GenerationResponse): ImageData[];
export function extractImages(response: V2GenerationResponse): GeneratedImage[];
export function extractImages(response: GenerationStatus): GenerationDataItem[];
export function extractImages(response: UpscaleResponse): UpscaledImage[];
export function extractImages(
  response: GenerationResponse | V2GenerationResponse | GenerationStatus | UpscaleResponse
): unknown[];
export function extractImages(
  response: GenerationResponse | V2GenerationResponse | GenerationStatus | UpscaleResponse
): unknown[] {
  return (response && response.data) || [];
}

/** The fields of a response item that extractImageUrls reads. */
interface UrlBearing {
  url?: string | null;
  is_image_safe?: boolean;
  object_type?: string;
}

/**
 * Collect the downloadable URLs from any generation response.
 * Skips images that failed safety checks (their `url` is empty) and
 * non-image items from a polled generation.
 *
 * @example
 * const urls = extractImageUrls(await api.generateV4({ prompt: 'a cat' }));
 */
export function extractImageUrls(
  response: GenerationResponse | V2GenerationResponse | GenerationStatus | UpscaleResponse
): string[] {
  const items: readonly UrlBearing[] = (response && response.data) || [];
  return items
    .filter((item) => item.is_image_safe !== false)
    .filter((item) => !item.object_type || item.object_type.startsWith('image'))
    .map((item) => item.url)
    .filter((url): url is string => typeof url === 'string' && url.length > 0);
}

/** URLs of the polled result items with the given object_type. */
function urlsOfType(response: GenerationStatus, objectType: string): string[] {
  return ((response && response.data) || [])
    .filter((item) => item.object_type === objectType)
    .map((item) => item.url)
    .filter((url): url is string => typeof url === 'string' && url.length > 0);
}

/**
 * Collect the video URLs from a completed generation (object_type
 * 'video.generation'). Video endpoints are always asynchronous, so this takes
 * the GenerationStatus from getGeneration / waitForGeneration.
 *
 * @example
 * const ack = await api.seedance25TextToVideo({ prompt: 'a fox in snow' });
 * const urls = extractVideoUrls(await api.waitForGeneration(ack.generation_id));
 */
export function extractVideoUrls(response: GenerationStatus): string[] {
  return urlsOfType(response, 'video.generation');
}

/**
 * Collect the SVG URLs from a completed generation (object_type 'svg.generation').
 *
 * @example
 * const ack = await api.generateSvg({ prompt: 'a fox logo' });
 * const urls = extractSvgUrls(await api.waitForGeneration(ack.generation_id));
 */
export function extractSvgUrls(response: GenerationStatus): string[] {
  return urlsOfType(response, 'svg.generation');
}

/**
 * Type guard: true when a v2 call returned a dry-run PriceQuote.
 *
 * @example
 * const res = await api.generateV45({ prompt, dryRun });
 * if (isPriceQuote(res)) console.log(res.usd_micros / 1e6);
 */
export function isPriceQuote(value: unknown): value is PriceQuote {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { object?: unknown }).object === 'price_quote'
  );
}

/**
 * Extract descriptions from describe endpoint response.
 *
 * @param response - Describe API response
 * @returns Array of description texts
 *
 * @example
 * const descriptions = extractDescriptions(response);
 * // ['A mountain landscape...', 'The image shows...']
 */
export function extractDescriptions(response: DescribeResponse): string[] {
  return (response.descriptions || []).map((d: Description) => d.text);
}

export default IdeogramAPI;

// Re-export types for consumer convenience
export type {
  // Parameter types
  GenerateParams,
  EditParams,
  RemixParams,
  ReframeParams,
  ReplaceBackgroundParams,
  UpscaleParams,
  UpscaleFactor,
  UpscaleResponse,
  UpscaledImage,
  DescribeParams,
  BaseGenerationParams,

  // Response types
  GenerationResponse,
  DescribeResponse,
  ImageData,
  Description,

  // Enum/Union types
  RenderingSpeed,
  MagicPromptOption,
  StyleType,
  DescribeModelVersion,

  // Color palette types
  ColorPalette,
  ColorPalettePreset,
  CustomColorPalette,

  // v2 (Ideogram 4.x / auto / SVG / video)
  OpenString,
  MagicPromptMode,
  RenderingSpeedV4,
  QualityV45,
  BackgroundV45,
  OutputResolutionTier,
  AutoResolutionTier,
  ImageSizeV46,
  AutoStyleType,
  V2ColorPalettePreset,
  V2ColorPalette,
  ImageInput,
  AudioInput,
  AssetType,
  AssetIdentifier,
  V2RequestOptions,
  V2CommonParams,
  V2DeliveryParams,
  GenerateV4Params,
  GenerateV4TransparentParams,
  GenerateV4CustomParams,
  GenerateV45Params,
  GenerateV46Params,
  GenerateAutoParams,
  PreciseEditV45Params,
  PreciseEditV46Params,
  SvgQuality,
  GenerateSvgParams,
  MinimaxH3AspectRatio,
  MinimaxH3Resolution,
  MinimaxH3PromptExpansionMode,
  Seedance25AspectRatio,
  Seedance25Resolution,
  VideoBaseParams,
  MinimaxH3TextToVideoParams,
  MinimaxH3ImageToVideoParams,
  MinimaxH3ReferenceToVideoParams,
  Seedance25TextToVideoParams,
  Seedance25ImageToVideoParams,
  Seedance25ReferenceToVideoParams,
  V2Acknowledgement,
  GenerationKind,
  GeneratedImage,
  V2GenerationResponse,
  PriceQuote,
  GenerationStatusValue,
  GenerationDataItem,
  VideoGenerationItem,
  SvgGenerationItem,
  GenerationStatus,
  WaitForGenerationOptions,
  GenerationRejectReason,
  V2OperationKey,

  // Validation types
  ValidationResult,
  ValidationParams,
  OperationConstraint,
  OperationConstraints,
  OperationKey,
} from './types/index.js';
