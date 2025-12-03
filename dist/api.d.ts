/**
 * Ideogram API Wrapper
 *
 * Provides a unified interface for Ideogram image generation API:
 * - Generate (v3): Text-to-image generation
 * - Edit (v3): Image editing with masks
 * - Remix (v3): Image remixing with prompts
 * - Reframe (v3): Reframe square images to different resolutions
 * - Replace Background (v3): Replace image backgrounds
 * - Upscale: Image upscaling with optional prompts
 * - Describe: Get descriptions of images
 *
 * All operations are synchronous (no polling required).
 */
import type { GenerateParams, EditParams, RemixParams, ReframeParams, ReplaceBackgroundParams, UpscaleParams, DescribeParams, GenerationResponse, DescribeResponse, ImageData } from './types/index.js';
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
     * @param logLevel - Logging level (debug, info, warn, error)
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
     * Make HTTP request to Ideogram API.
     * Handles multipart/form-data requests and error responses.
     *
     * @param endpoint - API endpoint path
     * @param formData - FormData object with request parameters
     * @returns API response
     * @throws Error if request fails
     */
    private _makeRequest;
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
     *   aspectRatio: '16:9',
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
     * Upscale image.
     * Enhance image resolution with optional prompt guidance.
     *
     * @param params - Upscale parameters
     * @returns Response with upscaled images
     * @throws Error if upscale fails
     *
     * @example
     * const response = await api.upscale({
     *   image: './low_res.jpg',
     *   resemblance: 85,
     *   detail: 90
     * });
     */
    upscale(params: UpscaleParams): Promise<GenerationResponse>;
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
     * Set logger level.
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
export type { IdeogramApiOptions, GenerateParams, EditParams, RemixParams, ReframeParams, ReplaceBackgroundParams, UpscaleParams, DescribeParams, BaseGenerationParams, GenerationResponse, DescribeResponse, ImageData, Description, RenderingSpeed, MagicPromptOption, StyleType, DescribeModelVersion, ColorPalette, ColorPalettePreset, CustomColorPalette, ValidationResult, ValidationParams, OperationConstraint, OperationConstraints, OperationKey, } from './types/index.js';
//# sourceMappingURL=api.d.ts.map