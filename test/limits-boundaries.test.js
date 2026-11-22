/**
 * Exact-boundary tests for the v2 limits in src/config.ts.
 * Each pair pins one comparison from both sides: the limit itself is accepted,
 * one step past it is rejected. Kills the `<`/`<=` and `>`/`>=` mutants.
 */

import { describe, it, expect } from 'vitest';
import { validateV2Params, parseContextWindow } from '../src/config.js';

const ok = (op, p) => expect(() => validateV2Params(op, { prompt: 'x', ...p })).not.toThrow();
const bad = (op, p, msg) => expect(() => validateV2Params(op, { prompt: 'x', ...p })).toThrow(msg);

describe('contextWindow minimum side (256px)', () => {
  it('accepts a region exactly 256px on a side, rejects 255 (both axes)', () => {
    expect(parseContextWindow('0,0,256,512')).toEqual({ yMin: 0, xMin: 0, yMax: 256, xMax: 512 });
    expect(parseContextWindow('0,0,512,256')).toEqual({ yMin: 0, xMin: 0, yMax: 512, xMax: 256 });
    expect(() => parseContextWindow('0,0,255,512')).toThrow('at least 256px');
    expect(() => parseContextWindow('0,0,512,255')).toThrow('at least 256px');
  });

  it('holds through validateV2Params', () => {
    ok('precise-edit-v45', { contextWindow: '0,0,256,256' });
    bad('precise-edit-v45', { contextWindow: '0,0,256,255' }, 'at least 256px');
  });
});

describe('contextWindow aspect ratio (6:1)', () => {
  it('accepts exactly 6:1 in either orientation, rejects just over', () => {
    expect(parseContextWindow('0,0,256,1536')).not.toBeNull();
    expect(parseContextWindow('0,0,1536,256')).not.toBeNull();
    expect(() => parseContextWindow('0,0,256,1537')).toThrow('between 1:6 and 6:1');
    expect(() => parseContextWindow('0,0,1537,256')).toThrow('between 1:6 and 6:1');
  });

  it('holds through validateV2Params', () => {
    ok('precise-edit-v45', { contextWindow: '0,0,256,1536' });
    bad('precise-edit-v45', { contextWindow: '0,0,256,1537' }, 'between 1:6 and 6:1');
  });
});

describe('exact size aspect ratio (6:1)', () => {
  it('accepts exactly 6:1 and rejects just over, in either orientation', () => {
    ok('generate-v45', { size: '1536x256', imageCount: 1 });
    ok('generate-v45', { size: '256x1536', imageCount: 1 });
    bad('generate-v45', { size: '1568x256', imageCount: 1 }, 'at most 6:1');
    bad('generate-v45', { size: '256x1568', imageCount: 1 }, 'at most 6:1');
  });

  it('applies on the 4.6 path too', () => {
    ok('generate-v46', { size: '1536x256' });
    bad('generate-v46', { size: '1568x256' }, 'at most 6:1');
  });
});

describe('exact size minimum side (256px)', () => {
  it('accepts 256 and rejects 224 (next multiple of 32 below)', () => {
    ok('generate-v45', { size: '256x256', imageCount: 1 });
    bad('generate-v45', { size: '224x256', imageCount: 1 }, 'at least 256px');
    bad('generate-v45', { size: '256x224', imageCount: 1 }, 'at least 256px');
  });
});

describe('webhookUrl maximum length (2048)', () => {
  const url = (n) => 'https://' + 'a'.repeat(n - 'https://'.length);

  it('accepts exactly 2048 characters and rejects 2049', () => {
    expect(url(2048)).toHaveLength(2048);
    ok('generate-v4', { webhookUrl: url(2048) });
    bad('generate-v4', { webhookUrl: url(2049) }, 'webhookUrl exceeds 2048 characters');
  });
});
