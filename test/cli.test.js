/**
 * The v2 CLI execution layer (src/cli-v2.ts) and the commander program (src/cli.ts).
 *
 * cli-v2 is imported and driven with fetch stubbed and DNS mocked (the result
 * downloads go through the SSRF check). cli.ts calls program.parse at import,
 * so it is tested by spawning it; those cases need no network because they stop
 * at argument parsing or at the missing-API-key check.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { spawnSync } from 'child_process';
import { mkdtempSync, readdirSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

vi.mock('dns/promises', () => ({
  lookup: vi.fn(async () => ({ address: '8.8.8.8', family: 4 })),
}));

import { fetchMock, resetHttp, fakeResponse } from './helpers/http.js';
import {
  executeV2,
  executeAsyncV2,
  executeGetGeneration,
  parseColorPalette,
  parseAssets,
  parseIntOption,
  getGenerationCommand,
  describeError,
} from '../src/cli-v2.js';

const KEY = 'test-key-1234567890';
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const CDN = 'https://cdn.ideogram.ai';

let outDir;
let logs;
let errors;
let exitSpy;
let spies = [];

const global = () => ({ apiKey: KEY, outputDir: outDir, logLevel: 'error' });
const out = () => logs.join('\n');
const err = () => errors.join('\n');

/**
 * Route the stubbed fetch: API calls (api.ideogram.ai) answer from `api(method, path, n)`,
 * everything else is a download answered from `files[url]`.
 */
function route({ api, files = {} }) {
  const polls = {};
  fetchMock.mockImplementation(async (url, init = {}) => {
    const u = new URL(url);
    if (u.host === 'api.ideogram.ai') {
      polls[u.pathname] = (polls[u.pathname] ?? 0) + 1;
      const body = api(init.method, u.pathname, polls[u.pathname], u.searchParams);
      return fakeResponse(200, body);
    }
    if (!(url in files)) throw new Error(`unexpected download: ${url}`);
    return new Response(files[url]);
  });
}

const outputFiles = (sub) => readdirSync(join(outDir, sub));
const readJson = (sub) => {
  const f = outputFiles(sub).find((n) => n.endsWith('.json'));
  return JSON.parse(readFileSync(join(outDir, sub, f), 'utf8'));
};

beforeEach(() => {
  resetHttp();
  outDir = mkdtempSync(join(tmpdir(), 'ideogram-cli-'));
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
  // Not vi.restoreAllMocks(): that would also restore the shared AbortSignal.timeout spy.
  spies.forEach((s) => s.mockRestore());
});

describe('executeV2', () => {
  it('exits 1 with the message when validation fails, without calling the API', async () => {
    await executeV2('generate-v4', { prompt: 'a cat', numImages: '99' }, global());
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(err()).toContain('numImages must be an integer between');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('exits 1 on a non-integer option, naming the flag', async () => {
    await executeV2('generate-v4', { prompt: 'a cat', seed: 'abc' }, global());
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(err()).toContain("--seed must be an integer (got 'abc')");
  });

  it('rejects --wait without --async', async () => {
    await executeV2('generate-v4', { prompt: 'a cat', wait: true }, global());
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(err()).toContain('--wait requires --async');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('exits 1 when the API call fails, appending the error code when the message lacks it', async () => {
    const cause = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });
    fetchMock.mockRejectedValue(Object.assign(new TypeError('fetch failed'), { cause }));
    await executeV2('generate-v4', { prompt: 'a cat' }, global());
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(err()).toContain('✗ Error:');
    expect(err()).toContain('ECONNRESET');
  });

  it('dryRun prints the price quote and generates nothing', async () => {
    route({
      api: () => ({
        object: 'price_quote',
        quantity: 2,
        billing_identifier: 'ideogram-4',
        usd_micros: 80000,
        credit_millis: 4000,
        qualifier: 'exact',
        upper_bound_usd_micros: 120000,
      }),
    });
    await executeV2('generate-v4', { prompt: 'a cat', dryRun: true }, global());
    expect(exitSpy).not.toHaveBeenCalled();
    expect(out()).toContain('Price quote (dry run');
    expect(out()).toContain('2 x ideogram-4');
    expect(out()).toContain('$0.0800 (4 credits)');
    expect(out()).toContain('Qualifier: exact');
    expect(out()).toContain('Upper bound: $0.1200');
    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain('dry_run=true');
    expect(existsSync(join(outDir, 'generate-v4'))).toBe(false);
  });

  it('downloads a synchronous image result into <outputDir>/<operation> with a metadata JSON', async () => {
    route({
      api: () => ({
        generation_id: 'gen_sync',
        generation_kind: 'sampling',
        seed: 7,
        data: [{ url: `${CDN}/a.png`, resolution: '1024x1024', seed: 7, is_image_safe: true, prompt: 'final cat' }],
      }),
      files: { [`${CDN}/a.png`]: PNG },
    });
    await executeV2('generate-v4', { prompt: 'a cat' }, global());
    expect(exitSpy).not.toHaveBeenCalled();

    const files = outputFiles('generate-v4');
    const png = files.find((n) => n.endsWith('.png'));
    expect(png).toMatch(/_a-cat\.png$/);
    expect(readFileSync(join(outDir, 'generate-v4', png))).toEqual(PNG);

    const meta = readJson('generate-v4');
    expect(meta.operation).toBe('generate-v4');
    expect(meta.generationId).toBe('gen_sync');
    expect(meta.seed).toBe(7);
    expect(meta.generationKind).toBe('sampling');
    expect(meta.parameters.prompt).toBe('a cat');
    expect(meta.response.itemCount).toBe(1);
    expect(meta.response.items[0]).toMatchObject({ index: 1, url: `${CDN}/a.png`, seed: 7, finalPrompt: 'final cat' });
    expect(meta.response.items[0].path).toBe(join(outDir, 'generate-v4', png));
    expect(out()).toContain('✓ Saved image 1/1');
    expect(out()).toContain('✓ Done!');
  });

  it('skips an image that failed safety checks and says so in the metadata', async () => {
    route({
      api: () => ({
        generation_id: 'g',
        data: [{ url: '', is_image_safe: false, resolution: '1024x1024', seed: 3 }],
      }),
    });
    await executeV2('generate-v4', { prompt: 'a cat' }, global());
    expect(out()).toContain('failed safety checks');
    expect(outputFiles('generate-v4').some((n) => n.endsWith('.png'))).toBe(false);
    expect(readJson('generate-v4').response.items[0]).toMatchObject({ index: 1, isImageSafe: false, seed: 3 });
  });

  it('reports an async acknowledgement and the get-generation hint', async () => {
    route({ api: () => ({ generation_id: 'gen1' }) });
    await executeV2('generate-v4', { prompt: 'a cat', async: true }, global());
    expect(out()).toContain('Generation accepted: gen1');
    expect(out()).toContain('Check on it with: ideogram get-generation gen1 --wait');
  });

  it("puts an id starting with '-' after -- in the hint", async () => {
    route({ api: () => ({ generation_id: '-uaWvHfERk65rkfjaocs9w' }) });
    await executeV2('generate-v4', { prompt: 'a cat', async: true }, global());
    expect(out()).toContain('Check on it with: ideogram get-generation --wait -- -uaWvHfERk65rkfjaocs9w');
  });

  it('--async --wait polls the generation and downloads the finished image', async () => {
    route({
      api: (method, path, n) => {
        if (method === 'POST') return { generation_id: 'gen_w' };
        expect(path).toBe('/v2/generations/gen_w');
        return n < 2
          ? { generation_id: 'gen_w', status: 'pending', created: 't' }
          : {
              generation_id: 'gen_w',
              status: 'completed',
              created: 't',
              usage_cost_usd_micros: 40000,
              data: [{ url: `${CDN}/w.png`, is_image_safe: true, resolution: '1024x1024', seed: 1 }],
            };
      },
      files: { [`${CDN}/w.png`]: PNG },
    });
    await executeV2('generate-v4', { prompt: 'a cat', async: true, wait: true, pollInterval: '1' }, global());
    expect(exitSpy).not.toHaveBeenCalled();
    const urls = fetchMock.mock.calls.map(([u]) => String(u));
    expect(urls.filter((u) => u.endsWith('/v2/generations/gen_w'))).toHaveLength(2); // pending, then completed
    expect(urls.filter((u) => u === `${CDN}/w.png`)).toHaveLength(1);
    expect(outputFiles('generate-v4').some((n) => n.endsWith('.png'))).toBe(true);
    expect(readJson('generate-v4').usageCostUsdMicros).toBe(40000);
  });

  it('prints the webhook destination when one is given', async () => {
    route({ api: () => ({ generation_id: 'gen1' }) });
    await executeV2(
      'generate-v4',
      { prompt: 'a cat', async: true, webhookUrl: 'https://example.com/hook' },
      global()
    );
    expect(out()).toContain('Ideogram will POST the result to https://example.com/hook');
  });
});

describe('executeAsyncV2', () => {
  it('exits 1 on an out-of-range duration', async () => {
    await executeAsyncV2('minimax-h3-text-to-video', { prompt: 'a boat', duration: '999' }, global());
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(err()).toContain('duration');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('exits 1 on a malformed --asset', async () => {
    await executeAsyncV2('generate-svg', { prompt: 'a logo', asset: ['justone'] }, global());
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(err()).toContain("--asset 'justone' must be TYPE:ID or TYPE:ID:COLLECTION");
  });

  it('dryRun prints the quote', async () => {
    route({
      api: () => ({
        object: 'price_quote',
        quantity: 1,
        billing_identifier: 'minimax-h3',
        usd_micros: 500000,
        credit_millis: 25000,
        qualifier: 'exact',
      }),
    });
    await executeAsyncV2('minimax-h3-text-to-video', { prompt: 'a boat', dryRun: true }, global());
    expect(out()).toContain('1 x minimax-h3');
    expect(out()).toContain('$0.5000 (25 credits)');
    expect(out()).not.toContain('Upper bound');
  });

  it('without --wait prints the id and the hint, and downloads nothing', async () => {
    route({ api: () => ({ generation_id: 'vid1' }) });
    await executeAsyncV2('minimax-h3-text-to-video', { prompt: 'a boat' }, global());
    expect(out()).toContain('Generation accepted: vid1');
    expect(out()).toContain('Check on it with: ideogram get-generation vid1 --wait');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("uses `get-generation --wait --` for an id starting with '-'", async () => {
    route({ api: () => ({ generation_id: '-vid' }) });
    await executeAsyncV2('seedance-2-5-text-to-video', { prompt: 'a boat' }, global());
    expect(out()).toContain('Check on it with: ideogram get-generation --wait -- -vid');
  });

  it('--wait polls, then streams a video to disk with a metadata JSON', async () => {
    route({
      api: (method, path, n) => {
        if (method === 'POST') return { generation_id: 'vid2' };
        return n < 2
          ? { generation_id: 'vid2', status: 'pending', created: 't' }
          : {
              generation_id: 'vid2',
              status: 'completed',
              created: 't',
              usage_cost_usd_micros: 500000,
              data: [
                {
                  object_type: 'video.generation',
                  url: `${CDN}/clip.mp4?sig=1`,
                  asset_id: 'asset1',
                  resolution: '720p',
                  aspect_ratio: '16:9',
                  duration: 5,
                  prompt: 'a boat',
                },
              ],
            };
      },
      files: { [`${CDN}/clip.mp4?sig=1`]: 'VIDEOBYTES' },
    });
    await executeAsyncV2(
      'minimax-h3-text-to-video',
      { prompt: 'a boat', wait: true, pollInterval: '1', waitTimeout: '5000' },
      global()
    );
    expect(exitSpy).not.toHaveBeenCalled();
    const dir = 'minimax-h3-text-to-video';
    const mp4 = outputFiles(dir).find((n) => n.endsWith('.mp4'));
    expect(mp4).toBeDefined();
    expect(readFileSync(join(outDir, dir, mp4), 'utf8')).toBe('VIDEOBYTES');
    const meta = readJson(dir);
    expect(meta.usageCostUsdMicros).toBe(500000);
    expect(meta.response.items[0]).toMatchObject({
      objectType: 'video.generation',
      assetId: 'asset1',
      resolution: '720p',
      aspectRatio: '16:9',
      duration: 5,
    });
    expect(out()).toContain('✓ Saved video 1/1');
  });

  it('--wait saves an SVG result with an .svg extension', async () => {
    route({
      api: (method) =>
        method === 'POST'
          ? { generation_id: 'svg1' }
          : {
              generation_id: 'svg1',
              status: 'completed',
              created: 't',
              data: [{ object_type: 'svg.generation', url: `${CDN}/logo.svg`, asset_id: 'a', width: 512, height: 512 }],
            },
      files: { [`${CDN}/logo.svg`]: '<svg/>' },
    });
    await executeAsyncV2('generate-svg', { prompt: 'a logo', wait: true, pollInterval: '1', gradient: true }, global());
    const svg = outputFiles('generate-svg').find((n) => n.endsWith('.svg'));
    expect(readFileSync(join(outDir, 'generate-svg', svg), 'utf8')).toBe('<svg/>');
    expect(out()).toContain('✓ Saved SVG 1/1');
    // commander sets gradient=true by default; only an explicit --no-gradient is sent.
    expect(fetchMock.mock.calls[0][1].body.has('use_gradient')).toBe(false);
  });

  it('sends use_gradient=false for --no-gradient', async () => {
    route({ api: () => ({ generation_id: 'svg2' }) });
    await executeAsyncV2('generate-svg', { prompt: 'a logo', gradient: false }, global());
    expect(fetchMock.mock.calls[0][1].body.getAll('use_gradient')).toEqual(['false']);
  });

  it.each([
    ['a video URL with no extension', 'video.generation', `${CDN}/clip`, 'mp4'],
    ['an SVG URL with no extension', 'svg.generation', `${CDN}/logo`, 'svg'],
    ['an SVG URL with an over-long extension', 'svg.generation', `${CDN}/logo.toolongext`, 'svg'],
    ['a video URL with its own extension', 'video.generation', `${CDN}/clip.webm`, 'webm'],
    ['an SVG URL with an upper-case extension', 'svg.generation', `${CDN}/logo.SVG`, 'svg'],
  ])('names the file by kind when needed: %s', async (_label, objectType, url, ext) => {
    route({
      api: (method) =>
        method === 'POST'
          ? { generation_id: 'ext1' }
          : { generation_id: 'ext1', status: 'completed', created: 't', data: [{ object_type: objectType, url }] },
      files: { [url]: 'BYTES' },
    });
    await executeAsyncV2('generate-svg', { prompt: 'p', wait: true, pollInterval: '1' }, global());
    const saved = outputFiles('generate-svg').filter((n) => !n.endsWith('.json'));
    expect(saved).toHaveLength(1);
    expect(saved[0].endsWith(`.${ext}`)).toBe(true);
  });

  it('--wait exits 1 when the generation fails', async () => {
    route({
      api: (method) =>
        method === 'POST'
          ? { generation_id: 'bad' }
          : { generation_id: 'bad', status: 'failed', created: 't', failure_reason: 'content_policy_violation' },
    });
    await executeAsyncV2('minimax-h3-text-to-video', { prompt: 'a boat', wait: true, pollInterval: '1' }, global());
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(err()).toContain('Generation bad failed: content_policy_violation');
  });
});

describe('executeGetGeneration', () => {
  it('reports a pending generation and how to wait for it', async () => {
    route({ api: () => ({ generation_id: 'g1', status: 'pending', created: '2026-11-22T00:00:00Z' }) });
    await executeGetGeneration('g1', {}, global());
    expect(exitSpy).not.toHaveBeenCalled();
    expect(out()).toContain('Generation g1: pending (created 2026-11-22T00:00:00Z)');
    expect(out()).toContain('Still running. Re-run with --wait');
    expect(existsSync(join(outDir, 'generations'))).toBe(false);
  });

  it('downloads a completed generation under <outputDir>/generations', async () => {
    route({
      api: () => ({
        generation_id: 'g2',
        status: 'completed',
        created: 't',
        usage_cost_usd_micros: 40000,
        data: [{ url: `${CDN}/g2.png`, is_image_safe: true, resolution: '1024x1024', seed: 9 }],
      }),
      files: { [`${CDN}/g2.png`]: PNG },
    });
    await executeGetGeneration('g2', {}, global());
    expect(out()).toContain('Usage cost: $0.0400');
    expect(outputFiles('generations').some((n) => n.endsWith('.png'))).toBe(true);
    const meta = readJson('generations');
    expect(meta.generationId).toBe('g2');
    expect(meta.parameters).toEqual({ generationId: 'g2' });
    expect(out()).not.toContain('Still running');
  });

  it('prints a failed generation reason and saves nothing', async () => {
    route({
      api: () => ({ generation_id: 'g3', status: 'failed', created: 't', failure_reason: 'content_policy_violation' }),
    });
    await executeGetGeneration('g3', {}, global());
    expect(out()).toContain('Failure reason: content_policy_violation');
    expect(existsSync(join(outDir, 'generations'))).toBe(false);
  });

  it('--wait polls until completed', async () => {
    route({
      api: (m, p, n) =>
        n < 3
          ? { generation_id: 'g4', status: 'pending', created: 't' }
          : { generation_id: 'g4', status: 'completed', created: 't', data: [] },
    });
    await executeGetGeneration('g4', { wait: true, pollInterval: '1' }, global());
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(out()).toContain('Generation g4: completed');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(err()).toContain('returned no results');
  });

  it('exits 1 on a bad --poll-interval', async () => {
    await executeGetGeneration('g5', { pollInterval: 'fast' }, global());
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(err()).toContain('--poll-interval must be an integer');
  });
});

describe('parseIntOption', () => {
  it('passes undefined through', () => {
    expect(parseIntOption('--n', undefined)).toBeUndefined();
  });
  it('parses integers, including negative and padded ones', () => {
    expect(parseIntOption('--n', '42')).toBe(42);
    expect(parseIntOption('--n', '-7')).toBe(-7);
    expect(parseIntOption('--n', ' 5 ')).toBe(5);
    expect(parseIntOption('--n', '0')).toBe(0);
  });
  it.each(['1.5', 'abc', '', '1e3', '0x10', '--5'])('rejects %j, naming the flag and echoing the value', (v) => {
    expect(() => parseIntOption('--seed', v)).toThrow(`--seed must be an integer (got '${v}')`);
  });
});

describe('parseColorPalette', () => {
  it('passes undefined through and returns a preset name unchanged', () => {
    expect(parseColorPalette(undefined)).toBeUndefined();
    expect(parseColorPalette('ember')).toBe('ember');
  });
  it('does not validate a bare preset name (the command validation does)', () => {
    expect(parseColorPalette('not-a-preset')).toBe('not-a-preset');
  });
  it('parses a JSON { name } and { members } object', () => {
    expect(parseColorPalette('{"name":"jungle"}')).toEqual({ name: 'jungle' });
    expect(parseColorPalette('  {"members":[{"color_hex":"#fff","color_weight":0.5}]}')).toEqual({
      members: [{ color_hex: '#fff', color_weight: 0.5 }],
    });
  });
  it('rejects malformed JSON', () => {
    expect(() => parseColorPalette('{nope')).toThrow('--color-palette is not valid JSON');
  });
  it('rejects an object that fails palette validation', () => {
    expect(() => parseColorPalette('{"name":"ember","members":[]}')).toThrow('exactly one of name or members');
    expect(() => parseColorPalette('{"members":[{"color_hex":"red"}]}')).toThrow("Invalid color_hex 'red'");
  });
});

describe('parseAssets', () => {
  it('returns undefined for undefined and empty input', () => {
    expect(parseAssets(undefined)).toBeUndefined();
    expect(parseAssets([])).toBeUndefined();
  });
  it('parses TYPE:ID and TYPE:ID:COLLECTION', () => {
    expect(parseAssets(['image:a1', 'image:a2:coll'])).toEqual([
      { asset_type: 'image', asset_id: 'a1' },
      { asset_type: 'image', asset_id: 'a2', collection_id: 'coll' },
    ]);
  });
  it('omits an empty collection segment', () => {
    expect(parseAssets(['image:a1:'])).toEqual([{ asset_type: 'image', asset_id: 'a1' }]);
  });
  it.each(['solo', ':id', 'type:', 'a:b:c:d', ''])('rejects %j', (spec) => {
    expect(() => parseAssets([spec])).toThrow(`--asset '${spec}' must be TYPE:ID or TYPE:ID:COLLECTION`);
  });
});

describe('getGenerationCommand', () => {
  it('puts a normal id before --wait', () => {
    expect(getGenerationCommand('abc123')).toBe('ideogram get-generation abc123 --wait');
  });
  it("puts an id that starts with '-' after --", () => {
    expect(getGenerationCommand('-abc')).toBe('ideogram get-generation --wait -- -abc');
  });
  it("treats only a LEADING '-' specially", () => {
    expect(getGenerationCommand('a-b')).toBe('ideogram get-generation a-b --wait');
  });
});

describe('describeError', () => {
  it('returns the message alone when there is no code', () => {
    expect(describeError(new Error('boom'))).toBe('boom');
  });
  it('appends the code when the message lacks it', () => {
    expect(describeError(Object.assign(new Error('Error'), { code: 'ECONNRESET' }))).toBe('Error [ECONNRESET]');
  });
  it('does not repeat a code the message already contains', () => {
    expect(describeError(Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }))).toBe('read ECONNRESET');
  });
  it('falls back to "Unknown error" for an empty message', () => {
    expect(describeError(new Error(''))).toBe('Unknown error');
    expect(describeError(Object.assign(new Error(''), { code: 'EPIPE' }))).toBe('Unknown error [EPIPE]');
  });
});

describe('the spawned CLI (src/cli.ts)', () => {
  const root = resolve(import.meta.dirname, '..');
  const tsx = join(root, 'node_modules', '.bin', 'tsx');
  const cli = join(root, 'src', 'cli.ts');
  // An empty cwd and HOME, and no key in the environment, so no .env or
  // ~/.ideogram/.env can supply one and nothing can reach the network.
  const sandbox = mkdtempSync(join(tmpdir(), 'ideogram-spawn-'));
  const run = (...args) => {
    const env = { ...process.env, HOME: sandbox };
    delete env.IDEOGRAM_API_KEY;
    const r = spawnSync(tsx, [cli, ...args], { cwd: sandbox, env, encoding: 'utf8', timeout: 60000 });
    return { status: r.status, stdout: r.stdout, stderr: r.stderr };
  };

  it('--help exits 0 and lists commands', () => {
    const r = run('--help');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('Usage: ideogram');
    expect(r.stdout).toContain('get-generation');
  });

  it('an unknown option exits non-zero', () => {
    const r = run('--bogus');
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("unknown option '--bogus'");
  });

  it("parses `get-generation -- -abc` as an id: it reaches the key check, not 'unknown option'", () => {
    const r = run('get-generation', '--', '-abc');
    expect(r.status).toBe(1);
    expect(r.stderr).not.toContain('unknown option');
    expect(r.stderr).toContain('IDEOGRAM_API_KEY not found');
  });

  it('get-generation requires an id', () => {
    const r = run('get-generation');
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("missing required argument 'generationId'");
  });

  it("control: without `--`, `get-generation -abc` IS read as an option", () => {
    const r = run('get-generation', '-abc');
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("unknown option '-abc'");
  });
});
