/**
 * v2 CLI execution: the code behind the Ideogram 4.x / auto / SVG / video
 * commands, split out of cli.ts so tests can import it. Importing this module
 * has no side effects (cli.ts owns `program.parse` and `process.exit` at load).
 */

import path from 'path';
import fs from 'fs/promises';
import { IdeogramAPI, isPriceQuote } from './api.js';
import type {
  V2GenerationResponse,
  V2Acknowledgement,
  V2ColorPalette,
  AssetIdentifier,
  PriceQuote,
  GenerationStatus,
  GenerationDataItem,
  GeneratedImage,
  UpscaleResponse,
  UpscaledImage,
  V2OperationKey,
} from './types/index.js';
import {
  getIdeogramApiKey,
  V2_LIMITS,
  validateV2Params,
  assertColorPalette,
  parseContextWindow,
  preciseEditBounds,
} from './config.js';
import type { V2ValidationParams } from './config.js';
import {
  saveImage,
  saveMetadata,
  generateFilename,
  ensureDirectory,
  createSpinner,
  setLogLevel,
  downloadBuffer,
  downloadToFile,
  getImageDimensions,
  toError,
} from './utils.js';

/**
 * Global CLI options interface.
 */
export interface GlobalOptions {
  apiKey?: string;
  outputDir: string;
  logLevel: string;
}

/**
 * Options for every v2 command (each command registers the subset it accepts).
 */
export interface V2CliOptions {
  /** Absent only on upscale. */
  prompt: string;
  upscaleFactor?: string;
  numImages?: string;
  seed?: string;
  magicPrompt?: string;
  dryRun?: boolean;
  async?: boolean;
  wait?: boolean;
  pollInterval?: string;
  timeout?: string;
  webhookUrl?: string;
  copyrightDetection?: boolean;
  resolution?: string;
  renderingSpeed?: string;
  aspectRatio?: string;
  outputResolution?: string;
  model?: string;
  transparentBackground?: boolean;
  images?: string[];
  mask?: string;
  size?: string;
  background?: string;
  quality?: string;
  negativePrompt?: string;
  resolutionTier?: string;
  styleType?: string;
  colorPalette?: string;
  image?: string;
  referenceImages?: string[];
  contextWindow?: string;
  // SVG
  asset?: string[];
  /** commander's --no-gradient: true unless the flag is given. */
  gradient?: boolean;
  private?: boolean;
  targetCollection?: string;
  // Video
  endImage?: string;
  referenceAudios?: string[];
  duration?: string;
  promptExpansionMode?: string;
  generateAudio?: boolean;
  /** --wait overall timeout (ms). */
  waitTimeout?: string;
}

/**
 * Message for a failed command. Network errors can arrive with a bare
 * message ("Error"), so append the error code when there is one.
 */
export function describeError(err: Error & { code?: string }): string {
  const code = err.code && !err.message.includes(err.code) ? ` [${err.code}]` : '';
  return `${err.message || 'Unknown error'}${code}`;
}

/**
 * The command that retrieves a generation. IDs are URL-safe base64, so about
 * 1 in 64 starts with '-', which commander would read as an option; such an
 * ID goes after `--` (found live 2026-11-22: -uaWvHfERk65rkfjaocs9w).
 */
export function getGenerationCommand(generationId: string): string {
  return generationId.startsWith('-')
    ? `ideogram get-generation --wait -- ${generationId}`
    : `ideogram get-generation ${generationId} --wait`;
}

/**
 * Fetch image bytes from a URL with SSRF protection on the URL and every
 * redirect. 200MB cap: 8k transparent PNGs can be large.
 */
export async function fetchImage(url: string): Promise<Buffer> {
  return downloadBuffer(url, { maxBytes: 200 * 1024 * 1024, timeoutMs: 60000 });
}


// ==================== v2 EXECUTION ====================

/** Parse an optional integer CLI value, rejecting non-integers rather than sending NaN. */
export function parseIntOption(name: string, value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!/^-?\d+$/.test(value.trim())) {
    throw new Error(`${name} must be an integer (got '${value}')`);
  }
  return Number(value);
}

/** Parse --color-palette: a preset name, or a JSON `{ name }` / `{ members }` object. */
export function parseColorPalette(value: string | undefined): V2ColorPalette | undefined {
  if (value === undefined) return undefined;
  if (!value.trim().startsWith('{')) return value;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new Error(`--color-palette is not valid JSON: ${toError(error).message}`);
  }
  assertColorPalette(parsed);
  return parsed;
}

/** Parse --asset values of the form TYPE:ID or TYPE:ID:COLLECTION. */
export function parseAssets(values: string[] | undefined): AssetIdentifier[] | undefined {
  if (!values || values.length === 0) return undefined;
  return values.map((spec) => {
    const parts = spec.split(':');
    if (parts.length < 2 || parts.length > 3 || !parts[0] || !parts[1]) {
      throw new Error(`--asset '${spec}' must be TYPE:ID or TYPE:ID:COLLECTION`);
    }
    const [asset_type, asset_id, collection_id] = parts;
    return collection_id ? { asset_type, asset_id, collection_id } : { asset_type, asset_id };
  });
}

/** Per-file size limit for a v2 operation's image uploads. */
function maxImageBytesFor(operation: V2OperationKey): number {
  const L = V2_LIMITS;
  if (operation.startsWith('precise-edit')) return L.preciseEdit.maxFileBytes;
  if (operation === 'generate-auto') return L.auto.maxFileBytes;
  if (operation === 'generate-v45' || operation === 'generate-v46') return L.v45.maxFileBytes;
  if (operation === 'generate-svg') return L.svgMaxFileBytes;
  if (operation === 'upscale-auto') return L.upscale.maxFileBytes;
  if (operation.startsWith('minimax-h3-')) return L.minimaxH3.maxFileBytes;
  return L.seedance25.maxFileBytes;
}

/**
 * Check local files against the documented v2 limits before uploading:
 * per-file size, mask dimensions, pixel caps, source aspect ratio, and an
 * explicit context window lying inside the image.
 */
async function preflightV2Images(operation: V2OperationKey, options: V2CliOptions): Promise<void> {
  const L = V2_LIMITS;
  const maxBytes = maxImageBytesFor(operation);
  const files = [
    ...(options.image ? [options.image] : []),
    ...(options.endImage ? [options.endImage] : []),
    ...(options.images || []),
    ...(options.referenceImages || []),
    ...(options.mask ? [options.mask] : []),
  ];
  for (const file of files) {
    const { size } = await fs.stat(file);
    if (size > maxBytes) {
      throw new Error(
        `${file} is ${(size / 1024 / 1024).toFixed(1)}MB; this endpoint accepts at most ${maxBytes / 1024 / 1024}MB per image`
      );
    }
  }
  const maxAudioBytes = operation.startsWith('minimax-h3-') ? L.minimaxH3.maxAudioBytes : L.seedance25.maxAudioBytes;
  for (const file of options.referenceAudios || []) {
    const { size } = await fs.stat(file);
    if (size > maxAudioBytes) {
      throw new Error(`${file} is ${(size / 1024 / 1024).toFixed(1)}MB; reference audio is limited to 15MB per file`);
    }
  }

  if (operation === 'upscale-auto' && options.image) {
    const factor = Number((options.upscaleFactor ?? 'x2').replace(/^x/, ''));
    const { width, height } = await getImageDimensions(options.image);
    if (Number.isFinite(factor) && Math.max(width, height) * factor > L.upscale.maxOutputSide) {
      throw new Error(
        `${width}x${height} upscaled x${factor} is ${width * factor}x${height * factor}; the output may not exceed ${L.upscale.maxOutputSide}px per side`
      );
    }
    return;
  }

  const isPreciseEdit = operation === 'precise-edit-v45' || operation === 'precise-edit-v46';
  const isV4x = operation === 'generate-v45' || operation === 'generate-v46';
  if (!isPreciseEdit && !isV4x) return;

  const primary = options.image || options.images?.[0];
  if (!primary) return;
  const dims = await getImageDimensions(primary);

  if (options.mask) {
    const maskDims = await getImageDimensions(options.mask);
    if (maskDims.width !== dims.width || maskDims.height !== dims.height) {
      throw new Error(
        `Mask is ${maskDims.width}x${maskDims.height} but the image is ${dims.width}x${dims.height}; they must match`
      );
    }
  }

  if (isPreciseEdit) {
    if (dims.width * dims.height > L.preciseEdit.maxImagePixels) {
      throw new Error(
        `Image is ${dims.width}x${dims.height}; precise edit accepts at most ${L.preciseEdit.maxImagePixels} pixels (8192x8192)`
      );
    }
    const bounds = preciseEditBounds(operation === 'precise-edit-v46' ? '4.6' : '4.5', options.quality);
    if (options.contextWindow) parseContextWindow(options.contextWindow, dims, bounds);
    // 'auto' (the default) edits the whole image when there is no mask.
    const ctx = options.contextWindow ?? 'auto';
    const wholeImage = ctx === 'none' || (ctx === 'auto' && !options.mask);
    if (wholeImage && dims.width * dims.height > bounds.maxPixels) {
      const side = Math.sqrt(bounds.maxPixels);
      console.log(
        `⚠ ${dims.width}x${dims.height} exceeds ${side}x${side} pixels: editing the whole image returns it scaled down (set --context-window, or --mask with the default auto)`
      );
    }
  }

  if (isV4x) {
    for (const file of options.images || []) {
      const d = file === primary ? dims : await getImageDimensions(file);
      if (Math.max(d.width / d.height, d.height / d.width) > L.maxAspect) {
        throw new Error(`${file} is ${d.width}x${d.height}; source aspect ratios must be between 1:6 and 6:1`);
      }
    }
  }
}

/** Print a dry-run price quote. */
function printQuote(quote: PriceQuote): void {
  console.log('\nPrice quote (dry run: nothing generated or billed)');
  console.log(`  Billing:  ${quote.quantity} x ${quote.billing_identifier}`);
  console.log(`  Price:    $${(quote.usd_micros / 1e6).toFixed(4)} (${quote.credit_millis / 1000} credits)`);
  console.log(`  Qualifier: ${quote.qualifier}`);
  if (quote.upper_bound_usd_micros !== undefined) {
    console.log(`  Upper bound: $${(quote.upper_bound_usd_micros / 1e6).toFixed(4)}`);
  }
}

/** The validation view of a v2 command's options. */
function toValidationParams(
  operation: V2OperationKey,
  options: V2CliOptions,
  parsed: { numImages?: number; seed?: number; duration?: number; colorPalette?: V2ColorPalette; assets?: AssetIdentifier[] }
): V2ValidationParams {
  const needsImage =
    operation.startsWith('precise-edit') ||
    operation.endsWith('-image-to-video') ||
    operation === 'upscale-auto';
  return {
    prompt: options.prompt,
    numImages: parsed.numImages,
    seed: parsed.seed,
    magicPrompt: options.magicPrompt,
    resolution: options.resolution,
    renderingSpeed: options.renderingSpeed,
    aspectRatio: options.aspectRatio,
    outputResolution: options.outputResolution,
    customModelUri: options.model,
    size: options.size,
    background: options.background,
    quality: options.quality,
    imageCount: options.images?.length,
    hasMask: options.mask !== undefined,
    referenceImageCount: options.referenceImages?.length,
    referenceAudioCount: options.referenceAudios?.length,
    contextWindow: options.contextWindow,
    negativePrompt: options.negativePrompt,
    resolutionTier: options.resolutionTier,
    styleType: options.styleType,
    colorPalette: parsed.colorPalette,
    imageAssetIdentifiers: parsed.assets,
    duration: parsed.duration,
    promptExpansionMode: options.promptExpansionMode,
    upscaleFactor: options.upscaleFactor,
    webhookUrl: options.webhookUrl,
    hasImage: needsImage ? options.image !== undefined : undefined,
  };
}

/**
 * Execute a v2 image command: validate, pre-flight local images, call the
 * API, then print a quote, save the images, or report / await an async generation.
 */
export async function executeV2(
  operation: V2OperationKey,
  options: V2CliOptions,
  globalOptions: GlobalOptions
): Promise<void> {
  try {
    setLogLevel(globalOptions.logLevel);

    const numImages = parseIntOption('--num-images', options.numImages);
    const seed = parseIntOption('--seed', options.seed);
    const timeoutMs = parseIntOption('--timeout', options.timeout);
    const pollInterval = parseIntOption('--poll-interval', options.pollInterval) ?? 2000;
    const colorPalette = parseColorPalette(options.colorPalette);

    if (options.wait && !options.async) {
      throw new Error('--wait requires --async (synchronous requests already wait)');
    }

    validateV2Params(operation, toValidationParams(operation, options, { numImages, seed, colorPalette }));
    await preflightV2Images(operation, options);

    const apiKey = getIdeogramApiKey(globalOptions.apiKey || null);
    const api = new IdeogramAPI(apiKey, undefined, globalOptions.logLevel);

    const common = {
      prompt: options.prompt,
      numImages,
      seed,
      magicPrompt: options.magicPrompt,
      dryRun: options.dryRun,
      async: options.async,
      timeoutMs,
    };
    const delivery = {
      webhookUrl: options.webhookUrl,
      enableCopyrightDetection: options.copyrightDetection,
    };

    const spinner = createSpinner(options.dryRun ? 'Pricing request...' : 'Generating...');
    spinner.start();

    let result: V2GenerationResponse | UpscaleResponse | PriceQuote;
    try {
      switch (operation) {
        case 'upscale-auto':
          result = await api.upscale({
            image: options.image as string,
            upscaleFactor: options.upscaleFactor,
            seed,
            async: options.async,
            webhookUrl: options.webhookUrl,
            dryRun: options.dryRun,
            timeoutMs,
          });
          break;
        case 'generate-v4':
          result = await api.generateV4({
            ...common,
            ...delivery,
            resolution: options.resolution,
            renderingSpeed: options.renderingSpeed,
          });
          break;
        case 'generate-v4-transparent':
          result = await api.generateV4Transparent({
            ...common,
            ...delivery,
            aspectRatio: options.aspectRatio,
            outputResolution: options.outputResolution,
            renderingSpeed: options.renderingSpeed,
          });
          break;
        case 'generate-v4-custom':
          result = await api.generateV4Custom({
            ...common,
            ...delivery,
            customModelUri: options.model as string,
            transparentBackground: options.transparentBackground,
            resolution: options.resolution,
            renderingSpeed: options.renderingSpeed,
          });
          break;
        case 'generate-v45':
        case 'generate-v46': {
          const params = {
            ...common,
            ...delivery,
            images: options.images,
            mask: options.mask,
            size: options.size,
            background: options.background,
            quality: options.quality,
          };
          result =
            operation === 'generate-v46' ? await api.generateV46(params) : await api.generateV45(params);
          break;
        }
        case 'generate-auto':
          result = await api.generateAuto({
            ...common,
            images: options.images,
            negativePrompt: options.negativePrompt,
            aspectRatio: options.aspectRatio,
            resolution: options.resolution,
            resolutionTier: options.resolutionTier,
            styleType: options.styleType,
            colorPalette,
          });
          break;
        case 'precise-edit-v45':
        case 'precise-edit-v46': {
          const params = {
            ...common,
            ...delivery,
            image: options.image as string,
            referenceImages: options.referenceImages,
            mask: options.mask,
            contextWindow: options.contextWindow,
            quality: options.quality,
          };
          result =
            operation === 'precise-edit-v46'
              ? await api.preciseEditV46(params)
              : await api.preciseEditV45(params);
          break;
        }
        default:
          throw new Error(`${operation} is not a synchronous image operation`);
      }
      spinner.stop(options.dryRun ? '✓ Priced\n' : '✓ Request complete\n');
    } catch (error) {
      spinner.stop('✗ Request failed\n');
      throw error;
    }

    if (isPriceQuote(result)) {
      printQuote(result);
      console.log('\n✓ Done!\n');
      return;
    }

    const parameters = { ...options };
    const name = options.prompt ?? 'upscale';
    const generationKind = 'generation_kind' in result ? result.generation_kind : undefined;
    if ('width' in result) {
      console.log(`Output: ${result.width}x${result.height}`);
    }
    if (result.data) {
      await saveV2Results(result.data, operation, name, globalOptions.outputDir, {
        generationId: result.generation_id,
        seed: result.seed,
        generationKind,
        parameters,
      });
    } else {
      console.log(`Generation accepted: ${result.generation_id}`);
      if (options.webhookUrl) {
        console.log(`Ideogram will POST the result to ${options.webhookUrl}`);
      }
      if (options.wait) {
        const done = await waitWithSpinner(api, result.generation_id, pollInterval);
        await saveV2Results(done.data || [], operation, name, globalOptions.outputDir, {
          generationId: result.generation_id,
          seed: result.seed,
          generationKind,
          usageCostUsdMicros: done.usage_cost_usd_micros,
          parameters,
        });
      } else {
        console.log(`Check on it with: ${getGenerationCommand(result.generation_id)}`);
      }
    }
    console.log('\n✓ Done!\n');
  } catch (error) {
    const err = toError(error);
    console.error(`\n✗ Error: ${describeError(err)}\n`);
    process.exit(1);
  }
}

/**
 * Execute an always-asynchronous v2 command (SVG, video): validate, submit,
 * then print the quote or the generation_id, and with --wait poll and download.
 */
export async function executeAsyncV2(
  operation: V2OperationKey,
  options: V2CliOptions,
  globalOptions: GlobalOptions
): Promise<void> {
  try {
    setLogLevel(globalOptions.logLevel);

    const numImages = parseIntOption('--num-images', options.numImages);
    const seed = parseIntOption('--seed', options.seed);
    const duration = parseIntOption('--duration', options.duration);
    const timeoutMs = parseIntOption('--timeout', options.timeout);
    const pollInterval = parseIntOption('--poll-interval', options.pollInterval) ?? 5000;
    const waitTimeout = parseIntOption('--wait-timeout', options.waitTimeout) ?? 1800000;
    const assets = parseAssets(options.asset);

    validateV2Params(operation, toValidationParams(operation, options, { numImages, seed, duration, assets }));
    await preflightV2Images(operation, options);

    const apiKey = getIdeogramApiKey(globalOptions.apiKey || null);
    const api = new IdeogramAPI(apiKey, undefined, globalOptions.logLevel);

    const base = {
      prompt: options.prompt,
      dryRun: options.dryRun,
      timeoutMs,
      webhookUrl: options.webhookUrl,
    };
    const video = { ...base, duration, resolution: options.resolution };

    const spinner = createSpinner(options.dryRun ? 'Pricing request...' : 'Submitting...');
    spinner.start();

    let result: V2Acknowledgement | PriceQuote;
    try {
      switch (operation) {
        case 'generate-svg':
          result = await api.generateSvg({
            ...base,
            images: options.images,
            imageAssetIdentifiers: assets,
            aspectRatio: options.aspectRatio,
            quality: options.quality,
            numImages,
            seed,
            // commander sets gradient=true unless --no-gradient; send only the
            // explicit opt-out so the API default applies otherwise.
            useGradient: options.gradient === false ? false : undefined,
            private: options.private,
            targetCollectionId: options.targetCollection,
          });
          break;
        case 'minimax-h3-text-to-video':
          result = await api.minimaxH3TextToVideo({ ...video, aspectRatio: options.aspectRatio });
          break;
        case 'minimax-h3-image-to-video':
          result = await api.minimaxH3ImageToVideo({
            ...video,
            image: options.image as string,
            endImage: options.endImage,
          });
          break;
        case 'minimax-h3-reference-to-video':
          result = await api.minimaxH3ReferenceToVideo({
            ...video,
            aspectRatio: options.aspectRatio,
            referenceImages: options.referenceImages,
            referenceAudios: options.referenceAudios,
            promptExpansionMode: options.promptExpansionMode,
          });
          break;
        case 'seedance-2-5-text-to-video':
          result = await api.seedance25TextToVideo({
            ...video,
            aspectRatio: options.aspectRatio,
            generateAudio: options.generateAudio,
          });
          break;
        case 'seedance-2-5-image-to-video':
          result = await api.seedance25ImageToVideo({
            ...video,
            image: options.image as string,
            endImage: options.endImage,
            generateAudio: options.generateAudio,
          });
          break;
        case 'seedance-2-5-reference-to-video':
          result = await api.seedance25ReferenceToVideo({
            ...video,
            aspectRatio: options.aspectRatio,
            referenceImages: options.referenceImages,
            referenceAudios: options.referenceAudios,
            generateAudio: options.generateAudio,
          });
          break;
        default:
          throw new Error(`${operation} is not an asynchronous operation`);
      }
      spinner.stop(options.dryRun ? '✓ Priced\n' : '✓ Submitted\n');
    } catch (error) {
      spinner.stop('✗ Request failed\n');
      throw error;
    }

    if (isPriceQuote(result)) {
      printQuote(result);
      console.log('\n✓ Done!\n');
      return;
    }

    console.log(`Generation accepted: ${result.generation_id}`);
    if (options.webhookUrl) {
      console.log(`Ideogram will POST the result to ${options.webhookUrl}`);
    }
    if (options.wait) {
      const done = await waitWithSpinner(api, result.generation_id, pollInterval, waitTimeout);
      await saveV2Results(done.data || [], operation, options.prompt, globalOptions.outputDir, {
        generationId: result.generation_id,
        usageCostUsdMicros: done.usage_cost_usd_micros,
        parameters: { ...options },
      });
    } else {
      console.log(`Check on it with: ${getGenerationCommand(result.generation_id)}`);
    }
    console.log('\n✓ Done!\n');
  } catch (error) {
    const err = toError(error);
    console.error(`\n✗ Error: ${describeError(err)}\n`);
    process.exit(1);
  }
}

/** Poll a generation with a spinner showing its status. */
async function waitWithSpinner(
  api: IdeogramAPI,
  generationId: string,
  intervalMs: number,
  timeoutMs?: number
): Promise<GenerationStatus> {
  const spinner = createSpinner(`Waiting for generation ${generationId}...`);
  spinner.start();
  try {
    const done = await api.waitForGeneration(generationId, {
      intervalMs,
      timeoutMs,
      onPoll: (s) => spinner.update(`Generation ${generationId}: ${s.status}`),
    });
    spinner.stop('✓ Generation complete\n');
    return done;
  } catch (error) {
    spinner.stop('✗ Generation did not complete\n');
    throw error;
  }
}

/**
 * Execute get-generation: print status; download results when completed.
 */
export async function executeGetGeneration(
  generationId: string,
  options: { wait?: boolean; pollInterval?: string; waitTimeout?: string },
  globalOptions: GlobalOptions
): Promise<void> {
  try {
    setLogLevel(globalOptions.logLevel);
    const apiKey = getIdeogramApiKey(globalOptions.apiKey || null);
    const api = new IdeogramAPI(apiKey, undefined, globalOptions.logLevel);
    const pollInterval = parseIntOption('--poll-interval', options.pollInterval) ?? 2000;
    const waitTimeout = parseIntOption('--wait-timeout', options.waitTimeout) ?? 1800000;

    const status = options.wait
      ? await waitWithSpinner(api, generationId, pollInterval, waitTimeout)
      : await api.getGeneration(generationId);

    console.log(`\nGeneration ${status.generation_id}: ${status.status} (created ${status.created})`);
    if (status.failure_reason) console.log(`Failure reason: ${status.failure_reason}`);
    if (status.usage_cost_usd_micros !== undefined) {
      console.log(`Usage cost: $${(status.usage_cost_usd_micros / 1e6).toFixed(4)}`);
    }

    if (status.status === 'completed') {
      await saveV2Results(status.data || [], 'generations', generationId, globalOptions.outputDir, {
        generationId,
        usageCostUsdMicros: status.usage_cost_usd_micros,
        parameters: { generationId },
      });
    } else if (status.status === 'pending') {
      console.log(`Still running. Re-run with --wait to poll until it finishes.`);
    }
    console.log('');
  } catch (error) {
    const err = toError(error);
    console.error(`\n✗ Error: ${describeError(err)}\n`);
    process.exit(1);
  }
}

/** File extension for downloaded bytes (v2 outputs may be PNG, JPEG or WebP). */
function extensionFor(buffer: Buffer): string {
  if (buffer[0] === 0x89 && buffer[1] === 0x50) return 'png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return 'jpg';
  if (buffer.slice(8, 12).toString() === 'WEBP') return 'webp';
  return 'png';
}

/** Extension for a video or SVG result: from the URL path when it has one, else by kind. */
function mediaExtension(item: GenerationDataItem): string {
  const fallback = item.object_type === 'svg.generation' ? 'svg' : 'mp4';
  try {
    const ext = path.extname(new URL(item.url as string).pathname).slice(1).toLowerCase();
    return /^[a-z0-9]{2,5}$/.test(ext) ? ext : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Download v2 results and write a metadata file. Images that failed safety
 * checks (empty url) are reported and skipped. Videos and SVGs are streamed
 * to disk; other result kinds are recorded in the metadata only.
 */
async function saveV2Results(
  items: Array<GenerationDataItem | GeneratedImage | UpscaledImage>,
  operation: string,
  promptOrName: string,
  baseOutputDir: string,
  meta: {
    generationId: string;
    seed?: number;
    generationKind?: string;
    usageCostUsdMicros?: number;
    parameters: Record<string, unknown>;
  }
): Promise<void> {
  if (items.length === 0) {
    console.log('⚠ No results returned');
    return;
  }

  const outputDir = path.join(baseOutputDir, operation);
  await ensureDirectory(outputDir);

  const saved: Array<Record<string, unknown>> = [];
  for (let i = 0; i < items.length; i++) {
    // GeneratedImage (sync responses) is a subset of GenerationDataItem's fields.
    const item = items[i] as GenerationDataItem;
    const label = `${i + 1}/${items.length}`;
    const base = items.length > 1 ? `${promptOrName}-${i + 1}` : promptOrName;
    const kind = item.object_type;

    if (kind === 'video.generation' || kind === 'svg.generation') {
      const noun = kind === 'video.generation' ? 'video' : 'SVG';
      if (!item.url) {
        console.log(`⚠ ${noun} ${label} has no URL (it may have failed safety checks)`);
        saved.push({ index: i + 1, objectType: kind, assetId: item.asset_id });
        continue;
      }
      const filePath = path.join(outputDir, generateFilename(base, mediaExtension(item)));
      await downloadToFile(item.url, filePath);
      console.log(`✓ Saved ${noun} ${label}: ${filePath}`);
      saved.push({
        index: i + 1,
        objectType: kind,
        path: filePath,
        url: item.url,
        assetId: item.asset_id,
        resolution: item.resolution,
        aspectRatio: item.aspect_ratio,
        duration: item.duration,
        width: item.width,
        height: item.height,
        finalPrompt: item.prompt,
      });
      continue;
    }
    if (kind && !kind.startsWith('image')) {
      console.log(`⚠ Item ${label} is a ${kind}; not downloaded (see metadata)`);
      saved.push({ index: i + 1, objectType: kind, url: item.url });
      continue;
    }
    if (item.is_image_safe === false || !item.url) {
      console.log(`⚠ Image ${label} failed safety checks; no URL returned`);
      saved.push({ index: i + 1, isImageSafe: false, resolution: item.resolution, seed: item.seed });
      continue;
    }
    const buffer = await fetchImage(item.url);
    const imagePath = path.join(outputDir, generateFilename(base, extensionFor(buffer)));
    await saveImage(buffer, imagePath);
    console.log(`✓ Saved image ${label}: ${imagePath}`);
    saved.push({
      index: i + 1,
      path: imagePath,
      url: item.url,
      resolution: item.resolution,
      seed: item.seed,
      isImageSafe: item.is_image_safe,
      finalPrompt: item.prompt,
    });
  }

  const metadataPath = path.join(outputDir, generateFilename(promptOrName, 'json'));
  await saveMetadata(metadataPath, {
    operation,
    timestamp: new Date().toISOString(),
    generationId: meta.generationId,
    seed: meta.seed,
    generationKind: meta.generationKind,
    usageCostUsdMicros: meta.usageCostUsdMicros,
    parameters: meta.parameters,
    response: { itemCount: items.length, items: saved },
  });
  console.log(`✓ Saved metadata: ${metadataPath}`);
}
