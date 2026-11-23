/**
 * v2 CLI execution: the code behind the Ideogram 4.x / auto / SVG / video
 * commands, split out of cli.ts so tests can import it. Importing this module
 * has no side effects (cli.ts owns `program.parse` and `process.exit` at load).
 */
import type { V2ColorPalette, AssetIdentifier, V2OperationKey } from './types/index.js';
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
    asset?: string[];
    /** commander's --no-gradient: true unless the flag is given. */
    gradient?: boolean;
    private?: boolean;
    targetCollection?: string;
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
 * message ("fetch failed", "Error") and the real reason on `cause`, so append
 * the cause's message when the error's own text does not already carry it, and
 * the error code (its own, else the cause's) when there is one.
 */
export declare function describeError(err: Error & {
    code?: string;
}): string;
/**
 * The command that retrieves a generation. IDs are URL-safe base64, so about
 * 1 in 64 starts with '-', which commander would read as an option; such an
 * ID goes after `--` (found live 2026-11-22: -uaWvHfERk65rkfjaocs9w).
 */
export declare function getGenerationCommand(generationId: string): string;
/**
 * Whether the CLI adds the billing line after an error. Only for an error that
 * may have been billed (`possiblyBilled`) and whose message does not already end
 * with BILLING_NOTE. Not for a non-resumable polling error (one carrying a
 * generationId) with status 400, 404, 410 or 422: the id was never seen to be
 * submitted by this call, so the line would claim a charge nothing shows.
 */
export declare function shouldAppendBillingNote(err: {
    message?: string;
    status?: unknown;
    resumable?: unknown;
    possiblyBilled?: unknown;
    generationId?: unknown;
}): boolean;
/**
 * Print a failed command's error, and for a polling failure that carries a
 * generation id the hint to pick it up: with the key hint for a 401/403 (chosen
 * from the status, whatever `resumable` says), the plain resume command for a
 * resumable failure. Otherwise the billing note when shouldAppendBillingNote
 * says so. A generation the API reported as failed, or a 404, has nothing to resume.
 */
export declare function reportCommandError(err: Error & {
    generationId?: unknown;
    status?: unknown;
    resumable?: unknown;
    possiblyBilled?: unknown;
}): void;
/**
 * Fetch image bytes from a URL with SSRF protection on the URL and every
 * redirect. 200MB cap: 8k transparent PNGs can be large.
 */
export declare function fetchImage(url: string): Promise<Buffer>;
/**
 * Parse an optional integer CLI value, rejecting non-integers rather than sending NaN.
 * `min` and `max`, when given, also reject integers outside them.
 */
export declare function parseIntOption(name: string, value: string | undefined, min?: number, max?: number): number | undefined;
/** Parse --color-palette: a preset name, or a JSON `{ name }` / `{ members }` object. */
export declare function parseColorPalette(value: string | undefined): V2ColorPalette | undefined;
/** Parse --asset values of the form TYPE:ID or TYPE:ID:COLLECTION. */
export declare function parseAssets(values: string[] | undefined): AssetIdentifier[] | undefined;
/**
 * Execute a v2 image command: validate, pre-flight local images, call the
 * API, then print a quote, save the images, or report / await an async generation.
 */
export declare function executeV2(operation: V2OperationKey, options: V2CliOptions, globalOptions: GlobalOptions): Promise<void>;
/**
 * Execute an always-asynchronous v2 command (SVG, video): validate, submit,
 * then print the quote or the generation_id, and with --wait poll and download.
 */
export declare function executeAsyncV2(operation: V2OperationKey, options: V2CliOptions, globalOptions: GlobalOptions): Promise<void>;
/**
 * Execute get-generation: print status; download results when completed.
 */
export declare function executeGetGeneration(generationId: string, options: {
    wait?: boolean;
    pollInterval?: string;
    waitTimeout?: string;
}, globalOptions: GlobalOptions): Promise<void>;
//# sourceMappingURL=cli-v2.d.ts.map