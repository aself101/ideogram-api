/**
 * The billing contract (2.0.0): no error or message steers a caller into
 * paying twice. Every test here fails against 98534ef.
 *
 *  1. every error out of waitForGeneration says possiblyBilled (the generation
 *     was already submitted); a last poll cut off by the deadline is a timeout
 *  2. a dry run answered with a real result throws EDRYRUNIGNORED carrying it
 *  3. a zero-item result is an error with a metadata record, not "Done!"
 *  4. metadata writes are atomic: a failed write keeps the previous content
 *  6. the "may have been billed" log line is for billable requests only; a
 *     save failure after a successful call is not reported as a failed call
 *  7. the SSRF list covers NAT64, 6to4, Teredo, SIIT and documentation ranges
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

vi.mock('dns/promises', () => ({
  lookup: vi.fn(async () => ({ address: '8.8.8.8', family: 4 })),
}));

// writeFile / rename can be made to fail. A failing writeFile mimics O_TRUNC:
// it empties its destination first, then throws (a real disk-full does the same).
const fsControl = vi.hoisted(() => ({ failWrite: false, failRename: false }));
vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal();
  const writeFile = async (file, ...rest) => {
    if (fsControl.failWrite) {
      await actual.writeFile(file, '');
      throw Object.assign(new Error('ENOSPC: no space left'), { code: 'ENOSPC' });
    }
    return actual.writeFile(file, ...rest);
  };
  const rename = async (...args) => {
    if (fsControl.failRename) throw Object.assign(new Error('EIO: rename failed'), { code: 'EIO' });
    return actual.rename(...args);
  };
  return { ...actual, default: { ...actual.default, writeFile, rename } };
});

import { fetchMock, fakeResponse, ok, httpError, resetHttp } from './helpers/http.js';
import { IdeogramAPI, IdeogramAPIError } from '../src/api.js';
import { validateImageUrl } from '../src/utils.js';
import { saveMetadata } from '../src/cli-io.js';
import { executeV2, executeAsyncV2, executeGetGeneration } from '../src/cli-v2.js';
import { createProgram } from '../src/program.js';
import { logger } from '../src/logger.js';

const KEY = 'test-key-1234567890';
const CDN = 'https://cdn.ideogram.ai';
const PNG_A = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 1, 1, 1]);

class ExitSignal extends Error {
  constructor(code) {
    super(`process.exit(${code})`);
    this.code = code;
  }
}

let work;
let logs;
let errors;
let stdoutWrites;
let spies = [];

beforeEach(() => {
  resetHttp();
  fsControl.failWrite = false;
  fsControl.failRename = false;
  work = mkdtempSync(join(tmpdir(), 'ideogram-billing-'));
  logs = [];
  errors = [];
  stdoutWrites = [];
  spies = [
    vi.spyOn(logger, 'warn').mockImplementation(() => logger),
    vi.spyOn(console, 'log').mockImplementation((...a) => void logs.push(a.join(' '))),
    vi.spyOn(console, 'error').mockImplementation((...a) => void errors.push(a.join(' '))),
    vi.spyOn(process.stdout, 'write').mockImplementation((s) => void stdoutWrites.push(String(s)) || true),
    vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new ExitSignal(code);
    }),
  ];
});

afterEach(() => {
  spies.forEach((s) => s.mockRestore());
  fsControl.failWrite = false;
  fsControl.failRename = false;
  rmSync(work, { recursive: true, force: true });
});

const global = () => ({ apiKey: KEY, outputDir: work, logLevel: 'error' });
const newApi = () => new IdeogramAPI(KEY, undefined, 'error');
const caught = (p) => p.then(() => undefined, (e) => e);

/** API answer by path; downloads come from `files`. */
function route(api, files = {}) {
  fetchMock.mockImplementation(async (url) => {
    const u = new URL(url);
    if (u.host === 'api.ideogram.ai') return fakeResponse(200, api(u.pathname));
    if (!(url in files)) throw new Error(`unexpected download: ${url}`);
    return new Response(files[url]);
  });
}

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

const jsonFiles = (dir) => readdirSync(dir).filter((n) => n.endsWith('.json'));

// ------------------------------------------------------------ 1. waitForGeneration
describe('item 1: every error out of waitForGeneration is possiblyBilled and names the generation', () => {
  it('a poll that fails with a 500 is rewrapped as possiblyBilled: true', async () => {
    fetchMock.mockReturnValue(httpError(500, { error: 'boom' }));
    const e = await caught(newApi().waitForGeneration('gen-1', { intervalMs: 1 }));
    expect(e).toBeInstanceOf(IdeogramAPIError);
    expect(e.status).toBe(500);
    expect(e.generationId).toBe('gen-1');
    expect(e.possiblyBilled).toBe(true);
  });

  it('a poll that fails with a 404 (a GET: not billed by itself) is still possiblyBilled: true', async () => {
    fetchMock.mockReturnValue(httpError(404, { error: 'gone' }));
    const e = await caught(newApi().waitForGeneration('gen-1', { intervalMs: 1 }));
    expect(e.status).toBe(404);
    expect(e.generationId).toBe('gen-1');
    expect(e.possiblyBilled).toBe(true);
  });

  it('a poll with no response is possiblyBilled: true', async () => {
    fetchMock.mockRejectedValue(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } }));
    const e = await caught(newApi().waitForGeneration('gen-1', { intervalMs: 1 }));
    expect(e.code).toBe('ECONNRESET');
    expect(e.generationId).toBe('gen-1');
    expect(e.possiblyBilled).toBe(true);
  });

  it('a failed generation is possiblyBilled: true', async () => {
    fetchMock.mockReturnValue(ok({ generation_id: 'gen-1', status: 'failed', created: 't', failure_reason: 'content_policy_violation' }));
    const e = await caught(newApi().waitForGeneration('gen-1', { intervalMs: 1 }));
    expect(e.failureReason).toBe('content_policy_violation');
    expect(e.generationId).toBe('gen-1');
    expect(e.possiblyBilled).toBe(true);
  });

  it('the deadline timeout is possiblyBilled: true', async () => {
    fetchMock.mockImplementation(() => ok({ generation_id: 'gen-1', status: 'pending', created: 't' }));
    const e = await caught(newApi().waitForGeneration('gen-1', { intervalMs: 20, timeoutMs: 30 }));
    expect(e.message).toContain('Timed out after 30ms waiting for generation gen-1');
    expect(e.generationId).toBe('gen-1');
    expect(e.possiblyBilled).toBe(true);
  });

  it('a last poll that aborts at the deadline is reported as the wait timing out, not a network failure', async () => {
    fetchMock.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 60)); // outlives the 30ms deadline
      throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
    });
    const e = await caught(newApi().waitForGeneration('gen-1', { intervalMs: 5, timeoutMs: 30 }));
    expect(e.message).toContain('Timed out after 30ms waiting for generation gen-1');
    expect(e.message).not.toContain('Request failed');
    expect(e.generationId).toBe('gen-1');
    expect(e.possiblyBilled).toBe(true);
  });

  it('getGeneration called directly keeps possiblyBilled: false (a GET is never billed)', async () => {
    fetchMock.mockReturnValue(httpError(500, { error: 'boom' }));
    const e = await caught(newApi().getGeneration('gen-1'));
    expect(e.status).toBe(500);
    expect(e.possiblyBilled).toBe(false);
  });
});

// ------------------------------------------------------------ 2. EDRYRUNIGNORED
describe('item 2: a dry run answered with a real result throws EDRYRUNIGNORED', () => {
  const real = { generation_id: 'gen-real', data: [{ url: `${CDN}/1.png`, is_image_safe: true }] };
  const quote = { object: 'price_quote', billing_identifier: 'x', quantity: 1, usd_micros: 1, credit_millis: 1, qualifier: 'exact' };

  const methods = {
    generateV4: (api, extra) => api.generateV4({ prompt: 'a fox', ...extra }),
    generateV45: (api, extra) => api.generateV45({ prompt: 'a fox', ...extra }),
    generateAuto: (api, extra) => api.generateAuto({ prompt: 'a fox', ...extra }),
    generateSvg: (api, extra) => api.generateSvg({ prompt: 'a fox', ...extra }),
    seedance25TextToVideo: (api, extra) => api.seedance25TextToVideo({ prompt: 'a fox', ...extra }),
  };

  for (const [name, call] of Object.entries(methods)) {
    it(`${name}: a real result keeps the HTTP status, the generation id and the parsed result`, async () => {
      fetchMock.mockReturnValue(ok(real));
      const e = await caught(call(newApi(), { dryRun: true }));
      expect(e).toBeInstanceOf(IdeogramAPIError);
      expect(e.code).toBe('EDRYRUNIGNORED');
      expect(e.possiblyBilled).toBe(true);
      expect(e.status).toBe(200);
      expect(e.generationId).toBe('gen-real');
      expect(e.result).toEqual(real);
      expect(e.message).toContain('dry_run was requested but the API returned a real result; it may have been billed');
      expect(e.message).toContain('error.result');
    });

    it(`${name}: a price quote still returns the quote; a real call without dryRun is untouched`, async () => {
      fetchMock.mockReturnValue(ok(quote));
      expect(await call(newApi(), { dryRun: true })).toEqual(quote);
      fetchMock.mockReturnValue(ok(real));
      expect(await call(newApi(), {})).toEqual(real);
    });
  }

  it('a real result without a generation_id still throws, with no generationId', async () => {
    fetchMock.mockReturnValue(ok({ data: [] }));
    const e = await caught(newApi().generateV4({ prompt: 'a fox', dryRun: true }));
    expect(e.code).toBe('EDRYRUNIGNORED');
    expect(e.generationId).toBeUndefined();
    expect(e.result).toEqual({ data: [] });
  });

  it('CLI sync: the result comes from error.result, is saved, and the warning says saved below', async () => {
    route(() => real, { [`${CDN}/1.png`]: PNG_A });
    const res = await caught(executeV2('generate-v4', { prompt: 'a fox', dryRun: true }, global()));
    expect(res).toBeInstanceOf(ExitSignal);
    expect(res.code).toBe(1);
    const err = errors.join('\n');
    expect(err).toContain('The result is saved below');
    expect(err).not.toContain('listed below');
    expect(readdirSync(join(work, 'generate-v4')).filter((n) => n.endsWith('.png'))).toHaveLength(1);
    expect(logs).toContain('Generation id: gen-real');
  });

  it('CLI async without --wait: the warning says the generation id is listed, not saved', async () => {
    route(() => ({ generation_id: 'gen-ack' }));
    const res = await caught(executeAsyncV2('generate-svg', { prompt: 'a fox', dryRun: true }, global()));
    expect(res).toBeInstanceOf(ExitSignal);
    expect(res.code).toBe(1);
    const err = errors.join('\n');
    expect(err).toContain('The generation id is listed below');
    expect(err).not.toContain('saved below');
    expect(logs).toContain('Generation accepted: gen-ack');
  });

  it('CLI sync with an async acknowledgement: the warning says the generation id is listed', async () => {
    route(() => ({ generation_id: 'gen-ack' }));
    const res = await caught(executeV2('generate-v4', { prompt: 'a fox', dryRun: true }, global()));
    expect(res.code).toBe(1);
    expect(errors.join('\n')).toContain('The generation id is listed below');
    expect(errors.join('\n')).not.toContain('saved below');
  });
});

// ------------------------------------------------------------ 3. zero-item results
describe('item 3: a zero-item result is an error with a metadata record', () => {
  it('v2 sync: prints the id, writes the metadata, says it may have been billed, exits 1, never "Done!"', async () => {
    route(() => ({ generation_id: 'gen-zero', data: [] }));
    const res = await caught(executeV2('generate-v4', { prompt: 'a fox' }, global()));
    expect(res).toBeInstanceOf(ExitSignal);
    expect(res.code).toBe(1);
    expect(logs).toContain('Generation id: gen-zero');
    expect(logs.join('\n')).not.toContain('Done!');
    expect(errors.join('\n')).toContain('returned no results');
    expect(errors.join('\n')).toContain('may have been billed');
    const dir = join(work, 'generate-v4');
    const files = jsonFiles(dir);
    expect(files).toHaveLength(1);
    const meta = JSON.parse(readFileSync(join(dir, files[0]), 'utf8'));
    expect(meta.generationId).toBe('gen-zero');
    expect(meta.response.itemCount).toBe(0);
    expect(meta.response.items).toEqual([]);
    expect(meta.response.responseKeys).toEqual(['generation_id', 'data']);
  });

  it('v2 get-generation: a completed generation without data records its status and exits 1', async () => {
    route(() => ({ generation_id: 'gen-c', status: 'completed', created: 't' }));
    const res = await caught(executeGetGeneration('gen-c', {}, global()));
    expect(res).toBeInstanceOf(ExitSignal);
    expect(res.code).toBe(1);
    const dir = join(work, 'generations');
    const meta = JSON.parse(readFileSync(join(dir, jsonFiles(dir)[0]), 'utf8'));
    expect(meta.response.status).toBe('completed');
    expect(meta.response.items).toEqual([]);
  });

  it('v1: no images is an error, with a metadata record, exit 1', async () => {
    route(() => ({ created: '2026-11-22T00:00:00Z', data: [] }));
    const res = await runCli('generate', '-p', 'fox');
    expect(res.exit).toBe(1);
    expect(logs.join('\n')).not.toContain('All done');
    expect(errors.join('\n')).toContain('no images');
    expect(errors.join('\n')).toContain('may have been billed');
    const dir = join(work, 'generate-v3');
    const meta = JSON.parse(readFileSync(join(dir, jsonFiles(dir)[0]), 'utf8'));
    expect(meta.response.imageCount).toBe(0);
    expect(meta.response.images).toEqual([]);
    expect(meta.response.responseKeys).toEqual(['created', 'data']);
  });
});

// ------------------------------------------------------------ 4. atomic metadata
describe('item 4: saveMetadata is atomic', () => {
  it('a failed write keeps the previous content and leaves no temp file', async () => {
    const target = join(work, 'meta.json');
    writeFileSync(target, '{"old":true}');
    fsControl.failWrite = true;
    const e = await caught(saveMetadata(target, { fresh: true }));
    expect(e.code).toBe('ENOSPC');
    expect(readFileSync(target, 'utf8')).toBe('{"old":true}');
    expect(readdirSync(work)).toEqual(['meta.json']);
  });

  it('a failed rename keeps the previous content and removes the temp file', async () => {
    const target = join(work, 'meta.json');
    writeFileSync(target, '{"old":true}');
    fsControl.failRename = true;
    const e = await caught(saveMetadata(target, { fresh: true }));
    expect(e.code).toBe('EIO');
    expect(readFileSync(target, 'utf8')).toBe('{"old":true}');
    expect(readdirSync(work)).toEqual(['meta.json']);
  });

  it('a successful write replaces the content in one piece and leaves no temp file', async () => {
    const target = join(work, 'meta.json');
    writeFileSync(target, '{"old":true}');
    expect(await saveMetadata(target, { fresh: true })).toBe(target);
    expect(JSON.parse(readFileSync(target, 'utf8'))).toEqual({ fresh: true });
    expect(readdirSync(work)).toEqual(['meta.json']);
  });

  it('end to end: a failing rewrite after the first write leaves the first record readable', async () => {
    route(() => ({ generation_id: 'gen-1', data: [{ object_type: 'image.generation', url: `${CDN}/1.png`, is_image_safe: true }] }), {
      [`${CDN}/1.png`]: PNG_A,
    });
    // The first (placeholder) write succeeds; the final rewrite fails.
    let writes = 0;
    const fs = (await import('fs/promises')).default;
    const spy = vi.spyOn(fs, 'rename').mockImplementation(async (a, b) => {
      if (++writes >= 2) throw Object.assign(new Error('EIO: rename failed'), { code: 'EIO' });
      return (await vi.importActual('fs/promises')).rename(a, b);
    });
    try {
      const res = await caught(executeV2('generate-v4', { prompt: 'a fox' }, global()));
      expect(res).toBeInstanceOf(ExitSignal);
    } finally {
      spy.mockRestore();
    }
    const dir = join(work, 'generate-v4');
    const meta = JSON.parse(readFileSync(join(dir, jsonFiles(dir)[0]), 'utf8'));
    expect(meta.generationId).toBe('gen-1');
    expect(meta.response.items[0].url).toBe(`${CDN}/1.png`);
    expect(readdirSync(dir).filter((n) => n.includes('.tmp-'))).toEqual([]);
  });
});

// ------------------------------------------------------------ 6. messages
describe('item 6: messages never imply a billed GET, and a save failure is not a failed call', () => {
  it('a failed status poll does not say a generation may have been billed; a failed POST does', async () => {
    const lines = [];
    const spy = vi.spyOn(console, 'error');
    const api = new IdeogramAPI(KEY, undefined, 'error');
    const sink = vi.spyOn(api.logger, 'error').mockImplementation((m) => void lines.push(String(m)));
    try {
      fetchMock.mockRejectedValue(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } }));
      await caught(api.getGeneration('gen-1'));
      expect(lines.join('\n')).toContain('Request failed');
      expect(lines.join('\n')).not.toContain('billed');

      lines.length = 0;
      fetchMock.mockReturnValue(Promise.resolve(fakeResponse(200, '<html>', 'text/html')));
      await caught(api.getGeneration('gen-1'));
      expect(lines.join('\n')).toContain('Invalid response format');
      expect(lines.join('\n')).not.toContain('billed');

      lines.length = 0;
      await caught(api.generateV4({ prompt: 'x' }));
      expect(lines.join('\n')).toContain('Invalid response format');
      expect(lines.join('\n')).toContain('may still have run and been billed');
    } finally {
      sink.mockRestore();
      spy.mockRestore();
    }
  });

  it('v1 generate: a save failure after a successful call is not reported as a failed generation', async () => {
    route(() => ({ created: '2026-11-22T00:00:00Z', data: [{ url: `${CDN}/1.png`, is_image_safe: true }] }), {
      [`${CDN}/1.png`]: PNG_A,
    });
    fsControl.failWrite = true;
    const res = await runCli('generate', '-p', 'fox');
    expect(res.exit).toBe(1);
    const out = stdoutWrites.join('');
    expect(out).toContain('Generation complete');
    expect(out).not.toContain('Generation failed');
    expect(errors.join('\n')).toContain('The result was generated (and billed)');
  });

  it('v1 generate: a failed API call is still reported as a failed generation', async () => {
    fetchMock.mockReturnValue(httpError(500, { error: 'boom' }));
    const res = await runCli('generate', '-p', 'fox');
    expect(res.exit).toBe(1);
    expect(stdoutWrites.join('')).toContain('Generation failed');
    expect(stdoutWrites.join('')).not.toContain('Generation complete');
  });

  it('v1 describe (executeOperation): a save failure after a successful call is not "Description failed"', async () => {
    const image = join(work, 'in.png');
    writeFileSync(image, PNG_A);
    route(() => ({ descriptions: [{ text: 'a fox' }] }));
    fsControl.failWrite = true;
    const res = await runCli('describe', '-i', image);
    expect(res.exit).toBe(1);
    const out = stdoutWrites.join('');
    expect(out).toContain('Description complete');
    expect(out).not.toContain('Description failed');
  });
});

// ------------------------------------------------------------ 7. SSRF ranges
describe('item 7: SSRF block list covers transition and documentation ranges', () => {
  const blocked = [
    ['NAT64', 'https://[64:ff9b::808:808]/a.png'],
    ['local-use NAT64', 'https://[64:ff9b:1::808:808]/a.png'],
    ['6to4', 'https://[2002:808:808::1]/a.png'],
    ['IPv4-translated (SIIT)', 'https://[::ffff:0:808:808]/a.png'],
    ['Teredo', 'https://[2001:0:4136:e378:8000:63bf:3fff:fdd2]/a.png'],
    ['IPv6 documentation', 'https://[2001:db8::1]/a.png'],
    ['TEST-NET-1', 'https://192.0.2.1/a.png'],
    ['TEST-NET-2', 'https://198.51.100.7/a.png'],
    ['TEST-NET-3', 'https://203.0.113.9/a.png'],
  ];
  for (const [label, url] of blocked) {
    it(`${label}: ${url} is refused`, async () => {
      await expect(validateImageUrl(url)).rejects.toThrow();
    });
  }

  it('control: public addresses next to those ranges are still accepted', async () => {
    for (const url of [
      'https://8.8.8.8/a.png',
      'https://[2606:4700::1111]/a.png',
      'https://[2001:4860:4860::8888]/a.png', // outside 2001::/32 and 2001:db8::/32
      'https://192.0.3.1/a.png',
      'https://203.0.114.1/a.png',
    ]) {
      expect(await validateImageUrl(url)).toBe(url);
    }
  });
});
