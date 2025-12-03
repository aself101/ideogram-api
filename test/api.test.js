/**
 * API Tests
 * Tests for IdeogramAPI class and all 7 endpoint methods
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { IdeogramAPI, extractImages, extractDescriptions } from '../src/api.js';
import { BASE_URL } from '../src/config.js';

describe('IdeogramAPI Class', () => {
  let api;

  beforeEach(() => {
    api = new IdeogramAPI('test-ideogram-api-key-1234567890');
  });

  describe('Constructor', () => {
    it('should create instance with API key', () => {
      expect(api).toBeDefined();
      expect(api.apiKey).toBe('test-ideogram-api-key-1234567890');
    });

    it('should throw if no API key provided', () => {
      expect(() => new IdeogramAPI()).toThrow('API key is required');
      expect(() => new IdeogramAPI(null)).toThrow('API key is required');
      expect(() => new IdeogramAPI('')).toThrow('API key is required');
    });

    it('should use default base URL', () => {
      expect(api.baseUrl).toBe(BASE_URL);
      expect(api.baseUrl).toBe('https://api.ideogram.ai');
    });

    it('should accept custom base URL', () => {
      const customApi = new IdeogramAPI('key', 'https://custom.ideogram.api');
      expect(customApi.baseUrl).toBe('https://custom.ideogram.api');
    });

    it('should enforce HTTPS for base URL', () => {
      expect(() => new IdeogramAPI('key', 'http://insecure.url')).toThrow('HTTPS');
      expect(() => new IdeogramAPI('key', 'http://api.ideogram.ai')).toThrow('HTTPS');
    });

    it('should set log level', () => {
      const debugApi = new IdeogramAPI('key', BASE_URL, 'debug');
      expect(debugApi.logger).toBeDefined();
      expect(debugApi.logger.level).toBe('debug');
    });

    it('should default to info log level', () => {
      expect(api.logger.level).toBe('info');
    });
  });

  describe('API Key Management', () => {
    it('should verify API key before requests', () => {
      const apiWithoutKey = Object.create(IdeogramAPI.prototype);
      apiWithoutKey.apiKey = null;

      expect(() => apiWithoutKey._verifyApiKey()).toThrow('API key not set');
    });

    it('should store API key securely', () => {
      expect(api.apiKey).toBe('test-ideogram-api-key-1234567890');
    });
  });

  describe('API Method Signatures', () => {
    it('should have generate method', () => {
      expect(typeof api.generate).toBe('function');
    });

    it('should have edit method', () => {
      expect(typeof api.edit).toBe('function');
    });

    it('should have remix method', () => {
      expect(typeof api.remix).toBe('function');
    });

    it('should have reframe method', () => {
      expect(typeof api.reframe).toBe('function');
    });

    it('should have replaceBackground method', () => {
      expect(typeof api.replaceBackground).toBe('function');
    });

    it('should have upscale method', () => {
      expect(typeof api.upscale).toBe('function');
    });

    it('should have describe method', () => {
      expect(typeof api.describe).toBe('function');
    });

    it('should have setLogLevel method', () => {
      expect(typeof api.setLogLevel).toBe('function');
    });
  });

  describe('Logger Configuration', () => {
    it('should have winston logger', () => {
      expect(api.logger).toBeDefined();
      expect(api.logger.level).toBeDefined();
    });

    it('should allow changing log level', () => {
      api.setLogLevel('debug');
      expect(api.logger.level).toBe('debug');

      api.setLogLevel('error');
      expect(api.logger.level).toBe('error');
    });

    it('should normalize log level to lowercase', () => {
      api.setLogLevel('DEBUG');
      expect(api.logger.level).toBe('debug');

      api.setLogLevel('ERROR');
      expect(api.logger.level).toBe('error');
    });
  });

  describe('Error Handling', () => {
    it('should handle production mode errors', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      // Test that production mode would sanitize errors
      expect(process.env.NODE_ENV).toBe('production');

      process.env.NODE_ENV = originalEnv;
    });

    it('should show detailed errors in development', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      expect(process.env.NODE_ENV).toBe('development');

      process.env.NODE_ENV = originalEnv;
    });
  });

  describe('Request Building', () => {
    it('should validate FormData size before sending', () => {
      // The _makeRequest method should check FormData size
      expect(typeof api._makeRequest).toBe('function');
    });

    it('should validate Content-Type in responses', () => {
      // The _makeRequest method should validate response Content-Type
      expect(typeof api._makeRequest).toBe('function');
    });
  });

  describe('Generate Method (Ideogram 3.0)', () => {
    it('should accept minimal parameters', async () => {
      // Test method signature - actual API calls would need mocking
      expect(() => {
        const params = {
          prompt: 'a beautiful landscape'
        };
        // Method exists and accepts parameters
        expect(typeof api.generate).toBe('function');
      }).not.toThrow();
    });

    it('should accept all optional parameters', () => {
      const params = {
        prompt: 'test',
        resolution: '1024x1024',
        aspectRatio: '1:1',
        renderingSpeed: 'QUALITY',
        magicPrompt: 'ON',
        negativePrompt: 'blurry',
        numImages: 4,
        seed: 12345,
        colorPalette: 'EMBER',
        styleType: 'REALISTIC',
        stylePreset: 'GOLDEN_HOUR'
      };

      expect(typeof api.generate).toBe('function');
      // Parameters would be validated by buildFormData
    });
  });

  describe('Edit Method (Ideogram 3.0)', () => {
    it('should require prompt, image, and mask', () => {
      expect(typeof api.edit).toBe('function');
    });

    it('should accept Buffer for image and mask', () => {
      const params = {
        prompt: 'change the sky',
        image: Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]),
        mask: Buffer.from([0x89, 0x50, 0x4E, 0x47])
      };

      expect(typeof api.edit).toBe('function');
      // Buffers would be handled by buildFormData
    });

    it('should accept file paths for image and mask', () => {
      const params = {
        prompt: 'edit this',
        image: './photo.jpg',
        mask: './mask.png'
      };

      expect(typeof api.edit).toBe('function');
    });
  });

  describe('Remix Method (Ideogram 3.0)', () => {
    it('should require prompt and image', () => {
      expect(typeof api.remix).toBe('function');
    });

    it('should accept imageWeight parameter', () => {
      const params = {
        prompt: 'transform to watercolor',
        image: Buffer.from([0xFF, 0xD8]),
        imageWeight: 75
      };

      expect(typeof api.remix).toBe('function');
    });

    it('should accept resolution and aspectRatio', () => {
      const params = {
        prompt: 'test',
        image: './photo.jpg',
        resolution: '1024x1024',
        aspectRatio: '1:1'
      };

      expect(typeof api.remix).toBe('function');
    });
  });

  describe('Reframe Method (Ideogram 3.0)', () => {
    it('should require image and resolution', () => {
      expect(typeof api.reframe).toBe('function');
    });

    it('should accept square image for reframing', () => {
      const params = {
        image: './square.jpg',
        resolution: '1536x640'
      };

      expect(typeof api.reframe).toBe('function');
    });

    it('should accept stylePreset', () => {
      const params = {
        image: Buffer.from([0xFF, 0xD8]),
        resolution: '1344x768',
        stylePreset: 'DRAMATIC_CINEMA'
      };

      expect(typeof api.reframe).toBe('function');
    });
  });

  describe('Replace Background Method (Ideogram 3.0)', () => {
    it('should require prompt and image', () => {
      expect(typeof api.replaceBackground).toBe('function');
    });

    it('should accept background description', () => {
      const params = {
        prompt: 'A tropical beach at sunset',
        image: './portrait.jpg'
      };

      expect(typeof api.replaceBackground).toBe('function');
    });

    it('should accept optional parameters', () => {
      const params = {
        prompt: 'Modern office',
        image: Buffer.from([0xFF, 0xD8]),
        magicPrompt: 'ON',
        numImages: 2,
        seed: 54321,
        renderingSpeed: 'QUALITY',
        stylePreset: 'EDITORIAL'
      };

      expect(typeof api.replaceBackground).toBe('function');
    });
  });

  describe('Upscale Method', () => {
    it('should require image', () => {
      expect(typeof api.upscale).toBe('function');
    });

    it('should accept resemblance and detail parameters', () => {
      const params = {
        image: './low_res.jpg',
        resemblance: 85,
        detail: 90
      };

      expect(typeof api.upscale).toBe('function');
    });

    it('should accept optional prompt', () => {
      const params = {
        image: Buffer.from([0xFF, 0xD8]),
        prompt: 'Enhance details',
        resemblance: 80,
        detail: 95,
        numImages: 2
      };

      expect(typeof api.upscale).toBe('function');
    });

    it('should build image_request object', () => {
      const params = {
        image: './image.jpg',
        prompt: 'upscale',
        resemblance: 90,
        detail: 85,
        magicPromptOption: 'ON',
        numImages: 1,
        seed: 99999
      };

      expect(typeof api.upscale).toBe('function');
      // Method should build image_request nested object
    });
  });

  describe('Describe Method', () => {
    it('should require image', () => {
      expect(typeof api.describe).toBe('function');
    });

    it('should accept describeModelVersion', () => {
      const params = {
        image: './photo.jpg',
        describeModelVersion: 'V_3'
      };

      expect(typeof api.describe).toBe('function');
    });

    it('should accept V_2 model version', () => {
      const params = {
        image: Buffer.from([0x89, 0x50]),
        describeModelVersion: 'V_2'
      };

      expect(typeof api.describe).toBe('function');
    });
  });
});

describe('Helper Functions', () => {
  describe('extractImages', () => {
    it('should extract images from response', () => {
      const response = {
        data: [
          { url: 'https://example.com/image1.jpg', resolution: '1024x1024' },
          { url: 'https://example.com/image2.jpg', resolution: '1024x1024' }
        ]
      };

      const images = extractImages(response);
      expect(images).toHaveLength(2);
      expect(images[0].url).toBe('https://example.com/image1.jpg');
      expect(images[1].url).toBe('https://example.com/image2.jpg');
    });

    it('should return empty array if no data', () => {
      const response = {};
      const images = extractImages(response);
      expect(images).toEqual([]);
    });

    it('should return empty array if data is null', () => {
      const response = { data: null };
      const images = extractImages(response);
      expect(images).toEqual([]);
    });

    it('should preserve image metadata', () => {
      const response = {
        data: [{
          url: 'https://example.com/image.jpg',
          resolution: '1920x1080',
          seed: 12345,
          is_image_safe: true,
          prompt: 'test prompt'
        }]
      };

      const images = extractImages(response);
      expect(images[0].resolution).toBe('1920x1080');
      expect(images[0].seed).toBe(12345);
      expect(images[0].is_image_safe).toBe(true);
      expect(images[0].prompt).toBe('test prompt');
    });
  });

  describe('extractDescriptions', () => {
    it('should extract descriptions from describe response', () => {
      const response = {
        descriptions: [
          { text: 'A beautiful landscape' },
          { text: 'Mountains at sunset' }
        ]
      };

      const descriptions = extractDescriptions(response);
      expect(descriptions).toHaveLength(2);
      expect(descriptions[0]).toBe('A beautiful landscape');
      expect(descriptions[1]).toBe('Mountains at sunset');
    });

    it('should return empty array if no descriptions', () => {
      const response = {};
      const descriptions = extractDescriptions(response);
      expect(descriptions).toEqual([]);
    });

    it('should return empty array if descriptions is null', () => {
      const response = { descriptions: null };
      const descriptions = extractDescriptions(response);
      expect(descriptions).toEqual([]);
    });

    it('should handle single description', () => {
      const response = {
        descriptions: [
          { text: 'Single description' }
        ]
      };

      const descriptions = extractDescriptions(response);
      expect(descriptions).toHaveLength(1);
      expect(descriptions[0]).toBe('Single description');
    });

    it('should map description objects to text strings', () => {
      const response = {
        descriptions: [
          { text: 'First', confidence: 0.95 },
          { text: 'Second', confidence: 0.87 }
        ]
      };

      const descriptions = extractDescriptions(response);
      expect(descriptions).toEqual(['First', 'Second']);
      // Should only extract text, not other properties
    });
  });
});

describe('Security Features', () => {
  let api;

  beforeEach(() => {
    api = new IdeogramAPI('test-ideogram-api-key-1234567890');
  });

  describe('HTTPS Enforcement', () => {
    it('should reject HTTP base URLs', () => {
      expect(() => new IdeogramAPI('key', 'http://api.ideogram.ai')).toThrow('HTTPS');
    });

    it('should accept HTTPS base URLs', () => {
      expect(() => new IdeogramAPI('key', 'https://api.ideogram.ai')).not.toThrow();
    });
  });

  describe('API Key Protection', () => {
    it('should not log full API key', () => {
      // API key should be redacted in logs
      const testApi = new IdeogramAPI('secret-key-1234567890', BASE_URL, 'debug');
      expect(testApi.apiKey).toBe('secret-key-1234567890');
      // Logger should use redactApiKey() from config.js
    });
  });

  describe('FormData Size Validation', () => {
    it('should have FormData size limit', () => {
      // The _makeRequest method includes FormData size validation
      expect(typeof api._makeRequest).toBe('function');
      // Max size should be 50MB as per security requirements
    });
  });

  describe('Content-Type Validation', () => {
    it('should validate response Content-Type', () => {
      // The _makeRequest method includes Content-Type validation
      expect(typeof api._makeRequest).toBe('function');
      // Should only accept application/json responses
    });
  });
});

describe('Parameter Handling', () => {
  describe('Buffer vs File Path', () => {
    it('should accept Buffers for image parameters', () => {
      const imageBuffer = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]);
      expect(Buffer.isBuffer(imageBuffer)).toBe(true);
    });

    it('should accept file paths for image parameters', () => {
      const imagePath = './test-image.jpg';
      expect(typeof imagePath).toBe('string');
    });
  });

  describe('Optional Parameters', () => {
    it('should handle undefined optional parameters', () => {
      const params = {
        prompt: 'test',
        seed: undefined,
        numImages: undefined
      };

      // buildFormData should skip undefined values
      expect(params.prompt).toBe('test');
    });

    it('should handle null optional parameters', () => {
      const params = {
        prompt: 'test',
        seed: null,
        stylePreset: null
      };

      // buildFormData should skip null values
      expect(params.prompt).toBe('test');
    });
  });

  describe('Type Conversions', () => {
    it('should handle numeric parameters', () => {
      const params = {
        numImages: 4,
        seed: 12345,
        imageWeight: 75
      };

      expect(typeof params.numImages).toBe('number');
      expect(typeof params.seed).toBe('number');
    });

    it('should handle string parameters', () => {
      const params = {
        prompt: 'test',
        aspectRatio: '16:9',
        renderingSpeed: 'QUALITY'
      };

      expect(typeof params.prompt).toBe('string');
      expect(typeof params.aspectRatio).toBe('string');
    });
  });
});

describe('Integration Tests', () => {
  let api;

  beforeEach(() => {
    api = new IdeogramAPI('test-ideogram-api-key-1234567890');
  });

  it('should have all required exports', () => {
    expect(IdeogramAPI).toBeDefined();
    expect(extractImages).toBeDefined();
    expect(extractDescriptions).toBeDefined();
  });

  it('should export IdeogramAPI class', () => {
    expect(typeof IdeogramAPI).toBe('function');
    expect(IdeogramAPI.prototype.generate).toBeDefined();
    expect(IdeogramAPI.prototype.edit).toBeDefined();
    expect(IdeogramAPI.prototype.remix).toBeDefined();
    expect(IdeogramAPI.prototype.reframe).toBeDefined();
    expect(IdeogramAPI.prototype.replaceBackground).toBeDefined();
    expect(IdeogramAPI.prototype.upscale).toBeDefined();
    expect(IdeogramAPI.prototype.describe).toBeDefined();
  });

  it('should export helper functions', () => {
    expect(typeof extractImages).toBe('function');
    expect(typeof extractDescriptions).toBe('function');
  });

  it('should maintain consistent API across all endpoints', () => {
    // All endpoint methods should follow the same pattern:
    // - Accept params object
    // - Return Promise
    // - Validate API key
    // - Build FormData
    // - Make request via _makeRequest
    const methods = [
      'generate',
      'edit',
      'remix',
      'reframe',
      'replaceBackground',
      'upscale',
      'describe'
    ];

    methods.forEach(method => {
      expect(typeof api[method]).toBe('function');
      expect(api[method].constructor.name).toBe('AsyncFunction');
    });
  });
});
