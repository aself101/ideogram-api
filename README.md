# Ideogram API for Node.js: images, SVG and video

[![npm version](https://img.shields.io/npm/v/ideogram-api.svg)](https://www.npmjs.com/package/ideogram-api)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js Version](https://img.shields.io/node/v/ideogram-api)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)

A Node.js wrapper for the [Ideogram API](https://ideogram.ai/api): image generation, editing, remixing and manipulation with Ideogram 3.0 (v1 API), Ideogram 4.0 / 4.5 / 4.6 and automatic model selection (v2 API), SVG generation with Ideogram Vector 1, and video with MiniMax H3 and Seedance 2.5. Use it as a library or through the `ideogram` command-line tool.

This service follows the data-collection architecture pattern with organized data storage, comprehensive logging, and CLI orchestration. The Ideogram 3.0 operations and the v2 image endpoints answer synchronously by default; SVG and video are always asynchronous and are polled for their results (see [Ideogram 4.x, SVG and Video](#ideogram-4x-svg-and-video-v2-api)).

HTTP goes through Node's built-in `fetch`; the package has no HTTP-client dependency.

## Quick Start

### CLI Usage
```bash
# Install globally
npm install -g ideogram-api

export IDEOGRAM_API_KEY="your-api-key"

# Generate an image
ideogram generate --prompt "A serene mountain landscape"

# Generate with Ideogram 4.6
ideogram generate-v46 --prompt "A serene mountain landscape" --quality low

# Dry run: validate and price the request, generate nothing, bill nothing
ideogram generate-v46 --prompt "A serene mountain landscape" --quality low --dry-run
```

### Programmatic Usage
```typescript
import { IdeogramAPI, extractImageUrls, isPriceQuote } from 'ideogram-api';
import type { GenerateParams, GenerationResponse } from 'ideogram-api';

const api = new IdeogramAPI('your_api_key');

// Generate image (synchronous - no polling needed!)
const response: GenerationResponse = await api.generate({
  prompt: 'A serene mountain landscape at sunset',
  aspectRatio: '16x9',
  renderingSpeed: 'QUALITY'
});

console.log('Generated images:', response.data);

// Ideogram 4.6 (v2 API), then the same request as a dry run
const v46 = await api.generateV46({ prompt: 'A serene mountain landscape', quality: 'low' });
console.log(extractImageUrls(v46));

const quote = await api.generateV46({ prompt: 'A serene mountain landscape', quality: 'low', dryRun: true });
if (isPriceQuote(quote)) console.log(`$${quote.usd_micros / 1e6}`);
```

## Table of Contents

- [Overview](#overview)
- [Operations](#operations)
- [Ideogram 4.x, SVG and Video (v2 API)](#ideogram-4x-svg-and-video-v2-api)
- [Migrating from 1.x](#migrating-from-1x)
- [Authentication Setup](#authentication-setup)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [CLI Usage](#cli-usage)
- [API Methods](#api-methods)
- [Examples](#examples)
- [Data Organization](#data-organization)
- [Security Features](#security-features)
- [Error Handling](#error-handling)
- [Troubleshooting](#troubleshooting)
- [CLI Helper Commands](#cli-helper-commands)
- [Style Presets](#style-presets)
- [TypeScript Support](#typescript-support)

## Overview

The Ideogram API provides access to state-of-the-art image generation and manipulation. This Node.js service implements:

- **6 Ideogram 3.0 Operations** - Generate, Edit, Remix, Reframe, Replace Background, Describe
- **Upscale** - 2x, 4x or 8x through Ideogram's v2 upscaler (since 2.0)
- **v2 API** - Ideogram 4.0 (plus transparent and custom-model variants), 4.5 and 4.6 generate and precise edit, automatic model selection, SVG generation, and six video endpoints
- **Dry runs** - Every v2 call accepts `dryRun: true` (`--dry-run`): the request is validated and priced, and nothing is generated or billed
- **62 Style Presets** - More artistic styles than any other service
- **Synchronous by default** - Ideogram 3.0 and the v2 image endpoints return results directly; SVG and video return a `generation_id` to poll (`waitForGeneration`, or `--wait` on the CLI)
- **Production Security** - API key redaction, error sanitization, HTTPS enforcement, comprehensive SSRF protection (including IPv4-mapped IPv6 bypass prevention, checked again on every download redirect)
- **DoS Prevention** - Request timeouts (120s v1 API, 300s v2 API, 60s image downloads), file size limits, redirect limits
- **DNS Resolution Check** - Refuses hostnames where any resolved address is internal or reserved; the connection is not pinned to the checked address, so DNS rebinding between check and download is not prevented
- **Parameter Validation** - The CLI validates parameters before API calls; library v2 calls are unvalidated unless you call `validateV2Params`
- **API Key Authentication** - Multiple configuration methods with secure handling
- **Batch Processing** - Generate multiple images sequentially from multiple prompts
- **Helper Commands** - Easy discovery with list-style-presets, list-aspect-ratios, list-resolutions
- **Image Input Support** - Convert local files or URLs to Buffers with validation
- **Organized Storage** - Structured directories with timestamped files and metadata
- **CLI Orchestration** - Command-line tool for easy batch processing
- **Comprehensive Testing** - Vitest suite covering every endpoint's request shape, the validators, and the HTTP layer

## Operations

### Generate (Text-to-Image)

Generate images from text prompts with Ideogram 3.0's powerful model.

**Features:**
- 62 style presets (TRAVEL_POSTER, DRAMATIC_CINEMA, WATERCOLOR, etc.)
- Magic Prompt auto-enhancement
- 4 rendering speeds (FLASH, TURBO, DEFAULT, QUALITY)
- Custom aspect ratios and resolutions
- Negative prompts
- Seed control for reproducibility

**Use Cases:** Marketing materials, social media content, concept art, illustrations

### Edit (Image Editing with Mask)

Edit specific parts of images using masks and natural language prompts.

**Features:**
- Mask-based editing
- Natural language instructions
- Style preset support
- Multiple variations

**Use Cases:** Product photography touch-ups, background changes, object removal, selective enhancement

### Remix (Image-to-Image)

Transform images while preserving certain characteristics with adjustable image weight.

**Features:**
- Image weight control (0-100)
- Style transfer
- Aspect ratio changes
- Multiple variations

**Use Cases:** Style transfer, artistic transformations, design variations

### Reframe (Aspect Ratio Change)

Intelligently reframe square images to different aspect ratios.

**Features:**
- Smart content-aware reframing
- Multiple output resolutions
- Style preset support

**Use Cases:** Social media reformatting, banner creation, responsive design assets

**Note:** Only accepts perfectly square input images (validated locally)

### Replace Background

Replace image backgrounds while intelligently preserving foreground subjects.

**Features:**
- Automatic subject detection
- Natural language background description
- Style control
- Multiple variations

**Use Cases:** Product photography, portrait backgrounds, e-commerce images

### Upscale

Enlarge an image 2x, 4x or 8x (`upscaleFactor: 'x2' | 'x4' | 'x8'`, default `x2`). Ideogram picks the upscaling model per request. The output may not exceed 8192px on either side.

> **Changed in 2.0.** `upscale()` calls `/v2/image/upscale/auto`. The v1 `/upscale` endpoint it used before was retired by Ideogram: on 2026-11-22 it answered every request with 400 "The selected model version is no longer supported". The v2 upscaler has no `prompt`, `resemblance`, `detail`, `magicPromptOption` or `numImages`. Passing one throws, because the API would otherwise ignore it without a word. It supports `seed`, `async`, `webhookUrl` and `dryRun`.

**Features:**
- 2x, 4x or 8x enlargement
- Dry-run pricing, async with polling, webhooks

**Use Cases:** Print preparation, detail enhancement, resolution increase

### Describe

Get AI-generated descriptions of images using Ideogram's vision model.

**Features:**
- Two model versions (V_2, V_3)
- Detailed natural language descriptions
- Multiple descriptions per image

**Use Cases:** Alt text generation, image cataloging, accessibility, content moderation

## Ideogram 4.x, SVG and Video (v2 API)

Ideogram's v2 API puts each model behind its own endpoint. This package covers 16 of them, plus polling:

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

The rest of the v2 surface is **not covered**: about 65 more endpoints (Ideogram 2/3 on v2, remix, inpaint, reframe, the per-model upscalers (Topaz, Nano Banana Pro), Kling and Seedance 2 video, GPT-image, Nano Banana, vectorize, layerize, the design tools, and account endpoints). The v3 operations above stay on the v1 API.

**v2 field names are camelCase in this library and lowercase-valued**, unlike v3: `magicPrompt: 'auto'`, `renderingSpeed: 'turbo'`. Each endpoint has its own limits; `validateV2Params(operation, params)` checks them before you send (the CLI always runs it, the library leaves it to you).

**Naming.** v2 image methods are verb-first (`generateV46`, `preciseEditV46`); video methods are named after the provider model (`minimaxH3TextToVideo`, `seedance25ReferenceToVideo`), mirroring Ideogram's endpoint names.

### Examples

The two snippets below reuse this setup:

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

// Upscale (automatic model)
const big = await api.upscale({ image: './lighthouse.png', upscaleFactor: 'x4' });
console.log(extractImageUrls(big));
```

The same operations on the CLI (add `--dry-run` to any of them to price first):

```bash
ideogram generate-v4 --prompt "A lighthouse at dawn" --rendering-speed turbo
ideogram generate-v45 --prompt "A lighthouse at dawn" --quality low
ideogram generate-v46 --prompt "A lighthouse at dawn" --quality low --size auto_2k
ideogram generate-auto --prompt "A product photo of a ceramic mug" --aspect-ratio 16x9 --style-type realistic
ideogram precise-edit-v46 --prompt "Make the sky stormy" --image ./lighthouse.png --mask ./sky_mask.png
ideogram generate-svg --prompt "A minimal fox logo" --no-gradient --wait
ideogram upscale --image ./lighthouse.png --upscale-factor x4
```

### Dry runs: price before you spend

Every v2 method takes `dryRun: true` (CLI: `--dry-run`). The request is validated and priced, and nothing is generated, stored or billed. The result is a `PriceQuote`:

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

Two things the quotes showed that the docs do not say:

- **An omitted Seedance `duration` is quoted at the maximum** for image and reference to video (30 s: the $6.93 row), but at about 5 s for text to video. Set `duration` when cost matters.
- **`generateAudio` did not change the quote or the bill** at 480p / 4 s, although the API docs say audio "roughly doubles the provider cost". The returned video did carry an audio track.

### Synchronous, async and always-async

- **v2 image endpoints** return the images by default. Set `async: true` (CLI `--async`) to get a `generation_id` back at once; `waitForGeneration(id)` polls until it completes. `webhookUrl` asks Ideogram to POST the result to you instead.
- **SVG and video are always asynchronous.** They resolve to `{ generation_id, created? }`. Collect the result with `waitForGeneration`, then `extractSvgUrls` / `extractVideoUrls`. On the CLI, `--wait` polls and downloads (default poll interval 5 s, give-up time 30 minutes; the job keeps running if you stop waiting, and `get-generation <id> --wait` picks it up later).

```typescript
import { IdeogramAPI, extractVideoUrls } from 'ideogram-api';

const api = new IdeogramAPI(process.env.IDEOGRAM_API_KEY!);
const ack = await api.minimaxH3ImageToVideo({ prompt: 'The camera pans right', image: './beach.png', resolution: '768P' });
const done = await api.waitForGeneration(ack.generation_id, { intervalMs: 5000, timeoutMs: 30 * 60 * 1000 });
console.log(extractVideoUrls(done));
```

`waitForGeneration` defaults to a 10-minute limit, which a long video can exceed; pass `timeoutMs`. Videos and SVGs are downloaded as streams (`downloadToFile` in `ideogram-api/utils`), not buffered in memory. If a download fails or exceeds its size cap, `downloadToFile` removes the partial file.

### Model notes

- **Ideogram 4.6 vs 4.5.** Same fields. 4.6 renders exact sizes up to 4096x4096 (8192 per side), with no preset list; adds `size: 'auto_2k' | 'auto_4k'` (no `auto_4k` at `very_low`); runs `quality: 'very_low'` without source images (capped at 2048x2048 and 4608 per side); and its precise edit bounds a whole-image edit at 4096x4096 instead of 2048x2048.
- **Precise edit.** The output keeps the input's exact width and height. `contextWindow` defaults to `'auto'`: a region around the mask, or the whole image when there is no mask. An image larger than the model's bound comes back scaled down unless the edit is confined to a region.
- **Masks: observed limitation.** The precise-edit endpoints read and validate the mask: they reject one whose size differs from the image, or one that is all black or all white. In live edits on 2026-11-22, though, the mask did not confine the change: in 6 of 7 masked edits (4.5 generate, 4.5 and 4.6 precise edit) the edit landed where the prompt pointed, in white ("keep") areas, and left the black area untouched. The seventh agreed with its mask only because the prompt pointed into it. Check results if you rely on a mask to protect part of an image.
- **Automatic model selection.** `styleType` and `colorPalette` (a preset name such as `'ember'`, or `{ members: [{ color_hex: '#ff0000' }] }`) narrow the choice to models that support them, and cannot be combined with source images. There is no `private` field any more: Ideogram removed it, and the API silently ignores fields it does not know.
- **SVG.** `imageAssetIdentifiers` references existing Ideogram assets and takes priority over uploaded `images`. `useGradient: false` (`--no-gradient`) gives flat colors only.
- **Video.** MiniMax H3 spells resolutions in uppercase (`480P`, `768P`, `2K`, `4K`; the last two are upscaled from 768P), takes 5-15 s, and its reference mode accepts up to 3 MP3/WAV audios (which need a reference image). Seedance 2.5 spells them in lowercase (`480p`, `720p`, `1080p`), takes 4-30 s, and its reference mode needs at least one image. In live tests every MiniMax H3 video carried an audio track, although MiniMax has no audio option.

### Errors

Failures throw `IdeogramAPIError` (a subclass of `Error`):

- `status`: the HTTP status, when the API answered.
- `rejectReason` / `maxInflightRequests`: why a 402 or 429 was refused (`insufficient_funds`, `inflight_limit`, ...).
- `failureReason`: from `waitForGeneration`, why an async generation failed (e.g. `content_policy_violation`).
- `code`: set when **no HTTP response arrived** (e.g. `ECONNRESET`, or `ETIMEDOUT` for a timeout).
- `possiblyBilled`: `true` when the request was sent and the outcome is unknown or failed after sending (no response, unreadable or malformed body, too-large body, 5xx); `false` for 4xx and anything rejected before sending.
- `generationId`: set on errors from `waitForGeneration` polling. The CLI prints the resume command (`ideogram get-generation <id> --wait`, or `ideogram get-generation --wait -- <id>` when the id starts with `-`).

```typescript
try { await api.generateV46({ prompt: 'A lighthouse', quality: 'low' }); }
catch (e) { if (e instanceof IdeogramAPIError && e.possiblyBilled) { /* check usage before retrying */ } else { /* safe to fix and retry */ } }
```

Every failure after the request was sent is an `IdeogramAPIError`, including a malformed JSON body, a timeout while reading the body, a non-JSON `Content-Type`, and a response body over 100MB; each carries the HTTP `status` where there is one.

Timeouts and poll intervals (`timeoutMs`, and `intervalMs` on `waitForGeneration`) must be whole milliseconds from 1 to 2147483647; out-of-range values are rejected before any request is sent. `waitForGeneration`'s 429 backoff doubles the interval, at least 1 s and at most 30 s, and never polls sooner than the current interval.

**Trust model.** Responses are checked to be JSON objects. Their field shapes are typed but not validated at runtime, so a change on Ideogram's side shows up as missing fields rather than as an error.

**A request with no response may still have been billed.** On 2026-11-22 one `generate-auto` request failed client-side with no response and was charged all the same. Check your usage before retrying a failed generation.

### The `ideogram-api/config` module

Endpoint paths, limits, option lists and the validators are exported from `ideogram-api/config`:

- `ENDPOINTS`: every endpoint path. `UPSCALE_AUTO` (`/v2/image/upscale/auto`) replaced `UPSCALE` in 2.0.
- `validateV2Params(operation, params)`: checks a v2 request against the documented rules and throws an `Error` naming the first violated one. `operation` is a key such as `'generate-v46'`, `'precise-edit-v46'`, `'upscale-auto'`, `'generate-svg'`, `'minimax-h3-text-to-video'` or `'seedance-2-5-reference-to-video'`.
- `preciseEditBounds(model, quality?)`: the whole-image edit bound, `{ maxPixels, maxSide? }`, for `'4.5'` or `'4.6'`.
- `V2_LIMITS`: the documented limits (prompt lengths, image counts, file sizes, pixel bounds, video durations).
- Option lists, as read-only tuples: `RENDERING_SPEEDS`, `STYLE_PRESETS`, `V4_RESOLUTIONS`, `V45_QUALITIES`, `V46_SIZES`, `UPSCALE_FACTORS`, `MINIMAX_H3_RESOLUTIONS`, `SEEDANCE_25_RESOLUTIONS`, and the rest (`ASPECT_RATIOS`, `V4_ASPECT_RATIOS`, `AUTO_STYLE_TYPES`, `SVG_QUALITIES`, ...). Derive a literal union with `typeof V46_SIZES[number]`; test membership of an arbitrary string with `isOneOf(V46_SIZES, value)`.
- `assertColorPalette(value)`: throws unless `value` is a valid v2 color palette (a preset name, `{ name }` or `{ members }`), and narrows it to `V2ColorPalette`.

- `parseContextWindow(value, imageDims?, bounds?)`: parses a precise-edit context window (`'none'`, `'auto'` or `'y_min,x_min,y_max,x_max'`) into `{ yMin, xMin, yMax, xMax }`, or `null` for `'none'` / `'auto'`; throws on a malformed or out-of-rule region.
- `getIdeogramApiKey(cliApiKey?)`: the API key from the CLI value or `IDEOGRAM_API_KEY`; throws when neither is set.
- `redactApiKey(apiKey)`: the key as `xxx...` plus its last 4 characters, for logs.
- `BASE_URL` (`https://api.ideogram.ai`), `API_VERSION` (`v1`) and `DEFAULT_OUTPUT_DIR` (`IDEOGRAM_OUTPUT_DIR`, else `datasets/ideogram`).

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

### The `ideogram-api/utils` module

Input handling, downloads and small helpers, exported from `ideogram-api/utils`:

- `validateImageUrl(url)`: SSRF check on an image URL; resolves to the URL, throws if it is blocked.
- `validateImagePath(filepath)`: checks a local image path; resolves to the validated path.
- `assertSquareImage(image)`: throws unless the image (path or Buffer) is square.
- `getImageDimensions(image)`: `{ width, height }` of an image path or Buffer.
- `loadImageAsBuffer(path)`: reads and validates a local image into a Buffer.
- `downloadImageAsBuffer(url)`: downloads an image (50MB cap, Content-Type checked) with SSRF checks on every redirect.
- `downloadBuffer(url, { maxBytes?, timeoutMs? })`: downloads a result into memory (default 200MB, 60 s), without the Content-Type check.
- `downloadToFile(url, outputPath, { maxBytes?, timeoutMs? })`: streams a result to a file (default 2GB, 5 minutes); removes the partial file on failure.
- `detectImageType(buffer)` / `detectAudioType(buffer)`: `{ extension, mimeType }` from magic bytes (PNG, JPEG, WebP, GIF / WAV, MP3), or `null`.
- `loadAudioAsBuffer(path)`: reads a local MP3 or WAV into a Buffer.
- `buildFormData(params)`: a native `FormData` from a params object.
- `toError(e)`: any thrown value as an `Error`.
- `isErrnoException(e)`: type guard for Node errors with a `code`.
- `setLogLevel(level)`: `'debug'`, `'info'`, `'warn'` or `'error'`.

```typescript
import { loadImageAsBuffer, getImageDimensions, downloadToFile } from 'ideogram-api/utils';

const bytes = await loadImageAsBuffer('./lighthouse.png');
console.log(await getImageDimensions(bytes)); // { width: ..., height: ... }
await downloadToFile('https://ideogram.ai/api/images/ephemeral/example.mp4', './out/example.mp4');
```

`buildFormData` names and types each file part from its bytes (`image.png` / `image/png`, `audio.wav` / `audio/wav`, ...). Bytes it does not recognize are sent as `image.jpg` / `image/jpeg`.

## Migrating from 1.x

2.0 has breaking changes:

- **Node.js 22 or later.**
- **No axios or form-data.** HTTP uses the built-in `fetch`. `buildFormData` (`ideogram-api/utils`) returns a native `FormData`. A request that gets no HTTP response throws `IdeogramAPIError` with `code` (e.g. `ECONNRESET`), not an `AxiosError`; code that checks `error.isAxiosError` or `error.response` must check `IdeogramAPIError`, `status` and `code` instead (see [Errors](#errors)).
- **`upscale()` moved to the v2 API** (`/v2/image/upscale/auto`), because Ideogram retired the v1 endpoint. It takes only `image`, `upscaleFactor` (`'x2'` | `'x4'` | `'x8'`), `seed` and the v2 options (`async`, `webhookUrl`, `dryRun`, `timeoutMs`). Passing `prompt`, `resemblance`, `detail`, `magicPromptOption` or `numImages` throws. It returns an `UpscaleResponse`; use `extractImageUrls` for the URL. On the CLI, `--prompt`, `--resemblance`, `--detail`, `--magic-prompt-option` and `--num-images` are removed from `upscale`, and output goes to `upscale-auto/` (was `upscale/`).
- **`ENDPOINTS.UPSCALE` is now `ENDPOINTS.UPSCALE_AUTO`**, and the `'upscale'` entry is gone from `OPERATION_CONSTRAINTS`.
- **Option constants are literal tuples** (`as const`) rather than `string[]`, so `(typeof RENDERING_SPEEDS)[number]` is a union of the literal values.
- **Importing the library no longer loads `.env` files.** Only the `ideogram` CLI reads them, and only `IDEOGRAM_API_KEY` (cwd `.env`, then `~/.ideogram/.env`); other variables in those files are not loaded, so `IDEOGRAM_OUTPUT_DIR` or `NODE_ENV` set in a `.env` file no longer take effect (set them in the real environment). CLI precedence is unchanged: `--api-key`, then `IDEOGRAM_API_KEY` in the environment, then cwd `.env`, then `~/.ideogram/.env`. Library users must pass the key or set it themselves.
- **`buildFormData` names and types file parts from their bytes.** Each file part is now `image.png` / `image/png`, `audio.wav` / `audio/wav` and so on, where 1.x sent every file as `image.jpg`. Bytes it does not recognize still go as `image.jpg` / `image/jpeg`.
- **CLI helpers removed from `ideogram-api/utils`:** `saveImage`, `generateFilename`, `ensureDirectory`, `saveMetadata`, `pause`, `createSpinner` and the `logger` re-export. They were CLI plumbing and moved to an internal CLI module. Copy the few lines you need, or use Node's `fs` (`fs.mkdir(dir, { recursive: true })`, `fs.writeFile`). `setLogLevel` is still exported.

```typescript
// 1.x
const result = await api.upscale({
  image: './photo.jpg',
  prompt: 'a sharp photo',
  resemblance: 60,
  detail: 50,
  numImages: 1
});

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

## Authentication Setup

### 1. Get Your API Key

Visit [https://ideogram.ai/api](https://ideogram.ai/api) to create an account and generate your API key.

### 2. Configure Your API Key

The API key can be provided in multiple ways (listed by priority):

#### Option A: CLI Flag (Highest Priority)

```bash
ideogram --api-key YOUR_KEY generate --prompt "landscape"
```

#### Option B: Environment Variable

```bash
export IDEOGRAM_API_KEY=your_api_key
ideogram generate --prompt "landscape"
```

These options apply to the `ideogram` CLI. The library never reads `.env` files: pass the key to `new IdeogramAPI(apiKey)` or set `IDEOGRAM_API_KEY` yourself (e.g. `node --env-file=.env`).

#### Option C: Local .env File (Project-Specific)

Create `.env` in your project directory. The CLI reads only `IDEOGRAM_API_KEY` from it:

```bash
IDEOGRAM_API_KEY=your_api_key
```

#### Option D: Global Config (For Global npm Installs)

```bash
mkdir -p ~/.ideogram
echo "IDEOGRAM_API_KEY=your_api_key" > ~/.ideogram/.env
```

## Installation

### Option 1: Install from npm

```bash
# Install globally for CLI usage
npm install -g ideogram-api

# Or install locally for programmatic usage
npm install ideogram-api
```

The package is ESM-only (`"type": "module"`, and `exports` has only `import` and `types` conditions), so use `import ... from 'ideogram-api'`; `require('ideogram-api')` fails with `ERR_PACKAGE_PATH_NOT_EXPORTED`.

### Option 2: Install from source

```bash
git clone https://github.com/aself101/ideogram-api.git
cd ideogram-api
npm install
npm link  # For global CLI access
```

## Quick Start

### Using the CLI

```bash
# Show help
ideogram

# Show examples
ideogram --examples

# Discover available options
ideogram list-style-presets
ideogram list-aspect-ratios
ideogram list-resolutions

# Generate an image
ideogram generate --prompt "A serene Japanese zen garden"

# Generate with style
ideogram generate \
  --prompt "Vintage travel poster of Paris" \
  --style-preset TRAVEL_POSTER \
  --aspect-ratio "16x9"

# Upscale an image 4x
ideogram upscale --image ./photo.jpg --upscale-factor x4
```

### Example Commands

```bash
# Basic generation
ideogram generate --prompt "sunset over mountains"

# High-quality with specific style
ideogram generate \
  --prompt "Cyberpunk city at night" \
  --rendering-speed QUALITY \
  --style-preset DRAMATIC_CINEMA \
  --aspect-ratio "21x9"

# Batch generation with negative prompts
ideogram generate \
  --prompt "Portrait of a cat" \
  --prompt "Portrait of a dog" \
  --negative-prompt "blurry, low quality"

# Edit with mask
ideogram edit \
  --prompt "Change sky to sunset" \
  --image photo.jpg \
  --mask sky_mask.png

# Remix with style transfer
ideogram remix \
  --prompt "Watercolor painting style" \
  --image photo.jpg \
  --image-weight 75

# Replace background
ideogram replace-background \
  --prompt "Tropical beach at sunset" \
  --image portrait.jpg

# Describe image
ideogram describe --image photo.jpg
```

### Using the API Class Directly

```typescript
import { IdeogramAPI, extractImages, extractDescriptions } from 'ideogram-api';
import type { GenerationResponse, DescribeResponse, ImageData, UpscaleResponse } from 'ideogram-api';

const api = new IdeogramAPI('your_api_key');

// Generate with all options
const response: GenerationResponse = await api.generate({
  prompt: 'A serene mountain landscape at sunset',
  aspectRatio: '16x9',
  renderingSpeed: 'QUALITY',
  stylePreset: 'DRAMATIC_CINEMA',
  magicPrompt: 'ON',
  numImages: 2,
  seed: 12345
});

const images: ImageData[] = extractImages(response);
console.log(`Generated ${images.length} images`);

// Edit image
const editResponse: GenerationResponse = await api.edit({
  prompt: 'Change the sky to golden hour',
  image: './photo.jpg',
  mask: './mask.png',
  renderingSpeed: 'QUALITY'
});

// Upscale image 4x
const upscaleResponse: UpscaleResponse = await api.upscale({
  image: './low_res.jpg',
  upscaleFactor: 'x4'
});

// Describe image
const describeResponse: DescribeResponse = await api.describe({
  image: './photo.jpg',
  describeModelVersion: 'V_3'
});

const descriptions: string[] = extractDescriptions(describeResponse);
console.log(descriptions);
```

## CLI Usage

### Basic Command Structure

```bash
ideogram <operation> [options]
```

### Available Operations

- `generate` - Text-to-image generation
- `edit` - Image editing with mask
- `remix` - Image-to-image transformation
- `reframe` - Aspect ratio change (square images only)
- `replace-background` - Background replacement
- `upscale` - Image upscaling
- `describe` - Image description

### Common Options

```bash
--prompt <text>              Generation/editing prompt (max 10,000 chars)
--image <path>               Input image file path
--aspect-ratio <ratio>       Output aspect ratio (e.g., "16x9", "1x1")
--resolution <WxH>           Specific resolution (e.g., "1024x1024")
--rendering-speed <speed>    FLASH | TURBO | DEFAULT | QUALITY
--num-images <number>        Number of images to generate (1-8)
--seed <number>              Random seed for reproducibility
--style-preset <preset>      One of 62 style presets
--negative-prompt <text>     Things to avoid in generation
--api-key <key>              API key (overrides environment)
```

### Generate-Specific Options

```bash
--magic-prompt <mode>        AUTO | ON | OFF (default: AUTO)
--style-type <type>          AUTO | GENERAL | REALISTIC | DESIGN | FICTION
--color-palette <palette>    Preset or custom palette
```

### Edit-Specific Options

```bash
--mask <path>                Mask image file path (required). Intent: black = edit, white = keep; the API does not reliably confine edits to it (see Masks under the v2 API)
```

### Remix-Specific Options

```bash
--image-weight <0-100>       Influence of original image (default: 50)
```

### Upscale-Specific Options

```bash
--upscale-factor <x2|x4|x8>  Enlargement (default: x2); output is capped at 8192px per side
--seed <number>              Random seed
--dry-run                    Price the request without running or billing it
--async [--wait]             Return a generation_id at once; --wait polls and downloads
```

### Describe-Specific Options

```bash
--describe-model-version     V_2 | V_3 (default: V_3)
```

### v2 Commands

The v2 commands (`generate-v4` through `seedance-reference-to-video`, `get-generation`; see the [table](#ideogram-4x-svg-and-video-v2-api)) share these options. `ideogram <command> --help` lists every option a command takes.

```bash
--dry-run                      Validate and price the request; nothing is generated or billed
--async                        Image commands: return a generation_id at once (add --wait to poll and download)
--wait                         SVG and video (always async): poll, then download; get-generation: poll until done
--poll-interval <ms>           Poll interval for --wait, whole ms from 1 to 2147483647 (default 2000 for image and get-generation, 5000 for SVG and video)
--wait-timeout <ms>            SVG, video and get-generation: give up waiting after this long, whole ms from 1 to 2147483647 (default 1800000; the job keeps running)
--timeout <ms>                 Request timeout, whole ms from 1 to 2147483647
--webhook-url <url>            HTTPS URL Ideogram POSTs the finished result to
--copyright-detection          Run copyright detection (4.x generate and precise-edit commands)
--context-window <window>      precise-edit, precise-edit-v46: auto (default), none, or y_min,x_min,y_max,x_max
--asset <TYPE:ID[:COLLECTION]> generate-svg: existing Ideogram assets as sources (take priority over --images)
--no-gradient                  generate-svg: flat colors only
--upscale-factor <x2|x4|x8>    upscale
```

Video options (`minimax-*`, `seedance-*`):

```bash
-d, --duration <seconds>       MiniMax H3 5-15 (default 5); Seedance 2.5 4-30 (omit to let the model pick)
-r, --resolution <tier>        MiniMax H3 480P | 768P | 2K | 4K; Seedance 2.5 480p | 720p | 1080p
--end-image <path>             minimax-image-to-video, seedance-image-to-video: last frame
--reference-images <paths...>  Reference commands (also precise-edit): references, in prompt order
--reference-audios <paths...>  Reference commands: MP3 or WAV, in prompt order (need a reference image)
--generate-audio               Seedance commands: generate an audio track (price it with --dry-run)
--prompt-expansion-mode <m>    minimax-reference-to-video: disabled | fast | balanced | quality
```

A generation ID that starts with `-` must go after `--`:

```bash
ideogram get-generation --wait -- <id>
```

### Utility Commands

```bash
ideogram --help              Show help message
ideogram --examples          Show usage examples
ideogram list-style-presets  List all 62 style presets
ideogram list-aspect-ratios  List all 15 aspect ratios
ideogram list-resolutions    List all 69 resolutions
ideogram list-v4-resolutions List the Ideogram 4.0 resolutions (also the 4.5 presets)
```

## API Methods

The methods below are the Ideogram 3.0 (v1 API) operations. The v2 methods (`generateV4`, `generateV45`, `generateV46`, `preciseEditV46`, `generateSvg`, the video methods, `waitForGeneration`, ...) are listed in [Ideogram 4.x, SVG and Video](#ideogram-4x-svg-and-video-v2-api), and each carries a JSDoc example.

### Core Operation Methods

#### `async generate(params)`

Generate images from text prompts.

**Parameters:**
- `prompt` (string, required): Generation prompt (max 10,000 chars)
- `resolution` (string): Specific resolution (e.g., '1024x1024')
- `aspectRatio` (string): Aspect ratio (e.g., '16x9')
- `renderingSpeed` (string): FLASH, TURBO, DEFAULT, or QUALITY
- `magicPrompt` (string): AUTO, ON, or OFF
- `negativePrompt` (string): Things to avoid
- `numImages` (number): Number of images (1-8)
- `seed` (number): Random seed
- `styleType` (string): AUTO, GENERAL, REALISTIC, DESIGN, FICTION
- `stylePreset` (string): One of 62 style presets
- `colorPalette` (object): Color palette configuration

**Returns:** Response object with image data

#### `async edit(params)`

Edit images using masks with natural language prompts.

**Parameters:**
- `prompt` (string, required): Editing prompt
- `image` (string|Buffer, required): Image file path or Buffer
- `mask` (string|Buffer, required): Mask file path or Buffer
- `magicPrompt` (string): AUTO, ON, or OFF
- `numImages` (number): Number of variants (1-8)
- `seed` (number): Random seed
- `renderingSpeed` (string): Rendering speed
- `styleType`, `stylePreset`: Style controls

**Returns:** Response object with edited images

#### `async remix(params)`

Transform images while preserving characteristics.

**Parameters:**
- `prompt` (string, required): Transformation prompt
- `image` (string|Buffer, required): Image file path or Buffer
- `imageWeight` (number): Influence of original (0-100)
- `resolution`, `aspectRatio`: Output dimensions
- `renderingSpeed`, `magicPrompt`: Generation controls
- `negativePrompt`, `numImages`, `seed`: Additional options
- `styleType`, `stylePreset`, `colorPalette`: Style controls

**Returns:** Response object with remixed images

#### `async reframe(params)`

Reframe square images to different resolutions.

**Parameters:**
- `image` (string|Buffer, required): Square image path or Buffer
- `resolution` (string, required): Target resolution
- `numImages` (number): Number of variants (1-8)
- `seed` (number): Random seed
- `renderingSpeed` (string): Rendering speed
- `stylePreset` (string): Style preset

**Returns:** Response object with reframed images

#### `async replaceBackground(params)`

Replace image backgrounds.

**Parameters:**
- `prompt` (string, required): Background description
- `image` (string|Buffer, required): Image file path or Buffer
- `magicPrompt` (string): AUTO, ON, or OFF
- `numImages` (number): Number of variants (1-8)
- `seed` (number): Random seed
- `renderingSpeed` (string): Rendering speed
- `stylePreset` (string): Style preset

**Returns:** Response object with modified images

#### `async upscale(params)`

Upscale 2x, 4x or 8x with Ideogram's v2 upscaler (`/v2/image/upscale/auto`; changed in 2.0, see [Upscale](#upscale)).

**Parameters:**
- `image` (string|Buffer, required): Image file path or Buffer (max 50MB)
- `upscaleFactor` (string): `'x2'` (default), `'x4'` or `'x8'`
- `seed` (number): Random seed
- `async` (boolean), `webhookUrl` (string), `dryRun` (boolean), `timeoutMs` (number): as on the other v2 methods

**Returns:** `UpscaleResponse` (`generation_id`, `seed`, `width`, `height`, and `data` when synchronous), or a `PriceQuote` for a dry run. Pass it to `extractImageUrls` for the image URL.

#### `async describe(params)`

Get AI-generated image descriptions.

**Parameters:**
- `image` (string|Buffer, required): Image file path or Buffer
- `describeModelVersion` (string): V_2 or V_3

**Returns:** Response object with descriptions

### Utility Methods

#### `setLogLevel(level)`

Change the logging level.

**Parameters:**
- `level` (string): 'debug', 'info', 'warn', 'error'

### Helper Functions

```typescript
import { extractImages, extractDescriptions } from 'ideogram-api';
import type { ImageData, GenerationResponse, DescribeResponse } from 'ideogram-api';

// Extract image data from response
const images: ImageData[] = extractImages(response);
// Returns: [{ url: '...', resolution: '1024x1024', seed: 12345, is_image_safe: true }, ...]

// Extract descriptions from describe response
const descriptions: string[] = extractDescriptions(describeResponse);
// Returns: ['A serene mountain landscape...', ...]
```

For v2 results: `extractImageUrls(response)` returns the safe image URLs from a v2 response or a polled generation; `extractVideoUrls(status)` and `extractSvgUrls(status)` return the video and SVG URLs from a completed `GenerationStatus`; `isPriceQuote(result)` tells a dry-run quote from a result.

## Examples

Examples 1-5 and 7 reuse `api` from [Quick Start](#programmatic-usage); Examples 6 and 8 carry their own setup.

### Example 1: Basic Text-to-Image Generation

```bash
ideogram generate --prompt "A serene mountain landscape at sunset"
```

```typescript
const response = await api.generate({
  prompt: 'A serene mountain landscape at sunset'
});
```

### Example 2: High-Quality Generation with Style

```bash
ideogram generate \
  --prompt "Vintage travel poster of Tokyo with Mount Fuji" \
  --style-preset TRAVEL_POSTER \
  --rendering-speed QUALITY \
  --aspect-ratio "16x9" \
  --num-images 2
```

```typescript
const response = await api.generate({
  prompt: 'Vintage travel poster of Tokyo with Mount Fuji',
  stylePreset: 'TRAVEL_POSTER',
  renderingSpeed: 'QUALITY',
  aspectRatio: '16x9',
  numImages: 2
});
```

### Example 3: Image Editing with Mask

```bash
ideogram edit \
  --prompt "Change the sky to golden hour sunset" \
  --image ./landscape.jpg \
  --mask ./sky_mask.png \
  --style-preset GOLDEN_HOUR
```

```typescript
const response = await api.edit({
  prompt: 'Change the sky to golden hour sunset',
  image: './landscape.jpg',
  mask: './sky_mask.png',
  stylePreset: 'GOLDEN_HOUR'
});
```

### Example 4: Batch Generation with Different Prompts

```bash
ideogram generate \
  --prompt "A red sports car" \
  --prompt "A blue sedan" \
  --prompt "A green SUV" \
  --aspect-ratio "16x9" \
  --style-preset DRAMATIC_CINEMA
```

```typescript
const prompts: string[] = [
  'A red sports car',
  'A blue sedan',
  'A green SUV'
];

for (const prompt of prompts) {
  const response = await api.generate({
    prompt,
    aspectRatio: '16x9',
    stylePreset: 'DRAMATIC_CINEMA'
  });
  console.log(`Generated: ${prompt}`);
}
```

### Example 5: Style Transfer with Remix

```bash
ideogram remix \
  --prompt "Transform into watercolor painting" \
  --image ./photo.jpg \
  --image-weight 75 \
  --style-preset WATERCOLOR
```

```typescript
const response = await api.remix({
  prompt: 'Transform into watercolor painting',
  image: './photo.jpg',
  imageWeight: 75,
  stylePreset: 'WATERCOLOR'
});
```

### Example 6: Image Upscaling

```bash
ideogram upscale --image ./low_res.jpg --upscale-factor x4
```

```typescript
import { IdeogramAPI, extractImageUrls } from 'ideogram-api';

const api = new IdeogramAPI(process.env.IDEOGRAM_API_KEY!);
const response = await api.upscale({ image: './low_res.jpg', upscaleFactor: 'x4' });
console.log(`${response.width}x${response.height}`, extractImageUrls(response));
```

### Example 7: Background Replacement

```bash
ideogram replace-background \
  --prompt "Tropical beach at golden hour with palm trees" \
  --image ./portrait.jpg \
  --num-images 3
```

```typescript
const response = await api.replaceBackground({
  prompt: 'Tropical beach at golden hour with palm trees',
  image: './portrait.jpg',
  numImages: 3
});
```

### Example 8: Complete Workflow in Code

```typescript
import { IdeogramAPI, extractImages, extractImageUrls, extractDescriptions } from 'ideogram-api';
import type { GenerationResponse, DescribeResponse, ImageData, UpscaleResponse } from 'ideogram-api';

const api = new IdeogramAPI(process.env.IDEOGRAM_API_KEY!);

// 1. Generate base image
console.log('Generating base image...');
const genResponse: GenerationResponse = await api.generate({
  prompt: 'Portrait of a mountain climber at summit',
  aspectRatio: '1x1',
  renderingSpeed: 'QUALITY',
  stylePreset: 'DRAMATIC_CINEMA'
});

const genImages: ImageData[] = extractImages(genResponse);
console.log(`Generated ${genImages.length} images`);

// 2. Upscale the first image
console.log('Upscaling image...');
const upscaleResponse: UpscaleResponse = await api.upscale({
  image: Buffer.from(await fetch(genImages[0].url).then(r => r.arrayBuffer())),
  upscaleFactor: 'x2'
});

// 3. Describe the upscaled image
console.log('Getting description...');
const [upscaledUrl] = extractImageUrls(upscaleResponse);
const describeResponse: DescribeResponse = await api.describe({
  image: Buffer.from(await fetch(upscaledUrl).then(r => r.arrayBuffer()))
});

const descriptions: string[] = extractDescriptions(describeResponse);
console.log('Description:', descriptions[0]);
```

## Data Organization

Generated images and metadata are organized by operation:

```
datasets/ideogram/
├── generate-v3/
│   ├── 20250120_143022_serene-mountain-landscape.png
│   ├── 20250120_143022_serene-mountain-landscape.json
│   └── ...
├── edit-v3/
│   ├── 20250120_143530_golden-sky-edit.png
│   ├── 20250120_143530_golden-sky-edit.json
│   └── ...
├── remix-v3/
│   └── ...
├── reframe-v3/
│   └── ...
├── replace-background-v3/
│   └── ...
├── upscale-auto/
│   └── ...
├── describe/
│   └── 20250120_144000_description.json
├── generate-v46/                      # v2 commands: one folder per operation
│   └── ...
├── seedance-2-5-text-to-video/        # SVG and video results saved with --wait
│   ├── 20261122_184617_a-red-fox.mp4
│   └── 20261122_184618_a-red-fox.json
└── generations/                       # results fetched with get-generation
    └── ...
```

v2 metadata files record `generationId` and `usageCostUsdMicros` (when Ideogram reports it), and list each result under `response.items` with its `objectType`, saved `path` and, for videos, the measured `duration` and `aspectRatio`.

Output files never overwrite each other: each item gets its own name (the index survives truncation of long prompts), and an existing file is never replaced. Before writing anything to disk, the CLI prints the generation id and every result URL, so a disk error cannot lose a billed result; a `--dry-run` that comes back with a real result is reported loudly and saved, and the command exits non-zero. Every CLI command writes the metadata file (generation id and every URL where there is one) before downloading, so a failed download keeps the record; if the CLI cannot remove a partial or empty output file after a failed write, it warns and names the file.

**Metadata Format:**

Each generated image has an accompanying JSON metadata file:

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

## Security Features

This library includes comprehensive production-ready security:

### API Key Protection

API keys are automatically redacted in all logs:

```javascript
// Logged as: "API key: xxx...abc1234" (shows only last 7 chars)
api.setLogLevel('debug');
```

Keys are never logged in full, even in DEBUG mode.

### Error Message Sanitization

In production mode (`NODE_ENV=production`), detailed error messages are replaced with generic ones to prevent information disclosure. For failures that are possibly billed (see `possiblyBilled` under [Errors](#errors)), the message says the request may have run and been billed and to check usage before retrying, instead of suggesting a retry.

### SSRF Protection (Server-Side Request Forgery)

All image URLs are validated before processing to prevent attacks:

- **Localhost blocking**: `127.0.0.1`, `::1`, `localhost`
- **Private IP ranges**: `10.x`, `192.168.x`, `172.16-31.x`, `169.254.x`
- **Cloud metadata endpoints**: `169.254.169.254`, `metadata.google.internal`
- **IPv4-Mapped IPv6 bypass prevention**: Detects `[::ffff:127.0.0.1]` attempts
- **Reserved ranges**: Addresses are parsed, so IPv4-mapped IPv6 in any spelling and unspecified, unique-local, link-local, CGNAT and other reserved ranges are refused
- **DNS resolution check**: Resolves the hostname and refuses it if any address it resolves to is blocked. The connection is not pinned to the checked address, so a host that changes its DNS answer between the check and the download (DNS rebinding) is not prevented

### Image File Validation

- **Magic byte checking**: Validates PNG, JPEG, WebP, GIF by file signature (not just extension)
- **File size limits**: 50MB maximum for downloads
- **Format validation**: Ensures proper file structure

### HTTPS Enforcement

The constructor rejects HTTP URLs:

```javascript
// This will throw an error
const api = new IdeogramAPI('key', 'http://insecure-api.com');
```

### Request Timeout & Size Protection

- **API request timeout**: 120 seconds (v1), 300 seconds (v2); `timeoutMs` overrides it per v2 request
- **Image download timeout**: 60 seconds; video and SVG downloads 5 minutes, streamed to disk
- **Response size limits**: 100MB for API responses, 200MB per image download, 2GB per video download
- **Upload limits**: 50MB per image file; per-request ceilings follow each endpoint's documented file count and size
- **Redirects**: API calls refuse redirects, so the `Api-Key` header is never sent to another host. Downloads follow at most 5, and the SSRF check runs again on every hop

### Parameter Validation

The CLI validates every request before sending it (`validateOperationParams()` for v1 operations, `validateV2Params()` for v2):

- Catches invalid parameters early
- Saves API credits by preventing failed requests
- Provides clear error messages

The library does not do this for you on v2: it sends v2 parameters unvalidated. Call `validateV2Params(operation, params)` from `ideogram-api/config` before you send.

## Error Handling

The service includes comprehensive error handling with clear messages:

### Synchronous Responses

The Ideogram 3.0 operations and the v2 image endpoints (unless you set `async`) return results directly, so a single `try`/`catch` covers the whole call. SVG and video do not: see [Synchronous, async and always-async](#synchronous-async-and-always-async).

```typescript
try {
  const response = await api.generate({ prompt: 'landscape' });
  // Response is ready immediately
  console.log('Success:', response);
} catch (error) {
  console.error('Error:', (error as Error).message);
}
```

### Common HTTP Status Codes

- **400 Bad Request**: Invalid parameters
- **401 Unauthorized**: Invalid API key
- **402 Payment Required** (v2): out of credits or quota; see `error.rejectReason`
- **403 Forbidden**: no access to this model (e.g. a custom model you do not own)
- **404 Not Found**: unknown generation ID, or a referenced asset that does not exist
- **422 Unprocessable Entity**: Parameter validation failed, or (v2) a rule such as `style_type` with source images
- **429 Too Many Requests**: Rate limit exceeded; on v2, `error.rejectReason` says which limit
- **500 Internal Server Error**: API server error

See [Errors](#errors) for the `IdeogramAPIError` fields.

### Error Messages

Clear, actionable error messages:

```javascript
// Invalid parameter
"Invalid aspect ratio '16:10'. Must be one of: 1x1, 16x9, ..."

// Missing API key
"IDEOGRAM_API_KEY not found. Please provide your API key via..."

// File validation
"Image file must be PNG, JPEG, WebP, or GIF format"

// Security
"SECURITY: Blocked access to private/internal IP: 127.0.0.1"
```

## Troubleshooting

### API Key Not Found

```
Error: IDEOGRAM_API_KEY not found. Please provide your API key via one of these methods...
```

**Solution:** Configure your API key using one of the methods in [Authentication Setup](#authentication-setup):

```bash
export IDEOGRAM_API_KEY=your_api_key
```

Or, for the CLI, create a `.env` file (the library does not read `.env` files):

```bash
echo "IDEOGRAM_API_KEY=your_api_key" > .env
```

### Invalid Aspect Ratio

```
Error: Invalid aspect ratio '16:10'. Must be one of: 1x1, 10x16, 16x10, ...
```

**Solution:** Use one of the 15 supported aspect ratios:

```bash
ideogram list-aspect-ratios
```

Or use `--resolution` for precise control:

```bash
ideogram generate --prompt "landscape" --resolution "1920x1080"
```

### Invalid Style Preset

```
Error: Invalid style preset 'CINEMATIC'. Must be one of: 80S_ILLUSTRATION, ...
```

**Solution:** Use the helper command to see all 62 valid presets:

```bash
ideogram list-style-presets
```

**Note:** Some presets like CINEMATIC, SURREALISM, FANTASY_ART are not valid.

### Reframe Requires Square Images

```
Error: Reframe operation requires perfectly square input images. Image dimensions: 1920x1080
```

**Solution:** The reframe operation only accepts square images. Crop or resize your image to square dimensions first:

```bash
# Valid
ideogram reframe --image square_1024x1024.jpg --resolution "1536x640"

# Invalid - not square
ideogram reframe --image landscape_1920x1080.jpg --resolution "1536x640"
```

### File Too Large

```
Error: File size exceeds maximum allowed size of 50MB
```

**Solution:** Reduce your image file size before uploading. Use compression or resize the image.

### Rate Limit Exceeded

```
Error: Request failed with status code 429
```

**Solution:**
- Wait before making additional requests
- Check your account limits at https://ideogram.ai/api
- Consider upgrading your plan for higher limits

### Module Not Found

```
Error: Cannot find module 'commander'
```

**Solution:** Reinstall dependencies:

```bash
npm install
```

## CLI Helper Commands

The CLI provides convenient commands to discover available options:

### List Style Presets

View all 62 available style presets in a formatted display:

```bash
ideogram list-style-presets
# or
npm run ideogram:list-styles
```

### List Aspect Ratios

View all 15 supported aspect ratios:

```bash
ideogram list-aspect-ratios
# or
npm run ideogram:list-ratios
```

**Available ratios:** 1x1, 10x16, 16x10, 9x16, 16x9, 3x2, 2x3, 4x5, 5x4, 9x21, 21x9, 1x3, 3x1, 4x3, 3x4

### List Resolutions

View all 69 supported resolutions organized by orientation:

```bash
ideogram list-resolutions
# or
npm run ideogram:list-resolutions
```

Resolutions are grouped by:
- **Portrait** (tall): 720x1280, 768x1344, etc.
- **Square**: 1024x1024, 1536x1536, 2048x2048
- **Landscape** (wide): 1280x720, 1344x768, etc.

### List Ideogram 4.0 Resolutions

View the Ideogram 4.0 resolutions (`generate-v4 --resolution`), which are also the 4.5 size presets:

```bash
ideogram list-v4-resolutions
```

## Style Presets

62 available style presets (use `ideogram list-style-presets` for formatted display):

```
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

**Note:** Some style presets like CINEMATIC, SURREALISM, and FANTASY_ART are not valid despite appearing in some documentation. Use the `list-style-presets` command to see the authoritative list.

## TypeScript Support

This package is written in TypeScript and provides full type definitions out of the box.

### Type Imports

```typescript
// Import the API class and helper functions
import { IdeogramAPI, extractImages, extractDescriptions } from 'ideogram-api';

// Import types for type annotations
import type {
  // API Options
  IdeogramApiOptions,

  // Parameter types
  GenerateParams,
  EditParams,
  RemixParams,
  ReframeParams,
  ReplaceBackgroundParams,
  UpscaleParams,
  DescribeParams,

  // Response types
  GenerationResponse,
  DescribeResponse,
  ImageData,
  Description,

  // Utility types
  RenderingSpeed,
  MagicPromptOption,
  StyleType,
  ColorPalette,
  ColorPalettePreset,
} from 'ideogram-api';
```

### Type-Safe Usage Example

```typescript
import { IdeogramAPI, extractImages } from 'ideogram-api';
import type { GenerateParams, GenerationResponse, ImageData, RenderingSpeed } from 'ideogram-api';

// Type-safe API initialization
const api = new IdeogramAPI(process.env.IDEOGRAM_API_KEY!);

// Type-safe parameters
const params: GenerateParams = {
  prompt: 'A serene mountain landscape',
  aspectRatio: '16x9',
  renderingSpeed: 'QUALITY' as RenderingSpeed,
  numImages: 2,
  seed: 12345
};

// Type-safe response handling
const response: GenerationResponse = await api.generate(params);
const images: ImageData[] = extractImages(response);

// Access typed properties
images.forEach((img: ImageData) => {
  console.log(`URL: ${img.url}`);
  console.log(`Resolution: ${img.resolution}`);
  console.log(`Seed: ${img.seed}`);
  console.log(`Safe: ${img.is_image_safe}`);
});
```

### Available Type Definitions

| Category | Types |
|----------|-------|
| **Configuration** | `IdeogramApiOptions` |
| **Parameters** | `GenerateParams`, `EditParams`, `RemixParams`, `ReframeParams`, `ReplaceBackgroundParams`, `UpscaleParams`, `DescribeParams` |
| **Responses** | `GenerationResponse`, `DescribeResponse`, `ImageData`, `Description` |
| **Enums/Unions** | `RenderingSpeed`, `MagicPromptOption`, `StyleType`, `DescribeModelVersion` |
| **Color Palettes** | `ColorPalette`, `ColorPalettePreset`, `CustomColorPalette` |
| **Validation** | `ValidationResult`, `ValidationParams`, `OperationConstraint` |
| **v2 parameters** | `GenerateV4Params`, `GenerateV4TransparentParams`, `GenerateV4CustomParams`, `GenerateV45Params`, `GenerateV46Params`, `GenerateAutoParams`, `PreciseEditV45Params`, `PreciseEditV46Params`, `GenerateSvgParams`, `MinimaxH3TextToVideoParams`, `MinimaxH3ImageToVideoParams`, `MinimaxH3ReferenceToVideoParams`, `Seedance25TextToVideoParams`, `Seedance25ImageToVideoParams`, `Seedance25ReferenceToVideoParams` |
| **v2 responses** | `V2GenerationResponse`, `V2Acknowledgement`, `PriceQuote`, `GenerationStatus`, `GenerationDataItem`, `VideoGenerationItem`, `SvgGenerationItem` |
| **v2 values** | `MagicPromptMode`, `RenderingSpeedV4`, `QualityV45`, `ImageSizeV46`, `AutoStyleType`, `V2ColorPalette`, `SvgQuality`, `AssetIdentifier`, `MinimaxH3Resolution`, `Seedance25Resolution`, ... (each widens to `string`, so values Ideogram adds later still type-check) |

### IDE Support

With TypeScript, you get full IDE support including:
- **Autocomplete** for all API methods and parameters
- **Inline documentation** from JSDoc comments
- **Type checking** to catch errors before runtime
- **Refactoring support** with accurate symbol references

## Batch Processing

Process multiple prompts in a single CLI call:

```bash
ideogram generate \
  --prompt "red sports car" \
  --prompt "blue sedan" \
  --prompt "green SUV" \
  --aspect-ratio "16x9" \
  --style-preset DRAMATIC_CINEMA
```

Images are generated sequentially with organized output.

## Configuration

Environment variables (read from the real environment; a `.env` file supplies only `IDEOGRAM_API_KEY`, and only to the CLI):

```bash
# Required
IDEOGRAM_API_KEY=your_api_key

# Optional
IDEOGRAM_OUTPUT_DIR=./custom-output  # Default: datasets/ideogram
NODE_ENV=production                   # Enables error sanitization
```

## Testing

```bash
# Run all tests
npm test

# Watch mode for development
npm run test:watch

# Coverage report
npm run test:coverage

# Interactive UI
npm run test:ui
```

**Test Coverage:** every operation's request shape (HTTP is stubbed, so the suite makes no network calls), the v2 validators, security features, the HTTP layer's limits, and utilities. `npm test` prints the current count.

## Development Scripts

### For Source Development

```bash
# Run CLI from source
npm run ideogram

# Show help
npm run ideogram:help

# Show examples
npm run ideogram:examples

# Helper commands
npm run ideogram:list-styles
npm run ideogram:list-ratios
npm run ideogram:list-resolutions

# Operations
npm run ideogram:generate
npm run ideogram:edit
npm run ideogram:remix
npm run ideogram:reframe
npm run ideogram:replace-background
npm run ideogram:upscale
npm run ideogram:describe
```

### Testing Commands

```bash
npm run verify        # Type-check, then run the tests (the pre-merge gate)
npm test              # Run tests once
npm run test:watch    # Run tests in watch mode
npm run test:ui       # Open Vitest UI
npm run test:coverage # Generate coverage report
```

## Rate Limits

Rate limits depend on your Ideogram API plan. Check your account at [https://ideogram.ai/api](https://ideogram.ai/api) for current limits.

**Recommendations:**
- Implement retry logic with exponential backoff for 429 errors
- Monitor your usage in the Ideogram dashboard
- Consider upgrading if you frequently hit limits

## Requirements

- Node.js >= 22.0.0
- An ES module project: the package is ESM-only and cannot be loaded with `require()`
- Ideogram API key

## Additional Resources

- [Ideogram API Documentation](https://developer.ideogram.ai/api-reference)
- [Ideogram API Keys](https://ideogram.ai/api)
- [Issue Tracker](https://github.com/aself101/ideogram-api/issues)
- [npm Package](https://www.npmjs.com/package/ideogram-api)

## Related Packages

This package is part of the img-gen ecosystem. Check out these other AI generation services:

- [`bfl-api`](https://github.com/aself101/bfl-api) - Black Forest Labs API wrapper for FLUX and Kontext models
- [`stability-ai-api`](https://github.com/aself101/stability-ai-api) - Stability AI API wrapper for Stable Diffusion 3.5 and image upscaling
- [`google-genai-api`](https://github.com/aself101/google-genai-api) - Google Generative AI (Imagen) wrapper
- [`openai-api`](https://github.com/aself101/openai-api) - OpenAI API wrapper for DALL-E and GPT Image generation

## License

MIT

## Contributing

Contributions welcome! Please follow the existing code patterns and include tests for new features.

1. Fork the repository
2. Create a feature branch
3. Make your changes with tests
4. Submit a pull request

## Support

- **Documentation**: [https://developer.ideogram.ai/api-reference](https://developer.ideogram.ai/api-reference)
- **Issues**: [https://github.com/aself101/ideogram-api/issues](https://github.com/aself101/ideogram-api/issues)
- **API Keys**: [https://ideogram.ai/api](https://ideogram.ai/api)

## Changelog

`CHANGELOG.md` is generated from commit messages by semantic-release on each release. The entries below are the hand-written history up to 1.0.3.

### Unreleased

- v2 API: Ideogram 4.0 / 4.5 / 4.6 generate and precise edit, automatic model selection, SVG (Ideogram Vector 1), and MiniMax H3 / Seedance 2.5 video; dry-run pricing; async polling
- HTTP moved from axios to Node's built-in `fetch`; `axios` and `form-data` are no longer dependencies, and `buildFormData` returns a native `FormData`
- `upscale()` calls the v2 upscaler (`upscaleFactor` x2 / x4 / x8); Ideogram retired the v1 endpoint, and its `prompt` / `resemblance` / `detail` / `magicPromptOption` / `numImages` are gone
- CLI `upscale` writes to `upscale-auto/` (was `upscale/`), and its `--prompt`, `--resemblance`, `--detail`, `--magic-prompt-option` and `--num-images` flags are removed
- A request that gets no HTTP response throws `IdeogramAPIError` with `code`; `downloadToFile` removes a partial file when a download fails or exceeds its size cap
- `buildFormData` names and types each file part from its bytes (`image.png` / `image/png`, `audio.wav` / `audio/wav`, ...); 1.x sent every file as `image.jpg`
- Removed from `ideogram-api/utils`: `saveImage`, `generateFilename`, `ensureDirectory`, `saveMetadata`, `pause`, `createSpinner` and the `logger` re-export (CLI plumbing, now internal; copy the lines you need or use Node's `fs`). `setLogLevel` stays
- Every failure after the request was sent (malformed JSON body, timeout while reading the body, non-JSON `Content-Type`, response body over 100MB) is an `IdeogramAPIError`, with `status` where there is one
- Timeouts and poll intervals (`timeoutMs`, `intervalMs`, CLI `--timeout`, `--poll-interval`, `--wait-timeout`) must be whole milliseconds from 1 to 2147483647 and are rejected before any request is sent otherwise; `waitForGeneration`'s 429 backoff doubles the interval, at least 1 s and at most 30 s, and never polls sooner than the current interval
- CLI output files never overwrite each other: each item gets its own name (the index survives truncation of long prompts) and an existing file is never replaced
- Every CLI command (v1 and v2) writes the metadata file before downloading, so a failed download keeps the record; the CLI warns, naming the file, when it cannot remove a partial or empty output file after a failed write
- `ideogram --version` prints `unknown` if it cannot read its package.json
- **Breaking:** importing the library no longer loads any `.env` file. Only the `ideogram` CLI reads `.env` files, and only `IDEOGRAM_API_KEY` from them; see [Migrating from 1.x](#migrating-from-1x)
- `validateImageUrl` (the SSRF guard behind the download helpers) checks every address a hostname resolves to and parses addresses, so IPv4-mapped IPv6 in any spelling and the unspecified, unique-local, link-local, CGNAT and other reserved ranges are refused; it does not pin the connection to the checked address
- `IdeogramAPIError.possiblyBilled` is `true` when the request was sent and the outcome is unknown or failed after sending; errors from `waitForGeneration` polling carry `generationId`, and the CLI prints the `get-generation --wait` resume command
- With `NODE_ENV=production`, messages for possibly-billed failures say the request may have run and been billed and to check usage before retrying
- The CLI prints the generation id and every result URL before writing anything to disk; a `--dry-run` that returns a real result is reported loudly and saved, and the command exits non-zero
- Requires Node.js 22 or later; see [Migrating from 1.x](#migrating-from-1x)

### v1.0.3

- **TypeScript Migration**: Complete rewrite in TypeScript with full type definitions
- Added comprehensive type exports for all parameters and responses
- Added TypeScript Support section to documentation with usage examples
- Updated all code examples to TypeScript syntax
- Package now includes `.d.ts` type declaration files
- Improved IDE support with autocomplete and inline documentation

### v1.0.2

- Minor bug fixes and improvements

### v1.0.1

- Added CLI helper commands for discovering options (list-style-presets, list-aspect-ratios, list-resolutions)
- CLI now shows help menu by default when run without arguments (consistent with other providers)
- Fixed --examples flag behavior to display properly
- Added npm script shortcuts for all helper commands
- Updated documentation with all 62 style presets
- Enhanced README with comprehensive examples and troubleshooting

### v1.0.0

- Initial release
- Support for all 7 Ideogram API endpoints
- Comprehensive CLI with subcommands
- Production-ready security features
- Batch processing support
- Complete test coverage (203 tests)

---

**Disclaimer:** This project is an independent community wrapper and is not affiliated with Ideogram.

Built with the [img-gen](https://github.com/aself101/img-gen) data collection architecture.
