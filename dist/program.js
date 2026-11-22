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
 *   ideogram upscale --image low_res.jpg --upscale-factor x4
 *   ideogram describe --image photo.jpg
 *
 * Ideogram 4.x / auto (v2 API):
 *   ideogram generate-v4 --prompt "a lighthouse at dawn"
 *   ideogram generate-transparent --prompt "a fox mascot" --output-resolution 2k
 *   ideogram generate-custom --prompt "..." --model model/my-model/version/1
 *   ideogram generate-v45 --prompt "make it night" --images street.jpg
 *   ideogram generate-v46 --prompt "a poster" --size auto_4k
 *   ideogram generate-auto --prompt "a watercolor map"
 *   ideogram precise-edit --prompt "add sunglasses" --image photo.png --mask mask.png
 *   ideogram precise-edit-v46 --prompt "add sunglasses" --image photo_4k.png
 *
 * SVG and video (v2 API, always asynchronous; --wait polls and downloads):
 *   ideogram generate-svg --prompt "a flat fox logo" --wait
 *   ideogram minimax-text-to-video --prompt "a fox in snow" --wait
 *   ideogram seedance-image-to-video --prompt "waves roll in" --image beach.png --wait
 *
 *   ideogram get-generation <generation_id> --wait
 *   (any v2 command) --dry-run   price the request without running or billing it
 */
import { Command } from 'commander';
import path from 'path';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { IdeogramAPI, extractImages, extractDescriptions, } from './api.js';
import { getIdeogramApiKey, validateOperationParams, DEFAULT_OUTPUT_DIR, ASPECT_RATIOS, RESOLUTIONS, RENDERING_SPEEDS, STYLE_PRESETS, V4_RESOLUTIONS, V4_ASPECT_RATIOS, V4_RENDERING_SPEEDS, V4_OUTPUT_RESOLUTIONS, V45_QUALITIES, V45_BACKGROUNDS, V46_SIZES, AUTO_RESOLUTION_TIERS, AUTO_STYLE_TYPES, V2_COLOR_PALETTE_PRESETS, SVG_QUALITIES, UPSCALE_FACTORS, ASSET_TYPES, MINIMAX_H3_ASPECT_RATIOS, MINIMAX_H3_RESOLUTIONS, MINIMAX_H3_PROMPT_EXPANSION_MODES, SEEDANCE_25_ASPECT_RATIOS, SEEDANCE_25_RESOLUTIONS, } from './config.js';
import { saveImage, saveMetadata, generateFilename, ensureDirectory, createSpinner, claimPath, } from './cli-io.js';
import { logger } from './logger.js';
import { setLogLevel, assertSquareImage, toError } from './utils.js';
import { executeV2, executeAsyncV2, executeGetGeneration, describeError, fetchImage, parseIntOption, } from './cli-v2.js';
// ES modules __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
/**
 * Read the package version. program.ts sits in dist/ or src/, one level below
 * package.json, so the first path resolves from both; the second is kept as a
 * fallback for a deeper layout.
 */
function getVersion() {
    for (const rel of [['..'], ['..', '..']]) {
        try {
            const pkg = JSON.parse(readFileSync(path.join(__dirname, ...rel, 'package.json'), 'utf8'));
            if (typeof pkg.version === 'string')
                return pkg.version;
        }
        catch {
            // try the next location
        }
    }
    return '1.0.0';
}
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
       --aspect-ratio "16x9" \\
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
13. Basic upscale (2x)
    $ ideogram upscale --image ./low_res.jpg

14. Upscale 4x, priced first
    $ ideogram upscale --image ./low_res.jpg --upscale-factor x4 --dry-run

15. Upscale 8x asynchronously, then wait and download
    $ ideogram upscale --image ./low_res.jpg --upscale-factor x8 --async --wait

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

IDEOGRAM 4.0 / 4.5 / AUTO (v2 API)
==================================
21. Ideogram 4.0
    $ ideogram generate-v4 --prompt "A lighthouse at dawn" --resolution 2048x2048

22. Price a request first (free: nothing is generated or billed)
    $ ideogram generate-v4 --prompt "A lighthouse at dawn" --dry-run

23. Transparent PNG at 4k
    $ ideogram generate-transparent --prompt "A cartoon fox mascot" --output-resolution 4k

24. Custom 4.0 model
    $ ideogram generate-custom --prompt "Product shot" --model model/my-model/version/1

25. Ideogram 4.5 text-to-image
    $ ideogram generate-v45 --prompt "A poster that says OPEN LATE" --quality high

26. Ideogram 4.5 edit (first image is edited, others are references)
    $ ideogram generate-v45 --prompt "Make it night" --images street.jpg ref.jpg

27. Automatic model selection
    $ ideogram generate-auto --prompt "A watercolor map of Lisbon" --aspect-ratio 16x9

28. Precise edit of a region of an 8K image at full resolution
    $ ideogram precise-edit --prompt "Add round black sunglasses." \\
        --image photo_8k.png --mask mask_8k.png --context-window auto

29. Async: submit, then wait and download
    $ ideogram generate-v45 --prompt "..." --async --wait
    $ ideogram get-generation <generation_id> --wait

30. Ideogram 4.6 at 4K, aspect ratio picked from the prompt
    $ ideogram generate-v46 --prompt "A poster that says OPEN LATE" --size auto_4k

31. Auto model selection with a style and a palette
    $ ideogram generate-auto --prompt "A coffee shop logo" --style-type design --color-palette ember

SVG AND VIDEO (always asynchronous: --wait polls, then downloads)
=================================================================
32. Flat-color SVG
    $ ideogram generate-svg --prompt "A fox logo" --no-gradient --wait

33. Price a video first (video is priced per second and tier)
    $ ideogram seedance-text-to-video --prompt "A red fox in snow" --resolution 1080p --duration 10 --dry-run

34. Animate a still, ending on a second frame
    $ ideogram minimax-image-to-video --prompt "The camera pans right" \\
        --image beach.png --end-image sunset.png --resolution 768P --wait

35. Reference to video with an audio track
    $ ideogram minimax-reference-to-video --prompt "Image 1 sings along to Audio 1" \\
        --reference-images singer.png --reference-audios song.mp3 --wait

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

RENDERING SPEEDS (3.0): ${RENDERING_SPEEDS.join(', ')}
ASPECT RATIOS (3.0): ${ASPECT_RATIOS.join(', ')}
RENDERING SPEEDS (4.0): ${V4_RENDERING_SPEEDS.join(', ')}
QUALITY (4.5 / 4.6): ${V45_QUALITIES.join(', ')}
SIZES (4.6): ${V46_SIZES.join(', ')}, or WIDTHxHEIGHT
VIDEO RESOLUTIONS: MiniMax H3 ${MINIMAX_H3_RESOLUTIONS.join(', ')}; Seedance 2.5 ${SEEDANCE_25_RESOLUTIONS.join(', ')}

${'='.repeat(80)}
  `);
}
/**
 * Download image from URL with SSRF protection.
 * Validates URL before downloading to prevent security vulnerabilities.
 * Returns the path written (the requested one, or a suffixed variant if it was taken).
 */
async function downloadImage(url, outputPath) {
    const buffer = await fetchImage(url);
    // Never overwrite: a taken name gets a -2, -3 ... suffix; the final path is returned.
    const claimed = await claimPath(outputPath);
    await saveImage(buffer, claimed);
    return claimed;
}
/**
 * Generic function to execute an API operation with common orchestration logic.
 * Reduces code duplication across all execute functions.
 */
async function executeOperation({ operation, spinnerMessage, successMessage, failureMessage, validateParams, apiMethodCaller, resultHandler, globalOptions, }) {
    try {
        setLogLevel(globalOptions.logLevel);
        const apiKey = getIdeogramApiKey(globalOptions.apiKey || null);
        const api = new IdeogramAPI(apiKey, undefined, globalOptions.logLevel);
        // Pre-flight validation (optional) - throws if invalid
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
        }
        catch (error) {
            spinner.stop(failureMessage);
            throw error;
        }
    }
    catch (error) {
        const err = toError(error);
        console.error(`\n✗ Error: ${describeError(err)}\n`);
        process.exit(1);
    }
}
/**
 * Main CLI program.
 * Builds a fresh commander program; nothing runs until it is parsed.
 */
export function createProgram() {
    const version = getVersion();
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
        .option('--rendering-speed <speed>', 'Rendering speed', 'DEFAULT')
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
    // UPSCALE command: Ideogram's v2 upscaler since 2.0 (the v1 endpoint was retired)
    program
        .command('upscale')
        .description('Upscale an image 2x, 4x or 8x (Ideogram picks the model)')
        .requiredOption('-i, --image <path>', 'Input image path (required, max 50MB)')
        .option('--upscale-factor <factor>', `Enlargement (${UPSCALE_FACTORS.join(', ')}; default x2); output is capped at 8192px per side`)
        .option('--seed <number>', 'Random seed (0-2147483647)')
        .option('--dry-run', 'Validate and price the request without running or billing it')
        .option('--async', 'Return a generation_id immediately instead of waiting')
        .option('--wait', 'With --async: poll until done, then download')
        .option('--poll-interval <ms>', 'Poll interval for --wait (ms)', '2000')
        .option('--webhook-url <url>', 'HTTPS URL Ideogram POSTs the finished result to')
        .option('--timeout <ms>', 'Request timeout (ms)')
        .action(async (options) => {
        await executeV2('upscale-auto', options, program.opts());
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
    // ==================== v2 COMMANDS (Ideogram 4.0 / 4.5 / auto) ====================
    /**
     * Add the options every v2 generation command shares.
     */
    function addV2CommonOptions(cmd, { delivery = true } = {}) {
        cmd
            .option('-n, --num-images <number>', 'Number of images (1-8)')
            .option('--seed <number>', 'Random seed (0-2147483647)')
            .option('--magic-prompt <mode>', 'Magic prompt (auto, on, off)')
            .option('--dry-run', 'Validate and price the request without running or billing it')
            .option('--async', 'Return a generation_id immediately instead of waiting')
            .option('--wait', 'With --async: poll until done, then download')
            .option('--poll-interval <ms>', 'Poll interval for --wait (ms)', '2000')
            .option('--timeout <ms>', 'Request timeout (ms)');
        if (delivery) {
            cmd
                .option('--webhook-url <url>', 'HTTPS URL Ideogram POSTs the finished result to')
                .option('--copyright-detection', 'Run copyright detection on generated images');
        }
        return cmd;
    }
    // GENERATE-V4 command
    addV2CommonOptions(program
        .command('generate-v4')
        .description('Generate images with Ideogram 4.0')
        .requiredOption('-p, --prompt <text>', 'Prompt, or a structured JSON prompt (required)')
        .option('-r, --resolution <size>', 'Resolution (see list-v4-resolutions); omit to pick from the prompt')
        .option('--rendering-speed <speed>', `Rendering speed (${V4_RENDERING_SPEEDS.join(', ')})`)).action(async (options) => {
        await executeV2('generate-v4', options, program.opts());
    });
    // GENERATE-TRANSPARENT command
    addV2CommonOptions(program
        .command('generate-transparent')
        .description('Generate transparent-background PNGs with Ideogram 4.0')
        .requiredOption('-p, --prompt <text>', 'Prompt (required)')
        .option('-a, --aspect-ratio <ratio>', `Aspect ratio (${V4_ASPECT_RATIOS.join(', ')})`)
        .option('--output-resolution <tier>', `Pixel budget (${V4_OUTPUT_RESOLUTIONS.join(', ')}); above 2k is upscaled`)
        .option('--rendering-speed <speed>', `Rendering speed (${V4_RENDERING_SPEEDS.join(', ')})`)).action(async (options) => {
        await executeV2('generate-v4-transparent', options, program.opts());
    });
    // GENERATE-CUSTOM command
    addV2CommonOptions(program
        .command('generate-custom')
        .description('Generate images with a custom Ideogram 4.0 model')
        .requiredOption('-p, --prompt <text>', 'Prompt (required)')
        .requiredOption('--model <uri>', 'Custom model URI: model/<name>/version/<version> (required)')
        .option('--transparent-background', 'Remove the background and return transparent PNGs')
        .option('-r, --resolution <size>', 'Resolution (see list-v4-resolutions)')
        .option('--rendering-speed <speed>', 'Rendering speed (the model decides which are supported)')).action(async (options) => {
        await executeV2('generate-v4-custom', options, program.opts());
    });
    // GENERATE-V45 / GENERATE-V46 commands (identical fields; 4.6 has its own limits and sizes)
    for (const [name, op, model, sizes] of [
        ['generate-v45', 'generate-v45', '4.5', 'auto, source, or WIDTHxHEIGHT'],
        ['generate-v46', 'generate-v46', '4.6', `${V46_SIZES.join(', ')}, or WIDTHxHEIGHT`],
    ]) {
        addV2CommonOptions(program
            .command(name)
            .description(`Generate with Ideogram ${model}, or edit source images with a prompt`)
            .requiredOption('-p, --prompt <text>', 'Prompt, or the edit instruction with --images (required)')
            .option('-i, --images <paths...>', 'Source images (max 5); the first is edited, others are references')
            .option('-m, --mask <path>', 'Mask for the first image (black = edit, white = keep)')
            .option('--size <size>', `Output size: ${sizes}`)
            .option('--background <bg>', `Background (${V45_BACKGROUNDS.join(', ')})`)
            .option('--quality <q>', `Quality (${V45_QUALITIES.join(', ')})`)).action(async (options) => {
            await executeV2(op, options, program.opts());
        });
    }
    // GENERATE-AUTO command
    addV2CommonOptions(program
        .command('generate-auto')
        .description('Generate with the model Ideogram picks for the request')
        .requiredOption('-p, --prompt <text>', 'Prompt, or the change to make with --images (required)')
        .option('-i, --images <paths...>', 'Source images to edit (max 10)')
        .option('--negative-prompt <text>', 'What to exclude (not with --images)')
        .option('-a, --aspect-ratio <ratio>', 'Aspect ratio (auto, or e.g. 16x9); not with --resolution')
        .option('-r, --resolution <size>', 'Resolution WIDTHxHEIGHT; not with --aspect-ratio')
        .option('--resolution-tier <tier>', `Resolution tier (${AUTO_RESOLUTION_TIERS.join(', ')})`)
        .option('--style-type <type>', `Style type (${AUTO_STYLE_TYPES.join(', ')}); not with --images`)
        .option('--color-palette <palette>', `Preset (${V2_COLOR_PALETTE_PRESETS.join(', ')}) or JSON {"members":[{"color_hex":"#..."}]}; not with --images`), { delivery: false }).action(async (options) => {
        await executeV2('generate-auto', options, program.opts());
    });
    // PRECISE-EDIT (4.5) / PRECISE-EDIT-V46 commands
    for (const [name, op, model, bound] of [
        ['precise-edit', 'precise-edit-v45', '4.5', '2048x2048'],
        ['precise-edit-v46', 'precise-edit-v46', '4.6', '4096x4096'],
    ]) {
        addV2CommonOptions(program
            .command(name)
            .description(`Edit an image with Ideogram ${model}, keeping its exact width and height`)
            .requiredOption('-p, --prompt <text>', 'Edit instruction (required)')
            .requiredOption('-i, --image <path>', 'Image to edit (required)')
            .option('--reference-images <paths...>', 'Guide images (max 4; max 3 with --mask)')
            .option('-m, --mask <path>', 'Mask (black = edit, white = keep), same size as the image')
            .option('--context-window <window>', `Region to edit: auto (default; around the mask, else the whole image), none, or y_min,x_min,y_max,x_max. Whole-image edits are bounded by ${bound}`)
            .option('--quality <q>', `Quality (${V45_QUALITIES.join(', ')})`)).action(async (options) => {
            await executeV2(op, options, program.opts());
        });
    }
    // ==================== v2 ALWAYS-ASYNC COMMANDS (SVG, video) ====================
    /** Options for commands whose endpoint always answers with a generation_id. */
    function addAsyncOptions(cmd) {
        return cmd
            .option('--webhook-url <url>', 'HTTPS URL Ideogram POSTs the finished result to')
            .option('--dry-run', 'Validate and price the request without running or billing it')
            .option('--wait', 'Poll until done, then download the results')
            .option('--poll-interval <ms>', 'Poll interval for --wait (ms)', '5000')
            .option('--wait-timeout <ms>', 'Give up waiting after this many ms (the job keeps running)', '1800000')
            .option('--timeout <ms>', 'Request timeout for the upload (ms)');
    }
    // GENERATE-SVG command
    addAsyncOptions(program
        .command('generate-svg')
        .description('Generate SVG artwork with Ideogram Vector 1')
        .requiredOption('-p, --prompt <text>', 'Prompt (max 9,500 characters) (required)')
        .option('-i, --images <paths...>', 'Source images to transform; the first is the primary source')
        .option('--asset <specs...>', `Existing Ideogram assets as sources, each TYPE:ID or TYPE:ID:COLLECTION (types: ${ASSET_TYPES.join(', ')}); take priority over --images`)
        .option('-a, --aspect-ratio <ratio>', `Aspect ratio (${V4_ASPECT_RATIOS.join(', ')})`)
        .option('--quality <q>', `Quality (${SVG_QUALITIES.join(', ')})`)
        .option('-n, --num-images <number>', 'Number of SVGs (1-8)')
        .option('--seed <number>', 'Random seed (0-2147483647)')
        .option('--no-gradient', 'Fill every shape with one flat color')
        .option('--private', 'Keep outputs private (the default for most accounts)')
        .option('--target-collection <id>', 'Writable destination collection ID')).action(async (options) => {
        await executeAsyncV2('generate-svg', options, program.opts());
    });
    // VIDEO commands: MiniMax H3 and Seedance 2.5, each as text / image / reference to video
    const VIDEO_COMMANDS = [
        {
            name: 'minimax-text-to-video',
            op: 'minimax-h3-text-to-video',
            describe: 'Text to video with MiniMax H3 (5-15s, up to 4K)',
            inputs: 'text',
            family: 'minimax',
        },
        {
            name: 'minimax-image-to-video',
            op: 'minimax-h3-image-to-video',
            describe: 'Image to video with MiniMax H3: animate a first frame',
            inputs: 'image',
            family: 'minimax',
        },
        {
            name: 'minimax-reference-to-video',
            op: 'minimax-h3-reference-to-video',
            describe: 'Reference to video with MiniMax H3 (address references as "Image 1", "Audio 1")',
            inputs: 'reference',
            family: 'minimax',
        },
        {
            name: 'seedance-text-to-video',
            op: 'seedance-2-5-text-to-video',
            describe: 'Text to video with Seedance 2.5 (4-30s, up to 1080p)',
            inputs: 'text',
            family: 'seedance',
        },
        {
            name: 'seedance-image-to-video',
            op: 'seedance-2-5-image-to-video',
            describe: 'Image to video with Seedance 2.5: animate a first frame',
            inputs: 'image',
            family: 'seedance',
        },
        {
            name: 'seedance-reference-to-video',
            op: 'seedance-2-5-reference-to-video',
            describe: 'Reference to video with Seedance 2.5 (needs a reference image; address as "[Image1]")',
            inputs: 'reference',
            family: 'seedance',
        },
    ];
    for (const v of VIDEO_COMMANDS) {
        const minimax = v.family === 'minimax';
        const cmd = program
            .command(v.name)
            .description(v.describe)
            .requiredOption('-p, --prompt <text>', `Prompt (max ${minimax ? '2,000' : '30,000'} characters) (required)`)
            .option('-r, --resolution <tier>', `Resolution (${(minimax ? MINIMAX_H3_RESOLUTIONS : SEEDANCE_25_RESOLUTIONS).join(', ')})`)
            .option('-d, --duration <seconds>', minimax ? 'Length in seconds (5-15, default 5)' : 'Length in seconds (4-30; omit to let the model pick)');
        if (v.inputs !== 'image') {
            cmd.option('-a, --aspect-ratio <ratio>', `Aspect ratio (${(minimax ? MINIMAX_H3_ASPECT_RATIOS : SEEDANCE_25_ASPECT_RATIOS).join(', ')})`);
        }
        if (v.inputs === 'image') {
            cmd
                .requiredOption('-i, --image <path>', 'First frame (required)')
                .option('--end-image <path>', 'Last frame; the video transitions to it');
        }
        if (v.inputs === 'reference') {
            cmd
                .option('--reference-images <paths...>', 'Reference images, in prompt order')
                .option('--reference-audios <paths...>', 'MP3 or WAV references, in prompt order (need a reference image)');
        }
        if (minimax && v.inputs === 'reference') {
            cmd.option('--prompt-expansion-mode <mode>', `How much the prompt may be rewritten (${MINIMAX_H3_PROMPT_EXPANSION_MODES.join(', ')})`);
        }
        if (!minimax) {
            cmd.option('--generate-audio', 'Generate an audio track (documented to roughly double the cost; price with --dry-run)');
        }
        addAsyncOptions(cmd).action(async (options) => {
            await executeAsyncV2(v.op, options, program.opts());
        });
    }
    // GET-GENERATION command
    program
        .command('get-generation <generationId>')
        .description("Get the status of an async v2 generation; downloads results when complete. An ID starting with '-' goes after --: get-generation --wait -- <id>")
        .option('--wait', 'Poll until the generation completes or fails')
        .option('--poll-interval <ms>', 'Poll interval (ms)', '2000')
        .option('--wait-timeout <ms>', 'With --wait: give up after this many ms', '1800000')
        .action(async (generationId, options) => {
        await executeGetGeneration(generationId, options, program.opts());
    });
    // LIST-V4-RESOLUTIONS command
    program
        .command('list-v4-resolutions')
        .description('List the Ideogram 4.0 resolutions (also the 4.5 presets)')
        .action(() => {
        console.log(`\n${'='.repeat(80)}`);
        console.log(`IDEOGRAM 4.0 RESOLUTIONS (${V4_RESOLUTIONS.length} total)`);
        console.log(`${'='.repeat(80)}\n`);
        const columns = 6;
        for (let i = 0; i < V4_RESOLUTIONS.length; i += columns) {
            console.log('  ' + V4_RESOLUTIONS.slice(i, i + columns).map((r) => r.padEnd(12)).join(''));
        }
        console.log(`\n${'='.repeat(80)}`);
        console.log('Usage: ideogram generate-v4 --prompt "..." --resolution <WIDTHxHEIGHT>');
        console.log(`${'='.repeat(80)}\n`);
        process.exit(0);
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
                .map((preset) => preset.padEnd(25))
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
        const portrait = RESOLUTIONS.filter((r) => {
            const [w, h] = r.split('x').map(Number);
            return h > w;
        }).slice(0, 20);
        console.log('    ' + portrait.join(', '));
        console.log('    ... and more\n');
        console.log('  Square:');
        const square = RESOLUTIONS.filter((r) => {
            const [w, h] = r.split('x').map(Number);
            return h === w;
        });
        console.log('    ' + square.join(', ') + '\n');
        console.log('  Landscape (wide):');
        const landscape = RESOLUTIONS.filter((r) => {
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
    return program;
}
/**
 * Entry point for the bin: handles --examples and the no-argument help before
 * handing argv to commander.
 */
export async function main(argv = process.argv) {
    // Handle examples flag before parsing (to avoid help display)
    if (argv.includes('--examples')) {
        showExamples();
        process.exit(0);
    }
    const program = createProgram();
    // Show help if no command
    if (!argv.slice(2).length) {
        program.help();
    }
    await program.parseAsync(argv);
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
        const apiKey = getIdeogramApiKey(globalOptions.apiKey || null);
        const api = new IdeogramAPI(apiKey, undefined, globalOptions.logLevel);
        const prompts = Array.isArray(options.prompt) ? options.prompt : [options.prompt];
        logger.info(`Processing ${prompts.length} prompt(s)`);
        for (let i = 0; i < prompts.length; i++) {
            const prompt = prompts[i];
            logger.info(`\nProcessing prompt ${i + 1}/${prompts.length}: "${prompt}"`);
            // Pre-flight validation - throws if invalid
            validateOperationParams('generate-v3', {
                prompt,
                aspectRatio: options.aspectRatio,
                resolution: options.resolution,
                renderingSpeed: options.renderingSpeed,
                magicPrompt: options.magicPrompt,
                numImages: parseIntOption('--num-images', options.numImages) ?? 1,
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
                    numImages: parseIntOption('--num-images', options.numImages) ?? 1,
                    seed: parseIntOption('--seed', options.seed),
                    colorPalette: options.colorPalette,
                    styleType: options.styleType,
                    stylePreset: options.stylePreset,
                });
                spinner.stop('✓ Generation complete\n');
                await saveResults(response, 'generate-v3', prompt, globalOptions.outputDir, {
                    ...options,
                    prompt: [prompt],
                });
            }
            catch (error) {
                spinner.stop('✗ Generation failed\n');
                throw error;
            }
        }
        console.log(`\n✓ All done! Processed ${prompts.length} prompt(s)\n`);
    }
    catch (error) {
        const err = toError(error);
        console.error(`\n✗ Error: ${describeError(err)}\n`);
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
            numImages: parseIntOption('--num-images', options.numImages) ?? 1,
            seed: parseIntOption('--seed', options.seed),
            renderingSpeed: options.renderingSpeed,
            styleType: options.styleType,
            stylePreset: options.stylePreset,
        }),
        resultHandler: (response, globalOpts) => saveResults(response, 'edit-v3', options.prompt, globalOpts.outputDir, options),
        globalOptions,
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
            imageWeight: parseIntOption('--image-weight', options.imageWeight),
            resolution: options.resolution,
            aspectRatio: options.aspectRatio,
            renderingSpeed: options.renderingSpeed,
            magicPrompt: options.magicPrompt,
            negativePrompt: options.negativePrompt,
            numImages: parseIntOption('--num-images', options.numImages) ?? 1,
            seed: parseIntOption('--seed', options.seed),
            styleType: options.styleType,
            stylePreset: options.stylePreset,
        }),
        resultHandler: (response, globalOpts) => saveResults(response, 'remix-v3', options.prompt, globalOpts.outputDir, options),
        globalOptions,
    });
}
/**
 * Execute reframe command.
 */
async function executeReframe(options, globalOptions) {
    // Checked before executeOperation, whose try/catch formats errors, so it
    // needs its own: until 2026-11-22 a non-square image crashed with a stack trace.
    try {
        await assertSquareImage(options.image);
    }
    catch (error) {
        console.error(`\n✗ Error: ${describeError(toError(error))}\n`);
        process.exit(1);
    }
    await executeOperation({
        operation: 'reframe-v3',
        spinnerMessage: 'Reframing image...',
        successMessage: '✓ Reframe complete\n',
        failureMessage: '✗ Reframe failed\n',
        validateParams: { resolution: options.resolution },
        apiMethodCaller: (api) => api.reframe({
            image: options.image,
            resolution: options.resolution,
            numImages: parseIntOption('--num-images', options.numImages) ?? 1,
            seed: parseIntOption('--seed', options.seed),
            renderingSpeed: options.renderingSpeed,
            stylePreset: options.stylePreset,
        }),
        resultHandler: (response, globalOpts) => saveResults(response, 'reframe-v3', `reframe-${options.resolution}`, globalOpts.outputDir, options),
        globalOptions,
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
            numImages: parseIntOption('--num-images', options.numImages) ?? 1,
            seed: parseIntOption('--seed', options.seed),
            renderingSpeed: options.renderingSpeed,
            stylePreset: options.stylePreset,
        }),
        resultHandler: (response, globalOpts) => saveResults(response, 'replace-background-v3', options.prompt, globalOpts.outputDir, options),
        globalOptions,
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
            describeModelVersion: options.describeModelVersion,
        },
        apiMethodCaller: (api) => api.describe({
            image: options.image,
            describeModelVersion: options.describeModelVersion,
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
            const metadataPath = await claimPath(path.join(outputDir, metadataFilename));
            await saveMetadata(metadataPath, {
                operation: 'describe',
                timestamp: new Date().toISOString(),
                image: options.image,
                parameters: options,
                descriptions,
            });
            console.log(`✓ Saved metadata: ${metadataPath}\n`);
        },
        globalOptions,
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
        if (!image.url) {
            console.log(`⚠ Image ${i + 1}/${images.length} failed safety checks; no URL returned`);
            continue;
        }
        // Truncate the prompt before the index is appended, so items stay distinct
        const filename = generateFilename(promptOrName, 'png', 50, images.length > 1 ? i + 1 : undefined);
        const imagePath = path.join(outputDir, filename);
        // Download and save image (never overwriting an existing file)
        const savedPath = await downloadImage(image.url, imagePath);
        console.log(`✓ Saved image ${i + 1}/${images.length}: ${savedPath}`);
    }
    // Save metadata
    const metadataFilename = generateFilename(promptOrName, 'json');
    const metadataPath = await claimPath(path.join(outputDir, metadataFilename));
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
                isImageSafe: img.is_image_safe,
            })),
        },
    });
    console.log(`✓ Saved metadata: ${metadataPath}`);
    console.log(`✓ Generated ${images.length} image(s) successfully`);
}
//# sourceMappingURL=program.js.map