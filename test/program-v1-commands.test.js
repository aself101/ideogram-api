/**
 * v1 commands edit, remix, reframe, replace-background, describe and the three
 * list-* commands, driven in-process through createProgram() (fetch stubbed,
 * DNS mocked). Asserts the endpoint, the posted multipart fields and their
 * option mapping, and the files written to --output-dir.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

vi.mock('dns/promises', () => ({
  lookup: vi.fn(async () => ({ address: '8.8.8.8', family: 4 })),
}));

import { fetchMock, resetHttp, fakeResponse, formFields, fileParts, formNames } from './helpers/http.js';
import { createProgram } from '../src/program.js';
import { STYLE_PRESETS, ASPECT_RATIOS, RESOLUTIONS } from '../src/config.js';

const KEY = 'test-key-1234567890';
const CDN = 'https://cdn.ideogram.ai';
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

let outDir;
let logs;
let errors;
let spies = [];
const out = () => logs.join('\n');
const err = () => errors.join('\n');

function withExitOverride(cmd) {
  cmd.exitOverride();
  cmd.configureOutput({ writeOut: (s) => logs.push(s), writeErr: (s) => errors.push(s) });
  cmd.commands.forEach(withExitOverride);
  return cmd;
}

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

/** Every api.ideogram.ai call answers `body`; downloads answer from `files`. */
function route(body, files = {}) {
  fetchMock.mockImplementation(async (url) => {
    const u = new URL(url);
    if (u.host === 'api.ideogram.ai') return fakeResponse(200, body);
    if (!(url in files)) throw new Error(`unexpected download: ${url}`);
    return new Response(files[url]);
  });
}

const genBody = (name) => ({
  created: '2026-11-22T00:00:00Z',
  data: [{ url: `${CDN}/${name}.png`, resolution: '1024x1024', seed: 9, is_image_safe: true }],
});
const apiCalls = () => fetchMock.mock.calls.filter(([u]) => new URL(u).host === 'api.ideogram.ai');
const sent = () => {
  expect(apiCalls()).toHaveLength(1);
  const [url, init] = apiCalls()[0];
  return { url: new URL(url), method: init.method, data: init.body };
};
const sub = (s) => readdirSync(join(outDir, s));

beforeEach(() => {
  resetHttp();
  outDir = mkdtempSync(join(tmpdir(), 'ideogram-v1cmd-'));
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
});

function expectResultsSaved(dir, name, operation) {
  const names = sub(dir);
  const png = names.find((n) => n.endsWith('.png'));
  expect(readFileSync(join(outDir, dir, png))).toEqual(PNG);
  const meta = JSON.parse(readFileSync(join(outDir, dir, names.find((n) => n.endsWith('.json'))), 'utf8'));
  expect(meta.operation).toBe(operation);
  expect(meta.response.images[0]).toMatchObject({ index: 1, seed: 9 });
}

describe('edit', () => {
  it('posts image + mask to ideogram-v3/edit with mapped options and saves the result', async () => {
    const img = join(outDir, 'in.png');
    const mask = join(outDir, 'mask.png');
    writeFileSync(img, PNG);
    writeFileSync(mask, PNG);
    route(genBody('edit'), { [`${CDN}/edit.png`]: PNG });

    const res = await run(
      'edit', '-p', 'add a hat', '-i', img, '-m', mask,
      '--magic-prompt', 'OFF', '-n', '2', '--seed', '77', '--rendering-speed', 'TURBO',
      '--style-type', 'REALISTIC', '--style-preset', 'OIL_PAINTING'
    );
    expect([res, err()]).toEqual([{}, '']);

    const c = sent();
    expect(c.url.pathname).toBe('/v1/ideogram-v3/edit');
    expect(c.method).toBe('POST');
    expect(formFields(c, 'prompt')).toEqual(['add a hat']);
    expect(fileParts(c, 'image')).toHaveLength(1);
    expect(fileParts(c, 'mask')).toHaveLength(1);
    expect(formFields(c, 'magic_prompt')).toEqual(['OFF']);
    expect(formFields(c, 'num_images')).toEqual(['2']);
    expect(formFields(c, 'seed')).toEqual(['77']);
    expect(formFields(c, 'rendering_speed')).toEqual(['TURBO']);
    expect(formFields(c, 'style_type')).toEqual(['REALISTIC']);
    expect(formFields(c, 'style_preset')).toEqual(['OIL_PAINTING']);
    expect(out()).toContain('Generated 1 image(s) successfully');
    expectResultsSaved('edit-v3', 'edit', 'edit-v3');
  });

  it('defaults: magic_prompt AUTO, num_images 1, rendering_speed DEFAULT, no seed', async () => {
    const img = join(outDir, 'in.png');
    writeFileSync(img, PNG);
    route(genBody('edit'), { [`${CDN}/edit.png`]: PNG });
    await run('edit', '-p', 'x', '-i', img, '-m', img);
    const c = sent();
    expect(formFields(c, 'magic_prompt')).toEqual(['AUTO']);
    expect(formFields(c, 'num_images')).toEqual(['1']);
    expect(formFields(c, 'rendering_speed')).toEqual(['DEFAULT']);
    expect(formNames(c)).not.toContain('seed');
  });

  it('a missing mask file exits 1 before any API call', async () => {
    const img = join(outDir, 'in.png');
    writeFileSync(img, PNG);
    const res = await run('edit', '-p', 'x', '-i', img, '-m', join(outDir, 'nope.png'));
    expect(res.exit).toBe(1);
    expect(apiCalls()).toHaveLength(0);
  });
});

describe('remix', () => {
  it('posts to ideogram-v3/remix with --image-weight, --style-preset and --num-images mapped', async () => {
    const img = join(outDir, 'in.png');
    writeFileSync(img, PNG);
    route(genBody('remix'), { [`${CDN}/remix.png`]: PNG });

    const res = await run(
      'remix', '-p', 'watercolor', '-i', img, '--image-weight', '65', '-a', '16x9',
      '--negative-prompt', 'blur', '-n', '3', '--seed', '5', '--style-preset', 'ART_DECO',
      '--style-type', 'DESIGN', '--rendering-speed', 'QUALITY', '--magic-prompt', 'ON'
    );
    expect([res, err()]).toEqual([{}, '']);

    const c = sent();
    expect(c.url.pathname).toBe('/v1/ideogram-v3/remix');
    expect(formFields(c, 'prompt')).toEqual(['watercolor']);
    expect(fileParts(c, 'image')).toHaveLength(1);
    expect(formFields(c, 'image_weight')).toEqual(['65']);
    expect(formFields(c, 'aspect_ratio')).toEqual(['16x9']);
    expect(formFields(c, 'negative_prompt')).toEqual(['blur']);
    expect(formFields(c, 'num_images')).toEqual(['3']);
    expect(formFields(c, 'seed')).toEqual(['5']);
    expect(formFields(c, 'style_preset')).toEqual(['ART_DECO']);
    expect(formFields(c, 'style_type')).toEqual(['DESIGN']);
    expect(formFields(c, 'rendering_speed')).toEqual(['QUALITY']);
    expect(formFields(c, 'magic_prompt')).toEqual(['ON']);
    expectResultsSaved('remix-v3', 'remix', 'remix-v3');
  });

  it('omits image_weight when --image-weight is not given', async () => {
    const img = join(outDir, 'in.png');
    writeFileSync(img, PNG);
    route(genBody('remix'), { [`${CDN}/remix.png`]: PNG });
    await run('remix', '-p', 'x', '-i', img);
    expect(formNames(sent())).not.toContain('image_weight');
  });
});

describe('reframe', () => {
  it('posts a square image to ideogram-v3/reframe with the resolution and options', async () => {
    const img = join(outDir, 'sq.png');
    writeFileSync(img, SQUARE_PNG);
    route(genBody('reframe'), { [`${CDN}/reframe.png`]: PNG });

    const res = await run(
      'reframe', '-i', img, '-r', '1536x640', '-n', '2', '--seed', '3',
      '--rendering-speed', 'FLASH', '--style-preset', 'POP_ART'
    );
    expect([res, err()]).toEqual([{}, '']);

    const c = sent();
    expect(c.url.pathname).toBe('/v1/ideogram-v3/reframe');
    expect(fileParts(c, 'image')).toHaveLength(1);
    expect(formFields(c, 'resolution')).toEqual(['1536x640']);
    expect(formFields(c, 'num_images')).toEqual(['2']);
    expect(formFields(c, 'seed')).toEqual(['3']);
    expect(formFields(c, 'rendering_speed')).toEqual(['FLASH']);
    expect(formFields(c, 'style_preset')).toEqual(['POP_ART']);
    expectResultsSaved('reframe-v3', 'reframe', 'reframe-v3');
  });

  it('a non-square source exits 1 and calls nothing', async () => {
    // 2x1 PNG header (IHDR width 2, height 1); dimensions are read from the header.
    const wide = Buffer.from(SQUARE_PNG);
    wide.writeUInt32BE(2, 16);
    const img = join(outDir, 'wide.png');
    writeFileSync(img, wide);
    const res = await run('reframe', '-i', img, '-r', '1536x640');
    expect(res.exit).toBe(1);
    expect(err()).toContain('Image must be square');
    expect(apiCalls()).toHaveLength(0);
  });
});

describe('replace-background', () => {
  it('posts to ideogram-v3/replace-background with mapped options', async () => {
    const img = join(outDir, 'in.png');
    writeFileSync(img, PNG);
    route(genBody('bg'), { [`${CDN}/bg.png`]: PNG });

    const res = await run(
      'replace-background', '-p', 'a beach', '-i', img, '--magic-prompt', 'OFF',
      '-n', '4', '--seed', '11', '--rendering-speed', 'TURBO', '--style-preset', 'BLUE_SKY'
    );
    expect([res, err()]).toEqual([{}, '']);

    const c = sent();
    expect(c.url.pathname).toBe('/v1/ideogram-v3/replace-background');
    expect(formFields(c, 'prompt')).toEqual(['a beach']);
    expect(fileParts(c, 'image')).toHaveLength(1);
    expect(formFields(c, 'magic_prompt')).toEqual(['OFF']);
    expect(formFields(c, 'num_images')).toEqual(['4']);
    expect(formFields(c, 'seed')).toEqual(['11']);
    expect(formFields(c, 'rendering_speed')).toEqual(['TURBO']);
    expect(formFields(c, 'style_preset')).toEqual(['BLUE_SKY']);
    expectResultsSaved('replace-background-v3', 'bg', 'replace-background-v3');
  });
});

describe('describe', () => {
  it('posts image_file + describe_model_version to /describe, prints and saves the descriptions', async () => {
    const img = join(outDir, 'in.png');
    writeFileSync(img, PNG);
    route({ descriptions: [{ text: 'a red fox in snow' }, { text: 'a fox' }] });

    const res = await run('describe', '-i', img, '--describe-model-version', 'V_3');
    expect([res, err()]).toEqual([{}, '']);

    const c = sent();
    expect(c.url.pathname).toBe('/describe');
    expect(fileParts(c, 'image_file')).toHaveLength(1);
    expect(formFields(c, 'describe_model_version')).toEqual(['V_3']);
    expect(out()).toContain('1. a red fox in snow');
    expect(out()).toContain('2. a fox');

    const names = sub('describe');
    expect(names).toHaveLength(1);
    const meta = JSON.parse(readFileSync(join(outDir, 'describe', names[0]), 'utf8'));
    expect(meta.operation).toBe('describe');
    expect(meta.descriptions).toEqual(['a red fox in snow', 'a fox']);
  });

  it('omits describe_model_version when not given', async () => {
    const img = join(outDir, 'in.png');
    writeFileSync(img, PNG);
    route({ descriptions: [{ text: 'x' }] });
    await run('describe', '-i', img);
    expect(formNames(sent())).not.toContain('describe_model_version');
  });
});

describe('list-* commands', () => {
  it('constants have the documented sizes', () => {
    expect([STYLE_PRESETS.length, ASPECT_RATIOS.length, RESOLUTIONS.length]).toEqual([62, 15, 69]);
  });

  it('list-style-presets prints the count and every preset', async () => {
    const res = await run('list-style-presets');
    expect(res.exit).toBe(0);
    expect(out()).toContain(`(${STYLE_PRESETS.length} total)`);
    expect(out()).toContain('(62 total)');
    for (const p of STYLE_PRESETS) expect(out()).toContain(p);
  });

  it('list-aspect-ratios prints the count and every ratio', async () => {
    const res = await run('list-aspect-ratios');
    expect(res.exit).toBe(0);
    expect(out()).toContain('(15 total)');
    expect(out()).toContain(ASPECT_RATIOS.join(', '));
  });

  it('list-resolutions prints the count and the square resolutions', async () => {
    const res = await run('list-resolutions');
    expect(res.exit).toBe(0);
    expect(out()).toContain('(69 total)');
    const squares = RESOLUTIONS.filter((r) => {
      const [w, h] = r.split('x').map(Number);
      return w === h;
    });
    expect(squares.length).toBeGreaterThan(0);
    expect(out()).toContain(squares.join(', '));
  });
});
