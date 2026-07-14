#!/usr/bin/env node
// scripts/seed.mjs
//
// One-time historical backfill, run once when setting up the app on a new
// machine (data/seryn.db already ships pre-seeded, so most people won't need
// to run this at all — it's here for reproducibility / disaster recovery).
//
// Priority order:
//  1. The real historical report archive (all 94+ files, 2026-05-05 onward) —
//     if the folder the "seryn-brand-monitoring-daily" report-generation task
//     saves to is reachable, bulk-ingest every report file found there through
//     the same parser scripts/watch-ingest.mjs uses daily. This is the same
//     "94 files found, 94 new" first-run behavior watch-ingest.mjs already
//     has — seed.mjs just calls it explicitly with a friendlier one-time message.
//  2. Fallback demo data, for portability when that real archive isn't
//     reachable (e.g. handing this project to someone else): the design
//     prototype's frozen snapshot (61 pre-processed days) plus the 3 raw
//     sample files from the design handoff folder, re-parsed through the
//     same parser.
//
// Safe to re-run — everything is an upsert keyed by date.
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { upsertDay } from '../lib/db.js';
import { parseReportFile } from '../lib/parser.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const FILENAME_RE = /^Bao_cao_Seryn_Monitoring_.*\.(xlsx|csv)$/i;

function findRealArchiveDir() {
  const candidates = [
    process.env.SERYN_INCOMING_DIR,
    process.env.SERYN_HANDOFF_DIR,
    'D:\\Seryn Digital\\Seryn Digital',
  ].filter(Boolean);
  return candidates.find(dir => fs.existsSync(dir));
}

function seedFromRealArchive(dir) {
  const files = fs.readdirSync(dir)
    .filter(f => FILENAME_RE.test(f))
    .map(f => path.join(dir, f))
    .sort((a, b) => (a.endsWith('.csv') ? 0 : 1) - (b.endsWith('.csv') ? 0 : 1)); // .xlsx wins over same-day .csv
  console.log(`[seed] found real historical archive at ${dir} (${files.length} files) — bulk-ingesting.`);
  let ok = 0, failed = 0;
  for (const file of files) {
    try {
      const result = parseReportFile(file);
      upsertDay(result);
      ok++;
    } catch (err) {
      console.error(`[seed] FAILED parsing ${path.basename(file)}: ${err.message}`);
      failed++;
    }
  }
  console.log(`[seed] real archive backfill done: ${ok} ingested, ${failed} failed.`);
  return ok;
}

async function seedFromSnapshotFallback() {
  const snapshotPath = path.join(projectRoot, 'data', 'seryn-data.snapshot.js');
  if (!fs.existsSync(snapshotPath)) {
    console.log(`[seed] no snapshot file at ${snapshotPath} — skipping fallback historical backfill.`);
    return 0;
  }
  const mod = await import(pathToFileURL(snapshotPath).href);
  const { days, sourcesByDay } = mod;
  let count = 0;
  for (const rawDay of days) {
    const day = { riskNote: '', ...rawDay }; // the snapshot predates the riskNote field
    const sources = (sourcesByDay?.[day.date] || []).map(s => ({
      title: s.title, url: s.url, domain: s.domain || '', type: s.type, sentiment: s.sentiment, isNew: !!s.isNew,
    }));
    upsertDay({ day, sources, social: [], alerts: [], activityLog: [] });
    count++;
  }
  console.log(`[seed] fallback: backfilled ${count} days from the frozen design-prototype snapshot.`);
  return count;
}

function findSampleFilesFallback() {
  const candidateDirs = [
    path.join(projectRoot, '..', 'Seryn Digital APP dashboard', 'design_handoff_seryn_digital_dashboard', 'source_data_samples'),
    path.join(projectRoot, 'source_data_samples'),
  ];
  for (const dir of candidateDirs) {
    if (fs.existsSync(dir)) {
      return fs.readdirSync(dir)
        .filter(f => /\.(xlsx|csv)$/i.test(f) && !f.startsWith('~$'))
        .map(f => path.join(dir, f));
    }
  }
  return [];
}

function seedFromSampleFilesFallback() {
  const files = findSampleFilesFallback();
  if (files.length === 0) return 0;
  files.sort((a, b) => (a.endsWith('.csv') ? 1 : 0) - (b.endsWith('.csv') ? 1 : 0));
  let count = 0;
  for (const file of files) {
    try {
      const result = parseReportFile(file);
      upsertDay(result);
      count++;
    } catch (err) {
      console.error(`[seed] FAILED parsing ${file}: ${err.message}`);
    }
  }
  console.log(`[seed] fallback: re-ingested ${count} days from the design handoff's raw sample files.`);
  return count;
}

const realDir = findRealArchiveDir();
if (realDir) {
  seedFromRealArchive(realDir);
} else {
  console.log('[seed] real historical archive not found — using portable fallback demo data instead.');
  await seedFromSnapshotFallback();
  seedFromSampleFilesFallback();
}
console.log('[seed] done.');
