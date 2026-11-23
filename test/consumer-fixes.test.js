/**
 * Consumer-validate fixes (tracker run #16): resumable vs possiblyBilled on
 * polling errors, the resume hint, get-generation exit codes, library logging
 * defaults, CLI missing-file messages, v2 validator and error wording.
 * Each test fails against 36d4bb9.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

vi.mock('dns/promises', () => ({
  lookup: vi.fn(async () => ({ address: '8.8.8.8', family: 4 })),
}));

import { fetchMock, fakeResponse, resetHttp, instantSleeps } from './helpers/http.js';
import { IdeogramAPI, IdeogramAPIError, BILLING_NOTE } from '../src/api.js';
import { setLogLevel } from '../src/utils.js';
import { logger as moduleLogger } from '../src/logger.js';
import { writeFileSync } from 'fs';
import { validateV2Params } from '../src/config.js';
import { executeV2, executeGetGeneration, reportCommandError } from '../src/cli-v2.js';
import { createProgram } from '../src/program.js';

const KEY = 'test-key-1234567890';

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
const err = () => errors.join('\n');
const out = () => logs.join('\n');
const global = () => ({ apiKey: KEY, outputDir: join(work, 'out'), logLevel: 'error' });

beforeEach(() => {
  resetHttp();
  work = mkdtempSync(join(tmpdir(), 'ideogram-consumer-'));
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
  rmSync(work, { recursive: true, force: true });
});

const wait = (api, id = 'gen1') => api.waitForGeneration(id, { intervalMs: 1 }).catch((e) => e);

// ------------------------------------------------------------------ 1. resumable
describe('item 1: resumable', () => {
  const api = () => new IdeogramAPI(KEY, undefined, 'error');

  it('404 is not resumable, names the id, and says it may have been billed', async () => {
    fetchMock.mockResolvedValue(fakeResponse(404, { error: 'no such generation' }));
    const e = await wait(api());
    expect(e).toBeInstanceOf(IdeogramAPIError);
    expect(e.resumable).toBe(false);
    expect(e.possiblyBilled).toBe(true);
    expect(e.generationId).toBe('gen1');
    expect(e.status).toBe(404);
    expect(e.message).toBe('Generation gen1 not found: check the id (if you submitted it, it may still have been billed)');
  });

  it.each([400, 422])('%i is not resumable', async (status) => {
    fetchMock.mockResolvedValue(fakeResponse(status, { error: 'bad' }));
    const e = await wait(api());
    expect(e.resumable).toBe(false);
    expect(e.possiblyBilled).toBe(true);
    expect(e.generationId).toBe('gen1');
    expect(e.message).toContain('polling again will not succeed');
  });

  it.each([401, 403])('%i is not resumable (same client, rejected key), and the message says to fix the key', async (status) => {
    fetchMock.mockResolvedValue(fakeResponse(status, { message: 'nope' }));
    const e = await wait(api());
    expect(e.resumable).toBe(false);
    expect(e.possiblyBilled).toBe(true);
    expect(e.message).toContain('fix the key, then resume with get-generation');
  });

  it('a 5xx is resumable', async () => {
    instantSleeps(); // a 5xx is retried before it is thrown
    fetchMock.mockResolvedValue(fakeResponse(503, { error: 'down' }));
    const e = await wait(api());
    expect(e.resumable).toBe(true);
    expect(e.possiblyBilled).toBe(true);
  });

  it('a network failure with no response is resumable', async () => {
    instantSleeps(); // no response is retried before it is thrown
    fetchMock.mockRejectedValue(Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNRESET' } }));
    const e = await wait(api());
    expect(e.status).toBeUndefined();
    expect(e.resumable).toBe(true);
  });

  it('the wait deadline and a throwing onPoll are resumable', async () => {
    fetchMock.mockResolvedValue(fakeResponse(200, { generation_id: 'gen1', status: 'pending', created: 't' }));
    const timedOut = await api().waitForGeneration('gen1', { intervalMs: 5, timeoutMs: 20 }).catch((e) => e);
    expect(timedOut.resumable).toBe(true);
    const boom = await api()
      .waitForGeneration('gen1', {
        intervalMs: 1,
        onPoll: () => {
          throw new Error('x');
        },
      })
      .catch((e) => e);
    expect(boom.resumable).toBe(true);
  });

  it('a generation that failed is not resumable', async () => {
    fetchMock.mockResolvedValue(fakeResponse(200, { generation_id: 'gen1', status: 'failed', failure_reason: 'policy' }));
    const e = await wait(api());
    expect(e.generationStatus).toBe('failed');
    expect(e.resumable).toBe(false);
  });

  it('resumable defaults to false on a plain error', () => {
    expect(new IdeogramAPIError('x').resumable).toBe(false);
  });

  it('the CLI prints the resume hint only for a resumable error (field, not inference)', () => {
    reportCommandError(new IdeogramAPIError('Not found', { generationId: 'g1', possiblyBilled: true, resumable: false, status: 404 }));
    expect(err()).not.toContain('Resume with');
    // A 404 for a polled id: this call never saw it submitted, so no billing line (release-fixes item 2a).
    expect(err()).not.toContain(BILLING_NOTE);
    errors.length = 0;
    reportCommandError(new IdeogramAPIError('5xx', { generationId: 'g1', possiblyBilled: true, resumable: true, status: 503 }));
    expect(err()).toContain('Resume with: ideogram get-generation g1 --wait');
    errors.length = 0;
    // A resumable error with no failureReason/generationStatus used to be the only trigger; now the field alone decides.
    reportCommandError(new IdeogramAPIError('x', { generationId: 'g1', resumable: false }));
    expect(err()).not.toContain('Resume with');
  });

  it('401/403 get "fix the API key, then resume with"', () => {
    reportCommandError(new IdeogramAPIError('Authentication failed.', { generationId: 'g1', possiblyBilled: true, resumable: true, status: 401 }));
    expect(err()).toContain('Fix the API key, then resume with: ideogram get-generation g1 --wait');
  });

  it('the billing note is deduplicated structurally: only a message that ENDS with it suppresses the line', () => {
    reportCommandError(new IdeogramAPIError(`API error (502): x ${BILLING_NOTE}`, { possiblyBilled: true }));
    expect(err().split(BILLING_NOTE).length - 1).toBe(1);
    errors.length = 0;
    reportCommandError(new IdeogramAPIError(`${BILLING_NOTE} but then something else`, { possiblyBilled: true }));
    expect(err().split(BILLING_NOTE).length - 1).toBe(2);
  });

  it('the api and the CLI share the one note text', async () => {
    fetchMock.mockResolvedValue(fakeResponse(502, 'Bad Gateway', 'text/plain'));
    const e = await api().generateV4({ prompt: 'x' }).catch((x) => x);
    expect(e.message.endsWith(BILLING_NOTE)).toBe(true);
  });
});

// ------------------------------------------------------------------ 3. get-generation exit
describe('item 3: get-generation exit codes', () => {
  it('a failed generation without --wait prints the reason and exits 1', async () => {
    fetchMock.mockResolvedValue(
      fakeResponse(200, { generation_id: 'gf', status: 'failed', created: 't', failure_reason: 'content policy' })
    );
    const e = await executeGetGeneration('gf', {}, global()).catch((x) => x);
    expect(e.code).toBe(1);
    expect(out()).toContain('Failure reason: content policy');
  });

  it('a pending generation without --wait still exits 0', async () => {
    fetchMock.mockResolvedValue(fakeResponse(200, { generation_id: 'gp', status: 'pending', created: 't' }));
    await expect(executeGetGeneration('gp', {}, global())).resolves.toBeUndefined();
    expect(out()).toContain('Still running');
  });
});

// ------------------------------------------------------------------ 4. logging
describe('item 4: library logging defaults', () => {
  it('a new client and the module logger default to warn', async () => {
    // Fresh module instances: earlier tests in this file set the shared module logger.
    vi.resetModules();
    const fresh = await import('../src/logger.js');
    const freshApi = await import('../src/api.js');
    expect(fresh.logger.level).toBe('warn');
    expect(new freshApi.IdeogramAPI(KEY).logger.level).toBe('warn');
  });

  it('every level goes to stderr', () => {
    for (const lg of [new IdeogramAPI(KEY).logger, moduleLogger]) {
      const t = lg.transports[0];
      for (const level of ['error', 'warn', 'info', 'debug']) expect(t.stderrLevels[level]).toBe(true);
    }
  });

  it('utils setLogLevel sets the default of clients created afterwards; an explicit level still wins', () => {
    try {
      setLogLevel('debug');
      expect(new IdeogramAPI(KEY).logger.level).toBe('debug');
      expect(new IdeogramAPI(KEY, undefined, 'error').logger.level).toBe('error');
    } finally {
      setLogLevel('warn');
    }
  });

  it('the CLI still passes --log-level to its client (default info)', async () => {
    const program = createProgram();
    expect(program.options.find((o) => o.long === '--log-level').defaultValue).toBe('info');
  });
});

// ------------------------------------------------------------------ 5. missing files
describe('item 5: CLI missing input files use the library message', () => {
  const run = async (...args) => {
    const program = createProgram();
    const walk = (c) => {
      c.exitOverride();
      c.configureOutput({ writeOut: (s) => logs.push(s), writeErr: (s) => errors.push(s) });
      c.commands.forEach(walk);
    };
    walk(program);
    try {
      await program.parseAsync(['node', 'ideogram', '--api-key', KEY, '-o', join(work, 'out'), '--log-level', 'error', ...args]);
      return {};
    } catch (e) {
      if (e instanceof ExitSignal) return { exit: e.code };
      throw e;
    }
  };

  it('upscale', async () => {
    const res = await run('upscale', '-i', './nope.png');
    expect(res.exit).toBe(1);
    expect(err()).toContain('Image file not found: ./nope.png');
    expect(err()).not.toContain('ENOENT');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('precise-edit and video first frame', async () => {
    expect((await run('precise-edit', '-p', 'x', '-i', './nope.png')).exit).toBe(1);
    expect(err()).toContain('Image file not found: ./nope.png');
    errors.length = 0;
    expect((await run('minimax-image-to-video', '-p', 'x', '-i', './nope2.png')).exit).toBe(1);
    expect(err()).toContain('Image file not found: ./nope2.png');
    expect(err()).not.toContain('ENOENT');
  });

  it('a missing reference audio says Audio file not found', async () => {
    const img = join(work, 'ref.png');
    writeFileSync(img, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const res = await run('minimax-reference-to-video', '-p', 'x', '--reference-images', img, '--reference-audios', './nope.mp3');
    expect(res.exit).toBe(1);
    expect(err()).toContain('Audio file not found: ./nope.mp3');
  });
});

// ------------------------------------------------------------------ 6/7. small items
describe('items 6-7: help text, validator, wording, records', () => {
  const help = (name) => createProgram().commands.find((c) => c.name() === name);
  const durationHelp = (name) => help(name).options.find((o) => o.long === '--duration').description;

  it('--duration help states the maximum-price rule for image and reference to video', () => {
    expect(durationHelp('seedance-image-to-video')).toMatch(/priced at the maximum/);
    expect(durationHelp('seedance-reference-to-video')).toMatch(/--dry-run/);
    expect(durationHelp('seedance-text-to-video')).toMatch(/omit to let the model pick/);
  });

  it('an unknown v2 operation is named, with the valid list, before any prompt check', () => {
    expect(() => validateV2Params('generate-v99', {})).toThrow(/Unknown v2 operation 'generate-v99'\. Valid: generate-v4,/);
    expect(() => validateV2Params('generate-v99', {})).not.toThrow(/Prompt is required/);
  });

  it('a 402 without a body message reads HTTP 402, with the body message when present', async () => {
    const api = new IdeogramAPI(KEY, undefined, 'error');
    fetchMock.mockResolvedValue(fakeResponse(402, 'nope', 'text/plain'));
    let e = await api.generateV4({ prompt: 'x' }).catch((x) => x);
    expect(e.message).toBe('Payment required: HTTP 402');
    expect(e.message).not.toContain('status code');
    fetchMock.mockResolvedValue(fakeResponse(402, { error: 'out of credit' }));
    e = await api.generateV4({ prompt: 'x' }).catch((x) => x);
    expect(e.message).toBe('Payment required: out of credit');
  });

  it('a 5xx without a body message says HTTP 503 once', async () => {
    const api = new IdeogramAPI(KEY, undefined, 'error');
    fetchMock.mockResolvedValue(fakeResponse(503, 'x', 'text/plain'));
    const e = await api.generateV4({ prompt: 'x' }).catch((x) => x);
    expect(e.message).toBe(`API error (HTTP 503). ${BILLING_NOTE}`);
  });

  it('"Download failed after N/M" counts only saved items, not skipped ones', async () => {
    fetchMock.mockImplementation(async (url) => {
      if (new URL(url).host === 'api.ideogram.ai') {
        return fakeResponse(200, {
          created: 't',
          data: [{ is_image_safe: false, resolution: '1x1' }, { url: 'https://cdn.ideogram.ai/a.png', is_image_safe: true }],
        });
      }
      throw new Error('download down');
    });
    await executeV2('generate-v46', { prompt: 'p' }, global()).catch(() => undefined);
    expect(err()).toContain('Download failed after 0/2 item(s) saved.');
  });
});
