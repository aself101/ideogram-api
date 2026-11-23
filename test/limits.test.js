/**
 * Byte-cap boundaries and cleanup in src/http.ts and IdeogramAPI._request.
 *
 * Each cap is tested at exactly the cap (accepted) and cap + 1 (rejected), so
 * a `>` that drifts to `>=` (or `>` to `>= cap + 1`) fails. The existing tests
 * in http.test.js use bodies far from the cap and cannot see that.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { fetchMock, ok, resetHttp, sentConfig } from './helpers/http.js';

import { IdeogramAPI } from '../src/api.js';
import { readBodyWithLimit, streamToFile, formDataSize, ResponseTooLargeError } from '../src/http.js';

const CAP = 64;
const tmp = () => mkdtempSync(join(tmpdir(), 'ideogram-limits-'));

/** A Response whose body arrives as the given chunks, with an optional declared length. */
function chunked(chunks, headers = {}) {
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
  return new Response(stream, { headers });
}

describe('readBodyWithLimit boundary', () => {
  it('accepts a body of exactly the cap', async () => {
    const buf = await readBodyWithLimit(new Response('x'.repeat(CAP)), CAP);
    expect(buf.length).toBe(CAP);
  });

  it('rejects a body of cap + 1', async () => {
    await expect(readBodyWithLimit(new Response('x'.repeat(CAP + 1)), CAP)).rejects.toBeInstanceOf(
      ResponseTooLargeError
    );
  });

  it('counts across chunks: 32 + 32 passes, 32 + 33 fails', async () => {
    expect((await readBodyWithLimit(chunked(['x'.repeat(32), 'x'.repeat(32)]), CAP)).length).toBe(CAP);
    await expect(readBodyWithLimit(chunked(['x'.repeat(32), 'x'.repeat(33)]), CAP)).rejects.toBeInstanceOf(
      ResponseTooLargeError
    );
  });
});

describe('declared Content-Length boundary (checked before any byte is read)', () => {
  it('readBodyWithLimit accepts a declared length equal to the cap', async () => {
    const res = new Response('x'.repeat(CAP), { headers: { 'content-length': String(CAP) } });
    expect((await readBodyWithLimit(res, CAP)).length).toBe(CAP);
  });

  it('readBodyWithLimit rejects a declared length of cap + 1, even when the body is small', async () => {
    const res = new Response('tiny', { headers: { 'content-length': String(CAP + 1) } });
    await expect(readBodyWithLimit(res, CAP)).rejects.toBeInstanceOf(ResponseTooLargeError);
  });

  it('streamToFile accepts a declared length equal to the cap', async () => {
    const out = join(tmp(), 'at-cap.bin');
    const res = new Response('x'.repeat(CAP), { headers: { 'content-length': String(CAP) } });
    await streamToFile(res, out, CAP);
    expect(readFileSync(out).length).toBe(CAP);
  });

  it('streamToFile rejects a declared length of cap + 1 before creating the file', async () => {
    const out = join(tmp(), 'declared-over.bin');
    const res = new Response('tiny', { headers: { 'content-length': String(CAP + 1) } });
    await expect(streamToFile(res, out, CAP)).rejects.toBeInstanceOf(ResponseTooLargeError);
    expect(existsSync(out)).toBe(false);
  });
});

describe('streamToFile boundary', () => {
  it('writes a body of exactly the cap', async () => {
    const out = join(tmp(), 'exact.bin');
    await streamToFile(new Response('x'.repeat(CAP)), out, CAP);
    expect(readFileSync(out).length).toBe(CAP);
  });

  it('rejects a body of cap + 1 with no declared length', async () => {
    const out = join(tmp(), 'over.bin');
    await expect(streamToFile(new Response('x'.repeat(CAP + 1)), out, CAP)).rejects.toBeInstanceOf(
      ResponseTooLargeError
    );
  });

  it('counts across chunks: 32 + 32 passes, 32 + 33 fails', async () => {
    const dir = tmp();
    await streamToFile(chunked(['x'.repeat(32), 'x'.repeat(32)]), join(dir, 'a.bin'), CAP);
    expect(readFileSync(join(dir, 'a.bin')).length).toBe(CAP);
    await expect(
      streamToFile(chunked(['x'.repeat(32), 'x'.repeat(33)]), join(dir, 'b.bin'), CAP)
    ).rejects.toBeInstanceOf(ResponseTooLargeError);
  });
});

describe('streamToFile leaves no partial file on failure', () => {
  it('removes the file after a cap overflow that began writing', async () => {
    const out = join(tmp(), 'overflow.bin');
    // First chunk is under the cap and is written; the second pushes it over.
    await expect(streamToFile(chunked(['x'.repeat(40), 'x'.repeat(40)]), out, CAP)).rejects.toBeInstanceOf(
      ResponseTooLargeError
    );
    expect(existsSync(out)).toBe(false);
  });

  it('removes the file after a mid-stream error and rethrows that error', async () => {
    const out = join(tmp(), 'broken.bin');
    const boom = new Error('connection reset');
    let sent = false;
    const stream = new ReadableStream({
      pull(controller) {
        if (!sent) {
          sent = true;
          controller.enqueue(new TextEncoder().encode('partial-bytes'));
        } else {
          controller.error(boom);
        }
      },
    });
    await expect(streamToFile(new Response(stream), out, CAP)).rejects.toBe(boom);
    expect(existsSync(out)).toBe(false);
  });

  it('does not mask the original error when there is nothing to remove', async () => {
    // A body-less response fails before the file exists; it still reports its own error.
    const out = join(tmp(), 'nobody.bin');
    const res = { status: 204, headers: new Headers(), body: null };
    await expect(streamToFile(res, out, CAP)).rejects.toThrow('Response has no body (HTTP 204)');
    expect(existsSync(out)).toBe(false);
  });
});

describe('formDataSize is exact', () => {
  it('adds 256 bytes of framing per part to the payload bytes', () => {
    const form = new FormData();
    form.append('prompt', 'héllo'); // 6 UTF-8 bytes (5 chars)
    form.append('images', new Blob([new Uint8Array(1000)]), 'a.png');
    form.append('images', new Blob([new Uint8Array(10)]), 'b.png');
    expect(formDataSize(form)).toBe(3 * 256 + 6 + 1000 + 10);
  });

  it('is zero for an empty form and 256 for one empty field', () => {
    expect(formDataSize(new FormData())).toBe(0);
    const form = new FormData();
    form.append('k', '');
    expect(formDataSize(form)).toBe(256);
  });
});

describe('_request body cap boundary', () => {
  const MAX = 1024 * 1024; // BODY_LIMITS.json
  const overhead = Buffer.byteLength(JSON.stringify({ prompt: '' }));
  let api;
  beforeEach(() => {
    resetHttp();
    api = new IdeogramAPI('test-key-1234567890', undefined, 'error');
  });

  it('sends a JSON body of exactly 1048576 bytes', async () => {
    fetchMock.mockReturnValue(ok({ generation_id: 'g' }));
    await api.generateV4({ prompt: 'a'.repeat(MAX - overhead) });
    const [, init] = fetchMock.mock.calls[0];
    expect(Buffer.byteLength(init.body)).toBe(MAX);
    expect(sentConfig().url).toContain('/v2/');
  });

  it('rejects a JSON body one byte over, before fetch is called', async () => {
    await expect(api.generateV4({ prompt: 'a'.repeat(MAX - overhead + 1) })).rejects.toThrow(
      /Request payload too large: .*exceeds maximum of 1MB/
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
