# Ideogram API - Node.js Wrapper

Node.js wrapper for the [Ideogram API](https://ideogram.ai/api), providing a comprehensive interface for AI-powered image generation, editing, remixing, and manipulation.

## Features

- **Generate**: Text-to-image generation with Ideogram 3.0
- **Edit**: Image editing with masks and natural language prompts
- **Remix**: Transform images while preserving characteristics
- **Reframe**: Change aspect ratios of square images
- **Replace Background**: Intelligent background replacement
- **Upscale**: High-quality image upscaling
- **Describe**: Get AI-generated image descriptions

All operations are **synchronous** (no polling required) and include comprehensive security features.

## Installation

```bash
npm install ideogram-api
```

## Quick Start

### CLI Usage

```bash
# Set your API key
export IDEOGRAM_API_KEY=your_api_key

# Show help (default behavior when no arguments provided)
ideogram

# View usage examples
ideogram --examples

# Discover available options
ideogram list-style-presets     # 62 style presets
ideogram list-aspect-ratios     # 15 aspect ratios
ideogram list-resolutions       # 69 resolutions

# Generate an image
ideogram generate --prompt "A serene mountain landscape"

# Edit an image
ideogram edit --prompt "Change sky to sunset" --image photo.jpg --mask mask.png

# Remix an image
ideogram remix --prompt "Watercolor style" --image photo.jpg

# Upscale an image
ideogram upscale --image low_res.jpg --resemblance 85 --detail 90

# Get image description
ideogram describe --image photo.jpg
```

## Image Requirements

- **Supported formats**: PNG, JPEG, WebP, and GIF are accepted for operations that upload images (edit, remix, reframe, replace background, upscale, describe).
- **Square images for Reframe**: The reframe endpoint only accepts perfectly square inputs. The CLI and API now validate dimensions locally to prevent wasted API calls.

### Programmatic Usage

```javascript
import { IdeogramAPI } from 'ideogram-api';

const api = new IdeogramAPI('your_api_key');

// Generate images
const response = await api.generate({
  prompt: 'A serene mountain landscape at sunset',
  aspectRatio: '16:9',
  renderingSpeed: 'QUALITY',
  numImages: 2
});

// Edit image with mask
const editResponse = await api.edit({
  prompt: 'Change the sky to golden hour',
  image: './photo.jpg',
  mask: './mask.png'
});

// Remix image
const remixResponse = await api.remix({
  prompt: 'Transform into watercolor painting',
  image: './photo.jpg',
  imageWeight: 75
});

// Upscale image
const upscaleResponse = await api.upscale({
  image: './low_res.jpg',
  resemblance: 85,
  detail: 90
});
```

## API Operations

### Generate (Text-to-Image)

Generate images from text prompts with extensive customization options.

**CLI:**
```bash
ideogram generate \
  --prompt "Futuristic cityscape at night" \
  --aspect-ratio "16:9" \
  --rendering-speed QUALITY \
  --num-images 2 \
  --style-preset DRAMATIC_CINEMA
```

**Programmatic:**
```javascript
const response = await api.generate({
  prompt: 'Futuristic cityscape at night',
  aspectRatio: '16:9',
  renderingSpeed: 'QUALITY',
  numImages: 2,
  stylePreset: 'DRAMATIC_CINEMA',
  seed: 12345
});
```

**Parameters:**
- `prompt` (required): Generation prompt (max 10,000 chars)
- `resolution`: Specific resolution (e.g., '1024x1024')
- `aspectRatio`: Aspect ratio (e.g., '1:1', '16:9', '4:3')
- `renderingSpeed`: FLASH, TURBO, DEFAULT, or QUALITY
- `magicPrompt`: AUTO, ON, or OFF
- `negativePrompt`: Things to avoid in generation
- `numImages`: Number of images (1-8)
- `seed`: Random seed for reproducibility
- `styleType`: AUTO, GENERAL, REALISTIC, DESIGN, FICTION
- `stylePreset`: One of 52 style presets (see below)
- `colorPalette`: Preset name or custom palette

### Edit (Image Editing with Mask)

Edit images using masks with natural language prompts.

**CLI:**
```bash
ideogram edit \
  --prompt "Change the sky to golden hour" \
  --image ./photo.jpg \
  --mask ./mask.png \
  --rendering-speed QUALITY
```

**Programmatic:**
```javascript
const response = await api.edit({
  prompt: 'Change the sky to golden hour',
  image: './photo.jpg',
  mask: './mask.png',
  renderingSpeed: 'QUALITY',
  stylePreset: 'GOLDEN_HOUR'
});
```

**Parameters:**
- `prompt` (required): Editing prompt
- `image` (required): Path to image or Buffer
- `mask` (required): Path to mask or Buffer
- `magicPrompt`: AUTO, ON, or OFF
- `numImages`: Number of variants (1-8)
- `seed`: Random seed
- `renderingSpeed`: Rendering speed
- `styleType`, `stylePreset`: Style controls

### Remix (Image-to-Image)

Transform images with prompts while preserving certain characteristics.

**CLI:**
```bash
ideogram remix \
  --prompt "Transform into watercolor painting" \
  --image ./photo.jpg \
  --image-weight 75 \
  --aspect-ratio "1:1"
```

**Programmatic:**
```javascript
const response = await api.remix({
  prompt: 'Transform into watercolor painting',
  image: './photo.jpg',
  imageWeight: 75,
  aspectRatio: '1:1'
});
```

**Parameters:**
- `prompt` (required): Transformation prompt
- `image` (required): Path to image or Buffer
- `imageWeight`: Influence of original (0-100)
- `resolution`, `aspectRatio`: Output dimensions
- `renderingSpeed`, `magicPrompt`: Generation controls
- `negativePrompt`, `numImages`, `seed`: Additional options
- `styleType`, `stylePreset`, `colorPalette`: Style controls

### Reframe (Aspect Ratio Change)

Reframe square images to different resolutions.

**CLI:**
```bash
ideogram reframe \
  --image ./square_photo.jpg \
  --resolution "1536x640" \
  --style-preset DRAMATIC_CINEMA
```

**Programmatic:**
```javascript
const response = await api.reframe({
  image: './square_photo.jpg',
  resolution: '1536x640',
  stylePreset: 'DRAMATIC_CINEMA'
});
```

**Parameters:**
- `image` (required): Square image path or Buffer
- `resolution` (required): Target resolution
- `numImages`: Number of variants (1-8)
- `seed`: Random seed
- `renderingSpeed`: Rendering speed
- `stylePreset`: Style preset

### Replace Background

Replace image backgrounds while keeping foreground subjects.

**CLI:**
```bash
ideogram replace-background \
  --prompt "A tropical beach at sunset" \
  --image ./portrait.jpg \
  --num-images 2
```

**Programmatic:**
```javascript
const response = await api.replaceBackground({
  prompt: 'A tropical beach at sunset',
  image: './portrait.jpg',
  numImages: 2
});
```

**Parameters:**
- `prompt` (required): Background description
- `image` (required): Path to image or Buffer
- `magicPrompt`: AUTO, ON, or OFF
- `numImages`: Number of variants (1-8)
- `seed`: Random seed
- `renderingSpeed`: Rendering speed
- `stylePreset`: Style preset

### Upscale

High-quality image upscaling with optional prompt guidance.

**CLI:**
```bash
ideogram upscale \
  --image ./low_res.jpg \
  --resemblance 85 \
  --detail 90 \
  --prompt "Enhance details"
```

**Programmatic:**
```javascript
const response = await api.upscale({
  image: './low_res.jpg',
  resemblance: 85,
  detail: 90,
  prompt: 'Enhance details',
  numImages: 2
});
```

**Parameters:**
- `image` (required): Path to image or Buffer
- `prompt`: Optional guidance prompt
- `resemblance`: Similarity to original (0-100)
- `detail`: Detail level (0-100)
- `magicPromptOption`: AUTO, ON, or OFF
- `numImages`: Number of variants (1-4)
- `seed`: Random seed

### Describe

Get AI-generated descriptions of images.

**CLI:**
```bash
ideogram describe \
  --image ./photo.jpg \
  --describe-model-version V_3
```

**Programmatic:**
```javascript
const response = await api.describe({
  image: './photo.jpg',
  describeModelVersion: 'V_3'
});

const descriptions = extractDescriptions(response);
console.log(descriptions);
```

**Parameters:**
- `image` (required): Path to image or Buffer
- `describeModelVersion`: V_2 or V_3

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

62 available style presets:

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

## Authentication

API key priority (highest to lowest):

1. **CLI flag**: `--api-key YOUR_KEY`
2. **Environment variable**: `IDEOGRAM_API_KEY`
3. **Local .env file**: `IDEOGRAM_API_KEY=YOUR_KEY`
4. **Global config**: `~/.ideogram/.env`

Get your API key at: https://ideogram.ai/api

## Batch Processing

Process multiple prompts in a single CLI call:

```bash
ideogram generate \
  --prompt "red apple" \
  --prompt "green apple" \
  --prompt "yellow apple" \
  --aspect-ratio "1:1"
```

## Security Features

This library includes comprehensive production-ready security:

- **HTTPS Enforcement**: Only HTTPS URLs allowed
- **API Key Redaction**: Keys never logged in full
- **SSRF Protection**: Blocks private IPs and metadata endpoints
- **IPv4-Mapped IPv6 Prevention**: Prevents bypass attempts
- **DNS Rebinding Prevention**: Blocks domains resolving to internal IPs (prevents TOCTOU attacks)
- **File Validation**: Magic byte checking for images
- **Size Limits**: 50MB max for uploads/downloads
- **DoS Prevention**: Timeouts and redirect limits
- **Error Sanitization**: Generic errors in production

## Configuration

Environment variables:

```bash
# Required
IDEOGRAM_API_KEY=your_api_key

# Optional
IDEOGRAM_OUTPUT_DIR=./custom-output  # Default: datasets/ideogram
NODE_ENV=production                   # Enables error sanitization
```

## Output Structure

Generated files are organized by operation:

```
datasets/ideogram/
├── generate-v3/
│   ├── 20250119_143022_serene-landscape.png
│   └── 20250119_143022_serene-landscape.json
├── edit-v3/
├── remix-v3/
├── reframe-v3/
├── replace-background-v3/
├── upscale/
└── describe/
```

Each image has an accompanying JSON metadata file.

## Testing

```bash
# Run tests
npm test

# Watch mode
npm run test:watch

# Coverage report
npm run test:coverage

# Interactive UI
npm run test:ui
```

## Examples

See all CLI examples:

```bash
ideogram --examples
```

## NPM Scripts

Convenient npm scripts for common operations:

```bash
# Help and examples
npm run ideogram:help               # Show help menu
npm run ideogram:examples           # Show usage examples

# Helper commands
npm run ideogram:list-styles        # List all 62 style presets
npm run ideogram:list-ratios        # List all 15 aspect ratios
npm run ideogram:list-resolutions   # List all 69 resolutions

# Operation shortcuts
npm run ideogram:generate           # Quick generate command
npm run ideogram:edit               # Quick edit command
npm run ideogram:remix              # Quick remix command
npm run ideogram:reframe            # Quick reframe command
npm run ideogram:replace-background # Quick background replace command
npm run ideogram:upscale            # Quick upscale command
npm run ideogram:describe           # Quick describe command
```

## API Reference

### Class: IdeogramAPI

```javascript
constructor(apiKey, baseUrl = 'https://api.ideogram.ai', logLevel = 'info')
```

**Methods:**
- `async generate(params)` - Generate images
- `async edit(params)` - Edit with mask
- `async remix(params)` - Remix images
- `async reframe(params)` - Reframe images
- `async replaceBackground(params)` - Replace backgrounds
- `async upscale(params)` - Upscale images
- `async describe(params)` - Describe images
- `setLogLevel(level)` - Change log level

### Helper Functions

```javascript
import { extractImages, extractDescriptions } from 'ideogram-api';

const images = extractImages(response);        // Extract image data
const descriptions = extractDescriptions(response);  // Extract descriptions
```

## Requirements

- Node.js >= 18.0.0
- Ideogram API key

## License

MIT

## Contributing

Contributions welcome! Please follow the existing code patterns and include tests.

## Support

- Documentation: https://developer.ideogram.ai/api-reference
- Issues: https://github.com/aself101/ideogram-api/issues
- API Keys: https://ideogram.ai/api

## Changelog

### v1.0.1

- Added CLI helper commands for discovering options (list-style-presets, list-aspect-ratios, list-resolutions)
- CLI now shows help menu by default when run without arguments (consistent with other providers)
- Fixed --examples flag behavior to display properly
- Added npm script shortcuts for all helper commands
- Updated documentation with all 62 style presets

### v1.0.0

- Initial release
- Support for all 7 Ideogram API endpoints
- Comprehensive CLI with subcommands
- Production-ready security features
- Batch processing support
- Complete test coverage

---

Built with the [img-gen](https://github.com/aself101/img-gen) data collection architecture.
