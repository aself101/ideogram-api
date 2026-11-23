/**
 * cli-v2 behaviour not reached by cli.test.js: every operation's dispatch to
 * its endpoint, the local pre-flight checks that run before any upload, and the
 * result-saving branches (video without URL, non-image kinds, extension choice).
 * Same harness as cli.test.js: fetch stubbed, DNS mocked, console captured.
 */

import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, truncateSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

vi.mock('dns/promises', () => ({
  lookup: vi.fn(async () => ({ address: '8.8.8.8', family: 4 })),
}));

import { fetchMock, resetHttp, fakeResponse } from './helpers/http.js';
import { executeV2, executeAsyncV2, executeGetGeneration } from '../src/cli-v2.js';
import { V2_LIMITS, ENDPOINTS } from '../src/config.js';

const KEY = 'test-key-1234567890';
const CDN = 'https://cdn.ideogram.ai';
const MiB = 1024 * 1024;
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
const WEBP_BYTES = Buffer.from('RIFF\x00\x00\x00\x00WEBPVP8 ', 'binary');

/** A PNG whose IHDR declares width x height (enough for image-size; no pixel data). */
function pngOf(width, height) {
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write('IHDR', 4, 'ascii');
  ihdr.writeUInt32BE(width, 8);
  ihdr.writeUInt32BE(height, 12);
  ihdr[16] = 8;
  ihdr[17] = 2;
  return Buffer.concat([PNG_SIG, ihdr]);
}

let work; // per-file scratch dir: output + input fixtures
let outDir;
let logs;
let errors;
let exitSpy;
let spies = [];
let seq = 0;

const global = () => ({ apiKey: KEY, outputDir: outDir, logLevel: 'error' });
const out = () => logs.join('\n');
const err = () => errors.join('\n');
const fixture = (bytes) => {
  const p = join(work, `f${++seq}.bin`);
  writeFileSync(p, bytes);
  return p;
};
const sparse = (bytes) => {
  const p = join(work, `f${++seq}.bin`);
  writeFileSync(p, PNG_SIG);
  truncateSync(p, bytes);
  return p;
};
const apiUrls = () => fetchMock.mock.calls.map(([u]) => new URL(u).pathname);

function route({ api, files = {} }) {
  fetchMock.mockImplementation(async (url, init = {}) => {
    const u = new URL(url);
    if (u.host === 'api.ideogram.ai') return fakeResponse(200, api(init.method, u.pathname));
    if (!(url in files)) throw new Error(`unexpected download: ${url}`);
    return new Response(files[url]);
  });
}
// An accepted (async) answer: no data, so nothing is downloaded. An empty data list is a zero-result error.
const ack = () => route({ api: () => ({ generation_id: 'gen1' }) });

beforeEach(() => {
  resetHttp();
  work = mkdtempSync(join(tmpdir(), 'ideogram-cliv2-'));
  outDir = join(work, 'out');
  logs = [];
  errors = [];
  spies = [
    vi.spyOn(console, 'log').mockImplementation((...a) => void logs.push(a.join(' '))),
    vi.spyOn(console, 'error').mockImplementation((...a) => void errors.push(a.join(' '))),
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true),
    (exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined)),
  ];
});

afterEach(() => {
  spies.forEach((s) => s.mockRestore());
  rmSync(work, { recursive: true, force: true });
});

afterAll(() => {
  rmSync(work, { recursive: true, force: true });
});

describe('executeV2 dispatch: each operation reaches its endpoint', () => {
  const cases = [
    ['generate-v4-transparent', { prompt: 'p', aspectRatio: '1x1' }, ENDPOINTS.GENERATE_V4_TRANSPARENT],
    ['generate-v4-custom', { prompt: 'p', model: 'model/my-model/version/v1' }, ENDPOINTS.GENERATE_V4_CUSTOM],
    ['generate-v45', { prompt: 'p', size: 'auto' }, ENDPOINTS.GENERATE_V45],
    ['generate-v46', { prompt: 'p', size: 'auto' }, ENDPOINTS.GENERATE_V46],
    ['generate-auto', { prompt: 'p' }, ENDPOINTS.GENERATE_AUTO],
  ];
  for (const [op, options, endpoint] of cases) {
    it(`${op} posts to ${endpoint}`, async () => {
      ack();
      await executeV2(op, options, global());
      expect(exitSpy).not.toHaveBeenCalled();
      expect(apiUrls()).toEqual([endpoint]);
    });
  }

  it('precise-edit-v45 and -v46 post the image to their own endpoints', async () => {
    ack();
    await executeV2('precise-edit-v45', { prompt: 'p', image: fixture(pngOf(512, 512)) }, global());
    await executeV2('precise-edit-v46', { prompt: 'p', image: fixture(pngOf(512, 512)) }, global());
    expect(exitSpy).not.toHaveBeenCalled();
    expect(apiUrls()).toEqual([ENDPOINTS.PRECISE_EDIT_V45, ENDPOINTS.PRECISE_EDIT_V46]);
  });

  it('upscale-auto posts to the upscale endpoint and prints the output size', async () => {
    route({ api: () => ({ generation_id: 'gu', width: 2048, height: 1024 }) });
    await executeV2('upscale-auto', { image: fixture(pngOf(1024, 512)), upscaleFactor: 'x2' }, global());
    expect(exitSpy).not.toHaveBeenCalled();
    expect(apiUrls()).toEqual([ENDPOINTS.UPSCALE_AUTO]);
    expect(out()).toContain('Output: 2048x1024');
  });

  it('an unknown operation is refused before any request', async () => {
    await executeV2('generate-svg', { prompt: 'p' }, global());
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('executeAsyncV2 dispatch: each operation reaches its endpoint', () => {
  const png = () => fixture(pngOf(512, 512));
  const cases = [
    ['generate-svg', () => ({ prompt: 'p', images: [png()], asset: ['ASSET:a1:' + 'c'.repeat(22)], gradient: false }), ENDPOINTS.GENERATE_SVG],
    ['minimax-h3-text-to-video', () => ({ prompt: 'p' }), ENDPOINTS.VIDEO_MINIMAX_H3_TEXT],
    ['minimax-h3-image-to-video', () => ({ prompt: 'p', image: png(), endImage: png() }), ENDPOINTS.VIDEO_MINIMAX_H3_IMAGE],
    ['minimax-h3-reference-to-video', () => ({ prompt: 'p', referenceImages: [png()] }), ENDPOINTS.VIDEO_MINIMAX_H3_REFERENCE],
    ['seedance-2-5-text-to-video', () => ({ prompt: 'p' }), ENDPOINTS.VIDEO_SEEDANCE_25_TEXT],
    ['seedance-2-5-image-to-video', () => ({ prompt: 'p', image: png() }), ENDPOINTS.VIDEO_SEEDANCE_25_IMAGE],
    ['seedance-2-5-reference-to-video', () => ({ prompt: 'p', referenceImages: [png()] }), ENDPOINTS.VIDEO_SEEDANCE_25_REFERENCE],
  ];
  for (const [op, options, endpoint] of cases) {
    it(`${op} posts to ${endpoint}`, async () => {
      route({ api: () => ({ generation_id: 'v1' }) });
      await executeAsyncV2(op, options(), global());
      expect(exitSpy).not.toHaveBeenCalled();
      expect(apiUrls()).toEqual([endpoint]);
      expect(out()).toContain('Generation accepted: v1');
    });
  }

  it('prints the webhook destination when one is given', async () => {
    route({ api: () => ({ generation_id: 'v1' }) });
    await executeAsyncV2('minimax-h3-text-to-video', { prompt: 'p', webhookUrl: 'https://example.com/hook' }, global());
    expect(out()).toContain('Ideogram will POST the result to https://example.com/hook');
  });

  it('an image operation is refused before any request', async () => {
    await executeAsyncV2('generate-v4', { prompt: 'p' }, global());
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('pre-flight: per-file size limits', () => {
  const tooBig = (limit) => sparse(limit + MiB);

  it.each([
    ['precise-edit-v45', V2_LIMITS.preciseEdit.maxFileBytes, (f) => ({ prompt: 'p', image: f })],
    ['generate-auto', V2_LIMITS.auto.maxFileBytes, (f) => ({ prompt: 'p', images: [f] })],
    ['generate-v45', V2_LIMITS.v45.maxFileBytes, (f) => ({ prompt: 'p', images: [f] })],
    ['generate-v46', V2_LIMITS.v46.maxFileBytes, (f) => ({ prompt: 'p', images: [f] })],
    ['upscale-auto', V2_LIMITS.upscale.maxFileBytes, (f) => ({ image: f })],
  ])('%s rejects an image over its limit without calling the API', async (op, limit, opts) => {
    await executeV2(op, opts(tooBig(limit)), global());
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(err()).toContain(`this endpoint accepts at most ${limit / MiB}MB per image`);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['generate-svg', V2_LIMITS.svgMaxFileBytes, (f) => ({ prompt: 'p', images: [f] })],
    ['minimax-h3-image-to-video', V2_LIMITS.minimaxH3.maxFileBytes, (f) => ({ prompt: 'p', image: f })],
    ['seedance-2-5-image-to-video', V2_LIMITS.seedance25.maxFileBytes, (f) => ({ prompt: 'p', image: f })],
  ])('%s rejects an image over its limit without calling the API', async (op, limit, opts) => {
    await executeAsyncV2(op, opts(tooBig(limit)), global());
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(err()).toContain(`this endpoint accepts at most ${limit / MiB}MB per image`);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('an image exactly at the limit is not rejected for size', async () => {
    ack();
    await executeV2('generate-auto', { prompt: 'p', images: [sparse(V2_LIMITS.auto.maxFileBytes)] }, global());
    expect(exitSpy).not.toHaveBeenCalled();
    expect(apiUrls()).toEqual([ENDPOINTS.GENERATE_AUTO]);
  });

  it('a minimax reference audio over its limit is refused', async () => {
    await executeAsyncV2(
      'minimax-h3-reference-to-video',
      { prompt: 'p', referenceImages: [fixture(pngOf(512, 512))], referenceAudios: [sparse(V2_LIMITS.minimaxH3.maxAudioBytes + MiB)] },
      global()
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(err()).toContain('reference audio is limited to 15MB per file');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a seedance reference audio over its limit is refused', async () => {
    await executeAsyncV2(
      'seedance-2-5-reference-to-video',
      { prompt: 'p', referenceImages: [fixture(pngOf(512, 512))], referenceAudios: [sparse(V2_LIMITS.seedance25.maxAudioBytes + MiB)] },
      global()
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(err()).toContain('reference audio is limited to 15MB per file');
  });
});

describe('pre-flight: dimensions', () => {
  it('upscale refuses an output over the per-side cap, and accepts exactly the cap', async () => {
    const cap = V2_LIMITS.upscale.maxOutputSide;
    await executeV2('upscale-auto', { image: fixture(pngOf(cap / 2 + 1, 100)), upscaleFactor: 'x2' }, global());
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(err()).toContain(`the output may not exceed ${cap}px per side`);
    expect(fetchMock).not.toHaveBeenCalled();

    exitSpy.mockClear();
    ack();
    await executeV2('upscale-auto', { image: fixture(pngOf(cap / 2, 100)), upscaleFactor: 'x2' }, global());
    expect(exitSpy).not.toHaveBeenCalled();
    expect(apiUrls()).toEqual([ENDPOINTS.UPSCALE_AUTO]);
  });

  it('a mask whose size differs from the image is refused', async () => {
    await executeV2(
      'precise-edit-v45',
      { prompt: 'p', image: fixture(pngOf(512, 512)), mask: fixture(pngOf(512, 256)) },
      global()
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(err()).toContain('Mask is 512x256 but the image is 512x512; they must match');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('precise edit refuses an image over the pixel cap', async () => {
    await executeV2('precise-edit-v45', { prompt: 'p', image: fixture(pngOf(8193, 8192)) }, global());
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(err()).toContain('precise edit accepts at most 67108864 pixels');

    exitSpy.mockClear();
    ack();
    await executeV2('precise-edit-v45', { prompt: 'p', image: fixture(pngOf(8192, 8192)) }, global());
    expect(exitSpy).not.toHaveBeenCalled(); // exactly the cap is allowed
  });

  it('precise edit refuses a context window outside the image', async () => {
    await executeV2(
      'precise-edit-v45',
      { prompt: 'p', image: fixture(pngOf(512, 512)), contextWindow: '0,0,300,600' },
      global()
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(err()).toContain('outside the 512x512 image');
  });

  it('warns that a whole-image edit above the pixel bound is scaled down, but still sends it', async () => {
    ack();
    await executeV2('precise-edit-v45', { prompt: 'p', image: fixture(pngOf(2100, 2100)) }, global());
    expect(exitSpy).not.toHaveBeenCalled();
    expect(out()).toContain('exceeds 2048x2048 pixels: editing the whole image returns it scaled down');
    expect(apiUrls()).toEqual([ENDPOINTS.PRECISE_EDIT_V45]);
  });

  it('does not warn when a mask makes auto a masked edit, or when the image fits', async () => {
    ack();
    const big = pngOf(2100, 2100);
    await executeV2('precise-edit-v45', { prompt: 'p', image: fixture(big), mask: fixture(big) }, global());
    await executeV2('precise-edit-v45', { prompt: 'p', image: fixture(pngOf(512, 512)) }, global());
    expect(exitSpy).not.toHaveBeenCalled();
    expect(out()).not.toContain('scaled down');
  });

  it('uses the 4.6 bound for the warning: 2100x2100 fits at 4.6', async () => {
    ack();
    await executeV2('precise-edit-v46', { prompt: 'p', image: fixture(pngOf(2100, 2100)) }, global());
    expect(exitSpy).not.toHaveBeenCalled();
    expect(out()).not.toContain('scaled down');
  });

  it('a source image over 6:1 is refused on generate-v45, exactly 6:1 is not', async () => {
    const primary = fixture(pngOf(1568, 256));
    await executeV2('generate-v45', { prompt: 'p', images: [primary], size: 'auto' }, global());
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(err()).toContain('source aspect ratios must be between 1:6 and 6:1');

    exitSpy.mockClear();
    errors.length = 0;
    // second image over the limit: checked separately from the primary
    await executeV2(
      'generate-v45',
      { prompt: 'p', images: [fixture(pngOf(512, 512)), fixture(pngOf(256, 1568))], size: 'auto' },
      global()
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(err()).toContain('256x1568');

    exitSpy.mockClear();
    ack();
    await executeV2('generate-v45', { prompt: 'p', images: [fixture(pngOf(1536, 256))], size: 'auto' }, global());
    expect(exitSpy).not.toHaveBeenCalled();
  });
});

describe('saving results', () => {
  const dirFiles = (sub) => readdirSync(join(outDir, sub));
  const meta = (sub) => JSON.parse(readFileSync(join(outDir, sub, dirFiles(sub).find((n) => n.endsWith('.json'))), 'utf8'));

  it('names downloaded images by their bytes: jpg, webp, and png for unknown bytes', async () => {
    route({
      api: () => ({
        generation_id: 'g',
        data: [
          { url: `${CDN}/1`, is_image_safe: true },
          { url: `${CDN}/2`, is_image_safe: true },
          { url: `${CDN}/3`, is_image_safe: true },
        ],
      }),
      files: { [`${CDN}/1`]: JPEG_BYTES, [`${CDN}/2`]: WEBP_BYTES, [`${CDN}/3`]: Buffer.from('????????????') },
    });
    await executeV2('generate-v4', { prompt: 'cat' }, global());
    const names = dirFiles('generate-v4').filter((n) => !n.endsWith('.json'));
    expect(names.map((n) => n.split('.').pop()).sort()).toEqual(['jpg', 'png', 'webp']);
  });

  it('records a non-image result in the metadata without downloading it', async () => {
    route({
      api: () => ({ generation_id: 'g', data: [{ object_type: 'audio.generation', url: `${CDN}/a.wav` }] }),
    });
    await executeV2('generate-v4', { prompt: 'cat' }, global());
    expect(out()).toContain('Item 1/1 is a audio.generation; not downloaded (see metadata)');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(meta('generate-v4').response.items[0]).toEqual({ index: 1, objectType: 'audio.generation', url: `${CDN}/a.wav` });
  });

  it('records a video and an SVG without URLs instead of downloading', async () => {
    route({
      api: (method) =>
        method === 'POST'
          ? { generation_id: 'v' }
          : {
              generation_id: 'v',
              status: 'completed',
              created: 't',
              data: [
                { object_type: 'video.generation', asset_id: 'a1' },
                { object_type: 'svg.generation', asset_id: 'a2' },
              ],
            },
    });
    await executeAsyncV2('generate-svg', { prompt: 'logo', wait: true, pollInterval: '1' }, global());
    expect(exitSpy).not.toHaveBeenCalled();
    expect(out()).toContain('⚠ video 1/2 has no URL');
    expect(out()).toContain('⚠ SVG 2/2 has no URL');
    expect(meta('generate-svg').response.items).toEqual([
      { index: 1, objectType: 'video.generation', assetId: 'a1' },
      { index: 2, objectType: 'svg.generation', assetId: 'a2' },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2); // submit + one poll, no downloads
  });

  it('falls back to mp4 for a video URL with no usable extension, and to the URL extension otherwise', async () => {
    route({
      api: () => ({
        generation_id: 'g',
        status: 'completed',
        created: 't',
        data: [
          { object_type: 'video.generation', url: `${CDN}/clip` },
          { object_type: 'video.generation', url: `${CDN}/clip.webm` },
          { object_type: 'svg.generation', url: `${CDN}/logo.toolongext` },
        ],
      }),
      files: { [`${CDN}/clip`]: 'a', [`${CDN}/clip.webm`]: 'b', [`${CDN}/logo.toolongext`]: 'c' },
    });
    await executeGetGeneration('g', {}, global());
    const exts = dirFiles('generations').filter((n) => !n.endsWith('.json')).map((n) => n.split('.').pop()).sort();
    expect(exts).toEqual(['mp4', 'svg', 'webm']);
  });
});

describe('saving results: a video whose URL cannot be parsed', () => {
  it('falls back to mp4 for the name, then fails at download and exits 1', async () => {
    route({
      api: () => ({
        generation_id: 'g',
        status: 'completed',
        created: 't',
        data: [{ object_type: 'video.generation', url: 'not a url' }],
      }),
    });
    await executeGetGeneration('g', {}, global());
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(err()).toContain('✗ Error:');
    expect(readdirSync(join(outDir, 'generations')).some((n) => n.endsWith('.mp4'))).toBe(false);
  });
});

describe('executeGetGeneration', () => {
  it('prints failure reason and usage cost, and a failed generation saves nothing', async () => {
    route({
      api: () => ({
        generation_id: 'gf',
        status: 'failed',
        created: 't0',
        failure_reason: 'content policy',
        usage_cost_usd_micros: 12500,
      }),
    });
    await executeGetGeneration('gf', {}, global());
    expect(exitSpy).not.toHaveBeenCalled();
    expect(out()).toContain('Generation gf: failed (created t0)');
    expect(out()).toContain('Failure reason: content policy');
    expect(out()).toContain('Usage cost: $0.0125');
    expect(out()).not.toContain('Still running');
  });

  it('tells the user a pending generation is still running', async () => {
    route({ api: () => ({ generation_id: 'gp', status: 'pending', created: 't' }) });
    await executeGetGeneration('gp', {}, global());
    expect(out()).toContain('Still running. Re-run with --wait');
  });

  it('a completed generation without data reports no results', async () => {
    route({ api: () => ({ generation_id: 'gc', status: 'completed', created: 't' }) });
    await executeGetGeneration('gc', {}, global());
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(err()).toContain('returned no results');
  });

  it('exits 1 on a non-integer poll interval', async () => {
    await executeGetGeneration('g', { pollInterval: 'x' }, global());
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(err()).toContain('--poll-interval must be an integer');
  });
});
