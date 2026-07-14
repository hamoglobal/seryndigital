#!/usr/bin/env node
// scripts/ingest.mjs <path-to-report-file>
//
// Parse ONE daily report file (.xlsx or .csv) and upsert it into the database.
// Used directly for manual/ad-hoc ingestion, and internally by watch-ingest.mjs
// for the daily automated job.
import path from 'node:path';
import { upsertDay, recordIngestedFile } from '../lib/db.js';
import { parseReportFile } from '../lib/parser.mjs';

export function ingestFile(filePath) {
  const result = parseReportFile(filePath);
  upsertDay(result);
  recordIngestedFile({
    filename: path.basename(filePath),
    date: result.day.date,
    status: 'ok',
    note: `total=${result.day.total} sources=${result.sources.length} social=${result.social.length} alerts=${result.alerts.length}`,
  });
  return result;
}

// Only run the CLI body when invoked directly (`node scripts/ingest.mjs file`),
// not when imported by watch-ingest.mjs.
if (import.meta.url === `file://${process.argv[1]}`) {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Usage: node scripts/ingest.mjs <path-to-report-file.xlsx|.csv>');
    process.exit(1);
  }
  try {
    const result = ingestFile(path.resolve(filePath));
    console.log(`[ingest] OK ${result.file} -> day ${result.day.date}`);
    console.log(`  total=${result.day.total} positive=${result.day.positive} neutral=${result.day.neutral} negative=${result.day.negative} newSources=${result.day.newSources}`);
    console.log(`  risk=${result.day.riskLevel} (${result.day.riskRaw})`);
    console.log(`  sources=${result.sources.length} social=${result.social.length} alerts=${result.alerts.length} activityLog=${result.activityLog.length}`);
  } catch (err) {
    console.error(`[ingest] FAILED: ${err.message}`);
    try {
      recordIngestedFile({ filename: path.basename(filePath), date: null, status: 'error', note: err.message });
    } catch { /* best effort */ }
    process.exit(1);
  }
}
