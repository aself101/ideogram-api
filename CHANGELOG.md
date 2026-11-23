# Changelog

All notable changes to this project are documented in this file. From 2.0.0 it is written by hand.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] - 2026-11-22

Brings the library up to Ideogram's current API (the v2 endpoints: Ideogram 4.x, auto, SVG, video and the v2 upscaler), replaces axios with Node's built-in `fetch`, and makes the paths where money may already have moved say so. 2.0 breaks 1.x callers in the ways listed under **Changed** and **Removed**; the README's "Migrating from 1.x" section has the before-and-after code.

Every endpoint except `generate-custom` (it needs a custom model this account does not have) was exercised live on 2026-11-22: dry runs priced on the v2 commands, and a full paid battery whose bill matched the calls it made.

### Added

- **Ideogram 4.x and auto image models:** `generateV4`, `generateV4Transparent`, `generateV4Custom`, `generateV45`, `generateV46` and `generateAuto` (CLI `generate-v4`, `generate-transparent`, `generate-custom`, `generate-v45`, `generate-v46`, `generate-auto`), with masks, source and reference images where the model takes them.
- **Precise edit:** `preciseEditV45` and `preciseEditV46` (CLI `precise-edit`, `precise-edit-v46`), including reference images and the 4.6 context window.
- **SVG:** `generateSvg` (CLI `generate-svg`).
- **Video:** MiniMax Hailuo 3 and Seedance 2.5, text-, image- and reference-to-video (`minimaxH3TextToVideo`, `minimaxH3ImageToVideo`, `minimaxH3ReferenceToVideo`, `seedance25TextToVideo`, `seedance25ImageToVideo`, `seedance25ReferenceToVideo`, and the matching CLI commands).
- **Asynchronous generations:** `getGeneration` and `waitForGeneration` (with an `onPoll` callback; resumable poll failures such as timeouts, 5xx, 408 and 425 are retried with backoff until the deadline), CLI `get-generation <id> [--wait]` and `--async` / `--wait`. `get-generation` also fetches a finished synchronous v2 result again, with freshly signed URLs.
- **Dry runs:** `dryRun: true` / `--dry-run` prices a v2 request instead of running it and returns a quote (`isPriceQuote`). If Ideogram returns a real result instead, the library throws `EDRYRUNIGNORED` with the result attached and the CLI saves it.
- **Billing-aware errors:** `IdeogramAPIError` carries `status`, `code`, `possiblyBilled`, `resumable`, `generationId`, `generationStatus`, `rejectReason`, `failureReason`, `body` and `result`. `classifyPollFailure` is the rule behind `resumable`; `BILLING_NOTE` is the closing sentence of every possibly-billed message.
- **Helpers:** `extractImageUrls`, `extractVideoUrls`, `extractSvgUrls`; `validateV2Params` and `V2_OPERATION_KEYS` in `ideogram-api/config`; CLI `list-v4-resolutions`.
- **CLI result handling:** the generation id and result URLs are printed before anything is written; the metadata file is written atomically before downloading; output files never overwrite each other. A failed download says whether the generation was billed, not to re-run it, and how to fetch the result again.

### Changed

- **Node.js 22 or later is required.** HTTP uses the built-in `fetch`; `buildFormData` returns a native `FormData` and names and types each file part from its bytes (1.x sent every file as `image.jpg`).
- **A request that gets no HTTP response throws `IdeogramAPIError` with `code`** (e.g. `ECONNRESET`), not an axios error.
- **`upscale()` uses `/v2/image/upscale/auto`,** because Ideogram retired the v1 endpoint (every request answered 400). It takes `upscaleFactor` (`x2` / `x4` / `x8`) and `seed`, returns `UpscaleResponse`, and throws on the v1 fields `prompt`, `resemblance`, `detail`, `magicPromptOption` and `numImages`. The CLI `upscale` command lost those flags and writes to `upscale-auto/` (was `upscale/`), with `items` / `itemCount` in its metadata (was `images` / `imageCount`).
- **Importing the library no longer loads `.env` files.** Only the CLI reads them, and only `IDEOGRAM_API_KEY`.
- **Logging:** the library logs at `warn` by default (was `info`), every level on stderr. The CLI's log lines also go to stderr, so stdout carries only results, prices, ids and paths. `setLogLevel` and the constructor's `logLevel` are case-insensitive and throw on anything but `error`, `warn`, `info` or `debug` (1.x accepted any string).
- **Option-list constants** in `ideogram-api/config` are readonly literal tuples (`as const`) rather than `string[]`.
- **v1 `numImages` outside 1..8 throws before any request,** in the library and on the v1 CLI commands (1.x sent an explicit 0 as one billed image). The strings `"1"`..`"8"` still work.
- **Timeouts and poll intervals** must be whole milliseconds from 1 to 2147483647; other values are rejected before anything is sent.
- **CLI exit codes and arguments:** a request that returns zero results exits 1 (was 0); `get-generation` exits 1 for a failed generation; excess arguments are rejected, so multi-word prompts must be quoted, and v1 `generate` refuses a list of single-word prompts unless `--allow-single-word-prompts` is passed. A multi-prompt `generate` validates every prompt before the first request.

### Removed

- The `axios` and `form-data` dependencies.
- The exported type `IdeogramApiOptions` (nothing accepted it); the constructor is `new IdeogramAPI(apiKey, baseUrl?, logLevel?)`.
- The CLI helpers `saveImage`, `generateFilename`, `ensureDirectory`, `saveMetadata`, `pause`, `createSpinner` and the `logger` re-export from `ideogram-api/utils` (`setLogLevel` remains).
- `ENDPOINTS.UPSCALE` (now `ENDPOINTS.UPSCALE_AUTO`) and the `'upscale'` entry in `OPERATION_CONSTRAINTS`.

### Fixed

- No POST is ever retried, and a failure after a request was sent is reported as possibly billed (`possiblyBilled`) instead of inviting a retry. Polling failures say whether polling again can work, and the CLI prints the matching resume command.
- Validation that costs nothing runs before anything billable is sent, including every prompt of a multi-prompt `generate` and non-image input files.

### Security

- API calls refuse redirects, so the `Api-Key` header never reaches another host. Downloads follow at most 5 redirects and re-run the SSRF check on every hop.
- The SSRF guard checks every address a hostname resolves to and blocks more ranges (IPv4-mapped, NAT64 and 6to4 addresses are checked by their embedded IPv4). DNS rebinding between the check and the connection is not prevented; the README says so.
- Server-supplied text is stripped of escape sequences, control characters and invisible formatting characters before it reaches messages, logs or the terminal; raw values stay on the error object. A printed `get-generation` command only includes ids of URL-safe characters.

# [1.1.0](https://github.com/aself101/ideogram-api/compare/v1.0.3...v1.1.0) (2025-12-03)


### Features

* **typescript:** migrate codebase to TypeScript with full type definitions ([cceb808](https://github.com/aself101/ideogram-api/commit/cceb80821189c4edad07e46285209cc22faa81e9))

## [1.0.3](https://github.com/aself101/ideogram-api/compare/v1.0.2...v1.0.3) (2025-11-23)


### Bug Fixes

* **api:** use 'image_file' for upscale and describe endpoints ([0ea4646](https://github.com/aself101/ideogram-api/commit/0ea4646f151595446af586dde77a432572d84541))

## [1.0.2](https://github.com/aself101/ideogram-api/compare/v1.0.1...v1.0.2) (2025-11-23)


### Bug Fixes

* **api:** use correct 'image' field name for multipart form data ([1897b42](https://github.com/aself101/ideogram-api/commit/1897b4269e808e6e8385da5b385a355bb0ef17e5))

## [1.0.1](https://github.com/aself101/ideogram-api/compare/v1.0.0...v1.0.1) (2025-11-21)


### Bug Fixes

* **cli:** use dynamic version from package.json to prevent drift ([129272c](https://github.com/aself101/ideogram-api/commit/129272c62c067bbc051135efdb392e261d9458e4))

# 1.0.0 (2025-11-20)


### Bug Fixes

* **security:** initial release with DNS rebinding prevention ([853611a](https://github.com/aself101/ideogram-api/commit/853611afaf7c45615ac569c94531a45f5bdcfbbd))

## [1.0.0] - 2025-11-19

### Added

#### Core API Features
- **IdeogramAPI wrapper class** with support for all 7 Ideogram operations:
  - `generate()` - Ideogram 3.0 text-to-image generation
  - `edit()` - Image editing with masks
  - `remix()` - Image remixing with prompts
  - `reframe()` - Reframe square images to different resolutions
  - `replaceBackground()` - Replace image backgrounds
  - `upscale()` - Image upscaling with optional prompts
  - `describe()` - Get AI-generated descriptions of images
- **Helper functions**: `extractImages()`, `extractDescriptions()`
- **Configuration management** with multi-source API key priority:
  - CLI flag (highest priority)
  - `IDEOGRAM_API_KEY` environment variable
  - Local `.env` file
  - Global `~/.ideogram/.env` file (lowest priority)

#### CLI Features
- **Comprehensive CLI** built with Commander.js supporting all 7 operations
- **Batch processing** support for generate command (multiple prompts)
- **Progress indicators** with spinners for all operations
- **Detailed examples** via `--examples` flag
- **Flexible output** with `--output-dir` option
- **Debug logging** with `--log-level` option (debug, info, warn, error)

#### Security Features
- **HTTPS enforcement**: All API base URLs must use HTTPS protocol
- **SSRF protection** with comprehensive URL validation:
  - Blocks localhost (`127.0.0.1`, `::1`, `localhost`)
  - Blocks private IP ranges (10.x.x.x, 192.168.x.x, 172.16-31.x.x, 169.254.x.x)
  - Blocks cloud metadata endpoints (`169.254.169.254`, `metadata.google.internal`)
  - **IPv4-mapped IPv6 bypass prevention**: Detects and blocks `[::ffff:127.0.0.1]`, `[::ffff:10.0.0.1]`, etc.
  - IPv6 loopback, link-local, and unique local address blocking
- **API key redaction**: API keys shown only as `xxx...last4` in all logs
- **Error sanitization**: Generic error messages in production mode (`NODE_ENV=production`)
- **DoS prevention**:
  - Request timeout: 30 seconds for API calls
  - Download timeout: 60 seconds for image downloads
  - File size limit: 50MB maximum
  - Redirect limit: Maximum 5 redirects
- **FormData size validation**: Pre-flight validation with 50MB limit
- **Content-Type validation**: Validates API responses are JSON
- **Image file validation**: Magic byte checking for PNG, JPEG, WebP, GIF
- **File extension sanitization**: Prevents path traversal via file extensions

#### Data Management
- **Automatic file organization**: Images saved to `datasets/{operation}/`
- **Timestamped filenames**: Format `YYYYMMDD_HHMMSS_sanitized-prompt.png`
- **Metadata preservation**: JSON files with complete request/response details
- **Directory auto-creation**: Ensures output directories exist

#### Testing & Quality
- **Comprehensive test suite**: 193 tests across 3 test files
  - 76 configuration tests
  - 69 API class tests
  - 48 utility function tests
- **Security testing**: Extensive SSRF and validation tests
- **100% core functionality coverage**: All API methods and utilities tested
- **Vitest framework**: Fast, modern testing with watch mode and UI

#### Documentation
- **README.md**: Comprehensive project documentation
- **LICENSE**: MIT License
- **CLAUDE.md**: AI agent guidance and architecture documentation
- **JSDoc comments**: Inline documentation for all functions
- **Usage examples**: 20+ CLI examples in `--examples` output

### Changed

#### Code Quality Improvements
- **Refactored CLI execute functions**: Extracted common orchestration logic into `executeOperation()` generic function
  - Reduced code duplication by ~120 lines
  - Unified error handling, validation, and spinner management
  - Improved maintainability across 6 execute functions
- **Removed unused imports**:
  - `utils.js`: Removed `createReadStream`, `statSync`, `existsSync`
  - `api.js`: Removed `downloadImageAsBuffer`

### Security

#### Critical Security Fixes (Priority 1)
- **Fixed SSRF vulnerability** in CLI `downloadImage()` function (cli.js:200-216)
  - Added `validateImageUrl()` call before downloading images
  - Added `maxRedirects: 5` to prevent redirect loops
- **Added FormData size validation** in `api.js` `_makeRequest()` (lines 101-108)
  - Pre-flight validation using `formData.getLengthSync()`
  - 50MB limit to prevent DoS attacks
- **Added Content-Type validation** in `api.js` `_makeRequest()` (lines 121-126)
  - Validates API responses contain `application/json`
  - Prevents processing of malicious non-JSON responses
- **Enhanced file extension sanitization** in `generateFilename()` (utils.js:337-343)
  - Removes leading dots and path separators
  - Limits extension length to 10 characters
  - Falls back to 'png' for invalid extensions
  - Prevents path traversal attacks

### Fixed
- **Parameter validation**: All operations validate parameters before API calls to save credits
- **Error messages**: Consistent error messages across all validation functions
- **Edge cases**: Proper handling of null/undefined values in validation functions

---

## Version History

- **[1.0.0]** - 2025-01-19: Initial release with full Ideogram API support

---

## Upgrade Notes

### Security Considerations
When upgrading to 1.0.0, note the following security enhancements:

1. **HTTPS Only**: API base URLs must use HTTPS. HTTP URLs will throw an error.
2. **SSRF Protection**: Image URLs are validated. Private IPs and localhost are blocked.
3. **Production Mode**: Set `NODE_ENV=production` to enable error sanitization.

### Breaking Changes
None - this is the initial release.

---

## Contributing

When contributing to this project:
1. Add security features proactively
2. Write tests for all new features
3. Update this CHANGELOG with your changes
4. Follow the existing code patterns and documentation style

---

## References

- [Ideogram API Documentation](https://ideogram.ai/api)
- [Keep a Changelog](https://keepachangelog.com/)
- [Semantic Versioning](https://semver.org/)
