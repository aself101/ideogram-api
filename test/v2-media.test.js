/**
 * v2 tests added 2026-11-22: Ideogram 4.6, SVG (Ideogram Vector 1), video
 * (MiniMax H3, Seedance 2.5), and the auto / precise-edit changes Ideogram made
 * after 2026-11-08.
 *
 * axios is mocked, as in v2.test.js. Where a rule below is not in the spec's
 * schema, it was observed by a live dry run on 2026-11-22 (dry runs are free:
 * nothing is generated, stored or billed); the comment on each says which.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fetchMock, ok, httpError, resetHttp, sentConfig, formFields, fileParts, formNames, spyRequests } from './helpers/http.js';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';


import { IdeogramAPI, extractVideoUrls, extractSvgUrls, extractImageUrls } from '../src/api.js';
import { validateV2Params, parseContextWindow, preciseEditBounds, ENDPOINTS } from '../src/config.js';
import { buildFormData, detectAudioType, detectImageType, loadAudioAsBuffer } from '../src/utils.js';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
const WAV = Buffer.from('RIFF\x24\x00\x00\x00WAVEfmt ', 'binary');
const MP3_ID3 = Buffer.from('ID3\x04\x00\x00\x00\x00\x00\x00', 'binary');
const MP3_FRAME = Buffer.from([0xff, 0xfb, 0x90, 0x64, 0, 0, 0, 0]);

const ACK = { generation_id: 'gen_vid', created: '2026-11-22T18:00:00Z' };
const SVG_ACK = { generation_id: 'gen_svg' };
const QUOTE = {
  object: 'price_quote',
  billing_identifier: 'minimax_h3_text_to_video',
  quantity: 1,
  usd_micros: 650000,
  credit_millis: 65000,
  qualifier: 'exact',
};
const SYNC_RESPONSE = { generation_id: 'g', seed: 1, data: [] };






const MB = 1024 * 1024;

describe('auto: style_type and color_palette replace private (spec change after 2026-11-08)', () => {
  let api;
  // eslint-disable-next-line no-unused-vars
  let requests;
  beforeEach(() => {
    resetHttp();
    api = new IdeogramAPI('test-key-1234567890', undefined, 'error');
    requests = spyRequests(api);
  });

  it('sends style_type and a preset palette as one JSON part', async () => {
    fetchMock.mockReturnValue(ok(SYNC_RESPONSE));
    await api.generateAuto({ prompt: 'logo', styleType: 'design', colorPalette: 'ember' });
    const cfg = sentConfig();
    expect(formFields(cfg, 'style_type')).toEqual(['design']);
    expect(formFields(cfg, 'color_palette')).toEqual(['{"name":"ember"}']);
  });

  it('sends a members palette unchanged', async () => {
    fetchMock.mockReturnValue(ok(SYNC_RESPONSE));
    const members = [{ color_hex: '#ff0000', color_weight: 0.6 }, { color_hex: '#00f' }];
    await api.generateAuto({ prompt: 'logo', colorPalette: { members } });
    expect(formFields(sentConfig(), 'color_palette')).toEqual([JSON.stringify({ members })]);
  });

  it('never sends private (removed from the spec; the API ignores unknown fields silently)', async () => {
    fetchMock.mockReturnValue(ok(SYNC_RESPONSE));
    await api.generateAuto({ prompt: 'x', private: true });
    expect(formFields(sentConfig(), 'private')).toEqual([]);
  });

  it('validator: style and palette are source-less only (the API answers 422)', () => {
    expect(() => validateV2Params('generate-auto', { prompt: 'x', styleType: 'design', imageCount: 1 })).toThrow(
      'styleType cannot be combined with source images'
    );
    expect(() => validateV2Params('generate-auto', { prompt: 'x', colorPalette: 'ember', imageCount: 1 })).toThrow(
      'colorPalette cannot be combined with source images'
    );
    expect(() => validateV2Params('generate-auto', { prompt: 'x', styleType: 'DESIGN' })).toThrow(
      "Invalid style type 'DESIGN'"
    );
  });

  it('validator: palette shapes', () => {
    const v = (colorPalette) => () => validateV2Params('generate-auto', { prompt: 'x', colorPalette });
    expect(v('ember')).not.toThrow();
    expect(v({ name: 'pastel' })).not.toThrow();
    expect(v({ members: [{ color_hex: '#abc' }, { color_hex: '#A1B2C3', color_weight: 0.05 }] })).not.toThrow();
    expect(v('EMBER')).toThrow("Invalid color palette preset 'EMBER'");
    expect(v({ name: 'ember', members: [] })).toThrow('exactly one of name or members');
    expect(v({})).toThrow('exactly one of name or members');
    expect(v({ members: [] })).toThrow('non-empty array');
    expect(v({ members: [{ color_hex: 'red' }] })).toThrow("Invalid color_hex 'red'");
    expect(v({ members: [{ color_hex: '#fff', color_weight: 0.01 }] })).toThrow('between 0.05 and 1');
  });
});

describe('precise edit: context_window defaults to auto', () => {
  it("'auto' without a mask is valid on 4.5 and 4.6 (dry run 2026-11-22: 200)", () => {
    for (const op of ['precise-edit-v45', 'precise-edit-v46']) {
      expect(() => validateV2Params(op, { prompt: 'x', contextWindow: 'auto' })).not.toThrow();
    }
  });
});

describe('Ideogram 4.6', () => {
  let api;
  let requests;
  beforeEach(() => {
    resetHttp();
    api = new IdeogramAPI('test-key-1234567890', undefined, 'error');
    requests = spyRequests(api);
  });

  it('generateV46 posts the 4.5 fields to /v2/image/generate/ideogram-4-6', async () => {
    fetchMock.mockReturnValue(ok(SYNC_RESPONSE));
    await api.generateV46({ prompt: 'poster', size: 'auto_4k', quality: 'high', images: [JPEG] });
    const cfg = sentConfig();
    expect(cfg.url).toBe('https://api.ideogram.ai/v2/image/generate/ideogram-4-6');
    expect(formFields(cfg, 'size')).toEqual(['auto_4k']);
    expect(formFields(cfg, 'quality')).toEqual(['high']);
    expect(fileParts(cfg, 'images')).toEqual([{ filename: 'image.jpg', contentType: 'image/jpeg' }]);
    expect(requests.mock.calls[0][0].maxBodyBytes).toBe(151 * MB);
  });

  it('preciseEditV46 posts to /v2/image/precise-edit/ideogram-4-6 and requires an image', async () => {
    await expect(api.preciseEditV46({ prompt: 'x' })).rejects.toThrow('image is required');
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockReturnValue(ok(SYNC_RESPONSE));
    await api.preciseEditV46({ prompt: 'hat', image: PNG, contextWindow: 'none', dryRun: true });
    const cfg = sentConfig();
    expect(cfg.url).toBe('https://api.ideogram.ai/v2/image/precise-edit/ideogram-4-6?dry_run=true');
    expect(formFields(cfg, 'context_window')).toEqual(['none']);
  });

  it('the 4.5 methods still hit the 4.5 endpoints', async () => {
    fetchMock.mockReturnValue(ok(SYNC_RESPONSE));
    await api.generateV45({ prompt: 'x' });
    expect(sentConfig().url).toBe('https://api.ideogram.ai/v2/image/generate/ideogram-4-5');
    fetchMock.mockClear();
    await api.preciseEditV45({ prompt: 'x', image: PNG });
    expect(sentConfig().url).toBe('https://api.ideogram.ai/v2/image/precise-edit/ideogram-4-5');
  });

  // Each row: params, the 4.6 outcome, the 4.5 outcome. Every 4.6 outcome
  // matches a 2026-11-22 dry run (H1-H8 in the session log).
  const CASES = [
    [{ quality: 'very_low' }, null, "'very_low' requires source images"],
    [{ size: 'auto_4k' }, null, "Invalid size 'auto_4k'"],
    [{ size: 'auto_2k' }, null, "Invalid size 'auto_2k'"],
    [{ size: 'auto_4k', quality: 'very_low' }, "'auto_4k' is not available at quality 'very_low'", 'requires source images'],
    [{ size: '3008x3008' }, null, 'at most 2048x2048 pixels'],
    [{ size: '1088x1088' }, null, 'supported preset'],
    [{ size: '4128x4096' }, 'at most 4096x4096 pixels', 'at most 2048x2048 pixels'],
    [{ size: '2560x2560', quality: 'very_low', imageCount: 1 }, 'at most 2048x2048 pixels', 'at most 2048x2048 pixels'],
    [{ size: '4864x256', quality: 'very_low', imageCount: 1 }, 'at most 4608px', 'at most 6:1'],
    [{ size: 'source' }, "'source' requires source images", "'source' requires source images"],
    [{ size: '1000x1000' }, 'multiples of 32', 'multiples of 32'],
  ];

  it.each(CASES)('generate-v46 vs generate-v45 on %j', (params, v46, v45) => {
    const run = (op) => () => validateV2Params(op, { prompt: 'x', ...params });
    if (v46) expect(run('generate-v46')).toThrow(v46);
    else expect(run('generate-v46')).not.toThrow();
    if (v45) expect(run('generate-v45')).toThrow(v45);
    else expect(run('generate-v45')).not.toThrow();
  });

  it('generate-v46 keeps the 4.5 image and mask rules', () => {
    expect(() => validateV2Params('generate-v46', { prompt: 'x', imageCount: 6 })).toThrow('At most 5 source images');
    expect(() => validateV2Params('generate-v46', { prompt: 'x', hasMask: true })).toThrow('requires at least one source image');
    expect(() => validateV2Params('generate-v46', { prompt: 'x', imageCount: 1, hasMask: true, size: 'auto' })).toThrow(
      'size cannot be set with a mask'
    );
  });

  it('precise-edit context window bounds: 4096x4096 on 4.6, 2048x2048 on 4.5 and on 4.6 very_low', () => {
    const v = (op, contextWindow, quality) => () => validateV2Params(op, { prompt: 'x', contextWindow, quality });
    expect(v('precise-edit-v46', '0,0,4096,4096')).not.toThrow();
    expect(v('precise-edit-v46', '0,0,4096,4128')).toThrow('the maximum is 16777216 (4096x4096)');
    expect(v('precise-edit-v45', '0,0,4096,4096')).toThrow('the maximum is 4194304 (2048x2048)');
    expect(v('precise-edit-v46', '0,0,4096,4096', 'very_low')).toThrow('the maximum is 4194304 (2048x2048)');
    // very_low also caps a side at 4608px, independent of area
    expect(v('precise-edit-v46', '0,0,800,4640', 'very_low')).toThrow('at most 4608px');
    expect(v('precise-edit-v46', '0,0,800,4640')).not.toThrow();
  });

  it('parseContextWindow keeps its 4.5 default when no bounds are given', () => {
    expect(() => parseContextWindow('0,0,2048,2080')).toThrow('maximum is 4194304');
    expect(parseContextWindow('0,0,4096,4096', undefined, preciseEditBounds('4.6'))).toEqual({
      yMin: 0, xMin: 0, yMax: 4096, xMax: 4096,
    });
  });
});

describe('generateSvg (Ideogram Vector 1)', () => {
  let api;
  // eslint-disable-next-line no-unused-vars
  let requests;
  beforeEach(() => {
    resetHttp();
    api = new IdeogramAPI('test-key-1234567890', undefined, 'error');
    requests = spyRequests(api);
  });

  it('posts multipart to /v2/svg/generate/ideogram-vector-1 and returns the acknowledgement', async () => {
    fetchMock.mockReturnValue(ok(SVG_ACK));
    const res = await api.generateSvg({
      prompt: 'fox logo',
      images: [PNG],
      aspectRatio: '4x1',
      quality: 'high',
      numImages: 2,
      seed: 5,
      useGradient: false,
      private: true,
      targetCollectionId: 'col123',
      webhookUrl: 'https://example.com/h',
    });
    const cfg = sentConfig();
    expect(cfg.url).toBe('https://api.ideogram.ai/v2/svg/generate/ideogram-vector-1');
    expect(fileParts(cfg, 'images')).toEqual([{ filename: 'image.png', contentType: 'image/png' }]);
    expect(formFields(cfg, 'aspect_ratio')).toEqual(['4x1']);
    expect(formFields(cfg, 'quality')).toEqual(['high']);
    expect(formFields(cfg, 'num_images')).toEqual(['2']);
    expect(formFields(cfg, 'seed')).toEqual(['5']);
    expect(formFields(cfg, 'use_gradient')).toEqual(['false']);
    expect(formFields(cfg, 'private')).toEqual(['true']);
    expect(formFields(cfg, 'target_collection_id')).toEqual(['col123']);
    expect(formFields(cfg, 'webhook_url')).toEqual(['https://example.com/h']);
    expect(formNames(cfg)).not.toContain('async');
    expect(res).toEqual(SVG_ACK);
  });

  it('sends image_asset_identifiers as ONE part holding a JSON array (dry run 2026-11-22)', async () => {
    // One object per part answers 400 "'asset_type' is not of type 'object'";
    // a single JSON-array part reaches asset lookup.
    fetchMock.mockReturnValue(ok(SVG_ACK));
    const ids = [
      { asset_type: 'UPLOAD', asset_id: 'a1' },
      { asset_type: 'RESPONSE', asset_id: 'a2', collection_id: 'AAAAAAAAAAAAAAAAAAAAAA' },
    ];
    await api.generateSvg({ prompt: 'x', imageAssetIdentifiers: ids });
    expect(formFields(sentConfig(), 'image_asset_identifiers')).toEqual([JSON.stringify(ids)]);
  });

  it('omits unset fields, including an empty asset list', async () => {
    fetchMock.mockReturnValue(ok(SVG_ACK));
    await api.generateSvg({ prompt: 'x', imageAssetIdentifiers: [], images: [] });
    expect(formNames(sentConfig())).toEqual(['prompt']);
  });

  it('validator: prompt limit is 9,500, and enums and asset identifiers are checked', () => {
    const v = (p) => () => validateV2Params('generate-svg', { prompt: 'x', ...p });
    expect(v({ prompt: 'a'.repeat(9500) })).not.toThrow();
    expect(v({ prompt: 'a'.repeat(9501) })).toThrow('maximum length of 9500');
    expect(v({ quality: 'ultra' })).toThrow("Invalid quality 'ultra'");
    expect(v({ aspectRatio: '16:9' })).toThrow("Invalid aspect ratio '16:9'");
    expect(v({ imageAssetIdentifiers: [{ asset_type: 'NOPE', asset_id: 'a' }] })).toThrow("Invalid asset_type 'NOPE'");
    expect(v({ imageAssetIdentifiers: [{ asset_type: 'UPLOAD' }] })).toThrow('needs an asset_id');
    expect(v({ imageAssetIdentifiers: [{ asset_type: 'UPLOAD', asset_id: 'a', collection_id: 'short' }] })).toThrow(
      "Invalid collection_id 'short'"
    );
    expect(v({ imageAssetIdentifiers: [{ asset_type: 'UPLOAD', asset_id: 'a' }], numImages: 8 })).not.toThrow();
  });
});

describe('video', () => {
  let api;
  let requests;
  beforeEach(() => {
    resetHttp();
    api = new IdeogramAPI('test-key-1234567890', undefined, 'error');
    requests = spyRequests(api);
  });

  it('minimaxH3TextToVideo posts a snake_case JSON body', async () => {
    fetchMock.mockReturnValue(ok(ACK));
    const res = await api.minimaxH3TextToVideo({
      prompt: 'fox',
      aspectRatio: '21x9',
      resolution: '4K',
      duration: 15,
      webhookUrl: 'https://example.com/h',
    });
    const cfg = sentConfig();
    expect(cfg.url).toBe('https://api.ideogram.ai/v2/video/generate/minimax-h3-text-to-video');
    expect(cfg.headers['Content-Type']).toBe('application/json');
    expect(cfg.data).toEqual({
      prompt: 'fox',
      aspect_ratio: '21x9',
      resolution: '4K',
      duration: 15,
      webhook_url: 'https://example.com/h',
    });
    expect(res).toEqual(ACK);
  });

  it('seedance25TextToVideo sends generate_audio and omits unset fields', async () => {
    fetchMock.mockReturnValue(ok(ACK));
    await api.seedance25TextToVideo({ prompt: 'fox', generateAudio: true });
    const cfg = sentConfig();
    expect(cfg.url).toBe('https://api.ideogram.ai/v2/video/generate/seedance-2-5-text-to-video');
    expect(cfg.data).toEqual({ prompt: 'fox', generate_audio: true });
  });

  it('dryRun prices a video and resolves to the quote', async () => {
    fetchMock.mockReturnValue(ok(QUOTE));
    const quote = await api.minimaxH3TextToVideo({ prompt: 'fox', dryRun: true });
    expect(sentConfig().url).toBe('https://api.ideogram.ai/v2/video/generate/minimax-h3-text-to-video?dry_run=true');
    expect(quote.usd_micros).toBe(650000);
  });

  it.each([
    ['minimaxH3ImageToVideo', 'minimax-h3-image-to-video', {}],
    ['seedance25ImageToVideo', 'seedance-2-5-image-to-video', { generateAudio: false }],
  ])('%s sends image and end_image file parts', async (method, slug, extra) => {
    await expect(api[method]({ prompt: 'pan' })).rejects.toThrow('image (the first frame) is required');
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockReturnValue(ok(ACK));
    await api[method]({ prompt: 'pan', image: JPEG, endImage: PNG, resolution: 'r', duration: 10, ...extra });
    const cfg = sentConfig();
    expect(cfg.url).toBe(`https://api.ideogram.ai/v2/video/generate/${slug}`);
    expect(fileParts(cfg, 'image')).toEqual([{ filename: 'image.jpg', contentType: 'image/jpeg' }]);
    expect(fileParts(cfg, 'end_image')).toEqual([{ filename: 'image.png', contentType: 'image/png' }]);
    expect(formFields(cfg, 'duration')).toEqual(['10']);
    expect(formFields(cfg, 'resolution')).toEqual(['r']);
    expect(requests.mock.calls.at(-1)[0].maxBodyBytes).toBe(101 * MB);
    if (extra.generateAudio !== undefined) expect(formFields(cfg, 'generate_audio')).toEqual(['false']);
  });

  it.each([
    ['minimaxH3ReferenceToVideo', 'minimax-h3-reference-to-video', { promptExpansionMode: 'disabled' }],
    ['seedance25ReferenceToVideo', 'seedance-2-5-reference-to-video', { generateAudio: true }],
  ])('%s sends repeated image parts and audio parts typed by their bytes', async (method, slug, extra) => {
    fetchMock.mockReturnValue(ok(ACK));
    await api[method]({
      prompt: 'Image 1 sings',
      referenceImages: [PNG, JPEG],
      referenceAudios: [WAV, MP3_ID3],
      aspectRatio: '9x16',
      ...extra,
    });
    const cfg = sentConfig();
    expect(cfg.url).toBe(`https://api.ideogram.ai/v2/video/generate/${slug}`);
    expect(fileParts(cfg, 'reference_images')).toEqual([
      { filename: 'image.png', contentType: 'image/png' },
      { filename: 'image.jpg', contentType: 'image/jpeg' },
    ]);
    expect(fileParts(cfg, 'reference_audios')).toEqual([
      { filename: 'audio.wav', contentType: 'audio/wav' },
      { filename: 'audio.mp3', contentType: 'audio/mpeg' },
    ]);
    expect(formFields(cfg, 'aspect_ratio')).toEqual(['9x16']);
    expect(requests.mock.calls.at(-1)[0].maxBodyBytes).toBe(601 * MB);
    if (extra.promptExpansionMode) expect(formFields(cfg, 'prompt_expansion_mode')).toEqual(['disabled']);
    if (extra.generateAudio) expect(formFields(cfg, 'generate_audio')).toEqual(['true']);
  });

  it('a reference audio path must be MP3 or WAV', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ideogram-audio-'));
    const notAudio = join(dir, 'song.mp3');
    writeFileSync(notAudio, PNG);
    await expect(
      api.minimaxH3ReferenceToVideo({ prompt: 'x', referenceImages: [PNG], referenceAudios: [notAudio] })
    ).rejects.toThrow('does not appear to be MP3 or WAV');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('validateV2Params: video', () => {
  const v = (op, p) => () => validateV2Params(op, { prompt: 'x', ...p });

  it('prompt limits: 2,000 on MiniMax H3, 30,000 on Seedance 2.5', () => {
    expect(v('minimax-h3-text-to-video', { prompt: 'a'.repeat(2000) })).not.toThrow();
    expect(v('minimax-h3-text-to-video', { prompt: 'a'.repeat(2001) })).toThrow('maximum length of 2000');
    expect(v('seedance-2-5-text-to-video', { prompt: 'a'.repeat(30000) })).not.toThrow();
    expect(v('seedance-2-5-text-to-video', { prompt: 'a'.repeat(30001) })).toThrow('maximum length of 30000');
  });

  it('resolution tiers are spelled per model (dry run: 720p on MiniMax answers 400)', () => {
    expect(v('minimax-h3-text-to-video', { resolution: '4K' })).not.toThrow();
    expect(v('minimax-h3-text-to-video', { resolution: '720p' })).toThrow("Invalid resolution '720p'");
    expect(v('minimax-h3-text-to-video', { resolution: '2k' })).toThrow("Invalid resolution '2k'");
    expect(v('seedance-2-5-image-to-video', { resolution: '1080p' })).not.toThrow();
    expect(v('seedance-2-5-image-to-video', { resolution: '1080P' })).toThrow("Invalid resolution '1080P'");
  });

  it('durations: 5-15 on MiniMax H3, 4-30 on Seedance 2.5, integers only', () => {
    expect(v('minimax-h3-text-to-video', { duration: 5 })).not.toThrow();
    expect(v('minimax-h3-text-to-video', { duration: 4 })).toThrow('duration must be an integer between 5 and 15');
    expect(v('minimax-h3-image-to-video', { duration: 16 })).toThrow('between 5 and 15');
    expect(v('seedance-2-5-text-to-video', { duration: 4 })).not.toThrow();
    expect(v('seedance-2-5-text-to-video', { duration: 30 })).not.toThrow();
    expect(v('seedance-2-5-text-to-video', { duration: 31 })).toThrow('between 4 and 30');
    expect(v('seedance-2-5-text-to-video', { duration: 5.5 })).toThrow('must be an integer');
  });

  it('aspect ratios: Seedance has auto, MiniMax does not', () => {
    expect(v('seedance-2-5-text-to-video', { aspectRatio: 'auto' })).not.toThrow();
    expect(v('minimax-h3-text-to-video', { aspectRatio: 'auto' })).toThrow("Invalid aspect ratio 'auto'");
    expect(v('minimax-h3-reference-to-video', { aspectRatio: '21x9' })).not.toThrow();
  });

  it('image to video needs the first frame', () => {
    expect(v('minimax-h3-image-to-video', { hasImage: false })).toThrow('image (the first frame) is required');
    expect(v('seedance-2-5-image-to-video', { hasImage: false })).toThrow('image (the first frame) is required');
    expect(v('seedance-2-5-image-to-video', { hasImage: true })).not.toThrow();
  });

  it('MiniMax reference rules (dry run: audio without an image answers 400)', () => {
    const op = 'minimax-h3-reference-to-video';
    expect(v(op, {})).not.toThrow(); // dry run: no references at all is accepted
    expect(v(op, { referenceAudioCount: 1 })).toThrow('requires at least one reference image');
    expect(v(op, { referenceImageCount: 1, referenceAudioCount: 3 })).not.toThrow();
    expect(v(op, { referenceImageCount: 1, referenceAudioCount: 4 })).toThrow('At most 3 reference audios');
    expect(v(op, { referenceImageCount: 10, referenceAudioCount: 3 })).toThrow('At most 12 references');
    expect(v(op, { promptExpansionMode: 'max' })).toThrow("Invalid prompt expansion mode 'max'");
  });

  it('Seedance reference needs an image (dry run: none answers 400)', () => {
    const op = 'seedance-2-5-reference-to-video';
    expect(v(op, {})).toThrow('requires at least one reference image');
    expect(v(op, { referenceAudioCount: 1 })).toThrow('requires at least one reference image');
    expect(v(op, { referenceImageCount: 1, referenceAudioCount: 2 })).not.toThrow();
  });

  it('every new operation is known to the validator', () => {
    for (const op of [
      'generate-v46', 'precise-edit-v46', 'generate-svg',
      'minimax-h3-text-to-video', 'minimax-h3-image-to-video', 'minimax-h3-reference-to-video',
      'seedance-2-5-text-to-video', 'seedance-2-5-image-to-video', 'seedance-2-5-reference-to-video',
    ]) {
      expect(v(op, { referenceImageCount: 1 })).not.toThrow();
      expect(v(op, { prompt: '' })).toThrow('Prompt is required');
      expect(v(op, { webhookUrl: 'http://example.com/h' })).toThrow('webhookUrl must be an HTTPS URL');
    }
    expect(v('generate-v99', {})).toThrow('Unknown v2 operation');
  });
});

describe('audio typing (utils)', () => {
  it('detectAudioType recognises WAV, ID3-tagged MP3 and a bare MPEG frame', () => {
    expect(detectAudioType(WAV)).toEqual({ extension: 'wav', mimeType: 'audio/wav' });
    expect(detectAudioType(MP3_ID3)).toEqual({ extension: 'mp3', mimeType: 'audio/mpeg' });
    expect(detectAudioType(MP3_FRAME)).toEqual({ extension: 'mp3', mimeType: 'audio/mpeg' });
  });

  it('does not mistake images for audio, or WebP (also RIFF) for WAV', () => {
    expect(detectAudioType(JPEG)).toBeNull(); // FF D8: the sync bits do not match
    expect(detectAudioType(PNG)).toBeNull();
    expect(detectAudioType(Buffer.from('RIFF\x00\x00\x00\x00WEBPVP8 ', 'binary'))).toBeNull();
    expect(detectImageType(WAV)).toBeNull();
  });

  it('buildFormData types audio parts by their bytes', () => {
    const form = buildFormData({ reference_audios: [WAV, MP3_FRAME] });
    expect(form.getAll('reference_audios').map((f) => `${f.name}:${f.type}`)).toEqual([
      'audio.wav:audio/wav',
      'audio.mp3:audio/mpeg',
    ]);
  });

  it('loadAudioAsBuffer checks presence, bytes and the 15MB limit', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ideogram-audio-'));
    const good = join(dir, 'a.wav');
    writeFileSync(good, WAV);
    expect(await loadAudioAsBuffer(good)).toEqual(WAV);
    await expect(loadAudioAsBuffer(join(dir, 'missing.wav'))).rejects.toThrow('Audio file not found');
    const empty = join(dir, 'empty.wav');
    writeFileSync(empty, Buffer.alloc(0));
    await expect(loadAudioAsBuffer(empty)).rejects.toThrow('Audio file is empty');
    const big = join(dir, 'big.wav');
    writeFileSync(big, Buffer.concat([WAV, Buffer.alloc(15 * MB)]));
    await expect(loadAudioAsBuffer(big)).rejects.toThrow('exceeds the 15MB limit');
  });
});

describe('upscale (v2 /v2/image/upscale/auto since 2.0)', () => {
  let api;
  let requests;
  beforeEach(() => {
    resetHttp();
    api = new IdeogramAPI('test-key-1234567890', undefined, 'error');
    requests = spyRequests(api);
  });

  const RESULT = {
    generation_id: 'gen_up',
    seed: 7,
    width: 2048,
    height: 2048,
    data: [{ url: 'https://x/up.png', resolution: '2048x2048', is_image_safe: true, seed: 7 }],
  };

  it('posts image, upscale_factor and seed as multipart to the v2 endpoint', async () => {
    fetchMock.mockReturnValue(ok(RESULT));
    const res = await api.upscale({ image: PNG, upscaleFactor: 'x4', seed: 7, webhookUrl: 'https://example.com/h' });
    const cfg = sentConfig();
    expect(cfg.url).toBe('https://api.ideogram.ai/v2/image/upscale/auto');
    expect(fileParts(cfg, 'image')).toEqual([{ filename: 'image.png', contentType: 'image/png' }]);
    expect(formFields(cfg, 'upscale_factor')).toEqual(['x4']);
    expect(formFields(cfg, 'seed')).toEqual(['7']);
    expect(formFields(cfg, 'webhook_url')).toEqual(['https://example.com/h']);
    // the v1 shape is gone: no image_file part, no image_request JSON part
    expect(formNames(cfg)).not.toContain('image_file');
    expect(formNames(cfg)).not.toContain('image_request');
    expect(cfg.timeout).toBe(300000);
    expect(requests.mock.calls[0][0].maxBodyBytes).toBe(51 * MB);
    expect(res.width).toBe(2048);
    expect(extractImageUrls(res)).toEqual(['https://x/up.png']);
  });

  it('omits unset fields and prices with dryRun', async () => {
    fetchMock.mockReturnValue(ok(QUOTE));
    await api.upscale({ image: PNG, dryRun: true });
    const cfg = sentConfig();
    expect(cfg.url).toBe('https://api.ideogram.ai/v2/image/upscale/auto?dry_run=true');
    expect(formNames(cfg)).toEqual(['image']);
  });

  it('throws on a 1.x field rather than sending a request the API would silently ignore', async () => {
    await expect(api.upscale({ image: PNG, resemblance: 85, detail: 90 })).rejects.toThrow(
      'does not accept resemblance, detail'
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('validator: no prompt needed; factor is x2, x4 or x8; the image is required', () => {
    const v = (p) => () => validateV2Params('upscale-auto', p);
    expect(v({})).not.toThrow();
    expect(v({ upscaleFactor: 'x8', seed: 1 })).not.toThrow();
    expect(v({ upscaleFactor: '4x' })).toThrow("Invalid upscale factor '4x'");
    expect(v({ hasImage: false })).toThrow('image is required');
    expect(v({ seed: -1 })).toThrow('seed must be an integer');
  });
});

describe('result helpers for polled SVG and video generations', () => {
  const STATUS = {
    generation_id: 'g',
    status: 'completed',
    created: 't',
    response_type: 'url',
    data: [
      { object_type: 'video.generation', asset_id: 'v1', url: 'https://x/v.mp4', prompt: 'p', resolution: '2K', aspect_ratio: '16:9', duration: 5 },
      { object_type: 'video.generation', asset_id: 'v2', url: null, prompt: 'p', resolution: '2K', aspect_ratio: '16:9', duration: 5 },
      { object_type: 'svg.generation', asset_id: 's1', url: 'https://x/a.svg', mime_type: 'image/svg+xml', width: 1024, height: 1024 },
      { object_type: 'image.generation', url: 'https://x/i.png', prompt: 'p', resolution: '1x1', is_image_safe: true, seed: 1 },
    ],
  };

  it('extractVideoUrls and extractSvgUrls pick their kind and skip empty URLs', () => {
    expect(extractVideoUrls(STATUS)).toEqual(['https://x/v.mp4']);
    expect(extractSvgUrls(STATUS)).toEqual(['https://x/a.svg']);
    expect(extractVideoUrls({ generation_id: 'g', status: 'pending', created: 't' })).toEqual([]);
  });

  it('extractImageUrls still returns images only (an SVG mime type is not an image result)', () => {
    expect(extractImageUrls(STATUS)).toEqual(['https://x/i.png']);
  });

  it('ENDPOINTS carry the documented paths', () => {
    expect(ENDPOINTS.GENERATE_SVG).toBe('/v2/svg/generate/ideogram-vector-1');
    expect(ENDPOINTS.VIDEO_SEEDANCE_25_REFERENCE).toBe('/v2/video/generate/seedance-2-5-reference-to-video');
    expect(ENDPOINTS.PRECISE_EDIT_V46).toBe('/v2/image/precise-edit/ideogram-4-6');
  });
});
