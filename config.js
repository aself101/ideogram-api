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

// Load environment variables in priority order:
// 1. First try local .env in current directory
dotenv.config();

// 2. Then try global config in home directory (if local .env doesn't exist)
const globalConfigPath = join(homedir(), '.ideogram', '.env');
if (existsSync(globalConfigPath)) {
  dotenv.config({ path: globalConfigPath });
}

// Base API URL
export const BASE_URL = 'https://api.ideogram.ai';

// API Version
export const API_VERSION = 'v1';

// Ideogram API endpoints
export const ENDPOINTS = {
  GENERATE_V3: `/${API_VERSION}/ideogram-v3/generate`,
  EDIT_V3: `/${API_VERSION}/ideogram-v3/edit`,
  REMIX_V3: `/${API_VERSION}/ideogram-v3/remix`,
  REFRAME_V3: `/${API_VERSION}/ideogram-v3/reframe`,
  REPLACE_BACKGROUND_V3: `/${API_VERSION}/ideogram-v3/replace-background`,
  UPSCALE: '/upscale',
  DESCRIBE: '/describe'
};

// Valid resolutions for Ideogram 3.0
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
  '1536x512', '1536x576', '1536x640'
];

// Valid aspect ratios for Ideogram 3.0
export const ASPECT_RATIOS = [
  '1x3', '3x1', '1x2', '2x1', '9x16', '16x9', '10x16', '16x10',
  '2x3', '3x2', '3x4', '4x3', '4x5', '5x4', '1x1'
];

// Rendering speeds
export const RENDERING_SPEEDS = ['FLASH', 'TURBO', 'DEFAULT', 'QUALITY'];

// Magic prompt options
export const MAGIC_PROMPT_OPTIONS = ['AUTO', 'ON', 'OFF'];

// Style types
export const STYLE_TYPES = ['AUTO', 'GENERAL', 'REALISTIC', 'DESIGN', 'FICTION'];

// Style presets (52 total)
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
  'VINTAGE_POSTER', 'WATERCOLOR', 'WEIRD', 'WOODBLOCK_PRINT'
];

// Color palette preset names
export const COLOR_PALETTE_PRESETS = [
  'EMBER', 'FRESH', 'JUNGLE', 'MAGIC', 'MELON', 'MOSAIC', 'PASTEL', 'ULTRAMARINE'
];

// Describe model versions
export const DESCRIBE_MODEL_VERSIONS = ['V_2', 'V_3'];

// Model operation constraints
export const OPERATION_CONSTRAINTS = {
  'generate-v3': {
    prompt: { required: true, maxLength: 10000 },
    resolution: { options: RESOLUTIONS },
    aspectRatio: { options: ASPECT_RATIOS },
    renderingSpeed: { options: RENDERING_SPEEDS, default: 'DEFAULT' },
    magicPrompt: { options: MAGIC_PROMPT_OPTIONS, default: 'AUTO' },
    numImages: { min: 1, max: 8, default: 1 },
    styleType: { options: STYLE_TYPES },
    stylePreset: { options: STYLE_PRESETS },
    colorPalette: { presets: COLOR_PALETTE_PRESETS }
  },
  'edit-v3': {
    prompt: { required: true, maxLength: 10000 },
    image: { required: true, formats: ['JPEG', 'PNG', 'WebP', 'GIF'] },
    mask: { required: true, formats: ['JPEG', 'PNG', 'WebP', 'GIF'] },
    magicPrompt: { options: MAGIC_PROMPT_OPTIONS, default: 'AUTO' },
    numImages: { min: 1, max: 8, default: 1 },
    renderingSpeed: { options: RENDERING_SPEEDS, default: 'DEFAULT' },
    styleType: { options: STYLE_TYPES },
    stylePreset: { options: STYLE_PRESETS }
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
    stylePreset: { options: STYLE_PRESETS }
  },
  'reframe-v3': {
    image: { required: true, formats: ['JPEG', 'PNG', 'WebP', 'GIF'], mustBeSquare: true },
    resolution: { required: true, options: RESOLUTIONS },
    numImages: { min: 1, max: 8, default: 1 },
    renderingSpeed: { options: RENDERING_SPEEDS, default: 'DEFAULT' },
    stylePreset: { options: STYLE_PRESETS }
  },
  'replace-background-v3': {
    prompt: { required: true, maxLength: 10000 },
    image: { required: true, formats: ['JPEG', 'PNG', 'WebP', 'GIF'] },
    magicPrompt: { options: MAGIC_PROMPT_OPTIONS, default: 'AUTO' },
    numImages: { min: 1, max: 8, default: 1 },
    renderingSpeed: { options: RENDERING_SPEEDS, default: 'DEFAULT' },
    stylePreset: { options: STYLE_PRESETS }
  },
  'upscale': {
    image: { required: true, formats: ['JPEG', 'PNG', 'WebP', 'GIF'] },
    resemblance: { min: 0, max: 100 },
    detail: { min: 0, max: 100 },
    magicPromptOption: { options: MAGIC_PROMPT_OPTIONS },
    numImages: { min: 1, max: 4, default: 1 }
  },
  'describe': {
    image: { required: true, formats: ['JPEG', 'PNG', 'WebP', 'GIF'] },
    describeModelVersion: { options: DESCRIBE_MODEL_VERSIONS }
  }
};

// Default output directory (can be overridden via environment variable)
export const DEFAULT_OUTPUT_DIR = process.env.IDEOGRAM_OUTPUT_DIR || 'datasets/ideogram';

/**
 * Retrieve Ideogram API key from environment variables or CLI flag.
 *
 * @param {string} [cliApiKey] - Optional API key passed via CLI flag (highest priority)
 * @returns {string} The Ideogram API key
 * @throws {Error} If IDEOGRAM_API_KEY is not found in any location
 *
 * @example
 * const apiKey = getIdeogramApiKey();
 * const apiKey = getIdeogramApiKey('your_key'); // From CLI flag
 */
export function getIdeogramApiKey(cliApiKey = null) {
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
      'Get your API key at https://ideogram.ai/api'
    ].join('\n');

    throw new Error(errorMessage);
  }

  return apiKey;
}

/**
 * Redact API key for safe logging (show only last 4 characters).
 * CRITICAL SECURITY: Never log full API keys, even in DEBUG mode.
 *
 * @param {string} apiKey - The API key to redact
 * @returns {string} Redacted API key (e.g., "xxx...xyz")
 *
 * @example
 * redactApiKey('abcdef123456789'); // 'xxx...6789'
 */
export function redactApiKey(apiKey) {
  if (!apiKey || typeof apiKey !== 'string' || apiKey.length < 4) {
    return 'xxx...xxx';
  }
  return `xxx...${apiKey.slice(-4)}`;
}

/**
 * Validate operation-specific parameters before making API calls.
 * Catches invalid parameters early to save API credits.
 *
 * @param {string} operation - Operation name (e.g., 'generate-v3', 'edit-v3', 'upscale')
 * @param {Object} params - Parameters to validate
 * @throws {Error} If validation fails
 *
 * @example
 * validateOperationParams('generate-v3', { prompt: 'a cat', aspectRatio: '1:1' });
 * validateOperationParams('upscale', { image: './photo.jpg', resemblance: 55 });
 */
export function validateOperationParams(operation, params) {
  const constraints = OPERATION_CONSTRAINTS[operation];
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
    const num = parseInt(params.numImages);
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
    const weight = parseInt(params.imageWeight);
    if (isNaN(weight) || weight < constraints.imageWeight.min || weight > constraints.imageWeight.max) {
      throw new Error(
        `imageWeight must be between ${constraints.imageWeight.min} and ${constraints.imageWeight.max}`
      );
    }
  }

  // Validate resemblance (if provided)
  if (params.resemblance !== undefined && constraints.resemblance) {
    const resemblance = parseInt(params.resemblance);
    if (isNaN(resemblance) || resemblance < constraints.resemblance.min || resemblance > constraints.resemblance.max) {
      throw new Error(
        `resemblance must be between ${constraints.resemblance.min} and ${constraints.resemblance.max}`
      );
    }
  }

  // Validate detail (if provided)
  if (params.detail !== undefined && constraints.detail) {
    const detail = parseInt(params.detail);
    if (isNaN(detail) || detail < constraints.detail.min || detail > constraints.detail.max) {
      throw new Error(
        `detail must be between ${constraints.detail.min} and ${constraints.detail.max}`
      );
    }
  }
}

/* END */
