#!/usr/bin/env node
// scripts/competitorWatch.mjs
//
// Daily scan for new competitor-monitoring reports ("Đối Thủ" page), mirrors
// scripts/watch-ingest.mjs's design. Scans the "Digital Doi Thu" folder for
// BaoCao_TheoDoi_ThamMy_*.xlsx files not yet ingested, parses + upserts each.
// Never crashes the whole run on one bad file. Exported as a function so
// watch-ingest.mjs can call it as one combined daily job; also runnable
// standalone.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isCompetitorFileIngested, recordCompetitorIngestedFile } from '../lib/competitorDb.js';
import { ingestCompetitorFile } from './competitorIngest.mjs';

const FILENAME_RE = /^BaoCao_TheoDoi_ThamMy_.*\.xlsx$/i;

const CANDIDATE_DIRS = [
  process.env.COMPETITOR_INCOMING_DIR,
  'D:\\Seryn Digital\\Digital Doi Thu\\Digital Doi Thu',
  'D:\\Seryn Digital\\Digital Doi Thu',
].filter(Boolean);

function resolveIncomingDir() {
  return CANDIDATE_DIRS.find(dir => fs.existsSync(dir)) || null;
}

export function runCompetitorWatch() {
  const dir = resolveIncomingDir();
  if (!dir) {
    console.log('[competitor-watch] "Digital Doi Thu" folder not reachable this run — skipping.');
    return { ok: 0, failed: 0, skipped: true };
  }

  const files = fs.readdirSync(dir)
    .filter(f => FILENAME_RE.test(f))
    .map(f => path.join(dir, f));
  const pending = files.filter(f => !isCompetitorFileIngested(path.basename(f)));

  console.log(`[competitor-watch] ${new Date().toISOString()} — scanning ${dir}`);
  console.log(`[competitor-watch] ${files.length} report file(s) found, ${pending.length} new.`);

  let ok = 0, failed = 0;
  for (const file of pending) {
    try {
      const result = ingestCompetitorFile(file);
      console.log(`[competitor-watch] OK  ${result.file} -> ${result.date} (${result.brandCount} brands, ${result.itemCount} items)`);
      ok++;
    } catch (err) {
      console.error(`[competitor-watch] FAIL ${path.basename(file)}: ${err.message}`);
      recordCompetitorIngestedFile({ filename: path.basename(file), date: null, status: 'error', note: err.message });
      failed++;
    }
  }
  console.log(`[competitor-watch] done. ${ok} ingested, ${failed} failed.`);
  return { ok, failed, skipped: false };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) runCompetitorWatch();
