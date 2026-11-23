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
 * Every v2 method accepts `dryRun: true`, which prices the request without
 * running or billing it and resolves to a PriceQuote.
 *
 * The v3 operations and the v2 image default (`async` unset) are synchronous.
 */
import winston from 'winston';
import { formDataSize, readBodyWithLimit, describeNetworkError, describeValue, assertTimerMs, ResponseTooLargeError, } from './http.js';
import { BASE_URL, ENDPOINTS, redactApiKey } from './config.js';
import { buildFormData, loadImageAsBuffer, loadAudioAsBuffer, assertSquareImage } from './utils.js';
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
};
/** Bytes of an unparseable response body kept on the error. */
const BODY_EXCERPT_BYTES = 500;
/** Normalize a v2 color palette: a bare preset name becomes `{ name }`. */
function toPaletteObject(palette) {
    if (palette === undefined)
        return undefined;
    return typeof palette === 'string' ? { name: palette } : palette;
}
/**
 * Error thrown for a failed Ideogram API request.
 * Extends Error, so existing `catch (e) { e.message }` code keeps working.
 */
export class IdeogramAPIError extends Error {
    /** HTTP status, when the API answered. */
    status;
    /** v2 402/429: the account or usage limit that rejected the request. */
    rejectReason;
    /** v2 402/429 with reject_reason 'inflight_limit'. */
    maxInflightRequests;
    /** Polling: why an async generation failed (e.g. 'content_policy_violation'). */
    failureReason;
    /** Parsed response body, when there was one. */
    body;
    /**
     * No HTTP response: the network error code (e.g. 'ECONNRESET', 'ETIMEDOUT'
     * for a timeout). The request may still have run server-side.
     */
    code;
    /**
     * True when the request was sent and its outcome is unknown or server-side
     * failed: no response, a response body that could not be read or parsed, an
     * over-size body, or a 5xx. The generation may have run and been billed, so
     * check usage (or the generation id) before retrying. False for 4xx
     * validation, auth and rate-limit answers, for anything thrown before the
     * request was sent, and for failed status polls (a GET is never billed).
     * Also true for any error from waitForGeneration, because the generation was
     * already submitted (and billed): resume with getGeneration or
     * waitForGeneration using `generationId`, never resubmit.
     */
    possiblyBilled;
    /** Polling: the generation being waited on, so a failed wait can be resumed. */
    generationId;
    /**
     * Code 'EDRYRUNIGNORED': the parsed response the API returned instead of a
     * price quote, so a caller can still save or list what was billed.
     */
    result;
    constructor(message, details = {}) {
        super(message, details.cause !== undefined ? { cause: details.cause } : undefined);
        this.code = details.code;
        this.possiblyBilled = details.possiblyBilled ?? false;
        this.generationId = details.generationId;
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
function errorMessageFrom(data, fallback) {
    if (!data || typeof data !== 'object')
        return fallback;
    if (typeof data.error === 'string' && data.error)
        return data.error;
    if (data.detail !== undefined && data.detail !== null) {
        return typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail);
    }
    if (typeof data.message === 'string' && data.message)
        return data.message;
    if (typeof data.title === 'string' && data.title)
        return data.title;
    return fallback;
}
/** Copy only the defined entries of an object (v2 bodies omit unset fields so API defaults apply). */
function definedOnly(obj) {
    return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== null));
}
/**
 * Ideogram API wrapper class.
 * Supports all Ideogram generation and manipulation operations.
 */
export class IdeogramAPI {
    apiKey;
    baseUrl;
    logger;
    /**
     * Create a new Ideogram API client.
     *
     * @param apiKey - Ideogram API key
     * @param baseUrl - Base API URL (default: https://api.ideogram.ai)
     * @param logLevel - Logging level (debug, info, warn, error)
     * @throws Error if API key is not provided or base URL is not HTTPS
     *
     * @example
     * const api = new IdeogramAPI('your_api_key');
     * const api = new IdeogramAPI('your_api_key', 'https://api.ideogram.ai', 'debug');
     */
    constructor(apiKey, baseUrl = BASE_URL, logLevel = 'info') {
        if (!apiKey) {
            throw new Error('API key is required: pass it as the first argument, new IdeogramAPI(apiKey), e.g. new IdeogramAPI(process.env.IDEOGRAM_API_KEY)');
        }
        // HTTPS enforcement for security
        if (!baseUrl.startsWith('https://')) {
            throw new Error('Base URL must use HTTPS protocol for security');
        }
        this.apiKey = apiKey;
        this.baseUrl = baseUrl;
        // Configure logger
        this.logger = winston.createLogger({
            level: logLevel,
            format: winston.format.combine(winston.format.timestamp(), winston.format.printf(({ timestamp, level, message }) => {
                return `${timestamp} - ${level.toUpperCase()} - ${message}`;
            })),
            transports: [new winston.transports.Console()],
        });
        // Only log API key in debug mode to minimize exposure
        if (logLevel === 'debug') {
            this.logger.debug(`Ideogram API initialized (API key: ${redactApiKey(apiKey)})`);
        }
        else {
            this.logger.info('Ideogram API initialized');
        }
    }
    /**
     * Verify API key is set.
     * @throws Error if API key is missing
     */
    _verifyApiKey() {
        if (!this.apiKey) {
            throw new Error('API key not set. Initialize IdeogramAPI with your API key: new IdeogramAPI(process.env.IDEOGRAM_API_KEY).');
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
    async _makeRequest(endpoint, formData) {
        return this._request({
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
    async _request(opts) {
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
        const headers = { 'Api-Key': this.apiKey };
        let body;
        let bodyBytes = 0;
        if (opts.form) {
            body = opts.form; // fetch sets the multipart Content-Type and boundary
            bodyBytes = formDataSize(opts.form);
        }
        else if (opts.json) {
            headers['Content-Type'] = 'application/json';
            body = JSON.stringify(opts.json);
            bodyBytes = Buffer.byteLength(body);
        }
        if (bodyBytes > opts.maxBodyBytes) {
            throw new Error(`Request payload too large: ${(bodyBytes / MB).toFixed(2)}MB exceeds maximum of ${(opts.maxBodyBytes / MB).toFixed(0)}MB`);
        }
        // A failed status poll (GET) costs nothing; anything else that was sent may have been billed.
        const billable = opts.method !== 'GET';
        const billedNote = billable ? ' A generation may still have run and been billed. Check before retrying.' : '';
        let response;
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
        }
        catch (error) {
            // No HTTP response. Node reports most of these as "fetch failed" with
            // the reason on `cause` (two live runs on 2026-11-22 surfaced only a bare
            // "Error"), so name the code and the billing uncertainty.
            const { message, code } = describeNetworkError(error, opts.timeoutMs);
            this.logger.error(`Request failed${code ? ` (${code})` : ''}: ${message}. No HTTP response was received.${billedNote}`);
            if (process.env.NODE_ENV === 'production') {
                throw new IdeogramAPIError(billable
                    ? 'Request failed. The request may have run and been billed. Check your usage before retrying.'
                    : 'Request failed. Please check your connection and try again.', { code, possiblyBilled: billable, cause: error });
            }
            throw new IdeogramAPIError(`Request failed${code ? ` (${code})` : ''}: ${message}`, {
                code,
                possiblyBilled: billable,
                cause: error,
            });
        }
        let raw;
        try {
            raw = await readBodyWithLimit(response, 100 * MB);
        }
        catch (error) {
            if (error instanceof ResponseTooLargeError) {
                // The size cap fired after the response headers arrived: keep the HTTP
                // status, and say the request may have been billed like the other post-send paths.
                this.logger.error(`${error.message} (HTTP ${response.status}).${billedNote}`);
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
            this.logger.error(`Reading the response body failed (HTTP ${response.status})${code ? ` (${code})` : ''}: ${message}.${billedNote}`);
            throw new IdeogramAPIError(`Request failed while reading the response (HTTP ${response.status})${code ? ` (${code})` : ''}: ${message}`, { status: response.status, code, possiblyBilled: billable, cause: error });
        }
        const contentType = response.headers.get('content-type') ?? '';
        if (!response.ok) {
            const status = response.status;
            let data;
            try {
                data = JSON.parse(raw.toString('utf8'));
            }
            catch {
                // best effort: an error body that is not JSON; `raw` is kept as the body below
                data = undefined;
            }
            // Fallback text matches what 1.x printed for a body without a message, so those messages are unchanged.
            const message = errorMessageFrom(data, `Request failed with status code ${status}`);
            const rejectReason = typeof data?.reject_reason === 'string' ? data.reject_reason : undefined;
            const details = {
                status,
                rejectReason,
                maxInflightRequests: data?.max_inflight_requests,
                body: data ?? raw.toString('utf8'),
                // A 5xx may be a failure after the work started; a 4xx answer was decided before any work.
                possiblyBilled: billable && status >= 500,
            };
            this.logger.error(`API request failed (${status}): ${message}`);
            // Map HTTP status codes to user-friendly errors
            if (status === 400) {
                throw new IdeogramAPIError(`Invalid input: ${message}`, details);
            }
            else if (status === 401) {
                throw new IdeogramAPIError('Authentication failed. Check API key.', details);
            }
            else if (status === 402) {
                throw new IdeogramAPIError(`Payment required${rejectReason ? ` (${rejectReason})` : ''}: ${message}`, details);
            }
            else if (status === 403) {
                // Append the API's reason only when the body gave one (as 1.x did).
                const reason = errorMessageFrom(data, '');
                const suffix = reason ? ` ${reason}` : '';
                throw new IdeogramAPIError(`Not authorized to perform this operation.${suffix}`, details);
            }
            else if (status === 404) {
                throw new IdeogramAPIError(`Not found: ${message}`, details);
            }
            else if (status === 422) {
                throw new IdeogramAPIError(`Validation failed: ${message}`, details);
            }
            else if (status === 429) {
                const reason = rejectReason ? ` (${rejectReason})` : '';
                throw new IdeogramAPIError(`Rate limit exceeded. Too many requests.${reason}`, details);
            }
            // Sanitize error in production
            if (process.env.NODE_ENV === 'production') {
                throw new IdeogramAPIError(details.possiblyBilled
                    ? `Operation failed (HTTP ${status}). The request may have run and been billed. Check your usage before retrying.`
                    : `Operation failed (HTTP ${status}). Please try again.`, details);
            }
            throw new IdeogramAPIError(`API error (${status}): ${message}`, details);
        }
        // Validate Content-Type of response
        if (!contentType.includes('application/json')) {
            this.logger.warn(`Unexpected Content-Type in response: ${contentType || '(none)'}`);
            this.logger.error(`Invalid response format (HTTP ${response.status}).${billedNote}`);
            throw new IdeogramAPIError(`Invalid response format from API (HTTP ${response.status}, Content-Type: ${contentType || '(none)'})`, { status: response.status, body: raw.toString('utf8', 0, BODY_EXCERPT_BYTES), possiblyBilled: billable });
        }
        let parsed;
        try {
            parsed = JSON.parse(raw.toString('utf8'));
        }
        catch (error) {
            this.logger.error(`Invalid response format (HTTP ${response.status}): body is not valid JSON.${billedNote}`);
            throw new IdeogramAPIError(`Invalid response format from API: body is not valid JSON (HTTP ${response.status})`, {
                status: response.status,
                body: raw.toString('utf8', 0, BODY_EXCERPT_BYTES),
                possiblyBilled: billable,
                cause: error,
            });
        }
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
            const got = parsed === null ? 'null' : Array.isArray(parsed) ? 'array' : typeof parsed;
            this.logger.error(`Invalid response format (HTTP ${response.status}): expected a JSON object, got ${got}.${billedNote}`);
            throw new IdeogramAPIError(`Invalid response format from API: expected a JSON object, got ${got} (HTTP ${response.status})`, { status: response.status, body: parsed, possiblyBilled: billable });
        }
        // A dry run must answer with a price quote. If the API ran the request for
        // real, it was (probably) billed: fail loudly, keep the result on the error.
        if (opts.query?.dry_run === 'true' && !isPriceQuote(parsed)) {
            const generationId = parsed.generation_id;
            this.logger.error(`dry_run was requested but the API returned a real result (HTTP ${response.status}); it may have been billed.`);
            throw new IdeogramAPIError('dry_run was requested but the API returned a real result; it may have been billed. The result is attached as error.result.', {
                status: response.status,
                code: 'EDRYRUNIGNORED',
                possiblyBilled: true,
                generationId: typeof generationId === 'string' ? generationId : undefined,
                result: parsed,
            });
        }
        // Field-level shapes are trusted, not validated: the API's documented
        // response types are assumed, and only the top-level object check is made.
        return parsed;
    }
    /** Load a path-or-Buffer image input. */
    async _loadImage(input) {
        return Buffer.isBuffer(input) ? input : loadImageAsBuffer(input);
    }
    /** Load a list of path-or-Buffer image inputs; an empty list loads as undefined. */
    async _loadImages(inputs) {
        if (!inputs || inputs.length === 0)
            return undefined;
        return Promise.all(inputs.map((img) => this._loadImage(img)));
    }
    /** Load a list of path-or-Buffer MP3/WAV inputs; an empty list loads as undefined. */
    async _loadAudios(inputs) {
        if (!inputs || inputs.length === 0)
            return undefined;
        return Promise.all(inputs.map((a) => (Buffer.isBuffer(a) ? a : loadAudioAsBuffer(a))));
    }
    /** Query string for a v2 call. */
    _v2Query(dryRun) {
        return dryRun ? { dry_run: 'true' } : undefined;
    }
    /** Log the outcome of a v2 call without assuming its shape. */
    _logV2Result(label, result) {
        if (isPriceQuote(result)) {
            this.logger.info(`${label} dry run: ${result.quantity} x ${result.billing_identifier} = $${(result.usd_micros / 1e6).toFixed(4)} (${result.credit_millis / 1000} credits, ${result.qualifier})`);
        }
        else if ('data' in result && result.data) {
            this.logger.info(`${label}: ${result.data.length} image(s) (generation ${result.generation_id})`);
        }
        else {
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
    async generate(params) {
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
        const response = await this._makeRequest(ENDPOINTS.GENERATE_V3, formData);
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
    async edit(params) {
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
        const response = await this._makeRequest(ENDPOINTS.EDIT_V3, formData);
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
    async remix(params) {
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
        const response = await this._makeRequest(ENDPOINTS.REMIX_V3, formData);
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
    async reframe(params) {
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
        const response = await this._makeRequest(ENDPOINTS.REFRAME_V3, formData);
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
    async replaceBackground(params) {
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
        const response = await this._makeRequest(ENDPOINTS.REPLACE_BACKGROUND_V3, formData);
        this.logger.info(`Replaced background successfully (${response.data?.length || 0} results)`);
        return response;
    }
    async upscale(params) {
        const retired = ['prompt', 'resemblance', 'detail', 'magicPromptOption', 'numImages'].filter((key) => key in params && Reflect.get(params, key) !== undefined);
        if (retired.length > 0) {
            throw new Error(`upscale() uses Ideogram's v2 upscaler since 2.0 (the v1 upscale model was retired) and does not accept ${retired.join(', ')}. ` +
                "Use upscaleFactor ('x2', 'x4' or 'x8') and seed.");
        }
        if (params.image === undefined || params.image === null) {
            throw new Error(`image is required: pass a file path or a Buffer as \`image\` (got ${describeValue(params.image)})`);
        }
        this.logger.info(`Upscaling image ${params.upscaleFactor ?? 'x2'}`);
        const formData = buildFormData({
            image: await this._loadImage(params.image),
            upscale_factor: params.upscaleFactor,
            seed: params.seed,
            async: params.async,
            webhook_url: params.webhookUrl,
        });
        const result = await this._request({
            method: 'POST',
            endpoint: ENDPOINTS.UPSCALE_AUTO,
            query: this._v2Query(params.dryRun),
            form: formData,
            timeoutMs: params.timeoutMs ?? V2_TIMEOUT_MS,
            maxBodyBytes: BODY_LIMITS.upscale,
        });
        if (!isPriceQuote(result) && result.data) {
            this.logger.info(`Upscaled to ${result.width}x${result.height}`);
        }
        else {
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
    async describe(params) {
        this.logger.info('Describing image');
        // Load image
        const imageBuffer = Buffer.isBuffer(params.image)
            ? params.image
            : await loadImageAsBuffer(params.image);
        const formData = buildFormData({
            image_file: imageBuffer,
            describe_model_version: params.describeModelVersion,
        });
        const response = await this._makeRequest(ENDPOINTS.DESCRIBE, formData);
        this.logger.info(`Described image successfully (${response.descriptions?.length || 0} descriptions)`);
        return response;
    }
    async generateV4(params) {
        this.logger.info('Generating images with Ideogram 4.0');
        this.logger.debug(`Prompt: "${params.prompt}"`);
        const result = await this._request({
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
    async generateV4Transparent(params) {
        this.logger.info('Generating transparent images with Ideogram 4.0');
        this.logger.debug(`Prompt: "${params.prompt}"`);
        const result = await this._request({
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
    async generateV4Custom(params) {
        if (!params.customModelUri) {
            throw new Error("customModelUri is required: pass the model as `customModelUri`, in the form 'model/<model_name>/version/<version_name>'");
        }
        this.logger.info(`Generating images with custom model ${params.customModelUri}`);
        this.logger.debug(`Prompt: "${params.prompt}"`);
        const result = await this._request({
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
    async _generateV4x(label, endpoint, params) {
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
        const result = await this._request({
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
    async generateV45(params) {
        return this._generateV4x('Ideogram 4.5', ENDPOINTS.GENERATE_V45, params);
    }
    async generateV46(params) {
        return this._generateV4x('Ideogram 4.6', ENDPOINTS.GENERATE_V46, params);
    }
    async generateAuto(params) {
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
        const result = await this._request({
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
    async _preciseEditV4x(label, endpoint, params) {
        if (params.image === undefined || params.image === null) {
            throw new Error(`image is required: pass a file path or a Buffer as \`image\` (got ${describeValue(params.image)})`);
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
        const result = await this._request({
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
    async preciseEditV45(params) {
        return this._preciseEditV4x('Ideogram 4.5', ENDPOINTS.PRECISE_EDIT_V45, params);
    }
    async preciseEditV46(params) {
        return this._preciseEditV4x('Ideogram 4.6', ENDPOINTS.PRECISE_EDIT_V46, params);
    }
    // ==================== v2: always-asynchronous (SVG, video) ====================
    /** POST to an always-async endpoint and log the acknowledgement or quote. */
    async _submitAsync(label, opts) {
        const result = await this._request({
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
    async generateSvg(params) {
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
    async minimaxH3TextToVideo(params) {
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
    async minimaxH3ImageToVideo(params) {
        if (params.image === undefined || params.image === null) {
            throw new Error(`image (the first frame) is required: pass a file path or a Buffer as \`image\` (got ${describeValue(params.image)})`);
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
    async minimaxH3ReferenceToVideo(params) {
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
    async seedance25TextToVideo(params) {
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
    async seedance25ImageToVideo(params) {
        if (params.image === undefined || params.image === null) {
            throw new Error(`image (the first frame) is required: pass a file path or a Buffer as \`image\` (got ${describeValue(params.image)})`);
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
    async seedance25ReferenceToVideo(params) {
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
    async getGeneration(generationId, options = {}) {
        if (!generationId || typeof generationId !== 'string') {
            throw new Error(`generationId is required: pass the generation_id string from a v2 response (got ${describeValue(generationId)})`);
        }
        const timeoutMs = options.timeoutMs ?? V1_TIMEOUT_MS;
        assertTimerMs('timeoutMs', timeoutMs);
        return this._request({
            method: 'GET',
            endpoint: `${ENDPOINTS.GENERATIONS}/${encodeURIComponent(generationId)}`,
            timeoutMs,
            maxBodyBytes: BODY_LIMITS.json,
        });
    }
    /**
     * Poll a generation until it completes or fails.
     * A 429 while polling backs off (doubling the interval, at least 1s and up to 30s, and never
     * shorter than the interval in use) and keeps polling.
     *
     * @param generationId - The generation_id returned by a v2 request
     * @param options - Poll interval, overall timeout, per-poll callback
     * @returns The completed GenerationStatus (with `data`)
     * @throws Error if `intervalMs` or `timeoutMs` is not an integer from 1 to 2147483647
     * @throws IdeogramAPIError with `failureReason` if the generation failed,
     *   or on timeout (the generation keeps running server-side)
     *
     * @example
     * const ack = await api.generateV45({ prompt: '...', async: true });
     * const done = await api.waitForGeneration(ack.generation_id);
     */
    async waitForGeneration(generationId, options = {}) {
        const baseInterval = options.intervalMs ?? 2000;
        const timeoutMs = options.timeoutMs ?? 600000;
        assertTimerMs('intervalMs', baseInterval);
        assertTimerMs('timeoutMs', timeoutMs);
        const deadline = Date.now() + timeoutMs;
        let interval = baseInterval;
        for (;;) {
            let status;
            try {
                // Never let one poll outlive the overall deadline.
                const pollTimeout = Math.max(1, Math.min(V1_TIMEOUT_MS, deadline - Date.now()));
                status = await this.getGeneration(generationId, { timeoutMs: pollTimeout });
                interval = baseInterval;
            }
            catch (error) {
                if (error instanceof IdeogramAPIError && error.status === 429) {
                    // Double (at least 1s, at most 30s), but never poll sooner than the
                    // current interval: a base interval above 30s must not be shortened.
                    interval = Math.max(interval, Math.min(Math.max(interval * 2, 1000), 30000));
                    this.logger.warn(`Rate limited while polling ${generationId}; retrying in ${interval}ms`);
                }
                else if (error instanceof IdeogramAPIError && error.code === 'ETIMEDOUT' && Date.now() >= deadline) {
                    // The capped last poll ran into the overall deadline: that is the wait timing out.
                    throw new IdeogramAPIError(`Timed out after ${timeoutMs}ms waiting for generation ${generationId} (it may still complete; poll getGeneration later)`, { generationId, possiblyBilled: true, cause: error });
                }
                else if (error instanceof IdeogramAPIError) {
                    // Name the generation: it keeps running server-side and can be resumed.
                    throw new IdeogramAPIError(`${error.message} (while polling generation ${generationId}; it may still complete, poll getGeneration later)`, {
                        status: error.status,
                        rejectReason: error.rejectReason,
                        maxInflightRequests: error.maxInflightRequests,
                        failureReason: error.failureReason,
                        body: error.body,
                        code: error.code,
                        // The generation was already submitted and billed: never resubmit.
                        possiblyBilled: true,
                        generationId,
                        cause: error,
                    });
                }
                else {
                    throw error;
                }
            }
            if (status) {
                options.onPoll?.(status);
                if (status.status === 'completed') {
                    return status;
                }
                if (status.status === 'failed') {
                    throw new IdeogramAPIError(`Generation ${generationId} failed${status.failure_reason ? `: ${status.failure_reason}` : ''}`, { failureReason: status.failure_reason, body: status, generationId, possiblyBilled: true });
                }
            }
            if (Date.now() + interval > deadline) {
                throw new IdeogramAPIError(`Timed out after ${timeoutMs}ms waiting for generation ${generationId} (it may still complete; poll getGeneration later)`, { generationId, possiblyBilled: true });
            }
            await new Promise((resolve) => setTimeout(resolve, interval));
        }
    }
    /**
     * Set logger level.
     *
     * @param level - Log level (debug, info, warn, error)
     *
     * @example
     * api.setLogLevel('debug');
     */
    setLogLevel(level) {
        this.logger.level = level.toLowerCase();
    }
}
export function extractImages(response) {
    return (response && response.data) || [];
}
/**
 * Collect the downloadable URLs from any generation response.
 * Skips images that failed safety checks (their `url` is empty) and
 * non-image items from a polled generation.
 *
 * @example
 * const urls = extractImageUrls(await api.generateV4({ prompt: 'a cat' }));
 */
export function extractImageUrls(response) {
    const items = (response && response.data) || [];
    return items
        .filter((item) => item.is_image_safe !== false)
        .filter((item) => !item.object_type || item.object_type.startsWith('image'))
        .map((item) => item.url)
        .filter((url) => typeof url === 'string' && url.length > 0);
}
/** URLs of the polled result items with the given object_type. */
function urlsOfType(response, objectType) {
    return ((response && response.data) || [])
        .filter((item) => item.object_type === objectType)
        .map((item) => item.url)
        .filter((url) => typeof url === 'string' && url.length > 0);
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
export function extractVideoUrls(response) {
    return urlsOfType(response, 'video.generation');
}
/**
 * Collect the SVG URLs from a completed generation (object_type 'svg.generation').
 *
 * @example
 * const ack = await api.generateSvg({ prompt: 'a fox logo' });
 * const urls = extractSvgUrls(await api.waitForGeneration(ack.generation_id));
 */
export function extractSvgUrls(response) {
    return urlsOfType(response, 'svg.generation');
}
/**
 * Type guard: true when a v2 call returned a dry-run PriceQuote.
 *
 * @example
 * const res = await api.generateV45({ prompt, dryRun });
 * if (isPriceQuote(res)) console.log(res.usd_micros / 1e6);
 */
export function isPriceQuote(value) {
    return (typeof value === 'object' &&
        value !== null &&
        value.object === 'price_quote');
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
export function extractDescriptions(response) {
    return (response.descriptions || []).map((d) => d.text);
}
export default IdeogramAPI;
//# sourceMappingURL=api.js.map