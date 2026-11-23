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
export declare const logger: winston.Logger;
//# sourceMappingURL=logger.d.ts.map