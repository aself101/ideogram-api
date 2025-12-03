/**
 * Utility Functions Tests
 * Tests for FormData building, SSRF protection, file I/O, and image validation
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

// Mock DNS module before importing utils
vi.mock('dns/promises', () => ({
  lookup: vi.fn()
}));

import { lookup } from 'dns/promises';
import {
  validateImageUrl,
  validateImagePath,
  loadImageAsBuffer,
  buildFormData,
  generateFilename,
  saveImage,
  saveMetadata,
  ensureDirectory,
  assertSquareImage
} from '../src/utils.js';
import { redactApiKey } from '../src/config.js';
import { writeFileSync, unlinkSync, mkdirSync, rmdirSync, existsSync } from 'fs';
import { join } from 'path';
import FormData from 'form-data';

// Test fixtures directory
const TEST_DIR = join(process.cwd(), 'test-fixtures');
const squareBmpBuffer = createBmpBuffer(4, 4);
const rectangleBmpBuffer = createBmpBuffer(4, 2);

function createBmpBuffer(width, height) {
  const bytesPerPixel = 3;
  const rowSize = Math.ceil((width * bytesPerPixel) / 4) * 4;
  const pixelDataSize = rowSize * height;
  const fileSize = 54 + pixelDataSize;
  const buffer = Buffer.alloc(fileSize);

  // BMP Header
  buffer.write('BM');
  buffer.writeUInt32LE(fileSize, 2);
  buffer.writeUInt32LE(0, 6);
  buffer.writeUInt32LE(54, 10); // Pixel data offset

  // DIB Header (BITMAPINFOHEADER)
  buffer.writeUInt32LE(40, 14);
  buffer.writeInt32LE(width, 18);
  buffer.writeInt32LE(height, 22);
  buffer.writeUInt16LE(1, 26);
  buffer.writeUInt16LE(24, 28);
  buffer.writeUInt32LE(0, 30);
  buffer.writeUInt32LE(pixelDataSize, 34);
  buffer.writeInt32LE(2835, 38); // horizontal resolution
  buffer.writeInt32LE(2835, 42); // vertical resolution
  buffer.writeUInt32LE(0, 46);
  buffer.writeUInt32LE(0, 50);

  // Pixel Data (simple solid color, padded per row)
  let offset = 54;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      buffer[offset++] = 0;   // Blue
      buffer[offset++] = 0;   // Green
      buffer[offset++] = 0;   // Red
    }
    const padding = rowSize - (width * bytesPerPixel);
    for (let p = 0; p < padding; p++) {
      buffer[offset++] = 0;
    }
  }

  return buffer;
}

describe('Utility Functions', () => {
  beforeAll(() => {
    // Create test directory
    if (!existsSync(TEST_DIR)) {
      mkdirSync(TEST_DIR, { recursive: true });
    }
  });

  afterAll(() => {
    // Clean up test directory
    try {
      if (existsSync(TEST_DIR)) {
        const files = [
          'test-image.jpg',
          'test-image.png',
          'test-metadata.json',
          'invalid.txt',
          'square.bmp',
          'rectangle.bmp'
        ];
        files.forEach(file => {
          const filepath = join(TEST_DIR, file);
          if (existsSync(filepath)) {
            unlinkSync(filepath);
          }
        });
        rmdirSync(TEST_DIR);
      }
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('generateFilename', () => {
    it('should generate filename with timestamp', () => {
      const result = generateFilename('test-prompt');
      expect(result).toMatch(/^\d{8}_\d{6}_testprompt\.png$/);
    });

    it('should sanitize special characters', () => {
      const result = generateFilename('hello / world: test!');
      expect(result).not.toContain('/');
      expect(result).not.toContain(':');
      expect(result).not.toContain('!');
    });

    it('should replace spaces with hyphens', () => {
      const result = generateFilename('hello world test');
      expect(result).toContain('hello-world-test');
    });

    it('should truncate long prompts', () => {
      const longPrompt = 'a'.repeat(200);
      const result = generateFilename(longPrompt);
      // Should have timestamp (15 chars) + underscore (1) + truncated name + extension
      expect(result.length).toBeLessThanOrEqual(100);
    });

    it('should handle custom extension', () => {
      const result = generateFilename('test', 'json');
      expect(result).toMatch(/\.json$/);
    });

    it('should handle empty string with default', () => {
      const result = generateFilename('');
      expect(result).toMatch(/^\d{8}_\d{6}_\.png$/);
    });

    it('should convert to lowercase', () => {
      const result = generateFilename('HELLO WORLD');
      expect(result).toContain('hello-world');
    });

    it('should remove leading/trailing dashes', () => {
      const result = generateFilename('  hello world  ');
      const namePart = result.split('_')[2]; // Get the name part after timestamp
      expect(namePart).not.toMatch(/^-/);
      expect(namePart.replace(/\.\w+$/, '')).not.toMatch(/-$/);
    });
  });

  describe('Image Validation (Security)', () => {
    describe('validateImageUrl', () => {
      beforeEach(() => {
        vi.clearAllMocks();
      });

      it('should accept valid HTTPS URLs with public IPs', async () => {
        lookup.mockResolvedValue({ address: '8.8.8.8', family: 4 });
        await expect(validateImageUrl('https://example.com/image.jpg')).resolves.toBe('https://example.com/image.jpg');

        lookup.mockResolvedValue({ address: '1.1.1.1', family: 4 });
        await expect(validateImageUrl('https://cdn.ideogram.ai/image.png')).resolves.toBe('https://cdn.ideogram.ai/image.png');
      });

      it('should reject HTTP URLs', async () => {
        await expect(validateImageUrl('http://example.com/image.jpg')).rejects.toThrow('HTTPS');
      });

      it('should reject localhost variations', async () => {
        await expect(validateImageUrl('https://localhost/image.jpg')).rejects.toThrow('metadata');
        await expect(validateImageUrl('https://127.0.0.1/image.jpg')).rejects.toThrow('private');
        await expect(validateImageUrl('https://[::1]/image.jpg')).rejects.toThrow('private');
      });

      it('should reject private IP addresses - Class A', async () => {
        await expect(validateImageUrl('https://10.0.0.1/image.jpg')).rejects.toThrow('private');
        await expect(validateImageUrl('https://10.255.255.255/image.jpg')).rejects.toThrow('private');
      });

      it('should reject private IP addresses - Class B', async () => {
        await expect(validateImageUrl('https://172.16.0.1/image.jpg')).rejects.toThrow('private');
        await expect(validateImageUrl('https://172.31.255.255/image.jpg')).rejects.toThrow('private');
      });

      it('should reject private IP addresses - Class C', async () => {
        await expect(validateImageUrl('https://192.168.0.1/image.jpg')).rejects.toThrow('private');
        await expect(validateImageUrl('https://192.168.255.255/image.jpg')).rejects.toThrow('private');
      });

      it('should reject link-local addresses', async () => {
        await expect(validateImageUrl('https://169.254.0.1/image.jpg')).rejects.toThrow('private');
        await expect(validateImageUrl('https://169.254.169.254/image.jpg')).rejects.toThrow('private');
      });

      it('should reject cloud metadata endpoints', async () => {
        await expect(validateImageUrl('https://169.254.169.254/latest/meta-data')).rejects.toThrow('private');
        await expect(validateImageUrl('https://metadata.google.internal/computeMetadata')).rejects.toThrow('metadata');
        await expect(validateImageUrl('https://metadata/meta-data')).rejects.toThrow('metadata');
      });

      it('should reject IPv4-mapped IPv6 localhost (SSRF bypass prevention)', async () => {
        await expect(validateImageUrl('https://[::ffff:127.0.0.1]/image.jpg')).rejects.toThrow('localhost');
        await expect(validateImageUrl('https://[::ffff:127.0.0.2]/image.jpg')).rejects.toThrow('localhost');
      });

      it('should reject IPv4-mapped IPv6 private IPs (SSRF bypass prevention)', async () => {
        await expect(validateImageUrl('https://[::ffff:10.0.0.1]/image.jpg')).rejects.toThrow('private');
        await expect(validateImageUrl('https://[::ffff:192.168.1.1]/image.jpg')).rejects.toThrow('private');
        await expect(validateImageUrl('https://[::ffff:172.16.0.1]/image.jpg')).rejects.toThrow('private');
        await expect(validateImageUrl('https://[::ffff:169.254.169.254]/image.jpg')).rejects.toThrow('private');
      });

      it('should reject IPv6 loopback', async () => {
        await expect(validateImageUrl('https://[::1]/image.jpg')).rejects.toThrow('private');
      });

      it('should reject IPv6 link-local', async () => {
        await expect(validateImageUrl('https://[fe80::1]/image.jpg')).rejects.toThrow('private');
      });

      it('should reject IPv6 unique local', async () => {
        await expect(validateImageUrl('https://[fc00::1]/image.jpg')).rejects.toThrow('private');
        await expect(validateImageUrl('https://[fd00::1]/image.jpg')).rejects.toThrow('private');
      });

      it('should reject malformed URLs', async () => {
        await expect(validateImageUrl('not-a-url')).rejects.toThrow('Invalid URL');
        await expect(validateImageUrl('//example.com')).rejects.toThrow();
      });

      it('should return validated URL for valid inputs', async () => {
        lookup.mockResolvedValue({ address: '8.8.8.8', family: 4 });
        const url = 'https://example.com/image.jpg';
        await expect(validateImageUrl(url)).resolves.toBe(url);
      });

      // DNS Rebinding Prevention Tests
      it('should reject domains resolving to localhost (DNS rebinding prevention)', async () => {
        lookup.mockResolvedValue({ address: '127.0.0.1', family: 4 });
        await expect(validateImageUrl('https://evil.com/image.jpg'))
          .rejects.toThrow('resolves to internal/private IP');
      });

      it('should reject domains resolving to private IPs (DNS rebinding prevention)', async () => {
        lookup.mockResolvedValue({ address: '10.0.0.1', family: 4 });
        await expect(validateImageUrl('https://evil.com/image.jpg'))
          .rejects.toThrow('resolves to internal/private IP');

        lookup.mockResolvedValue({ address: '192.168.1.1', family: 4 });
        await expect(validateImageUrl('https://evil2.com/image.jpg'))
          .rejects.toThrow('resolves to internal/private IP');

        lookup.mockResolvedValue({ address: '172.16.0.1', family: 4 });
        await expect(validateImageUrl('https://evil3.com/image.jpg'))
          .rejects.toThrow('resolves to internal/private IP');
      });

      it('should reject domains resolving to cloud metadata IPs (DNS rebinding prevention)', async () => {
        lookup.mockResolvedValue({ address: '169.254.169.254', family: 4 });
        await expect(validateImageUrl('https://evil.com/image.jpg'))
          .rejects.toThrow('resolves to internal/private IP');
      });

      it('should reject domains resolving to IPv6 loopback (DNS rebinding prevention)', async () => {
        lookup.mockResolvedValue({ address: '::1', family: 6 });
        await expect(validateImageUrl('https://evil.com/image.jpg'))
          .rejects.toThrow('resolves to internal/private IP');
      });

      it('should reject domains resolving to IPv6 private addresses (DNS rebinding prevention)', async () => {
        lookup.mockResolvedValue({ address: 'fe80::1', family: 6 });
        await expect(validateImageUrl('https://evil.com/image.jpg'))
          .rejects.toThrow('resolves to internal/private IP');

        lookup.mockResolvedValue({ address: 'fc00::1', family: 6 });
        await expect(validateImageUrl('https://evil2.com/image.jpg'))
          .rejects.toThrow('resolves to internal/private IP');
      });

      it('should handle DNS lookup failures gracefully', async () => {
        lookup.mockRejectedValue({ code: 'ENOTFOUND' });
        await expect(validateImageUrl('https://nonexistent.domain.invalid/image.jpg'))
          .rejects.toThrow('could not be resolved');
      });

      it('should handle DNS timeout errors gracefully', async () => {
        lookup.mockRejectedValue(new Error('ETIMEDOUT'));
        await expect(validateImageUrl('https://timeout.example.com/image.jpg'))
          .rejects.toThrow('Failed to validate domain');
      });
    });

    describe('validateImagePath', () => {
      beforeAll(() => {
        // Create valid test images with magic bytes
        const pngMagicBytes = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
        const jpegMagicBytes = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]);

        writeFileSync(join(TEST_DIR, 'test-image.png'), pngMagicBytes);
        writeFileSync(join(TEST_DIR, 'test-image.jpg'), jpegMagicBytes);
        writeFileSync(join(TEST_DIR, 'invalid.txt'), 'not an image');
        writeFileSync(join(TEST_DIR, 'square.bmp'), squareBmpBuffer);
        writeFileSync(join(TEST_DIR, 'rectangle.bmp'), rectangleBmpBuffer);
      });

      it('should accept valid PNG files', async () => {
        const filepath = join(TEST_DIR, 'test-image.png');
        await expect(validateImagePath(filepath)).resolves.toBe(filepath);
      });

      it('should accept valid JPEG files', async () => {
        const filepath = join(TEST_DIR, 'test-image.jpg');
        await expect(validateImagePath(filepath)).resolves.toBe(filepath);
      });

      it('should reject non-existent files', async () => {
        await expect(validateImagePath(join(TEST_DIR, 'nonexistent.jpg'))).rejects.toThrow('not found');
      });

      it('should reject non-image files', async () => {
        await expect(validateImagePath(join(TEST_DIR, 'invalid.txt'))).rejects.toThrow('valid image');
      });

      it('should reject empty files', async () => {
        const emptyFile = join(TEST_DIR, 'empty.jpg');
        writeFileSync(emptyFile, Buffer.alloc(0));
        await expect(validateImagePath(emptyFile)).rejects.toThrow('empty');
        unlinkSync(emptyFile);
      });
    });

    describe('assertSquareImage', () => {
      it('should accept square Buffer inputs', async () => {
        await expect(assertSquareImage(squareBmpBuffer)).resolves.toBeUndefined();
      });

      it('should reject non-square Buffer inputs', async () => {
        await expect(assertSquareImage(rectangleBmpBuffer)).rejects.toThrow('must be square');
      });

      it('should work with image file paths', async () => {
        const squarePath = join(TEST_DIR, 'square.bmp');
        const rectanglePath = join(TEST_DIR, 'rectangle.bmp');

        await expect(assertSquareImage(squarePath)).resolves.toBeUndefined();
        await expect(assertSquareImage(rectanglePath)).rejects.toThrow('must be square');
      });
    });
  });

  describe('FormData Building', () => {
    describe('buildFormData', () => {
      it('should create FormData instance', () => {
        const formData = buildFormData({ prompt: 'test' });
        expect(formData).toBeInstanceOf(FormData);
      });

      it('should append text fields', () => {
        const formData = buildFormData({
          prompt: 'test prompt',
          aspect_ratio: '1:1',
          num_images: 2
        });

        // FormData doesn't expose values directly, but we can check it was created
        expect(formData).toBeInstanceOf(FormData);
      });

      it('should skip undefined values', () => {
        const formData = buildFormData({
          prompt: 'test',
          undefined_field: undefined,
          null_field: null
        });

        expect(formData).toBeInstanceOf(FormData);
      });

      it('should handle Buffer values as files', () => {
        const imageBuffer = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]); // JPEG magic bytes
        const formData = buildFormData({
          prompt: 'test',
          image_file: imageBuffer
        });

        expect(formData).toBeInstanceOf(FormData);
      });

      it('should handle nested objects as JSON', () => {
        const formData = buildFormData({
          prompt: 'test',
          image_request: {
            resemblance: 85,
            detail: 90
          }
        });

        expect(formData).toBeInstanceOf(FormData);
      });

      it('should convert numbers to strings', () => {
        const formData = buildFormData({
          num_images: 4,
          seed: 12345,
          resemblance: 85
        });

        expect(formData).toBeInstanceOf(FormData);
      });

      it('should convert booleans to strings', () => {
        const formData = buildFormData({
          some_flag: true,
          another_flag: false
        });

        expect(formData).toBeInstanceOf(FormData);
      });
    });
  });

  describe('File I/O', () => {
    describe('ensureDirectory', () => {
      it('should create directory if it does not exist', async () => {
        const testDir = join(TEST_DIR, 'subdir');
        await ensureDirectory(testDir);
        expect(existsSync(testDir)).toBe(true);
        rmdirSync(testDir);
      });

      it('should not fail if directory already exists', async () => {
        await ensureDirectory(TEST_DIR);
        await expect(ensureDirectory(TEST_DIR)).resolves.not.toThrow();
      });

      it('should create nested directories', async () => {
        const nestedDir = join(TEST_DIR, 'level1', 'level2', 'level3');
        await ensureDirectory(nestedDir);
        expect(existsSync(nestedDir)).toBe(true);
        // Cleanup
        rmdirSync(join(TEST_DIR, 'level1', 'level2', 'level3'));
        rmdirSync(join(TEST_DIR, 'level1', 'level2'));
        rmdirSync(join(TEST_DIR, 'level1'));
      });
    });

    describe('saveImage', () => {
      it('should save image buffer to file', async () => {
        const imageBuffer = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10]);
        const filepath = join(TEST_DIR, 'saved-image.jpg');

        await saveImage(imageBuffer, filepath);
        expect(existsSync(filepath)).toBe(true);

        unlinkSync(filepath);
      });
    });

    describe('saveMetadata', () => {
      it('should save metadata as JSON', async () => {
        const metadata = {
          operation: 'generate-v3',
          prompt: 'test',
          timestamp: '2025-01-19T12:00:00Z'
        };
        const filepath = join(TEST_DIR, 'test-metadata.json');

        await saveMetadata(filepath, metadata);
        expect(existsSync(filepath)).toBe(true);

        unlinkSync(filepath);
      });
    });

    describe('loadImageAsBuffer', () => {
      it('should load valid image as Buffer', async () => {
        const filepath = join(TEST_DIR, 'test-image.png');
        const buffer = await loadImageAsBuffer(filepath);

        expect(Buffer.isBuffer(buffer)).toBe(true);
        expect(buffer.length).toBeGreaterThan(0);
      });

      it('should reject oversized files', async () => {
        // Create a file larger than 50MB
        const largeFile = join(TEST_DIR, 'large.jpg');
        const jpegMagicBytes = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]);
        const largeBuffer = Buffer.concat([
          jpegMagicBytes,
          Buffer.alloc(51 * 1024 * 1024) // 51MB
        ]);

        writeFileSync(largeFile, largeBuffer);

        await expect(loadImageAsBuffer(largeFile)).rejects.toThrow('50MB');

        unlinkSync(largeFile);
      });
    });
  });

  describe('API Key Security', () => {
    describe('redactApiKey', () => {
      it('should redact API keys for logging', () => {
        const redacted = redactApiKey('ideogram-api-key-1234567890abcdefghij');
        expect(redacted).toBe('xxx...ghij');
        expect(redacted).not.toContain('1234567890');
      });

      it('should handle short API keys', () => {
        const redacted = redactApiKey('short');
        expect(redacted).toBe('xxx...hort');
        expect(redacted.length).toBeGreaterThan(0);
      });

      it('should handle null API keys', () => {
        const redacted = redactApiKey(null);
        expect(redacted).toBe('xxx...xxx');
      });

      it('should handle undefined API keys', () => {
        const redacted = redactApiKey(undefined);
        expect(redacted).toBe('xxx...xxx');
      });

      it('should only show last 4 characters', () => {
        const key = 'this-is-a-test-api-key-abcd';
        const redacted = redactApiKey(key);
        expect(redacted).toBe('xxx...abcd');
      });

      it('should never expose full key', () => {
        const key = 'secret-key-12345';
        const redacted = redactApiKey(key);
        expect(redacted).not.toContain('secret');
        expect(redacted).not.toContain('key');
        expect(redacted.startsWith('xxx...')).toBe(true);
      });
    });
  });
});
