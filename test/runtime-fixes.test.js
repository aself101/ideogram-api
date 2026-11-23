/**
 * Runtime fixes from ship-pipeline run #5 (tracker project ideogram-api).
 *
 * Each block pins one fix and was shown failing against the 3bc3b74 sources:
 * streamToFile cleanup visibility, collision-free output names, IdeogramAPIError
 * on every response-read failure, polling floors, strict v1 integer options,
 * error causes, metadata written before downloads, and the 2.0 utils surface.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

vi.mock('dns/promises', () => ({
  lookup: vi.fn(async () => ({ address: '8.8.8.8', family: 4 })),
}));

// Lets one test make unlink fail; every other call goes to the real unlink.
const unlinkControl = vi.hoisted(() => ({ fail: null }));
vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal();
  const unlink = async (...args) => {
    if (unlinkControl.fail) throw unlinkControl.fail;
    return actual.unlink(...args);
  };
  return { ...actual, unlink, default: { ...actual.default } };
});

import { lookup } from 'dns/promises';
import { fetchMock, ok, fakeResponse, resetHttp } from './helpers/http.js';
import { IdeogramAPI, IdeogramAPIError } from '../src/api.js';
import { streamToFile } from '../src/http.js';
import * as utils from '../src/utils.js';
import { validateImagePath, loadAudioAsBuffer, getImageDimensions, validateImageUrl } from '../src/utils.js';
import { generateFilename, claimPath } from '../src/cli-io.js';
import { logger } from '../src/logger.js';
import { executeGetGeneration, parseColorPalette } from '../src/cli-v2.js';
import { createProgram } from '../src/program.js';

const KEY = 'test-key-1234567890';
const CDN = 'https://cdn.ideogram.ai';
const PNG_A = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 1, 1, 1]);
const PNG_B = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 2, 2, 2, 2]);
const LONG = 'a very long prompt about a lighthouse standing alone on a cliff at dusk in a storm';

class ExitSignal extends Error {
  constructor(code) {
    super(`process.exit(${code})`);
    this.code = code;
  }
}

let work;
let logs;
let errors;
let spies = [];

beforeEach(() => {
  resetHttp();
  unlinkControl.fail = null;
  work = mkdtempSync(join(tmpdir(), 'ideogram-rtfix-'));
  logs = [];
  errors = [];
  spies = [
    vi.spyOn(console, 'log').mockImplementation((...a) => void logs.push(a.join(' '))),
    vi.spyOn(console, 'error').mockImplementation((...a) => void errors.push(a.join(' '))),
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true),
    vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new ExitSignal(code);
    }),
  ];
});

afterEach(() => {
  spies.forEach((s) => s.mockRestore());
  unlinkControl.fail = null;
  rmSync(work, { recursive: true, force: true });
});

const global = () => ({ apiKey: KEY, outputDir: work, logLevel: 'error' });

/** An API answer for the generation endpoint; downloads come from `files`. */
function route(api, files = {}) {
  fetchMock.mockImplementation(async (url) => {
    const u = new URL(url);
    if (u.host === 'api.ideogram.ai') return fakeResponse(200, api(u.pathname));
    if (!(url in files)) throw new Error(`unexpected download: ${url}`);
    const f = files[url];
    if (f instanceof Error) throw f;
    return new Response(f);
  });
}

describe('streamToFile cleanup', () => {
  const failingBody = () =>
    new Response(
      new ReadableStream({
        start(c) {
          c.enqueue(new Uint8Array(10));
          c.error(new Error('stream broke'));
        },
      })
    );

  it('rethrows the original error and names the partial file when unlink fails', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => logger);
    unlinkControl.fail = Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
    const out = join(work, 'partial.bin');
    const err = await streamToFile(failingBody(), out, 1000).catch((e) => e);
    expect(err.message).toBe('stream broke');
    expect(err.partialFile).toBe(out);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain(out);
    warn.mockRestore();
  });

  it('stays quiet when the file is already gone (ENOENT)', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => logger);
    unlinkControl.fail = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    const err = await streamToFile(failingBody(), join(work, 'gone.bin'), 1000).catch((e) => e);
    expect(err.message).toBe('stream broke');
    expect(err.partialFile).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('removes the partial file on an ordinary failure', async () => {
    const out = join(work, 'removed.bin');
    await expect(streamToFile(failingBody(), out, 1000)).rejects.toThrow('stream broke');
    expect(existsSync(out)).toBe(false);
  });
});

describe('output names never collide', () => {
  it('generateFilename keeps the index when the prompt is long', () => {
    const a = generateFilename(LONG + LONG, 'png', 50, 1);
    const b = generateFilename(LONG + LONG, 'png', 50, 2);
    expect(a).not.toBe(b);
    expect(a).toMatch(/-1\.png$/);
    expect(b).toMatch(/-2\.png$/);
  });

  it('claimPath never returns a path that already exists', async () => {
    const target = join(work, 'sub', 'img.png');
    const first = await claimPath(target);
    writeFileSync(first, 'first');
    const second = await claimPath(target);
    expect(first).toBe(target);
    expect(second).not.toBe(first);
    expect(readFileSync(first, 'utf8')).toBe('first');
  });

  it('v2 results with a 75+ character name are saved as separate files', async () => {
    const id = 'g'.repeat(80);
    route(
      () => ({
        generation_id: id,
        status: 'completed',
        created: '2026-11-22T00:00:00Z',
        data: [
          { object_type: 'image.generation', url: `${CDN}/1.png`, is_image_safe: true },
          { object_type: 'image.generation', url: `${CDN}/2.png`, is_image_safe: true },
        ],
      }),
      { [`${CDN}/1.png`]: PNG_A, [`${CDN}/2.png`]: PNG_B }
    );
    await executeGetGeneration(id, {}, global());
    const dir = join(work, 'generations');
    const pngs = readdirSync(dir).filter((n) => n.endsWith('.png'));
    expect(pngs).toHaveLength(2);
    expect(pngs.map((n) => readFileSync(join(dir, n))).sort()).toEqual([PNG_A, PNG_B].sort());
  });

  it('v1 results with a long prompt are saved as separate files', async () => {
    route(
      () => ({
        created: '2026-11-22T00:00:00Z',
        data: [
          { url: `${CDN}/1.png`, is_image_safe: true },
          { url: `${CDN}/2.png`, is_image_safe: true },
        ],
      }),
      { [`${CDN}/1.png`]: PNG_A, [`${CDN}/2.png`]: PNG_B }
    );
    const program = createProgram();
    program.exitOverride();
    await program.parseAsync(['node', 'ideogram', '--api-key', KEY, '-o', work, '--log-level', 'error', 'generate', '-p', LONG, '-n', '2']);
    const dir = join(work, 'generate-v3');
    expect(readdirSync(dir).filter((n) => n.endsWith('.png'))).toHaveLength(2);
  });
});

describe('_request failures after the headers arrive', () => {
  let api;
  let errorLog;
  beforeEach(() => {
    api = new IdeogramAPI(KEY, undefined, 'error');
    errorLog = vi.spyOn(api.logger, 'error').mockImplementation(() => api.logger);
  });

  it('a 2xx body that is not valid JSON is an IdeogramAPIError with status and excerpt', async () => {
    fetchMock.mockReturnValue(Promise.resolve(fakeResponse(200, '{"data": [', 'application/json')));
    const err = await api.generateV4({ prompt: 'x' }).catch((e) => e);
    expect(err).toBeInstanceOf(IdeogramAPIError);
    expect(err.status).toBe(200);
    expect(err.message).toContain('Invalid response format from API');
    expect(err.body).toBe('{"data": [');
    expect(err.cause).toBeInstanceOf(SyntaxError);
    expect(errorLog.mock.calls.map((c) => c[0]).join('\n')).toContain('may still have run and been billed');
  });

  it('a timeout while reading the body is an IdeogramAPIError with ETIMEDOUT and the status', async () => {
    const body = new ReadableStream({
      start(c) {
        c.error(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
      },
    });
    fetchMock.mockReturnValue(
      Promise.resolve({ ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }), body })
    );
    const err = await api.generateV4({ prompt: 'x', timeoutMs: 5 }).catch((e) => e);
    expect(err).toBeInstanceOf(IdeogramAPIError);
    expect(err.code).toBe('ETIMEDOUT');
    expect(err.status).toBe(200);
    expect(errorLog.mock.calls.map((c) => c[0]).join('\n')).toContain('may still have run and been billed');
  });

  it('a network failure while reading the body is an IdeogramAPIError', async () => {
    const body = new ReadableStream({
      start(c) {
        c.error(Object.assign(new TypeError('terminated'), { cause: Object.assign(new Error('reset'), { code: 'ECONNRESET' }) }));
      },
    });
    fetchMock.mockReturnValue(
      Promise.resolve({ ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }), body })
    );
    const err = await api.generateV4({ prompt: 'x' }).catch((e) => e);
    expect(err).toBeInstanceOf(IdeogramAPIError);
    expect(err.code).toBe('ECONNRESET');
  });

  it('a non-JSON Content-Type is an IdeogramAPIError (not a plain Error) and keeps its message prefix', async () => {
    fetchMock.mockReturnValue(Promise.resolve(fakeResponse(200, '<html>oops</html>', 'text/html')));
    const err = await api.generateV4({ prompt: 'x' }).catch((e) => e);
    expect(err).toBeInstanceOf(IdeogramAPIError);
    expect(err.status).toBe(200);
    expect(err.message).toContain('Invalid response format from API');
    expect(err.body).toBe('<html>oops</html>');
  });
});

describe('waitForGeneration polling floors', () => {
  const api = () => new IdeogramAPI(KEY, undefined, 'error');

  it('rejects intervalMs and timeoutMs below 1 without polling', async () => {
    await expect(api().waitForGeneration('g', { intervalMs: 0 })).rejects.toThrow('intervalMs');
    await expect(api().waitForGeneration('g', { intervalMs: -5 })).rejects.toThrow('intervalMs');
    await expect(api().waitForGeneration('g', { timeoutMs: 0 })).rejects.toThrow('timeoutMs');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never backs off for less than 1s on a 429', async () => {
    let calls = 0;
    fetchMock.mockImplementation(async () => {
      calls++;
      return calls === 1
        ? fakeResponse(429, { reject_reason: 'rate' })
        : fakeResponse(200, { generation_id: 'g', status: 'completed', data: [] });
    });
    const delays = [];
    const spy = vi.spyOn(globalThis, 'setTimeout').mockImplementation((fn, ms) => {
      delays.push(ms);
      fn();
      return 0;
    });
    try {
      await api().waitForGeneration('g', { intervalMs: 1 });
    } finally {
      spy.mockRestore();
    }
    expect(delays.length).toBeGreaterThan(0);
    expect(Math.min(...delays)).toBeGreaterThanOrEqual(1000);
  });

  it('the CLI rejects --poll-interval and --wait-timeout below 1', async () => {
    fetchMock.mockImplementation(async () => fakeResponse(200, { generation_id: 'g', status: 'completed', created: 'x', data: [] }));
    const a = await executeGetGeneration('g', { wait: true, pollInterval: '0' }, global()).catch((e) => e);
    expect(a).toBeInstanceOf(ExitSignal);
    expect(errors.join('\n')).toContain('--poll-interval must be at least 1');
    const b = await executeGetGeneration('g', { wait: true, waitTimeout: '0' }, global()).catch((e) => e);
    expect(b).toBeInstanceOf(ExitSignal);
    expect(errors.join('\n')).toContain('--wait-timeout must be at least 1');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('v1 commands parse integers strictly', () => {
  async function run(...args) {
    const program = createProgram();
    program.exitOverride();
    try {
      await program.parseAsync(['node', 'ideogram', '--api-key', KEY, '-o', work, '--log-level', 'error', ...args]);
      return {};
    } catch (e) {
      if (e instanceof ExitSignal) return { exit: e.code };
      throw e;
    }
  }

  it('--seed abc exits 1 and sends nothing', async () => {
    const res = await run('generate', '-p', 'x', '--seed', 'abc');
    expect(res.exit).toBe(1);
    expect(errors.join('\n')).toContain("--seed must be an integer (got 'abc')");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('--num-images 1.5 exits 1 instead of truncating to 1', async () => {
    const res = await run('generate', '-p', 'x', '-n', '1.5');
    expect(res.exit).toBe(1);
    expect(errors.join('\n')).toContain('--num-images must be an integer');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('wrapped errors keep their cause', () => {
  it('validateImagePath', async () => {
    const err = await validateImagePath(join(work, 'missing.png')).catch((e) => e);
    expect(err.message).toContain('Image file not found');
    expect(err.cause?.code).toBe('ENOENT');
  });

  it('loadAudioAsBuffer', async () => {
    const err = await loadAudioAsBuffer(join(work, 'missing.mp3')).catch((e) => e);
    expect(err.message).toContain('Audio file not found');
    expect(err.cause?.code).toBe('ENOENT');
  });

  it('getImageDimensions', async () => {
    const err = await getImageDimensions(Buffer.from('not an image')).catch((e) => e);
    expect(err.message).toContain('Unable to read image dimensions');
    expect(err.cause).toBeInstanceOf(Error);
  });

  it('validateImageUrl (DNS failure)', async () => {
    lookup.mockRejectedValueOnce(Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }));
    const err = await validateImageUrl('https://nowhere.example.com/x.png').catch((e) => e);
    expect(err.message).toContain('could not be resolved');
    expect(err.cause?.code).toBe('ENOTFOUND');
  });

  it('parseColorPalette', () => {
    let err;
    try {
      parseColorPalette('{bad');
    } catch (e) {
      err = e;
    }
    expect(err.message).toContain('--color-palette is not valid JSON');
    expect(err.cause).toBeInstanceOf(SyntaxError);
  });
});

describe('v2 metadata is written before downloads', () => {
  it('a failed download leaves the generation id and every URL on disk', async () => {
    const id = 'gen-meta-1';
    route(
      () => ({
        generation_id: id,
        status: 'completed',
        created: '2026-11-22T00:00:00Z',
        data: [
          { object_type: 'image.generation', url: `${CDN}/1.png`, is_image_safe: true },
          { object_type: 'image.generation', url: `${CDN}/2.png`, is_image_safe: true },
        ],
      }),
      { [`${CDN}/1.png`]: PNG_A, [`${CDN}/2.png`]: new Error('network down') }
    );
    const res = await executeGetGeneration(id, {}, global()).catch((e) => e);
    expect(res).toBeInstanceOf(ExitSignal); // the command reports and exits 1

    const dir = join(work, 'generations');
    const json = readdirSync(dir).find((n) => n.endsWith('.json'));
    expect(json).toBeDefined();
    const meta = JSON.parse(readFileSync(join(dir, json), 'utf8'));
    expect(meta.generationId).toBe(id);
    expect(meta.response.items.map((i) => i.url)).toEqual([`${CDN}/1.png`, `${CDN}/2.png`]);
    expect(errors.join('\n')).toContain(id);
    expect(errors.join('\n')).toContain(join(dir, json));
  });

  it('after success the metadata carries the saved paths', async () => {
    route(
      () => ({
        generation_id: 'gen-meta-2',
        status: 'completed',
        created: 'x',
        data: [{ object_type: 'image.generation', url: `${CDN}/1.png`, is_image_safe: true }],
      }),
      { [`${CDN}/1.png`]: PNG_A }
    );
    await executeGetGeneration('gen-meta-2', {}, global());
    const dir = join(work, 'generations');
    const meta = JSON.parse(readFileSync(join(dir, readdirSync(dir).find((n) => n.endsWith('.json'))), 'utf8'));
    expect(meta.response.items[0].path).toMatch(/\.png$/);
  });
});

describe('the public utils surface (2.0)', () => {
  it('no longer exports the CLI helpers or the logger', () => {
    for (const name of ['saveImage', 'generateFilename', 'ensureDirectory', 'saveMetadata', 'pause', 'createSpinner', 'logger']) {
      expect(Object.keys(utils)).not.toContain(name);
    }
    expect(Object.keys(utils)).toContain('setLogLevel');
  });

  it('cli-io is not listed in package.json exports', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    expect(JSON.stringify(pkg.exports)).not.toContain('cli-io');
  });
});
