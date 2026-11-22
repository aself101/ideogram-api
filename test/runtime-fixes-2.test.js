/**
 * Runtime fixes from ship-pipeline run #7 (tracker project ideogram-api).
 *
 * Each block pins one fix and was shown failing against the 357cba9 sources
 * (the run-#5 fix commit, which re-introduced a silent cleanup swallow in
 * discardClaimed): swallowed cleanup failures, ResponseTooLargeError mapping,
 * v1 metadata-first, the honest version fallback, the 429 backoff, timer
 * range checks, actionable "is required" errors and small diagnostics.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

vi.mock('dns/promises', () => ({
  lookup: vi.fn(async () => ({ address: '8.8.8.8', family: 4 })),
}));

// unlink and writeFile can be made to fail; every other call goes to the real one.
const fsControl = vi.hoisted(() => ({ unlinkFail: null, writeFail: null }));
vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal();
  const unlink = async (...args) => {
    if (fsControl.unlinkFail) throw fsControl.unlinkFail;
    return actual.unlink(...args);
  };
  const writeFile = async (file, ...rest) => {
    if (fsControl.writeFail && String(file).endsWith('.png')) throw fsControl.writeFail;
    return actual.writeFile(file, ...rest);
  };
  return { ...actual, unlink, default: { ...actual.default, writeFile } };
});

// getVersion reads package.json through the named readFileSync from 'fs'.
const pkgControl = vi.hoisted(() => ({ mode: 'real' }));
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal();
  const readFileSync = (file, ...rest) => {
    if (String(file).endsWith('package.json') && pkgControl.mode === 'missing') {
      throw Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' });
    }
    if (String(file).endsWith('package.json') && pkgControl.mode === 'no-version') return '{"name":"x","version":5}';
    return actual.readFileSync(file, ...rest);
  };
  return { ...actual, readFileSync, default: { ...actual.default, readFileSync } };
});

import { fetchMock, ok, httpError, fakeResponse, resetHttp, timeoutSpy } from './helpers/http.js';
import { IdeogramAPI, IdeogramAPIError } from '../src/api.js';
import { streamToFile, readBodyWithLimit, ResponseTooLargeError } from '../src/http.js';
import { validateImageUrl } from '../src/utils.js';
import { validateV2Params } from '../src/config.js';
import { logger } from '../src/logger.js';
import { executeGetGeneration, parseIntOption, describeError } from '../src/cli-v2.js';
import { createProgram } from '../src/program.js';

const KEY = 'test-key-1234567890';
const CDN = 'https://cdn.ideogram.ai';
const PNG_A = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 1, 1, 1]);
const MB = 1024 * 1024;
const MAX_TIMER = 2147483647;

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
  fsControl.unlinkFail = null;
  fsControl.writeFail = null;
  pkgControl.mode = 'real';
  work = mkdtempSync(join(tmpdir(), 'ideogram-rtfix2-'));
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
  fsControl.unlinkFail = null;
  fsControl.writeFail = null;
  pkgControl.mode = 'real';
  rmSync(work, { recursive: true, force: true });
});

const global = () => ({ apiKey: KEY, outputDir: work, logLevel: 'error' });
const newApi = () => new IdeogramAPI(KEY, undefined, 'error');

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

const eacces = () => Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
const eio = () => Object.assign(new Error('EIO: i/o error'), { code: 'EIO' });

async function runCli(...args) {
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

describe('item 1: a failed cleanup is never swallowed', () => {
  const v2Items = () => ({
    generation_id: 'gen-cleanup',
    status: 'completed',
    created: 'x',
    data: [{ object_type: 'image.generation', url: `${CDN}/1.png`, is_image_safe: true }],
  });

  it('v2: a failed image write rethrows the write error and warns, naming the leftover file, when unlink fails', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => logger);
    route(v2Items, { [`${CDN}/1.png`]: PNG_A });
    fsControl.writeFail = eio();
    fsControl.unlinkFail = eacces();
    const res = await executeGetGeneration('gen-cleanup', {}, global()).catch((e) => e);
    expect(res).toBeInstanceOf(ExitSignal);
    expect(errors.join('\n')).toContain('EIO');
    const dir = join(work, 'generations');
    const leftover = readdirSync(dir).filter((n) => n.endsWith('.png'));
    expect(leftover).toHaveLength(1); // the placeholder is still there...
    const messages = warn.mock.calls.map((c) => String(c[0]));
    expect(messages.some((m) => m.includes(join(dir, leftover[0])) && m.includes('EACCES'))).toBe(true); // ...and it was said
    warn.mockRestore();
  });

  it('v2: a failed write removes the placeholder and stays quiet when unlink works', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => logger);
    route(v2Items, { [`${CDN}/1.png`]: PNG_A });
    fsControl.writeFail = eio();
    await executeGetGeneration('gen-cleanup', {}, global()).catch((e) => e);
    expect(readdirSync(join(work, 'generations')).filter((n) => n.endsWith('.png'))).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('v2: an unlink that finds the file already gone (ENOENT) is not a warning', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => logger);
    route(v2Items, { [`${CDN}/1.png`]: PNG_A });
    fsControl.writeFail = eio();
    fsControl.unlinkFail = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    await executeGetGeneration('gen-cleanup', {}, global()).catch((e) => e);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  const v1Answer = () => ({ created: '2026-11-22T00:00:00Z', data: [{ url: `${CDN}/1.png`, is_image_safe: true }] });

  it('v1: a failed image write removes the claimed placeholder and the command fails', async () => {
    route(v1Answer, { [`${CDN}/1.png`]: PNG_A });
    fsControl.writeFail = eio();
    const res = await runCli('generate', '-p', 'lighthouse');
    expect(res.exit).toBe(1);
    expect(errors.join('\n')).toContain('EIO');
    expect(readdirSync(join(work, 'generate-v3')).filter((n) => n.endsWith('.png'))).toEqual([]);
  });

  it('v1: when the placeholder cannot be removed either, a warning names it', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => logger);
    route(v1Answer, { [`${CDN}/1.png`]: PNG_A });
    fsControl.writeFail = eio();
    fsControl.unlinkFail = eacces();
    const res = await runCli('generate', '-p', 'lighthouse');
    expect(res.exit).toBe(1);
    const dir = join(work, 'generate-v3');
    const leftover = readdirSync(dir).filter((n) => n.endsWith('.png'));
    expect(leftover).toHaveLength(1);
    expect(warn.mock.calls.some((c) => String(c[0]).includes(join(dir, leftover[0])))).toBe(true);
    warn.mockRestore();
  });

  it('no swallow in src/ is silent: every `.catch(() => ...)` and empty catch is marked "best effort" and none guards I/O it should report', () => {
    const srcDir = new URL('../src/', import.meta.url);
    const offenders = [];
    for (const name of readdirSync(srcDir, { recursive: true })) {
      if (!String(name).endsWith('.ts')) continue;
      const lines = readFileSync(new URL(name, srcDir), 'utf8').split('\n');
      lines.forEach((line, i) => {
        const prev = lines[i - 1] ?? '';
        if (/\.catch\(\s*\(\)\s*=>/.test(line)) {
          const marked = /best effort/.test(prev) || /best effort/.test(line);
          const guardsIo = /unlink|writeFile|rm\(|rename|mkdir/.test(line);
          if (!marked || guardsIo) offenders.push(`${name}:${i + 1}: ${line.trim()}`);
        }
        // catch { <only comments> }: the first body line must say "best effort"
        if (/\bcatch\s*(\([^)]*\))?\s*\{\s*$/.test(line)) {
          let j = i + 1;
          const body = [];
          while (j < lines.length && !/^\s*\}/.test(lines[j])) body.push(lines[j++]);
          const code = body.filter((l) => l.trim() && !l.trim().startsWith('//'));
          if (code.length === 0 && !body.some((l) => /best effort/.test(l))) {
            offenders.push(`${name}:${i + 1}: empty catch`);
          }
        }
        if (/\bcatch\s*(\([^)]*\))?\s*\{\s*\}/.test(line)) offenders.push(`${name}:${i + 1}: empty catch`);
      });
    }
    expect(offenders).toEqual([]);
  });
});

describe('item 2: a response over the 100MB cap is an IdeogramAPIError', () => {
  it('carries the status, ERESPONSETOOLARGE and the cause, and the billing warning is logged', async () => {
    const api = newApi();
    const logged = vi.spyOn(api.logger, 'error').mockImplementation(() => api.logger);
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json', 'content-length': String(101 * MB) }),
      body: null,
    });
    const err = await api.generateV4({ prompt: 'x' }).catch((e) => e);
    expect(err).toBeInstanceOf(IdeogramAPIError);
    expect(err.status).toBe(200);
    expect(err.code).toBe('ERESPONSETOOLARGE');
    expect(err.cause).toBeInstanceOf(ResponseTooLargeError);
    expect(err.message).toContain('100MB limit');
    expect(err.message).toContain('HTTP 200');
    expect(logged.mock.calls.some((c) => String(c[0]).includes('may still have run and been billed'))).toBe(true);
  });
});

describe('item 3: v1 metadata is written before the downloads', () => {
  const answer = () => ({
    created: '2026-11-22T00:00:00Z',
    data: [
      { url: `${CDN}/1.png`, is_image_safe: true, seed: 1 },
      { url: `${CDN}/2.png`, is_image_safe: true, seed: 2 },
    ],
  });
  const metaOf = () => {
    const dir = join(work, 'generate-v3');
    const json = readdirSync(dir).find((n) => n.endsWith('.json'));
    return { dir, json, meta: json ? JSON.parse(readFileSync(join(dir, json), 'utf8')) : undefined };
  };

  it('a failed download leaves the prompt, parameters and every URL on disk and prints the metadata path', async () => {
    route(answer, { [`${CDN}/1.png`]: PNG_A, [`${CDN}/2.png`]: new Error('network down') });
    const res = await runCli('generate', '-p', 'lighthouse', '-n', '2');
    expect(res.exit).toBe(1);
    const { dir, json, meta } = metaOf();
    expect(json).toBeDefined();
    expect(meta.parameters.prompt).toEqual(['lighthouse']);
    expect(meta.response.images.map((i) => i.url)).toEqual([`${CDN}/1.png`, `${CDN}/2.png`]);
    const printed = errors.join('\n');
    expect(printed).toContain(join(dir, json));
    expect(printed).toContain('network down');
  });

  it('after success the metadata is rewritten with the saved paths', async () => {
    route(answer, { [`${CDN}/1.png`]: PNG_A, [`${CDN}/2.png`]: PNG_A });
    await runCli('generate', '-p', 'lighthouse', '-n', '2');
    const { dir, meta } = metaOf();
    const pngs = readdirSync(dir).filter((n) => n.endsWith('.png'));
    expect(pngs).toHaveLength(2);
    expect(meta.response.images.map((i) => i.path).sort()).toEqual(pngs.map((n) => join(dir, n)).sort());
    expect(readdirSync(dir).filter((n) => n.endsWith('.json'))).toHaveLength(1);
  });
});

describe('item 4: the version is never made up', () => {
  const pkgVersion = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

  it('reads the real version from package.json', () => {
    expect(createProgram().version()).toBe(pkgVersion);
  });

  it('reports "unknown" (not 1.0.0) when package.json cannot be read, and logs the paths tried at debug', () => {
    const debug = vi.spyOn(logger, 'debug').mockImplementation(() => logger);
    pkgControl.mode = 'missing';
    expect(createProgram().version()).toBe('unknown');
    const msg = debug.mock.calls.map((c) => String(c[0])).find((m) => m.includes('package version'));
    expect(msg).toContain('package.json');
    expect(msg).toContain('ENOENT');
    debug.mockRestore();
  });

  it('reports "unknown" when package.json has no string version', () => {
    pkgControl.mode = 'no-version';
    expect(createProgram().version()).toBe('unknown');
  });
});

describe('item 5: waitForGeneration 429 backoff', () => {
  let clock;
  let sleeps;
  let dateSpy;
  let timerSpy;

  beforeEach(() => {
    clock = 9_000_000;
    sleeps = [];
    dateSpy = vi.spyOn(Date, 'now').mockImplementation(() => clock);
    // Sleeping advances the mocked clock by exactly the requested time and fires at once.
    timerSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation((fn, ms) => {
      sleeps.push(ms);
      clock += ms;
      fn();
      return 0;
    });
  });
  afterEach(() => {
    dateSpy.mockRestore();
    timerSpy.mockRestore();
  });

  const done = { generation_id: 'g', status: 'completed', created: 't', data: [] };
  const pending = { generation_id: 'g', status: 'pending', created: 't' };
  /** Answers with the listed statuses in order: 429 or an object body. */
  function script(...steps) {
    let n = 0;
    fetchMock.mockImplementation(async () => {
      const step = steps[Math.min(n++, steps.length - 1)];
      return step === 429 ? fakeResponse(429, {}) : fakeResponse(200, step);
    });
  }

  it('doubles on each 429 and stops at 30s', async () => {
    script(429, 429, 429, 429, 429, done);
    await newApi().waitForGeneration('g', { intervalMs: 2000 });
    expect(sleeps).toEqual([4000, 8000, 16000, 30000, 30000]);
  });

  it('never backs off for less than 1s, and a good poll resets to the base interval', async () => {
    script(429, pending, done);
    await newApi().waitForGeneration('g', { intervalMs: 1 });
    expect(sleeps).toEqual([1000, 1]);
  });

  it('does not shorten the wait when the interval is above 30s (60s stays 60s)', async () => {
    script(429, 429, done);
    await newApi().waitForGeneration('g', { intervalMs: 60000, timeoutMs: 1_000_000 });
    expect(sleeps).toEqual([60000, 60000]);
  });

  it('caps growth at 30s for an interval between 15s and 30s, and never goes below the interval', async () => {
    script(429, 429, done);
    await newApi().waitForGeneration('g', { intervalMs: 20000 });
    expect(sleeps).toEqual([30000, 30000]);
  });
});

describe('item 6: timeouts and intervals are finite integers in 1..2147483647', () => {
  const bad = [0, -1, 1.5, NaN, Infinity, MAX_TIMER + 1, '5'];

  it.each(bad)('a request with timeoutMs %s is refused before anything is sent', async (value) => {
    const err = await newApi().generateV4({ prompt: 'x', timeoutMs: value }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain('timeoutMs must be an integer between 1 and 2147483647');
    expect(err.message).not.toContain('billed');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('the largest legal timeout is sent as given', async () => {
    fetchMock.mockReturnValue(ok({ created: 'x', data: [] }));
    await newApi().generateV4({ prompt: 'x', timeoutMs: MAX_TIMER });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(timeoutSpy).toHaveBeenLastCalledWith(MAX_TIMER);
  });

  it.each([
    ['intervalMs', { intervalMs: MAX_TIMER + 1 }],
    ['intervalMs', { intervalMs: 1.5 }],
    ['timeoutMs', { timeoutMs: MAX_TIMER + 1 }],
    ['timeoutMs', { timeoutMs: 2.5 }],
  ])('waitForGeneration refuses %s %j without polling', async (name, options) => {
    const err = await newApi().waitForGeneration('g', options).catch((e) => e);
    expect(err.message).toContain(`${name} must be an integer between 1 and 2147483647`);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('parseIntOption enforces a max', () => {
    expect(parseIntOption('--timeout', String(MAX_TIMER), 1, MAX_TIMER)).toBe(MAX_TIMER);
    expect(() => parseIntOption('--timeout', String(MAX_TIMER + 1), 1, MAX_TIMER)).toThrow(
      `--timeout must be at most ${MAX_TIMER}`
    );
  });

  it('the CLI rejects --timeout, --poll-interval and --wait-timeout out of range and sends nothing', async () => {
    const t = await runCli('generate-v4', '-p', 'x', '--timeout', String(MAX_TIMER + 1));
    expect(t.exit).toBe(1);
    expect(errors.join('\n')).toContain(`--timeout must be at most ${MAX_TIMER}`);
    const z = await runCli('generate-v4', '-p', 'x', '--timeout', '0');
    expect(z.exit).toBe(1);
    expect(errors.join('\n')).toContain('--timeout must be at least 1');
    const p = await executeGetGeneration('g', { wait: true, pollInterval: String(MAX_TIMER + 1) }, global()).catch((e) => e);
    expect(p).toBeInstanceOf(ExitSignal);
    expect(errors.join('\n')).toContain('--poll-interval must be at most');
    const w = await executeGetGeneration('g', { wait: true, waitTimeout: String(MAX_TIMER + 1) }, global()).catch((e) => e);
    expect(w).toBeInstanceOf(ExitSignal);
    expect(errors.join('\n')).toContain('--wait-timeout must be at most');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('item 7: "is required" errors say how to supply the value (message prefix kept)', () => {
  it('API key', () => {
    let err;
    try {
      new IdeogramAPI();
    } catch (e) {
      err = e;
    }
    expect(err.message.startsWith('API key is required')).toBe(true);
    expect(err.message).toContain('IDEOGRAM_API_KEY');
  });

  it('the unset-key guard', () => {
    const api = newApi();
    api.apiKey = '';
    expect(() => api._verifyApiKey()).toThrow(/^API key not set.*IDEOGRAM_API_KEY/);
  });

  it('image (upscale and precise-edit) and customModelUri', async () => {
    const api = newApi();
    const up = await api.upscale({}).catch((e) => e);
    expect(up.message.startsWith('image is required')).toBe(true);
    expect(up.message).toContain('file path');
    const pe = await api.preciseEditV45({ prompt: 'x' }).catch((e) => e);
    expect(pe.message.startsWith('image is required')).toBe(true);
    expect(pe.message).toContain('file path');
    const cm = await api.generateV4Custom({ prompt: 'x' }).catch((e) => e);
    expect(cm.message.startsWith('customModelUri is required')).toBe(true);
    expect(cm.message).toContain('model/<model_name>/version/<version_name>');
  });

  it('config validation of a missing image', () => {
    for (const op of ['precise-edit-v45', 'upscale-auto']) {
      let err;
      try {
        validateV2Params(op, { prompt: 'x', hasImage: false });
      } catch (e) {
        err = e;
      }
      expect(err.message.startsWith('image is required')).toBe(true);
      expect(err.message).toContain('file path');
    }
  });
});

describe('item 8: small diagnostics', () => {
  it('validateImageUrl keeps the URL parse failure as the cause', async () => {
    const err = await validateImageUrl('not a url').catch((e) => e);
    expect(err.message).toContain('Invalid URL');
    expect(err.cause).toBeInstanceOf(Error);
  });

  it('a declared length over the cap cancels the body before throwing (readBodyWithLimit)', async () => {
    const cancel = vi.fn();
    const res = new Response(new ReadableStream({ start() {}, cancel }), { headers: { 'content-length': '11' } });
    await expect(readBodyWithLimit(res, 10)).rejects.toBeInstanceOf(ResponseTooLargeError);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('a declared length over the cap cancels the body before throwing (streamToFile)', async () => {
    const cancel = vi.fn();
    const res = new Response(new ReadableStream({ start() {}, cancel }), { headers: { 'content-length': '11' } });
    const out = join(work, 'never.bin');
    await expect(streamToFile(res, out, 10)).rejects.toBeInstanceOf(ResponseTooLargeError);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(existsSync(out)).toBe(false);
  });

  it('describeError shows the reason behind "fetch failed"', () => {
    const cause = Object.assign(new Error('getaddrinfo ENOTFOUND cdn.example.com'), { code: 'ENOTFOUND' });
    const out = describeError(new TypeError('fetch failed', { cause }));
    expect(out).toContain('fetch failed');
    expect(out).toContain('getaddrinfo ENOTFOUND cdn.example.com');
  });

  it('describeError takes the code from the cause when the message does not carry it', () => {
    const cause = Object.assign(new Error('read failed'), { code: 'ECONNRESET' });
    expect(describeError(new TypeError('fetch failed', { cause }))).toBe('fetch failed: read failed [ECONNRESET]');
  });

  it('describeError does not repeat a cause the message already contains, and keeps the own-code form', () => {
    const cause = new Error('inner');
    expect(describeError(new Error('outer: inner', { cause }))).toBe('outer: inner');
    expect(describeError(Object.assign(new Error('boom'), { code: 'EPIPE' }))).toBe('boom [EPIPE]');
  });
});

describe('item 8: a download failure in the CLI prints the real reason', () => {
  it('v2 get-generation shows the cause behind "fetch failed"', async () => {
    fetchMock.mockImplementation(async (url) => {
      if (new URL(url).host === 'api.ideogram.ai') {
        return fakeResponse(200, {
          generation_id: 'g',
          status: 'completed',
          created: 'x',
          data: [{ object_type: 'image.generation', url: `${CDN}/1.png`, is_image_safe: true }],
        });
      }
      throw new TypeError('fetch failed', { cause: Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }) });
    });
    const res = await executeGetGeneration('g', {}, global()).catch((e) => e);
    expect(res).toBeInstanceOf(ExitSignal);
    expect(errors.join('\n')).toContain('socket hang up');
  });
});
