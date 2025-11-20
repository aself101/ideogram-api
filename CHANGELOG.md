# 1.0.0 (2025-11-20)


### Bug Fixes

* **security:** initial release with DNS rebinding prevention ([853611a](https://github.com/aself101/ideogram-api/commit/853611afaf7c45615ac569c94531a45f5bdcfbbd))

# Changelog

All notable changes to the Ideogram API project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
