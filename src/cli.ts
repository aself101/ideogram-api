#!/usr/bin/env node

/**
 * Ideogram API CLI: bin entry. The commands live in program.ts so they can be
 * driven in-process by tests; run `ideogram --examples` for usage.
 */

import { main } from './program.js';

await main();
