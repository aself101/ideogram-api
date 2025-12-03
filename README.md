# Ideogram API - Node.js Wrapper

[![npm version](https://img.shields.io/npm/v/ideogram-api.svg)](https://www.npmjs.com/package/ideogram-api)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js Version](https://img.shields.io/node/v/ideogram-api)](https://nodejs.org)
[![Tests](https://img.shields.io/badge/tests-203%20passing-brightgreen)](test/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)

A Node.js wrapper for the [Ideogram API](https://ideogram.ai/api) that provides comprehensive access to AI-powered image generation, editing, remixing, and manipulation. Generate, edit, upscale, and transform images with 62 style presets through a simple command-line interface.

This service follows the data-collection architecture pattern with organized data storage, synchronous responses, comprehensive logging, and CLI orchestration.

## Quick Demo

**Coming Soon:** Asciinema CLI demo showcasing all 7 operations

## Quick Start

### CLI Usage
```bash
# Install globally
npm install -g ideogram-api

export IDEOGRAM_API_KEY="your-api-key"

# Generate an image
ideogram generate --prompt "A serene mountain landscape"
```

### Programmatic Usage
```typescript
import { IdeogramAPI } from 'ideogram-api';
import type { GenerateParams, GenerationResponse } from 'ideogram-api';

const api = new IdeogramAPI('your_api_key');

// Generate image (synchronous - no polling needed!)
const response: GenerationResponse = await api.generate({
  prompt: 'A serene mountain landscape at sunset',
  aspectRatio: '16x9',
  renderingSpeed: 'QUALITY'
});

console.log('Generated images:', response.data);
```

## Table of Contents

- [Overview](#overview)
- [Operations](#operations)
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

- **7 Operations** - Generate, Edit, Remix, Reframe, Replace Background, Upscale, Describe
- **62 Style Presets** - More artistic styles than any other service
- **Synchronous Responses** - All operations return immediately (no polling required!)
- **Production Security** - API key redaction, error sanitization, HTTPS enforcement, comprehensive SSRF protection (including IPv4-mapped IPv6 bypass prevention)
- **DoS Prevention** - Request timeouts (120s API, 60s downloads), file size limits (50MB), redirect limits
- **DNS Rebinding Prevention** - Blocks domains resolving to internal IPs (prevents TOCTOU attacks)
- **Parameter Validation** - Pre-flight validation catches invalid parameters before API calls
- **API Key Authentication** - Multiple configuration methods with secure handling
- **Batch Processing** - Generate multiple images sequentially from multiple prompts
- **Helper Commands** - Easy discovery with list-style-presets, list-aspect-ratios, list-resolutions
- **Image Input Support** - Convert local files or URLs to Buffers with validation
- **Organized Storage** - Structured directories with timestamped files and metadata
- **CLI Orchestration** - Command-line tool for easy batch processing
- **Comprehensive Testing** - 203 tests with Vitest for reliability

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

High-quality image upscaling with optional prompt-guided enhancement.

**Features:**
- Resemblance control (0-100)
- Detail enhancement (0-100)
- Optional prompt guidance
- Up to 4 variations

**Use Cases:** Print preparation, detail enhancement, resolution increase

### Describe

Get AI-generated descriptions of images using Ideogram's vision model.

**Features:**
- Two model versions (V_2, V_3)
- Detailed natural language descriptions
- Multiple descriptions per image

**Use Cases:** Alt text generation, image cataloging, accessibility, content moderation

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

#### Option C: Local .env File (Project-Specific)

Create `.env` in your project directory:

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

# Upscale an image
ideogram upscale \
  --image ./photo.jpg \
  --resemblance 90 \
  --detail 85
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
import type { GenerationResponse, DescribeResponse, ImageData } from 'ideogram-api';

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

// Upscale image
const upscaleResponse: GenerationResponse = await api.upscale({
  image: './low_res.jpg',
  resemblance: 85,
  detail: 90,
  prompt: 'Enhance details and sharpness'
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
--num-images <number>        Number of images to generate (1-8, upscale max 4)
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
--mask <path>                Mask image file path (required)
```

### Remix-Specific Options

```bash
--image-weight <0-100>       Influence of original image (default: 50)
```

### Upscale-Specific Options

```bash
--resemblance <0-100>        Similarity to original (default: 80)
--detail <0-100>             Detail level (default: 80)
```

### Describe-Specific Options

```bash
--describe-model-version     V_2 | V_3 (default: V_3)
```

### Utility Commands

```bash
ideogram --help              Show help message
ideogram --examples          Show usage examples
ideogram list-style-presets  List all 62 style presets
ideogram list-aspect-ratios  List all 15 aspect ratios
ideogram list-resolutions    List all 69 resolutions
```

## API Methods

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

High-quality image upscaling.

**Parameters:**
- `image` (string|Buffer, required): Image file path or Buffer
- `prompt` (string): Optional guidance prompt
- `resemblance` (number): Similarity to original (0-100)
- `detail` (number): Detail level (0-100)
- `magicPromptOption` (string): AUTO, ON, or OFF
- `numImages` (number): Number of variants (1-4)
- `seed` (number): Random seed

**Returns:** Response object with upscaled images

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

## Examples

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

### Example 6: Image Upscaling with Enhancement

```bash
ideogram upscale \
  --image ./low_res.jpg \
  --resemblance 90 \
  --detail 85 \
  --prompt "Enhance facial details and sharpness" \
  --num-images 2
```

```typescript
const response = await api.upscale({
  image: './low_res.jpg',
  resemblance: 90,
  detail: 85,
  prompt: 'Enhance facial details and sharpness',
  numImages: 2
});
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
import { IdeogramAPI, extractImages, extractDescriptions } from 'ideogram-api';
import type { GenerationResponse, DescribeResponse, ImageData } from 'ideogram-api';

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
const upscaleResponse: GenerationResponse = await api.upscale({
  image: Buffer.from(await fetch(genImages[0].url).then(r => r.arrayBuffer())),
  resemblance: 90,
  detail: 85
});

// 3. Describe the upscaled image
console.log('Getting description...');
const upscaledImages: ImageData[] = extractImages(upscaleResponse);
const describeResponse: DescribeResponse = await api.describe({
  image: Buffer.from(await fetch(upscaledImages[0].url).then(r => r.arrayBuffer()))
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
├── upscale/
│   └── ...
└── describe/
    └── 20250120_144000_description.json
```

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

In production mode (`NODE_ENV=production`), detailed error messages are replaced with generic ones to prevent information disclosure:

```javascript
// Development: "Error: Invalid aspect ratio '16:10'. Must be one of: ..."
// Production: "An error occurred during the request."
```

### SSRF Protection (Server-Side Request Forgery)

All image URLs are validated before processing to prevent attacks:

- **Localhost blocking**: `127.0.0.1`, `::1`, `localhost`
- **Private IP ranges**: `10.x`, `192.168.x`, `172.16-31.x`, `169.254.x`
- **Cloud metadata endpoints**: `169.254.169.254`, `metadata.google.internal`
- **IPv4-Mapped IPv6 bypass prevention**: Detects `[::ffff:127.0.0.1]` attempts
- **DNS rebinding prevention**: Resolves domains and blocks those pointing to internal IPs

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

- **API request timeout**: 120 seconds
- **Image download timeout**: 60 seconds
- **File size limit**: 50MB maximum
- **Redirect limit**: Maximum 5 redirects

### Parameter Validation

All parameters are validated before making API calls using `validateOperationParams()`:

- Catches invalid parameters early
- Saves API credits by preventing failed requests
- Provides clear error messages

## Error Handling

The service includes comprehensive error handling with clear messages:

### Synchronous Responses

Unlike many APIs, Ideogram returns results immediately - no polling required! This makes error handling simpler:

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
- **422 Unprocessable Entity**: Parameter validation failed
- **429 Too Many Requests**: Rate limit exceeded
- **500 Internal Server Error**: API server error

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

Or create a `.env` file:

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
Error: Cannot find module 'axios'
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

Environment variables:

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

**Test Coverage:** 203 tests covering all operations, security features, and utilities.

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

- Node.js >= 18.0.0
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
