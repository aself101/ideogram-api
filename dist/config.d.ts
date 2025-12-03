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
import type { OperationConstraints, ValidationParams } from './types/index.js';
export declare const BASE_URL = "https://api.ideogram.ai";
export declare const API_VERSION = "v1";
export declare const ENDPOINTS: {
    readonly GENERATE_V3: "/v1/ideogram-v3/generate";
    readonly EDIT_V3: "/v1/ideogram-v3/edit";
    readonly REMIX_V3: "/v1/ideogram-v3/remix";
    readonly REFRAME_V3: "/v1/ideogram-v3/reframe";
    readonly REPLACE_BACKGROUND_V3: "/v1/ideogram-v3/replace-background";
    readonly UPSCALE: "/upscale";
    readonly DESCRIBE: "/describe";
};
export declare const RESOLUTIONS: readonly string[];
export declare const ASPECT_RATIOS: readonly string[];
export declare const RENDERING_SPEEDS: readonly string[];
export declare const MAGIC_PROMPT_OPTIONS: readonly string[];
export declare const STYLE_TYPES: readonly string[];
export declare const STYLE_PRESETS: readonly string[];
export declare const COLOR_PALETTE_PRESETS: readonly string[];
export declare const DESCRIBE_MODEL_VERSIONS: readonly string[];
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
 * @param operation - Operation name (e.g., 'generate-v3', 'edit-v3', 'upscale')
 * @param params - Parameters to validate
 * @throws Error if validation fails
 *
 * @example
 * validateOperationParams('generate-v3', { prompt: 'a cat', aspectRatio: '1:1' });
 * validateOperationParams('upscale', { image: './photo.jpg', resemblance: 55 });
 */
export declare function validateOperationParams(operation: string, params: ValidationParams): void;
//# sourceMappingURL=config.d.ts.map