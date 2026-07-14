// lib/db.js
// SQLite data layer for the Seryn Digital dashboard, built on Node's built-in
// `node:sqlite` module (available Node >=22.5, no native/npm build step needed —
// deliberately chosen over better-sqlite3 so `npm install` never requires a
// network-fetched native binary or a C++ toolchain on the deploy machine).
//
// One row per day in `days`; per-source rows in `sources` (Top10 Google list),
// `social` (Mang Xa Hoi list), `alerts` (Canh Bao list), `activity_log` (Nhat Ky list).
// `ingested_files` tracks which raw report files have already been processed so the
// daily watch job never double-ingests a file.
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';

const DB_PATH = process.env.SERYN_DB_PATH || path.join(process.cwd(), 'data', 'seryn.db');

let _db = null;

export function getDb() {
  if (_db) return _db;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS days (
      date TEXT PRIMARY KEY,
      total INTEGER NOT NULL DEFAULT 0,
      positive INTEGER NOT NULL DEFAULT 0,
      neutral INTEGER NOT NULL DEFAULT 0,
      negative INTEGER NOT NULL DEFAULT 0,
      newSources INTEGER NOT NULL DEFAULT 0,
      riskRaw TEXT NOT NULL DEFAULT '',
      riskLevel TEXT NOT NULL DEFAULT 'green',
      riskNote TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      url TEXT NOT NULL DEFAULT '',
      domain TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL DEFAULT '',
      sentiment TEXT NOT NULL DEFAULT 'unknown',
      isNew INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_sources_date ON sources(date);

    CREATE TABLE IF NOT EXISTS social (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      platform TEXT NOT NULL DEFAULT '',
      account TEXT NOT NULL DEFAULT '',
      url TEXT NOT NULL DEFAULT '',
      accountType TEXT NOT NULL DEFAULT '',
      sentiment TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_social_date ON social(date);

    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      level TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT '',
      alertDate TEXT NOT NULL DEFAULT '',
      summary TEXT NOT NULL DEFAULT '',
      action TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_alerts_date ON alerts(date);

    CREATE TABLE IF NOT EXISTS activity_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      time TEXT NOT NULL DEFAULT '',
      step TEXT NOT NULL DEFAULT '',
      result TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_activity_log_date ON activity_log(date);

    CREATE TABLE IF NOT EXISTS ingested_files (
      filename TEXT PRIMARY KEY,
      date TEXT,
      ingestedAt TEXT NOT NULL,
      status TEXT NOT NULL,
      note TEXT
    );
  `);
  _db = db;
  return db;
}

/** Upsert one full day of data (day KPIs + its detail rows) in a single transaction. */
export function upsertDay(dayRecord) {
  const db = getDb();
  const { day, sources = [], social = [], alerts = [], activityLog = [] } = dayRecord;

  db.exec('BEGIN');
  try {
    db.prepare(`
      INSERT INTO days (date, total, positive, neutral, negative, newSources, riskRaw, riskLevel, riskNote)
      VALUES (:date, :total, :positive, :neutral, :negative, :newSources, :riskRaw, :riskLevel, :riskNote)
      ON CONFLICT(date) DO UPDATE SET
        total=excluded.total, positive=excluded.positive, neutral=excluded.neutral,
        negative=excluded.negative, newSources=excluded.newSources, riskRaw=excluded.riskRaw,
        riskLevel=excluded.riskLevel, riskNote=excluded.riskNote
    `).run(day);

    for (const table of ['sources', 'social', 'alerts', 'activity_log']) {
      db.prepare(`DELETE FROM ${table} WHERE date = ?`).run(day.date);
    }

    const insSource = db.prepare(`
      INSERT INTO sources (date, title, url, domain, type, sentiment, isNew)
      VALUES (:date, :title, :url, :domain, :type, :sentiment, :isNew)
    `);
    for (const s of sources) insSource.run({ ...s, date: day.date, isNew: s.isNew ? 1 : 0 });

    const insSocial = db.prepare(`
      INSERT INTO social (date, platform, account, url, accountType, sentiment, note)
      VALUES (:date, :platform, :account, :url, :accountType, :sentiment, :note)
    `);
    for (const s of social) insSocial.run({ ...s, date: day.date });

    const insAlert = db.prepare(`
      INSERT INTO alerts (date, level, type, source, alertDate, summary, action)
      VALUES (:date, :level, :type, :source, :alertDate, :summary, :action)
    `);
    for (const a of alerts) insAlert.run({ ...a, date: day.date });

    const insLog = db.prepare(`
      INSERT INTO activity_log (date, time, step, result, note)
      VALUES (:date, :time, :step, :result, :note)
    `);
    for (const l of activityLog) insLog.run({ ...l, date: day.date });

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function getAllDays() {
  const db = getDb();
  return db.prepare(`SELECT * FROM days ORDER BY date ASC`).all();
}

export function getSourcesByDay() {
  const db = getDb();
  const rows = db.prepare(`SELECT date, title, url, domain, type, sentiment, isNew FROM sources ORDER BY date ASC, id ASC`).all();
  const byDay = {};
  for (const r of rows) {
    const rec = { date: r.date, title: r.title, url: r.url, domain: r.domain, type: r.type, sentiment: r.sentiment, isNew: !!r.isNew };
    (byDay[r.date] ||= []).push(rec);
  }
  return byDay;
}

export function getLatestDetail(date) {
  const db = getDb();
  const day = date
    ? db.prepare(`SELECT * FROM days WHERE date = ?`).get(date)
    : db.prepare(`SELECT * FROM days ORDER BY date DESC LIMIT 1`).get();
  if (!day) return null;

  const topSources = db.prepare(`SELECT title, url, domain, type, sentiment, isNew FROM sources WHERE date = ? ORDER BY id ASC`)
    .all(day.date).map(r => ({ ...r, isNew: !!r.isNew }));
  const social = db.prepare(`SELECT platform, account, url, accountType, sentiment, note FROM social WHERE date = ? ORDER BY id ASC`).all(day.date);
  const alerts = db.prepare(`SELECT level, type, source, alertDate as date, summary, action FROM alerts WHERE date = ? ORDER BY id ASC`).all(day.date);
  const activityLog = db.prepare(`SELECT time, step, result, note FROM activity_log WHERE date = ? ORDER BY id ASC`).all(day.date);

  return { date: day.date, topSources, social, alerts, activityLog };
}

export function isFileIngested(filename) {
  const db = getDb();
  return !!db.prepare(`SELECT 1 FROM ingested_files WHERE filename = ?`).get(filename);
}

export function recordIngestedFile({ filename, date, status, note }) {
  const db = getDb();
  db.prepare(`
    INSERT INTO ingested_files (filename, date, ingestedAt, status, note)
    VALUES (:filename, :date, :ingestedAt, :status, :note)
    ON CONFLICT(filename) DO UPDATE SET date=excluded.date, ingestedAt=excluded.ingestedAt, status=excluded.status, note=excluded.note
  `).run({ filename, date: date || null, ingestedAt: new Date().toISOString(), status, note: note || '' });
}
