# Ideogram API for Node.js: images, SVG and video

[![npm version](https://img.shields.io/npm/v/ideogram-api.svg)](https://www.npmjs.com/package/ideogram-api)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js Version](https://img.shields.io/node/v/ideogram-api)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)

A Node.js library and command-line tool (`ideogram`) for the [Ideogram API](https://ideogram.ai/api): image generation, editing and manipulation with Ideogram 3.0 (v1 API), Ideogram 4.0 / 4.5 / 4.6, automatic model selection and upscaling (v2 API), SVG generation with Ideogram Vector 1, and video with MiniMax H3 and Seedance 2.5. Requires Node.js 22 or later. The package is ESM-only: `import` it; `require('ideogram-api')` fails with `ERR_PACKAGE_PATH_NOT_EXPORTED`. HTTP goes through Node's built-in `fetch`.

The Ideogram API is paid and every real call is billed. Read [Before you spend](#before-you-spend) first.

## Table of Contents

- [Quick Start](#quick-start)
- [Before you spend](#before-you-spend)
- [Ideogram 4.x, SVG and Video (v2 API)](#ideogram-4x-svg-and-video-v2-api)
- [Setup](#setup)
- [Ideogram 3.0 operations (v1 API)](#ideogram-30-operations-v1-api)
- [CLI reference](#cli-reference)
- [Library modules](#library-modules)
- [Security](#security)
- [Troubleshooting](#troubleshooting)
- [Migrating from 1.x](#migrating-from-1x)
- [Changelog](#changelog)
- [Links, contributing and license](#links-contributing-and-license)

## Quick Start

Install and set a key (details in [Setup](#setup)):

```bash
npm install -g ideogram-api
export IDEOGRAM_API_KEY="your-api-key"
```

Price a request first. A dry run is priced, not run, and bills nothing:

```bash
ideogram generate-v46 --prompt "A serene mountain landscape" --quality low --dry-run
```

Then run it for real (billed):

```bash
ideogram generate-v46 --prompt "A serene mountain landscape" --quality low
```

The same from code:

```typescript
import { IdeogramAPI, extractImageUrls, isPriceQuote } from 'ideogram-api';

const api = new IdeogramAPI(process.env.IDEOGRAM_API_KEY!);

const quote = await api.generateV46({ prompt: 'A serene mountain landscape', quality: 'low', dryRun: true });
if (isPriceQuote(quote)) console.log(`$${quote.usd_micros / 1e6}`);

const result = await api.generateV46({ prompt: 'A serene mountain landscape', quality: 'low' }); // billed
console.log(extractImageUrls(result));
```

Ideogram 3.0 (`generate`, `edit`, `remix`, ...) is on the older v1 API and has no dry run: see [Ideogram 3.0 operations](#ideogram-30-operations-v1-api).

## Before you spend

- **Dry runs are priced, not run.** Every v2 method and command takes `dryRun: true` / `--dry-run`. The Ideogram 3.0 operations do not. See [Dry runs and prices](#dry-runs-and-prices).
- **A request that fails after it was sent may still have been billed.** See [Errors](#errors) for how to resume or check usage instead of resubmitting.
- **Quote each CLI prompt.** On v1 `generate`, `--prompt` takes one or more values: `--prompt "a red fox" "a blue owl"` makes two paid generations, while an unquoted `--prompt a red fox` would make three. Several single-word prompts are therefore refused as a likely unquoted prompt unless you pass `--allow-single-word-prompts`. Every command rejects excess arguments (exit 1, nothing sent); `ideogram generate-v46 -p A fox runs` used to send, and bill, the prompt "A".
- **CLI disk and billing guarantees.**
  - Before writing anything to disk, the CLI prints the generation id and every result URL, so a disk error cannot lose a billed result.
  - Every command writes the metadata file (generation id and every URL where there is one) before downloading, so a failed download keeps the record. Metadata files are written atomically (temp file, then rename), so a failed write such as a full disk leaves the previous record intact.
  - Output files never overwrite each other: each item gets its own name (the index survives truncation of long prompts), and an existing file is never replaced.
  - A request that returns zero results prints the generation id, writes the metadata file, reports an error and exits 1.
  - A `--dry-run` that comes back with a real result is reported loudly and saved, and the command exits non-zero. One answered with neither results nor a generation id is saved to a metadata file and reported (exit 1).
  - If every file was saved and only the final metadata rewrite fails, the CLI says the result was generated, lists the saved files, says the metadata file still holds the earlier record and that nothing needs retrying, and exits 1.
  - If the CLI cannot remove a partial or empty output file after a failed write, it warns and names the file. `describe` removes its placeholder file when the metadata write fails.

## Ideogram 4.x, SVG and Video (v2 API)

Ideogram's v2 API puts each model behind its own endpoint. This package covers 16 of them plus polling:

| Model / task | Method | CLI command | Body | Response |
|---|---|---|---|---|
| Ideogram 4.0 | `generateV4` | `generate-v4` | JSON | images (or `async`) |
| Ideogram 4.0 transparent | `generateV4Transparent` | `generate-transparent` | JSON | images (or `async`) |
| Ideogram 4.0 custom model | `generateV4Custom` | `generate-custom` | JSON | images (or `async`) |
| Ideogram 4.5 generate / edit | `generateV45` | `generate-v45` | multipart | images (or `async`) |
| Ideogram 4.6 generate / edit | `generateV46` | `generate-v46` | multipart | images (or `async`) |
| Automatic model selection | `generateAuto` | `generate-auto` | multipart | images (or `async`) |
| Ideogram 4.5 precise edit | `preciseEditV45` | `precise-edit` | multipart | images (or `async`) |
| Ideogram 4.6 precise edit | `preciseEditV46` | `precise-edit-v46` | multipart | images (or `async`) |
| Upscale (automatic model) | `upscale` | `upscale` | multipart | image (or `async`) |
| SVG (Ideogram Vector 1) | `generateSvg` | `generate-svg` | multipart | `generation_id` |
| MiniMax H3 text to video | `minimaxH3TextToVideo` | `minimax-text-to-video` | JSON | `generation_id` |
| MiniMax H3 image to video | `minimaxH3ImageToVideo` | `minimax-image-to-video` | multipart | `generation_id` |
| MiniMax H3 reference to video | `minimaxH3ReferenceToVideo` | `minimax-reference-to-video` | multipart | `generation_id` |
| Seedance 2.5 text to video | `seedance25TextToVideo` | `seedance-text-to-video` | JSON | `generation_id` |
| Seedance 2.5 image to video | `seedance25ImageToVideo` | `seedance-image-to-video` | multipart | `generation_id` |
| Seedance 2.5 reference to video | `seedance25ReferenceToVideo` | `seedance-reference-to-video` | multipart | `generation_id` |
| Poll any async generation | `getGeneration`, `waitForGeneration` | `get-generation <id> [--wait]` | | status, then results |

The rest of the v2 surface is **not covered**: about 65 more endpoints (Ideogram 2/3 on v2, remix, inpaint, reframe, the per-model upscalers (Topaz, Nano Banana Pro), Kling and Seedance 2 video, GPT-image, Nano Banana, vectorize, layerize, the design tools, and account endpoints). The 3.0 operations stay on the v1 API.

**Naming.** v2 image methods are verb-first (`generateV46`, `preciseEditV46`); video methods are named after the provider model (`minimaxH3TextToVideo`), mirroring Ideogram's endpoint names. v2 field names are camelCase in this library and lowercase-valued, unlike 3.0: `magicPrompt: 'auto'`, `renderingSpeed: 'turbo'`.

**Validation.** Each endpoint has its own limits. The CLI validates every request before sending it (`validateOperationParams()` for 3.0, `validateV2Params()` for v2). The library does not validate v2 requests for you: call `validateV2Params(operation, params)` from [`ideogram-api/config`](#library-modules) before you send.

### Examples

These reuse this setup:

```typescript
import { IdeogramAPI, extractImageUrls, extractSvgUrls } from 'ideogram-api';

const api = new IdeogramAPI(process.env.IDEOGRAM_API_KEY!);
```

```typescript
// Ideogram 4.0 / 4.5 / 4.6 generate
const v4 = await api.generateV4({ prompt: 'A lighthouse at dawn', renderingSpeed: 'turbo' });
const v45 = await api.generateV45({ prompt: 'A lighthouse at dawn', quality: 'low' });
const v46 = await api.generateV46({ prompt: 'A lighthouse at dawn', quality: 'low', size: 'auto_2k' });
console.log(extractImageUrls(v46));

// Automatic model selection: Ideogram picks the model for the request
const auto = await api.generateAuto({ prompt: 'A product photo of a ceramic mug', aspectRatio: '16x9', styleType: 'realistic' });

// Precise edit (4.6): the output keeps the input's width and height
const edited = await api.preciseEditV46({ prompt: 'Make the sky stormy', image: './lighthouse.png', mask: './sky_mask.png' });

// SVG (always asynchronous)
const svgAck = await api.generateSvg({ prompt: 'A minimal fox logo', useGradient: false });
const svg = await api.waitForGeneration(svgAck.generation_id);
console.log(extractSvgUrls(svg));
```

The same on the CLI (add `--dry-run` to any of them to price first):

```bash
ideogram generate-v4 --prompt "A lighthouse at dawn" --rendering-speed turbo
ideogram generate-v45 --prompt "A lighthouse at dawn" --quality low
ideogram generate-v46 --prompt "A lighthouse at dawn" --quality low --size auto_2k
ideogram generate-auto --prompt "A product photo of a ceramic mug" --aspect-ratio 16x9 --style-type realistic
ideogram precise-edit-v46 --prompt "Make the sky stormy" --image ./lighthouse.png --mask ./sky_mask.png
ideogram generate-svg --prompt "A minimal fox logo" --no-gradient --wait
```

### Upscale

Enlarges an image 2x, 4x or 8x (`upscaleFactor: 'x2' | 'x4' | 'x8'`, default `x2`). Ideogram picks the upscaling model per request. The input is at most 50MB and the output may not exceed 8192px on either side. It supports `seed`, `async`, `webhookUrl`, `dryRun` and `timeoutMs`. It has no `prompt`, `resemblance`, `detail`, `magicPromptOption` or `numImages`, and passing one throws, because the API would otherwise ignore it without a word.

`upscale()` calls `/v2/image/upscale/auto`. The v1 `/upscale` endpoint that 1.x used was retired by Ideogram: on 2026-11-22 it answered every request with 400 "The selected model version is no longer supported".

```typescript
const big = await api.upscale({ image: './lighthouse.png', upscaleFactor: 'x4' });
console.log(`${big.width}x${big.height}`, extractImageUrls(big));
```

```bash
ideogram upscale --image ./lighthouse.png --upscale-factor x4
```

It returns an `UpscaleResponse` (`generation_id`, `seed`, `width`, `height`, and `data` when synchronous), or a `PriceQuote` for a dry run.

### Dry runs and prices

A dry run asks Ideogram to price the request without running it. The result is a `PriceQuote`. The library checks that a quote came back: if Ideogram returns a real result instead, it throws `IdeogramAPIError` with `code: 'EDRYRUNIGNORED'` and `possiblyBilled: true`, plus `generationId` when present and the returned response as `error.result`, so nothing paid for is lost. This was verified live on 2026-11-22 for every endpoint except generate-custom, which was not priced.

```typescript
import { IdeogramAPI, isPriceQuote } from 'ideogram-api';

const api = new IdeogramAPI(process.env.IDEOGRAM_API_KEY!);
const quote = await api.seedance25TextToVideo({ prompt: 'A red fox in snow', resolution: '1080p', duration: 10, dryRun: true });
if (isPriceQuote(quote)) console.log(`$${quote.usd_micros / 1e6}`);
```

Video is priced per second of output and per resolution tier, and is far more expensive than images. Prices measured with dry runs on 2026-11-22, which matched the amounts later billed for the same requests:

| Request | Price |
|---|---|
| Ideogram 4.6, `very_low`, 2K | $0.008 |
| Ideogram 4.0 turbo / 4.0 transparent turbo 1K / 4.5 `low` | $0.03 |
| Ideogram 4.6 `low`, `auto_4k` | $0.06 |
| SVG, `low` | $0.13 |
| MiniMax H3, 480P, 5 s | $0.25 |
| Seedance 2.5, 480p, 4 s | $0.41 |
| Seedance 2.5, 720p, 4 s | $0.92 |
| Seedance 2.5 image / reference to video, 720p, duration omitted | $6.93 |

Two things the quotes showed that Ideogram's docs do not say:

- **An omitted Seedance `duration` is quoted at the maximum** for image and reference to video (30 s: the $6.93 row), but at about 5 s for text to video. Set `duration` when cost matters.
- **`generateAudio` did not change the quote or the bill** at 480p / 4 s, although Ideogram's API docs say audio "roughly doubles the provider cost". The returned video did carry an audio track.

### Sync, async and always-async

- **Synchronous requests cannot be recovered.** This covers the 3.0 operations and the v2 image endpoints unless you set `async`. If one fails after it was sent (timeout, reset, unreadable body) there is no generation id to fetch the result with, and it may still have been billed. For costly or long requests use `async: true` and poll.
- **v2 image endpoints** return the images by default. Set `async: true` (CLI `--async`) to get a `generation_id` back at once; `waitForGeneration(id)` polls until it completes. `webhookUrl` asks Ideogram to POST the result to you instead.
- **SVG and video are always asynchronous.** They resolve to `{ generation_id, created? }`. Collect the result with `waitForGeneration`, then `extractSvgUrls` / `extractVideoUrls`. On the CLI, `--wait` polls and downloads (default poll interval 5 s, give-up time 30 minutes); the job keeps running if you stop waiting, and `get-generation <id> --wait` picks it up later.

```typescript
import { IdeogramAPI, extractVideoUrls } from 'ideogram-api';

const api = new IdeogramAPI(process.env.IDEOGRAM_API_KEY!);
const ack = await api.minimaxH3ImageToVideo({ prompt: 'The camera pans right', image: './beach.png', resolution: '768P' });
const done = await api.waitForGeneration(ack.generation_id, { intervalMs: 5000, timeoutMs: 30 * 60 * 1000 });
console.log(extractVideoUrls(done));
```

`waitForGeneration` defaults to a 2 s poll interval and a 10-minute limit, which a long video can exceed; pass `timeoutMs`. Videos and SVGs are downloaded as streams (`downloadToFile` in `ideogram-api/utils`), not buffered in memory; if a download fails or exceeds its size cap, `downloadToFile` removes the partial file.

### Model notes

- **Ideogram 4.6 vs 4.5.** Same fields. 4.6 renders exact sizes up to 4096x4096 (8192 per side), with no preset list; adds `size: 'auto_2k' | 'auto_4k'` (no `auto_4k` at `very_low`); runs `quality: 'very_low'` without source images (capped at 2048x2048 and 4608 per side); and its precise edit bounds a whole-image edit at 4096x4096 instead of 2048x2048.
- **Precise edit.** The output keeps the input's exact width and height. `contextWindow` defaults to `'auto'`: a region around the mask, or the whole image when there is no mask. An image larger than the model's bound comes back scaled down unless the edit is confined to a region.
- **Masks: observed limitation.** The precise-edit endpoints read and validate the mask: they reject one whose size differs from the image, or one that is all black or all white. In live edits on 2026-11-22, though, the mask did not confine the change: in 6 of 7 masked edits (4.5 generate, 4.5 and 4.6 precise edit) the edit landed where the prompt pointed, in white ("keep") areas, and left the black area untouched. The seventh agreed with its mask only because the prompt pointed into it. Check results if you rely on a mask to protect part of an image. The 3.0 `edit` mask was not tested.
- **Automatic model selection.** `styleType` and `colorPalette` (a preset name such as `'ember'`, or `{ members: [{ color_hex: '#ff0000' }] }`) narrow the choice to models that support them, and cannot be combined with source images. There is no `private` field any more: Ideogram removed it, and the API silently ignores fields it does not know.
- **SVG.** `imageAssetIdentifiers` references existing Ideogram assets and takes priority over uploaded `images`. `useGradient: false` (`--no-gradient`) gives flat colors only.
- **Video.** MiniMax H3 spells resolutions in uppercase (`480P`, `768P`, `2K`, `4K`; the last two are upscaled from 768P), takes 5-15 s, and its reference mode accepts up to 3 MP3/WAV audios (which need a reference image). Seedance 2.5 spells them in lowercase (`480p`, `720p`, `1080p`), takes 4-30 s, and its reference mode needs at least one image. In live tests every MiniMax H3 video carried an audio track, although MiniMax has no audio option.

### Errors

Every failure after a request was sent throws `IdeogramAPIError` (a subclass of `Error`), including a malformed JSON body, a timeout while reading the body, a non-JSON `Content-Type`, and a response body over 100MB.

| Field | Meaning |
|---|---|
| `status` | The HTTP status, when the API answered. |
| `rejectReason`, `maxInflightRequests` | Why a v2 402 or 429 was refused (`insufficient_funds`, `inflight_limit`, ...). |
| `failureReason` | From `waitForGeneration`: why an async generation failed (e.g. `content_policy_violation`). |
| `generationStatus` | From `waitForGeneration`: `'failed'` when the API reported the generation as failed, even if it sent no `failureReason`. |
| `code` | A client-side classification: a network error code when no response arrived (`ECONNRESET`, `ETIMEDOUT` for a timeout, ...), or `ERESPONSETOOLARGE` / `EDRYRUNIGNORED`. |
| `possiblyBilled` | `true` when the request, or the generation this error concerns, may have been charged. Every `waitForGeneration` error has it `true`, because the generation was already submitted. |
| `generationId` | Set on every `waitForGeneration` error. Resume with it; never resubmit. |
| `resumable` | `true` when calling `getGeneration` / `waitForGeneration` again with `generationId` can still succeed: no response (network error or timeout), 5xx, the wait deadline expiring ("Timed out after ..."), a throwing `onPoll` callback (rethrown with `generationId` and the callback's error as `cause`), and 401/403 once the key is fixed. `false` for a failed generation, and for 404, 400 and other non-429 4xx during polling. |
| `result` | With `EDRYRUNIGNORED`: the response the API returned instead of a quote. |

```typescript
import { IdeogramAPIError } from 'ideogram-api';

try {
  await api.waitForGeneration(id);
} catch (e) {
  if (!(e instanceof IdeogramAPIError)) throw e;
  if (e.resumable) {
    // resume: api.waitForGeneration(e.generationId!)
  } else if (e.possiblyBilled) {
    // check your usage before retrying
  } else {
    // fix the request and retry
  }
}
```

Common statuses: 400 invalid parameters; 401 invalid API key; 402 (v2) out of credits or quota, see `rejectReason`; 403 no access to this model (e.g. a custom model you do not own); 404 unknown generation id or missing asset; 422 validation failed, or (v2) a rule such as `style_type` with source images; 429 rate limit exceeded (on v2, `rejectReason` says which limit); 5xx Ideogram-side error.

On the CLI, a failed command prints the error, then the resume command (`ideogram get-generation <id> --wait`, or `ideogram get-generation --wait -- <id>` when the id starts with `-`) when the error is `resumable`, or otherwise "This request may have run and been billed. Check your usage before retrying." when it is `possiblyBilled`. `get-generation <id>` exits 1 when the generation failed, with or without `--wait`.

**A request with no response may still have been billed.** On 2026-11-22 one `generate-auto` request failed client-side with no response and was charged all the same.

Timeouts and poll intervals (`timeoutMs`, `intervalMs`; CLI `--timeout`, `--poll-interval`, `--wait-timeout`) must be whole milliseconds from 1 to 2147483647; out-of-range values are rejected before any request is sent. `waitForGeneration`'s 429 backoff doubles the interval, at least 1 s and at most 30 s, and never polls sooner than the current interval.

**Trust model.** Responses are checked to be JSON objects. Their field shapes are typed but not validated at runtime, so a change on Ideogram's side shows up as missing fields rather than as an error.

## Setup

**Requirements:** Node.js >= 22.0.0, an ES module project, and an Ideogram API key from [ideogram.ai/api](https://ideogram.ai/api).

**Install.**

```bash
npm install -g ideogram-api   # the CLI
npm install ideogram-api      # the library, in your project
```

From source: `git clone https://github.com/aself101/ideogram-api.git && cd ideogram-api && npm install && npm link`.

**Authentication.** The CLI looks for the key in this order:

1. `--api-key YOUR_KEY` (`ideogram --api-key YOUR_KEY generate --prompt "landscape"`)
2. `IDEOGRAM_API_KEY` in the environment
3. `IDEOGRAM_API_KEY` in a `.env` file in the current directory
4. `IDEOGRAM_API_KEY` in `~/.ideogram/.env` (for global installs): `mkdir -p ~/.ideogram && echo "IDEOGRAM_API_KEY=your_api_key" > ~/.ideogram/.env`

The CLI reads only `IDEOGRAM_API_KEY` from `.env` files. **The library never reads `.env` files**: pass the key to `new IdeogramAPI(apiKey)`, or set the variable yourself (e.g. `node --env-file=.env app.js`).

**Other environment variables** (real environment only): `IDEOGRAM_OUTPUT_DIR` (default `datasets/ideogram`; CLI `--output-dir`) and `NODE_ENV=production` (enables [error sanitization](#security)).

## Ideogram 3.0 operations (v1 API)

Six operations on Ideogram's v1 API. Values are uppercase here (`renderingSpeed: 'QUALITY'`), unlike v2. These calls are synchronous and have no dry run, so each one is billed when sent. `prompt` is at most 10,000 characters; `image` and `mask` are a file path or a `Buffer`.

| Operation | CLI | Library | Required | Optional |
|---|---|---|---|---|
| Text to image | `generate` | `generate` | `prompt` | `resolution`, `aspectRatio`, `renderingSpeed`, `magicPrompt`, `negativePrompt`, `numImages`, `seed`, `styleType`, `stylePreset`, `colorPalette` |
| Edit with a mask | `edit` | `edit` | `prompt`, `image`, `mask` | `magicPrompt`, `numImages`, `seed`, `renderingSpeed`, `styleType`, `stylePreset` |
| Remix (image to image) | `remix` | `remix` | `prompt`, `image` | `imageWeight`, `resolution`, `aspectRatio`, `renderingSpeed`, `magicPrompt`, `negativePrompt`, `numImages`, `seed`, `styleType`, `stylePreset`, `colorPalette` |
| Reframe | `reframe` | `reframe` | `image` (square), `resolution` | `numImages`, `seed`, `renderingSpeed`, `stylePreset` |
| Replace background | `replace-background` | `replaceBackground` | `prompt`, `image` | `magicPrompt`, `numImages`, `seed`, `renderingSpeed`, `stylePreset` |
| Describe | `describe` | `describe` | `image` | `describeModelVersion` |

Values: `renderingSpeed` is `FLASH`, `TURBO`, `DEFAULT` or `QUALITY`; `magicPrompt` is `AUTO`, `ON` or `OFF` (CLI default `AUTO`); `styleType` is `AUTO`, `GENERAL`, `REALISTIC`, `DESIGN` or `FICTION`; `stylePreset` is one of 62 [presets](#style-presets); `numImages` is 1-8; `imageWeight` is 0-100; `describeModelVersion` is `V_2` or `V_3`. `resolution` is e.g. `1024x1024` and `aspectRatio` e.g. `16x9` (see the [helper commands](#helper-commands)). CLI flags are the kebab-case names (`--rendering-speed`, `--style-preset`, `--num-images`, `--image-weight`, `--describe-model-version`); `prompt`, `image` and `mask` are also `-p`, `-i` and `-m`.

`generate`, `edit`, `remix`, `reframe` and `replaceBackground` return a `GenerationResponse` (read it with `extractImages`); `describe` returns a `DescribeResponse` (read it with `extractDescriptions`). Reframe accepts only perfectly square input images (checked locally). The mask for `edit` is intended as black = edit, white = keep; the 3.0 mask was not tested (see Masks under [Model notes](#model-notes) for what was observed on v2).

```bash
ideogram generate --prompt "Vintage travel poster of Tokyo" --style-preset TRAVEL_POSTER --rendering-speed QUALITY --aspect-ratio 16x9 --num-images 2
ideogram edit --prompt "Change the sky to golden hour" --image ./landscape.jpg --mask ./sky_mask.png
ideogram remix --prompt "Transform into watercolor painting" --image ./photo.jpg --image-weight 75 --style-preset WATERCOLOR
ideogram reframe --image ./square_1024x1024.jpg --resolution 1536x640
ideogram replace-background --prompt "Tropical beach at golden hour" --image ./portrait.jpg --num-images 3
ideogram describe --image ./photo.jpg
```

```typescript
import { IdeogramAPI, extractImages, extractDescriptions } from 'ideogram-api';

const api = new IdeogramAPI(process.env.IDEOGRAM_API_KEY!);

const generated = await api.generate({
  prompt: 'Vintage travel poster of Tokyo',
  stylePreset: 'TRAVEL_POSTER',
  renderingSpeed: 'QUALITY',
  aspectRatio: '16x9',
  numImages: 2
});
console.log(extractImages(generated)); // [{ url, resolution, seed, is_image_safe }, ...]

await api.edit({ prompt: 'Change the sky to golden hour', image: './landscape.jpg', mask: './sky_mask.png' });
await api.remix({ prompt: 'Transform into watercolor painting', image: './photo.jpg', imageWeight: 75, stylePreset: 'WATERCOLOR' });
await api.reframe({ image: './square_1024x1024.jpg', resolution: '1536x640' });
await api.replaceBackground({ prompt: 'Tropical beach at golden hour', image: './portrait.jpg', numImages: 3 });

const described = await api.describe({ image: './photo.jpg', describeModelVersion: 'V_3' });
console.log(extractDescriptions(described));
```

**Batch generation.** The CLI's v1 `generate` takes several prompts and runs them sequentially (quote each one, see [Before you spend](#before-you-spend)):

```bash
ideogram generate --prompt "A red sports car" --prompt "A blue sedan" --prompt "A green SUV" --aspect-ratio 16x9 --style-preset DRAMATIC_CINEMA
```

**A multi-step workflow** (generate, upscale the first image, describe the result):

```typescript
import { IdeogramAPI, extractImages, extractImageUrls, extractDescriptions } from 'ideogram-api';

const api = new IdeogramAPI(process.env.IDEOGRAM_API_KEY!);

const generated = await api.generate({
  prompt: 'Portrait of a mountain climber at summit',
  aspectRatio: '1x1',
  renderingSpeed: 'QUALITY',
  stylePreset: 'DRAMATIC_CINEMA'
});
const [first] = extractImages(generated);

const upscaled = await api.upscale({
  image: Buffer.from(await fetch(first.url).then(r => r.arrayBuffer())),
  upscaleFactor: 'x2'
});

const [upscaledUrl] = extractImageUrls(upscaled);
const described = await api.describe({
  image: Buffer.from(await fetch(upscaledUrl).then(r => r.arrayBuffer()))
});
console.log(extractDescriptions(described)[0]);
```

## CLI reference

```bash
ideogram <command> [options]
ideogram --help             # also the default with no arguments
ideogram --examples         # usage examples
ideogram <command> --help   # every option a command takes
```

Global options (before the command): `--api-key <key>`, `-o, --output-dir <path>` (default `datasets/ideogram`), `--log-level <level>` (`debug`, `info`, `warn`, `error`; default `info`), `--examples`, `--version` (prints `unknown` if it cannot read its package.json).

**Commands.** The six [3.0 commands](#ideogram-30-operations-v1-api) (`generate`, `edit`, `remix`, `reframe`, `replace-background`, `describe`); the [v2 commands](#ideogram-4x-svg-and-video-v2-api) (including `upscale` and `get-generation`); and the [helper commands](#helper-commands). Help text names the model for unversioned commands: `precise-edit` is Ideogram 4.5, `generate-transparent` and `generate-custom` are 4.0, `minimax-*` is MiniMax H3 and `seedance-*` is Seedance 2.5.

### v2 command options

The v2 commands share these options (each command takes the subset that applies):

```text
--dry-run                      Price the request without running it
--async                        Image commands: return a generation_id at once (add --wait to poll and download)
--wait                         SVG and video (always async): poll, then download; get-generation: poll until done
--poll-interval <ms>           Poll interval for --wait (default 2000 for image and get-generation, 5000 for SVG and video)
--wait-timeout <ms>            SVG, video and get-generation: give up waiting after this long (default 1800000; the job keeps running)
--timeout <ms>                 Request timeout
--webhook-url <url>            HTTPS URL Ideogram POSTs the finished result to
--copyright-detection          Run copyright detection (4.x generate and precise-edit commands)
--context-window <window>      precise-edit, precise-edit-v46: auto (default), none, or y_min,x_min,y_max,x_max
--asset <TYPE:ID[:COLLECTION]> generate-svg: existing Ideogram assets as sources (take priority over --images)
--no-gradient                  generate-svg: flat colors only
--upscale-factor <x2|x4|x8>    upscale (default x2)
```

Millisecond options take whole milliseconds from 1 to 2147483647. Video options (`minimax-*`, `seedance-*`):

```text
-d, --duration <seconds>       MiniMax H3 5-15 (default 5); Seedance 2.5 4-30. An omitted duration is priced at the maximum for image- and reference-to-video
-r, --resolution <tier>        MiniMax H3 480P | 768P | 2K | 4K; Seedance 2.5 480p | 720p | 1080p
--end-image <path>             minimax-image-to-video, seedance-image-to-video: last frame
--reference-images <paths...>  Reference commands (also precise-edit): references, in prompt order
--reference-audios <paths...>  Reference commands: MP3 or WAV, in prompt order (need a reference image)
--generate-audio               Seedance commands: generate an audio track (price it with --dry-run)
--prompt-expansion-mode <m>    minimax-reference-to-video: disabled | fast | balanced | quality
```

A generation id that starts with `-` goes after `--`: `ideogram get-generation --wait -- <id>`. A missing input file is reported as "Image file not found: <path>".

### Helper commands

```bash
ideogram list-style-presets     # the 62 style presets
ideogram list-aspect-ratios     # the 15 aspect ratios
ideogram list-resolutions       # the 69 resolutions, grouped portrait / square / landscape
ideogram list-v4-resolutions    # the Ideogram 4.0 resolutions (also the 4.5 presets)
```

Aspect ratios: 1x1, 10x16, 16x10, 9x16, 16x9, 3x2, 2x3, 4x5, 5x4, 9x21, 21x9, 1x3, 3x1, 4x3, 3x4.

### Output

Results and metadata are organized by operation under the output directory:

```text
datasets/ideogram/
├── generate-v3/
│   ├── 20250120_143022_serene-mountain-landscape.png
│   └── 20250120_143022_serene-mountain-landscape.json
├── edit-v3/  remix-v3/  reframe-v3/  replace-background-v3/
├── upscale-auto/
├── describe/
│   └── 20250120_144000_description.json
├── generate-v46/                      # v2 commands: one folder per operation
├── seedance-2-5-text-to-video/        # SVG and video results saved with --wait
│   ├── 20261122_184617_a-red-fox.mp4
│   └── 20261122_184618_a-red-fox.json
└── generations/                       # results fetched with get-generation
```

Each result has a JSON metadata file. 3.0 commands record `response.images` and `imageCount`:

```json
{
  "operation": "generate-v3",
  "timestamp": "2025-01-20T14:30:22.815812+00:00",
  "parameters": {
    "prompt": ["A serene mountain landscape at sunset"],
    "renderingSpeed": "QUALITY",
    "magicPrompt": "ON",
    "numImages": "2",
    "aspectRatio": "16x9",
    "stylePreset": "DRAMATIC_CINEMA",
    "seed": "12345"
  },
  "response": {
    "imageCount": 2,
    "images": [
      {
        "index": 1,
        "url": "https://ideogram.ai/api/images/ephemeral/...",
        "resolution": "1312x736",
        "seed": 12345,
        "isImageSafe": true
      }
    ]
  }
}
```

v2 commands, **including `upscale`**, record `generationId` and `usageCostUsdMicros` (when Ideogram reports it) and list each result under `response.items` (with `itemCount`) with its `objectType`, saved `path` and, for videos, the measured `duration` and `aspectRatio`.

### Style presets

62 presets (`ideogram list-style-presets` prints the authoritative list; names such as CINEMATIC, SURREALISM and FANTASY_ART appear in some documentation but are not valid):

```text
80S_ILLUSTRATION, 90S_NOSTALGIA, ABSTRACT_ORGANIC, ANALOG_NOSTALGIA,
ART_BRUT, ART_DECO, ART_POSTER, AURA, AVANT_GARDE, BAUHAUS,
BLUEPRINT, BLURRY_MOTION, BRIGHT_ART, C4D_CARTOON, CHILDRENS_BOOK,
COLLAGE, COLORING_BOOK_I, COLORING_BOOK_II, CUBISM, DARK_AURA,
DOODLE, DOUBLE_EXPOSURE, DRAMATIC_CINEMA, EDITORIAL, EMOTIONAL_MINIMAL,
ETHEREAL_PARTY, EXPIRED_FILM, FLAT_ART, FLAT_VECTOR, FOREST_REVERIE,
GEO_MINIMALIST, GLASS_PRISM, GOLDEN_HOUR, GRAFFITI_I, GRAFFITI_II,
HALFTONE_PRINT, HIGH_CONTRAST, HIPPIE_ERA, ICONIC, JAPANDI_FUSION,
JAZZY, LONG_EXPOSURE, MAGAZINE_EDITORIAL, MINIMAL_ILLUSTRATION,
MIXED_MEDIA, MONOCHROME, NIGHTLIFE, OIL_PAINTING, OLD_CARTOONS,
PAINT_GESTURE, POP_ART, RETRO_ETCHING, RIVIERA_POP, SPOTLIGHT_80S,
STYLIZED_RED, SURREAL_COLLAGE, TRAVEL_POSTER, VINTAGE_GEO,
VINTAGE_POSTER, WATERCOLOR, WEIRD, WOODBLOCK_PRINT
```

## Library modules

The package exports `ideogram-api` (and its alias `ideogram-api/api`), `ideogram-api/config` and `ideogram-api/utils`.

### The main module

`new IdeogramAPI(apiKey, baseUrl?, logLevel?)` creates a client; it rejects an HTTP `baseUrl`. Results are read with these helpers:

- `extractImages(response)`: the image items of a 3.0 or v2 response, an upscale, or a polled generation.
- `extractImageUrls(response)`: the safe image URLs of a v2 response or polled generation.
- `extractVideoUrls(status)` / `extractSvgUrls(status)`: the URLs from a completed `GenerationStatus`.
- `extractDescriptions(response)`: the strings from a `describe` response.
- `isPriceQuote(result)`: tells a dry-run quote from a result.

**Logging.** The library logs at `warn` by default, to stderr, so your stdout stays clean. `api.setLogLevel(level)` and the constructor's `logLevel` set that instance. `setLogLevel` from `ideogram-api/utils` sets the module logger used by the utils helpers. The CLI's `--log-level` is separate (default `info`, CLI output on stdout) and sets both.

### `ideogram-api/config`

Endpoint paths, limits, option lists and the validators:

- `ENDPOINTS`: every endpoint path (`ENDPOINTS.UPSCALE_AUTO` is `/v2/image/upscale/auto`).
- `validateV2Params(operation, params)`: checks a v2 request against the documented rules and throws an `Error` naming the first violated one. `operation` is a key such as `'generate-v46'`, `'precise-edit-v46'`, `'upscale-auto'`, `'generate-svg'`, `'minimax-h3-text-to-video'` or `'seedance-2-5-reference-to-video'`. `V2ValidationParams` is its parameter type (camelCase, as passed to the API methods).
- `validateOperationParams(operation, params)`: the 3.0 counterpart, with `operation` e.g. `'generate-v3'`, `'edit-v3'` or `'describe'`. `OPERATION_CONSTRAINTS` is the table it reads.
- `preciseEditBounds(model, quality?)`: the whole-image edit bound `{ maxPixels, maxSide? }` (type `PixelBounds`) for `'4.5'` or `'4.6'`.
- `V2_LIMITS`: the documented limits (prompt lengths, image counts, file sizes, pixel bounds, video durations).
- Option lists as read-only tuples: `RENDERING_SPEEDS`, `STYLE_PRESETS`, `V4_RESOLUTIONS`, `V45_QUALITIES`, `V46_SIZES`, `UPSCALE_FACTORS`, `MINIMAX_H3_RESOLUTIONS`, `SEEDANCE_25_RESOLUTIONS`, `ASPECT_RATIOS`, `V4_ASPECT_RATIOS`, `AUTO_STYLE_TYPES`, `SVG_QUALITIES` and more. They are `as const`, so `(typeof V46_SIZES)[number]` is a union of the literal values; test an arbitrary string with `isOneOf(V46_SIZES, value)`.
- `assertColorPalette(value)`: throws unless `value` is a valid v2 color palette (a preset name, `{ name }` or `{ members }`), and narrows it to `V2ColorPalette`.
- `parseContextWindow(value, imageDims?, bounds?)`: parses a precise-edit context window (`'none'`, `'auto'` or `'y_min,x_min,y_max,x_max'`) into `{ yMin, xMin, yMax, xMax }`, or `null` for `'none'` / `'auto'`; throws on a malformed or out-of-rule region.
- `getIdeogramApiKey(cliApiKey?)`: the key from the CLI value or `IDEOGRAM_API_KEY`; throws when neither is set.
- `redactApiKey(apiKey)`: `xxx...` plus the key's last 4 characters, for logs.
- `BASE_URL` (`https://api.ideogram.ai`), `API_VERSION` (`v1`) and `DEFAULT_OUTPUT_DIR`.

```typescript
import { validateV2Params, preciseEditBounds, V2_LIMITS, ENDPOINTS } from 'ideogram-api/config';

try {
  validateV2Params('generate-v46', { prompt: 'A lighthouse at dawn', quality: 'low', numImages: 9 });
} catch (error) {
  console.error((error as Error).message); // numImages must be an integer between 1 and 8
}

console.log(preciseEditBounds('4.6'));          // { maxPixels: 16777216 }
console.log(preciseEditBounds('4.6', 'very_low')); // { maxPixels: 4194304, maxSide: 4608 }
console.log(V2_LIMITS.svg.promptMaxLength, ENDPOINTS.UPSCALE_AUTO); // 9500 '/v2/image/upscale/auto'
```

### `ideogram-api/utils`

Input handling, downloads and small helpers:

- `validateImageUrl(url)`: SSRF check on an image URL; resolves to the URL, throws if it is blocked.
- `validateImagePath(filepath)`: checks a local image path; resolves to the validated path.
- `assertSquareImage(image)`: throws unless the image (path or Buffer) is square.
- `getImageDimensions(image)`: `{ width, height }` of an image path or Buffer.
- `loadImageAsBuffer(path)` / `loadAudioAsBuffer(path)`: read and validate a local image / MP3 or WAV into a Buffer.
- `downloadImageAsBuffer(url)`: downloads an image (50MB cap, Content-Type checked) with SSRF checks on every redirect.
- `downloadBuffer(url, { maxBytes?, timeoutMs? })`: downloads a result into memory (default 200MB, 60 s), without the Content-Type check.
- `downloadToFile(url, outputPath, { maxBytes?, timeoutMs? })`: streams a result to a file (default 2GB, 5 minutes); removes the partial file on failure.
- `detectImageType(buffer)` / `detectAudioType(buffer)`: `{ extension, mimeType }` from magic bytes (PNG, JPEG, WebP, GIF / WAV, MP3), or `null`.
- `buildFormData(params)`: a native `FormData` from a params object. It names and types each file part from its bytes (`image.png` / `image/png`, `audio.wav` / `audio/wav`, ...); bytes it does not recognize are sent as `image.jpg` / `image/jpeg`.
- `toError(e)`, `isErrnoException(e)`: coerce a thrown value to an `Error`; type guard for Node errors with a `code`.
- `setLogLevel(level)`: `'debug'`, `'info'`, `'warn'` or `'error'`; see Logging above.

```typescript
import { loadImageAsBuffer, getImageDimensions, downloadToFile } from 'ideogram-api/utils';

const bytes = await loadImageAsBuffer('./lighthouse.png');
console.log(await getImageDimensions(bytes)); // { width: ..., height: ... }
await downloadToFile('https://ideogram.ai/api/images/ephemeral/example.mp4', './out/example.mp4');
```

### TypeScript types

Type definitions ship with the package (`import type { ... } from 'ideogram-api'`):

| Category | Types |
|---|---|
| 3.0 parameters | `GenerateParams`, `EditParams`, `RemixParams`, `ReframeParams`, `ReplaceBackgroundParams`, `DescribeParams`, `BaseGenerationParams` |
| 3.0 responses | `GenerationResponse`, `DescribeResponse`, `ImageData`, `Description` |
| 3.0 values | `RenderingSpeed`, `MagicPromptOption`, `StyleType`, `DescribeModelVersion`, `ColorPalette`, `ColorPalettePreset`, `CustomColorPalette` |
| Upscale | `UpscaleParams`, `UpscaleFactor`, `UpscaleResponse`, `UpscaledImage` |
| v2 parameters | `GenerateV4Params`, `GenerateV4TransparentParams`, `GenerateV4CustomParams`, `GenerateV45Params`, `GenerateV46Params`, `GenerateAutoParams`, `PreciseEditV45Params`, `PreciseEditV46Params`, `GenerateSvgParams`, `MinimaxH3TextToVideoParams`, `MinimaxH3ImageToVideoParams`, `MinimaxH3ReferenceToVideoParams`, `Seedance25TextToVideoParams`, `Seedance25ImageToVideoParams`, `Seedance25ReferenceToVideoParams` |
| v2 responses | `V2GenerationResponse`, `V2Acknowledgement` (the `generation_id` for async, SVG and video), `PriceQuote`, `GenerationStatus` (a polled generation), `GenerationDataItem`, `VideoGenerationItem`, `SvgGenerationItem`, `GeneratedImage`, `WaitForGenerationOptions` |
| v2 values | `MagicPromptMode`, `RenderingSpeedV4`, `QualityV45`, `ImageSizeV46`, `AutoStyleType`, `V2ColorPalette`, `SvgQuality`, `AssetIdentifier`, `MinimaxH3Resolution`, `Seedance25Resolution`, `V2OperationKey`, ... (each widens to `string`, so values Ideogram adds later still type-check) |
| Validation | `ValidationResult`, `ValidationParams`, `OperationConstraint` |

```typescript
import { IdeogramAPI } from 'ideogram-api';
import type { GenerateParams, GenerationResponse, ImageData } from 'ideogram-api';

const api = new IdeogramAPI(process.env.IDEOGRAM_API_KEY!);
const params: GenerateParams = { prompt: 'A serene mountain landscape', aspectRatio: '16x9', renderingSpeed: 'QUALITY', numImages: 2 };
const response: GenerationResponse = await api.generate(params);
response.data.forEach((img: ImageData) => console.log(img.url, img.resolution, img.seed, img.is_image_safe));
```

## Security

- **API key redaction.** Keys are redacted in logs: `redactApiKey` keeps `xxx...` and the last 4 characters (`xxx...6789`), and keys are never logged in full, even at `debug`.
- **Error sanitization.** With `NODE_ENV=production`, detailed error messages are replaced with generic ones to prevent information disclosure. For possibly billed failures (see `possiblyBilled` under [Errors](#errors)) the message says the request may have run and been billed and to check usage before retrying, instead of suggesting a retry; a non-production 5xx message and log line on a POST carry the same note.
- **HTTPS only.** The constructor rejects an HTTP base URL. API calls refuse redirects, so the `Api-Key` header is never sent to another host.
- **SSRF protection.** Image URLs are validated before processing, and again on every download redirect (at most 5 are followed). Blocked: localhost (`127.0.0.1`, `::1`, `localhost`), private ranges (`10.x`, `192.168.x`, `172.16-31.x`, `169.254.x`), cloud metadata endpoints (`169.254.169.254`, `metadata.google.internal`), and, because addresses are parsed rather than pattern-matched, IPv4-mapped IPv6 in any spelling and the unspecified, unique-local, link-local, CGNAT, local-use NAT64 (`64:ff9b:1::/48`), IPv4-translated, Teredo, documentation and other reserved ranges. NAT64 (`64:ff9b::/96`) and 6to4 (`2002::/16`) addresses are judged by the IPv4 address they embed, so the synthesized address a DNS64 network returns for a public host is accepted and one embedding a private or metadata address is refused.
- **DNS check, with a limit.** The hostname is resolved and refused if any address it resolves to is blocked. The connection is not pinned to the checked address, so a host that changes its DNS answer between the check and the download (DNS rebinding) is not prevented.
- **Image validation.** PNG, JPEG, WebP and GIF are identified by magic bytes, not extension.
- **Timeouts and size limits.** API request timeout 120 s (v1) and 300 s (v2), `timeoutMs` overriding it per v2 request; image downloads 60 s, video and SVG downloads 5 minutes (streamed to disk). Responses are capped at 100MB; downloads into memory at 200MB by default (`downloadImageAsBuffer` at 50MB); video downloads at 2GB. Uploads are at most 50MB per image file; per-request ceilings follow each endpoint's documented file count and size.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `IDEOGRAM_API_KEY not found. Please provide your API key via...` | Set the key; see [Setup](#setup). The library does not read `.env` files. |
| `Invalid aspect ratio '16:10'. Must be one of: ...` | Use one of the 15 ratios (`ideogram list-aspect-ratios`), or `--resolution` for precise control (`ideogram generate --prompt "landscape" --resolution "1920x1080"`). |
| `Invalid style preset 'CINEMATIC'. Must be one of the supported presets.` | `ideogram list-style-presets` prints the 62 valid presets. |
| `Image must be square. Received 1920x1080` | Crop or resize the image to a square first. |
| `Image file size exceeds maximum of 50MB (...)` | Compress or resize the image before uploading. |
| `Image file not found: <path>` | Check the path; the CLI reports a missing input file this way. |
| `File does not appear to be a valid image (PNG, JPEG, WebP, or GIF): <path>` | The file's bytes are not one of those formats, whatever its extension. |
| HTTP 429 (rate limit) | Rate limits depend on your Ideogram plan (see [ideogram.ai/api](https://ideogram.ai/api)). Wait and retry with exponential backoff; on v2, `error.rejectReason` says which limit was hit. `waitForGeneration` already backs off on 429 while polling. |
| 402 (v2) | Out of credits or quota: see `error.rejectReason`. |
| A request failed after it was sent | See [Errors](#errors): resume if `resumable`, check usage if `possiblyBilled`. |

A blocked URL throws an error such as `Access to internal/private IP addresses is not allowed (host 127.0.0.1). Use a public HTTPS URL.`; the library also logs a `SECURITY: Blocked access to ...` warning line.

## Migrating from 1.x

2.0 has breaking changes.

**Library**

- **Node.js 22 or later.**
- **No axios or form-data.** HTTP uses the built-in `fetch`, and `buildFormData` returns a native `FormData`. A request that gets no HTTP response throws `IdeogramAPIError` with `code` (e.g. `ECONNRESET`), not an `AxiosError`; code that checks `error.isAxiosError` or `error.response` must check `IdeogramAPIError`, `status` and `code` instead (see [Errors](#errors)).
- **`upscale()` moved to the v2 API** (`/v2/image/upscale/auto`), because Ideogram retired the v1 endpoint. It takes only `image`, `upscaleFactor`, `seed` and the v2 options (`async`, `webhookUrl`, `dryRun`, `timeoutMs`); passing `prompt`, `resemblance`, `detail`, `magicPromptOption` or `numImages` throws. It returns an `UpscaleResponse`; use `extractImageUrls` for the URL (see [Upscale](#upscale)).
- **`ENDPOINTS.UPSCALE` is now `ENDPOINTS.UPSCALE_AUTO`**, and the `'upscale'` entry is gone from `OPERATION_CONSTRAINTS`.
- **Option constants are literal tuples** (`as const`) rather than `string[]`.
- **`IdeogramApiOptions` is removed.** The type was exported but nothing accepted it. The constructor is `new IdeogramAPI(apiKey, baseUrl?, logLevel?)`.
- **The library logs at `warn` by default, to stderr** (it logged at `info`). Pass a `logLevel` to see more; see [Logging](#the-main-module).
- **The CLI's log lines go to stderr.** Results, prices, ids and saved paths stay on stdout, so `ideogram ... > out.txt` captures only those; `--log-level` still defaults to `info`.
- **Importing the library no longer loads `.env` files.** Only the `ideogram` CLI reads them, and only `IDEOGRAM_API_KEY` (cwd `.env`, then `~/.ideogram/.env`). `IDEOGRAM_OUTPUT_DIR` or `NODE_ENV` set in a `.env` file no longer take effect: set them in the real environment. Library users must pass the key or set it themselves.
- **`buildFormData` names and types file parts from their bytes** (`image.png` / `image/png`, `audio.wav` / `audio/wav`); 1.x sent every file as `image.jpg`.
- **CLI helpers removed from `ideogram-api/utils`:** `saveImage`, `generateFilename`, `ensureDirectory`, `saveMetadata`, `pause`, `createSpinner` and the `logger` re-export. They were CLI plumbing and moved to an internal module. Copy the few lines you need or use Node's `fs` (`fs.mkdir(dir, { recursive: true })`, `fs.writeFile`). `setLogLevel` is still exported.
- **A stricter SSRF guard.** `validateImageUrl` checks every address a hostname resolves to and refuses more ranges (see [Security](#security)); URLs that passed in 1.x may now be refused.
- **Timeouts and poll intervals** (`timeoutMs`, `intervalMs`) must be whole milliseconds from 1 to 2147483647 and are rejected before any request is sent otherwise.

**CLI**

- **`upscale` lost flags and moved.** `--prompt`, `--resemblance`, `--detail`, `--magic-prompt-option` and `--num-images` are removed, and output goes to `upscale-auto/` (was `upscale/`). Its metadata file now records `response.items` and `itemCount` where 1.x wrote `response.images` and `imageCount`.
- **A request that returns zero results now exits 1** (it exited 0), after printing the generation id and writing the metadata file.
- **Excess and unquoted arguments are rejected.** Every command rejects excess arguments (exit 1, nothing sent). Quote multi-word prompts; v1 `generate` refuses a list of prompts that are all single words unless you pass `--allow-single-word-prompts`.
- **Key lookup is unchanged:** `--api-key`, then the environment, then the cwd `.env`, then `~/.ideogram/.env`.

```typescript
// 1.x
const result = await api.upscale({ image: './photo.jpg', prompt: 'a sharp photo', resemblance: 60, detail: 50, numImages: 1 });

// 2.0
import { extractImageUrls } from 'ideogram-api';
const result = await api.upscale({ image: './photo.jpg', upscaleFactor: 'x2' });
console.log(extractImageUrls(result));
```

```typescript
// 1.x: importing 'ideogram-api' loaded .env, so this worked with no key in code
const api = new IdeogramAPI();

// 2.0: pass the key, or set IDEOGRAM_API_KEY yourself (node --env-file=.env app.js)
const api = new IdeogramAPI(process.env.IDEOGRAM_API_KEY!);
```

```bash
# 1.x
ideogram upscale --image ./photo.jpg --prompt "a sharp photo" --resemblance 60 --detail 50

# 2.0 (output in datasets/ideogram/upscale-auto/)
ideogram upscale --image ./photo.jpg --upscale-factor x2
```

## Changelog

`CHANGELOG.md` is generated from commit messages by semantic-release on each release. Release notes are on [GitHub releases](https://github.com/aself101/ideogram-api/releases).

## Links, contributing and license

- [Ideogram API documentation](https://developer.ideogram.ai/api-reference) · [API keys](https://ideogram.ai/api) · [Issue tracker](https://github.com/aself101/ideogram-api/issues) · [npm package](https://www.npmjs.com/package/ideogram-api)
- Contributing, tests and development scripts: [CONTRIBUTING.md](CONTRIBUTING.md).
- Related packages: [`bfl-api`](https://github.com/aself101/bfl-api) (Black Forest Labs FLUX and Kontext), [`stability-ai-api`](https://github.com/aself101/stability-ai-api) (Stable Diffusion 3.5 and upscaling), [`google-genai-api`](https://github.com/aself101/google-genai-api) (Imagen), [`openai-api`](https://github.com/aself101/openai-api) (DALL-E and GPT Image).
- License: MIT.

**Disclaimer:** This project is an independent community wrapper and is not affiliated with Ideogram.
