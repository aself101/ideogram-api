/**
 * Ideogram API Configuration
 *
 * Handles authentication and API configuration settings.
 *
 * API key can be provided via (in priority order):
 * 1. Command line flag: --api-key
 * 2. Environment variable: IDEOGRAM_API_KEY
 * 3. Local .env file in current directory
 * 4. Global config: ~/.ideogram/.env (for global npm installs)
 *
 * To obtain an API key:
 * 1. Visit https://ideogram.ai/api
 * 2. Sign up or log in to your account
 * 3. Generate a new API key from the API dashboard
 */
import type { OperationConstraints, ValidationParams, V2OperationKey } from './types/index.js';
export declare const BASE_URL = "https://api.ideogram.ai";
export declare const API_VERSION = "v1";
export declare const ENDPOINTS: {
    readonly GENERATE_V3: "/v1/ideogram-v3/generate";
    readonly EDIT_V3: "/v1/ideogram-v3/edit";
    readonly REMIX_V3: "/v1/ideogram-v3/remix";
    readonly REFRAME_V3: "/v1/ideogram-v3/reframe";
    readonly REPLACE_BACKGROUND_V3: "/v1/ideogram-v3/replace-background";
    readonly DESCRIBE: "/describe";
    readonly GENERATE_V4: "/v2/image/generate/ideogram-4";
    readonly GENERATE_V4_TRANSPARENT: "/v2/image/generate/ideogram-4-transparent";
    readonly GENERATE_V4_CUSTOM: "/v2/image/generate/ideogram-4-custom-model";
    readonly GENERATE_V45: "/v2/image/generate/ideogram-4-5";
    readonly GENERATE_V46: "/v2/image/generate/ideogram-4-6";
    readonly GENERATE_AUTO: "/v2/image/generate/auto";
    readonly PRECISE_EDIT_V45: "/v2/image/precise-edit/ideogram-4-5";
    readonly PRECISE_EDIT_V46: "/v2/image/precise-edit/ideogram-4-6";
    readonly UPSCALE_AUTO: "/v2/image/upscale/auto";
    readonly GENERATE_SVG: "/v2/svg/generate/ideogram-vector-1";
    readonly VIDEO_MINIMAX_H3_TEXT: "/v2/video/generate/minimax-h3-text-to-video";
    readonly VIDEO_MINIMAX_H3_IMAGE: "/v2/video/generate/minimax-h3-image-to-video";
    readonly VIDEO_MINIMAX_H3_REFERENCE: "/v2/video/generate/minimax-h3-reference-to-video";
    readonly VIDEO_SEEDANCE_25_TEXT: "/v2/video/generate/seedance-2-5-text-to-video";
    readonly VIDEO_SEEDANCE_25_IMAGE: "/v2/video/generate/seedance-2-5-image-to-video";
    readonly VIDEO_SEEDANCE_25_REFERENCE: "/v2/video/generate/seedance-2-5-reference-to-video";
    readonly GENERATIONS: "/v2/generations";
};
export declare const RESOLUTIONS: readonly string[];
export declare const ASPECT_RATIOS: readonly string[];
export declare const RENDERING_SPEEDS: readonly string[];
export declare const MAGIC_PROMPT_OPTIONS: readonly string[];
export declare const STYLE_TYPES: readonly string[];
export declare const STYLE_PRESETS: readonly string[];
export declare const COLOR_PALETTE_PRESETS: readonly string[];
export declare const DESCRIBE_MODEL_VERSIONS: readonly string[];
export declare const V4_RESOLUTIONS: readonly string[];
export declare const V4_ASPECT_RATIOS: readonly string[];
export declare const V4_RENDERING_SPEEDS: readonly string[];
export declare const V2_MAGIC_PROMPT_MODES: readonly string[];
export declare const V4_OUTPUT_RESOLUTIONS: readonly string[];
export declare const V45_QUALITIES: readonly string[];
export declare const V45_BACKGROUNDS: readonly string[];
export declare const AUTO_RESOLUTION_TIERS: readonly string[];
/** Ideogram 4.6 named sizes (besides an exact 'WIDTHxHEIGHT'). 4.5 has only 'auto' and 'source'. */
export declare const V46_SIZES: readonly string[];
/** Style types for automatic model selection (IdeogramV3StyleType, lowercase on v2). */
export declare const AUTO_STYLE_TYPES: readonly string[];
/** v2 color palette preset names (lowercase; v3's are uppercase). */
export declare const V2_COLOR_PALETTE_PRESETS: readonly string[];
export declare const SVG_QUALITIES: readonly string[];
export declare const UPSCALE_FACTORS: readonly string[];
export declare const ASSET_TYPES: readonly string[];
export declare const MINIMAX_H3_ASPECT_RATIOS: readonly string[];
export declare const MINIMAX_H3_RESOLUTIONS: readonly string[];
export declare const MINIMAX_H3_PROMPT_EXPANSION_MODES: readonly string[];
export declare const SEEDANCE_25_ASPECT_RATIOS: readonly string[];
export declare const SEEDANCE_25_RESOLUTIONS: readonly string[];
/** Documented v2 limits (counts in files, sizes in bytes, areas in pixels). */
export declare const V2_LIMITS: {
    readonly promptMaxLength: 10000;
    readonly numImages: {
        readonly min: 1;
        readonly max: 8;
    };
    readonly seed: {
        readonly min: 0;
        readonly max: 2147483647;
    };
    readonly webhookUrlMaxLength: 2048;
    readonly customModelUriMaxLength: 512;
    readonly v45: {
        readonly maxImages: 5;
        readonly maxImagesWithMask: 4;
        readonly maxFileBytes: number;
    };
    /** 4.6 generate: same counts as 4.5; exact sizes up to 4096x4096 and 8192 per side (2048x2048 / 4608 at very_low). */
    readonly v46: {
        readonly maxImages: 5;
        readonly maxImagesWithMask: 4;
        readonly maxFileBytes: number;
        readonly maxPixels: 16777216;
        readonly maxSide: 8192;
        readonly veryLowMaxPixels: 4194304;
        readonly veryLowMaxSide: 4608;
    };
    readonly auto: {
        readonly maxImages: 10;
        readonly maxFileBytes: number;
    };
    readonly preciseEdit: {
        readonly maxReferenceImages: 4;
        readonly maxReferenceImagesWithMask: 3;
        readonly maxFileBytes: number;
        readonly maxImagePixels: 67108864;
    };
    /** 4.6 precise edit: the whole-image / context-window bound is 4096x4096 (2048x2048 and 4608 per side at very_low). */
    readonly preciseEditV46: {
        readonly maxEditPixels: 16777216;
        readonly veryLowMaxEditPixels: 4194304;
        readonly veryLowMaxSide: 4608;
    };
    readonly svg: {
        readonly promptMaxLength: 9500;
    };
    readonly upscale: {
        readonly maxFileBytes: number;
        readonly maxOutputSide: 8192;
    };
    /** Undocumented: the spec gives no per-file limit for SVG source images; this is the client's own 50MB loader cap. */
    readonly svgMaxFileBytes: number;
    readonly minimaxH3: {
        readonly promptMaxLength: 2000;
        readonly duration: {
            readonly min: 5;
            readonly max: 15;
        };
        readonly maxFileBytes: number;
        readonly maxAudioBytes: number;
        readonly maxAudios: 3;
        /** Across images, videos and audio. */
        readonly maxReferences: 12;
    };
    readonly seedance25: {
        readonly promptMaxLength: 30000;
        readonly duration: {
            readonly min: 4;
            readonly max: 30;
        };
        readonly maxFileBytes: number;
        readonly maxAudioBytes: number;
    };
    /** Area bound for a 4.5 edit / exact size: 2048x2048. */
    readonly maxEditPixels: 4194304;
    readonly minSide: 256;
    readonly maxAspect: 6;
};
/** Parameters accepted by validateV2Params (camelCase, as passed to the API methods). */
export interface V2ValidationParams {
    prompt?: string;
    seed?: number;
    numImages?: number;
    magicPrompt?: string;
    resolution?: string;
    renderingSpeed?: string;
    aspectRatio?: string;
    outputResolution?: string;
    customModelUri?: string;
    size?: string;
    background?: string;
    quality?: string;
    imageCount?: number;
    hasMask?: boolean;
    referenceImageCount?: number;
    contextWindow?: string;
    negativePrompt?: string;
    resolutionTier?: string;
    webhookUrl?: string;
    hasImage?: boolean;
    /** generate-auto */
    styleType?: string;
    /** generate-auto: a preset name, `{ name }` or `{ members }`. */
    colorPalette?: unknown;
    /** upscale-auto */
    upscaleFactor?: string;
    /** generate-svg */
    imageAssetIdentifiers?: Array<{
        asset_type?: string;
        asset_id?: string;
        collection_id?: string;
    }>;
    /** Video: length in seconds. */
    duration?: number;
    /** Video reference-to-video: number of reference audio files. */
    referenceAudioCount?: number;
    /** minimax-h3-reference-to-video */
    promptExpansionMode?: string;
}
/** Area and side bounds for a context window or exact size. */
export interface PixelBounds {
    /** Maximum width x height. */
    maxPixels: number;
    /** Maximum length of either side, when the model has one. */
    maxSide?: number;
}
/** Whole-image edit bound for a precise-edit model at a quality. */
export declare function preciseEditBounds(model: '4.5' | '4.6', quality?: string): PixelBounds;
/**
 * Parse an explicit precise-edit context window `y_min,x_min,y_max,x_max`.
 * Returns null for 'none' / 'auto'. Throws on a malformed or out-of-rule region.
 * Bounds against the image itself need its dimensions; pass them when known.
 * `bounds` defaults to the Ideogram 4.5 limit (2048x2048 pixels); use
 * preciseEditBounds('4.6', quality) for 4.6.
 */
export declare function parseContextWindow(value: string, imageDims?: {
    width: number;
    height: number;
}, bounds?: PixelBounds): {
    yMin: number;
    xMin: number;
    yMax: number;
    xMax: number;
} | null;
/**
 * Validate parameters for a v2 operation against the documented rules.
 * Catches mistakes before a request is sent; the CLI runs it on every v2 command.
 * The API client does not call it, so library callers opt in.
 *
 * @throws Error describing the first violated rule
 */
export declare function validateV2Params(operation: V2OperationKey, params: V2ValidationParams): void;
export declare const OPERATION_CONSTRAINTS: OperationConstraints;
export declare const DEFAULT_OUTPUT_DIR: string;
/**
 * Retrieve Ideogram API key from environment variables or CLI flag.
 *
 * @param cliApiKey - Optional API key passed via CLI flag (highest priority)
 * @returns The Ideogram API key
 * @throws Error if IDEOGRAM_API_KEY is not found in any location
 *
 * @example
 * const apiKey = getIdeogramApiKey();
 * const apiKey = getIdeogramApiKey('your_key'); // From CLI flag
 */
export declare function getIdeogramApiKey(cliApiKey?: string | null): string;
/**
 * Redact API key for safe logging (show only last 4 characters).
 * CRITICAL SECURITY: Never log full API keys, even in DEBUG mode.
 *
 * @param apiKey - The API key to redact
 * @returns Redacted API key (e.g., "xxx...xyz")
 *
 * @example
 * redactApiKey('abcdef123456789'); // 'xxx...6789'
 */
export declare function redactApiKey(apiKey: string): string;
/**
 * Validate operation-specific parameters before making API calls.
 * Catches invalid parameters early to save API credits.
 *
 * @param operation - Operation name (e.g., 'generate-v3', 'edit-v3', 'describe'). For upscaling
 *   and every other v2 operation use validateV2Params.
 * @param params - Parameters to validate
 * @throws Error if validation fails
 *
 * @example
 * validateOperationParams('generate-v3', { prompt: 'a cat', aspectRatio: '1:1' });
 * validateOperationParams('remix-v3', { prompt: 'watercolor', imageWeight: 55 });
 */
export declare function validateOperationParams(operation: string, params: ValidationParams): void;
//# sourceMappingURL=config.d.ts.map