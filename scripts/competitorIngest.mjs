#!/usr/bin/env node
// scripts/competitorIngest.mjs — parse + upsert one competitor report file.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCompetitorReportFile } from '../lib/competitorParser.mjs';
import { upsertCompetitorDay, recordCompetitorIngestedFile } from '../lib/competitorDb.js';

export function ingestCompetitorFile(filePath) {
  const result = parseCompetitorReportFile(filePath);
  upsertCompetitorDay(result);
  recordCompetitorIngestedFile({ filename: path.basename(filePath), date: result.date, status: 'ok' });
  return { file: path.basename(filePath), date: result.date, brandCount: result.brands.length, itemCount: result.items.length };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Usage: node scripts/competitorIngest.mjs <path-to-report-file>');
    process.exit(1);
  }
  const result = ingestCompetitorFile(filePath);
  console.log(`[competitor-ingest] OK ${result.file} -> ${result.date} (${result.brandCount} brands, ${result.itemCount} items)`);
}
