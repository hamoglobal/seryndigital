#!/usr/bin/env node
// scripts/git-sync.mjs
//
// CLI entry point: `node scripts/git-sync.mjs` commits + pushes
// data/export/*.json to GitHub. Called automatically at the end of the
// 11:00 daily ingestion job (watch-ingest.mjs). The actual implementation
// lives in lib/gitSync.js (kept free of any top-level self-invocation so it
// can also be safely imported from Next.js server routes — see that file's
// header comment for why this split exists).
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { syncToGitHub } from '../lib/gitSync.js';

export { syncToGitHub };

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  syncToGitHub();
}
