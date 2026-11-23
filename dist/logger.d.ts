/**
 * Module logger shared by utils.ts, cli-io.ts and the CLI. Internal: it is not
 * in package.json `exports` and utils.ts no longer re-exports it (2.0). Use
 * `setLogLevel` from `ideogram-api/utils` to change its level.
 *
 * Library default is 'warn' (the CLI sets it from --log-level, default 'info'),
 * and every level goes to stderr so a consumer's stdout stays clean.
 */
import winston from 'winston';
/** Every winston npm level, so the Console transport writes all of them to stderr. */
export declare const ALL_LOG_LEVELS: string[];
/** The levels a caller may ask for. */
export declare const LOG_LEVELS: readonly ["error", "warn", "info", "debug"];
/** One of LOG_LEVELS. */
export type LogLevel = (typeof LOG_LEVELS)[number];
/**
 * Trim and lowercase a requested log level and check it is one of LOG_LEVELS.
 * @throws Error naming the bad value and the valid ones
 */
export declare function normalizeLogLevel(level: string, name?: string): LogLevel;
export declare const logger: winston.Logger;
//# sourceMappingURL=logger.d.ts.map