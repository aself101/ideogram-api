/**
 * Final pre-merge fixes (2.0.0): excess CLI arguments, NAT64/6to4 unwrapping,
 * the billing note on possibly-billed errors, a failed final metadata write, a
 * dry run answered with something that is neither a quote nor a generation,
 * and the small items beside them. Each test fails against 8610e82.
 * Same harness as billing-contract.test.js: fetch stubbed, DNS mocked, fs
 * rename failable, console captured.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

vi.mock('dns/promises', () => ({
  lookup: vi.fn(async () => ({ address: '8.8.8.8', family: 4 })),
}));
import { lookup } from 'dns/promises';

// Only the .json renames can be made to fail, from the Nth one on: the first is the
// metadata placeholder write, the last is the rewrite after the files were saved.
const fsControl = vi.hoisted(() => ({ failJsonRenameFrom: 0, jsonRenames: 0 }));
vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal();
  const rename = async (from, to, ...rest) => {
    if (fsControl.failJsonRenameFrom && String(to).endsWith('.json')) {
      fsControl.jsonRenames += 1;
      if (fsControl.jsonRenames >= fsControl.failJsonRenameFrom) {
        throw Object.assign(new Error('EIO: rename failed'), { code: 'EIO' });
      }
    }
    return actual.rename(from, to, ...rest);
  };
  return { ...actual, default: { ...actual.default, rename } };
});

import { fetchMock, fakeResponse, resetHttp } from './helpers/http.js';
import { IdeogramAPI, IdeogramAPIError } from '../src/api.js';
import { validateImageUrl, detectImageType } from '../src/utils.js';
import { executeV2, executeGetGeneration, reportCommandError, getGenerationCommand } from '../src/cli-v2.js';
import { createProgram } from '../src/program.js';

const KEY = 'test-key-1234567890';
const CDN = 'https://cdn.ideogram.ai';
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 1, 1, 1]);
const SQUARE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);
const BILLED = 'may have run and been billed. Check your usage before retrying.';

class ExitSignal extends Error {
  constructor(code) {
    super(`process.exit(${code})`);
    this.code = code;
  }
}

let work;
let outDir;
let logs;
let errors;
let spies = [];
const out = () => logs.join('\n');
const err = () => errors.join('\n');
const global = () => ({ apiKey: KEY, outputDir: outDir, logLevel: 'error' });
const apiCalls = () => fetchMock.mock.calls.filter(([u]) => new URL(u).host === 'api.ideogram.ai');

beforeEach(() => {
  resetHttp();
  fsControl.failJsonRenameFrom = 0;
  fsControl.jsonRenames = 0;
  lookup.mockReset();
  lookup.mockResolvedValue({ address: '8.8.8.8', family: 4 });
  work = mkdtempSync(join(tmpdir(), 'ideogram-final-'));
  outDir = join(work, 'out');
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
  fsControl.failJsonRenameFrom = 0;
});

function withExitOverride(cmd) {
  cmd.exitOverride();
  cmd.configureOutput({ writeOut: (s) => logs.push(s), writeErr: (s) => errors.push(s) });
  cmd.commands.forEach(withExitOverride);
  return cmd;
}

/** Run the real program; resolve to { exit } for process.exit, { error } for a commander error. */
async function run(...args) {
  const program = withExitOverride(createProgram());
  try {
    await program.parseAsync(['node', 'ideogram', '--api-key', KEY, '-o', outDir, '--log-level', 'error', ...args]);
    return {};
  } catch (e) {
    if (e instanceof ExitSignal) return { exit: e.code };
    if (e?.name === 'CommanderError') return { error: e };
    throw e;
  }
}

/** API calls answer `body` (or fake responses via `status`); downloads answer from `files`. */
function route(body, files = {}, status = 200) {
  fetchMock.mockImplementation(async (url) => {
    const u = new URL(url);
    if (u.host === 'api.ideogram.ai') return fakeResponse(status, body);
    if (!(url in files)) throw new Error(`unexpected download: ${url}`);
    return new Response(files[url]);
  });
}

// ------------------------------------------------------------------ 1. excess arguments
describe('item 1: excess CLI arguments are rejected', () => {
  it('a v2 command with an unquoted prompt exits with commander\'s error and sends nothing', async () => {
    route({ generation_id: 'g' });
    const res = await run('generate-v46', '-p', 'A', 'fox', 'runs');
    expect(res.error?.code).toBe('commander.excessArguments');
    expect(err()).toContain('too many arguments');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('get-generation with an extra argument is rejected and sends nothing', async () => {
    route({ generation_id: 'g', status: 'pending' });
    const res = await run('get-generation', 'gen1', 'extra');
    expect(res.error?.code).toBe('commander.excessArguments');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('control: the same command with its prompt quoted is accepted', async () => {
    route({ generation_id: 'g' });
    const res = await run('generate-v46', '-p', 'A fox runs', '--async');
    expect(res.error).toBeUndefined();
    expect(apiCalls()).toHaveLength(1);
  });

  it('every registered command rejects excess arguments (root setting reached each one)', () => {
    const program = createProgram();
    expect(program.commands.length).toBeGreaterThan(20);
    // _allowExcessArguments is commander 11's private field; no public getter exists.
    const lax = program.commands.filter((c) => c._allowExcessArguments !== false).map((c) => c.name());
    expect(lax).toEqual([]);
  });
});

describe('item 1: the variadic v1 generate prompt', () => {
  it('refuses several single-word prompts as a likely unquoted prompt, sending nothing', async () => {
    route({ created: 'x', data: [] });
    const res = await run('generate', '-p', 'a', 'red', 'fox');
    expect(res.exit).toBe(1);
    expect(err()).toContain('looks like an unquoted prompt; quote it, or pass --allow-single-word-prompts');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('--allow-single-word-prompts lifts the guard', async () => {
    route({ created: 'x', data: [] });
    await run('generate', '-p', 'a', 'red', '--allow-single-word-prompts');
    expect(err()).not.toContain('unquoted prompt');
    expect(apiCalls().length).toBeGreaterThan(0);
  });

  it('several quoted multi-word prompts, and one single-word prompt, are not guarded', async () => {
    route({ created: 'x', data: [] });
    await run('generate', '-p', 'a red fox', 'a blue owl');
    expect(err()).not.toContain('unquoted prompt');
    expect(apiCalls().length).toBeGreaterThan(0);
    fetchMock.mockClear();
    await run('generate', '-p', 'fox');
    expect(err()).not.toContain('unquoted prompt');
    expect(apiCalls().length).toBeGreaterThan(0);
  });
});

// ------------------------------------------------------------------ 2. NAT64 / 6to4
describe('item 2: NAT64 and 6to4 are judged by the IPv4 they embed', () => {
  for (const host of ['[64:ff9b::808:808]', '[2002:808:808::]']) {
    it(`${host} (public IPv4 inside) is allowed`, async () => {
      await expect(validateImageUrl(`https://${host}/a.png`)).resolves.toContain(host);
    });
  }
  for (const host of [
    '[64:ff9b::7f00:1]', // 127.0.0.1
    '[64:ff9b::a9fe:a9fe]', // 169.254.169.254
    '[64:ff9b::a00:1]', // 10.0.0.1
    '[64:ff9b::1]', // 0.0.0.1
    '[2002:7f00:1::]', // 127.0.0.1
    '[2002:a9fe:a9fe::1]', // 169.254.169.254
    '[64:ff9b:1::1]', // local-use NAT64
    '[64:ff9b:1::808:808]', // local-use NAT64 around a public IPv4
  ]) {
    it(`${host} is blocked`, async () => {
      await expect(validateImageUrl(`https://${host}/a.png`)).rejects.toThrow(/not allowed/);
    });
  }

  it('a name that resolves to a synthesized public address is allowed, to a synthesized private one refused', async () => {
    lookup.mockResolvedValue([{ address: '64:ff9b::808:808', family: 6 }]);
    await expect(validateImageUrl('https://cdn.example.com/a.png')).resolves.toBeTruthy();
    lookup.mockResolvedValue([
      { address: '64:ff9b::808:808', family: 6 },
      { address: '64:ff9b::7f00:1', family: 6 },
    ]);
    await expect(validateImageUrl('https://cdn.example.com/a.png')).rejects.toThrow();
  });
});

// ------------------------------------------------------------------ 3. billing note
describe('item 3: possibly-billed errors say so', () => {
  it('v2 CLI on a POST 502 prints the billing line and exits 1', async () => {
    route({ error: 'bad gateway' }, {}, 502);
    const res = await run('generate-v46', '-p', 'a fox');
    expect(res.exit).toBe(1);
    expect(err()).toContain(BILLED);
  });

  it('v1 CLI on a POST 502 prints the billing line and exits 1', async () => {
    route({ message: 'bad gateway' }, {}, 502);
    const res = await run('generate', '-p', 'a fox');
    expect(res.exit).toBe(1);
    expect(err()).toContain(BILLED);
  });

  it('a 400 does not print it', async () => {
    route({ error: 'bad prompt' }, {}, 400);
    const res = await run('generate-v46', '-p', 'a fox');
    expect(res.exit).toBe(1);
    expect(err()).toContain('bad prompt');
    expect(err()).not.toContain('billed');
  });

  it('the reporter adds the line for a possiblyBilled error whose message lacks it, once', () => {
    reportCommandError(new IdeogramAPIError('Request failed (ECONNRESET)', { possiblyBilled: true }));
    expect(err()).toContain(`This request ${BILLED}`);
    errors.length = 0;
    reportCommandError(new IdeogramAPIError(`API error (502): x The request ${BILLED}`, { possiblyBilled: true }));
    expect(err().split('billed').length - 1).toBe(1);
  });

  it('the reporter prints nothing about billing when possiblyBilled is false', () => {
    reportCommandError(new IdeogramAPIError('Invalid input: x', { status: 400 }));
    expect(err()).not.toContain('billed');
  });

  it('with a generationId the resume hint replaces the retry advice', () => {
    reportCommandError(new IdeogramAPIError('Timed out', { generationId: 'gen1', possiblyBilled: true }));
    expect(err()).toContain('Resume with: ideogram get-generation gen1 --wait');
    expect(err()).not.toContain('Check your usage before retrying');
  });

  it('a non-production 5xx on a POST carries the note in its message; a GET 5xx does not', async () => {
    const api = new IdeogramAPI(KEY, undefined, 'error');
    fetchMock.mockResolvedValue(fakeResponse(503, { error: 'down' }));
    const post = await api.generateV4({ prompt: 'x' }).catch((e) => e);
    expect(post.message).toContain(BILLED);
    const get = await api.getGeneration('gen1').catch((e) => e);
    expect(get.status).toBe(503);
    expect(get.possiblyBilled).toBe(false);
    expect(get.message).not.toContain('billed');
  });
});

// ------------------------------------------------------------------ 4. final metadata write
describe('item 4: every file saved, only the final metadata rewrite fails', () => {
  const files = { [`${CDN}/a.png`]: PNG };

  it('v2: says so, lists the paths, says not to retry, exits 1', async () => {
    route({ generation_id: 'g1', data: [{ url: `${CDN}/a.png`, resolution: '1x1', seed: 1, is_image_safe: true }] }, files);
    fsControl.failJsonRenameFrom = 2;
    const res = await executeV2('generate-v46', { prompt: 'a fox' }, global()).catch((e) => e);
    expect(res).toBeInstanceOf(ExitSignal);
    expect(res.code).toBe(1);
    const dir = join(outDir, 'generate-v46');
    const png = readdirSync(dir).find((n) => n.endsWith('.png'));
    expect(err()).toContain(join(dir, png));
    expect(err()).toContain('every file was saved');
    expect(err()).toContain('Do not retry: nothing was lost.');
    expect(err()).toContain('still holds the earlier record');
    // the earlier record is on disk and names the generation
    const meta = JSON.parse(readFileSync(join(dir, readdirSync(dir).find((n) => n.endsWith('.json'))), 'utf8'));
    expect(meta.generationId).toBe('g1');
  });

  it('v1: says so, lists the paths, says not to retry, exits 1', async () => {
    route({ created: '2026-11-22T00:00:00Z', data: [{ url: `${CDN}/a.png`, resolution: '1x1', seed: 1, is_image_safe: true }] }, files);
    fsControl.failJsonRenameFrom = 2;
    const res = await run('generate', '-p', 'a fox');
    expect(res.exit).toBe(1);
    const dir = join(outDir, 'generate-v3');
    const png = readdirSync(dir).find((n) => n.endsWith('.png'));
    expect(err()).toContain(join(dir, png));
    expect(err()).toContain('Do not retry: nothing was lost.');
    expect(err()).toContain('still holds the earlier record');
  });
});

// ------------------------------------------------------------------ 5. dry run answered with neither data nor id
describe('item 5: a dry run answered with neither data nor a generation_id', () => {
  const odd = { object: 'price_estimate', usd_micros: 30000 };

  it('sync v2: writes the raw result, prints its path and the warning, exits 1, no TypeError', async () => {
    route(odd);
    const res = await executeV2('generate-v46', { prompt: 'a fox', dryRun: true }, global()).catch((e) => e);
    expect(res).toBeInstanceOf(ExitSignal);
    expect(res.code).toBe(1);
    expect(err()).toContain('WARNING');
    expect(err()).toContain('The raw response is saved below');
    expect(err()).not.toContain('generation id is listed below');
    expect(err()).not.toContain('TypeError');
    expect(err()).not.toContain('startsWith');
    const dir = join(outDir, 'generate-v46');
    const json = readdirSync(dir).find((n) => n.endsWith('.json'));
    expect(err()).toContain(join(dir, json));
    expect(JSON.parse(readFileSync(join(dir, json), 'utf8')).response).toEqual(odd);
  });

  it('async v2 command (svg): same', async () => {
    route(odd);
    const res = await run('generate-svg', '-p', 'a fox', '--dry-run');
    expect(res.exit).toBe(1);
    expect(err()).toContain('The raw response is saved below');
    expect(err()).not.toContain('generation id is listed below');
    expect(err()).not.toContain('TypeError');
    const dir = join(outDir, 'generate-svg');
    expect(existsSync(dir)).toBe(true);
    const json = readdirSync(dir).find((n) => n.endsWith('.json'));
    expect(JSON.parse(readFileSync(join(dir, json), 'utf8')).response).toEqual(odd);
  });

  it('getGenerationCommand never throws on a non-string', () => {
    expect(() => getGenerationCommand(undefined)).not.toThrow();
    expect(getGenerationCommand(undefined)).toContain('<generation-id>');
  });
});

// ------------------------------------------------------------------ 6. small items
describe('item 6: failed generation, onPoll, describe, dry-run help, detectImageType', () => {
  it('a failed generation without failure_reason carries generationStatus and gets no resume hint', async () => {
    const api = new IdeogramAPI(KEY, undefined, 'error');
    fetchMock.mockResolvedValue(fakeResponse(200, { generation_id: 'gen1', status: 'failed' }));
    const e = await api.waitForGeneration('gen1', { intervalMs: 1 }).catch((x) => x);
    expect(e.generationStatus).toBe('failed');
    expect(e.failureReason).toBeUndefined();
    reportCommandError(e);
    expect(err()).not.toContain('Resume with');
    expect(err()).not.toContain('may still complete');
  });

  it('get-generation --wait on such a generation prints no resume hint and exits 1', async () => {
    fetchMock.mockResolvedValue(fakeResponse(200, { generation_id: 'gen1', status: 'failed' }));
    const res = await executeGetGeneration('gen1', { wait: true, pollInterval: '1' }, global()).catch((x) => x);
    expect(res.code).toBe(1);
    expect(err()).not.toContain('Resume with');
  });

  it('control: a poll that failed (no status) still gets the resume hint', () => {
    reportCommandError(new IdeogramAPIError('poll failed', { generationId: 'gen1', possiblyBilled: true }));
    expect(err()).toContain('Resume with');
  });

  it('an onPoll that throws is rethrown with the generationId, possiblyBilled and the cause', async () => {
    const api = new IdeogramAPI(KEY, undefined, 'error');
    fetchMock.mockResolvedValue(fakeResponse(200, { generation_id: 'gen1', status: 'pending' }));
    const boom = new Error('callback exploded');
    const e = await api
      .waitForGeneration('gen1', {
        intervalMs: 1,
        onPoll: () => {
          throw boom;
        },
      })
      .catch((x) => x);
    expect(e).toBeInstanceOf(IdeogramAPIError);
    expect(e.generationId).toBe('gen1');
    expect(e.possiblyBilled).toBe(true);
    expect(e.cause).toBe(boom);
  });

  it('describe removes its claimed placeholder when the metadata write fails', async () => {
    const img = join(work, 'in.png');
    writeFileSync(img, SQUARE_PNG);
    route({ descriptions: [{ text: 'a fox' }] });
    fsControl.failJsonRenameFrom = 1;
    const res = await run('describe', '-i', img);
    expect(res.exit).toBe(1);
    const dir = join(outDir, 'describe');
    expect(existsSync(dir) ? readdirSync(dir) : []).toEqual([]);
  });

  it('--dry-run help no longer claims "without ... billing" and never says it validates', () => {
    const program = createProgram();
    const help = program.commands.find((c) => c.name() === 'generate-custom').helpInformation();
    expect(help).toContain('Price the request without running it');
    expect(help).not.toContain('billing it');
  });

  it('detectImageType recognises an exactly-4-byte PNG signature and not a 3-byte prefix', () => {
    expect(detectImageType(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toEqual({ extension: 'png', mimeType: 'image/png' });
    expect(detectImageType(Buffer.from([0x89, 0x50, 0x4e]))).toBeNull();
  });
});
