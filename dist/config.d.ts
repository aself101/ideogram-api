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
import type { OperationConstraints, ValidationParams, V2ColorPalette, V2OperationKey } from './types/index.js';
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
export declare const RESOLUTIONS: readonly ["512x1536", "576x1408", "576x1472", "576x1536", "640x1344", "640x1408", "640x1472", "640x1536", "704x1152", "704x1216", "704x1280", "704x1344", "704x1408", "704x1472", "736x1312", "768x1088", "768x1216", "768x1280", "768x1344", "800x1280", "832x960", "832x1024", "832x1088", "832x1152", "832x1216", "832x1248", "864x1152", "896x960", "896x1024", "896x1088", "896x1120", "896x1152", "960x832", "960x896", "960x1024", "960x1088", "1024x832", "1024x896", "1024x960", "1024x1024", "1088x768", "1088x832", "1088x896", "1088x960", "1120x896", "1152x704", "1152x832", "1152x864", "1152x896", "1216x704", "1216x768", "1216x832", "1248x832", "1280x704", "1280x768", "1280x800", "1312x736", "1344x640", "1344x704", "1344x768", "1408x576", "1408x640", "1408x704", "1472x576", "1472x640", "1472x704", "1536x512", "1536x576", "1536x640"];
export declare const ASPECT_RATIOS: readonly ["1x3", "3x1", "1x2", "2x1", "9x16", "16x9", "10x16", "16x10", "2x3", "3x2", "3x4", "4x3", "4x5", "5x4", "1x1"];
export declare const RENDERING_SPEEDS: readonly ["FLASH", "TURBO", "DEFAULT", "QUALITY"];
export declare const MAGIC_PROMPT_OPTIONS: readonly ["AUTO", "ON", "OFF"];
export declare const STYLE_TYPES: readonly ["AUTO", "GENERAL", "REALISTIC", "DESIGN", "FICTION"];
export declare const STYLE_PRESETS: readonly ["80S_ILLUSTRATION", "90S_NOSTALGIA", "ABSTRACT_ORGANIC", "ANALOG_NOSTALGIA", "ART_BRUT", "ART_DECO", "ART_POSTER", "AURA", "AVANT_GARDE", "BAUHAUS", "BLUEPRINT", "BLURRY_MOTION", "BRIGHT_ART", "C4D_CARTOON", "CHILDRENS_BOOK", "COLLAGE", "COLORING_BOOK_I", "COLORING_BOOK_II", "CUBISM", "DARK_AURA", "DOODLE", "DOUBLE_EXPOSURE", "DRAMATIC_CINEMA", "EDITORIAL", "EMOTIONAL_MINIMAL", "ETHEREAL_PARTY", "EXPIRED_FILM", "FLAT_ART", "FLAT_VECTOR", "FOREST_REVERIE", "GEO_MINIMALIST", "GLASS_PRISM", "GOLDEN_HOUR", "GRAFFITI_I", "GRAFFITI_II", "HALFTONE_PRINT", "HIGH_CONTRAST", "HIPPIE_ERA", "ICONIC", "JAPANDI_FUSION", "JAZZY", "LONG_EXPOSURE", "MAGAZINE_EDITORIAL", "MINIMAL_ILLUSTRATION", "MIXED_MEDIA", "MONOCHROME", "NIGHTLIFE", "OIL_PAINTING", "OLD_CARTOONS", "PAINT_GESTURE", "POP_ART", "RETRO_ETCHING", "RIVIERA_POP", "SPOTLIGHT_80S", "STYLIZED_RED", "SURREAL_COLLAGE", "TRAVEL_POSTER", "VINTAGE_GEO", "VINTAGE_POSTER", "WATERCOLOR", "WEIRD", "WOODBLOCK_PRINT"];
export declare const COLOR_PALETTE_PRESETS: readonly ["EMBER", "FRESH", "JUNGLE", "MAGIC", "MELON", "MOSAIC", "PASTEL", "ULTRAMARINE"];
export declare const DESCRIBE_MODEL_VERSIONS: readonly ["V_2", "V_3"];
export declare const V4_RESOLUTIONS: readonly ["2048x2048", "1440x2880", "2880x1440", "1664x2496", "2496x1664", "1792x2240", "2240x1792", "1440x2560", "2560x1440", "1600x2560", "2560x1600", "1728x2304", "2304x1728", "1296x3168", "3168x1296", "1152x2944", "2944x1152", "1248x3328", "3328x1248", "1280x3072", "3072x1280", "1024x3072", "3072x1024", "1024x1024", "896x1120", "1120x896", "864x1152", "1152x864", "832x1248", "1248x832", "800x1280", "1280x800", "720x1280", "1280x720", "720x1440", "1440x720", "512x1536", "1536x512"];
export declare const V4_ASPECT_RATIOS: readonly ["auto", "1x4", "1x3", "1x2", "9x16", "10x16", "2x3", "3x4", "4x5", "1x1", "5x4", "4x3", "3x2", "16x10", "16x9", "2x1", "3x1", "4x1"];
export declare const V4_RENDERING_SPEEDS: readonly ["turbo", "default", "quality"];
export declare const V2_MAGIC_PROMPT_MODES: readonly ["auto", "on", "off"];
export declare const V4_OUTPUT_RESOLUTIONS: readonly ["1k", "2k", "4k", "8k"];
export declare const V45_QUALITIES: readonly ["very_low", "low", "medium", "high"];
export declare const V45_BACKGROUNDS: readonly ["auto", "transparent", "opaque"];
export declare const AUTO_RESOLUTION_TIERS: readonly ["1k", "2k", "4k"];
/** Ideogram 4.6 named sizes (besides an exact 'WIDTHxHEIGHT'). 4.5 has only 'auto' and 'source'. */
export declare const V46_SIZES: readonly ["auto", "auto_2k", "auto_4k", "source"];
/** Style types for automatic model selection (IdeogramV3StyleType, lowercase on v2). */
export declare const AUTO_STYLE_TYPES: readonly ["auto", "general", "realistic", "design", "custom", "fiction", "stylized"];
/** v2 color palette preset names (lowercase; v3's are uppercase). */
export declare const V2_COLOR_PALETTE_PRESETS: readonly ["ember", "fresh", "jungle", "magic", "melon", "mosaic", "pastel", "ultramarine"];
export declare const SVG_QUALITIES: readonly ["low", "medium", "high"];
export declare const UPSCALE_FACTORS: readonly ["x2", "x4", "x8"];
export declare const ASSET_TYPES: readonly ["ASSET", "CANVAS_ASSET", "LAYERED_ASSET", "RESPONSE", "UPLOAD"];
export declare const MINIMAX_H3_ASPECT_RATIOS: readonly ["21x9", "16x9", "4x3", "1x1", "3x4", "9x16"];
export declare const MINIMAX_H3_RESOLUTIONS: readonly ["480P", "768P", "2K", "4K"];
export declare const MINIMAX_H3_PROMPT_EXPANSION_MODES: readonly ["disabled", "fast", "balanced", "quality"];
export declare const SEEDANCE_25_ASPECT_RATIOS: readonly ["auto", "21x9", "16x9", "4x3", "1x1", "3x4", "9x16"];
export declare const SEEDANCE_25_RESOLUTIONS: readonly ["480p", "720p", "1080p"];
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
/** Membership test for a literal tuple: `list.includes(x)` rejects a plain string argument. */
export declare function isOneOf(list: readonly string[], value: string): boolean;
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
 * Assert that a value is a v2 color palette: a preset name, `{ name }`, or
 * `{ members: [{ color_hex, color_weight? }] }`.
 *
 * @throws Error describing the first violated rule
 */
export declare function assertColorPalette(palette: unknown): asserts palette is V2ColorPalette;
/**
 * Validate parameters for a v2 operation against the documented rules.
 * Catches mistakes before a request is sent; the CLI runs it on every v2 command.
 * The API client does not call it, so library callers opt in.
 *
 * @example
 * ```ts
 * validateV2Params('generate-v46', { prompt: 'a lighthouse at dusk', size: 'auto' }); // valid: returns undefined
 * validateV2Params('generate-v46', { prompt: 'a lighthouse at dusk', quality: 'best' });
 * // throws: Invalid quality 'best'. Must be one of: very_low, low, medium, high
 * ```
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