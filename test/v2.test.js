/**
 * v2 API tests (Ideogram 4.0 / 4.5 / auto / precise edit / polling)
 *
 * axios is mocked, so these assert what the client SENDS (URL, query, body,
 * limits) and how it READS responses and errors. Response and error bodies are
 * copied from live dry-run calls made 2026-11-08.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fetchMock, ok, httpError, resetHttp, sentConfig, formFields, fileParts, formNames, spyRequests } from './helpers/http.js';


import { IdeogramAPI, IdeogramAPIError, isPriceQuote, extractImageUrls, extractImages } from '../src/api.js';
import { validateV2Params, parseContextWindow, V4_RESOLUTIONS } from '../src/config.js';
import { buildFormData, detectImageType } from '../src/utils.js';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
const WEBP = Buffer.from('RIFF\x00\x00\x00\x00WEBPVP8 ', 'binary');

const QUOTE = {
  object: 'price_quote',
  billing_identifier: 'ideogram_v4_generation',
  quantity: 1,
  usd_micros: 60000,
  credit_millis: 6000,
  qualifier: 'exact',
};

const SYNC_RESPONSE = {
  generation_id: 'gen_abc',
  seed: 12345,
  data: [
    { prompt: 'p', resolution: '1024x1024', is_image_safe: true, seed: 12345, url: 'https://ideogram.ai/a.png' },
    { prompt: 'p', resolution: '1024x1024', is_image_safe: false, seed: 12345, url: '' },
  ],
};







describe('v2 request building', () => {
  let api;

  beforeEach(() => {
    resetHttp();
    api = new IdeogramAPI('test-key-1234567890', undefined, 'error');
  });

  it('generateV4 POSTs a snake_case JSON body to /v2/image/generate/ideogram-4', async () => {
    fetchMock.mockReturnValue(ok(SYNC_RESPONSE));
    const res = await api.generateV4({
      prompt: 'a lighthouse',
      resolution: '2048x2048',
      renderingSpeed: 'quality',
      magicPrompt: 'off',
      numImages: 2,
      seed: 7,
      enableCopyrightDetection: true,
      webhookUrl: 'https://example.com/hook',
    });
    const cfg = sentConfig();
    expect(cfg.method).toBe('POST');
    expect(cfg.url).toBe('https://api.ideogram.ai/v2/image/generate/ideogram-4');
    expect(cfg.headers['Content-Type']).toBe('application/json');
    expect(cfg.headers['Api-Key']).toBe('test-key-1234567890');
    expect(cfg.data).toEqual({
      prompt: 'a lighthouse',
      resolution: '2048x2048',
      rendering_speed: 'quality',
      magic_prompt: 'off',
      num_images: 2,
      seed: 7,
      enable_copyright_detection: true,
      webhook_url: 'https://example.com/hook',
    });
    expect(cfg.timeout).toBe(300000);
    expect(res.generation_id).toBe('gen_abc');
  });

  it('omits unset fields so the API applies its own defaults', async () => {
    fetchMock.mockReturnValue(ok(SYNC_RESPONSE));
    await api.generateV4({ prompt: 'x' });
    expect(sentConfig().data).toEqual({ prompt: 'x' });
  });

  it('dryRun adds ?dry_run=true and resolves to the PriceQuote', async () => {
    fetchMock.mockReturnValue(ok(QUOTE));
    const quote = await api.generateV4({ prompt: 'x', dryRun: true });
    expect(sentConfig().url).toBe('https://api.ideogram.ai/v2/image/generate/ideogram-4?dry_run=true');
    expect(isPriceQuote(quote)).toBe(true);
    expect(quote.usd_micros).toBe(60000);
    // dry_run is a query parameter, never a body field
    expect(sentConfig().data).not.toHaveProperty('dry_run');
    expect(Object.keys(sentConfig().data)).toEqual(['prompt']);
  });

  it('generateV4Transparent maps aspect ratio and output resolution', async () => {
    fetchMock.mockReturnValue(ok(SYNC_RESPONSE));
    await api.generateV4Transparent({ prompt: 'fox', aspectRatio: '16x9', outputResolution: '8k', async: true });
    const cfg = sentConfig();
    expect(cfg.url).toBe('https://api.ideogram.ai/v2/image/generate/ideogram-4-transparent');
    expect(cfg.data).toEqual({ prompt: 'fox', aspect_ratio: '16x9', output_resolution: '8k', async: true });
  });

  it('generateV4Custom requires customModelUri and sends it', async () => {
    await expect(api.generateV4Custom({ prompt: 'x' })).rejects.toThrow('customModelUri is required');
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockReturnValue(ok(SYNC_RESPONSE));
    await api.generateV4Custom({
      prompt: 'x',
      customModelUri: 'model/m/version/1',
      transparentBackground: true,
    });
    const cfg = sentConfig();
    expect(cfg.url).toBe('https://api.ideogram.ai/v2/image/generate/ideogram-4-custom-model');
    expect(cfg.data).toEqual({ prompt: 'x', custom_model_uri: 'model/m/version/1', transparent_background: true });
  });

  it('generateV45 sends multipart: repeated images parts, a typed mask, and string fields', async () => {
    fetchMock.mockReturnValue(ok({ ...SYNC_RESPONSE, generation_kind: 'sampling' }));
    await api.generateV45({
      prompt: 'make it night',
      images: [JPEG, WEBP],
      mask: PNG,
      background: 'transparent',
      quality: 'low',
      numImages: 3,
      async: false,
    });
    const cfg = sentConfig();
    expect(cfg.url).toBe('https://api.ideogram.ai/v2/image/generate/ideogram-4-5');
    // fetch derives the multipart Content-Type and boundary from a FormData body
    expect(cfg.data).toBeInstanceOf(FormData);
    expect(cfg.headers['Content-Type']).toBeUndefined();
    expect(fileParts(cfg, 'images')).toEqual([
      { filename: 'image.jpg', contentType: 'image/jpeg' },
      { filename: 'image.webp', contentType: 'image/webp' },
    ]);
    expect(fileParts(cfg, 'mask')).toEqual([{ filename: 'image.png', contentType: 'image/png' }]);
    expect(formFields(cfg, 'prompt')).toEqual(['make it night']);
    expect(formFields(cfg, 'background')).toEqual(['transparent']);
    expect(formFields(cfg, 'quality')).toEqual(['low']);
    expect(formFields(cfg, 'num_images')).toEqual(['3']);
    expect(formFields(cfg, 'async')).toEqual(['false']);
    expect(formFields(cfg, 'size')).toEqual([]);
  });

  it('generateV45 without images sends no images part', async () => {
    fetchMock.mockReturnValue(ok(SYNC_RESPONSE));
    await api.generateV45({ prompt: 'x', images: [] });
    const cfg = sentConfig();
    expect(fileParts(cfg, 'images')).toEqual([]);
    expect(formFields(cfg, 'prompt')).toEqual(['x']);
  });

  it('generateAuto targets /v2/image/generate/auto and sends no webhook field', async () => {
    fetchMock.mockReturnValue(ok(SYNC_RESPONSE));
    await api.generateAuto({ prompt: 'map', aspectRatio: '16x9', resolutionTier: '2k', dryRun: true });
    const cfg = sentConfig();
    expect(cfg.url).toBe('https://api.ideogram.ai/v2/image/generate/auto?dry_run=true');
    expect(formFields(cfg, 'aspect_ratio')).toEqual(['16x9']);
    expect(formFields(cfg, 'resolution_tier')).toEqual(['2k']);
    expect(formNames(cfg)).not.toContain('webhook_url');
  });

  it('preciseEditV45 sends image, reference_images, mask and context_window', async () => {
    fetchMock.mockReturnValue(ok({ generation_kind: 'sampling', generation_id: 'g', data: [] }));
    await api.preciseEditV45({
      prompt: 'add sunglasses',
      image: PNG,
      referenceImages: [JPEG],
      mask: PNG,
      contextWindow: 'auto',
      quality: 'very_low',
    });
    const cfg = sentConfig();
    expect(cfg.url).toBe('https://api.ideogram.ai/v2/image/precise-edit/ideogram-4-5');
    expect(fileParts(cfg, 'image')).toEqual([{ filename: 'image.png', contentType: 'image/png' }]);
    expect(fileParts(cfg, 'reference_images')).toEqual([{ filename: 'image.jpg', contentType: 'image/jpeg' }]);
    expect(fileParts(cfg, 'mask')).toHaveLength(1);
    expect(formFields(cfg, 'context_window')).toEqual(['auto']);
    expect(formFields(cfg, 'quality')).toEqual(['very_low']);
  });

  it('preciseEditV45 requires an image', async () => {
    await expect(api.preciseEditV45({ prompt: 'x' })).rejects.toThrow('image is required');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('checks each endpoint against its own request-body ceiling', async () => {
    fetchMock.mockReturnValue(ok(SYNC_RESPONSE));
    const requests = spyRequests(api);
    const MB = 1024 * 1024;
    const cases = [
      [() => api.generateV4({ prompt: 'x' }), 1 * MB],
      [() => api.generateV45({ prompt: 'x' }), 151 * MB],
      [() => api.generateAuto({ prompt: 'x' }), 251 * MB],
      [() => api.preciseEditV45({ prompt: 'x', image: PNG }), 251 * MB],
      [() => api.generate({ prompt: 'x' }), 50 * MB],
    ];
    const seen = [];
    for (const [call] of cases) {
      requests.mockClear();
      await call();
      seen.push(requests.mock.calls[0][0].maxBodyBytes);
    }
    expect(seen).toEqual(cases.map(([, limit]) => limit));
  });

  it('rejects an oversized multipart body before sending', async () => {
    const big = Buffer.concat([PNG, Buffer.alloc(52 * 1024 * 1024)]);
    await expect(api.edit({ prompt: 'x', image: big, mask: PNG })).rejects.toThrow(
      /Request payload too large: .*exceeds maximum of 50MB/
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('v1 generate keeps its 120s timeout', async () => {
    fetchMock.mockReturnValue(ok({ data: [] }));
    await api.generate({ prompt: 'x' });
    expect(sentConfig().timeout).toBe(120000);
  });

  it('honours a per-request timeoutMs', async () => {
    fetchMock.mockReturnValue(ok(SYNC_RESPONSE));
    await api.generateV4({ prompt: 'x', timeoutMs: 999 });
    expect(sentConfig().timeout).toBe(999);
  });
});

describe('error mapping', () => {
  let api;

  beforeEach(() => {
    resetHttp();
    api = new IdeogramAPI('test-key-1234567890', undefined, 'error');
  });

  async function caught(promise) {
    try {
      await promise;
    } catch (e) {
      return e;
    }
    throw new Error('expected a rejection');
  }

  it('reads RFC 7807 `detail` from a v2 schema-validation 400', async () => {
    fetchMock.mockReturnValue(
      httpError(400, {
        type: 'https://developer.ideogram.ai/v2/llms.txt',
        title: 'Bad Request',
        detail: "'warp' is not one of ['turbo', 'default', 'quality'] - 'rendering_speed'",
        status: 400,
      })
    );
    const err = await caught(api.generateV4({ prompt: 'x', renderingSpeed: 'warp' }));
    expect(err).toBeInstanceOf(IdeogramAPIError);
    expect(err).toBeInstanceOf(Error);
    expect(err.status).toBe(400);
    expect(err.message).toBe(
      "Invalid input: 'warp' is not one of ['turbo', 'default', 'quality'] - 'rendering_speed'"
    );
  });

  it('reads `error` from a v2 rule-violation 400', async () => {
    fetchMock.mockReturnValue(httpError(400, { error: 'size "source" requires source images.' }));
    const err = await caught(api.generateV45({ prompt: 'x', size: 'source' }));
    expect(err.message).toBe('Invalid input: size "source" requires source images.');
  });

  it('reads the API reason on the v1 path too', async () => {
    fetchMock.mockReturnValue(httpError(400, { detail: 'resolution is invalid' }));
    const err = await caught(api.generate({ prompt: 'x' }));
    expect(err.message).toBe('Invalid input: resolution is invalid');
  });

  it('maps 402 with reject_reason', async () => {
    fetchMock.mockReturnValue(
      httpError(402, { error: 'Not enough credits.', reject_reason: 'insufficient_funds' })
    );
    const err = await caught(api.generateV4({ prompt: 'x' }));
    expect(err.status).toBe(402);
    expect(err.rejectReason).toBe('insufficient_funds');
    expect(err.message).toBe('Payment required (insufficient_funds): Not enough credits.');
  });

  it('maps 429 inflight_limit with its details', async () => {
    fetchMock.mockReturnValue(
      httpError(429, {
        error: 'Too many in flight.',
        reject_reason: 'inflight_limit',
        max_inflight_requests: 4,
        task_completion_speed: 'fast',
      })
    );
    const err = await caught(api.generateV4({ prompt: 'x' }));
    expect(err.message).toBe('Rate limit exceeded. Too many requests. (inflight_limit)');
    expect(err.maxInflightRequests).toBe(4);
  });

  it('keeps the 1.x 429 message when there is no reject_reason', async () => {
    fetchMock.mockReturnValue(httpError(429, {}));
    const err = await caught(api.generate({ prompt: 'x' }));
    expect(err.message).toBe('Rate limit exceeded. Too many requests.');
  });

  it('includes the API reason on 403 (custom model not accessible)', async () => {
    fetchMock.mockReturnValue(
      httpError(403, { error: 'You do not currently have access to this custom model.' })
    );
    const err = await caught(api.generateV4Custom({ prompt: 'x', customModelUri: 'model/a/version/1' }));
    expect(err.message).toBe(
      'Not authorized to perform this operation. You do not currently have access to this custom model.'
    );
  });

  it('keeps the 1.x 401 message', async () => {
    fetchMock.mockReturnValue(
      httpError(401, { message: 'Access denied. Please verify your API Token is valid.' })
    );
    const err = await caught(api.generateV4({ prompt: 'x' }));
    expect(err.message).toBe('Authentication failed. Check API key.');
    expect(err.status).toBe(401);
  });

  it('maps 404', async () => {
    fetchMock.mockReturnValue(httpError(404, { error: 'Request not found' }));
    const err = await caught(api.getGeneration('nope'));
    expect(err.message).toBe('Not found: Request not found');
  });
});

describe('getGeneration / waitForGeneration', () => {
  let api;

  beforeEach(() => {
    resetHttp();
    api = new IdeogramAPI('test-key-1234567890', undefined, 'error');
  });

  it('GETs /v2/generations/{id} with the id URL-encoded', async () => {
    fetchMock.mockReturnValue(ok({ generation_id: 'a/b', status: 'pending', created: 'now' }));
    await api.getGeneration('a/b');
    const cfg = sentConfig();
    expect(cfg.method).toBe('GET');
    expect(cfg.url).toBe('https://api.ideogram.ai/v2/generations/a%2Fb');
    expect(cfg.data).toBeUndefined();
  });

  it('polls until completed and reports every poll', async () => {
    fetchMock
      .mockReturnValueOnce(ok({ generation_id: 'g', status: 'pending', created: 't' }))
      .mockReturnValueOnce(ok({ generation_id: 'g', status: 'pending', created: 't' }))
      .mockReturnValueOnce(
        ok({ generation_id: 'g', status: 'completed', created: 't', response_type: 'url', data: [{ url: 'https://x/y.png' }] })
      );
    const seen = [];
    const done = await api.waitForGeneration('g', { intervalMs: 1, onPoll: (s) => seen.push(s.status) });
    expect(done.status).toBe('completed');
    expect(seen).toEqual(['pending', 'pending', 'completed']);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('throws with failureReason when the generation fails', async () => {
    fetchMock.mockReturnValue(
      ok({ generation_id: 'g', status: 'failed', created: 't', failure_reason: 'content_policy_violation' })
    );
    const err = await api.waitForGeneration('g', { intervalMs: 1 }).catch((e) => e);
    expect(err).toBeInstanceOf(IdeogramAPIError);
    expect(err.failureReason).toBe('content_policy_violation');
    expect(err.message).toBe('Generation g failed: content_policy_violation');
  });

  it('backs off on 429 and keeps polling', async () => {
    fetchMock
      .mockReturnValueOnce(httpError(429, {}))
      .mockReturnValueOnce(ok({ generation_id: 'g', status: 'completed', created: 't', data: [] }));
    // The 1s floor is real time otherwise: sleep is spied, and the delays are asserted in runtime-fixes-2.test.js.
    const sleeps = [];
    const timer = vi.spyOn(globalThis, 'setTimeout').mockImplementation((fn, ms) => {
      sleeps.push(ms);
      fn();
      return 0;
    });
    try {
      const done = await api.waitForGeneration('g', { intervalMs: 1 });
      expect(done.status).toBe('completed');
    } finally {
      timer.mockRestore();
    }
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleeps).toEqual([1000]);
  });

  it('rethrows non-429 errors', async () => {
    fetchMock.mockReturnValue(httpError(404, { error: 'Request not found' }));
    await expect(api.waitForGeneration('g', { intervalMs: 1 })).rejects.toThrow('Not found: Request not found');
  });

  it('times out while still pending', async () => {
    fetchMock.mockReturnValue(ok({ generation_id: 'g', status: 'pending', created: 't' }));
    await expect(api.waitForGeneration('g', { intervalMs: 5, timeoutMs: 20 })).rejects.toThrow(
      /Timed out after 20ms waiting for generation g/
    );
  });
});

describe('response helpers', () => {
  it('extractImageUrls skips unsafe images and non-image items', () => {
    expect(extractImageUrls(SYNC_RESPONSE)).toEqual(['https://ideogram.ai/a.png']);
    expect(
      extractImageUrls({
        generation_id: 'g',
        status: 'completed',
        created: 't',
        data: [
          { url: 'https://x/1.png' },
          { object_type: 'video.generation', url: 'https://x/v.mp4' },
          { object_type: 'image.generation', url: 'https://x/2.png' },
          { url: null, is_image_safe: false },
        ],
      })
    ).toEqual(['https://x/1.png', 'https://x/2.png']);
    expect(extractImageUrls({ generation_id: 'g', seed: 1 })).toEqual([]);
  });

  it('extractImages works on v2 responses with and without data', () => {
    expect(extractImages(SYNC_RESPONSE)).toHaveLength(2);
    expect(extractImages({ generation_id: 'g', seed: 1 })).toEqual([]);
  });

  it('isPriceQuote distinguishes quotes from generation responses', () => {
    expect(isPriceQuote(QUOTE)).toBe(true);
    expect(isPriceQuote(SYNC_RESPONSE)).toBe(false);
    expect(isPriceQuote(null)).toBe(false);
  });
});

describe('multipart file typing (utils)', () => {
  it('detectImageType recognises PNG, JPEG, WebP and GIF by magic bytes', () => {
    expect(detectImageType(PNG)).toEqual({ extension: 'png', mimeType: 'image/png' });
    expect(detectImageType(JPEG)).toEqual({ extension: 'jpg', mimeType: 'image/jpeg' });
    expect(detectImageType(WEBP)).toEqual({ extension: 'webp', mimeType: 'image/webp' });
    expect(detectImageType(Buffer.from('GIF89a'))).toEqual({ extension: 'gif', mimeType: 'image/gif' });
    expect(detectImageType(Buffer.from('not an image'))).toBeNull();
  });

  it('buildFormData names and types each file part after its bytes', () => {
    const form = buildFormData({ mask: PNG, images: [JPEG, PNG] });
    const parts = [...form.entries()].map(([name, file]) => `${name}:${file.name}:${file.type}`);
    expect(parts).toEqual([
      'mask:image.png:image/png',
      'images:image.jpg:image/jpeg',
      'images:image.png:image/png',
    ]);
  });
});

describe('validateV2Params', () => {
  const ok = (op, p) => expect(() => validateV2Params(op, { prompt: 'x', ...p })).not.toThrow();
  const bad = (op, p, msg) => expect(() => validateV2Params(op, { prompt: 'x', ...p })).toThrow(msg);

  it('applies the shared rules to every operation', () => {
    for (const op of [
      'generate-v4',
      'generate-v4-transparent',
      'generate-v45',
      'generate-auto',
    ]) {
      bad(op, { prompt: '' }, 'Prompt is required');
      bad(op, { prompt: 'a'.repeat(10001) }, 'maximum length of 10000');
      bad(op, { numImages: 9 }, 'numImages must be an integer between 1 and 8');
      bad(op, { numImages: 1.5 }, 'numImages must be an integer');
      bad(op, { seed: -1 }, 'seed must be an integer between 0 and 2147483647');
      bad(op, { magicPrompt: 'AUTO' }, "Invalid magic prompt mode 'AUTO'");
      ok(op, { numImages: 8, seed: 2147483647, magicPrompt: 'off' });
    }
  });

  it('generate-v4: resolution and rendering speed enums', () => {
    ok('generate-v4', { resolution: '2048x2048', renderingSpeed: 'turbo' });
    bad('generate-v4', { resolution: '1000x1000' }, "Invalid resolution '1000x1000'");
    bad('generate-v4', { renderingSpeed: 'DEFAULT' }, "Invalid rendering speed 'DEFAULT'");
    expect(V4_RESOLUTIONS).toHaveLength(38);
  });

  it('webhook URL must be HTTPS, and auto takes none', () => {
    ok('generate-v4', { webhookUrl: 'https://example.com/h' });
    bad('generate-v4', { webhookUrl: 'http://example.com/h' }, 'webhookUrl must be an HTTPS URL');
    bad('generate-auto', { webhookUrl: 'https://example.com/h' }, 'does not accept a webhook URL');
  });

  it('generate-v4-custom: model URI form', () => {
    ok('generate-v4-custom', { customModelUri: 'model/my-model/version/1' });
    bad('generate-v4-custom', {}, 'customModelUri is required');
    bad('generate-v4-custom', { customModelUri: 'my-model' }, 'customModelUri is required');
    bad('generate-v4-custom', { customModelUri: 'model/a/b/version/1' }, 'customModelUri is required');
  });

  it('generate-v4-transparent: aspect ratio and output tier enums', () => {
    ok('generate-v4-transparent', { aspectRatio: '4x1', outputResolution: '8k' });
    bad('generate-v4-transparent', { aspectRatio: '16:9' }, "Invalid aspect ratio '16:9'");
    bad('generate-v4-transparent', { outputResolution: '16k' }, "Invalid output resolution '16k'");
  });

  it('generate-v45: image, mask and size rules', () => {
    ok('generate-v45', { imageCount: 5 });
    bad('generate-v45', { imageCount: 6 }, 'At most 5 source images');
    ok('generate-v45', { imageCount: 4, hasMask: true });
    bad('generate-v45', { imageCount: 5, hasMask: true }, 'at most 3 source images besides the first');
    bad('generate-v45', { hasMask: true }, 'A mask requires at least one source image');
    bad('generate-v45', { imageCount: 1, hasMask: true, size: 'auto' }, 'size cannot be set with a mask');
    bad('generate-v45', { quality: 'very_low' }, "'very_low' requires source images");
    ok('generate-v45', { quality: 'very_low', imageCount: 1 });
    bad('generate-v45', { size: 'source' }, "'source' requires source images");
    ok('generate-v45', { size: 'source', imageCount: 1 });
    ok('generate-v45', { size: '1440x2880' });
    bad('generate-v45', { size: '1000x1000' }, 'multiples of 32');
    bad('generate-v45', { size: '224x224', imageCount: 1 }, 'at least 256px');
    bad('generate-v45', { size: '2080x2048', imageCount: 1 }, 'at most 2048x2048 pixels');
    bad('generate-v45', { size: '256x1792', imageCount: 1 }, 'at most 6:1');
    ok('generate-v45', { size: '1088x1088', imageCount: 1 });
    bad('generate-v45', { size: '1088x1088' }, 'supported preset');
    bad('generate-v45', { size: 'big' }, "Invalid size 'big'");
    bad('generate-v45', { background: 'clear' }, "Invalid background 'clear'");
  });

  it('generate-auto: exclusivity rules', () => {
    ok('generate-auto', { imageCount: 10 });
    bad('generate-auto', { imageCount: 11 }, 'At most 10 source images');
    bad('generate-auto', { imageCount: 1, negativePrompt: 'blur' }, 'negativePrompt cannot be combined');
    ok('generate-auto', { negativePrompt: 'blur' });
    bad('generate-auto', { aspectRatio: '16x9', resolution: '1280x800' }, 'not both');
    ok('generate-auto', { aspectRatio: 'auto', resolution: '1280x800' });
    bad('generate-auto', { aspectRatio: '7x5' }, "Invalid aspect ratio '7x5'");
    ok('generate-auto', { aspectRatio: '7x5', imageCount: 1 });
    bad('generate-auto', { resolution: '1280 by 800' }, "Invalid resolution '1280 by 800'");
    bad('generate-auto', { resolutionTier: '8k' }, "Invalid resolution tier '8k'");
  });

  it('precise-edit-v45: reference and context-window rules', () => {
    ok('precise-edit-v45', { referenceImageCount: 4 });
    bad('precise-edit-v45', { referenceImageCount: 5 }, 'At most 4 reference images');
    bad('precise-edit-v45', { referenceImageCount: 4, hasMask: true }, 'At most 3 reference images are allowed with a mask');
    // 'auto' without a mask is legal since the 2026-11 spec: it edits the whole image.
    ok('precise-edit-v45', { contextWindow: 'auto' });
    ok('precise-edit-v45', { contextWindow: 'auto', hasMask: true });
    ok('precise-edit-v45', { contextWindow: '512,1024,2048,3072' });
    bad('precise-edit-v45', { hasImage: false }, 'image is required');
  });
});

describe('parseContextWindow', () => {
  it('parses the documented example (rows first)', () => {
    expect(parseContextWindow('512,1024,2048,3072')).toEqual({ yMin: 512, xMin: 1024, yMax: 2048, xMax: 3072 });
  });

  it('returns null for none and auto', () => {
    expect(parseContextWindow('none')).toBeNull();
    expect(parseContextWindow('auto')).toBeNull();
  });

  it('enforces size, aspect, area and bounds', () => {
    expect(() => parseContextWindow('0,0,255,1000')).toThrow('at least 256px');
    expect(() => parseContextWindow('0,0,256,1792')).toThrow('between 1:6 and 6:1');
    expect(() => parseContextWindow('0,0,2048,2080')).toThrow('maximum is 4194304');
    expect(() => parseContextWindow('0,0,1024,1024', { width: 800, height: 2000 })).toThrow('outside the 800x2000 image');
    expect(() => parseContextWindow('0,0,1024,1024', { width: 1024, height: 1024 })).not.toThrow();
    expect(() => parseContextWindow('1,2,3')).toThrow("Invalid contextWindow '1,2,3'");
  });
});
