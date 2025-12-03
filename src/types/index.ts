/**
 * Ideogram API Type Definitions
 *
 * Comprehensive TypeScript types for the Ideogram API wrapper.
 */

// ==================== API CONFIGURATION TYPES ====================

/**
 * Options for initializing the IdeogramAPI class.
 */
export interface IdeogramApiOptions {
  /** Ideogram API key (required) */
  apiKey: string;
  /** API base URL (default: https://api.ideogram.ai) */
  baseUrl?: string;
  /** Logging level (debug, info, warn, error) */
  logLevel?: string;
}

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
export type ColorPalettePreset =
  | 'EMBER'
  | 'FRESH'
  | 'JUNGLE'
  | 'MAGIC'
  | 'MELON'
  | 'MOSAIC'
  | 'PASTEL'
  | 'ULTRAMARINE';

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

// ==================== GENERATION PARAMETER TYPES ====================

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

/**
 * Parameters for upscale operation.
 */
export interface UpscaleParams {
  /** Input image path or Buffer (required) */
  image: string | Buffer;
  /** Optional prompt for guided upscaling */
  prompt?: string;
  /** Resemblance to original (0-100) */
  resemblance?: number;
  /** Detail level (0-100) */
  detail?: number;
  /** Magic prompt option (AUTO, ON, OFF) */
  magicPromptOption?: MagicPromptOption;
  /** Number of images (1-4) */
  numImages?: number;
  /** Random seed */
  seed?: number;
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

// ==================== RESPONSE TYPES ====================

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

// ==================== OPERATION CONSTRAINTS TYPES ====================

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
  options: string[];
  default?: string;
  required?: boolean;
}

/**
 * Color palette constraint.
 */
export interface ColorPaletteConstraint {
  presets: string[];
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
export type OperationKey =
  | 'generate-v3'
  | 'edit-v3'
  | 'remix-v3'
  | 'reframe-v3'
  | 'replace-background-v3'
  | 'upscale'
  | 'describe';

/**
 * All operation constraints mapped by operation key.
 */
export type OperationConstraints = {
  [K in OperationKey]: OperationConstraint;
};

// ==================== VALIDATION TYPES ====================

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

// ==================== UTILITY TYPES ====================

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

// ==================== HTTP TYPES ====================

/**
 * Generic error status codes with messages.
 */
export interface GenericErrorMessages {
  [statusCode: number]: string;
}

/**
 * Axios error response data.
 */
export interface ApiErrorResponse {
  message?: string;
  detail?: unknown;
  error?: string;
}
