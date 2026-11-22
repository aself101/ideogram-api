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

import dotenv from 'dotenv';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import type {
  OperationConstraints,
  OperationKey,
  ValidationParams,
  V2ColorPalette,
  V2OperationKey,
} from './types/index.js';

// Load environment variables in priority order:
// 1. First try local .env in current directory
dotenv.config();

// 2. Then try global config in home directory (if local .env doesn't exist)
const globalConfigPath = join(homedir(), '.ideogram', '.env');
if (existsSync(globalConfigPath)) {
  dotenv.config({ path: globalConfigPath });
}

/** Base URL of the Ideogram API. */
export const BASE_URL = 'https://api.ideogram.ai';

/** Version segment of the v1 endpoint paths (v2 endpoints spell their own /v2/ prefix). */
export const API_VERSION = 'v1';

/** Ideogram API endpoint paths, relative to BASE_URL. */
export const ENDPOINTS = {
  GENERATE_V3: `/${API_VERSION}/ideogram-v3/generate`,
  EDIT_V3: `/${API_VERSION}/ideogram-v3/edit`,
  REMIX_V3: `/${API_VERSION}/ideogram-v3/remix`,
  REFRAME_V3: `/${API_VERSION}/ideogram-v3/reframe`,
  REPLACE_BACKGROUND_V3: `/${API_VERSION}/ideogram-v3/replace-background`,
  DESCRIBE: '/describe',
  // v2 endpoints (Ideogram 4.0 / 4.5 / automatic model selection)
  GENERATE_V4: '/v2/image/generate/ideogram-4',
  GENERATE_V4_TRANSPARENT: '/v2/image/generate/ideogram-4-transparent',
  GENERATE_V4_CUSTOM: '/v2/image/generate/ideogram-4-custom-model',
  GENERATE_V45: '/v2/image/generate/ideogram-4-5',
  GENERATE_V46: '/v2/image/generate/ideogram-4-6',
  GENERATE_AUTO: '/v2/image/generate/auto',
  PRECISE_EDIT_V45: '/v2/image/precise-edit/ideogram-4-5',
  PRECISE_EDIT_V46: '/v2/image/precise-edit/ideogram-4-6',
  // Replaced the retired v1 '/upscale' in 2.0.
  UPSCALE_AUTO: '/v2/image/upscale/auto',
  GENERATE_SVG: '/v2/svg/generate/ideogram-vector-1',
  VIDEO_MINIMAX_H3_TEXT: '/v2/video/generate/minimax-h3-text-to-video',
  VIDEO_MINIMAX_H3_IMAGE: '/v2/video/generate/minimax-h3-image-to-video',
  VIDEO_MINIMAX_H3_REFERENCE: '/v2/video/generate/minimax-h3-reference-to-video',
  VIDEO_SEEDANCE_25_TEXT: '/v2/video/generate/seedance-2-5-text-to-video',
  VIDEO_SEEDANCE_25_IMAGE: '/v2/video/generate/seedance-2-5-image-to-video',
  VIDEO_SEEDANCE_25_REFERENCE: '/v2/video/generate/seedance-2-5-reference-to-video',
  GENERATIONS: '/v2/generations',
} as const;

/** Valid resolutions for Ideogram 3.0. */
export const RESOLUTIONS = [
  '512x1536', '576x1408', '576x1472', '576x1536',
  '640x1344', '640x1408', '640x1472', '640x1536',
  '704x1152', '704x1216', '704x1280', '704x1344', '704x1408', '704x1472',
  '736x1312', '768x1088', '768x1216', '768x1280', '768x1344',
  '800x1280', '832x960', '832x1024', '832x1088', '832x1152', '832x1216', '832x1248',
  '864x1152', '896x960', '896x1024', '896x1088', '896x1120', '896x1152',
  '960x832', '960x896', '960x1024', '960x1088',
  '1024x832', '1024x896', '1024x960', '1024x1024',
  '1088x768', '1088x832', '1088x896', '1088x960',
  '1120x896', '1152x704', '1152x832', '1152x864', '1152x896',
  '1216x704', '1216x768', '1216x832',
  '1248x832', '1280x704', '1280x768', '1280x800',
  '1312x736', '1344x640', '1344x704', '1344x768',
  '1408x576', '1408x640', '1408x704',
  '1472x576', '1472x640', '1472x704',
  '1536x512', '1536x576', '1536x640',
] as const;

/** Valid aspect ratios for Ideogram 3.0. */
export const ASPECT_RATIOS = [
  '1x3', '3x1', '1x2', '2x1', '9x16', '16x9', '10x16', '16x10',
  '2x3', '3x2', '3x4', '4x3', '4x5', '5x4', '1x1',
] as const;

/** Rendering speeds (v1; the v2 API uses the lowercase V4_RENDERING_SPEEDS). */
export const RENDERING_SPEEDS = ['FLASH', 'TURBO', 'DEFAULT', 'QUALITY'] as const;

/** Magic prompt options (v1; the v2 API uses the lowercase V2_MAGIC_PROMPT_MODES). */
export const MAGIC_PROMPT_OPTIONS = ['AUTO', 'ON', 'OFF'] as const;

/** Style types (v1). */
export const STYLE_TYPES = ['AUTO', 'GENERAL', 'REALISTIC', 'DESIGN', 'FICTION'] as const;

/** Style presets (52 total). */
export const STYLE_PRESETS = [
  '80S_ILLUSTRATION', '90S_NOSTALGIA', 'ABSTRACT_ORGANIC', 'ANALOG_NOSTALGIA',
  'ART_BRUT', 'ART_DECO', 'ART_POSTER', 'AURA', 'AVANT_GARDE', 'BAUHAUS',
  'BLUEPRINT', 'BLURRY_MOTION', 'BRIGHT_ART', 'C4D_CARTOON', 'CHILDRENS_BOOK',
  'COLLAGE', 'COLORING_BOOK_I', 'COLORING_BOOK_II', 'CUBISM', 'DARK_AURA',
  'DOODLE', 'DOUBLE_EXPOSURE', 'DRAMATIC_CINEMA', 'EDITORIAL', 'EMOTIONAL_MINIMAL',
  'ETHEREAL_PARTY', 'EXPIRED_FILM', 'FLAT_ART', 'FLAT_VECTOR', 'FOREST_REVERIE',
  'GEO_MINIMALIST', 'GLASS_PRISM', 'GOLDEN_HOUR', 'GRAFFITI_I', 'GRAFFITI_II',
  'HALFTONE_PRINT', 'HIGH_CONTRAST', 'HIPPIE_ERA', 'ICONIC', 'JAPANDI_FUSION',
  'JAZZY', 'LONG_EXPOSURE', 'MAGAZINE_EDITORIAL', 'MINIMAL_ILLUSTRATION',
  'MIXED_MEDIA', 'MONOCHROME', 'NIGHTLIFE', 'OIL_PAINTING', 'OLD_CARTOONS',
  'PAINT_GESTURE', 'POP_ART', 'RETRO_ETCHING', 'RIVIERA_POP', 'SPOTLIGHT_80S',
  'STYLIZED_RED', 'SURREAL_COLLAGE', 'TRAVEL_POSTER', 'VINTAGE_GEO',
  'VINTAGE_POSTER', 'WATERCOLOR', 'WEIRD', 'WOODBLOCK_PRINT',
] as const;

/** Color palette preset names (v1, uppercase; v2 uses V2_COLOR_PALETTE_PRESETS). */
export const COLOR_PALETTE_PRESETS = [
  'EMBER', 'FRESH', 'JUNGLE', 'MAGIC', 'MELON', 'MOSAIC', 'PASTEL', 'ULTRAMARINE',
] as const;

/** Model versions the describe endpoint accepts. */
export const DESCRIBE_MODEL_VERSIONS = ['V_2', 'V_3'] as const;

// ==================== V2 (Ideogram 4.x / auto / SVG / video) ====================
// Values from the v2 OpenAPI document (2026-11-08; re-read 2026-11-22 for 4.6,
// SVG, video and the auto / precise-edit changes). The API client does NOT
// reject values outside these lists (Ideogram validates server-side and may
// add values); validateV2Params, which the CLI runs, does.

/** Ideogram 4.0 resolutions (ResolutionV4, 38 values); also the 4.5 presets. */
export const V4_RESOLUTIONS = [
  '2048x2048', '1440x2880', '2880x1440', '1664x2496', '2496x1664', '1792x2240',
  '2240x1792', '1440x2560', '2560x1440', '1600x2560', '2560x1600', '1728x2304',
  '2304x1728', '1296x3168', '3168x1296', '1152x2944', '2944x1152', '1248x3328',
  '3328x1248', '1280x3072', '3072x1280', '1024x3072', '3072x1024', '1024x1024',
  '896x1120', '1120x896', '864x1152', '1152x864', '832x1248', '1248x832',
  '800x1280', '1280x800', '720x1280', '1280x720', '720x1440', '1440x720',
  '512x1536', '1536x512',
] as const;

/** Ideogram 4.0 aspect ratios (IdeogramV4AspectRatio). */
export const V4_ASPECT_RATIOS = [
  'auto', '1x4', '1x3', '1x2', '9x16', '10x16', '2x3', '3x4', '4x5', '1x1',
  '5x4', '4x3', '3x2', '16x10', '16x9', '2x1', '3x1', '4x1',
] as const;

/** Ideogram 4.0 rendering speeds (v2, lowercase). */
export const V4_RENDERING_SPEEDS = ['turbo', 'default', 'quality'] as const;
/** Magic prompt modes on the v2 API (lowercase). */
export const V2_MAGIC_PROMPT_MODES = ['auto', 'on', 'off'] as const;
/** Pixel-budget tiers for Ideogram 4.0 transparent generation; above 2k is upscaled. */
export const V4_OUTPUT_RESOLUTIONS = ['1k', '2k', '4k', '8k'] as const;
/** Quality levels for Ideogram 4.5 / 4.6 generate and precise-edit. */
export const V45_QUALITIES = ['very_low', 'low', 'medium', 'high'] as const;
/** Background modes for Ideogram 4.5 / 4.6 generate. */
export const V45_BACKGROUNDS = ['auto', 'transparent', 'opaque'] as const;
/** Resolution tiers for automatic model selection (generate-auto). */
export const AUTO_RESOLUTION_TIERS = ['1k', '2k', '4k'] as const;

/** Ideogram 4.6 named sizes (besides an exact 'WIDTHxHEIGHT'). 4.5 has only 'auto' and 'source'. */
export const V46_SIZES = ['auto', 'auto_2k', 'auto_4k', 'source'] as const;

/** Style types for automatic model selection (IdeogramV3StyleType, lowercase on v2). */
export const AUTO_STYLE_TYPES = [
  'auto', 'general', 'realistic', 'design', 'custom', 'fiction', 'stylized',
] as const;

/** v2 color palette preset names (lowercase; v3's are uppercase). */
export const V2_COLOR_PALETTE_PRESETS = [
  'ember', 'fresh', 'jungle', 'magic', 'melon', 'mosaic', 'pastel', 'ultramarine',
] as const;

/** Quality levels for SVG generation (Ideogram Vector 1). */
export const SVG_QUALITIES = ['low', 'medium', 'high'] as const;
/** Enlargement factors the v2 upscaler accepts. */
export const UPSCALE_FACTORS = ['x2', 'x4', 'x8'] as const;
/** Types of an existing Ideogram asset used as a source (TYPE:ID[:COLLECTION]). */
export const ASSET_TYPES = ['ASSET', 'CANVAS_ASSET', 'LAYERED_ASSET', 'RESPONSE', 'UPLOAD'] as const;

/** Aspect ratios for MiniMax H3 video. */
export const MINIMAX_H3_ASPECT_RATIOS = ['21x9', '16x9', '4x3', '1x1', '3x4', '9x16'] as const;
/** Resolution tiers for MiniMax H3 video. */
export const MINIMAX_H3_RESOLUTIONS = ['480P', '768P', '2K', '4K'] as const;
/** Prompt expansion modes for MiniMax H3 video. */
export const MINIMAX_H3_PROMPT_EXPANSION_MODES = ['disabled', 'fast', 'balanced', 'quality'] as const;
/** Aspect ratios for Seedance 2.5 video. */
export const SEEDANCE_25_ASPECT_RATIOS = ['auto', '21x9', '16x9', '4x3', '1x1', '3x4', '9x16'] as const;
/** Resolution tiers for Seedance 2.5 video. */
export const SEEDANCE_25_RESOLUTIONS = ['480p', '720p', '1080p'] as const;

const MiB = 1024 * 1024;

/** Documented v2 limits (counts in files, sizes in bytes, areas in pixels). */
export const V2_LIMITS = {
  promptMaxLength: 10000,
  numImages: { min: 1, max: 8 },
  seed: { min: 0, max: 2147483647 },
  webhookUrlMaxLength: 2048,
  customModelUriMaxLength: 512,
  v45: { maxImages: 5, maxImagesWithMask: 4, maxFileBytes: 25 * MiB },
  /** 4.6 generate: same counts as 4.5; exact sizes up to 4096x4096 and 8192 per side (2048x2048 / 4608 at very_low). */
  v46: {
    maxImages: 5,
    maxImagesWithMask: 4,
    maxFileBytes: 25 * MiB,
    maxPixels: 16777216,
    maxSide: 8192,
    veryLowMaxPixels: 4194304,
    veryLowMaxSide: 4608,
  },
  auto: { maxImages: 10, maxFileBytes: 25 * MiB },
  preciseEdit: {
    maxReferenceImages: 4,
    maxReferenceImagesWithMask: 3,
    maxFileBytes: 50 * MiB,
    maxImagePixels: 67108864,
  },
  /** 4.6 precise edit: the whole-image / context-window bound is 4096x4096 (2048x2048 and 4608 per side at very_low). */
  preciseEditV46: {
    maxEditPixels: 16777216,
    veryLowMaxEditPixels: 4194304,
    veryLowMaxSide: 4608,
  },
  svg: { promptMaxLength: 9500 },
  upscale: { maxFileBytes: 50 * MiB, maxOutputSide: 8192 },
  /** Undocumented: the spec gives no per-file limit for SVG source images; this is the client's own 50MB loader cap. */
  svgMaxFileBytes: 50 * MiB,
  minimaxH3: {
    promptMaxLength: 2000,
    duration: { min: 5, max: 15 },
    maxFileBytes: 50 * MiB,
    maxAudioBytes: 15 * MiB,
    maxAudios: 3,
    /** Across images, videos and audio. */
    maxReferences: 12,
  },
  seedance25: {
    promptMaxLength: 30000,
    duration: { min: 4, max: 30 },
    maxFileBytes: 50 * MiB,
    maxAudioBytes: 15 * MiB,
  },
  /** Area bound for a 4.5 edit / exact size: 2048x2048. */
  maxEditPixels: 4194304,
  minSide: 256,
  maxAspect: 6,
} as const;

/** Prompt length limit for a v2 operation. */
function promptMaxLengthFor(operation: V2OperationKey): number {
  if (operation === 'generate-svg') return V2_LIMITS.svg.promptMaxLength;
  if (operation.startsWith('minimax-h3-')) return V2_LIMITS.minimaxH3.promptMaxLength;
  if (operation.startsWith('seedance-2-5-')) return V2_LIMITS.seedance25.promptMaxLength;
  return V2_LIMITS.promptMaxLength;
}

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
  imageAssetIdentifiers?: Array<{ asset_type?: string; asset_id?: string; collection_id?: string }>;
  /** Video: length in seconds. */
  duration?: number;
  /** Video reference-to-video: number of reference audio files. */
  referenceAudioCount?: number;
  /** minimax-h3-reference-to-video */
  promptExpansionMode?: string;
}

/**
 * Membership test for a literal tuple: `list.includes(x)` rejects a plain string argument.
 *
 * @param list - The allowed values (e.g. a `V45_QUALITIES` tuple)
 * @param value - The string to look for
 * @returns True when `value` is in `list`
 *
 * @example
 * isOneOf(V45_QUALITIES, userInput); // true for 'high', false for 'best'
 */
export function isOneOf(list: readonly string[], value: string): boolean {
  return list.includes(value);
}

function checkEnum(name: string, value: string | undefined, allowed: readonly string[]): void {
  if (value !== undefined && !isOneOf(allowed, value)) {
    throw new Error(`Invalid ${name} '${value}'. Must be one of: ${allowed.join(', ')}`);
  }
}

function checkIntRange(name: string, value: number | undefined, min: number, max: number): void {
  if (value !== undefined && (!Number.isInteger(value) || value < min || value > max)) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
}

function parseDims(value: string): [number, number] | null {
  const m = /^(\d+)x(\d+)$/.exec(value);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

/** Area and side bounds for a context window or exact size. */
export interface PixelBounds {
  /** Maximum width x height. */
  maxPixels: number;
  /** Maximum length of either side, when the model has one. */
  maxSide?: number;
}

/**
 * Whole-image edit bound for a precise-edit model at a quality.
 *
 * @param model - Precise-edit model, '4.5' or '4.6'
 * @param quality - 4.6 only: 'very_low' has a smaller area and a side limit
 * @returns The pixel-area bound, plus `maxSide` when the model has one
 *
 * @example
 * preciseEditBounds('4.6', 'very_low'); // { maxPixels: ..., maxSide: ... }
 * preciseEditBounds('4.5');             // { maxPixels: 4194304 }
 */
export function preciseEditBounds(model: '4.5' | '4.6', quality?: string): PixelBounds {
  if (model === '4.5') return { maxPixels: V2_LIMITS.maxEditPixels };
  const L = V2_LIMITS.preciseEditV46;
  return quality === 'very_low'
    ? { maxPixels: L.veryLowMaxEditPixels, maxSide: L.veryLowMaxSide }
    : { maxPixels: L.maxEditPixels };
}

/**
 * Parse an explicit precise-edit context window `y_min,x_min,y_max,x_max`.
 * Returns null for 'none' / 'auto'. Throws on a malformed or out-of-rule region.
 * Bounds against the image itself need its dimensions; pass them when known.
 * `bounds` defaults to the Ideogram 4.5 limit (2048x2048 pixels); use
 * preciseEditBounds('4.6', quality) for 4.6.
 *
 * @param value - `y_min,x_min,y_max,x_max` in pixels, or 'none' / 'auto'
 * @param imageDims - The image's size, to check the region against it when known
 * @param bounds - Area and side limits (default: the 4.5 limit)
 * @returns The parsed region, or null for 'none' / 'auto'
 * @throws Error if the region is malformed or breaks a size rule
 *
 * @example
 * parseContextWindow('0,0,512,512', { width: 1024, height: 1024 });
 * // { yMin: 0, xMin: 0, yMax: 512, xMax: 512 }
 * parseContextWindow('auto'); // null
 */
export function parseContextWindow(
  value: string,
  imageDims?: { width: number; height: number },
  bounds: PixelBounds = { maxPixels: V2_LIMITS.maxEditPixels }
): { yMin: number; xMin: number; yMax: number; xMax: number } | null {
  if (value === 'none' || value === 'auto') return null;
  const m = /^(\d+),(\d+),(\d+),(\d+)$/.exec(value);
  if (!m) {
    throw new Error(
      `Invalid contextWindow '${value}'. Use 'none', 'auto', or 'y_min,x_min,y_max,x_max'`
    );
  }
  const [yMin, xMin, yMax, xMax] = m.slice(1).map(Number);
  const w = xMax - xMin;
  const h = yMax - yMin;
  if (w < V2_LIMITS.minSide || h < V2_LIMITS.minSide) {
    throw new Error(
      `contextWindow region must be at least ${V2_LIMITS.minSide}px on each side (got ${w}x${h}; rows come first: y_min,x_min,y_max,x_max)`
    );
  }
  if (Math.max(w / h, h / w) > V2_LIMITS.maxAspect) {
    throw new Error('contextWindow region aspect ratio must be between 1:6 and 6:1');
  }
  if (w * h > bounds.maxPixels) {
    const side = Math.sqrt(bounds.maxPixels);
    throw new Error(
      `contextWindow region covers ${w * h} pixels; the maximum is ${bounds.maxPixels} (${side}x${side})`
    );
  }
  if (bounds.maxSide !== undefined && Math.max(w, h) > bounds.maxSide) {
    throw new Error(`contextWindow region sides must be at most ${bounds.maxSide}px`);
  }
  if (imageDims && (xMax > imageDims.width || yMax > imageDims.height)) {
    throw new Error(
      `contextWindow region ${value} lies outside the ${imageDims.width}x${imageDims.height} image`
    );
  }
  return { yMin, xMin, yMax, xMax };
}

/** Rules shared by 4.5 and 4.6 generate for source images and the mask. */
function checkV4xImages(params: V2ValidationParams, maxImages: number, maxWithMask: number): number {
  const count = params.imageCount ?? 0;
  if (count > maxImages) {
    throw new Error(`At most ${maxImages} source images are allowed`);
  }
  if (params.hasMask) {
    if (count === 0) throw new Error('A mask requires at least one source image');
    if (count > maxWithMask) {
      throw new Error(
        `A masked request allows at most ${maxWithMask - 1} source images besides the first`
      );
    }
    if (params.size !== undefined) {
      throw new Error("size cannot be set with a mask (the output is the first source image's size)");
    }
  }
  return count;
}

/** Validate an exact 'WIDTHxHEIGHT' size: multiples of 32, >= 256px, aspect <= 6:1, and the given bounds. */
function checkExactSize(size: string, bounds: PixelBounds, allowed: string): void {
  const dims = parseDims(size);
  if (!dims) {
    throw new Error(`Invalid size '${size}'. Use ${allowed} or 'WIDTHxHEIGHT'`);
  }
  const [w, h] = dims;
  const L = V2_LIMITS;
  if (w % 32 !== 0 || h % 32 !== 0) throw new Error('size sides must be multiples of 32');
  if (w < L.minSide || h < L.minSide) throw new Error(`size sides must be at least ${L.minSide}px`);
  if (bounds.maxSide !== undefined && Math.max(w, h) > bounds.maxSide) {
    throw new Error(`size sides must be at most ${bounds.maxSide}px`);
  }
  if (w * h > bounds.maxPixels) {
    const side = Math.sqrt(bounds.maxPixels);
    throw new Error(`size must total at most ${side}x${side} pixels`);
  }
  if (Math.max(w / h, h / w) > L.maxAspect) throw new Error('size aspect ratio must be at most 6:1');
}

/** Validate an optional v2 color palette (undefined passes). */
function checkColorPalette(palette: unknown): void {
  if (palette === undefined) return;
  assertColorPalette(palette);
}

/**
 * Assert that a value is a v2 color palette: a preset name, `{ name }`, or
 * `{ members: [{ color_hex, color_weight? }] }`.
 *
 * @param palette - The value to check
 * @returns Nothing; narrows `palette` to `V2ColorPalette` when it returns
 * @throws Error describing the first violated rule
 *
 * @example
 * assertColorPalette({ members: [{ color_hex: '#FF0000', color_weight: 0.5 }] });
 */
export function assertColorPalette(palette: unknown): asserts palette is V2ColorPalette {
  if (typeof palette === 'string') {
    checkEnum('color palette preset', palette, V2_COLOR_PALETTE_PRESETS);
    return;
  }
  if (typeof palette !== 'object' || palette === null) {
    throw new Error('colorPalette must be a preset name, { name }, or { members }');
  }
  const p = palette as { name?: unknown; members?: unknown };
  if ((p.name === undefined) === (p.members === undefined)) {
    throw new Error('colorPalette must set exactly one of name or members');
  }
  if (p.name !== undefined) {
    checkEnum('color palette preset', String(p.name), V2_COLOR_PALETTE_PRESETS);
    return;
  }
  if (!Array.isArray(p.members) || p.members.length === 0) {
    throw new Error('colorPalette.members must be a non-empty array');
  }
  for (const member of p.members as Array<{ color_hex?: unknown; color_weight?: unknown }>) {
    if (typeof member?.color_hex !== 'string' || !/^#(?:[0-9a-fA-F]{3}){1,2}$/.test(member.color_hex)) {
      throw new Error(`Invalid color_hex '${String(member?.color_hex)}'. Use #RGB or #RRGGBB`);
    }
    if (member.color_weight !== undefined) {
      const w = member.color_weight;
      if (typeof w !== 'number' || w < 0.05 || w > 1) {
        throw new Error('color_weight must be a number between 0.05 and 1');
      }
    }
  }
}

/**
 * Validate parameters for a v2 operation against the documented rules.
 * Catches mistakes before a request is sent; the CLI runs it on every v2 command.
 * The API client does not call it, so library callers opt in.
 *
 * @param operation - The v2 operation the parameters are for (e.g. 'generate-v46')
 * @param params - The parameters, camelCase as passed to the API method
 * @returns Nothing when the parameters are valid
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
export function validateV2Params(operation: V2OperationKey, params: V2ValidationParams): void {
  const L = V2_LIMITS;

  // Every v2 operation takes a prompt except the upscaler.
  if (operation !== 'upscale-auto') {
    if (!params.prompt || typeof params.prompt !== 'string') {
      throw new Error('Prompt is required and must be a string');
    }
    const promptMax = promptMaxLengthFor(operation);
    if (params.prompt.length > promptMax) {
      throw new Error(`Prompt exceeds maximum length of ${promptMax} characters`);
    }
  }
  if (params.numImages !== undefined) {
    const n = params.numImages;
    if (!Number.isInteger(n) || n < L.numImages.min || n > L.numImages.max) {
      throw new Error(`numImages must be an integer between ${L.numImages.min} and ${L.numImages.max}`);
    }
  }
  if (params.seed !== undefined) {
    const s = params.seed;
    if (!Number.isInteger(s) || s < L.seed.min || s > L.seed.max) {
      throw new Error(`seed must be an integer between ${L.seed.min} and ${L.seed.max}`);
    }
  }
  checkEnum('magic prompt mode', params.magicPrompt, V2_MAGIC_PROMPT_MODES);

  if (params.webhookUrl !== undefined) {
    if (operation === 'generate-auto') {
      throw new Error('The auto endpoint does not accept a webhook URL');
    }
    if (!params.webhookUrl.startsWith('https://')) {
      throw new Error('webhookUrl must be an HTTPS URL');
    }
    if (params.webhookUrl.length > L.webhookUrlMaxLength) {
      throw new Error(`webhookUrl exceeds ${L.webhookUrlMaxLength} characters`);
    }
  }

  switch (operation) {
    case 'generate-v4':
    case 'generate-v4-custom': {
      checkEnum('resolution', params.resolution, V4_RESOLUTIONS);
      checkEnum('rendering speed', params.renderingSpeed, V4_RENDERING_SPEEDS);
      if (operation === 'generate-v4-custom') {
        const uri = params.customModelUri;
        if (!uri || !/^model\/[^/]+\/version\/[^/]+$/.test(uri)) {
          throw new Error(
            "customModelUri is required, in the form 'model/<model_name>/version/<version_name>'"
          );
        }
        if (uri.length > L.customModelUriMaxLength) {
          throw new Error(`customModelUri exceeds ${L.customModelUriMaxLength} characters`);
        }
      }
      break;
    }
    case 'generate-v4-transparent': {
      checkEnum('aspect ratio', params.aspectRatio, V4_ASPECT_RATIOS);
      checkEnum('output resolution', params.outputResolution, V4_OUTPUT_RESOLUTIONS);
      checkEnum('rendering speed', params.renderingSpeed, V4_RENDERING_SPEEDS);
      break;
    }
    case 'generate-v45': {
      checkEnum('quality', params.quality, V45_QUALITIES);
      checkEnum('background', params.background, V45_BACKGROUNDS);
      const count = checkV4xImages(params, L.v45.maxImages, L.v45.maxImagesWithMask);
      if (params.quality === 'very_low' && count === 0) {
        throw new Error("quality 'very_low' requires source images");
      }
      if (params.size !== undefined && params.size !== 'auto') {
        if (params.size === 'source') {
          if (count === 0) throw new Error("size 'source' requires source images");
        } else {
          checkExactSize(params.size, { maxPixels: L.maxEditPixels }, "'auto', 'source'");
          if (count === 0 && !isOneOf(V4_RESOLUTIONS, params.size)) {
            throw new Error(
              `Without source images, an exact size must be a supported preset (see V4_RESOLUTIONS)`
            );
          }
        }
      }
      break;
    }
    case 'generate-v46': {
      // 4.6 differs from 4.5: 'very_low' needs no source images, 'auto_2k' /
      // 'auto_4k' exist, exact sizes need not be presets, and the bounds are
      // 4096x4096 / 8192 per side (2048x2048 / 4608 at very_low).
      checkEnum('quality', params.quality, V45_QUALITIES);
      checkEnum('background', params.background, V45_BACKGROUNDS);
      const count = checkV4xImages(params, L.v46.maxImages, L.v46.maxImagesWithMask);
      const veryLow = params.quality === 'very_low';
      const size = params.size;
      if (size === undefined || size === 'auto' || size === 'auto_2k') break;
      if (size === 'auto_4k') {
        if (veryLow) throw new Error("size 'auto_4k' is not available at quality 'very_low'");
        break;
      }
      if (size === 'source') {
        if (count === 0) throw new Error("size 'source' requires source images");
        break;
      }
      checkExactSize(
        size,
        veryLow
          ? { maxPixels: L.v46.veryLowMaxPixels, maxSide: L.v46.veryLowMaxSide }
          : { maxPixels: L.v46.maxPixels, maxSide: L.v46.maxSide },
        "'auto', 'auto_2k', 'auto_4k', 'source'"
      );
      break;
    }
    case 'generate-auto': {
      checkEnum('resolution tier', params.resolutionTier, AUTO_RESOLUTION_TIERS);
      checkEnum('style type', params.styleType, AUTO_STYLE_TYPES);
      checkColorPalette(params.colorPalette);
      const count = params.imageCount ?? 0;
      if (count > L.auto.maxImages) {
        throw new Error(`At most ${L.auto.maxImages} source images are allowed`);
      }
      if (count > 0) {
        if (params.negativePrompt !== undefined) {
          throw new Error('negativePrompt cannot be combined with source images');
        }
        if (params.styleType !== undefined) {
          throw new Error('styleType cannot be combined with source images');
        }
        if (params.colorPalette !== undefined) {
          throw new Error('colorPalette cannot be combined with source images');
        }
      }
      const ar = params.aspectRatio;
      if (ar !== undefined && ar !== 'auto') {
        if (params.resolution !== undefined) {
          throw new Error('Set either aspectRatio or resolution, not both');
        }
        if (!/^[1-9][0-9]{0,4}x[1-9][0-9]{0,4}$/.test(ar)) {
          throw new Error(`Invalid aspect ratio '${ar}'. Use 'auto' or 'WIDTHxHEIGHT' (e.g. 16x9)`);
        }
        if (count === 0) checkEnum('aspect ratio', ar, V4_ASPECT_RATIOS);
      }
      if (params.resolution !== undefined && !/^[1-9][0-9]{1,4}x[1-9][0-9]{1,4}$/.test(params.resolution)) {
        throw new Error(`Invalid resolution '${params.resolution}'. Use 'WIDTHxHEIGHT' (e.g. 1280x800)`);
      }
      break;
    }
    case 'precise-edit-v45':
    case 'precise-edit-v46': {
      checkEnum('quality', params.quality, V45_QUALITIES);
      if (params.hasImage === false) throw new Error('image is required');
      const refs = params.referenceImageCount ?? 0;
      const maxRefs = params.hasMask
        ? L.preciseEdit.maxReferenceImagesWithMask
        : L.preciseEdit.maxReferenceImages;
      if (refs > maxRefs) {
        throw new Error(
          `At most ${maxRefs} reference images are allowed${params.hasMask ? ' with a mask' : ''}`
        );
      }
      if (params.contextWindow !== undefined) {
        // 'auto' (the default) without a mask is legal: it edits the whole image, like 'none'.
        const model = operation === 'precise-edit-v46' ? '4.6' : '4.5';
        parseContextWindow(params.contextWindow, undefined, preciseEditBounds(model, params.quality));
      }
      break;
    }
    case 'upscale-auto': {
      if (params.hasImage === false) throw new Error('image is required');
      checkEnum('upscale factor', params.upscaleFactor, UPSCALE_FACTORS);
      break;
    }
    case 'generate-svg': {
      checkEnum('aspect ratio', params.aspectRatio, V4_ASPECT_RATIOS);
      checkEnum('quality', params.quality, SVG_QUALITIES);
      for (const id of params.imageAssetIdentifiers ?? []) {
        checkEnum('asset_type', id?.asset_type ?? '(missing)', ASSET_TYPES);
        if (!id.asset_id) throw new Error('Every image asset identifier needs an asset_id');
        if (id.collection_id !== undefined && !/^[A-Za-z0-9_-]{22}$/.test(id.collection_id)) {
          throw new Error(`Invalid collection_id '${id.collection_id}' (22 URL-safe base64 characters)`);
        }
      }
      break;
    }
    case 'minimax-h3-text-to-video':
    case 'minimax-h3-image-to-video':
    case 'minimax-h3-reference-to-video': {
      const M = L.minimaxH3;
      checkEnum('resolution', params.resolution, MINIMAX_H3_RESOLUTIONS);
      checkIntRange('duration', params.duration, M.duration.min, M.duration.max);
      if (operation === 'minimax-h3-image-to-video') {
        if (params.hasImage === false) throw new Error('image (the first frame) is required');
        break;
      }
      checkEnum('aspect ratio', params.aspectRatio, MINIMAX_H3_ASPECT_RATIOS);
      if (operation === 'minimax-h3-reference-to-video') {
        checkEnum('prompt expansion mode', params.promptExpansionMode, MINIMAX_H3_PROMPT_EXPANSION_MODES);
        const images = params.referenceImageCount ?? 0;
        const audios = params.referenceAudioCount ?? 0;
        if (audios > M.maxAudios) throw new Error(`At most ${M.maxAudios} reference audios are allowed`);
        if (audios > 0 && images === 0) throw new Error('Reference audio requires at least one reference image');
        if (images + audios > M.maxReferences) {
          throw new Error(`At most ${M.maxReferences} references are allowed across images and audio`);
        }
      }
      break;
    }
    case 'seedance-2-5-text-to-video':
    case 'seedance-2-5-image-to-video':
    case 'seedance-2-5-reference-to-video': {
      const D = L.seedance25.duration;
      checkEnum('resolution', params.resolution, SEEDANCE_25_RESOLUTIONS);
      checkIntRange('duration', params.duration, D.min, D.max);
      if (operation === 'seedance-2-5-image-to-video') {
        if (params.hasImage === false) throw new Error('image (the first frame) is required');
        break;
      }
      checkEnum('aspect ratio', params.aspectRatio, SEEDANCE_25_ASPECT_RATIOS);
      if (operation === 'seedance-2-5-reference-to-video' && (params.referenceImageCount ?? 0) === 0) {
        throw new Error('Seedance reference-to-video requires at least one reference image');
      }
      break;
    }
    default:
      throw new Error(`Unknown v2 operation: ${operation as string}`);
  }
}

/** Per-operation constraints for the v1 models, read by validateOperationParams. */
export const OPERATION_CONSTRAINTS: OperationConstraints = {
  'generate-v3': {
    prompt: { required: true, maxLength: 10000 },
    resolution: { options: RESOLUTIONS },
    aspectRatio: { options: ASPECT_RATIOS },
    renderingSpeed: { options: RENDERING_SPEEDS, default: 'DEFAULT' },
    magicPrompt: { options: MAGIC_PROMPT_OPTIONS, default: 'AUTO' },
    numImages: { min: 1, max: 8, default: 1 },
    styleType: { options: STYLE_TYPES },
    stylePreset: { options: STYLE_PRESETS },
    colorPalette: { presets: COLOR_PALETTE_PRESETS },
  },
  'edit-v3': {
    prompt: { required: true, maxLength: 10000 },
    image: { required: true, formats: ['JPEG', 'PNG', 'WebP', 'GIF'] },
    mask: { required: true, formats: ['JPEG', 'PNG', 'WebP', 'GIF'] },
    magicPrompt: { options: MAGIC_PROMPT_OPTIONS, default: 'AUTO' },
    numImages: { min: 1, max: 8, default: 1 },
    renderingSpeed: { options: RENDERING_SPEEDS, default: 'DEFAULT' },
    styleType: { options: STYLE_TYPES },
    stylePreset: { options: STYLE_PRESETS },
  },
  'remix-v3': {
    prompt: { required: true, maxLength: 10000 },
    image: { required: true, formats: ['JPEG', 'PNG', 'WebP', 'GIF'] },
    imageWeight: { min: 0, max: 100 },
    resolution: { options: RESOLUTIONS },
    aspectRatio: { options: ASPECT_RATIOS },
    renderingSpeed: { options: RENDERING_SPEEDS, default: 'DEFAULT' },
    magicPrompt: { options: MAGIC_PROMPT_OPTIONS, default: 'AUTO' },
    numImages: { min: 1, max: 8, default: 1 },
    styleType: { options: STYLE_TYPES },
    stylePreset: { options: STYLE_PRESETS },
  },
  'reframe-v3': {
    image: { required: true, formats: ['JPEG', 'PNG', 'WebP', 'GIF'], mustBeSquare: true },
    resolution: { required: true, options: RESOLUTIONS },
    numImages: { min: 1, max: 8, default: 1 },
    renderingSpeed: { options: RENDERING_SPEEDS, default: 'DEFAULT' },
    stylePreset: { options: STYLE_PRESETS },
  },
  'replace-background-v3': {
    prompt: { required: true, maxLength: 10000 },
    image: { required: true, formats: ['JPEG', 'PNG', 'WebP', 'GIF'] },
    magicPrompt: { options: MAGIC_PROMPT_OPTIONS, default: 'AUTO' },
    numImages: { min: 1, max: 8, default: 1 },
    renderingSpeed: { options: RENDERING_SPEEDS, default: 'DEFAULT' },
    stylePreset: { options: STYLE_PRESETS },
  },
  'describe': {
    image: { required: true, formats: ['JPEG', 'PNG', 'WebP', 'GIF'] },
    describeModelVersion: { options: DESCRIBE_MODEL_VERSIONS },
  },
};

/** Default output directory (can be overridden via the IDEOGRAM_OUTPUT_DIR environment variable). */
export const DEFAULT_OUTPUT_DIR = process.env.IDEOGRAM_OUTPUT_DIR || 'datasets/ideogram';

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
export function getIdeogramApiKey(cliApiKey: string | null = null): string {
  // Priority order:
  // 1. CLI flag (if provided and not empty)
  // 2. Environment variable
  const apiKey = (cliApiKey && cliApiKey.trim() !== '') ? cliApiKey : process.env.IDEOGRAM_API_KEY;

  if (!apiKey || (typeof apiKey === 'string' && apiKey.trim() === '')) {
    const errorMessage = [
      'IDEOGRAM_API_KEY not found. Please provide your API key via one of these methods:',
      '',
      '  1. CLI flag:           ideogram --api-key YOUR_KEY generate --prompt "..."',
      '  2. Environment var:    export IDEOGRAM_API_KEY=YOUR_KEY',
      '  3. Local .env file:    Create .env in current directory with IDEOGRAM_API_KEY=YOUR_KEY',
      '  4. Global config:      Create ~/.ideogram/.env with IDEOGRAM_API_KEY=YOUR_KEY',
      '',
      'Get your API key at https://ideogram.ai/api',
    ].join('\n');

    throw new Error(errorMessage);
  }

  return apiKey;
}

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
export function redactApiKey(apiKey: string): string {
  if (!apiKey || typeof apiKey !== 'string' || apiKey.length < 4) {
    return 'xxx...xxx';
  }
  return `xxx...${apiKey.slice(-4)}`;
}

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
export function validateOperationParams(operation: string, params: ValidationParams): void {
  const constraints = OPERATION_CONSTRAINTS[operation as OperationKey];

  if (!constraints) {
    throw new Error(`Unknown operation: ${operation}`);
  }

  // Validate prompt (if applicable)
  if (constraints.prompt?.required) {
    if (!params.prompt || typeof params.prompt !== 'string') {
      throw new Error('Prompt is required and must be a string');
    }
    if (params.prompt.length > constraints.prompt.maxLength) {
      throw new Error(`Prompt exceeds maximum length of ${constraints.prompt.maxLength} characters`);
    }
  }

  // Validate resolution (if provided)
  if (params.resolution && constraints.resolution?.options) {
    if (!constraints.resolution.options.includes(params.resolution)) {
      throw new Error(
        `Invalid resolution '${params.resolution}'. Must be one of the supported resolutions.`
      );
    }
  }

  // Validate aspect ratio (if provided)
  if (params.aspectRatio && constraints.aspectRatio?.options) {
    if (!constraints.aspectRatio.options.includes(params.aspectRatio)) {
      throw new Error(
        `Invalid aspect ratio '${params.aspectRatio}'. Must be one of: ${ASPECT_RATIOS.join(', ')}`
      );
    }
  }

  // Validate rendering speed (if provided)
  if (params.renderingSpeed && constraints.renderingSpeed?.options) {
    if (!constraints.renderingSpeed.options.includes(params.renderingSpeed)) {
      throw new Error(
        `Invalid rendering speed '${params.renderingSpeed}'. Must be one of: ${RENDERING_SPEEDS.join(', ')}`
      );
    }
  }

  // Validate magic prompt option (if provided)
  if (params.magicPrompt && constraints.magicPrompt?.options) {
    if (!constraints.magicPrompt.options.includes(params.magicPrompt)) {
      throw new Error(
        `Invalid magic prompt option '${params.magicPrompt}'. Must be one of: ${MAGIC_PROMPT_OPTIONS.join(', ')}`
      );
    }
  }

  // Validate number of images (if provided)
  if (params.numImages !== undefined && constraints.numImages) {
    const num = params.numImages;
    if (isNaN(num) || num < constraints.numImages.min || num > constraints.numImages.max) {
      throw new Error(
        `numImages must be between ${constraints.numImages.min} and ${constraints.numImages.max}`
      );
    }
  }

  // Validate style type (if provided)
  if (params.styleType && constraints.styleType?.options) {
    if (!constraints.styleType.options.includes(params.styleType)) {
      throw new Error(
        `Invalid style type '${params.styleType}'. Must be one of: ${STYLE_TYPES.join(', ')}`
      );
    }
  }

  // Validate style preset (if provided)
  if (params.stylePreset && constraints.stylePreset?.options) {
    if (!constraints.stylePreset.options.includes(params.stylePreset)) {
      throw new Error(
        `Invalid style preset '${params.stylePreset}'. Must be one of the supported presets.`
      );
    }
  }

  // Validate image weight (if provided)
  if (params.imageWeight !== undefined && constraints.imageWeight) {
    const weight = params.imageWeight;
    if (isNaN(weight) || weight < constraints.imageWeight.min || weight > constraints.imageWeight.max) {
      throw new Error(
        `imageWeight must be between ${constraints.imageWeight.min} and ${constraints.imageWeight.max}`
      );
    }
  }


}
