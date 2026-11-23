/**
 * Fixes from ship-pipeline run #9 (tracker project ideogram-api), 2.0.0 release:
 *
 *  1. .env loading is CLI-only and takes IDEOGRAM_API_KEY alone
 *  2. SSRF address check (BlockList, IPv4-mapped IPv6 in any spelling, every DNS answer)
 *  3. download helpers reject a bad maxBytes / timeoutMs before any request
 *  4. the billed result is recorded (id and URLs printed) before any disk work
 *  5. a --dry-run answered with a real result is a loud error, not "Priced"
 *  6. IdeogramAPIError.possiblyBilled and production messages that do not invite a blind retry
 *  7. waitForGeneration: errors carry the generation id, per-poll timeout capped at the deadline
 *  8. wording: "image is required", mask help, bare errors name the value
 *  9. http.ts: ENOTDIR, last redirect body cancelled
 *
 * Every block was run against 6e4c5ae (see the executor report for which tests fail there).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { spawnSync } from 'child_process';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';

vi.mock('dns/promises', () => ({
  lookup: vi.fn(async () => ({ address: '8.8.8.8', family: 4 })),
}));

// writeFile can be made to fail for files with a given suffix; everything else is real.
const fsControl = vi.hoisted(() => ({ failSuffix: null, error: null }));
vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal();
  const writeFile = async (file, ...rest) => {
    // The metadata is written to a temp sibling (`<name>.json.tmp-<pid>-<rand>`) and renamed.
    if (fsControl.failSuffix && String(file).replace(/\.tmp-[^/\\]*$/, '').endsWith(fsControl.failSuffix)) throw fsControl.error;
    return actual.writeFile(file, ...rest);
  };
  return { ...actual, default: { ...actual.default, writeFile } };
});

import { lookup } from 'dns/promises';
import { fetchMock, fakeResponse, resetHttp, timeoutSpy, instantSleeps } from './helpers/http.js';
import { IdeogramAPI, IdeogramAPIError } from '../src/api.js';
import { validateImageUrl, downloadBuffer, downloadToFile } from '../src/utils.js';
import {
  readBodyWithLimit,
  streamToFile,
  fetchFollowingRedirects,
  discardFile,
} from '../src/http.js';
import * as cliIo from '../src/cli-io.js';
import { executeV2, executeAsyncV2, executeGetGeneration } from '../src/cli-v2.js';
import { validateV2Params } from '../src/config.js';
import { createProgram } from '../src/program.js';
import { logger } from '../src/logger.js';

const KEY = 'test-key-1234567890';
const CDN = 'https://cdn.ideogram.ai';
const PNG_A = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 1, 1, 1]);
const ROOT = resolve(import.meta.dirname, '..');

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
  lookup.mockReset();
  lookup.mockResolvedValue({ address: '8.8.8.8', family: 4 });
  fsControl.failSuffix = null;
  fsControl.error = null;
  work = mkdtempSync(join(tmpdir(), 'ideogram-sec-'));
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
  fsControl.failSuffix = null;
  rmSync(work, { recursive: true, force: true });
});

const global = () => ({ apiKey: KEY, outputDir: work, logLevel: 'error' });
const newApi = () => new IdeogramAPI(KEY, undefined, 'error');
const caught = (p) => p.then(() => undefined, (e) => e);

/** API answer by path; downloads come from `files` (an Error value makes that download fail). */
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

// ---------------------------------------------------------------- 1. .env
describe('item 1: .env loading is CLI-only and takes IDEOGRAM_API_KEY alone', () => {
  const tsx = join(ROOT, 'node_modules', '.bin', 'tsx');

  /** Run a script under tsx in a sandbox cwd/HOME holding a .env; prints the two variables at exit. */
  function inSandbox(body, { cwdEnv, homeEnv, env = {} } = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'ideogram-envbox-'));
    const home = join(dir, 'home');
    mkdirSync(join(home, '.ideogram'), { recursive: true });
    if (cwdEnv) writeFileSync(join(dir, '.env'), cwdEnv);
    if (homeEnv) writeFileSync(join(home, '.ideogram', '.env'), homeEnv);
    const script = join(dir, 'probe.mjs');
    writeFileSync(
      script,
      `process.on('exit', () => process.stderr.write('PROBE ' + JSON.stringify({ key: process.env.IDEOGRAM_API_KEY ?? null, other: process.env.OTHER_VAR_X ?? null, outdir: process.env.IDEOGRAM_OUTPUT_DIR ?? null }) + '\\n'));\n${body}`
    );
    const childEnv = { ...process.env, HOME: home, ...env };
    delete childEnv.IDEOGRAM_API_KEY;
    delete childEnv.OTHER_VAR_X;
    delete childEnv.IDEOGRAM_OUTPUT_DIR;
    Object.assign(childEnv, env);
    const r = spawnSync(tsx, [script], { cwd: dir, env: childEnv, encoding: 'utf8', timeout: 60000 });
    const line = r.stderr.split('\n').find((l) => l.startsWith('PROBE '));
    rmSync(dir, { recursive: true, force: true });
    if (!line) throw new Error(`no probe output: ${r.stderr}`);
    return JSON.parse(line.slice(6));
  }
  const src = (f) => pathToFileURL(join(ROOT, 'src', f)).href;
  const DOTENV = 'IDEOGRAM_API_KEY=from-cwd-env\nOTHER_VAR_X=leaked\nIDEOGRAM_OUTPUT_DIR=/elsewhere\n';

  it('importing the library (api, config, utils) loads nothing from a cwd .env', () => {
    const seen = inSandbox(
      `await import(${JSON.stringify(src('api.ts'))}); await import(${JSON.stringify(src('config.ts'))}); await import(${JSON.stringify(src('utils.ts'))});`,
      { cwdEnv: DOTENV }
    );
    expect(seen).toEqual({ key: null, other: null, outdir: null });
  });

  it('importing the library loads nothing from ~/.ideogram/.env either', () => {
    const seen = inSandbox(`await import(${JSON.stringify(src('config.ts'))});`, { homeEnv: DOTENV });
    expect(seen).toEqual({ key: null, other: null, outdir: null });
  });

  it('the CLI picks up IDEOGRAM_API_KEY from the cwd .env and nothing else', () => {
    const seen = inSandbox(
      `const { main } = await import(${JSON.stringify(src('program.ts'))}); await main(['node', 'ideogram', '--examples']);`,
      { cwdEnv: DOTENV }
    );
    expect(seen).toEqual({ key: 'from-cwd-env', other: null, outdir: null });
  });

  it('the CLI falls back to ~/.ideogram/.env, again for the key alone', () => {
    const seen = inSandbox(
      `const { main } = await import(${JSON.stringify(src('program.ts'))}); await main(['node', 'ideogram', '--examples']);`,
      { homeEnv: 'IDEOGRAM_API_KEY=from-home\nOTHER_VAR_X=leaked\n' }
    );
    expect(seen).toEqual({ key: 'from-home', other: null, outdir: null });
  });

  describe('loadDotenvApiKey precedence: env var > cwd .env > ~/.ideogram/.env', () => {
    let cwd;
    let home;
    let saved;
    beforeEach(() => {
      cwd = join(work, 'cwd');
      home = join(work, 'home');
      mkdirSync(cwd, { recursive: true });
      mkdirSync(join(home, '.ideogram'), { recursive: true });
      saved = process.env.IDEOGRAM_API_KEY;
      delete process.env.IDEOGRAM_API_KEY;
    });
    afterEach(() => {
      if (saved === undefined) delete process.env.IDEOGRAM_API_KEY;
      else process.env.IDEOGRAM_API_KEY = saved;
      delete process.env.OTHER_VAR_X;
    });

    it('an existing environment variable wins over both files', () => {
      process.env.IDEOGRAM_API_KEY = 'from-env';
      writeFileSync(join(cwd, '.env'), 'IDEOGRAM_API_KEY=from-cwd\n');
      writeFileSync(join(home, '.ideogram', '.env'), 'IDEOGRAM_API_KEY=from-home\n');
      expect(cliIo.loadDotenvApiKey(cwd, home)).toBeUndefined();
      expect(process.env.IDEOGRAM_API_KEY).toBe('from-env');
    });
    it('the cwd .env wins over the home .env', () => {
      writeFileSync(join(cwd, '.env'), 'IDEOGRAM_API_KEY=from-cwd\nOTHER_VAR_X=x\n');
      writeFileSync(join(home, '.ideogram', '.env'), 'IDEOGRAM_API_KEY=from-home\n');
      expect(cliIo.loadDotenvApiKey(cwd, home)).toBe(join(cwd, '.env'));
      expect(process.env.IDEOGRAM_API_KEY).toBe('from-cwd');
      expect(process.env.OTHER_VAR_X).toBeUndefined();
    });
    it('a cwd .env without the key does not hide the home .env', () => {
      writeFileSync(join(cwd, '.env'), 'OTHER_VAR_X=x\n');
      writeFileSync(join(home, '.ideogram', '.env'), 'IDEOGRAM_API_KEY=from-home\n');
      expect(cliIo.loadDotenvApiKey(cwd, home)).toBe(join(home, '.ideogram', '.env'));
      expect(process.env.IDEOGRAM_API_KEY).toBe('from-home');
    });
    it('no files: nothing is set and nothing is warned', () => {
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => logger);
      expect(cliIo.loadDotenvApiKey(cwd, home)).toBeUndefined();
      expect(process.env.IDEOGRAM_API_KEY).toBeUndefined();
      expect(warn).not.toHaveBeenCalled();
      warn.mockRestore();
    });
    it('an unreadable .env (a directory) is warned about with its path, then the next file is tried', () => {
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => logger);
      mkdirSync(join(cwd, '.env'));
      writeFileSync(join(home, '.ideogram', '.env'), 'IDEOGRAM_API_KEY=from-home\n');
      expect(cliIo.loadDotenvApiKey(cwd, home)).toBe(join(home, '.ideogram', '.env'));
      expect(warn.mock.calls.some((c) => String(c[0]).includes(join(cwd, '.env')))).toBe(true);
      warn.mockRestore();
    });
  });
});

// ---------------------------------------------------------------- 2. SSRF
describe('item 2: validateImageUrl blocks every spelling of an internal address', () => {
  const blocked = [
    // the six reproduced bypasses
    'https://[::ffff:7f00:1]/',
    'https://[::ffff:a9fe:a9fe]/',
    'https://[::]/',
    'https://[fd12:3456::1]/',
    'https://[fe90::1]/',
    'https://100.64.0.1/',
    // IPv4-mapped IPv6, other spellings
    'https://[::ffff:127.0.0.1]/',
    'https://[0:0:0:0:0:ffff:7f00:1]/',
    'https://[0000:0000:0000:0000:0000:FFFF:7F00:0001]/',
    'https://[::ffff:c0a8:1]/',
    'https://[::ffff:0a00:1]/',
    'https://[::ffff:ac10:1]/',
    // IPv4 spellings the URL parser normalizes
    'https://2130706433/',
    'https://0x7f.1/',
    'https://127.1/',
    // each range
    'https://0.0.0.0/',
    'https://0.1.2.3/',
    'https://127.255.255.254/',
    'https://10.1.2.3/',
    'https://172.16.0.1/',
    'https://172.31.255.255/',
    'https://192.168.1.1/',
    'https://169.254.169.254/',
    'https://100.127.255.255/',
    'https://192.0.0.1/',
    'https://198.18.0.1/',
    'https://198.19.255.255/',
    'https://224.0.0.1/',
    'https://239.255.255.255/',
    'https://240.0.0.1/',
    'https://255.255.255.255/',
    'https://[::1]/',
    'https://[fc00::1]/',
    'https://[fdff:ffff::1]/',
    'https://[fe80::1]/',
    'https://[febf::1]/',
    'https://[ff02::1]/',
    'https://[::7f00:1]/', // deprecated IPv4-compatible loopback
  ];
  it.each(blocked)('%s is blocked', async (url) => {
    const err = await caught(validateImageUrl(url));
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/not allowed/);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('keeps the original message prefixes (localhost for mapped loopback, private for the rest)', async () => {
    expect((await caught(validateImageUrl('https://[::ffff:7f00:1]/'))).message).toMatch(/^Access to localhost is not allowed/);
    expect((await caught(validateImageUrl('https://[::ffff:a9fe:a9fe]/'))).message).toMatch(
      /^Access to internal\/private IP addresses is not allowed/
    );
  });

  const allowed = [
    'https://8.8.8.8/x.png',
    'https://1.1.1.1/',
    'https://100.63.255.255/',
    'https://100.128.0.1/',
    'https://172.15.0.1/',
    'https://172.32.0.1/',
    'https://198.17.255.255/',
    'https://198.20.0.1/',
    'https://223.255.255.255/',
    'https://[2606:4700:4700::1111]/',
    'https://[::ffff:808:808]/', // mapped 8.8.8.8
    'https://[fbff::1]/',
    'https://[fec0::1]/',
  ];
  it.each(allowed)('%s passes', async (url) => {
    await expect(validateImageUrl(url)).resolves.toBe(url);
  });

  describe('host names', () => {
    it.each(['localhost', 'metadata.google.internal', 'metadata', 'LOCALHOST', 'localhost.'])(
      '%s is blocked even when DNS says a public address, and is not resolved',
      async (host) => {
        lookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
        const err = await caught(validateImageUrl(`https://${host}/x.png`));
        expect(err.message).toMatch(/^Access to cloud metadata endpoints is not allowed/);
        expect(lookup).not.toHaveBeenCalled();
      }
    );

    it('resolves with all: true and passes a name whose every answer is public', async () => {
      lookup.mockResolvedValue([
        { address: '8.8.8.8', family: 4 },
        { address: '2606:4700:4700::1111', family: 6 },
      ]);
      await expect(validateImageUrl('https://cdn.example.com/a.png')).resolves.toBe('https://cdn.example.com/a.png');
      expect(lookup).toHaveBeenCalledWith('cdn.example.com', { all: true });
    });

    it('a multi-answer DNS where ONE address is private is blocked, whichever position it is in', async () => {
      for (const answers of [
        [{ address: '8.8.8.8', family: 4 }, { address: '10.0.0.1', family: 4 }],
        [{ address: '10.0.0.1', family: 4 }, { address: '8.8.8.8', family: 4 }],
        [{ address: '8.8.8.8', family: 4 }, { address: '::ffff:7f00:1', family: 6 }],
        [{ address: '1.1.1.1', family: 4 }, { address: 'fd12:3456::1', family: 6 }],
        [{ address: '1.1.1.1', family: 4 }, { address: '100.64.0.1', family: 4 }],
      ]) {
        lookup.mockResolvedValue(answers);
        const err = await caught(validateImageUrl('https://mixed.example.com/a.png'));
        expect(err?.message).toMatch(/resolves to internal\/private IP address/);
      }
    });

    it('a name that resolves to nothing is refused, not passed', async () => {
      lookup.mockResolvedValue([]);
      const err = await caught(validateImageUrl('https://empty.example.com/'));
      expect(err.message).toMatch(/Failed to validate domain empty\.example\.com/);
    });

    it('still reports a name that does not resolve', async () => {
      lookup.mockRejectedValueOnce(Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }));
      const err = await caught(validateImageUrl('https://nowhere.example.com/'));
      expect(err.message).toMatch(/could not be resolved/);
      expect(err.cause?.code).toBe('ENOTFOUND');
    });

    it('the https-only rule stays', async () => {
      const err = await caught(validateImageUrl('http://8.8.8.8/'));
      expect(err.message).toMatch(/^Only HTTPS URLs/);
    });
  });

  it('the error names the host (not the path or query) and says how to fix it', async () => {
    const err = await caught(validateImageUrl('https://10.9.8.7/secret/path?token=abc'));
    expect(err.message).toContain('10.9.8.7');
    expect(err.message).toContain('public HTTPS URL');
    expect(err.message).not.toContain('token=abc');
  });
});

// ---------------------------------------------------------------- 3. bounds
describe('item 3: download helpers reject a bad maxBytes / timeoutMs before any request', () => {
  // (null and undefined mean "use the default", as before)
  const badBytes = [NaN, Infinity, -Infinity, 0, -1, 1.5, '10'];
  it.each(badBytes)('downloadBuffer maxBytes %s', async (maxBytes) => {
    const err = await caught(downloadBuffer(`${CDN}/a.png`, { maxBytes }));
    expect(err.message).toMatch(/maxBytes must be a finite integer of at least 1/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each(badBytes)('downloadToFile maxBytes %s', async (maxBytes) => {
    const err = await caught(downloadToFile(`${CDN}/a.png`, join(work, 'o.bin'), { maxBytes }));
    expect(err.message).toMatch(/maxBytes must be a finite integer of at least 1/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(existsSync(join(work, 'o.bin'))).toBe(false);
  });
  const badTimeouts = [NaN, Infinity, 0, -5, 1.5, 2147483648];
  it.each(badTimeouts)('downloadBuffer / downloadToFile timeoutMs %s', async (timeoutMs) => {
    for (const run of [
      () => downloadBuffer(`${CDN}/a.png`, { timeoutMs }),
      () => downloadToFile(`${CDN}/a.png`, join(work, 'o.bin'), { timeoutMs }),
    ]) {
      const err = await caught(run());
      expect(err.message).toMatch(/timeoutMs must be an integer between 1 and 2147483647/);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each(badTimeouts)('fetchFollowingRedirects timeoutMs %s', async (timeoutMs) => {
    const err = await caught(fetchFollowingRedirects(`${CDN}/a.png`, { validate: async (u) => u, timeoutMs }));
    expect(err.message).toMatch(/timeoutMs must be an integer/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each(badBytes)('readBodyWithLimit and streamToFile maxBytes %s', async (maxBytes) => {
    const e1 = await caught(readBodyWithLimit(new Response('abc'), maxBytes));
    expect(e1.message).toMatch(/maxBytes must be a finite integer/);
    const e2 = await caught(streamToFile(new Response('abc'), join(work, 's.bin'), maxBytes));
    expect(e2.message).toMatch(/maxBytes must be a finite integer/);
    expect(existsSync(join(work, 's.bin'))).toBe(false);
  });
  it('the smallest legal values still work', async () => {
    expect((await readBodyWithLimit(new Response('a'), 1)).toString()).toBe('a');
    fetchMock.mockResolvedValue(new Response('a'));
    expect((await downloadBuffer(`${CDN}/a.png`, { maxBytes: 1, timeoutMs: 1 })).toString()).toBe('a');
  });
});

// ---------------------------------------------------------------- 4. the record of a billed result
describe('item 4: the billed result is recorded before any disk operation', () => {
  const v2Result = (n = 1) => ({
    generation_id: 'gen-billed',
    seed: 7,
    data: Array.from({ length: n }, (_, i) => ({
      object_type: 'image.generation',
      url: `${CDN}/${i + 1}.png`,
      is_image_safe: true,
    })),
  });
  const files2 = { [`${CDN}/1.png`]: PNG_A, [`${CDN}/2.png`]: new Error('socket hang up') };

  /** An output "directory" below a regular file: every mkdir under it fails (ENOTDIR). */
  const blockedOutputDir = () => {
    const f = join(work, 'a-file');
    writeFileSync(f, 'x');
    return join(f, 'sub');
  };

  it('v2: a disk failure still leaves the generation id and URLs on stdout, at --log-level error', async () => {
    route(() => v2Result(2));
    const res = await caught(
      executeV2('generate-v4', { prompt: 'a fox' }, { apiKey: KEY, outputDir: blockedOutputDir(), logLevel: 'error' })
    );
    expect(res).toBeInstanceOf(ExitSignal);
    expect(logs).toContain('Generation id: gen-billed');
    expect(logs).toContain(`Result URL 1/2: ${CDN}/1.png`);
    expect(logs).toContain(`Result URL 2/2: ${CDN}/2.png`);
    const err = errors.join('\n');
    expect(err).toContain('The result was generated (and billed)');
    expect(err).toMatch(/ENOTDIR/);
  });

  it('v2: the id and URLs are printed before the output directory exists', async () => {
    route(() => v2Result(1), { [`${CDN}/1.png`]: PNG_A });
    const out = join(work, 'out');
    let dirExistedAtPrint;
    console.log.mockImplementation((...a) => {
      const line = a.join(' ');
      if (line.startsWith('Generation id:')) dirExistedAtPrint = existsSync(join(out, 'generate-v4'));
      logs.push(line);
    });
    await executeV2('generate-v4', { prompt: 'a fox' }, { apiKey: KEY, outputDir: out, logLevel: 'error' });
    expect(dirExistedAtPrint).toBe(false);
    expect(existsSync(join(out, 'generate-v4'))).toBe(true);
  });

  it('v2: a failed first metadata write removes the claimed placeholder and says the result was billed', async () => {
    route(() => v2Result(1), { [`${CDN}/1.png`]: PNG_A });
    fsControl.failSuffix = '.json';
    fsControl.error = Object.assign(new Error('EIO: i/o error'), { code: 'EIO' });
    const res = await caught(executeV2('generate-v4', { prompt: 'a fox' }, global()));
    expect(res).toBeInstanceOf(ExitSignal);
    const dir = join(work, 'generate-v4');
    expect(readdirSync(dir)).toEqual([]); // no empty .json placeholder
    expect(logs).toContain('Generation id: gen-billed');
    expect(errors.join('\n')).toContain('The result was generated (and billed)');
    expect(errors.join('\n')).toContain('EIO');
  });

  it('v2: a download that fails mid-loop leaves metadata that is true for the files on disk', async () => {
    route(() => v2Result(2), files2);
    const res = await caught(executeV2('generate-v4', { prompt: 'a fox', numImages: '2' }, global()));
    expect(res).toBeInstanceOf(ExitSignal);
    const dir = join(work, 'generate-v4');
    const pngs = readdirSync(dir).filter((n) => n.endsWith('.png'));
    expect(pngs).toHaveLength(1);
    const meta = JSON.parse(readFileSync(join(dir, readdirSync(dir).find((n) => n.endsWith('.json'))), 'utf8'));
    expect(meta.generationId).toBe('gen-billed');
    expect(meta.response.itemCount).toBe(2);
    const [first, second] = meta.response.items;
    expect(first.path).toBe(join(dir, pngs[0])); // saved: its path is recorded
    expect(first.url).toBe(`${CDN}/1.png`);
    expect(existsSync(first.path)).toBe(true);
    expect(second.path).toBeUndefined(); // not saved: no path...
    expect(second.url).toBe(`${CDN}/2.png`); // ...but its URL is kept
    expect(second.saved).toBe(false);
  });

  it('async v2: the generation id is printed before polling, whatever --log-level says', async () => {
    route((p) => (p.includes('/generations/') ? { generation_id: 'gen-async', status: 'pending', created: 'x' } : { generation_id: 'gen-async' }));
    await executeAsyncV2(
      'generate-svg',
      { prompt: 'a fox' },
      { apiKey: KEY, outputDir: work, logLevel: 'error' }
    );
    expect(logs).toContain('Generation accepted: gen-async');
  });

  it('v1: a disk failure still leaves every URL on stdout, and a failed first write removes the placeholder', async () => {
    const answer = () => ({ created: '2026-11-22T00:00:00Z', data: [{ url: `${CDN}/1.png`, is_image_safe: true }] });
    route(answer, { [`${CDN}/1.png`]: PNG_A });
    const f = join(work, 'a-file');
    writeFileSync(f, 'x');
    const program = createProgram();
    program.exitOverride();
    const res = await caught(
      program.parseAsync(['node', 'ideogram', '--api-key', KEY, '-o', join(f, 'sub'), '--log-level', 'error', 'generate', '-p', 'fox'])
    );
    expect(res).toBeInstanceOf(ExitSignal);
    expect(logs).toContain(`Result URL 1/1: ${CDN}/1.png`);
    expect(errors.join('\n')).toContain('The result was generated (and billed)');

    errors.length = 0;
    fsControl.failSuffix = '.json';
    fsControl.error = Object.assign(new Error('EIO: i/o error'), { code: 'EIO' });
    const r2 = await runCli('generate', '-p', 'fox');
    expect(r2.exit).toBe(1);
    expect(readdirSync(join(work, 'generate-v3'))).toEqual([]);
    expect(errors.join('\n')).toContain('The result was generated (and billed)');
  });

  it('v1: a download that fails mid-loop leaves metadata with the saved path', async () => {
    const answer = () => ({
      created: '2026-11-22T00:00:00Z',
      data: [
        { url: `${CDN}/1.png`, is_image_safe: true },
        { url: `${CDN}/2.png`, is_image_safe: true },
      ],
    });
    route(answer, files2);
    const res = await runCli('generate', '-p', 'fox', '-n', '2');
    expect(res.exit).toBe(1);
    const dir = join(work, 'generate-v3');
    const pngs = readdirSync(dir).filter((n) => n.endsWith('.png'));
    expect(pngs).toHaveLength(1);
    const meta = JSON.parse(readFileSync(join(dir, readdirSync(dir).find((n) => n.endsWith('.json'))), 'utf8'));
    expect(meta.response.images[0].path).toBe(join(dir, pngs[0]));
    expect(meta.response.images[1].path).toBeUndefined();
    expect(meta.response.images[1].url).toBe(`${CDN}/2.png`);
  });
});

// ---------------------------------------------------------------- 5. dry runs
describe('item 5: a --dry-run answered with a real result is loud, kept and non-zero', () => {
  const quote = {
    object: 'price_quote',
    billing_identifier: 'x',
    quantity: 1,
    usd_micros: 40000,
    credit_millis: 1000,
    qualifier: 'exact',
  };
  const real = { generation_id: 'gen-real', data: [{ object_type: 'image.generation', url: `${CDN}/1.png`, is_image_safe: true }] };

  it('a real quote: "Priced", exit 0', async () => {
    route(() => quote);
    await executeV2('generate-v4', { prompt: 'a fox', dryRun: true }, global());
    expect(stdoutWrites.join('')).toContain('✓ Priced');
    expect(logs.join('\n')).toContain('Price quote');
  });

  it('sync: a real result is not announced as priced, warns that it may be billed, is saved, and exits 1', async () => {
    route(() => real, { [`${CDN}/1.png`]: PNG_A });
    const res = await caught(executeV2('generate-v4', { prompt: 'a fox', dryRun: true }, global()));
    expect(res).toBeInstanceOf(ExitSignal);
    expect(res.code).toBe(1);
    expect(stdoutWrites.join('')).not.toContain('✓ Priced');
    const err = errors.join('\n');
    expect(err).toContain('WARNING');
    expect(err).toContain('may have run and been billed');
    expect(err).toContain('may have been billed'); // the final error line
    expect(readdirSync(join(work, 'generate-v4')).filter((n) => n.endsWith('.png'))).toHaveLength(1); // not discarded
    expect(logs.join('\n')).not.toContain('✓ Done!');
  });

  it('async: an acknowledgement for a dry run warns, prints the id, and exits 1', async () => {
    route(() => ({ generation_id: 'gen-ack' }));
    const res = await caught(executeAsyncV2('generate-svg', { prompt: 'a fox', dryRun: true }, global()));
    expect(res).toBeInstanceOf(ExitSignal);
    expect(res.code).toBe(1);
    expect(stdoutWrites.join('')).not.toContain('✓ Priced');
    expect(errors.join('\n')).toContain('WARNING');
    expect(logs).toContain('Generation accepted: gen-ack');
  });
});

// ---------------------------------------------------------------- 6. possiblyBilled
describe('item 6: IdeogramAPIError.possiblyBilled', () => {
  const production = async (fn) => {
    const before = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      return await fn();
    } finally {
      if (before === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = before;
    }
  };
  const send = (api = newApi()) => caught(api.generateV4({ prompt: 'x' }));
  const bodyThatFails = () =>
    new ReadableStream({
      start(controller) {
        controller.error(new Error('connection reset'));
      },
    });

  it('defaults to false', () => {
    expect(new IdeogramAPIError('x').possiblyBilled).toBe(false);
    expect(new IdeogramAPIError('x', { possiblyBilled: true }).possiblyBilled).toBe(true);
  });

  it('is true when no response arrived, with the production message told apart', async () => {
    fetchMock.mockRejectedValue(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET', message: 'reset' } }));
    const err = await send();
    expect(err).toBeInstanceOf(IdeogramAPIError);
    expect(err.possiblyBilled).toBe(true);
    const prod = await production(send);
    expect(prod.possiblyBilled).toBe(true);
    expect(prod.message).toBe('Request failed. The request may have run and been billed. Check your usage before retrying.');
    expect(prod.message).not.toMatch(/try again/i);
  });

  it('is true for a timeout', async () => {
    fetchMock.mockRejectedValue(Object.assign(new Error('timed out'), { name: 'TimeoutError' }));
    const err = await send();
    expect(err.possiblyBilled).toBe(true);
    expect(err.code).toBe('ETIMEDOUT');
  });

  it('is true when the body cannot be read, is too large, is not JSON, not an object, or not JSON-typed', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }), body: bodyThatFails() });
    expect((await send()).possiblyBilled).toBe(true);

    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json', 'content-length': String(101 * 1024 * 1024) }),
      body: null,
    });
    expect((await send()).possiblyBilled).toBe(true);

    fetchMock.mockReturnValue(Promise.resolve(fakeResponse(200, '{not json')));
    expect((await send()).possiblyBilled).toBe(true);
    fetchMock.mockReturnValue(Promise.resolve(fakeResponse(200, '[1,2]')));
    expect((await send()).possiblyBilled).toBe(true);
    fetchMock.mockReturnValue(Promise.resolve(fakeResponse(200, 'hello', 'text/plain')));
    expect((await send()).possiblyBilled).toBe(true);
  });

  it('a 5xx is possibly billed; its production message says to check usage', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(fakeResponse(503, { error: 'busy' })));
    const err = await send();
    expect(err.status).toBe(503);
    expect(err.possiblyBilled).toBe(true);
    const prod = await production(send);
    expect(prod.message).toBe(
      'Operation failed (HTTP 503). The request may have run and been billed. Check your usage before retrying.'
    );
  });

  it.each([400, 401, 402, 403, 404, 422, 429, 418])('a %i answer is not possibly billed', async (status) => {
    fetchMock.mockImplementation(() => Promise.resolve(fakeResponse(status, { error: 'no' })));
    const err = await send();
    expect(err.status).toBe(status);
    expect(err.possiblyBilled).toBe(false);
  });

  it('an unmapped 4xx keeps the plain production message', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(fakeResponse(418, { error: 'teapot' })));
    const prod = await production(send);
    expect(prod.message).toBe('Operation failed (HTTP 418). Please try again.');
  });

  it('anything thrown before sending is a plain Error, not an IdeogramAPIError that claims billing', async () => {
    const err = await caught(newApi().generateV4({ prompt: 'x', timeoutMs: 0 }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(IdeogramAPIError);
    expect(err.possiblyBilled).toBeUndefined();
  });

  it('a failed status poll (GET) is not billed: false, and the plain connection message in production', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    const err = await caught(newApi().getGeneration('gen-1'));
    expect(err.possiblyBilled).toBe(false);
    const prod = await production(() => caught(newApi().getGeneration('gen-1')));
    expect(prod.message).toBe('Request failed. Please check your connection and try again.');
  });
});

// ---------------------------------------------------------------- 7. waitForGeneration
describe('item 7: waitForGeneration', () => {
  const pending = (id) => ({ generation_id: id, status: 'pending', created: 'x' });

  it('an error while polling carries the generation id (property and message), status and cause', async () => {
    instantSleeps(); // the 500 is retried before it is thrown
    let n = 0;
    fetchMock.mockImplementation(() =>
      Promise.resolve(n++ === 0 ? fakeResponse(200, pending('gen-x')) : fakeResponse(500, { error: 'boom' }))
    );
    const err = await caught(newApi().waitForGeneration('gen-x', { intervalMs: 1 }));
    expect(err).toBeInstanceOf(IdeogramAPIError);
    expect(err.generationId).toBe('gen-x');
    expect(err.message).toContain('gen-x');
    expect(err.message).toContain('API error (500): boom');
    expect(err.status).toBe(500);
    expect(err.cause).toBeInstanceOf(IdeogramAPIError);
  });

  it('a failed generation and a timeout carry the id too', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(fakeResponse(200, { generation_id: 'gen-f', status: 'failed', created: 'x', failure_reason: 'content_policy_violation' }))
    );
    const failed = await caught(newApi().waitForGeneration('gen-f', { intervalMs: 1 }));
    expect(failed.generationId).toBe('gen-f');
    expect(failed.failureReason).toBe('content_policy_violation');

    fetchMock.mockImplementation(() => Promise.resolve(fakeResponse(200, pending('gen-t'))));
    const timedOut = await caught(newApi().waitForGeneration('gen-t', { intervalMs: 5, timeoutMs: 20 }));
    expect(timedOut.generationId).toBe('gen-t');
  });

  it('a 429 still backs off and keeps polling', async () => {
    let n = 0;
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        n++ === 0
          ? fakeResponse(429, { error: 'slow down' })
          : fakeResponse(200, { generation_id: 'g', status: 'completed', created: 'x', data: [] })
      )
    );
    const done = await newApi().waitForGeneration('g', { intervalMs: 1 });
    expect(done.status).toBe('completed');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('a poll never gets more time than is left before the deadline', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(fakeResponse(200, pending('gen-d'))));
    await caught(newApi().waitForGeneration('gen-d', { intervalMs: 2, timeoutMs: 40 }));
    const used = timeoutSpy.mock.calls.map((c) => c[0]);
    expect(used.length).toBeGreaterThan(1);
    for (const ms of used) {
      expect(ms).toBeGreaterThanOrEqual(1);
      expect(ms).toBeLessThanOrEqual(40);
    }
    expect(used[used.length - 1]).toBeLessThan(used[0]); // it shrinks as the deadline nears
  });

  it('with the default 10-minute deadline a poll keeps the 120 s poll timeout', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(fakeResponse(200, { generation_id: 'g', status: 'completed', created: 'x', data: [] }))
    );
    await newApi().waitForGeneration('g');
    expect(timeoutSpy.mock.calls[0][0]).toBe(120000);
  });

  it('getGeneration takes an optional timeoutMs, range-checked', async () => {
    fetchMock.mockResolvedValue(fakeResponse(200, pending('g')));
    await newApi().getGeneration('g', { timeoutMs: 1234 });
    expect(timeoutSpy.mock.calls.at(-1)[0]).toBe(1234);
    expect((await caught(newApi().getGeneration('g', { timeoutMs: 0 }))).message).toMatch(/timeoutMs must be an integer/);
  });

  describe('the CLI prints the resume command after the error line', () => {
    const failing = (status = 500) =>
      fetchMock.mockImplementation(() => Promise.resolve(fakeResponse(status, { error: 'boom' })));

    it('get-generation --wait', async () => {
      instantSleeps();
      failing();
      const res = await caught(executeGetGeneration('gen-x', { wait: true, pollInterval: '1' }, global()));
      expect(res.code).toBe(1);
      const err = errors.join('\n');
      expect(err).toContain('✗ Error:');
      expect(err).toContain('Resume with: ideogram get-generation gen-x --wait');
    });

    it('an id that starts with "-" gets the "--" form', async () => {
      instantSleeps();
      failing();
      await caught(executeGetGeneration('-abc', { wait: true, pollInterval: '1' }, global()));
      expect(errors.join('\n')).toContain('ideogram get-generation --wait -- -abc');
    });

    it('SVG --wait', async () => {
      instantSleeps();
      fetchMock.mockImplementation((url) =>
        Promise.resolve(
          String(url).includes('/generations/')
            ? fakeResponse(500, { error: 'boom' })
            : fakeResponse(200, { generation_id: 'gen-svg' })
        )
      );
      const res = await caught(executeAsyncV2('generate-svg', { prompt: 'p', wait: true, pollInterval: '1' }, global()));
      expect(res.code).toBe(1);
      expect(errors.join('\n')).toContain('ideogram get-generation gen-svg --wait');
    });

    it('a generation that FAILED has nothing to resume: no resume line', async () => {
      fetchMock.mockImplementation(() =>
        Promise.resolve(fakeResponse(200, { generation_id: 'gen-f', status: 'failed', created: 'x', failure_reason: 'bad' }))
      );
      await caught(executeGetGeneration('gen-f', { wait: true, pollInterval: '1' }, global()));
      expect(errors.join('\n')).not.toContain('Resume with');
    });
  });
});

// ---------------------------------------------------------------- 8. wording
describe('item 8: wording', () => {
  it('"image is required" no longer offers a URL or base64 string (ImageInput is a path or a Buffer)', async () => {
    const msgs = [
      (await caught(newApi().upscale({}))).message,
      (await caught(newApi().preciseEditV45({ prompt: 'x' }))).message,
      (await caught(newApi().preciseEditV46({ prompt: 'x' }))).message,
    ];
    for (const m of msgs) {
      expect(m.startsWith('image is required')).toBe(true);
      expect(m).toContain('file path or a Buffer');
      expect(m).not.toMatch(/base64|URL/);
    }
    let cfg;
    try {
      validateV2Params('precise-edit-v45', { prompt: 'x', hasImage: false });
    } catch (e) {
      cfg = e;
    }
    expect(cfg.message).toContain('file path or a Buffer');
    expect(cfg.message).not.toMatch(/base64|URL/);
    try {
      validateV2Params('upscale-auto', { hasImage: false });
    } catch (e) {
      cfg = e;
    }
    expect(cfg.message).toContain('file path or a Buffer');
    expect(cfg.message).not.toMatch(/base64|URL/);
  });

  it('bare errors keep their text as the prefix and add the value and the fix', async () => {
    const first = (await caught(newApi().minimaxH3ImageToVideo({ prompt: 'p' }))).message;
    expect(first.startsWith('image (the first frame) is required')).toBe(true);
    expect(first).toContain('got undefined');
    const seed = (await caught(newApi().seedance25ImageToVideo({ prompt: 'p', image: null }))).message;
    expect(seed).toContain('got null');
    for (const bad of ['', undefined, 5]) {
      const m = (await caught(newApi().getGeneration(bad))).message;
      expect(m.startsWith('generationId is required')).toBe(true);
      expect(m).toContain('generation_id');
    }
    expect((await caught(newApi().getGeneration(5))).message).toContain('number 5');
    const prompt = (() => {
      try {
        validateV2Params('generate-v4', { prompt: 42 });
      } catch (e) {
        return e.message;
      }
    })();
    expect(prompt.startsWith('Prompt is required and must be a string')).toBe(true);
    expect(prompt).toContain('number 42');
    for (const m of [
      (() => { try { validateV2Params('minimax-h3-image-to-video', { prompt: 'p', hasImage: false }); } catch (e) { return e.message; } })(),
      (() => { try { validateV2Params('seedance-2-5-image-to-video', { prompt: 'p', hasImage: false }); } catch (e) { return e.message; } })(),
    ]) {
      expect(m.startsWith('image (the first frame) is required')).toBe(true);
      expect(m).toContain('file path or a Buffer');
    }
  });

  it('a string value is described by length, never echoed', async () => {
    const m = (() => {
      try {
        validateV2Params('generate-v4', { prompt: '' });
      } catch (e) {
        return e.message;
      }
    })();
    expect(m).toContain('an empty string');
  });

  it('mask help says the API may still change pixels outside the mask', () => {
    const program = createProgram();
    const texts = [];
    const walk = (cmd) => {
      cmd.options.forEach((o) => o.long === '--mask' && texts.push(o.description));
      cmd.commands.forEach(walk);
    };
    walk(program);
    const precise = texts.filter((t) => t.includes('black = edit'));
    expect(precise.length).toBeGreaterThan(0);
    for (const t of precise) expect(t).toContain('may still change pixels outside the mask');
  });
});

// ---------------------------------------------------------------- 9. http.ts small
describe('item 9: http.ts', () => {
  it('discardFile treats ENOTDIR (a parent is a file) like ENOENT: nothing to remove, no warning', async () => {
    const f = join(work, 'a-file');
    writeFileSync(f, 'x');
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => logger);
    expect(await discardFile(join(f, 'child.bin'), 'the partial download')).toBe(true);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('the body of the last 3xx is cancelled before "Too many redirects" is thrown', async () => {
    const cancel = vi.fn(async () => {});
    fetchMock.mockResolvedValue({
      ok: false,
      status: 302,
      headers: new Headers({ location: `${CDN}/next` }),
      body: { cancel },
    });
    const err = await caught(
      fetchFollowingRedirects(`${CDN}/a`, { validate: async (u) => u, timeoutMs: 1000, maxRedirects: 0 })
    );
    expect(err.message).toBe('Too many redirects (more than 0)');
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('every swallowed body-cancel is marked AUDIT-OK(no_empty_catch) with a reason', () => {
    for (const file of ['http.ts', 'utils.ts']) {
      const lines = readFileSync(join(ROOT, 'src', file), 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (/\.cancel\(\)\.catch\(\s*\(\)\s*=>/.test(line)) {
          expect(lines[i - 1], `${file}:${i + 1}`).toMatch(/AUDIT-OK\(no_empty_catch\): \S/);
        }
      });
    }
  });

  it('partialFile is tagged with Reflect.set, not a try/catch', () => {
    const text = readFileSync(join(ROOT, 'src', 'http.ts'), 'utf8');
    expect(text).toContain("Reflect.set(error, 'partialFile', outputPath)");
  });
});
