#!/usr/bin/env node
// scripts/watch-ingest.mjs
//
// The daily automated job (scheduled for 11:00 Asia/Ho_Chi_Minh — see README).
// Scans the folder where the daily report-generation job saves its output for
// files that haven't been ingested yet, parses each one, and upserts it into
// the database. Never double-ingests a file (tracked in the `ingested_files`
// table) and never crashes the whole run because one file failed to parse —
// it logs the failure and keeps going, per the handoff's "handle a missing/late
// file gracefully" requirement.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isFileIngested, recordIngestedFile } from '../lib/db.js';
import { ingestFile } from './ingest.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

// Priority order for where the day's report file might be:
//  1. SERYN_INCOMING_DIR env override (set this if the report-generation job's
//     output location ever changes).
//  2. The real folder the "seryn-brand-monitoring-daily" report-generation
//     scheduled task saves to (per its own instructions).
//  3. reports/incoming/ inside this project, as a manual-drop fallback.
const CANDIDATE_DIRS = [
  process.env.SERYN_INCOMING_DIR,
  'D:\\Seryn Digital\\Seryn Digital',
  path.join(projectRoot, 'reports', 'incoming'),
].filter(Boolean);

const FILENAME_RE = /^Bao_cao_Seryn_Monitoring_.*\.(xlsx|csv)$/i;

function resolveIncomingDir() {
  for (const dir of CANDIDATE_DIRS) {
    if (fs.existsSync(dir)) return dir;
  }
  // none exist yet — fall back to the local project folder and create it
  const fallback = CANDIDATE_DIRS[CANDIDATE_DIRS.length - 1];
  fs.mkdirSync(fallback, { recursive: true });
  return fallback;
}

function listCandidateFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => FILENAME_RE.test(f)) // only real Seryn Clinic reports — never other reports that may share the folder
    .map(f => path.join(dir, f))
    // .xlsx is authoritative over a same-day .csv (per handoff README) — process csv first
    // so that if both exist and are new, the xlsx upsert lands last and wins.
    .sort((a, b) => (a.endsWith('.csv') ? 0 : 1) - (b.endsWith('.csv') ? 0 : 1));
}

function main() {
  const incomingDir = resolveIncomingDir();
  const files = listCandidateFiles(incomingDir);
  const pending = files.filter(f => !isFileIngested(path.basename(f)));

  console.log(`[watch-ingest] ${new Date().toISOString()} — scanning ${incomingDir}`);
  console.log(`[watch-ingest] ${files.length} report file(s) found, ${pending.length} new.`);

  if (pending.length === 0) {
    console.log('[watch-ingest] nothing new to ingest.');
    return;
  }

  let ok = 0, failed = 0;
  for (const file of pending) {
    try {
      const result = ingestFile(file);
      console.log(`[watch-ingest] OK  ${result.file} -> ${result.day.date} (risk=${result.day.riskLevel}, total=${result.day.total})`);
      ok++;
    } catch (err) {
      console.error(`[watch-ingest] FAIL ${path.basename(file)}: ${err.message}`);
      recordIngestedFile({ filename: path.basename(file), date: null, status: 'error', note: err.message });
      failed++;
    }
  }
  console.log(`[watch-ingest] done. ${ok} ingested, ${failed} failed.`);
}

main();
