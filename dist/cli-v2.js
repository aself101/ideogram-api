/**
 * v2 CLI execution: the code behind the Ideogram 4.x / auto / SVG / video
 * commands, split out of cli.ts so tests can import it. Importing this module
 * has no side effects (cli.ts owns `program.parse` and `process.exit` at load).
 */
import path from 'path';
import fs from 'fs/promises';
import { IdeogramAPI, IdeogramAPIError, isPriceQuote, BILLING_NOTE } from './api.js';
import { discardFile, MAX_TIMER_MS } from './http.js';
import { getIdeogramApiKey, V2_LIMITS, validateV2Params, assertColorPalette, parseContextWindow, preciseEditBounds, } from './config.js';
import { saveImage, saveMetadata, generateFilename, ensureDirectory, createSpinner, claimPath, } from './cli-io.js';
import { setLogLevel, downloadBuffer, downloadToFile, getImageDimensions, toError, } from './utils.js';
/**
 * Message for a failed command. Network errors can arrive with a bare
 * message ("fetch failed", "Error") and the real reason on `cause`, so append
 * the cause's message when the error's own text does not already carry it, and
 * the error code (its own, else the cause's) when there is one.
 */
export function describeError(err) {
    const cause = err.cause;
    let message = err.message || 'Unknown error';
    if (typeof cause?.message === 'string' && cause.message && !message.includes(cause.message)) {
        message = `${message}: ${cause.message}`;
    }
    const rawCode = err.code ?? cause?.code;
    const code = typeof rawCode === 'string' && rawCode && !message.includes(rawCode) ? ` [${rawCode}]` : '';
    return `${message}${code}`;
}
/**
 * The command that retrieves a generation. IDs are URL-safe base64, so about
 * 1 in 64 starts with '-', which commander would read as an option; such an
 * ID goes after `--` (found live 2026-11-22: -uaWvHfERk65rkfjaocs9w).
 */
export function getGenerationCommand(generationId) {
    // Defensive: an id that is not a string (a malformed response) must not crash the report.
    if (typeof generationId !== 'string' || generationId === '') {
        return 'ideogram get-generation <generation-id> --wait';
    }
    return generationId.startsWith('-')
        ? `ideogram get-generation --wait -- ${generationId}`
        : `ideogram get-generation ${generationId} --wait`;
}
/**
 * Print a failed command's error, and for a resumable failure (`resumable`)
 * the command that picks the generation up, or for any other error that may
 * have been billed (possiblyBilled) the billing note. A generation that was
 * submitted keeps running (and stays billed) after a transient polling failure.
 * A generation the API reported as failed, or a 404, has nothing to resume.
 */
export function reportCommandError(err) {
    const described = describeError(err);
    console.error(`\n✗ Error: ${described}\n`);
    if (err.resumable === true && typeof err.generationId === 'string' && err.generationId !== '') {
        const command = getGenerationCommand(err.generationId);
        if (err.status === 401 || err.status === 403) {
            console.error(`  The generation may still complete. Fix the API key, then resume with: ${command}\n`);
        }
        else {
            console.error(`  The generation may still complete. Resume with: ${command}\n`);
        }
    }
    else if (err.possiblyBilled === true && !(err.message ?? '').endsWith(BILLING_NOTE)) {
        console.error(`  ${BILLING_NOTE}\n`);
    }
}
/**
 * Fetch image bytes from a URL with SSRF protection on the URL and every
 * redirect. 200MB cap: 8k transparent PNGs can be large.
 */
export async function fetchImage(url) {
    return downloadBuffer(url, { maxBytes: 200 * 1024 * 1024, timeoutMs: 60000 });
}
// ==================== v2 EXECUTION ====================
/**
 * Parse an optional integer CLI value, rejecting non-integers rather than sending NaN.
 * `min` and `max`, when given, also reject integers outside them.
 */
export function parseIntOption(name, value, min, max) {
    if (value === undefined)
        return undefined;
    if (!/^-?\d+$/.test(value.trim())) {
        throw new Error(`${name} must be an integer (got '${value}')`);
    }
    const n = Number(value);
    if (min !== undefined && n < min) {
        throw new Error(`${name} must be at least ${min} (got '${value}')`);
    }
    if (max !== undefined && n > max) {
        throw new Error(`${name} must be at most ${max} (got '${value}')`);
    }
    return n;
}
/** Parse --color-palette: a preset name, or a JSON `{ name }` / `{ members }` object. */
export function parseColorPalette(value) {
    if (value === undefined)
        return undefined;
    if (!value.trim().startsWith('{'))
        return value;
    let parsed;
    try {
        parsed = JSON.parse(value);
    }
    catch (error) {
        throw new Error(`--color-palette is not valid JSON: ${toError(error).message}`, { cause: error });
    }
    assertColorPalette(parsed);
    return parsed;
}
/** Parse --asset values of the form TYPE:ID or TYPE:ID:COLLECTION. */
export function parseAssets(values) {
    if (!values || values.length === 0)
        return undefined;
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
function maxImageBytesFor(operation) {
    const L = V2_LIMITS;
    if (operation.startsWith('precise-edit'))
        return L.preciseEdit.maxFileBytes;
    if (operation === 'generate-auto')
        return L.auto.maxFileBytes;
    if (operation === 'generate-v45' || operation === 'generate-v46')
        return L.v45.maxFileBytes;
    if (operation === 'generate-svg')
        return L.svgMaxFileBytes;
    if (operation === 'upscale-auto')
        return L.upscale.maxFileBytes;
    if (operation.startsWith('minimax-h3-'))
        return L.minimaxH3.maxFileBytes;
    return L.seedance25.maxFileBytes;
}
/** fs.stat for an input file, with the library's messages for a missing or unreadable file. */
async function statInput(file, kind) {
    try {
        return await fs.stat(file);
    }
    catch (error) {
        const code = error?.code;
        if (code === 'ENOENT')
            throw new Error(`${kind} file not found: ${file}`);
        if (code === 'EACCES')
            throw new Error(`Permission denied reading ${kind.toLowerCase()} file: ${file}`);
        throw error;
    }
}
/**
 * Check local files against the documented v2 limits before uploading:
 * per-file size, mask dimensions, pixel caps, source aspect ratio, and an
 * explicit context window lying inside the image.
 */
async function preflightV2Images(operation, options) {
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
        const { size } = await statInput(file, 'Image');
        if (size > maxBytes) {
            throw new Error(`${file} is ${(size / 1024 / 1024).toFixed(1)}MB; this endpoint accepts at most ${maxBytes / 1024 / 1024}MB per image`);
        }
    }
    const maxAudioBytes = operation.startsWith('minimax-h3-') ? L.minimaxH3.maxAudioBytes : L.seedance25.maxAudioBytes;
    for (const file of options.referenceAudios || []) {
        const { size } = await statInput(file, 'Audio');
        if (size > maxAudioBytes) {
            throw new Error(`${file} is ${(size / 1024 / 1024).toFixed(1)}MB; reference audio is limited to 15MB per file`);
        }
    }
    if (operation === 'upscale-auto' && options.image) {
        const factor = Number((options.upscaleFactor ?? 'x2').replace(/^x/, ''));
        const { width, height } = await getImageDimensions(options.image);
        if (Number.isFinite(factor) && Math.max(width, height) * factor > L.upscale.maxOutputSide) {
            throw new Error(`${width}x${height} upscaled x${factor} is ${width * factor}x${height * factor}; the output may not exceed ${L.upscale.maxOutputSide}px per side`);
        }
        return;
    }
    const isPreciseEdit = operation === 'precise-edit-v45' || operation === 'precise-edit-v46';
    const isV4x = operation === 'generate-v45' || operation === 'generate-v46';
    if (!isPreciseEdit && !isV4x)
        return;
    const primary = options.image || options.images?.[0];
    if (!primary)
        return;
    const dims = await getImageDimensions(primary);
    if (options.mask) {
        const maskDims = await getImageDimensions(options.mask);
        if (maskDims.width !== dims.width || maskDims.height !== dims.height) {
            throw new Error(`Mask is ${maskDims.width}x${maskDims.height} but the image is ${dims.width}x${dims.height}; they must match`);
        }
    }
    if (isPreciseEdit) {
        if (dims.width * dims.height > L.preciseEdit.maxImagePixels) {
            throw new Error(`Image is ${dims.width}x${dims.height}; precise edit accepts at most ${L.preciseEdit.maxImagePixels} pixels (8192x8192)`);
        }
        const bounds = preciseEditBounds(operation === 'precise-edit-v46' ? '4.6' : '4.5', options.quality);
        if (options.contextWindow)
            parseContextWindow(options.contextWindow, dims, bounds);
        // 'auto' (the default) edits the whole image when there is no mask.
        const ctx = options.contextWindow ?? 'auto';
        const wholeImage = ctx === 'none' || (ctx === 'auto' && !options.mask);
        if (wholeImage && dims.width * dims.height > bounds.maxPixels) {
            const side = Math.sqrt(bounds.maxPixels);
            console.log(`⚠ ${dims.width}x${dims.height} exceeds ${side}x${side} pixels: editing the whole image returns it scaled down (set --context-window, or --mask with the default auto)`);
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
/**
 * A response that has neither results nor a generation id (a dry run answered
 * with something that is not a price quote and not a generation): write it to
 * a metadata file so nothing that came back is lost, print where, and fail.
 * Never reached with a string generation_id or with data.
 */
async function saveRawResult(result, operation, name, baseOutputDir, parameters) {
    const outputDir = path.join(baseOutputDir, operation);
    let claimed;
    try {
        await ensureDirectory(outputDir);
        claimed = await claimPath(path.join(outputDir, generateFilename(name, 'json')));
        await saveMetadata(claimed, {
            operation,
            timestamp: new Date().toISOString(),
            parameters,
            response: result,
        });
    }
    catch (error) {
        if (claimed)
            await discardFile(claimed, 'the unfinished metadata file');
        console.error(`✗ The raw response could not be written under ${outputDir}: ${toError(error).message}`);
        throw new Error(`The API answered with neither results nor a generation id, for a request that may have been billed. ${BILLING_NOTE}`, { cause: error });
    }
    console.log(`✓ Saved the raw response: ${claimed}`);
    throw new Error(`The API answered with neither results nor a generation id, for a request that may have been billed. ${BILLING_NOTE} ` +
        `The raw response is in ${claimed}`);
}
/** Final error of a --dry-run that was answered with a real result. */
const DRY_RUN_BILLED_ERROR = 'The --dry-run request returned a real result instead of a price quote: it was NOT a dry run and may have been billed. ' +
    'The result was kept (saved or listed above); check your usage.';
/**
 * Loud warning, printed before the unexpected result is saved or listed.
 * `where`: 'saved' when results will be saved below, 'listed' when only the
 * generation id will be printed (async without --wait), 'raw' when the
 * response has neither, so the raw response itself is saved.
 */
function warnDryRunBilled(where) {
    const next = where === 'saved'
        ? 'The result is saved below'
        : where === 'listed'
            ? 'The generation id is listed below'
            : 'The raw response is saved below';
    console.error('\n⚠ WARNING: --dry-run was requested but the API returned a real result, not a price quote.\n' +
        `  The request may have run and been billed. ${next}; check your usage.\n`);
}
/** The real result a library dry run was answered with (EDRYRUNIGNORED), or undefined for any other error. */
function dryRunResultFrom(error) {
    if (error instanceof IdeogramAPIError && error.code === 'EDRYRUNIGNORED' && typeof error.result === 'object' && error.result !== null) {
        return error.result;
    }
    return undefined;
}
/** Print a dry-run price quote. */
function printQuote(quote) {
    console.log('\nPrice quote (dry run: nothing generated or billed)');
    console.log(`  Billing:  ${quote.quantity} x ${quote.billing_identifier}`);
    console.log(`  Price:    $${(quote.usd_micros / 1e6).toFixed(4)} (${quote.credit_millis / 1000} credits)`);
    console.log(`  Qualifier: ${quote.qualifier}`);
    if (quote.upper_bound_usd_micros !== undefined) {
        console.log(`  Upper bound: $${(quote.upper_bound_usd_micros / 1e6).toFixed(4)}`);
    }
}
/** The validation view of a v2 command's options. */
function toValidationParams(operation, options, parsed) {
    const needsImage = operation.startsWith('precise-edit') ||
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
export async function executeV2(operation, options, globalOptions) {
    try {
        setLogLevel(globalOptions.logLevel);
        const numImages = parseIntOption('--num-images', options.numImages);
        const seed = parseIntOption('--seed', options.seed);
        const timeoutMs = parseIntOption('--timeout', options.timeout, 1, MAX_TIMER_MS);
        const pollInterval = parseIntOption('--poll-interval', options.pollInterval, 1, MAX_TIMER_MS) ?? 2000;
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
        let result;
        let dryRunIgnored = false;
        try {
            switch (operation) {
                case 'upscale-auto':
                    result = await api.upscale({
                        image: options.image,
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
                        customModelUri: options.model,
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
                        image: options.image,
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
            spinner.stop(options.dryRun && isPriceQuote(result) ? '✓ Priced\n' : '✓ Request complete\n');
        }
        catch (error) {
            // A dry run the API answered with a real result: keep what came back so it is saved or listed.
            const real = dryRunResultFrom(error);
            if (!real) {
                spinner.stop('✗ Request failed\n');
                throw error;
            }
            spinner.stop('⚠ Request ran for real\n');
            result = real;
            dryRunIgnored = true;
        }
        if (isPriceQuote(result)) {
            printQuote(result);
            console.log('\n✓ Done!\n');
            return;
        }
        const rawOnly = !result.data && typeof result.generation_id !== 'string';
        if (dryRunIgnored) {
            warnDryRunBilled(rawOnly ? 'raw' : result.data || options.wait ? 'saved' : 'listed');
        }
        const parameters = { ...options };
        const name = options.prompt ?? 'upscale';
        if (rawOnly) {
            await saveRawResult(result, operation, name, globalOptions.outputDir, parameters);
        }
        const generationKind = 'generation_kind' in result ? result.generation_kind : undefined;
        if ('width' in result) {
            console.log(`Output: ${result.width}x${result.height}`);
        }
        if (result.data) {
            await saveV2Results(result.data, operation, name, globalOptions.outputDir, {
                rawResponse: result,
                generationId: result.generation_id,
                seed: result.seed,
                generationKind,
                parameters,
            });
        }
        else {
            console.log(`Generation accepted: ${result.generation_id}`);
            if (options.webhookUrl) {
                console.log(`Ideogram will POST the result to ${options.webhookUrl}`);
            }
            if (options.wait) {
                const done = await waitWithSpinner(api, result.generation_id, pollInterval);
                await saveV2Results(done.data || [], operation, name, globalOptions.outputDir, {
                    rawResponse: done,
                    generationId: result.generation_id,
                    seed: result.seed,
                    generationKind,
                    usageCostUsdMicros: done.usage_cost_usd_micros,
                    parameters,
                });
            }
            else {
                console.log(`Check on it with: ${getGenerationCommand(result.generation_id)}`);
            }
        }
        if (dryRunIgnored)
            throw new Error(DRY_RUN_BILLED_ERROR);
        console.log('\n✓ Done!\n');
    }
    catch (error) {
        reportCommandError(toError(error));
        process.exit(1);
    }
}
/**
 * Execute an always-asynchronous v2 command (SVG, video): validate, submit,
 * then print the quote or the generation_id, and with --wait poll and download.
 */
export async function executeAsyncV2(operation, options, globalOptions) {
    try {
        setLogLevel(globalOptions.logLevel);
        const numImages = parseIntOption('--num-images', options.numImages);
        const seed = parseIntOption('--seed', options.seed);
        const duration = parseIntOption('--duration', options.duration);
        const timeoutMs = parseIntOption('--timeout', options.timeout, 1, MAX_TIMER_MS);
        const pollInterval = parseIntOption('--poll-interval', options.pollInterval, 1, MAX_TIMER_MS) ?? 5000;
        const waitTimeout = parseIntOption('--wait-timeout', options.waitTimeout, 1, MAX_TIMER_MS) ?? 1800000;
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
        let result;
        let dryRunIgnored = false;
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
                        image: options.image,
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
                        image: options.image,
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
            spinner.stop(options.dryRun && isPriceQuote(result) ? '✓ Priced\n' : '✓ Submitted\n');
        }
        catch (error) {
            const real = dryRunResultFrom(error);
            if (!real) {
                spinner.stop('✗ Request failed\n');
                throw error;
            }
            spinner.stop('⚠ Request ran for real\n');
            result = real;
            dryRunIgnored = true;
        }
        if (isPriceQuote(result)) {
            printQuote(result);
            console.log('\n✓ Done!\n');
            return;
        }
        const rawOnly = typeof result.generation_id !== 'string';
        if (dryRunIgnored)
            warnDryRunBilled(rawOnly ? 'raw' : options.wait ? 'saved' : 'listed');
        if (rawOnly) {
            await saveRawResult(result, operation, options.prompt, globalOptions.outputDir, { ...options });
        }
        console.log(`Generation accepted: ${result.generation_id}`);
        if (options.webhookUrl) {
            console.log(`Ideogram will POST the result to ${options.webhookUrl}`);
        }
        if (options.wait) {
            const done = await waitWithSpinner(api, result.generation_id, pollInterval, waitTimeout);
            await saveV2Results(done.data || [], operation, options.prompt, globalOptions.outputDir, {
                rawResponse: done,
                generationId: result.generation_id,
                usageCostUsdMicros: done.usage_cost_usd_micros,
                parameters: { ...options },
            });
        }
        else {
            console.log(`Check on it with: ${getGenerationCommand(result.generation_id)}`);
        }
        if (dryRunIgnored)
            throw new Error(DRY_RUN_BILLED_ERROR);
        console.log('\n✓ Done!\n');
    }
    catch (error) {
        reportCommandError(toError(error));
        process.exit(1);
    }
}
/** Poll a generation with a spinner showing its status. */
async function waitWithSpinner(api, generationId, intervalMs, timeoutMs) {
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
    }
    catch (error) {
        spinner.stop('✗ Generation did not complete\n');
        throw error;
    }
}
/**
 * Execute get-generation: print status; download results when completed.
 */
export async function executeGetGeneration(generationId, options, globalOptions) {
    let generationFailed = false;
    try {
        setLogLevel(globalOptions.logLevel);
        const apiKey = getIdeogramApiKey(globalOptions.apiKey || null);
        const api = new IdeogramAPI(apiKey, undefined, globalOptions.logLevel);
        const pollInterval = parseIntOption('--poll-interval', options.pollInterval, 1, MAX_TIMER_MS) ?? 2000;
        const waitTimeout = parseIntOption('--wait-timeout', options.waitTimeout, 1, MAX_TIMER_MS) ?? 1800000;
        const status = options.wait
            ? await waitWithSpinner(api, generationId, pollInterval, waitTimeout)
            : await api.getGeneration(generationId);
        console.log(`\nGeneration ${status.generation_id}: ${status.status} (created ${status.created})`);
        if (status.failure_reason)
            console.log(`Failure reason: ${status.failure_reason}`);
        generationFailed = status.status === 'failed';
        if (status.usage_cost_usd_micros !== undefined) {
            console.log(`Usage cost: $${(status.usage_cost_usd_micros / 1e6).toFixed(4)}`);
        }
        if (status.status === 'completed') {
            await saveV2Results(status.data || [], 'generations', generationId, globalOptions.outputDir, {
                rawResponse: status,
                generationId,
                usageCostUsdMicros: status.usage_cost_usd_micros,
                parameters: { generationId },
            });
        }
        else if (status.status === 'pending') {
            console.log(`Still running. Re-run with --wait to poll until it finishes.`);
        }
        console.log('');
    }
    catch (error) {
        reportCommandError(toError(error));
        process.exit(1);
    }
    // A failed generation is a failed command, with or without --wait (a pending one is just a status query).
    if (generationFailed)
        process.exit(1);
}
/** File extension for downloaded bytes (v2 outputs may be PNG, JPEG or WebP). */
function extensionFor(buffer) {
    if (buffer[0] === 0x89 && buffer[1] === 0x50)
        return 'png';
    if (buffer[0] === 0xff && buffer[1] === 0xd8)
        return 'jpg';
    if (buffer.slice(8, 12).toString() === 'WEBP')
        return 'webp';
    return 'png';
}
/** Extension for a video or SVG result: from the URL path when it has one, else by kind. */
function mediaExtension(item) {
    const fallback = item.object_type === 'svg.generation' ? 'svg' : 'mp4';
    try {
        const ext = path.extname(new URL(item.url).pathname).slice(1).toLowerCase();
        return /^[a-z0-9]{2,5}$/.test(ext) ? ext : fallback;
    }
    catch {
        // best effort: pure URL parsing, no I/O; an unparseable URL just takes the by-kind extension
        return fallback;
    }
}
/**
 * Remove the placeholder claimPath created when the write that should have
 * filled it failed. The file may already be gone (streamToFile removes its own
 * partial output): ENOENT is fine. Any other failure is logged by discardFile
 * with the path; the caller still rethrows the original write error.
 */
async function discardClaimed(filePath) {
    await discardFile(filePath, 'the unfinished output file');
}
/**
 * Download v2 results and write a metadata file. Images that failed safety
 * checks (empty url) are reported and skipped. Videos and SVGs are streamed
 * to disk; other result kinds are recorded in the metadata only.
 */
async function saveV2Results(items, operation, promptOrName, baseOutputDir, meta) {
    // The generation is already billed. Before anything touches the disk, print
    // its id and every result URL (console.log: --log-level does not silence it),
    // so no disk failure below can lose them.
    if (meta.generationId)
        console.log(`Generation id: ${meta.generationId}`);
    items.forEach((raw, i) => {
        const url = raw.url;
        if (url)
            console.log(`Result URL ${i + 1}/${items.length}: ${url}`);
    });
    const outputDir = path.join(baseOutputDir, operation);
    const timestamp = new Date().toISOString();
    const pending = (from) => items.slice(from).map((raw, k) => {
        const item = raw;
        return { index: from + k + 1, objectType: item.object_type, url: item.url, assetId: item.asset_id, saved: false };
    });
    // Write the metadata first, with every item's URL, so a failed download
    // cannot lose the generation id or the URLs of the items not yet fetched.
    // It is rewritten with the saved paths once the downloads finish.
    const raw = (meta.rawResponse ?? {});
    const emptyResponse = items.length === 0
        ? {
            status: typeof raw.status === 'string' ? raw.status : undefined,
            responseKeys: typeof meta.rawResponse === 'object' && meta.rawResponse !== null ? Object.keys(meta.rawResponse) : [],
        }
        : {};
    const writeMetadata = (target, records) => saveMetadata(target, {
        operation,
        timestamp,
        generationId: meta.generationId,
        seed: meta.seed,
        generationKind: meta.generationKind,
        usageCostUsdMicros: meta.usageCostUsdMicros,
        parameters: meta.parameters,
        response: { itemCount: items.length, ...emptyResponse, items: records },
    });
    let claimed;
    try {
        await ensureDirectory(outputDir);
        claimed = await claimPath(path.join(outputDir, generateFilename(promptOrName, 'json')));
        await writeMetadata(claimed, pending(0));
    }
    catch (error) {
        // The empty placeholder claimPath made would otherwise be left behind.
        if (claimed)
            await discardFile(claimed, 'the unfinished metadata file');
        console.error(`✗ The result was generated (and billed); its generation id and URLs are printed above. ` +
            `Nothing could be written under ${outputDir}: ${toError(error).message}`);
        throw error;
    }
    const metadataPath = claimed;
    if (items.length === 0) {
        console.log(`✓ Saved metadata: ${metadataPath}`);
        throw new Error(`The API returned no results${meta.generationId ? ` for generation ${meta.generationId}` : ''}, ` +
            `for a request that may have been billed. Check your usage before retrying. Details are in ${metadataPath}`);
    }
    // One record per item handled so far: saved ones carry a `path`, skipped ones (no URL, unsafe, not an image) do not.
    const records = [];
    try {
        for (let i = 0; i < items.length; i++) {
            // GeneratedImage (sync responses) is a subset of GenerationDataItem's fields.
            const item = items[i];
            const label = `${i + 1}/${items.length}`;
            const index = items.length > 1 ? i + 1 : undefined;
            const kind = item.object_type;
            if (kind === 'video.generation' || kind === 'svg.generation') {
                const noun = kind === 'video.generation' ? 'video' : 'SVG';
                if (!item.url) {
                    console.log(`⚠ ${noun} ${label} has no URL (it may have failed safety checks)`);
                    records.push({ index: i + 1, objectType: kind, assetId: item.asset_id });
                    continue;
                }
                const filePath = await claimPath(path.join(outputDir, generateFilename(promptOrName, mediaExtension(item), 50, index)));
                try {
                    await downloadToFile(item.url, filePath);
                }
                catch (error) {
                    await discardClaimed(filePath);
                    throw error;
                }
                console.log(`✓ Saved ${noun} ${label}: ${filePath}`);
                records.push({
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
                records.push({ index: i + 1, objectType: kind, url: item.url });
                continue;
            }
            if (item.is_image_safe === false || !item.url) {
                console.log(`⚠ Image ${label} failed safety checks; no URL returned`);
                records.push({ index: i + 1, isImageSafe: false, resolution: item.resolution, seed: item.seed });
                continue;
            }
            const buffer = await fetchImage(item.url);
            const imagePath = await claimPath(path.join(outputDir, generateFilename(promptOrName, extensionFor(buffer), 50, index)));
            try {
                await saveImage(buffer, imagePath);
            }
            catch (error) {
                await discardClaimed(imagePath);
                throw error;
            }
            console.log(`✓ Saved image ${label}: ${imagePath}`);
            records.push({
                index: i + 1,
                path: imagePath,
                url: item.url,
                resolution: item.resolution,
                seed: item.seed,
                isImageSafe: item.is_image_safe,
                finalPrompt: item.prompt,
            });
        }
    }
    catch (error) {
        console.error(`✗ Download failed after ${records.filter((r) => typeof r.path === 'string').length}/${items.length} item(s) saved. ` +
            `Generation id: ${meta.generationId}. Result URLs are in ${metadataPath}`);
        // Make the metadata true for what is on disk: the items saved so far with
        // their paths, then the rest (the failed item and any after it) with their URLs.
        try {
            await writeMetadata(metadataPath, [...records, ...pending(records.length)]);
        }
        catch (metadataError) {
            console.error(`✗ Could not update ${metadataPath} with the saved files: ${toError(metadataError).message}. ` +
                'Its entries still read as unsaved; the files that were saved are listed above.');
        }
        throw error;
    }
    try {
        await writeMetadata(metadataPath, records);
    }
    catch (error) {
        // Every file is on disk; only the final rewrite failed. Say so, so the caller does not pay again.
        const files = records.map((entry) => entry.path).filter((p) => typeof p === 'string');
        throw new Error(`The result was generated and every file was saved${files.length ? ` (${files.join(', ')})` : ''}, ` +
            `but the final update of ${metadataPath} failed: ${toError(error).message}. ` +
            `${metadataPath} still holds the earlier record (generation id and result URLs, entries not marked saved). ` +
            'Do not retry: nothing was lost.', { cause: error });
    }
    console.log(`✓ Saved metadata: ${metadataPath}`);
}
//# sourceMappingURL=cli-v2.js.map