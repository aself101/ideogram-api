/**
 * src/utils.ts behaviour that the SSRF / FormData tests in utils.test.js do not reach:
 * error coercion, the spinner, log level, filename and file helpers, and the
 * download helpers through the fetch stub (DNS mocked, nothing leaves the process).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

vi.mock('dns/promises', () => ({
  lookup: vi.fn(async () => ({ address: '8.8.8.8', family: 4 })),
}));

import { fetchMock, timeoutSpy, resetHttp } from './helpers/http.js';
import {
  toError,
  isErrnoException,
  setLogLevel,
  getImageDimensions,
  downloadImageAsBuffer,
  downloadBuffer,
  downloadToFile,
  buildFormData,
} from '../src/utils.js';
import { createSpinner, pause, generateFilename, saveImage, saveMetadata, ensureDirectory } from '../src/cli-io.js';
import { logger } from '../src/logger.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'ideogram-io-'));

describe('toError / isErrnoException', () => {
  it('returns an Error unchanged', () => {
    const e = new RangeError('r');
    expect(toError(e)).toBe(e);
  });
  it('keeps the message of a non-Error object that has one', () => {
    const e = toError({ message: 'from object', code: 'X' });
    expect(e).toBeInstanceOf(Error);
    expect(e.message).toBe('from object');
  });
  it('stringifies everything else', () => {
    expect(toError('plain').message).toBe('plain');
    expect(toError(42).message).toBe('42');
    expect(toError(null).message).toBe('null');
    expect(toError(undefined).message).toBe('undefined');
    expect(toError({ message: 7 }).message).toBe('[object Object]'); // message must be a string
  });
  it('isErrnoException needs an object with a string code', () => {
    expect(isErrnoException(Object.assign(new Error('x'), { code: 'ENOENT' }))).toBe(true);
    expect(isErrnoException({ code: 'EACCES' })).toBe(true);
    expect(isErrnoException({ code: 13 })).toBe(false);
    expect(isErrnoException(new Error('no code'))).toBe(false);
    expect(isErrnoException(null)).toBe(false);
    expect(isErrnoException('ENOENT')).toBe(false);
  });
});

describe('createSpinner', () => {
  let writes;
  let stdoutSpy;
  let ttyDescriptor;
  beforeEach(() => {
    vi.useFakeTimers();
    // Frames are written only on a TTY; these tests are about the frames.
    ttyDescriptor = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    writes = [];
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((s) => {
      writes.push(String(s));
      return true;
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    // Not vi.restoreAllMocks(): that would also restore the shared AbortSignal.timeout spy.
    stdoutSpy.mockRestore();
    if (ttyDescriptor) Object.defineProperty(process.stdout, 'isTTY', ttyDescriptor);
    else delete process.stdout.isTTY;
  });

  it('writes nothing until started, then a frame every 80ms with the message', () => {
    const s = createSpinner('Working');
    vi.advanceTimersByTime(500);
    expect(writes).toEqual([]);
    s.start();
    expect(writes).toEqual(['\n']);
    vi.advanceTimersByTime(79);
    expect(writes).toEqual(['\n']);
    vi.advanceTimersByTime(1);
    expect(writes).toEqual(['\n', '\r⠋ Working']);
    vi.advanceTimersByTime(80);
    expect(writes.at(-1)).toBe('\r⠙ Working');
    s.stop();
  });

  it('cycles through its 10 frames and wraps', () => {
    const s = createSpinner('m');
    s.start();
    vi.advanceTimersByTime(80 * 11);
    const frames = writes.slice(1).map((w) => w.slice(1, 2));
    expect(frames).toHaveLength(11);
    expect(frames[10]).toBe(frames[0]); // wrapped after 10
    expect(new Set(frames).size).toBe(10);
    s.stop();
  });

  it('update changes the message of later frames', () => {
    const s = createSpinner('first');
    s.start();
    vi.advanceTimersByTime(80);
    s.update('second');
    vi.advanceTimersByTime(80);
    expect(writes.at(-1)).toMatch(/^\r. second$/);
    s.stop();
  });

  it('stop(message) ends the frames and prints the message on its own line', () => {
    const s = createSpinner('m');
    s.start();
    vi.advanceTimersByTime(80);
    s.stop('✓ Done');
    expect(writes.slice(-2)).toEqual(['\r', '✓ Done\n']);
    const count = writes.length;
    vi.advanceTimersByTime(1000);
    expect(writes).toHaveLength(count); // interval cleared
  });

  it('stop() with no message clears the line, and is safe to call twice or before start', () => {
    const s = createSpinner('m');
    s.stop(); // never started
    expect(writes).toEqual(['\r', '\r\x1b[K']);
    s.start();
    s.stop();
    s.stop();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('setLogLevel / pause', () => {
  afterEach(() => {
    setLogLevel('info');
    vi.useRealTimers();
  });

  it('sets the module logger level, lower-casing it', () => {
    setLogLevel('DEBUG');
    expect(logger.level).toBe('debug');
    setLogLevel('Error');
    expect(logger.level).toBe('error');
  });

  it('pause resolves only after the delay', async () => {
    vi.useFakeTimers();
    let done = false;
    const p = pause(1000).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await p;
    expect(done).toBe(true);
  });
});

describe('generateFilename edge cases', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-22T10:11:12.345Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('prefixes a UTC YYYYMMDD_HHMMSS timestamp', () => {
    expect(generateFilename('a cat')).toBe('20261122_101112_a-cat.png');
  });
  it('drops non-ASCII letters and punctuation, collapsing whitespace', () => {
    expect(generateFilename('Héllo,   wörld!!')).toBe('20261122_101112_hllo-wrld.png');
  });
  it('leaves an empty stem when nothing survives sanitizing', () => {
    expect(generateFilename('!!! ???')).toBe('20261122_101112_.png');
  });
  it('truncates the stem to maxLength', () => {
    expect(generateFilename('abcdefghij', 'png', 4)).toBe('20261122_101112_abcd.png');
  });
  it('sanitizes the extension: leading dots, case, symbols, length', () => {
    expect(generateFilename('x', '.PNG')).toMatch(/\.png$/);
    expect(generateFilename('x', '../js/on')).toMatch(/_x\.json$/);
    expect(generateFilename('x', 'abcdefghijklmnop')).toMatch(/_x\.abcdefghij$/);
  });
  it('falls back to png when the extension sanitizes to nothing', () => {
    expect(generateFilename('x', '')).toMatch(/\.png$/);
    expect(generateFilename('x', '!!!')).toMatch(/\.png$/);
    expect(generateFilename('x', '...')).toMatch(/\.png$/);
  });
});

describe('saveImage / saveMetadata / ensureDirectory', () => {
  it('saveImage decodes a base64 string and creates missing directories', async () => {
    const out = join(tmp(), 'a', 'b', 'img.png');
    expect(await saveImage(Buffer.from('hello').toString('base64'), out)).toBe(out);
    expect(readFileSync(out, 'utf8')).toBe('hello');
  });
  it('saveImage writes a Buffer as-is', async () => {
    const out = join(tmp(), 'raw.bin');
    await saveImage(Buffer.from([0, 1, 2, 255]), out);
    expect([...readFileSync(out)]).toEqual([0, 1, 2, 255]);
  });
  it('saveImage rejects anything else and writes no file', async () => {
    const out = join(tmp(), 'bad.png');
    await expect(saveImage(12345, out)).rejects.toThrow('imageData must be a Buffer or base64-encoded string');
    expect(existsSync(out)).toBe(false);
  });
  it('saveMetadata writes 2-space-indented JSON and returns the path', async () => {
    const out = join(tmp(), 'm.json');
    expect(await saveMetadata(out, { a: 1, b: { c: 'é' } })).toBe(out);
    expect(readFileSync(out, 'utf8')).toBe('{\n  "a": 1,\n  "b": {\n    "c": "é"\n  }\n}');
  });
  it('ensureDirectory creates nested directories and returns the path', async () => {
    const d = join(tmp(), 'x', 'y', 'z');
    expect(await ensureDirectory(d)).toBe(d);
    expect(existsSync(d)).toBe(true);
  });
});

describe('getImageDimensions error paths', () => {
  it('rejects unreadable bytes, naming the cause', async () => {
    await expect(getImageDimensions(Buffer.from('not an image at all'))).rejects.toThrow(
      /^Unable to read image dimensions: /
    );
  });
  it('rejects a missing file path', async () => {
    await expect(getImageDimensions(join(tmp(), 'nope.png'))).rejects.toThrow(/^Unable to read image dimensions: /);
  });
  it('rejects a non-string, non-buffer input, naming its type', async () => {
    await expect(getImageDimensions(42)).rejects.toThrow('Unsupported image input (type: number)');
    await expect(getImageDimensions(null)).rejects.toThrow('Unsupported image input (type: null)');
  });
});

describe('buildFormData arrays', () => {
  it('appends each array item as its own field, stringified', () => {
    const f = buildFormData({ style_codes: ['AAAA', 7, true], skip: undefined, none: null });
    expect(f.getAll('style_codes')).toEqual(['AAAA', '7', 'true']);
    expect(f.has('skip')).toBe(false);
    expect(f.has('none')).toBe(false);
  });
});

describe('download helpers through the fetch stub', () => {
  const URL_ = 'https://cdn.ideogram.ai/v.bin';
  beforeEach(() => resetHttp());

  it('downloadBuffer returns the body and uses a 60s default timeout', async () => {
    fetchMock.mockImplementation(async () => new Response('PAYLOAD'));
    expect((await downloadBuffer(URL_)).toString()).toBe('PAYLOAD');
    expect(timeoutSpy).toHaveBeenLastCalledWith(60000);
  });

  it('downloadBuffer honours timeoutMs and maxBytes (cap accepted, cap + 1 rejected)', async () => {
    fetchMock.mockImplementation(async () => new Response('x'.repeat(10)));
    expect((await downloadBuffer(URL_, { maxBytes: 10, timeoutMs: 1234 })).length).toBe(10);
    expect(timeoutSpy).toHaveBeenLastCalledWith(1234);
    await expect(downloadBuffer(URL_, { maxBytes: 9 })).rejects.toThrow('Response exceeds the 0MB limit');
  });

  it('downloadBuffer refuses a non-HTTPS URL before fetching', async () => {
    await expect(downloadBuffer('http://cdn.ideogram.ai/v.bin')).rejects.toThrow('Only HTTPS URLs are allowed');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('downloadToFile streams to a new directory and uses a 5 minute default timeout', async () => {
    fetchMock.mockImplementation(async () => new Response('VIDEO'));
    const out = join(tmp(), 'deep', 'v.mp4');
    await downloadToFile(URL_, out);
    expect(readFileSync(out, 'utf8')).toBe('VIDEO');
    expect(timeoutSpy).toHaveBeenLastCalledWith(300000);
  });

  it('downloadToFile honours timeoutMs, and removes the file when maxBytes is exceeded', async () => {
    fetchMock.mockImplementation(async () => new Response('x'.repeat(50)));
    const out = join(tmp(), 'big.bin');
    await expect(downloadToFile(URL_, out, { maxBytes: 10, timeoutMs: 777 })).rejects.toThrow('Response exceeds');
    expect(timeoutSpy).toHaveBeenLastCalledWith(777);
    expect(existsSync(out)).toBe(false);
  });

  it('downloadToFile surfaces a non-2xx status and writes nothing', async () => {
    fetchMock.mockImplementation(async () => new Response('gone', { status: 404 }));
    const out = join(tmp(), 'x.bin');
    await expect(downloadToFile(URL_, out)).rejects.toThrow('Download failed with status code 404');
    expect(existsSync(out)).toBe(false);
  });

  it('downloadImageAsBuffer accepts an allowed Content-Type, ignoring parameters', async () => {
    fetchMock.mockImplementation(
      async () => new Response('IMG', { headers: { 'content-type': 'image/png; charset=binary' } })
    );
    expect((await downloadImageAsBuffer('https://cdn.ideogram.ai/a.png')).toString()).toBe('IMG');
  });

  it.each([['text/html'], ['image/svg+xml'], [null]])('downloadImageAsBuffer rejects Content-Type %s', async (ct) => {
    fetchMock.mockImplementation(async () => {
      const res = new Response('<html>', { headers: ct ? { 'content-type': ct } : {} });
      if (!ct) res.headers.delete('content-type');
      return res;
    });
    await expect(downloadImageAsBuffer('https://cdn.ideogram.ai/a.png')).rejects.toThrow(
      /Invalid Content-Type: .*Expected image\/\*/
    );
  });
});
