#!/usr/bin/env node
// scripts/import-json.mjs
//
// Rebuilds data/seryn.db from the git-tracked JSON snapshot
// (data/export/days.json + sources.json + latest.json). This is what lets a
// fresh deploy (e.g. Render, which clones from GitHub and never sees the
// git-ignored .db file itself) come up with real data instead of an empty
// database — it's the mirror image of scripts/export-json.mjs.
//
// Historical days get their KPI numbers + Top10 source list (sources.json
// has full per-day source lists). Social/alerts/activity-log detail is only
// exported for the single most-recent day (data/export/latest.json), because
// the dashboard UI only ever shows those three panels for the latest day
// regardless of the day/week/month/year picker (see README) — so that's all
// that's needed for the app to render correctly.
//
// Safe to run every container start: cheap, and everything is an upsert.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { upsertDay } from '../lib/db.js';
import { upsertCompetitorDay } from '../lib/competitorDb.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const exportDir = path.join(projectRoot, 'data', 'export');

function readJson(name) {
  const p = path.join(exportDir, name);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

const days = readJson('days.json');
const sourcesByDay = readJson('sources.json') || {};
const latest = readJson('latest.json');

if (!days) {
  console.log('[import-json] no data/export/days.json found — nothing to import (empty DB will be used).');
  process.exit(0);
}

let count = 0;
for (const day of days) {
  const sources = (sourcesByDay[day.date] || []).map(s => ({
    title: s.title || '', url: s.url || '', domain: s.domain || '',
    type: s.type || '', sentiment: s.sentiment || 'unknown', isNew: !!s.isNew,
  }));
  upsertDay({ day, sources, social: [], alerts: [], activityLog: [] });
  count++;
}
console.log(`[import-json] imported ${count} days from data/export/ (KPIs + Top10 sources).`);

if (latest && latest.date) {
  const latestDay = days.find(d => d.date === latest.date);
  if (latestDay) {
    upsertDay({
      day: latestDay,
      sources: latest.topSources || [],
      social: latest.social || [],
      alerts: (latest.alerts || []).map(a => ({ ...a, alertDate: a.date || '' })),
      activityLog: latest.activityLog || [],
    });
    console.log(`[import-json] re-imported ${latest.date} with full detail (social/alerts/activity log).`);
  }
}
// Competitor ("Đối Thủ") data
const competitorBrandsByDate = readJson('competitor-brands.json') || {};
const competitorItemsByDate = readJson('competitor-items.json') || {};
const competitorDates = Object.keys(competitorBrandsByDate);
for (const date of competitorDates) {
  upsertCompetitorDay({
    date,
    brands: competitorBrandsByDate[date] || [],
    items: competitorItemsByDate[date] || [],
  });
}
console.log(`[import-json] imported ${competitorDates.length} competitor report dates.`);

console.log('[import-json] done.');
