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
export const ALL_LOG_LEVELS = ['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly'];
/** The levels a caller may ask for. */
export const LOG_LEVELS = ['error', 'warn', 'info', 'debug'];
function isLogLevel(value) {
    return LOG_LEVELS.includes(value);
}
/**
 * Trim and lowercase a requested log level and check it is one of LOG_LEVELS.
 * @throws Error naming the bad value and the valid ones
 */
export function normalizeLogLevel(level, name = 'log level') {
    const normalized = typeof level === 'string' ? level.trim().toLowerCase() : level;
    if (!isLogLevel(normalized)) {
        throw new Error(`Invalid ${name} '${String(level)}'. Use one of: ${LOG_LEVELS.join(', ')}`);
    }
    return normalized;
}
export const logger = winston.createLogger({
    level: 'warn',
    format: winston.format.combine(winston.format.timestamp(), winston.format.printf(({ timestamp, level, message }) => {
        return `${timestamp} - ${level.toUpperCase()} - ${message}`;
    })),
    transports: [new winston.transports.Console({ stderrLevels: ALL_LOG_LEVELS })],
});
//# sourceMappingURL=logger.js.map