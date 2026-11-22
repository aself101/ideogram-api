/**
 * Exact-cap boundaries: image 50MB, audio 15MB (both inclusive), the
 * multiple-of-32 rule on each side of an exact v2 size, and the hostname
 * clause of validateImageUrl (DNS resolves to a public address, so only the
 * hostname can reject).
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtempSync, writeFileSync, truncateSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

vi.mock('dns/promises', () => ({
  lookup: vi.fn(async () => ({ address: '8.8.8.8', family: 4 })),
}));

import { lookup } from 'dns/promises';
import { loadImageAsBuffer, loadAudioAsBuffer, validateImageUrl } from '../src/utils.js';
import { validateV2Params } from '../src/config.js';

const MB = 1024 * 1024;
let dir;

/** A sparse file of exactly `size` bytes starting with `magic`. */
function sparse(name, magic, size) {
  const p = join(dir, name);
  writeFileSync(p, magic);
  truncateSync(p, size);
  return p;
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'ideogram-caps-'));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('loadImageAsBuffer 50MB cap', () => {
  it('loads a file of exactly 50MB', async () => {
    const buf = await loadImageAsBuffer(sparse('img-50.png', PNG_MAGIC, 50 * MB));
    expect(buf.length).toBe(50 * MB);
  });
  it('rejects 50MB + 1 byte', async () => {
    await expect(loadImageAsBuffer(sparse('img-50p1.png', PNG_MAGIC, 50 * MB + 1))).rejects.toThrow(
      'exceeds maximum of 50MB'
    );
  });
});

describe('loadAudioAsBuffer 15MB cap', () => {
  const MP3 = Buffer.from('ID3');
  const WAV = Buffer.from('RIFF\0\0\0\0WAVE');
  it('loads an MP3 of exactly 15MB', async () => {
    const buf = await loadAudioAsBuffer(sparse('a-15.mp3', MP3, 15 * MB));
    expect(buf.length).toBe(15 * MB);
  });
  it('loads a WAV of exactly 15MB', async () => {
    const buf = await loadAudioAsBuffer(sparse('a-15.wav', WAV, 15 * MB));
    expect(buf.length).toBe(15 * MB);
  });
  it('rejects an MP3 of 15MB + 1 byte', async () => {
    await expect(loadAudioAsBuffer(sparse('a-15p1.mp3', MP3, 15 * MB + 1))).rejects.toThrow('exceeds the 15MB limit');
  });
  it('rejects a WAV of 15MB + 1 byte', async () => {
    await expect(loadAudioAsBuffer(sparse('a-15p1.wav', WAV, 15 * MB + 1))).rejects.toThrow('exceeds the 15MB limit');
  });
});

describe('validateV2Params exact size: both sides must be multiples of 32', () => {
  const check = (size) => () => validateV2Params('generate-v46', { prompt: 'a lighthouse', size });
  it('accepts 1024x1024 (control)', () => {
    expect(check('1024x1024')).not.toThrow();
  });
  it('rejects a width multiple of 32 with a height that is not (1024x1000)', () => {
    expect(check('1024x1000')).toThrow('size sides must be multiples of 32');
  });
  it('rejects the transpose (1000x1024)', () => {
    expect(check('1000x1024')).toThrow('size sides must be multiples of 32');
  });
});

describe('validateImageUrl hostname clause', () => {
  it('rejects https://localhost/x by hostname although DNS says public', async () => {
    lookup.mockClear();
    await expect(validateImageUrl('https://localhost/x')).rejects.toThrow('not allowed');
    // Rejected before resolution: the DNS answer (public) played no part.
    expect(lookup).not.toHaveBeenCalled();
  });
  it('accepts an ordinary public hostname under the same DNS mock (control)', async () => {
    await expect(validateImageUrl('https://example.com/x')).resolves.toBe('https://example.com/x');
  });
});
