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
import axios from 'axios';
import winston from 'winston';
import { BASE_URL, ENDPOINTS, redactApiKey } from './config.js';
import { buildFormData, loadImageAsBuffer, assertSquareImage } from './utils.js';
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
            throw new Error('API key is required');
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
            throw new Error('API key not set. Initialize IdeogramAPI with your API key.');
        }
    }
    /**
     * Make HTTP request to Ideogram API.
     * Handles multipart/form-data requests and error responses.
     *
     * @param endpoint - API endpoint path
     * @param formData - FormData object with request parameters
     * @returns API response
     * @throws Error if request fails
     */
    async _makeRequest(endpoint, formData) {
        this._verifyApiKey();
        const url = `${this.baseUrl}${endpoint}`;
        this.logger.debug(`Making request to: ${url}`);
        // Validate FormData size (maxBodyLength doesn't apply to streams)
        // FormData is streamed, but we can check known Buffer sizes before sending
        const MAX_REQUEST_SIZE = 50 * 1024 * 1024; // 50MB
        try {
            const formDataLength = formData.getLengthSync();
            if (formDataLength > MAX_REQUEST_SIZE) {
                throw new Error(`Request payload too large: ${(formDataLength / 1024 / 1024).toFixed(2)}MB exceeds maximum of 50MB`);
            }
        }
        catch (err) {
            const error = err;
            if (!error.message.includes('Request payload too large')) {
                this.logger.warn(`Could not compute FormData size: ${error.message}`);
            }
            else {
                throw err;
            }
        }
        try {
            const response = await axios.post(url, formData, {
                headers: {
                    'Api-Key': this.apiKey,
                    ...formData.getHeaders(),
                },
                timeout: 120000, // 2 minutes timeout
                maxContentLength: 100 * 1024 * 1024, // 100MB max response
                maxBodyLength: 50 * 1024 * 1024, // 50MB max request (backup, but doesn't apply to FormData)
            });
            // Validate Content-Type of response
            const contentType = response.headers['content-type'];
            if (!contentType || !contentType.includes('application/json')) {
                this.logger.warn(`Unexpected Content-Type in response: ${contentType}`);
                throw new Error('Invalid response format from API');
            }
            return response.data;
        }
        catch (error) {
            const axiosError = error;
            // Handle HTTP errors
            if (axiosError.response) {
                const status = axiosError.response.status;
                const message = axiosError.response.data?.message || axiosError.message;
                this.logger.error(`API request failed (${status}): ${message}`);
                // Map HTTP status codes to user-friendly errors
                if (status === 400) {
                    throw new Error(`Invalid input: ${message}`);
                }
                else if (status === 401) {
                    throw new Error('Authentication failed. Check API key.');
                }
                else if (status === 403) {
                    throw new Error('Not authorized to perform this operation.');
                }
                else if (status === 422) {
                    throw new Error(`Validation failed: ${message}`);
                }
                else if (status === 429) {
                    throw new Error('Rate limit exceeded. Too many requests.');
                }
                // Sanitize error in production
                if (process.env.NODE_ENV === 'production') {
                    throw new Error('Operation failed. Please try again.');
                }
                throw new Error(`API error (${status}): ${message}`);
            }
            // Network or other errors
            this.logger.error(`Request failed: ${axiosError.message}`);
            if (process.env.NODE_ENV === 'production') {
                throw new Error('Request failed. Please check your connection and try again.');
            }
            throw error;
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
     *   aspectRatio: '16:9',
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
    async upscale(params) {
        this.logger.info('Upscaling image');
        // Load image
        const imageBuffer = Buffer.isBuffer(params.image)
            ? params.image
            : await loadImageAsBuffer(params.image);
        // Build image_request object
        const imageRequest = {
            prompt: params.prompt,
            resemblance: params.resemblance,
            detail: params.detail,
            magic_prompt_option: params.magicPromptOption,
            num_images: params.numImages || 1,
            seed: params.seed,
        };
        const formData = buildFormData({
            image_file: imageBuffer,
            image_request: imageRequest,
        });
        const response = await this._makeRequest(ENDPOINTS.UPSCALE, formData);
        this.logger.info(`Upscaled image successfully (${response.data?.length || 0} results)`);
        return response;
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
export function extractImages(response) {
    return response.data || [];
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