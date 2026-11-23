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
 *   (any v2 command) --dry-run   price the request without running it (the library checks that a price quote came back)
 */
import { Command } from 'commander';
/**
 * Main CLI program.
 * Builds a fresh commander program; nothing runs until it is parsed.
 */
export declare function createProgram(): Command;
/**
 * Entry point for the bin: handles --examples and the no-argument help before
 * handing argv to commander.
 */
export declare function main(argv?: string[]): Promise<void>;
//# sourceMappingURL=program.d.ts.map