/**
 * v1 (Ideogram 3.0) request building: edit, remix, reframe, replaceBackground,
 * describe. Asserts what is sent (URL, multipart fields, file parts) with fetch
 * stubbed, for both explicit parameters and the defaults.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { fetchMock, ok, resetHttp, sentConfig, formFields, fileParts, formNames } from './helpers/http.js';
import { IdeogramAPI } from '../src/api.js';
import { ENDPOINTS } from '../src/config.js';

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
function pngOf(width, height) {
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write('IHDR', 4, 'ascii');
  ihdr.writeUInt32BE(width, 8);
  ihdr.writeUInt32BE(height, 12);
  return Buffer.concat([SIG, ihdr]);
}
const SQUARE = pngOf(512, 512);
const WIDE = pngOf(512, 256);
const RESPONSE = { created: 't', data: [{ url: 'https://ideogram.ai/a.png' }] };
const PALETTE = { name: 'EMBER' };


let api;
const dirs = [];
beforeEach(() => {
  resetHttp();
  fetchMock.mockReturnValue(ok(RESPONSE));
  api = new IdeogramAPI('test-ideogram-api-key-1234567890', undefined, 'error');
});
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

describe('edit', () => {
  it('posts image and mask as files with every option as a field', async () => {
    const res = await api.edit({
      prompt: 'add a hat',
      image: SQUARE,
      mask: SQUARE,
      magicPrompt: 'OFF',
      numImages: 3,
      seed: 9,
      renderingSpeed: 'TURBO',
      styleType: 'DESIGN',
      stylePreset: 'ART_DECO',
      colorPalette: PALETTE,
      styleCodes: ['AAAAAAAA', 'BBBBBBBB'],
    });
    expect(res).toEqual(RESPONSE);
    const cfg = sentConfig();
    expect(cfg.url).toBe(`https://api.ideogram.ai${ENDPOINTS.EDIT_V3}`);
    expect(cfg.method).toBe('POST');
    expect(fileParts(cfg, 'image')).toHaveLength(1);
    expect(fileParts(cfg, 'mask')).toHaveLength(1);
    expect(formFields(cfg, 'prompt')).toEqual(['add a hat']);
    expect(formFields(cfg, 'magic_prompt')).toEqual(['OFF']);
    expect(formFields(cfg, 'num_images')).toEqual(['3']);
    expect(formFields(cfg, 'seed')).toEqual(['9']);
    expect(formFields(cfg, 'rendering_speed')).toEqual(['TURBO']);
    expect(formFields(cfg, 'style_type')).toEqual(['DESIGN']);
    expect(formFields(cfg, 'style_preset')).toEqual(['ART_DECO']);
    expect(formFields(cfg, 'color_palette')).toEqual([JSON.stringify(PALETTE)]);
    expect(formFields(cfg, 'style_codes')).toEqual(['AAAAAAAA', 'BBBBBBBB']);
  });

  it('defaults magic prompt AUTO, one image, DEFAULT speed, and omits unset fields', async () => {
    await api.edit({ prompt: 'p', image: SQUARE, mask: SQUARE });
    const cfg = sentConfig();
    expect(formFields(cfg, 'magic_prompt')).toEqual(['AUTO']);
    expect(formFields(cfg, 'num_images')).toEqual(['1']);
    expect(formFields(cfg, 'rendering_speed')).toEqual(['DEFAULT']);
    expect(formNames(cfg)).toEqual(['prompt', 'image', 'mask', 'magic_prompt', 'num_images', 'rendering_speed']);
  });

  it('loads image and mask from file paths', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ideogram-apiv1-'));
    dirs.push(dir);
    const img = join(dir, 'i.png');
    const msk = join(dir, 'm.png');
    writeFileSync(img, SQUARE);
    writeFileSync(msk, SQUARE);
    await api.edit({ prompt: 'p', image: img, mask: msk });
    const cfg = sentConfig();
    expect(fileParts(cfg, 'image')).toEqual([{ filename: expect.stringMatching(/\.png$/), contentType: 'image/png' }]);
    expect(fileParts(cfg, 'mask')).toHaveLength(1);
  });

  it('rejects a missing image file before any request', async () => {
    await expect(api.edit({ prompt: 'p', image: '/nonexistent/i.png', mask: SQUARE })).rejects.toThrow('not found');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('remix', () => {
  it('posts every option', async () => {
    await api.remix({
      prompt: 'watercolour',
      image: SQUARE,
      imageWeight: 75,
      seed: 4,
      resolution: '1536x640',
      aspectRatio: '3x2',
      renderingSpeed: 'QUALITY',
      magicPrompt: 'ON',
      negativePrompt: 'blur',
      numImages: 2,
      colorPalette: PALETTE,
      styleCodes: ['AAAAAAAA', 'BBBBBBBB'],
      styleType: 'GENERAL',
      stylePreset: 'POP_ART',
    });
    const cfg = sentConfig();
    expect(cfg.url).toBe(`https://api.ideogram.ai${ENDPOINTS.REMIX_V3}`);
    expect(fileParts(cfg, 'image')).toHaveLength(1);
    const fields = (n) => formFields(cfg, n);
    expect(fields('image_weight')).toEqual(['75']);
    expect(fields('seed')).toEqual(['4']);
    expect(fields('resolution')).toEqual(['1536x640']);
    expect(fields('aspect_ratio')).toEqual(['3x2']);
    expect(fields('rendering_speed')).toEqual(['QUALITY']);
    expect(fields('magic_prompt')).toEqual(['ON']);
    expect(fields('negative_prompt')).toEqual(['blur']);
    expect(fields('num_images')).toEqual(['2']);
    expect(fields('color_palette')).toEqual([JSON.stringify(PALETTE)]);
    expect(fields('style_codes')).toEqual(['AAAAAAAA', 'BBBBBBBB']);
    expect(fields('style_type')).toEqual(['GENERAL']);
    expect(fields('style_preset')).toEqual(['POP_ART']);
  });

  it('applies defaults and omits unset fields', async () => {
    await api.remix({ prompt: 'p', image: SQUARE });
    const cfg = sentConfig();
    expect(formNames(cfg)).toEqual(['prompt', 'image', 'rendering_speed', 'magic_prompt', 'num_images']);
    expect(formFields(cfg, 'rendering_speed')).toEqual(['DEFAULT']);
    expect(formFields(cfg, 'magic_prompt')).toEqual(['AUTO']);
    expect(formFields(cfg, 'num_images')).toEqual(['1']);
  });
});

describe('reframe', () => {
  it('posts a square image with its options', async () => {
    await api.reframe({
      image: SQUARE,
      resolution: '1536x640',
      numImages: 2,
      seed: 5,
      renderingSpeed: 'TURBO',
      stylePreset: 'ART_DECO',
      colorPalette: PALETTE,
      styleCodes: ['AAAAAAAA', 'BBBBBBBB'],
    });
    const cfg = sentConfig();
    expect(cfg.url).toBe(`https://api.ideogram.ai${ENDPOINTS.REFRAME_V3}`);
    expect(fileParts(cfg, 'image')).toHaveLength(1);
    expect(formFields(cfg, 'resolution')).toEqual(['1536x640']);
    expect(formFields(cfg, 'num_images')).toEqual(['2']);
    expect(formFields(cfg, 'seed')).toEqual(['5']);
    expect(formFields(cfg, 'rendering_speed')).toEqual(['TURBO']);
    expect(formFields(cfg, 'style_preset')).toEqual(['ART_DECO']);
    expect(formFields(cfg, 'color_palette')).toEqual([JSON.stringify(PALETTE)]);
    expect(formFields(cfg, 'style_codes')).toEqual(['AAAAAAAA', 'BBBBBBBB']);
  });

  it('applies defaults', async () => {
    await api.reframe({ image: SQUARE, resolution: '1536x640' });
    const cfg = sentConfig();
    expect(formFields(cfg, 'num_images')).toEqual(['1']);
    expect(formFields(cfg, 'rendering_speed')).toEqual(['DEFAULT']);
  });

  it('refuses a non-square image before any request', async () => {
    await expect(api.reframe({ image: WIDE, resolution: '1536x640' })).rejects.toThrow('must be square');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('replaceBackground', () => {
  it('posts every option', async () => {
    await api.replaceBackground({
      prompt: 'a beach',
      image: SQUARE,
      magicPrompt: 'OFF',
      numImages: 2,
      seed: 6,
      renderingSpeed: 'QUALITY',
      stylePreset: 'POP_ART',
      colorPalette: PALETTE,
      styleCodes: ['AAAAAAAA', 'BBBBBBBB'],
    });
    const cfg = sentConfig();
    expect(cfg.url).toBe(`https://api.ideogram.ai${ENDPOINTS.REPLACE_BACKGROUND_V3}`);
    expect(fileParts(cfg, 'image')).toHaveLength(1);
    expect(formFields(cfg, 'prompt')).toEqual(['a beach']);
    expect(formFields(cfg, 'magic_prompt')).toEqual(['OFF']);
    expect(formFields(cfg, 'num_images')).toEqual(['2']);
    expect(formFields(cfg, 'seed')).toEqual(['6']);
    expect(formFields(cfg, 'rendering_speed')).toEqual(['QUALITY']);
    expect(formFields(cfg, 'style_preset')).toEqual(['POP_ART']);
    expect(formFields(cfg, 'color_palette')).toEqual([JSON.stringify(PALETTE)]);
    expect(formFields(cfg, 'style_codes')).toEqual(['AAAAAAAA', 'BBBBBBBB']);
  });

  it('applies defaults', async () => {
    await api.replaceBackground({ prompt: 'p', image: SQUARE });
    const cfg = sentConfig();
    expect(formNames(cfg)).toEqual(['prompt', 'image', 'magic_prompt', 'num_images', 'rendering_speed']);
  });
});

describe('describe', () => {
  it('posts image_file and the model version, and returns the descriptions', async () => {
    fetchMock.mockReturnValue(ok({ descriptions: [{ text: 'a cat' }] }));
    const res = await api.describe({ image: SQUARE, describeModelVersion: 'V_3' });
    expect(res.descriptions).toHaveLength(1);
    const cfg = sentConfig();
    expect(cfg.url).toBe(`https://api.ideogram.ai${ENDPOINTS.DESCRIBE}`);
    expect(fileParts(cfg, 'image_file')).toHaveLength(1);
    expect(formFields(cfg, 'describe_model_version')).toEqual(['V_3']);
  });

  it('omits the model version when not given, and copes with no descriptions', async () => {
    fetchMock.mockReturnValue(ok({}));
    await api.describe({ image: SQUARE });
    expect(formNames(sentConfig())).toEqual(['image_file']);
  });
});
