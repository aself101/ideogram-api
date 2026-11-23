/**
 * The HTTP layer on native fetch (src/http.ts and IdeogramAPI._request).
 *
 * axios was removed 2026-11-22. These tests pin the limits that axios used to
 * enforce and that the client now enforces itself: timeouts, response-size
 * caps, redirect limits with an SSRF check on every hop, and the API path's
 * refusal to follow redirects (which would carry the Api-Key header along).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdtempSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { fetchMock, ok, httpError, fakeResponse, resetHttp, sentConfig } from './helpers/http.js';

import { IdeogramAPI, IdeogramAPIError } from '../src/api.js';
import {
  fetchFollowingRedirects,
  readBodyWithLimit,
  streamToFile,
  formDataSize,
  describeNetworkError,
  ResponseTooLargeError,
} from '../src/http.js';

function redirectTo(location, status = 302) {
  return Promise.resolve({
    ok: false,
    status,
    headers: new Headers({ location }),
    body: null,
  });
}

describe('IdeogramAPI._request on fetch', () => {
  let api;
  beforeEach(() => {
    resetHttp();
    api = new IdeogramAPI('test-key-1234567890', undefined, 'error');
  });

  it('refuses redirects, so the Api-Key header cannot follow one to another host', async () => {
    fetchMock.mockReturnValue(ok({ generation_id: 'g' }));
    await api.generateV4({ prompt: 'x' });
    expect(sentConfig().redirect).toBe('error');
    expect(sentConfig().headers['Api-Key']).toBe('test-key-1234567890');
  });

  it('names the error code when no HTTP response arrives', async () => {
    const cause = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });
    fetchMock.mockRejectedValue(Object.assign(new TypeError('fetch failed'), { cause }));
    const err = await api.generateV4({ prompt: 'x' }).catch((e) => e);
    expect(err).toBeInstanceOf(IdeogramAPIError);
    expect(err.code).toBe('ECONNRESET');
    expect(err.status).toBeUndefined();
    expect(err.message).toBe('Request failed (ECONNRESET): read ECONNRESET');
    expect(err.cause.cause).toBe(cause);
  });

  it('reports a timeout with its duration', async () => {
    fetchMock.mockRejectedValue(Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }));
    const err = await api.generateV4({ prompt: 'x', timeoutMs: 1234 }).catch((e) => e);
    expect(err.code).toBe('ETIMEDOUT');
    expect(err.message).toBe('Request failed (ETIMEDOUT): Request timed out after 1234ms');
  });

  it('rejects a 200 that is not JSON', async () => {
    fetchMock.mockReturnValue(Promise.resolve(fakeResponse(200, '<html>', 'text/html')));
    await expect(api.generateV4({ prompt: 'x' })).rejects.toThrow('Invalid response format from API');
  });

  it('keeps the 1.x fallback text when an error body is not JSON', async () => {
    fetchMock.mockReturnValue(Promise.resolve(fakeResponse(502, 'Bad Gateway', 'text/plain')));
    const err = await api.generateV4({ prompt: 'x' }).catch((e) => e);
    expect(err.status).toBe(502);
    expect(err.message).toBe('API error (502): Request failed with status code 502');
    expect(err.body).toBe('Bad Gateway');
  });

  it('403 appends the API reason only when the body gives one', async () => {
    fetchMock.mockReturnValue(httpError(403, {}));
    const err = await api.generateV4({ prompt: 'x' }).catch((e) => e);
    expect(err.message).toBe('Not authorized to perform this operation.');
  });

  it('rejects an oversized JSON body before sending', async () => {
    await expect(api.generateV4({ prompt: 'a'.repeat(1024 * 1024 + 10) })).rejects.toThrow(
      /Request payload too large: .*exceeds maximum of 1MB/
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('readBodyWithLimit / streamToFile', () => {
  it('reads a body under the cap', async () => {
    expect((await readBodyWithLimit(new Response('hello'), 10)).toString()).toBe('hello');
  });

  it('stops a body that streams past the cap', async () => {
    await expect(readBodyWithLimit(new Response('x'.repeat(11)), 10)).rejects.toBeInstanceOf(ResponseTooLargeError);
  });

  it('rejects a declared Content-Length over the cap without reading', async () => {
    const res = new Response('tiny', { headers: { 'content-length': '999999' } });
    await expect(readBodyWithLimit(res, 10)).rejects.toThrow('Response exceeds');
  });

  it('streams a body to a file, and fails past the cap', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ideogram-http-'));
    const good = join(dir, 'nested', 'ok.bin');
    await streamToFile(new Response('abcdef'), good, 100);
    expect(readFileSync(good, 'utf8')).toBe('abcdef');
    await expect(streamToFile(new Response('x'.repeat(200)), join(dir, 'big.bin'), 100)).rejects.toBeInstanceOf(
      ResponseTooLargeError
    );
  });
});

describe('fetchFollowingRedirects', () => {
  beforeEach(() => resetHttp());

  it('does not follow a 400 that carries a Location header: one fetch, a non-redirect failure', async () => {
    fetchMock.mockReturnValue(redirectTo('https://cdn.example.com/elsewhere.png', 400));
    const validate = vi.fn(async (u) => u);
    await expect(
      fetchFollowingRedirects('https://ideogram.ai/a.png', { validate, timeoutMs: 1000 })
    ).rejects.toThrow('Download failed with status code 400');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(validate).toHaveBeenCalledTimes(1);
  });

  it('runs the SSRF check on every hop, not only the first', async () => {
    fetchMock
      .mockReturnValueOnce(redirectTo('https://cdn.example.com/b.png'))
      .mockReturnValueOnce(redirectTo('/c.png'))
      .mockReturnValueOnce(Promise.resolve(new Response('img')));
    const validate = vi.fn(async (u) => u);
    const res = await fetchFollowingRedirects('https://ideogram.ai/a.png', { validate, timeoutMs: 1000 });
    expect(await res.text()).toBe('img');
    expect(validate.mock.calls.map((c) => c[0])).toEqual([
      'https://ideogram.ai/a.png',
      'https://cdn.example.com/b.png',
      'https://cdn.example.com/c.png', // relative Location resolved against the hop
    ]);
    expect(fetchMock.mock.calls.every(([, init]) => init.redirect === 'manual')).toBe(true);
  });

  it('stops at a redirect to a blocked host', async () => {
    fetchMock.mockReturnValueOnce(redirectTo('https://169.254.169.254/latest/meta-data'));
    const validate = vi.fn(async (u) => {
      if (u.includes('169.254')) throw new Error('Access to internal/private IP addresses is not allowed');
      return u;
    });
    await expect(fetchFollowingRedirects('https://ideogram.ai/a.png', { validate, timeoutMs: 1000 })).rejects.toThrow(
      'internal/private IP'
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('allows 5 redirects and refuses the 6th', async () => {
    const validate = async (u) => u;
    fetchMock.mockReturnValue(redirectTo('https://ideogram.ai/loop'));
    await expect(fetchFollowingRedirects('https://ideogram.ai/a', { validate, timeoutMs: 1000 })).rejects.toThrow(
      'Too many redirects (more than 5)'
    );
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it('throws on a non-2xx final response', async () => {
    fetchMock.mockReturnValue(Promise.resolve(new Response('nope', { status: 404 })));
    await expect(
      fetchFollowingRedirects('https://ideogram.ai/a', { validate: async (u) => u, timeoutMs: 1000 })
    ).rejects.toThrow('Download failed with status code 404');
  });
});

describe('formDataSize / describeNetworkError', () => {
  it('counts every part, files by size and fields by UTF-8 bytes', () => {
    const form = new FormData();
    form.append('prompt', 'héllo'); // 6 bytes
    form.append('images', new Blob([new Uint8Array(1000)]), 'a.png');
    const size = formDataSize(form);
    expect(size).toBeGreaterThanOrEqual(1006);
    expect(size).toBeLessThan(1006 + 2 * 512);
  });

  it('reads the reason from cause, as Node reports fetch failures', () => {
    const err = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND x' } });
    expect(describeNetworkError(err)).toEqual({ message: 'getaddrinfo ENOTFOUND x', code: 'ENOTFOUND' });
    expect(describeNetworkError(new TypeError('fetch failed'))).toEqual({ message: 'fetch failed', code: undefined });
  });
});

describe('downloadToFile (utils) ', () => {
  beforeEach(() => resetHttp());

  it('writes the streamed body and validates the URL first', async () => {
    const { downloadToFile } = await import('../src/utils.js');
    fetchMock.mockReturnValue(Promise.resolve(new Response('VIDEO')));
    const dir = mkdtempSync(join(tmpdir(), 'ideogram-dl-'));
    const out = join(dir, 'v.mp4');
    await expect(downloadToFile('http://ideogram.ai/v.mp4', out)).rejects.toThrow('Only HTTPS URLs are allowed');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(existsSync(out)).toBe(false);
  });
});
