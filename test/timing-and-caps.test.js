/**
 * Boundaries from ship-pipeline run #7 (tracker project ideogram-api):
 * the waitForGeneration deadline comparison, and the default download caps
 * (downloadBuffer 200MB, downloadToFile 2GB) checked through Content-Length.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

vi.mock('dns/promises', () => ({
  lookup: vi.fn(async () => ({ address: '8.8.8.8', family: 4 })),
}));

import { fetchMock, fakeResponse, resetHttp } from './helpers/http.js';
import { IdeogramAPI, IdeogramAPIError } from '../src/api.js';
import { downloadBuffer, downloadToFile } from '../src/utils.js';

describe('waitForGeneration deadline boundary', () => {
  const INTERVAL = 1000;
  let clock;
  let sleeps;
  let nowSpy;
  let timeoutSpy;

  beforeEach(() => {
    resetHttp();
    clock = 5_000_000;
    sleeps = [];
    fetchMock.mockImplementation(async () =>
      fakeResponse(200, { generation_id: 'g', status: 'pending', created: 't' })
    );
    nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => clock);
    // Sleeping advances the mocked clock by exactly the requested time.
    timeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation((fn, ms) => {
      sleeps.push(ms);
      clock += ms;
      fn();
      return 0;
    });
  });
  afterEach(() => {
    nowSpy.mockRestore();
    timeoutSpy.mockRestore();
  });

  const wait = (timeoutMs) =>
    new IdeogramAPI('test-key-1234567890', undefined, 'error')
      .waitForGeneration('g', { intervalMs: INTERVAL, timeoutMs })
      .catch((e) => e);

  it('keeps polling when the next wait lands exactly on the deadline', async () => {
    // t=0 poll, sleep to 1000, poll (1000+1000 == deadline: not past it), sleep to 2000, poll, then 2000+1000 > 2000.
    const err = await wait(2 * INTERVAL);
    expect(err).toBeInstanceOf(IdeogramAPIError);
    expect(err.message).toContain(`Timed out after ${2 * INTERVAL}ms`);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([INTERVAL, INTERVAL]);
  });

  it('times out when the next wait would pass the deadline by one millisecond', async () => {
    const err = await wait(2 * INTERVAL - 1);
    expect(err).toBeInstanceOf(IdeogramAPIError);
    expect(err.message).toContain(`Timed out after ${2 * INTERVAL - 1}ms`);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleeps).toEqual([INTERVAL]);
  });
});

describe('default download caps (declared Content-Length)', () => {
  const URL_ = 'https://cdn.ideogram.ai/v.bin';
  const MB = 1024 * 1024;
  const BUFFER_CAP = 200 * MB;
  const FILE_CAP = 2 * 1024 * MB;
  let dir;

  const declare = (length, body = 'tiny') =>
    fetchMock.mockImplementation(
      async () => new Response(body, { headers: { 'content-length': String(length) } })
    );

  beforeEach(() => {
    resetHttp();
    dir = mkdtempSync(join(tmpdir(), 'ideogram-defcap-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('downloadBuffer rejects a declared length of 200MB + 1 byte by default', async () => {
    declare(BUFFER_CAP + 1);
    await expect(downloadBuffer(URL_)).rejects.toThrow('Response exceeds the 200MB limit');
  });

  it('downloadBuffer accepts a declared length of exactly 200MB by default', async () => {
    declare(BUFFER_CAP);
    expect((await downloadBuffer(URL_)).toString()).toBe('tiny');
  });

  it('downloadToFile rejects a declared length of 2GB + 1 byte by default, writing nothing', async () => {
    declare(FILE_CAP + 1);
    const out = join(dir, 'a', 'big.bin');
    await expect(downloadToFile(URL_, out)).rejects.toThrow('Response exceeds the 2048MB limit');
    expect(existsSync(out)).toBe(false);
  });

  it('downloadToFile accepts a declared length of exactly 2GB by default', async () => {
    declare(FILE_CAP);
    const out = join(dir, 'ok.bin');
    await downloadToFile(URL_, out);
    expect(readFileSync(out, 'utf8')).toBe('tiny');
  });
});
