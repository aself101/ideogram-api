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
import type { GenerateV4Params, GenerateV4TransparentParams, GenerateV4CustomParams, GenerateV45Params, GenerateV46Params, GenerateAutoParams, PreciseEditV45Params, PreciseEditV46Params, GenerateSvgParams, MinimaxH3TextToVideoParams, MinimaxH3ImageToVideoParams, MinimaxH3ReferenceToVideoParams, Seedance25TextToVideoParams, Seedance25ImageToVideoParams, Seedance25ReferenceToVideoParams, V2Acknowledgement, UpscaledImage, V2GenerationResponse, PriceQuote, GenerationStatus, GenerationDataItem, WaitForGenerationOptions, GeneratedImage, GenerateParams, EditParams, RemixParams, ReframeParams, ReplaceBackgroundParams, UpscaleParams, UpscaleResponse, DescribeParams, GenerationResponse, DescribeResponse, ImageData } from './types/index.js';
/**
 * Said once for a failed request that may have run and been charged. Messages
 * that carry it end with it exactly, so the CLI can tell it was already said.
 */
export declare const BILLING_NOTE = "The request may have run and been billed. Check your usage before retrying.";
/**
 * Error thrown for a failed Ideogram API request.
 * Extends Error, so existing `catch (e) { e.message }` code keeps working.
 */
export declare class IdeogramAPIError extends Error {
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
     * 'EDRYRUNIGNORED' (and a network code from a failed body read) when a
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
     * `generationId` can still succeed: a network or timeout failure with no
     * response, a 5xx, the wait deadline, an onPoll callback that threw, and
     * 401/403 (after fixing the API key). False (the default) for a generation
     * that finished as failed, and for a 4xx the API will repeat (404, 400, ...).
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
    constructor(message: string, details?: {
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
    });
}
/**
 * Ideogram API wrapper class.
 * Supports all Ideogram generation and manipulation operations.
 */
export declare class IdeogramAPI {
    private apiKey;
    private baseUrl;
    private logger;
    /**
     * Create a new Ideogram API client.
     *
     * @param apiKey - Ideogram API key
     * @param baseUrl - Base API URL (default: https://api.ideogram.ai)
     * @param logLevel - Logging level (debug, info, warn, error). Defaults to the
     *   module logger's level: 'warn', or whatever `setLogLevel` from
     *   `ideogram-api/utils` last set. Logs go to stderr.
     * @throws Error if API key is not provided or base URL is not HTTPS
     *
     * @example
     * const api = new IdeogramAPI('your_api_key');
     * const api = new IdeogramAPI('your_api_key', 'https://api.ideogram.ai', 'debug');
     */
    constructor(apiKey: string, baseUrl?: string, logLevel?: string);
    /**
     * Verify API key is set.
     * @throws Error if API key is missing
     */
    private _verifyApiKey;
    /**
     * Make a multipart POST to a v1 endpoint. Kept for the v3 methods.
     *
     * @param endpoint - API endpoint path
     * @param formData - FormData object with request parameters
     * @returns API response
     * @throws IdeogramAPIError if request fails
     */
    private _makeRequest;
    /**
     * Make an HTTP request to the Ideogram API (JSON, multipart, or GET).
     * Handles size limits, response Content-Type validation and error mapping.
     */
    private _request;
    /** Load a path-or-Buffer image input. */
    private _loadImage;
    /** Load a list of path-or-Buffer image inputs; an empty list loads as undefined. */
    private _loadImages;
    /** Load a list of path-or-Buffer MP3/WAV inputs; an empty list loads as undefined. */
    private _loadAudios;
    /** Query string for a v2 call. */
    private _v2Query;
    /** Log the outcome of a v2 call without assuming its shape. */
    private _logV2Result;
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
    generate(params: GenerateParams): Promise<GenerationResponse>;
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
    edit(params: EditParams): Promise<GenerationResponse>;
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
    remix(params: RemixParams): Promise<GenerationResponse>;
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
    reframe(params: ReframeParams): Promise<GenerationResponse>;
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
    replaceBackground(params: ReplaceBackgroundParams): Promise<GenerationResponse>;
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
    upscale(params: UpscaleParams & {
        dryRun: true;
    }): Promise<PriceQuote>;
    upscale(params: UpscaleParams & {
        dryRun?: false;
    }): Promise<UpscaleResponse>;
    upscale(params: UpscaleParams): Promise<UpscaleResponse | PriceQuote>;
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
    describe(params: DescribeParams): Promise<DescribeResponse>;
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
    generateV4(params: GenerateV4Params & {
        dryRun: true;
    }): Promise<PriceQuote>;
    generateV4(params: GenerateV4Params & {
        dryRun?: false;
    }): Promise<V2GenerationResponse>;
    generateV4(params: GenerateV4Params): Promise<V2GenerationResponse | PriceQuote>;
    /**
     * Generate images on a transparent background with Ideogram 4.0 (PNG with alpha).
     *
     * @example
     * const res = await api.generateV4Transparent({ prompt: 'A cartoon fox mascot', outputResolution: '2k' });
     */
    generateV4Transparent(params: GenerateV4TransparentParams & {
        dryRun: true;
    }): Promise<PriceQuote>;
    generateV4Transparent(params: GenerateV4TransparentParams & {
        dryRun?: false;
    }): Promise<V2GenerationResponse>;
    generateV4Transparent(params: GenerateV4TransparentParams): Promise<V2GenerationResponse | PriceQuote>;
    /**
     * Generate images with a custom Ideogram 4.0 model.
     *
     * @example
     * const res = await api.generateV4Custom({
     *   prompt: 'Product shot',
     *   customModelUri: 'model/my-model/version/1',
     * });
     */
    generateV4Custom(params: GenerateV4CustomParams & {
        dryRun: true;
    }): Promise<PriceQuote>;
    generateV4Custom(params: GenerateV4CustomParams & {
        dryRun?: false;
    }): Promise<V2GenerationResponse>;
    generateV4Custom(params: GenerateV4CustomParams): Promise<V2GenerationResponse | PriceQuote>;
    /** Shared body of the 4.5 and 4.6 generate methods (identical fields, different endpoints). */
    private _generateV4x;
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
    generateV45(params: GenerateV45Params & {
        dryRun: true;
    }): Promise<PriceQuote>;
    generateV45(params: GenerateV45Params & {
        dryRun?: false;
    }): Promise<V2GenerationResponse>;
    generateV45(params: GenerateV45Params): Promise<V2GenerationResponse | PriceQuote>;
    /**
     * Generate with Ideogram 4.6, or edit source images with a prompt (multipart).
     * Same fields as generateV45. 4.6 renders up to 4096x4096, adds the
     * 'auto_2k' / 'auto_4k' sizes, and runs 'very_low' quality without source images.
     *
     * @example
     * const res = await api.generateV46({ prompt: 'A poster that says OPEN LATE', size: 'auto_4k' });
     */
    generateV46(params: GenerateV46Params & {
        dryRun: true;
    }): Promise<PriceQuote>;
    generateV46(params: GenerateV46Params & {
        dryRun?: false;
    }): Promise<V2GenerationResponse>;
    generateV46(params: GenerateV46Params): Promise<V2GenerationResponse | PriceQuote>;
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
    generateAuto(params: GenerateAutoParams & {
        dryRun: true;
    }): Promise<PriceQuote>;
    generateAuto(params: GenerateAutoParams & {
        dryRun?: false;
    }): Promise<V2GenerationResponse>;
    generateAuto(params: GenerateAutoParams): Promise<V2GenerationResponse | PriceQuote>;
    /** Shared body of the 4.5 and 4.6 precise-edit methods (identical fields, different endpoints). */
    private _preciseEditV4x;
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
    preciseEditV45(params: PreciseEditV45Params & {
        dryRun: true;
    }): Promise<PriceQuote>;
    preciseEditV45(params: PreciseEditV45Params & {
        dryRun?: false;
    }): Promise<V2GenerationResponse>;
    preciseEditV45(params: PreciseEditV45Params): Promise<V2GenerationResponse | PriceQuote>;
    /**
     * Precise edit with Ideogram 4.6. Same fields as preciseEditV45; the whole-
     * image bound is 4096x4096 pixels (2048x2048 at 'very_low'), and an image
     * over 2048x2048 bills at the 4K price except at 'very_low'.
     *
     * @example
     * const res = await api.preciseEditV46({ prompt: 'Add a red scarf.', image: './photo_4k.png' });
     */
    preciseEditV46(params: PreciseEditV46Params & {
        dryRun: true;
    }): Promise<PriceQuote>;
    preciseEditV46(params: PreciseEditV46Params & {
        dryRun?: false;
    }): Promise<V2GenerationResponse>;
    preciseEditV46(params: PreciseEditV46Params): Promise<V2GenerationResponse | PriceQuote>;
    /** POST to an always-async endpoint and log the acknowledgement or quote. */
    private _submitAsync;
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
    generateSvg(params: GenerateSvgParams & {
        dryRun: true;
    }): Promise<PriceQuote>;
    generateSvg(params: GenerateSvgParams & {
        dryRun?: false;
    }): Promise<V2Acknowledgement>;
    generateSvg(params: GenerateSvgParams): Promise<V2Acknowledgement | PriceQuote>;
    /**
     * Text to video with MiniMax H3 (JSON). Resolves to a `generation_id`;
     * retrieve the video with waitForGeneration, then extractVideoUrls.
     *
     * @example
     * const ack = await api.minimaxH3TextToVideo({ prompt: 'A red fox in snow', duration: 5, resolution: '768P' });
     */
    minimaxH3TextToVideo(params: MinimaxH3TextToVideoParams & {
        dryRun: true;
    }): Promise<PriceQuote>;
    minimaxH3TextToVideo(params: MinimaxH3TextToVideoParams & {
        dryRun?: false;
    }): Promise<V2Acknowledgement>;
    minimaxH3TextToVideo(params: MinimaxH3TextToVideoParams): Promise<V2Acknowledgement | PriceQuote>;
    /**
     * Image to video with MiniMax H3 (multipart): animate `image` as the first
     * frame, optionally ending on `endImage`.
     *
     * @example
     * const ack = await api.minimaxH3ImageToVideo({ prompt: 'The camera pans right', image: './beach.png' });
     */
    minimaxH3ImageToVideo(params: MinimaxH3ImageToVideoParams & {
        dryRun: true;
    }): Promise<PriceQuote>;
    minimaxH3ImageToVideo(params: MinimaxH3ImageToVideoParams & {
        dryRun?: false;
    }): Promise<V2Acknowledgement>;
    minimaxH3ImageToVideo(params: MinimaxH3ImageToVideoParams): Promise<V2Acknowledgement | PriceQuote>;
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
    minimaxH3ReferenceToVideo(params: MinimaxH3ReferenceToVideoParams & {
        dryRun: true;
    }): Promise<PriceQuote>;
    minimaxH3ReferenceToVideo(params: MinimaxH3ReferenceToVideoParams & {
        dryRun?: false;
    }): Promise<V2Acknowledgement>;
    minimaxH3ReferenceToVideo(params: MinimaxH3ReferenceToVideoParams): Promise<V2Acknowledgement | PriceQuote>;
    /**
     * Text to video with Seedance 2.5 (JSON), up to 1080p and 30 seconds.
     * `generateAudio` roughly doubles the cost; price it first with `dryRun`.
     *
     * @example
     * const quote = await api.seedance25TextToVideo({ prompt: 'A red fox in snow', resolution: '1080p', dryRun: true });
     */
    seedance25TextToVideo(params: Seedance25TextToVideoParams & {
        dryRun: true;
    }): Promise<PriceQuote>;
    seedance25TextToVideo(params: Seedance25TextToVideoParams & {
        dryRun?: false;
    }): Promise<V2Acknowledgement>;
    seedance25TextToVideo(params: Seedance25TextToVideoParams): Promise<V2Acknowledgement | PriceQuote>;
    /**
     * Image to video with Seedance 2.5 (multipart): animate `image` as the first
     * frame, optionally ending on `endImage`.
     *
     * @example
     * const ack = await api.seedance25ImageToVideo({ prompt: 'Waves roll in', image: './beach.png' });
     */
    seedance25ImageToVideo(params: Seedance25ImageToVideoParams & {
        dryRun: true;
    }): Promise<PriceQuote>;
    seedance25ImageToVideo(params: Seedance25ImageToVideoParams & {
        dryRun?: false;
    }): Promise<V2Acknowledgement>;
    seedance25ImageToVideo(params: Seedance25ImageToVideoParams): Promise<V2Acknowledgement | PriceQuote>;
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
    seedance25ReferenceToVideo(params: Seedance25ReferenceToVideoParams & {
        dryRun: true;
    }): Promise<PriceQuote>;
    seedance25ReferenceToVideo(params: Seedance25ReferenceToVideoParams & {
        dryRun?: false;
    }): Promise<V2Acknowledgement>;
    seedance25ReferenceToVideo(params: Seedance25ReferenceToVideoParams): Promise<V2Acknowledgement | PriceQuote>;
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
    getGeneration(generationId: string, options?: {
        timeoutMs?: number;
    }): Promise<GenerationStatus>;
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
    waitForGeneration(generationId: string, options?: WaitForGenerationOptions): Promise<GenerationStatus>;
    /**
     * Set the log level of THIS client instance only (the logger that reports
     * request failures and polling). It does not touch the module logger that
     * `setLogLevel` from `ideogram-api/utils` controls (file loading, DNS and
     * download checks); that one only sets the default for instances created later.
     *
     * @param level - Log level (debug, info, warn, error)
     *
     * @example
     * api.setLogLevel('debug');
     */
    setLogLevel(level: string): void;
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
export declare function extractImages(response: GenerationResponse): ImageData[];
export declare function extractImages(response: V2GenerationResponse): GeneratedImage[];
export declare function extractImages(response: GenerationStatus): GenerationDataItem[];
export declare function extractImages(response: UpscaleResponse): UpscaledImage[];
export declare function extractImages(response: GenerationResponse | V2GenerationResponse | GenerationStatus | UpscaleResponse): unknown[];
/**
 * Collect the downloadable URLs from any generation response.
 * Skips images that failed safety checks (their `url` is empty) and
 * non-image items from a polled generation.
 *
 * @example
 * const urls = extractImageUrls(await api.generateV4({ prompt: 'a cat' }));
 */
export declare function extractImageUrls(response: GenerationResponse | V2GenerationResponse | GenerationStatus | UpscaleResponse): string[];
/**
 * Collect the video URLs from a completed generation (object_type
 * 'video.generation'). Video endpoints are always asynchronous, so this takes
 * the GenerationStatus from getGeneration / waitForGeneration.
 *
 * @example
 * const ack = await api.seedance25TextToVideo({ prompt: 'a fox in snow' });
 * const urls = extractVideoUrls(await api.waitForGeneration(ack.generation_id));
 */
export declare function extractVideoUrls(response: GenerationStatus): string[];
/**
 * Collect the SVG URLs from a completed generation (object_type 'svg.generation').
 *
 * @example
 * const ack = await api.generateSvg({ prompt: 'a fox logo' });
 * const urls = extractSvgUrls(await api.waitForGeneration(ack.generation_id));
 */
export declare function extractSvgUrls(response: GenerationStatus): string[];
/**
 * Type guard: true when a v2 call returned a dry-run PriceQuote.
 *
 * @example
 * const res = await api.generateV45({ prompt, dryRun });
 * if (isPriceQuote(res)) console.log(res.usd_micros / 1e6);
 */
export declare function isPriceQuote(value: unknown): value is PriceQuote;
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
export declare function extractDescriptions(response: DescribeResponse): string[];
export default IdeogramAPI;
export type { GenerateParams, EditParams, RemixParams, ReframeParams, ReplaceBackgroundParams, UpscaleParams, UpscaleFactor, UpscaleResponse, UpscaledImage, DescribeParams, BaseGenerationParams, GenerationResponse, DescribeResponse, ImageData, Description, RenderingSpeed, MagicPromptOption, StyleType, DescribeModelVersion, ColorPalette, ColorPalettePreset, CustomColorPalette, OpenString, MagicPromptMode, RenderingSpeedV4, QualityV45, BackgroundV45, OutputResolutionTier, AutoResolutionTier, ImageSizeV46, AutoStyleType, V2ColorPalettePreset, V2ColorPalette, ImageInput, AudioInput, AssetType, AssetIdentifier, V2RequestOptions, V2CommonParams, V2DeliveryParams, GenerateV4Params, GenerateV4TransparentParams, GenerateV4CustomParams, GenerateV45Params, GenerateV46Params, GenerateAutoParams, PreciseEditV45Params, PreciseEditV46Params, SvgQuality, GenerateSvgParams, MinimaxH3AspectRatio, MinimaxH3Resolution, MinimaxH3PromptExpansionMode, Seedance25AspectRatio, Seedance25Resolution, VideoBaseParams, MinimaxH3TextToVideoParams, MinimaxH3ImageToVideoParams, MinimaxH3ReferenceToVideoParams, Seedance25TextToVideoParams, Seedance25ImageToVideoParams, Seedance25ReferenceToVideoParams, V2Acknowledgement, GenerationKind, GeneratedImage, V2GenerationResponse, PriceQuote, GenerationStatusValue, GenerationDataItem, VideoGenerationItem, SvgGenerationItem, GenerationStatus, WaitForGenerationOptions, GenerationRejectReason, V2OperationKey, ValidationResult, ValidationParams, OperationConstraint, OperationConstraints, OperationKey, } from './types/index.js';
//# sourceMappingURL=api.d.ts.map