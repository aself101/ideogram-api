/**
 * Module logger shared by utils.ts, cli-io.ts and the CLI. Internal: it is not
 * in package.json `exports` and utils.ts no longer re-exports it (2.0). Use
 * `setLogLevel` from `ideogram-api/utils` to change its level.
 */
import winston from 'winston';
export declare const logger: winston.Logger;
//# sourceMappingURL=logger.d.ts.map