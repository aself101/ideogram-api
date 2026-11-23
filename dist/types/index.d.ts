/**
 * Ideogram API Type Definitions
 *
 * Comprehensive TypeScript types for the Ideogram API wrapper.
 */
/**
 * Valid rendering speed options.
 */
export type RenderingSpeed = 'FLASH' | 'TURBO' | 'DEFAULT' | 'QUALITY';
/**
 * Valid magic prompt options.
 */
export type MagicPromptOption = 'AUTO' | 'ON' | 'OFF';
/**
 * Valid style types.
 */
export type StyleType = 'AUTO' | 'GENERAL' | 'REALISTIC' | 'DESIGN' | 'FICTION';
/**
 * Valid describe model versions.
 */
export type DescribeModelVersion = 'V_2' | 'V_3';
/**
 * Color palette preset names.
 */
export type ColorPalettePreset = 'EMBER' | 'FRESH' | 'JUNGLE' | 'MAGIC' | 'MELON' | 'MOSAIC' | 'PASTEL' | 'ULTRAMARINE';
/**
 * Custom color palette with hex colors.
 */
export interface CustomColorPalette {
    members: Array<{
        color_hex: string;
        color_weight?: number;
    }>;
}
/**
 * Color palette can be a preset name or custom palette.
 */
export type ColorPalette = ColorPalettePreset | CustomColorPalette;
/**
 * Base parameters common to most generation methods.
 */
export interface BaseGenerationParams {
    /** Random seed for reproducibility */
    seed?: number;
    /** Number of images to generate (1-8) */
    numImages?: number;
    /** Rendering speed (FLASH, TURBO, DEFAULT, QUALITY) */
    renderingSpeed?: RenderingSpeed;
    /** Style preset name */
    stylePreset?: string;
    /** Color palette (preset name or custom) */
    colorPalette?: ColorPalette | string;
    /** Style codes array */
    styleCodes?: string[];
}
/**
 * Parameters for generate operation.
 */
export interface GenerateParams extends BaseGenerationParams {
    /** Generation prompt (required, max 10,000 chars) */
    prompt: string;
    /** Image resolution (e.g., '1024x1024') */
    resolution?: string;
    /** Aspect ratio (e.g., '1x1', '16x9') */
    aspectRatio?: string;
    /** Magic prompt option (AUTO, ON, OFF) */
    magicPrompt?: MagicPromptOption;
    /** Negative prompt */
    negativePrompt?: string;
    /** Style type (AUTO, GENERAL, REALISTIC, DESIGN, FICTION) */
    styleType?: StyleType;
}
/**
 * Parameters for edit operation.
 */
export interface EditParams extends BaseGenerationParams {
    /** Editing prompt (required, max 10,000 chars) */
    prompt: string;
    /** Input image path or Buffer (required) */
    image: string | Buffer;
    /** Mask image path or Buffer (required) */
    mask: string | Buffer;
    /** Magic prompt option (AUTO, ON, OFF) */
    magicPrompt?: MagicPromptOption;
    /** Style type (AUTO, GENERAL, REALISTIC, DESIGN, FICTION) */
    styleType?: StyleType;
}
/**
 * Parameters for remix operation.
 */
export interface RemixParams extends BaseGenerationParams {
    /** Remix prompt (required) */
    prompt: string;
    /** Input image path or Buffer (required) */
    image: string | Buffer;
    /** Image weight (0-100) */
    imageWeight?: number;
    /** Output resolution */
    resolution?: string;
    /** Output aspect ratio */
    aspectRatio?: string;
    /** Magic prompt option (AUTO, ON, OFF) */
    magicPrompt?: MagicPromptOption;
    /** Negative prompt */
    negativePrompt?: string;
    /** Style type (AUTO, GENERAL, REALISTIC, DESIGN, FICTION) */
    styleType?: StyleType;
}
/**
 * Parameters for reframe operation.
 */
export interface ReframeParams extends BaseGenerationParams {
    /** Input square image path or Buffer (required) */
    image: string | Buffer;
    /** Target resolution (required) */
    resolution: string;
}
/**
 * Parameters for replace background operation.
 */
export interface ReplaceBackgroundParams extends BaseGenerationParams {
    /** Background description prompt (required) */
    prompt: string;
    /** Input image path or Buffer (required) */
    image: string | Buffer;
    /** Magic prompt option (AUTO, ON, OFF) */
    magicPrompt?: MagicPromptOption;
}
/** How much upscale() enlarges an image. */
export type UpscaleFactor = 'x2' | 'x4' | 'x8' | (string & {});
/**
 * Parameters for upscale(), which since 2.0 calls POST /v2/image/upscale/auto
 * (multipart): Ideogram picks the upscaling model per request.
 *
 * The 1.x fields (prompt, resemblance, detail, magicPromptOption, numImages)
 * belonged to the v1 /upscale endpoint, which Ideogram retired: on 2026-11-22
 * it answered every request with 400 "The selected model version is no longer
 * supported". The v2 upscaler has no equivalent for them, and upscale() throws
 * if one is passed rather than dropping it silently.
 */
export interface UpscaleParams {
    /** Input image path or Buffer (required, max 50MB). */
    image: string | Buffer;
    /** 'x2' (default), 'x4' or 'x8'. Rejected when the output would exceed 8192px on either side. */
    upscaleFactor?: UpscaleFactor;
    /** Random seed (0..2147483647). */
    seed?: number;
    /** Return as soon as the request is accepted; poll with getGeneration / waitForGeneration. */
    async?: boolean;
    /** HTTPS URL Ideogram POSTs the finished result to. */
    webhookUrl?: string;
    /** Price the request instead of running it; resolves to a PriceQuote (EDRYRUNIGNORED if the API ran it instead). */
    dryRun?: boolean;
    /** Per-request timeout in ms (default 300000). */
    timeoutMs?: number;
}
/** One upscaled image. `url` is empty when it failed safety checks. */
export interface UpscaledImage {
    url?: string | null;
    resolution: string;
    is_image_safe: boolean;
    seed: number;
}
/** Response from upscale(). `data` is present only for synchronous requests. */
export interface UpscaleResponse {
    generation_id: string;
    seed: number;
    /** Output width in pixels. */
    width: number;
    /** Output height in pixels. */
    height: number;
    data?: UpscaledImage[];
}
/**
 * Parameters for describe operation.
 */
export interface DescribeParams {
    /** Input image path or Buffer (required) */
    image: string | Buffer;
    /** Model version (V_2, V_3) */
    describeModelVersion?: DescribeModelVersion;
}
/**
 * Individual image data from API response.
 */
export interface ImageData {
    /** Image URL */
    url: string;
    /** Image resolution */
    resolution?: string;
    /** Seed used for generation */
    seed?: number;
    /** Whether image is safe */
    is_image_safe?: boolean;
    /** Prompt used */
    prompt?: string;
}
/**
 * API response for generation operations.
 */
export interface GenerationResponse {
    /** Array of generated image data */
    data: ImageData[];
    /** Creation timestamp */
    created?: string;
}
/**
 * Individual description from describe API.
 */
export interface Description {
    /** Description text */
    text: string;
}
/**
 * API response for describe operation.
 */
export interface DescribeResponse {
    /** Array of descriptions */
    descriptions: Description[];
}
/**
 * Constraint for prompt validation.
 */
export interface PromptConstraint {
    required: boolean;
    maxLength: number;
}
/**
 * Constraint for image input.
 */
export interface ImageConstraint {
    required: boolean;
    formats: string[];
    mustBeSquare?: boolean;
}
/**
 * Constraint for numeric range.
 */
export interface RangeConstraint {
    min: number;
    max: number;
    default?: number;
}
/**
 * Constraint for options (enum values).
 */
export interface OptionsConstraint {
    options: readonly string[];
    default?: string;
    required?: boolean;
}
/**
 * Color palette constraint.
 */
export interface ColorPaletteConstraint {
    presets: readonly string[];
}
/**
 * Constraints for a specific operation.
 */
export interface OperationConstraint {
    prompt?: PromptConstraint;
    image?: ImageConstraint;
    mask?: ImageConstraint;
    resolution?: OptionsConstraint;
    aspectRatio?: OptionsConstraint;
    renderingSpeed?: OptionsConstraint;
    magicPrompt?: OptionsConstraint;
    numImages?: RangeConstraint;
    styleType?: OptionsConstraint;
    stylePreset?: OptionsConstraint;
    colorPalette?: ColorPaletteConstraint;
    imageWeight?: RangeConstraint;
    resemblance?: RangeConstraint;
    detail?: RangeConstraint;
    magicPromptOption?: OptionsConstraint;
    describeModelVersion?: OptionsConstraint;
}
/**
 * Operation constraint key.
 */
export type OperationKey = 'generate-v3' | 'edit-v3' | 'remix-v3' | 'reframe-v3' | 'replace-background-v3' | 'describe';
/**
 * All operation constraints mapped by operation key.
 */
export type OperationConstraints = {
    [K in OperationKey]: OperationConstraint;
};
/**
 * Validation result from parameter validation.
 */
export interface ValidationResult {
    /** Whether validation passed */
    valid: boolean;
    /** Array of error messages */
    errors: string[];
}
/**
 * Parameters for operation validation.
 */
export interface ValidationParams {
    prompt?: string;
    resolution?: string;
    aspectRatio?: string;
    renderingSpeed?: string;
    magicPrompt?: string;
    numImages?: number;
    styleType?: string;
    stylePreset?: string;
    imageWeight?: number;
    resemblance?: number;
    detail?: number;
    magicPromptOption?: string;
    describeModelVersion?: string;
    image?: string | Buffer;
    [key: string]: unknown;
}
/**
 * Spinner object for long-running operations.
 */
export interface SpinnerObject {
    /** Start the spinner animation */
    start(): void;
    /** Stop the spinner and optionally show final message */
    stop(finalMessage?: string | null): void;
    /** Update the spinner message */
    update(newMessage: string): void;
}
/**
 * File format for read/write operations.
 */
export type FileFormat = 'json' | 'txt' | 'binary' | 'auto';
/**
 * Image dimensions result.
 */
export interface ImageDimensions {
    width: number;
    height: number;
}
/**
 * Generic error status codes with messages.
 */
export interface GenericErrorMessages {
    [statusCode: number]: string;
}
/**
 * Error response body.
 */
export interface ApiErrorResponse {
    message?: string;
    detail?: unknown;
    error?: string;
    /** RFC 7807 problem documents (v2 validation errors). */
    title?: string;
    status?: number;
    type?: string;
    /** v2 402/429 bodies. */
    reject_reason?: string;
    max_inflight_requests?: number;
    task_completion_speed?: string;
}
/** Widened string union: autocompletes the known values, accepts any string. */
export type OpenString<T extends string> = T | (string & {});
/** Magic prompt mode for the v2 endpoints (lowercase, unlike v3's AUTO/ON/OFF). */
export type MagicPromptMode = OpenString<'auto' | 'on' | 'off'>;
/** Rendering speed for the Ideogram 4.0 endpoints (lowercase, unlike v3). */
export type RenderingSpeedV4 = OpenString<'turbo' | 'default' | 'quality'>;
/** Rendering quality for Ideogram 4.5. `very_low` requires source images on generate. */
export type QualityV45 = OpenString<'very_low' | 'low' | 'medium' | 'high'>;
/** Output background for Ideogram 4.5. */
export type BackgroundV45 = OpenString<'auto' | 'transparent' | 'opaque'>;
/** Output resolution tier (pixel budget) for Ideogram 4.0 transparent. */
export type OutputResolutionTier = OpenString<'1k' | '2k' | '4k' | '8k'>;
/** Resolution tier for automatic model selection. */
export type AutoResolutionTier = OpenString<'1k' | '2k' | '4k'>;
/**
 * Output size for Ideogram 4.6 generate: 'auto' (default, currently 2K),
 * 'auto_2k', 'auto_4k' (not at very_low quality), 'source' (needs images),
 * or an exact 'WIDTHxHEIGHT'. Ideogram 4.5 accepts only 'auto', 'source' or
 * an exact size.
 */
export type ImageSizeV46 = OpenString<'auto' | 'auto_2k' | 'auto_4k' | 'source'>;
/** Style type for automatic model selection (lowercase, unlike v3's AUTO/GENERAL/...). */
export type AutoStyleType = OpenString<'auto' | 'general' | 'realistic' | 'design' | 'custom' | 'fiction' | 'stylized'>;
/** v2 color palette preset names (lowercase, unlike v3's EMBER/FRESH/...). */
export type V2ColorPalettePreset = OpenString<'ember' | 'fresh' | 'jungle' | 'magic' | 'melon' | 'mosaic' | 'pastel' | 'ultramarine'>;
/**
 * A v2 color palette: a preset `{ name }` or explicit `{ members }`, never both.
 * A bare preset name string is accepted as shorthand for `{ name }`.
 */
export type V2ColorPalette = V2ColorPalettePreset | {
    name: V2ColorPalettePreset;
} | {
    members: Array<{
        color_hex: string;
        color_weight?: number;
    }>;
};
/** An image input: a local file path or the raw bytes. */
export type ImageInput = string | Buffer;
/** An audio input (MP3 or WAV): a local file path or the raw bytes. */
export type AudioInput = string | Buffer;
/** Kind of Ideogram asset an AssetIdentifier points at. */
export type AssetType = OpenString<'ASSET' | 'CANVAS_ASSET' | 'LAYERED_ASSET' | 'RESPONSE' | 'UPLOAD'>;
/** A reference to an existing uploaded or generated Ideogram asset. */
export interface AssetIdentifier {
    asset_type: AssetType;
    asset_id: string;
    /** Collection the asset was picked from (22-char URL-safe base64). Attribution only; grants no access. */
    collection_id?: string;
}
/**
 * Options every v2 request accepts, including the always-asynchronous SVG and
 * video endpoints.
 */
export interface V2RequestOptions {
    /**
     * Price the request instead of running it; the method resolves to a
     * PriceQuote. The library checks a quote came back: if the API ran the
     * request anyway, it throws EDRYRUNIGNORED (possiblyBilled true).
     */
    dryRun?: boolean;
    /** Per-request timeout in ms (default 300000 for v2 endpoints). */
    timeoutMs?: number;
}
/**
 * Options shared by every v2 image generation endpoint.
 */
export interface V2CommonParams extends V2RequestOptions {
    /** Prompt: natural language, or a structured Ideogram 4.0 JSON prompt (max 10,000 chars). */
    prompt: string;
    /** Random seed (0..2147483647). */
    seed?: number;
    /** Number of images (1-8). */
    numImages?: number;
    /** Return as soon as the request is accepted; poll with getGeneration / waitForGeneration. */
    async?: boolean;
}
/** Options for endpoints that accept a webhook and copyright detection. */
export interface V2DeliveryParams {
    /** HTTPS URL Ideogram POSTs the finished result to (signed with Ed25519). */
    webhookUrl?: string;
    /** Run copyright detection; flagged images return with is_image_safe: false. */
    enableCopyrightDetection?: boolean;
}
/** POST /v2/image/generate/ideogram-4 (JSON). */
export interface GenerateV4Params extends V2CommonParams, V2DeliveryParams {
    magicPrompt?: MagicPromptMode;
    /** One of the 38 Ideogram 4.0 resolutions (see V4_RESOLUTIONS). Omit to pick from the prompt. */
    resolution?: string;
    renderingSpeed?: RenderingSpeedV4;
}
/** POST /v2/image/generate/ideogram-4-transparent (JSON). */
export interface GenerateV4TransparentParams extends V2CommonParams, V2DeliveryParams {
    magicPrompt?: MagicPromptMode;
    /** Aspect ratio (e.g. '1x1', '16x9') or 'auto' (default). */
    aspectRatio?: string;
    /** Pixel budget tier; tiers above 2k are produced by upscaling. Default '1k'. */
    outputResolution?: OutputResolutionTier;
    renderingSpeed?: RenderingSpeedV4;
}
/** POST /v2/image/generate/ideogram-4-custom-model (JSON). */
export interface GenerateV4CustomParams extends V2CommonParams, V2DeliveryParams {
    /** `model/<model_name>/version/<version_name>` */
    customModelUri: string;
    /** Remove the background and return transparent PNGs (no extra charge). */
    transparentBackground?: boolean;
    magicPrompt?: MagicPromptMode;
    resolution?: string;
    /** When omitted, a speed the custom model supports is used. */
    renderingSpeed?: RenderingSpeedV4;
}
/** POST /v2/image/generate/ideogram-4-5 (multipart). */
export interface GenerateV45Params extends V2CommonParams, V2DeliveryParams {
    magicPrompt?: MagicPromptMode;
    /** Source images to edit (max 5, 25MB each). The first is edited; others are references. */
    images?: ImageInput[];
    /**
     * Mask for the first source image: black = edit, white = keep. That is the intent; the API does not
     * reliably confine edits to the masked area. Same size as images[0].
     */
    mask?: ImageInput;
    /**
     * 4.5: 'auto', 'source' (needs images) or an exact 'WIDTHxHEIGHT'.
     * 4.6 adds 'auto_2k' and 'auto_4k' (see ImageSizeV46). Cannot be set with a mask.
     */
    size?: string;
    background?: BackgroundV45;
    /**
     * 4.5: defaults to 'medium' with source images, 'high' without; 'very_low' needs source images.
     * 4.6: defaults to 'medium'; 'very_low' works without source images and renders up to 2K.
     */
    quality?: QualityV45;
}
/**
 * POST /v2/image/generate/ideogram-4-6 (multipart). Same fields as 4.5; the
 * limits differ (4096x4096 total, 'auto_2k' / 'auto_4k' sizes), and
 * validateV2Params('generate-v46', ...) applies the 4.6 ones.
 */
export type GenerateV46Params = GenerateV45Params;
/** POST /v2/image/generate/auto (multipart). */
export interface GenerateAutoParams extends V2CommonParams {
    /** Source images to edit (max 10, 25MB each). */
    images?: ImageInput[];
    /** Cannot be combined with source images. */
    negativePrompt?: string;
    /** 'auto' (default) or 'WIDTHxHEIGHT'-style ratio. Mutually exclusive with resolution. */
    aspectRatio?: string;
    /** 'WIDTHxHEIGHT'; served at the closest size the selected model supports. */
    resolution?: string;
    resolutionTier?: AutoResolutionTier;
    magicPrompt?: MagicPromptMode;
    /**
     * A value other than 'auto' limits the request to a model that supports it.
     * Cannot be combined with source images.
     */
    styleType?: AutoStyleType;
    /** Limits the request to a model that supports palettes. Cannot be combined with source images. */
    colorPalette?: V2ColorPalette;
}
/** POST /v2/image/precise-edit/ideogram-4-5 (multipart). */
export interface PreciseEditV45Params extends V2CommonParams, V2DeliveryParams {
    /** The image to edit (max 50MB, 67,108,864 px). Output keeps its exact width and height. */
    image: ImageInput;
    /** Guide images, never edited (max 4; max 3 with a mask). */
    referenceImages?: ImageInput[];
    /**
     * Mask: black = edit, white = keep. That is the intent; the API does not reliably confine edits
     * to the masked area. Same size as image.
     */
    mask?: ImageInput;
    /**
     * 'auto' (the default: a region around the mask; without a mask it edits the
     * whole image, like 'none'), 'none', or 'y_min,x_min,y_max,x_max'.
     */
    contextWindow?: string;
    /** Default 'medium'. On 4.5 the only field that affects price; on 4.6 an image over 2048x2048 bills at the 4K price. */
    quality?: QualityV45;
}
/**
 * POST /v2/image/precise-edit/ideogram-4-6 (multipart). Same fields as 4.5;
 * the whole-image edit bound is 4096x4096 (2048x2048 at very_low) instead of 2048x2048.
 */
export type PreciseEditV46Params = PreciseEditV45Params;
/** SVG rendering quality. */
export type SvgQuality = OpenString<'low' | 'medium' | 'high'>;
/**
 * POST /v2/svg/generate/ideogram-vector-1 (multipart). Always asynchronous:
 * the response is a generation_id to poll.
 */
export interface GenerateSvgParams extends V2RequestOptions {
    /** Max 9,500 characters. */
    prompt: string;
    /** Source images to transform. The first is the primary source; others are references. */
    images?: ImageInput[];
    /** Existing Ideogram assets to use as sources. Take priority over `images` when both are set. */
    imageAssetIdentifiers?: AssetIdentifier[];
    /** One of the Ideogram 4.0 aspect ratios (see V4_ASPECT_RATIOS). Default 'auto'. */
    aspectRatio?: string;
    /** Default 'medium'. */
    quality?: SvgQuality;
    /** Number of SVGs (1-8). */
    numImages?: number;
    /** Random seed (0..2147483647). */
    seed?: number;
    /** When false, every shape is one flat color. Default true. */
    useGradient?: boolean;
    /** Outputs are private by default; enterprise outputs are always private. */
    private?: boolean;
    /** URL-safe base64 ID of a writable destination collection. */
    targetCollectionId?: string;
    /** HTTPS URL Ideogram POSTs the finished result to. */
    webhookUrl?: string;
}
/** MiniMax H3 aspect ratios. */
export type MinimaxH3AspectRatio = OpenString<'21x9' | '16x9' | '4x3' | '1x1' | '3x4' | '9x16'>;
/** MiniMax H3 resolution tiers (uppercase, as MiniMax spells them). 2K and 4K are upscaled from 768P. */
export type MinimaxH3Resolution = OpenString<'480P' | '768P' | '2K' | '4K'>;
/** How much MiniMax H3 may rewrite the prompt. 'disabled' uses it as written. */
export type MinimaxH3PromptExpansionMode = OpenString<'disabled' | 'fast' | 'balanced' | 'quality'>;
/** Seedance 2.5 aspect ratios; 'auto' lets the model choose from the prompt. */
export type Seedance25AspectRatio = OpenString<'auto' | '21x9' | '16x9' | '4x3' | '1x1' | '3x4' | '9x16'>;
/** Seedance 2.5 resolution tiers (lowercase). */
export type Seedance25Resolution = OpenString<'480p' | '720p' | '1080p'>;
/** Fields every video endpoint accepts. */
export interface VideoBaseParams extends V2RequestOptions {
    prompt: string;
    /** Length in seconds. MiniMax H3: 5-15 (default 5). Seedance 2.5: 4-30 (omit to let the model pick). */
    duration?: number;
    /** HTTPS URL Ideogram POSTs the finished result to. */
    webhookUrl?: string;
}
/** POST /v2/video/generate/minimax-h3-text-to-video (JSON). Prompt max 2,000 chars. */
export interface MinimaxH3TextToVideoParams extends VideoBaseParams {
    /** Default '16x9'. */
    aspectRatio?: MinimaxH3AspectRatio;
    /** Default '2K'. */
    resolution?: MinimaxH3Resolution;
}
/** POST /v2/video/generate/minimax-h3-image-to-video (multipart). */
export interface MinimaxH3ImageToVideoParams extends VideoBaseParams {
    /** First frame (max 50MB). */
    image: ImageInput;
    /** Optional last frame (max 50MB); the video transitions from `image` to it. */
    endImage?: ImageInput;
    /** Default '2K'. */
    resolution?: MinimaxH3Resolution;
}
/** POST /v2/video/generate/minimax-h3-reference-to-video (multipart). */
export interface MinimaxH3ReferenceToVideoParams extends VideoBaseParams {
    /** Reference images (max 50MB each), addressed in the prompt as Image 1, Image 2, ... */
    referenceImages?: ImageInput[];
    /**
     * MP3 or WAV references (max 3, 15MB and 2-15s each, 15s in total), addressed
     * as Audio 1..3. Require at least one reference image.
     */
    referenceAudios?: AudioInput[];
    /** Default '16x9'. */
    aspectRatio?: MinimaxH3AspectRatio;
    /** Default '2K'. */
    resolution?: MinimaxH3Resolution;
    /** Default 'balanced'. */
    promptExpansionMode?: MinimaxH3PromptExpansionMode;
}
/** POST /v2/video/generate/seedance-2-5-text-to-video (JSON). Prompt max 30,000 chars. */
export interface Seedance25TextToVideoParams extends VideoBaseParams {
    /** Default 'auto'. */
    aspectRatio?: Seedance25AspectRatio;
    /** Default '720p'. */
    resolution?: Seedance25Resolution;
    /** Generate an audio track. Documented to roughly double the cost (a 480p / 4s request on 2026-11-22 billed the same); stricter output moderation. Default false. */
    generateAudio?: boolean;
}
/** POST /v2/video/generate/seedance-2-5-image-to-video (multipart). */
export interface Seedance25ImageToVideoParams extends VideoBaseParams {
    /** First frame (max 50MB). */
    image: ImageInput;
    /** Optional last frame (max 50MB). */
    endImage?: ImageInput;
    /** Default '720p'. */
    resolution?: Seedance25Resolution;
    /** Default false. */
    generateAudio?: boolean;
}
/** POST /v2/video/generate/seedance-2-5-reference-to-video (multipart). */
export interface Seedance25ReferenceToVideoParams extends VideoBaseParams {
    /**
     * Reference images (max 50MB each), addressed as [Image1], [Image2], ...
     * The API requires at least one, although the schema marks the field optional.
     */
    referenceImages?: ImageInput[];
    /** MP3 or WAV references (15MB and 2-30s each, 30s in total). Require a reference image. */
    referenceAudios?: AudioInput[];
    /** Default 'auto'. */
    aspectRatio?: Seedance25AspectRatio;
    /** Default '720p'. */
    resolution?: Seedance25Resolution;
    /** Default false. */
    generateAudio?: boolean;
}
/**
 * Acknowledgement from an always-asynchronous endpoint (SVG, video): poll
 * getGeneration / waitForGeneration with `generation_id`. Video responses also
 * carry `created`; the SVG response carries only `generation_id`.
 */
export interface V2Acknowledgement {
    generation_id: string;
    created?: string;
}
/** Kind of generation a generation_id identifies. */
export type GenerationKind = OpenString<'sampling' | 'workflow'>;
/** One generated image from a v2 endpoint. `url` is empty/null when the image failed safety checks. */
export interface GeneratedImage {
    prompt: string;
    resolution: string;
    is_image_safe: boolean;
    seed: number;
    url?: string | null;
}
/** Response from the v2 generation endpoints. `data` is present only for synchronous requests. */
export interface V2GenerationResponse {
    generation_id: string;
    seed?: number;
    /** Present on Ideogram 4.5 generate and precise edit. */
    generation_kind?: GenerationKind;
    data?: GeneratedImage[];
}
/**
 * Price quote returned when `dryRun` is set. Observed, not documented:
 * the spec names PriceQuote without defining it.
 */
export interface PriceQuote {
    object: 'price_quote';
    billing_identifier: string;
    quantity: number;
    /** Price in millionths of a US dollar. */
    usd_micros: number;
    /** Price in thousandths of a credit. */
    credit_millis: number;
    /** Observed value: 'exact'. */
    qualifier: string;
    /** Observed on the auto endpoint only. */
    upper_bound_usd_micros?: number;
    [key: string]: unknown;
}
/** Status of an asynchronous generation. */
export type GenerationStatusValue = OpenString<'pending' | 'completed' | 'failed'>;
/**
 * A result item from GET /v2/generations/{id}. Items without object_type are
 * images; otherwise object_type names the kind ('image.generation',
 * 'video.generation', 'svg.generation', ...). Fields beyond url apply to some
 * kinds only.
 */
export interface GenerationDataItem {
    object_type?: string;
    url?: string | null;
    prompt?: string;
    resolution?: string;
    seed?: number;
    is_image_safe?: boolean;
    /** Video and SVG results: the asset ID (distinct from the generation ID). */
    asset_id?: string;
    /** Video: the produced aspect ratio, formatted 'W:H'. */
    aspect_ratio?: string;
    /** Video: the measured length in seconds. */
    duration?: number;
    /** SVG: output MIME type. */
    mime_type?: string;
    /** SVG: canvas width in pixels. */
    width?: number;
    /** SVG: canvas height in pixels. */
    height?: number;
    [key: string]: unknown;
}
/** A generated video, as GET /v2/generations/{id} returns it. */
export interface VideoGenerationItem extends GenerationDataItem {
    object_type: 'video.generation';
    prompt: string;
    resolution: string;
    aspect_ratio: string;
    duration: number;
}
/** A generated SVG, as GET /v2/generations/{id} returns it. */
export interface SvgGenerationItem extends GenerationDataItem {
    object_type: 'svg.generation';
    asset_id: string;
    url: string;
    mime_type: string;
    width: number;
    height: number;
}
/** GET /v2/generations/{generation_id} */
export interface GenerationStatus {
    generation_id: string;
    status: GenerationStatusValue;
    created: string;
    /** Present when completed; always 'url'. */
    response_type?: string;
    usage_cost_usd_micros?: number;
    /** Present when failed, e.g. 'content_policy_violation'. */
    failure_reason?: string;
    data?: GenerationDataItem[];
}
/** Options for waitForGeneration. */
export interface WaitForGenerationOptions {
    /** Delay between polls in ms (default 2000). */
    intervalMs?: number;
    /** Give up after this many ms (default 600000). The generation keeps running server-side. */
    timeoutMs?: number;
    /** Called after every poll. */
    onPoll?: (status: GenerationStatus) => void;
}
/** Account or usage limit that rejected a generation (HTTP 402/429 on v2). */
export type GenerationRejectReason = OpenString<'insufficient_funds' | 'subscription_required' | 'daily_limit' | 'priority_credit_required' | 'inflight_limit' | 'feature_limit'>;
/** v2 operation keys accepted by validateV2Params. Derived from the `V2_OPERATION_KEYS` list in config.ts, so the two cannot drift. */
export type { V2OperationKey } from '../config.js';
//# sourceMappingURL=index.d.ts.map