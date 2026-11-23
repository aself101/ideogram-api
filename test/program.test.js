/**
 * The commander program (src/program.ts), driven in-process.
 *
 * createProgram() builds the real commands with no side effects, so each test
 * parses an argv with exitOverride, fetch stubbed (helpers/http.js) and DNS
 * mocked (result downloads go through the SSRF check), process.exit and the
 * console spied. A broken action wiring (wrong operation, wrong options) fails
 * here; the subprocess tests in cli.test.js only reach argument parsing.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

vi.mock('dns/promises', () => ({
  lookup: vi.fn(async () => ({ address: '8.8.8.8', family: 4 })),
}));

import { fetchMock, resetHttp, fakeResponse } from './helpers/http.js';
import { createProgram, main } from '../src/program.js';

const KEY = 'test-key-1234567890';
const CDN = 'https://cdn.ideogram.ai';
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

/** A decodable 1x1 PNG: the upscale command reads the source's dimensions from disk. */
const VALID_PNG = Buffer.from(
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

/** commander only copies exitOverride to subcommands created after it is set. */
function withExitOverride(cmd) {
  cmd.exitOverride();
  cmd.configureOutput({ writeOut: (s) => logs.push(s), writeErr: (s) => errors.push(s) });
  cmd.commands.forEach(withExitOverride);
  return cmd;
}

/**
 * Parse `args` after the global options. Resolves { exit } when the action called
 * process.exit, { error } when commander refused the argv, {} otherwise.
 */
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

/** API calls (api.ideogram.ai) answer from api(method, path, n); anything else is a download. */
function route({ api, files = {} }) {
  const polls = {};
  fetchMock.mockImplementation(async (url, init = {}) => {
    const u = new URL(url);
    if (u.host === 'api.ideogram.ai') {
      polls[u.pathname] = (polls[u.pathname] ?? 0) + 1;
      return fakeResponse(200, api(init.method, u.pathname, polls[u.pathname], u.searchParams));
    }
    if (!(url in files)) throw new Error(`unexpected download: ${url}`);
    return new Response(files[url]);
  });
}

const files = (sub) => readdirSync(join(outDir, sub));
const apiCalls = () => fetchMock.mock.calls.filter(([u]) => new URL(u).host === 'api.ideogram.ai');

beforeEach(() => {
  resetHttp();
  outDir = mkdtempSync(join(tmpdir(), 'ideogram-program-'));
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
  // Not vi.restoreAllMocks(): that would also restore the shared AbortSignal.timeout spy.
  spies.forEach((s) => s.mockRestore());
});

describe('createProgram', () => {
  it('has no side effects and returns a fresh program each call', () => {
    const a = createProgram();
    const b = createProgram();
    expect(a).not.toBe(b);
    expect(a.name()).toBe('ideogram');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(a.version()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('registers the v1, v2 and list commands', () => {
    const names = createProgram().commands.map((c) => c.name());
    for (const n of [
      'generate', 'edit', 'remix', 'reframe', 'replace-background', 'upscale', 'describe',
      'generate-v4', 'generate-v45', 'generate-v46', 'generate-svg', 'minimax-text-to-video',
      'get-generation', 'list-v4-resolutions', 'list-style-presets',
    ]) {
      expect(names).toContain(n);
    }
  });
});

describe('v1 commands', () => {
  it('generate runs end to end: posts the prompt, downloads the image, writes metadata', async () => {
    route({
      api: () => ({
        created: '2026-11-22T00:00:00Z',
        data: [{ url: `${CDN}/v1.png`, resolution: '1024x1024', seed: 5, is_image_safe: true }],
      }),
      files: { [`${CDN}/v1.png`]: PNG },
    });
    const res = await run('generate', '--prompt', 'a red fox', '--aspect-ratio', '1x1');
    expect(res).toEqual({});
    expect(err()).toBe('');

    const [[url, init]] = apiCalls();
    expect(url).toBe('https://api.ideogram.ai/v1/ideogram-v3/generate');
    expect(init.method).toBe('POST');
    expect(out()).toContain('All done! Processed 1 prompt(s)');

    const names = files('generate-v3');
    const png = names.find((n) => n.endsWith('.png'));
    expect(readFileSync(join(outDir, 'generate-v3', png))).toEqual(PNG);
    const meta = JSON.parse(readFileSync(join(outDir, 'generate-v3', names.find((n) => n.endsWith('.json'))), 'utf8'));
    expect(meta.operation).toBe('generate-v3');
    expect(meta.response.images[0]).toMatchObject({ index: 1, seed: 5 });
  });

  it('generate without --prompt exits 1 and calls nothing', async () => {
    const res = await run('generate');
    expect(res.exit).toBe(1);
    expect(err()).toContain('--prompt is required');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('upscale posts the image to the v2 upscaler and downloads the result', async () => {
    const src = join(outDir, 'in.png');
    writeFileSync(src, VALID_PNG);
    route({
      api: () => ({
        generation_id: 'gen_up',
        data: [{ url: `${CDN}/up.png`, resolution: '2048x2048', is_image_safe: true, seed: 1 }],
      }),
      files: { [`${CDN}/up.png`]: PNG },
    });
    const res = await run('upscale', '--image', src, '--upscale-factor', 'x2');
    expect([res, err()]).toEqual([{}, '']);
    const [[url, init]] = apiCalls();
    expect(url).toBe('https://api.ideogram.ai/v2/image/upscale/auto');
    expect(init.body.getAll('upscale_factor')).toEqual(['x2']);
    expect(files('upscale-auto').some((n) => n.endsWith('.png'))).toBe(true);
  });
});

describe('v2 commands', () => {
  it('generate-v4 --dry-run prints a price quote and generates nothing', async () => {
    route({
      api: () => ({
        object: 'price_quote',
        quantity: 1,
        billing_identifier: 'ideogram-4',
        usd_micros: 40000,
        credit_millis: 2000,
        qualifier: 'exact',
      }),
    });
    const res = await run('generate-v4', '--prompt', 'a cat', '--dry-run');
    expect(res).toEqual({});
    expect(apiCalls()).toHaveLength(1);
    expect(String(apiCalls()[0][0])).toContain('dry_run=true');
    expect(out()).toContain('Price quote (dry run');
    expect(existsSync(join(outDir, 'generate-v4'))).toBe(false);
  });

  it('generate-v46 downloads a synchronous result into generate-v46/', async () => {
    route({
      api: () => ({
        generation_id: 'gen46',
        seed: 9,
        data: [{ url: `${CDN}/p.png`, resolution: '1024x1024', seed: 9, is_image_safe: true }],
      }),
      files: { [`${CDN}/p.png`]: PNG },
    });
    const res = await run('generate-v46', '--prompt', 'a poster', '--size', 'auto_4k');
    expect(res).toEqual({});
    const [[url]] = apiCalls();
    expect(new URL(url).pathname).toBe('/v2/image/generate/ideogram-4-6');
    expect(files('generate-v46').some((n) => n.endsWith('.png'))).toBe(true);
    expect(out()).toContain('Saved image 1/1');
  });

  it('generate-v4 rejects an out-of-range --num-images with exit 1 and no request', async () => {
    const res = await run('generate-v4', '--prompt', 'a cat', '--num-images', '99');
    expect(res.exit).toBe(1);
    expect(err()).toContain('numImages must be an integer between');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('generate-svg --wait polls the generation and saves the SVG', async () => {
    route({
      api: (method) =>
        method === 'POST'
          ? { generation_id: 'svg1' }
          : {
              generation_id: 'svg1',
              status: 'completed',
              created: 't',
              data: [{ object_type: 'svg.generation', url: `${CDN}/logo.svg`, asset_id: 'a', width: 8, height: 8 }],
            },
      files: { [`${CDN}/logo.svg`]: '<svg/>' },
    });
    const res = await run('generate-svg', '--prompt', 'a logo', '--wait', '--poll-interval', '1');
    expect(res).toEqual({});
    const svg = files('generate-svg').find((n) => n.endsWith('.svg'));
    expect(readFileSync(join(outDir, 'generate-svg', svg), 'utf8')).toBe('<svg/>');
    expect(out()).toContain('Saved SVG 1/1');
  });

  it('minimax-text-to-video --wait saves the video', async () => {
    route({
      api: (method) =>
        method === 'POST'
          ? { generation_id: 'vid1' }
          : {
              generation_id: 'vid1',
              status: 'completed',
              created: 't',
              data: [{ object_type: 'video.generation', url: `${CDN}/clip.mp4`, resolution: '720p', duration: 5 }],
            },
      files: { [`${CDN}/clip.mp4`]: 'VIDEO' },
    });
    const res = await run('minimax-text-to-video', '--prompt', 'a boat', '--wait', '--poll-interval', '1');
    expect(res).toEqual({});
    const mp4 = files('minimax-h3-text-to-video').find((n) => n.endsWith('.mp4'));
    expect(readFileSync(join(outDir, 'minimax-h3-text-to-video', mp4), 'utf8')).toBe('VIDEO');
  });

  it('get-generation fetches the status and downloads a completed result', async () => {
    route({
      api: (method, path) => {
        expect(method).toBe('GET');
        expect(path).toBe('/v2/generations/gen_x');
        return {
          generation_id: 'gen_x',
          status: 'completed',
          created: 't',
          data: [{ url: `${CDN}/g.png`, is_image_safe: true, resolution: '1024x1024', seed: 1 }],
        };
      },
      files: { [`${CDN}/g.png`]: PNG },
    });
    const res = await run('get-generation', 'gen_x');
    expect(res).toEqual({});
    expect(out()).toContain('Generation gen_x: completed');
    expect(files('generations').some((n) => n.endsWith('.png'))).toBe(true);
  });
});

describe('list commands and --examples', () => {
  it('list-v4-resolutions prints the table and exits 0', async () => {
    const res = await run('list-v4-resolutions');
    expect(res.exit).toBe(0);
    expect(out()).toContain('IDEOGRAM 4.0 RESOLUTIONS');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('list-style-presets prints the presets and exits 0', async () => {
    const res = await run('list-style-presets');
    expect(res.exit).toBe(0);
    expect(out()).toContain('AVAILABLE STYLE PRESETS');
  });

  it('main --examples prints the examples and exits 0 without parsing commands', async () => {
    await expect(main(['node', 'ideogram', '--examples'])).rejects.toMatchObject({ code: 0 });
    expect(out()).toContain('generate-v46');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('main with no arguments prints help', async () => {
    const help = vi.spyOn(createProgram().constructor.prototype, 'help').mockImplementation(() => {
      throw new ExitSignal(0);
    });
    try {
      await expect(main(['node', 'ideogram'])).rejects.toMatchObject({ code: 0 });
      expect(help).toHaveBeenCalled();
    } finally {
      help.mockRestore();
    }
  });
});

describe('invalid input', () => {
  it('an unknown option is refused by commander', async () => {
    const res = await run('generate', '--bogus');
    expect(res.error?.code).toBe('commander.unknownOption');
    expect(err()).toContain("unknown option '--bogus'");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a missing required option is refused by commander', async () => {
    const res = await run('generate-v4');
    expect(res.error?.code).toBe('commander.missingMandatoryOptionValue');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('an unknown command is refused', async () => {
    const res = await run('no-such-command');
    expect(res.error?.code).toBe('commander.unknownCommand');
  });
});
