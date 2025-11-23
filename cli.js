#!/usr/bin/env node

/**
 * Ideogram API CLI
 *
 * Command-line tool for generating and manipulating images using Ideogram API.
 * Supports all Ideogram operations with comprehensive options.
 *
 * Usage:
 *   ideogram generate --prompt "a serene landscape"
 *   ideogram edit --prompt "change sky" --image photo.jpg --mask mask.png
 *   ideogram remix --prompt "watercolor style" --image photo.jpg
 *   ideogram reframe --image square.jpg --resolution "1536x640"
 *   ideogram replace-background --prompt "tropical beach" --image portrait.jpg
 *   ideogram upscale --image low_res.jpg
 *   ideogram describe --image photo.jpg
 */

import { Command } from 'commander';
import { IdeogramAPI, extractImages, extractDescriptions } from './api.js';
import {
  getIdeogramApiKey,
  validateOperationParams,
  DEFAULT_OUTPUT_DIR,
  ASPECT_RATIOS,
  RESOLUTIONS,
  RENDERING_SPEEDS,
  STYLE_PRESETS
} from './config.js';
import {
  saveImage,
  saveMetadata,
  generateFilename,
  ensureDirectory,
  createSpinner,
  setLogLevel,
  logger,
  validateImageUrl,
  assertSquareImage
} from './utils.js';
import axios from 'axios';
import path from 'path';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';

// ES modules __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read version from package.json dynamically
const { version } = JSON.parse(
  readFileSync(path.join(__dirname, 'package.json'), 'utf8')
);

/**
 * Display usage examples.
 */
function showExamples() {
  console.log(`
${'='.repeat(80)}
IDEOGRAM API - USAGE EXAMPLES
${'='.repeat(80)}

GENERATE (Text-to-Image)
========================
1. Basic generation
   $ ideogram generate --prompt "A serene mountain landscape at sunset"

2. With aspect ratio and rendering speed
   $ ideogram generate \\
       --prompt "Futuristic cityscape" \\
       --aspect-ratio "16:9" \\
       --rendering-speed QUALITY

3. Multiple images with style
   $ ideogram generate \\
       --prompt "Character design concepts" \\
       --num-images 4 \\
       --style-preset WATERCOLOR

4. With custom resolution and color palette
   $ ideogram generate \\
       --prompt "Abstract art" \\
       --resolution "1024x1024" \\
       --color-palette "EMBER"

EDIT (Image Editing with Mask)
===============================
5. Edit with mask
   $ ideogram edit \\
       --prompt "Change the sky to golden hour" \\
       --image ./photo.jpg \\
       --mask ./mask.png

6. Edit with style
   $ ideogram edit \\
       --prompt "Make it vintage" \\
       --image ./photo.jpg \\
       --mask ./mask.png \\
       --style-preset ANALOG_NOSTALGIA

REMIX (Image-to-Image Transformation)
======================================
7. Remix with prompt
   $ ideogram remix \\
       --prompt "Transform into watercolor painting" \\
       --image ./photo.jpg

8. Remix with image weight control
   $ ideogram remix \\
       --prompt "Cyberpunk aesthetic" \\
       --image ./photo.jpg \\
       --image-weight 75

REFRAME (Square to Different Resolution)
=========================================
9. Reframe square image
   $ ideogram reframe \\
       --image ./square_photo.jpg \\
       --resolution "1536x640"

10. Reframe with style
    $ ideogram reframe \\
        --image ./square_photo.jpg \\
        --resolution "1344x768" \\
        --style-preset DRAMATIC_CINEMA

REPLACE BACKGROUND
==================
11. Replace background
    $ ideogram replace-background \\
        --prompt "A tropical beach at sunset" \\
        --image ./portrait.jpg

12. Replace background with style
    $ ideogram replace-background \\
        --prompt "Modern office interior" \\
        --image ./portrait.jpg \\
        --style-preset EDITORIAL

UPSCALE
=======
13. Basic upscale
    $ ideogram upscale --image ./low_res.jpg

14. Upscale with control
    $ ideogram upscale \\
        --image ./low_res.jpg \\
        --resemblance 85 \\
        --detail 90

15. Upscale with prompt
    $ ideogram upscale \\
        --image ./low_res.jpg \\
        --prompt "Enhance details" \\
        --num-images 2

DESCRIBE
========
16. Describe image
    $ ideogram describe --image ./photo.jpg

17. Describe with specific model
    $ ideogram describe \\
        --image ./photo.jpg \\
        --describe-model-version V_3

BATCH PROCESSING
================
18. Multiple prompts (generate)
    $ ideogram generate \\
        --prompt "red apple" \\
        --prompt "green apple" \\
        --prompt "yellow apple"

ADVANCED OPTIONS
================
19. Custom output directory
    $ ideogram generate \\
        --prompt "test" \\
        --output-dir ./my-outputs

20. Debug logging
    $ ideogram generate \\
        --prompt "test" \\
        --log-level debug

AUTHENTICATION OPTIONS:
A. CLI flag (highest priority)
   $ ideogram --api-key YOUR_KEY generate --prompt "test"

B. Environment variable
   $ export IDEOGRAM_API_KEY=YOUR_KEY
   $ ideogram generate --prompt "test"

C. Local .env file
   Create .env in current directory:
   IDEOGRAM_API_KEY=YOUR_KEY

D. Global config
   Create ~/.ideogram/.env:
   IDEOGRAM_API_KEY=YOUR_KEY

Get your API key at: https://ideogram.ai/api

RENDERING SPEEDS: ${RENDERING_SPEEDS.join(', ')}
ASPECT RATIOS: ${ASPECT_RATIOS.join(', ')}

${'='.repeat(80)}
  `);
}

/**
 * Download image from URL with SSRF protection.
 * Validates URL before downloading to prevent security vulnerabilities.
 */
async function downloadImage(url, outputPath) {
  // Validate URL to prevent SSRF attacks
  const validatedUrl = await validateImageUrl(url);

  const response = await axios.get(validatedUrl, {
    responseType: 'arraybuffer',
    timeout: 60000,
    maxContentLength: 100 * 1024 * 1024,
    maxRedirects: 5 // Limit redirects to prevent redirect loops
  });

  await saveImage(Buffer.from(response.data), outputPath);
}

/**
 * Main CLI program.
 */
const program = new Command();

program
  .name('ideogram')
  .description('Ideogram API - Image generation and manipulation')
  .version(version)
  .option('--api-key <key>', 'Ideogram API key')
  .option('-o, --output-dir <path>', 'Output directory', DEFAULT_OUTPUT_DIR)
  .option('--log-level <level>', 'Logging level (debug, info, warn, error)', 'info')
  .option('--examples', 'Show usage examples');

// GENERATE command
program
  .command('generate')
  .description('Generate images with Ideogram 3.0')
  .option('-p, --prompt <text...>', 'Generation prompt(s) (required)')
  .option('-r, --resolution <size>', 'Image resolution (e.g., 1024x1024)')
  .option('-a, --aspect-ratio <ratio>', 'Aspect ratio (e.g., 1x1, 16x9)')
  .option('--rendering-speed <speed>', `Rendering speed (${RENDERING_SPEEDS.join(', ')})`, 'DEFAULT')
  .option('--magic-prompt <option>', 'Magic prompt (AUTO, ON, OFF)', 'AUTO')
  .option('--negative-prompt <text>', 'Negative prompt')
  .option('-n, --num-images <number>', 'Number of images (1-8)', '1')
  .option('--seed <number>', 'Random seed')
  .option('--color-palette <palette>', 'Color palette preset name')
  .option('--style-type <type>', 'Style type (AUTO, GENERAL, REALISTIC, DESIGN, FICTION)')
  .option('--style-preset <preset>', 'Style preset name')
  .action(async (options) => {
    await executeGenerate(options, program.opts());
  });

// EDIT command
program
  .command('edit')
  .description('Edit image with mask using Ideogram 3.0')
  .requiredOption('-p, --prompt <text>', 'Editing prompt (required)')
  .requiredOption('-i, --image <path>', 'Input image path (required)')
  .requiredOption('-m, --mask <path>', 'Mask image path (required)')
  .option('--magic-prompt <option>', 'Magic prompt (AUTO, ON, OFF)', 'AUTO')
  .option('-n, --num-images <number>', 'Number of images (1-8)', '1')
  .option('--seed <number>', 'Random seed')
  .option('--rendering-speed <speed>', `Rendering speed`, 'DEFAULT')
  .option('--style-type <type>', 'Style type')
  .option('--style-preset <preset>', 'Style preset name')
  .action(async (options) => {
    await executeEdit(options, program.opts());
  });

// REMIX command
program
  .command('remix')
  .description('Remix image with Ideogram 3.0')
  .requiredOption('-p, --prompt <text>', 'Remix prompt (required)')
  .requiredOption('-i, --image <path>', 'Input image path (required)')
  .option('--image-weight <weight>', 'Image weight (0-100)')
  .option('-r, --resolution <size>', 'Output resolution')
  .option('-a, --aspect-ratio <ratio>', 'Output aspect ratio')
  .option('--rendering-speed <speed>', 'Rendering speed', 'DEFAULT')
  .option('--magic-prompt <option>', 'Magic prompt (AUTO, ON, OFF)', 'AUTO')
  .option('--negative-prompt <text>', 'Negative prompt')
  .option('-n, --num-images <number>', 'Number of images (1-8)', '1')
  .option('--seed <number>', 'Random seed')
  .option('--style-type <type>', 'Style type')
  .option('--style-preset <preset>', 'Style preset name')
  .action(async (options) => {
    await executeRemix(options, program.opts());
  });

// REFRAME command
program
  .command('reframe')
  .description('Reframe square image to different resolution')
  .requiredOption('-i, --image <path>', 'Input square image path (required)')
  .requiredOption('-r, --resolution <size>', 'Target resolution (required)')
  .option('-n, --num-images <number>', 'Number of images (1-8)', '1')
  .option('--seed <number>', 'Random seed')
  .option('--rendering-speed <speed>', 'Rendering speed', 'DEFAULT')
  .option('--style-preset <preset>', 'Style preset name')
  .action(async (options) => {
    await executeReframe(options, program.opts());
  });

// REPLACE-BACKGROUND command
program
  .command('replace-background')
  .description('Replace image background')
  .requiredOption('-p, --prompt <text>', 'Background description (required)')
  .requiredOption('-i, --image <path>', 'Input image path (required)')
  .option('--magic-prompt <option>', 'Magic prompt (AUTO, ON, OFF)', 'AUTO')
  .option('-n, --num-images <number>', 'Number of images (1-8)', '1')
  .option('--seed <number>', 'Random seed')
  .option('--rendering-speed <speed>', 'Rendering speed', 'DEFAULT')
  .option('--style-preset <preset>', 'Style preset name')
  .action(async (options) => {
    await executeReplaceBackground(options, program.opts());
  });

// UPSCALE command
program
  .command('upscale')
  .description('Upscale image')
  .requiredOption('-i, --image <path>', 'Input image path (required)')
  .option('-p, --prompt <text>', 'Optional prompt for guided upscaling')
  .option('--resemblance <value>', 'Resemblance to original (0-100)')
  .option('--detail <value>', 'Detail level (0-100)')
  .option('--magic-prompt-option <option>', 'Magic prompt option')
  .option('-n, --num-images <number>', 'Number of images (1-4)', '1')
  .option('--seed <number>', 'Random seed')
  .action(async (options) => {
    await executeUpscale(options, program.opts());
  });

// DESCRIBE command
program
  .command('describe')
  .description('Get image description')
  .requiredOption('-i, --image <path>', 'Input image path (required)')
  .option('--describe-model-version <version>', 'Model version (V_2, V_3)')
  .action(async (options) => {
    await executeDescribe(options, program.opts());
  });

// LIST-STYLE-PRESETS command
program
  .command('list-style-presets')
  .description('List all available style presets')
  .action(() => {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`IDEOGRAM API - AVAILABLE STYLE PRESETS (${STYLE_PRESETS.length} total)`);
    console.log(`${'='.repeat(80)}\n`);

    // Display in 3 columns for better readability
    const columns = 3;
    for (let i = 0; i < STYLE_PRESETS.length; i += columns) {
      const row = STYLE_PRESETS.slice(i, i + columns)
        .map(preset => preset.padEnd(25))
        .join('');
      console.log(`  ${row}`);
    }

    console.log(`\n${'='.repeat(80)}`);
    console.log('Usage: ideogram generate --prompt "..." --style-preset <PRESET_NAME>');
    console.log(`${'='.repeat(80)}\n`);
    process.exit(0);
  });

// LIST-ASPECT-RATIOS command
program
  .command('list-aspect-ratios')
  .description('List all available aspect ratios')
  .action(() => {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`IDEOGRAM API - AVAILABLE ASPECT RATIOS (${ASPECT_RATIOS.length} total)`);
    console.log(`${'='.repeat(80)}\n`);

    console.log('  ' + ASPECT_RATIOS.join(', '));

    console.log(`\n${'='.repeat(80)}`);
    console.log('Usage: ideogram generate --prompt "..." --aspect-ratio <RATIO>');
    console.log('Example: ideogram generate --prompt "landscape" --aspect-ratio "16x9"');
    console.log(`${'='.repeat(80)}\n`);
    process.exit(0);
  });

// LIST-RESOLUTIONS command
program
  .command('list-resolutions')
  .description('List all available resolutions')
  .action(() => {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`IDEOGRAM API - AVAILABLE RESOLUTIONS (${RESOLUTIONS.length} total)`);
    console.log(`${'='.repeat(80)}\n`);

    // Group by aspect ratio patterns for better organization
    console.log('  Portrait (tall):');
    const portrait = RESOLUTIONS.filter(r => {
      const [w, h] = r.split('x').map(Number);
      return h > w;
    }).slice(0, 20);
    console.log('    ' + portrait.join(', '));
    console.log('    ... and more\n');

    console.log('  Square:');
    const square = RESOLUTIONS.filter(r => {
      const [w, h] = r.split('x').map(Number);
      return h === w;
    });
    console.log('    ' + square.join(', ') + '\n');

    console.log('  Landscape (wide):');
    const landscape = RESOLUTIONS.filter(r => {
      const [w, h] = r.split('x').map(Number);
      return w > h;
    }).slice(0, 20);
    console.log('    ' + landscape.join(', '));
    console.log('    ... and more\n');

    console.log(`${'='.repeat(80)}`);
    console.log('Usage: ideogram generate --prompt "..." --resolution <WIDTHxHEIGHT>');
    console.log('Example: ideogram generate --prompt "logo" --resolution "1024x1024"');
    console.log('\nNote: Use --aspect-ratio for simpler size selection, or --resolution for precise control');
    console.log(`${'='.repeat(80)}\n`);
    process.exit(0);
  });

// Handle examples flag before parsing (to avoid help display)
if (process.argv.includes('--examples')) {
  showExamples();
  process.exit(0);
}

// Parse arguments
program.parse(process.argv);
const globalOptions = program.opts();

// Show help if no command
if (!process.argv.slice(2).length) {
  program.help();
}

/**
 * Generic function to execute an API operation with common orchestration logic.
 * Reduces code duplication across all execute functions.
 *
 * @param {Object} config - Configuration object
 * @param {string} config.operation - Operation name for validation (e.g., 'generate-v3')
 * @param {string} config.spinnerMessage - Message to show while operation is running
 * @param {string} config.successMessage - Message to show on success
 * @param {string} config.failureMessage - Message to show on failure
 * @param {Object} [config.validateParams] - Optional params to validate before operation
 * @param {Function} config.apiMethodCaller - Function that calls the API method, receives (api) as argument
 * @param {Function} config.resultHandler - Function that handles the API response, receives (response, globalOptions) as arguments
 * @param {Object} config.globalOptions - Global CLI options
 * @returns {Promise<void>}
 */
async function executeOperation({
  operation,
  spinnerMessage,
  successMessage,
  failureMessage,
  validateParams,
  apiMethodCaller,
  resultHandler,
  globalOptions
}) {
  try {
    setLogLevel(globalOptions.logLevel);
    const apiKey = getIdeogramApiKey(globalOptions.apiKey);
    const api = new IdeogramAPI(apiKey, undefined, globalOptions.logLevel);

    // Pre-flight validation (optional)
    if (validateParams) {
      validateOperationParams(operation, validateParams);
    }

    const spinner = createSpinner(spinnerMessage);
    spinner.start();

    try {
      const response = await apiMethodCaller(api);
      spinner.stop(successMessage);
      await resultHandler(response, globalOptions);
      console.log('\n✓ Done!\n');
    } catch (error) {
      spinner.stop(failureMessage);
      throw error;
    }
  } catch (error) {
    console.error(`\n✗ Error: ${error.message}\n`);
    process.exit(1);
  }
}

/**
 * Execute generate command.
 */
async function executeGenerate(options, globalOptions) {
  try {
    setLogLevel(globalOptions.logLevel);

    if (!options.prompt) {
      console.error('Error: --prompt is required\n');
      process.exit(1);
    }

    const apiKey = getIdeogramApiKey(globalOptions.apiKey);
    const api = new IdeogramAPI(apiKey, undefined, globalOptions.logLevel);

    const prompts = Array.isArray(options.prompt) ? options.prompt : [options.prompt];
    logger.info(`Processing ${prompts.length} prompt(s)`);

    for (let i = 0; i < prompts.length; i++) {
      const prompt = prompts[i];
      logger.info(`\nProcessing prompt ${i + 1}/${prompts.length}: "${prompt}"`);

      // Pre-flight validation
      validateOperationParams('generate-v3', {
        prompt,
        aspectRatio: options.aspectRatio,
        resolution: options.resolution,
        renderingSpeed: options.renderingSpeed,
        magicPrompt: options.magicPrompt,
        numImages: parseInt(options.numImages)
      });

      const spinner = createSpinner('Generating images...');
      spinner.start();

      try {
        const response = await api.generate({
          prompt,
          resolution: options.resolution,
          aspectRatio: options.aspectRatio,
          renderingSpeed: options.renderingSpeed,
          magicPrompt: options.magicPrompt,
          negativePrompt: options.negativePrompt,
          numImages: parseInt(options.numImages),
          seed: options.seed ? parseInt(options.seed) : undefined,
          colorPalette: options.colorPalette,
          styleType: options.styleType,
          stylePreset: options.stylePreset
        });

        spinner.stop('✓ Generation complete\n');

        await saveResults(response, 'generate-v3', prompt, globalOptions.outputDir, { prompt, ...options });

      } catch (error) {
        spinner.stop('✗ Generation failed\n');
        throw error;
      }
    }

    console.log(`\n✓ All done! Processed ${prompts.length} prompt(s)\n`);

  } catch (error) {
    console.error(`\n✗ Error: ${error.message}\n`);
    process.exit(1);
  }
}

/**
 * Execute edit command.
 */
async function executeEdit(options, globalOptions) {
  await executeOperation({
    operation: 'edit-v3',
    spinnerMessage: 'Editing image...',
    successMessage: '✓ Edit complete\n',
    failureMessage: '✗ Edit failed\n',
    validateParams: { prompt: options.prompt },
    apiMethodCaller: (api) => api.edit({
      prompt: options.prompt,
      image: options.image,
      mask: options.mask,
      magicPrompt: options.magicPrompt,
      numImages: parseInt(options.numImages),
      seed: options.seed ? parseInt(options.seed) : undefined,
      renderingSpeed: options.renderingSpeed,
      styleType: options.styleType,
      stylePreset: options.stylePreset
    }),
    resultHandler: (response, globalOpts) =>
      saveResults(response, 'edit-v3', options.prompt, globalOpts.outputDir, options),
    globalOptions
  });
}

/**
 * Execute remix command.
 */
async function executeRemix(options, globalOptions) {
  await executeOperation({
    operation: 'remix-v3',
    spinnerMessage: 'Remixing image...',
    successMessage: '✓ Remix complete\n',
    failureMessage: '✗ Remix failed\n',
    validateParams: { prompt: options.prompt },
    apiMethodCaller: (api) => api.remix({
      prompt: options.prompt,
      image: options.image,
      imageWeight: options.imageWeight ? parseInt(options.imageWeight) : undefined,
      resolution: options.resolution,
      aspectRatio: options.aspectRatio,
      renderingSpeed: options.renderingSpeed,
      magicPrompt: options.magicPrompt,
      negativePrompt: options.negativePrompt,
      numImages: parseInt(options.numImages),
      seed: options.seed ? parseInt(options.seed) : undefined,
      styleType: options.styleType,
      stylePreset: options.stylePreset
    }),
    resultHandler: (response, globalOpts) =>
      saveResults(response, 'remix-v3', options.prompt, globalOpts.outputDir, options),
    globalOptions
  });
}

/**
 * Execute reframe command.
 */
async function executeReframe(options, globalOptions) {
  await assertSquareImage(options.image);

  await executeOperation({
    operation: 'reframe-v3',
    spinnerMessage: 'Reframing image...',
    successMessage: '✓ Reframe complete\n',
    failureMessage: '✗ Reframe failed\n',
    validateParams: { resolution: options.resolution },
    apiMethodCaller: (api) => api.reframe({
      image: options.image,
      resolution: options.resolution,
      numImages: parseInt(options.numImages),
      seed: options.seed ? parseInt(options.seed) : undefined,
      renderingSpeed: options.renderingSpeed,
      stylePreset: options.stylePreset
    }),
    resultHandler: (response, globalOpts) =>
      saveResults(response, 'reframe-v3', `reframe-${options.resolution}`, globalOpts.outputDir, options),
    globalOptions
  });
}

/**
 * Execute replace-background command.
 */
async function executeReplaceBackground(options, globalOptions) {
  await executeOperation({
    operation: 'replace-background-v3',
    spinnerMessage: 'Replacing background...',
    successMessage: '✓ Background replacement complete\n',
    failureMessage: '✗ Background replacement failed\n',
    validateParams: { prompt: options.prompt },
    apiMethodCaller: (api) => api.replaceBackground({
      prompt: options.prompt,
      image: options.image,
      magicPrompt: options.magicPrompt,
      numImages: parseInt(options.numImages),
      seed: options.seed ? parseInt(options.seed) : undefined,
      renderingSpeed: options.renderingSpeed,
      stylePreset: options.stylePreset
    }),
    resultHandler: (response, globalOpts) =>
      saveResults(response, 'replace-background-v3', options.prompt, globalOpts.outputDir, options),
    globalOptions
  });
}

/**
 * Execute upscale command.
 */
async function executeUpscale(options, globalOptions) {
  await executeOperation({
    operation: 'upscale',
    spinnerMessage: 'Upscaling image...',
    successMessage: '✓ Upscale complete\n',
    failureMessage: '✗ Upscale failed\n',
    validateParams: {
      image: options.image,
      resemblance: options.resemblance ? parseInt(options.resemblance) : undefined,
      detail: options.detail ? parseInt(options.detail) : undefined,
      numImages: parseInt(options.numImages),
      magicPromptOption: options.magicPromptOption
    },
    apiMethodCaller: (api) => api.upscale({
      image: options.image,
      prompt: options.prompt,
      resemblance: options.resemblance ? parseInt(options.resemblance) : undefined,
      detail: options.detail ? parseInt(options.detail) : undefined,
      magicPromptOption: options.magicPromptOption,
      numImages: parseInt(options.numImages),
      seed: options.seed ? parseInt(options.seed) : undefined
    }),
    resultHandler: (response, globalOpts) =>
      saveResults(response, 'upscale', options.prompt || 'upscale', globalOpts.outputDir, options),
    globalOptions
  });
}

/**
 * Execute describe command.
 */
async function executeDescribe(options, globalOptions) {
  await executeOperation({
    operation: 'describe',
    spinnerMessage: 'Describing image...',
    successMessage: '✓ Description complete\n',
    failureMessage: '✗ Description failed\n',
    validateParams: {
      image: options.image,
      describeModelVersion: options.describeModelVersion
    },
    apiMethodCaller: (api) => api.describe({
      image: options.image,
      describeModelVersion: options.describeModelVersion
    }),
    resultHandler: async (response, globalOpts) => {
      const descriptions = extractDescriptions(response);

      console.log('\nDescriptions:\n');
      descriptions.forEach((desc, idx) => {
        console.log(`${idx + 1}. ${desc}\n`);
      });

      // Save metadata
      const outputDir = path.join(globalOpts.outputDir, 'describe');
      await ensureDirectory(outputDir);
      const metadataFilename = generateFilename(path.basename(options.image), 'json');
      const metadataPath = path.join(outputDir, metadataFilename);

      await saveMetadata(metadataPath, {
        operation: 'describe',
        timestamp: new Date().toISOString(),
        image: options.image,
        parameters: options,
        descriptions
      });

      console.log(`✓ Saved metadata: ${metadataPath}\n`);
    },
    globalOptions
  });
}

/**
 * Save results (images and metadata).
 */
async function saveResults(response, operation, promptOrName, baseOutputDir, options) {
  const images = extractImages(response);

  if (images.length === 0) {
    console.log('⚠ No images returned');
    return;
  }

  const outputDir = path.join(baseOutputDir, operation);
  await ensureDirectory(outputDir);

  for (let i = 0; i < images.length; i++) {
    const image = images[i];

    // Generate filename
    const filenameBase = images.length > 1
      ? `${promptOrName}-${i + 1}`
      : promptOrName;

    const filename = generateFilename(filenameBase);
    const imagePath = path.join(outputDir, filename);

    // Download and save image
    await downloadImage(image.url, imagePath);

    console.log(`✓ Saved image ${i + 1}/${images.length}: ${imagePath}`);
  }

  // Save metadata
  const metadataFilename = generateFilename(promptOrName, 'json');
  const metadataPath = path.join(outputDir, metadataFilename);

  await saveMetadata(metadataPath, {
    operation,
    timestamp: response.created || new Date().toISOString(),
    parameters: options,
    response: {
      imageCount: images.length,
      images: images.map((img, idx) => ({
        index: idx + 1,
        url: img.url,
        resolution: img.resolution,
        seed: img.seed,
        isImageSafe: img.is_image_safe
      }))
    }
  });

  console.log(`✓ Saved metadata: ${metadataPath}`);
  console.log(`✓ Generated ${images.length} image(s) successfully`);
}
