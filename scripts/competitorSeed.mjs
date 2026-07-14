#!/usr/bin/env node
// scripts/competitorSeed.mjs
//
// One-time historical backfill for the "Đối Thủ" (competitor) page — bulk-
// ingests every BaoCao_TheoDoi_ThamMy_*.xlsx report found in the "Digital Doi
// Thu" folder (a separate, pre-existing scheduled task's output; this app
// only reads it). Safe to re-run — everything is an upsert keyed by date.
import fs from 'node:fs';
import { ingestCompetitorFile } from './competitorIngest.mjs';

const FILENAME_RE = /^BaoCao_TheoDoi_ThamMy_.*\.xlsx$/i;

function findArchiveDir() {
  // The real folder on disk is nested one level deeper than its own name
  // (D:\Seryn Digital\Digital Doi Thu\Digital Doi Thu\*.xlsx) — the same
  // quirk as the main Seryn report folder (Seryn Digital\Seryn Digital).
  // Try the deeper path first, fall back to the shallow one in case that
  // ever changes.
  const candidates = [
    process.env.COMPETITOR_INCOMING_DIR,
    'D:\\Seryn Digital\\Digital Doi Thu\\Digital Doi Thu',
    'D:\\Seryn Digital\\Digital Doi Thu',
  ].filter(Boolean);
  return candidates.find(dir => fs.existsSync(dir));
}

const dir = findArchiveDir();
if (!dir) {
  console.log('[competitor-seed] "Digital Doi Thu" folder not reachable — skipping (no competitor data seeded).');
  process.exit(0);
}

const files = fs.readdirSync(dir)
  .filter(f => FILENAME_RE.test(f))
  .map(f => `${dir}/${f}`)
  .sort();

console.log(`[competitor-seed] found ${files.length} report file(s) in ${dir} — bulk-ingesting.`);
let ok = 0, failed = 0;
for (const file of files) {
  try {
    const r = ingestCompetitorFile(file);
    ok++;
  } catch (err) {
    console.error(`[competitor-seed] FAILED ${file}: ${err.message}`);
    failed++;
  }
}
console.log(`[competitor-seed] done: ${ok} ingested, ${failed} failed.`);
