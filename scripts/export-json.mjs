#!/usr/bin/env node
// scripts/export-json.mjs
//
// Dumps the SQLite database into git-friendly JSON snapshots under
// data/export/. Run after every ingestion so the GitHub repo always has an
// up-to-date, human-readable copy of the data (the .db file itself stays out
// of git — binary diffs are useless; JSON is reviewable in a PR/commit view).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAllDays, getSourcesByDay, getLatestDetail } from '../lib/db.js';
import { getCompetitorDates, getCompetitorBrandsForDate, getCompetitorItems } from '../lib/competitorDb.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const exportDir = path.join(projectRoot, 'data', 'export');

fs.mkdirSync(exportDir, { recursive: true });

const days = getAllDays();
const sourcesByDay = getSourcesByDay();
const latest = getLatestDetail();

fs.writeFileSync(path.join(exportDir, 'days.json'), JSON.stringify(days, null, 2) + '\n');
fs.writeFileSync(path.join(exportDir, 'sources.json'), JSON.stringify(sourcesByDay, null, 2) + '\n');
fs.writeFileSync(path.join(exportDir, 'latest.json'), JSON.stringify(latest, null, 2) + '\n');

console.log(`[export-json] wrote ${days.length} days, ${Object.keys(sourcesByDay).length} source-days, latest=${latest?.date || 'none'} -> data/export/`);

// Competitor ("Đối Thủ") data — same idea, one JSON per date already isn't
// practical (57+ report dates), so dump as date-keyed objects instead.
const competitorDates = getCompetitorDates();
const competitorBrandsByDate = {};
const competitorItemsByDate = {};
for (const date of competitorDates) {
  competitorBrandsByDate[date] = getCompetitorBrandsForDate(date).brands;
  competitorItemsByDate[date] = getCompetitorItems({ date });
}
fs.writeFileSync(path.join(exportDir, 'competitor-brands.json'), JSON.stringify(competitorBrandsByDate, null, 2) + '\n');
fs.writeFileSync(path.join(exportDir, 'competitor-items.json'), JSON.stringify(competitorItemsByDate, null, 2) + '\n');

console.log(`[export-json] wrote ${competitorDates.length} competitor report dates -> data/export/competitor-*.json`);
