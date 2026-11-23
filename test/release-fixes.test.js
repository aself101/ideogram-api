/**
 * Pre-release fixes after ship run #19 / consumer-validate #18: the resume
 * classification, billing wording on polling, server-text sanitization,
 * log level / spinner / URL logging, small code fixes, and boundary tests for
 * mutants the earlier suites missed. Each behaviour test fails against 9e3b961.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import fsp from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

vi.mock('dns/promises', () => ({
  lookup: vi.fn(async () => ({ address: '8.8.8.8', family: 4 })),
}));

import { fetchMock, fakeResponse, resetHttp, instantSleeps } from './helpers/http.js';
import { IdeogramAPI, IdeogramAPIError, BILLING_NOTE, classifyPollFailure } from '../src/api.js';
import { sanitizeServerText } from '../src/http.js';
import { normalizeLogLevel, logger as moduleLogger } from '../src/logger.js';
import { validateImageUrl, setLogLevel, downloadImageAsBuffer } from '../src/utils.js';
import { createSpinner } from '../src/cli-io.js';
import { V2_OPERATION_KEYS } from '../src/config.js';
import {
  executeV2,
  executeGetGeneration,
  reportCommandError,
  getGenerationCommand,
  shouldAppendBillingNote,
} from '../src/cli-v2.js';
import { createProgram } from '../src/program.js';

const KEY = 'test-key-1234567890';
const MB = 1024 * 1024;

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
const api = () => new IdeogramAPI(KEY, undefined, 'error');
const wait = (a, id = 'gen1') => a.waitForGeneration(id, { intervalMs: 1 }).catch((e) => e);
const CONTROL = /[\u0000-\u0008\u000a-\u001f\u007f-\u009f]/;

beforeEach(() => {
  resetHttp();
  work = mkdtempSync(join(tmpdir(), 'ideogram-release-'));
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

async function run(...args) {
  const program = createProgram();
  const apply = (c) => {
    c.exitOverride();
    c.configureOutput({ writeOut: (s) => logs.push(s), writeErr: (s) => errors.push(s) });
    c.commands.forEach(apply);
  };
  apply(program);
  try {
    await program.parseAsync(['node', 'ideogram', '--api-key', KEY, '-o', work, ...args]);
    return {};
  } catch (e) {
    if (e instanceof ExitSignal) return { exit: e.code };
    if (e?.name === 'CommanderError') return { error: e };
    throw e;
  }
}

// ------------------------------------------------------------------ 1. resume classification
describe('item 1: classifyPollFailure and the resumable rule', () => {
  it.each([400, 401, 403, 404, 410, 422])('HTTP %i is not resumable', (status) => {
    expect(classifyPollFailure({ status })).toEqual({ resumable: false });
  });
  it.each([402, 408, 425, 429, 500, 502, 503, 418])('HTTP %i is resumable', (status) => {
    expect(classifyPollFailure({ status })).toEqual({ resumable: true });
  });
  it('no response is resumable; a too-large response and a failed generation are not', () => {
    expect(classifyPollFailure({})).toEqual({ resumable: true });
    expect(classifyPollFailure({ code: 'ETIMEDOUT' })).toEqual({ resumable: true });
    expect(classifyPollFailure({ status: 200, code: 'ERESPONSETOOLARGE' })).toEqual({ resumable: false });
    expect(classifyPollFailure({ generationStatus: 'failed' })).toEqual({ resumable: false });
  });

  it.each([
    [408, true],
    [425, true],
    [402, true],
    [503, true],
    [400, false],
    [404, false],
    [410, false],
    [422, false],
    [401, false],
    [403, false],
  ])('waitForGeneration after HTTP %i: resumable %s', async (status, resumable) => {
    instantSleeps(); // 408, 425 and 503 are retried before they are thrown
    fetchMock.mockResolvedValue(fakeResponse(status, { error: 'x', message: 'x' }));
    const e = await wait(api());
    expect(e).toBeInstanceOf(IdeogramAPIError);
    expect(e.status).toBe(status);
    expect(e.resumable).toBe(resumable);
    expect(e.generationId).toBe('gen1');
  });

  it('an over-size poll response is not resumable', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json', 'content-length': String(101 * MB) }),
      body: null,
    });
    const e = await wait(api());
    expect(e.code).toBe('ERESPONSETOOLARGE');
    expect(e.resumable).toBe(false);
  });

  it('a failed generation is not resumable', async () => {
    fetchMock.mockResolvedValue(fakeResponse(200, { generation_id: 'gen1', status: 'failed', failure_reason: 'policy' }));
    expect((await wait(api())).resumable).toBe(false);
  });

  it('401/403 keep the "fix the key, then resume with get-generation" message', async () => {
    fetchMock.mockResolvedValue(fakeResponse(401, { message: 'nope' }));
    expect((await wait(api())).message).toContain('fix the key, then resume with get-generation');
  });

  const hint = (e) => {
    errors.length = 0;
    reportCommandError(e);
    return err();
  };
  it.each([401, 403])('the CLI prints the key hint for %i, from the status, whatever resumable says', (status) => {
    const text = hint(new IdeogramAPIError('Authentication failed.', { generationId: 'g1', status, resumable: false, possiblyBilled: true }));
    expect(text).toContain('Fix the API key, then resume with: ideogram get-generation g1 --wait');
  });
  it('the CLI prints the plain resume hint for a 408', () => {
    const text = hint(new IdeogramAPIError('Request Timeout', { generationId: 'g1', status: 408, resumable: true, possiblyBilled: true }));
    expect(text).toContain('Resume with: ideogram get-generation g1 --wait');
    expect(text).not.toContain('Fix the API key');
  });
  it('an empty generationId gets no resume hint (the billing line instead)', () => {
    const text = hint(new IdeogramAPIError('x', { generationId: '', resumable: true, possiblyBilled: true }));
    expect(text).not.toContain('Resume with');
    expect(text).toContain(BILLING_NOTE);
  });
  it("getGenerationCommand('') returns the placeholder", () => {
    expect(getGenerationCommand('')).toBe('ideogram get-generation <generation-id> --wait');
    expect(getGenerationCommand('-abc')).toBe('ideogram get-generation --wait -- -abc');
  });
});

// ------------------------------------------------------------------ 2. billing wording on polling
describe('item 2: billing wording on polling', () => {
  const polled = (status, extra = {}) =>
    new IdeogramAPIError('x', { generationId: 'g1', status, resumable: false, possiblyBilled: true, ...extra });

  it.each([400, 404, 410, 422])('no billing line after a non-resumable polling %i', (status) => {
    reportCommandError(polled(status));
    expect(err()).not.toContain(BILLING_NOTE);
    expect(shouldAppendBillingNote(polled(status))).toBe(false);
  });
  it('the billing line stays for other possibly-billed errors', () => {
    expect(shouldAppendBillingNote(polled(200, { code: 'ERESPONSETOOLARGE' }))).toBe(true);
    expect(shouldAppendBillingNote(polled(404, { resumable: true }))).toBe(true);
    expect(shouldAppendBillingNote({ message: 'x', status: 404, possiblyBilled: true })).toBe(true); // a submit, no id
    expect(shouldAppendBillingNote({ message: `x ${BILLING_NOTE}`, possiblyBilled: true })).toBe(false);
    expect(shouldAppendBillingNote({ message: 'x', possiblyBilled: false })).toBe(false);
  });
  it('the 404 message keeps its own conditional wording', async () => {
    fetchMock.mockResolvedValue(fakeResponse(404, { error: 'gone' }));
    const e = await wait(api());
    expect(e.message).toBe('Generation gen1 not found: check the id (if you submitted it, it may still have been billed)');
  });

  it.each([
    [404, false],
    [401, false],
    [503, true],
    [408, true],
  ])('a direct getGeneration failing with %i carries generationId, resumable %s, possiblyBilled false', async (status, resumable) => {
    fetchMock.mockResolvedValue(fakeResponse(status, { error: 'x' }));
    const e = await api().getGeneration('g9').catch((x) => x);
    expect(e).toBeInstanceOf(IdeogramAPIError);
    expect(e.generationId).toBe('g9');
    expect(e.resumable).toBe(resumable);
    expect(e.possiblyBilled).toBe(false);
  });
  it('a direct getGeneration with no response is resumable', async () => {
    fetchMock.mockRejectedValue(Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNRESET' } }));
    const e = await api().getGeneration('g9').catch((x) => x);
    expect(e.generationId).toBe('g9');
    expect(e.resumable).toBe(true);
    expect(e.possiblyBilled).toBe(false);
  });

  it.each([
    ['empty id', '', {}, 'generationId is required'],
    ['bad intervalMs', 'g', { intervalMs: 0 }, 'intervalMs must be'],
    ['bad timeoutMs', 'g', { timeoutMs: 1.5 }, 'timeoutMs must be'],
  ])('waitForGeneration argument error (%s) is an IdeogramAPIError EINVALIDARGUMENT', async (_n, id, options, prefix) => {
    const e = await api().waitForGeneration(id, options).catch((x) => x);
    expect(e).toBeInstanceOf(IdeogramAPIError);
    expect(e.code).toBe('EINVALIDARGUMENT');
    expect(e.possiblyBilled).toBe(false);
    expect(e.resumable).toBe(false);
    expect(e.message).toContain(prefix);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ------------------------------------------------------------------ 3. control characters from the server
describe('item 3: server text is sanitized, error.body stays raw', () => {
  const nasty = 'bad \u001b[31mred\u001b[0m\u0007 line1\r\nline2\u009b \u001b]0;title\u0007end';

  it('sanitizeServerText strips escapes, C0 (not tab) and C1', () => {
    const s = sanitizeServerText(nasty);
    expect(s).not.toMatch(CONTROL);
    expect(s).toBe('bad red line1 line2 end');
    expect(sanitizeServerText('a\tb')).toBe('a\tb');
  });

  it('an error body with ESC, BEL, CR and LF gives a clean message and a raw body', async () => {
    const body = { error: nasty, reject_reason: 'r\u001b[2Jr' };
    fetchMock.mockResolvedValue(fakeResponse(402, body));
    const e = await api().generateV4({ prompt: 'x' }).catch((x) => x);
    expect(e.message).not.toMatch(CONTROL);
    expect(e.message).toContain('bad red');
    expect(e.message).toContain('(rr)');
    expect(e.body.error).toBe(nasty);
    expect(e.rejectReason).toBe('r\u001b[2Jr');
  });

  it('the message of other statuses is clean too (400 and the generic fallthrough)', async () => {
    for (const status of [400, 500]) {
      fetchMock.mockResolvedValue(fakeResponse(status, { error: nasty }));
      const e = await api().generateV4({ prompt: 'x' }).catch((x) => x);
      expect(e.message).not.toMatch(CONTROL);
      expect(e.body.error).toBe(nasty);
    }
  });

  it('failure_reason is clean in the message, raw on failureReason and body', async () => {
    fetchMock.mockResolvedValue(fakeResponse(200, { generation_id: 'gen1', status: 'failed', failure_reason: nasty }));
    const e = await wait(api());
    expect(e.message).not.toMatch(CONTROL);
    expect(e.failureReason).toBe(nasty);
    expect(e.body.failure_reason).toBe(nasty);
  });

  it('get-generation prints a clean failure reason', async () => {
    fetchMock.mockResolvedValue(
      fakeResponse(200, { generation_id: 'gf', status: 'failed', created: 't', failure_reason: nasty })
    );
    await executeGetGeneration('gf', {}, global()).catch(() => {});
    const line = logs.find((l) => l.startsWith('Failure reason:'));
    expect(line).toBe('Failure reason: bad red line1 line2 end');
  });

  it('the CLI error line is clean', () => {
    reportCommandError(new IdeogramAPIError(nasty));
    expect(err().replace(/\n/g, '')).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/);
  });
});

// ------------------------------------------------------------------ 4. logging and output
describe('item 4: log level, spinner, URL logging', () => {
  it('normalizeLogLevel lowercases and validates', () => {
    expect(normalizeLogLevel('DEBUG')).toBe('debug');
    expect(() => normalizeLogLevel('loud')).toThrow("Invalid log level 'loud'. Use one of: error, warn, info, debug");
    expect(() => normalizeLogLevel('')).toThrow(/Invalid log level/);
  });
  it('the library lowercases and rejects: constructor, setLogLevel (instance and module)', () => {
    expect(new IdeogramAPI(KEY, undefined, 'WARN').logger.level).toBe('warn');
    expect(() => new IdeogramAPI(KEY, undefined, 'loud')).toThrow(/Invalid log level 'loud'/);
    const a = api();
    a.setLogLevel('Info');
    expect(a.logger.level).toBe('info');
    expect(() => a.setLogLevel('loud')).toThrow(/Invalid log level/);
    const before = moduleLogger.level;
    expect(() => setLogLevel('loud')).toThrow(/Invalid log level/);
    expect(moduleLogger.level).toBe(before);
  });
  it('the CLI exits 1 on an unknown --log-level, naming it, and sends nothing', async () => {
    const res = await run('--log-level', 'loud', 'list-v4-resolutions');
    expect(res.exit).toBe(1);
    expect(err()).toContain("Invalid --log-level 'loud'. Use one of: error, warn, info, debug");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('the CLI accepts an upper-case level', async () => {
    const res = await run('--log-level', 'ERROR', 'list-v4-resolutions');
    expect(res.exit).not.toBe(1);
    expect(err()).not.toContain('Invalid --log-level');
  });

  describe('spinner without a TTY', () => {
    let writes;
    let desc;
    beforeEach(() => {
      vi.useFakeTimers();
      writes = [];
      spies.push(vi.spyOn(process.stdout, 'write').mockImplementation((s) => (writes.push(String(s)), true)));
      desc = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
      Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
    });
    afterEach(() => {
      vi.useRealTimers();
      if (desc) Object.defineProperty(process.stdout, 'isTTY', desc);
      else delete process.stdout.isTTY;
    });
    it('writes no frames, and the final line once', () => {
      const s = createSpinner('Working');
      s.start();
      s.update('Still');
      vi.advanceTimersByTime(1000);
      expect(writes).toEqual([]);
      s.stop('✓ Done\n');
      expect(writes).toEqual(['✓ Done\n\n']);
    });
    it('stop() with no message writes nothing', () => {
      const s = createSpinner('Working');
      s.start();
      s.stop();
      expect(writes).toEqual([]);
    });
  });

  it('the download debug log carries origin and path, not the query string', async () => {
    const lines = [];
    const spy = vi.spyOn(moduleLogger, 'debug').mockImplementation((m) => (lines.push(String(m)), moduleLogger));
    fetchMock.mockResolvedValue(new Response(Buffer.from([0x89, 0x50, 0x4e, 0x47]), { headers: { 'content-type': 'image/png' } }));
    await downloadImageAsBuffer('https://cdn.example.com/a/b.png?sig=SECRET&exp=1').catch(() => {});
    spy.mockRestore();
    const line = lines.find((l) => l.startsWith('Downloading image from URL'));
    expect(line).toBe('Downloading image from URL: https://cdn.example.com/a/b.png');
    expect(lines.join('\n')).not.toContain('SECRET');
  });
});

// ------------------------------------------------------------------ 5. small code fixes
describe('item 5: small code fixes', () => {
  const textFile = () => {
    const f = join(work, 'not-an-image.png');
    writeFileSync(f, 'abc');
    return f;
  };
  it.each([
    ['upscale-auto', (f) => ({ image: f })],
    ['precise-edit-v45', (f) => ({ prompt: 'p', image: f })],
  ])('%s with a 3-byte text file says it is not a valid image', async (op, opts) => {
    const f = textFile();
    await executeV2(op, opts(f), global()).catch(() => {});
    expect(err()).toContain(`File does not appear to be a valid image (PNG, JPEG, WebP, or GIF): ${f}`);
    expect(err()).not.toContain('Unable to read image dimensions');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('V2_OPERATION_KEYS is the list the validator and the type are built from', () => {
    expect(V2_OPERATION_KEYS).toHaveLength(16);
    expect(new Set(V2_OPERATION_KEYS).size).toBe(16);
  });

  it('BILLING_NOTE is the exact trailing sentence of a possibly-billed message', async () => {
    fetchMock.mockResolvedValue(fakeResponse(502, 'Bad Gateway', 'text/plain'));
    const e = await api().generateV4({ prompt: 'x' }).catch((x) => x);
    expect(BILLING_NOTE).toBe('The request may have run and been billed. Check your usage before retrying.');
    expect(e.message.endsWith(BILLING_NOTE)).toBe(true);
  });
});

// ------------------------------------------------------------------ 6. boundary tests (mutants)
describe('item 6: boundaries', () => {
  it.each([
    [500, true],
    [501, true],
    [499, false],
  ])('a POST answered with HTTP %i: possiblyBilled %s', async (status, billed) => {
    fetchMock.mockResolvedValue(fakeResponse(status, { error: 'x' }));
    const e = await api().generateV4({ prompt: 'x' }).catch((x) => x);
    expect(e.status).toBe(status);
    expect(e.possiblyBilled).toBe(billed);
  });

  describe('6to4 byte order', () => {
    it.each(['https://[2002:c0a8:101::]/', 'https://[2002:a00:1::]/'])('%s (private IPv4 inside) is blocked', async (url) => {
      await expect(validateImageUrl(url)).rejects.toThrow(/not allowed/);
    });
    it('2002:801:203:: (8.1.2.3, public) is allowed', async () => {
      await expect(validateImageUrl('https://[2002:801:203::]/')).resolves.toBe('https://[2002:801:203::]/');
    });
  });

  it('exactly two single-word prompts are refused; the flag lifts it', async () => {
    fetchMock.mockResolvedValue(fakeResponse(200, { created: 'x', data: [] }));
    const res = await run('generate', '-p', 'red', 'fox');
    expect(res.exit).toBe(1);
    expect(err()).toContain('2 prompts, each a single word');
    expect(fetchMock).not.toHaveBeenCalled();

    // The flag lifts the refusal: the request is sent (the empty result then ends the command).
    errors.length = 0;
    await run('generate', '-p', 'red', 'fox', '--allow-single-word-prompts');
    expect(err()).not.toContain('each a single word');
    expect(fetchMock).toHaveBeenCalled();
  });

  it('EACCES on an image stat prints "Permission denied reading image file"', async () => {
    const f = join(work, 'locked.png');
    writeFileSync(f, 'abc');
    const stat = vi.spyOn(fsp, 'stat').mockRejectedValue(Object.assign(new Error('EACCES'), { code: 'EACCES' }));
    try {
      await executeV2('upscale-auto', { image: f }, global()).catch(() => {});
    } finally {
      stat.mockRestore();
    }
    expect(err()).toContain(`Permission denied reading image file: ${f}`);
  });
});

describe('reframe rejects a non-image input with a plain message', () => {
  it('a text file passed as the image says it is not a valid image, before any request', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'reframe-'));
    const f = join(dir, 'not-an-image.png');
    writeFileSync(f, 'hi\n');
    try {
      const api = new IdeogramAPI('test-key-1234');
      await expect(api.reframe({ image: f, resolution: '1024x1024' })).rejects.toThrow(
        `File does not appear to be a valid image (PNG, JPEG, WebP, or GIF): ${f}`
      );
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a non-image Buffer says it is not a valid image', async () => {
    const api = new IdeogramAPI('test-key-1234');
    await expect(api.reframe({ image: Buffer.from('hi\n'), resolution: '1024x1024' })).rejects.toThrow(
      'Buffer does not appear to be a valid image'
    );
  });
});
