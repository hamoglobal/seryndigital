// lib/competitorDb.js
// SQLite data layer for the "Đối Thủ" (competitor) page. Uses the same
// database file/connection as the main app (lib/db.js's getDb()) — just adds
// its own two tables, initialized lazily and idempotently on first use.
import { getDb } from './db.js';

let initialized = false;
function ensureSchema() {
  if (initialized) return;
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS competitor_brands (
      date TEXT NOT NULL,
      brand TEXT NOT NULL,
      badNews INTEGER NOT NULL DEFAULT 0,
      newArticles INTEGER NOT NULL DEFAULT 0,
      riskLevel TEXT NOT NULL DEFAULT 'low',
      riskRaw TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      mainSources TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (date, brand)
    );
    CREATE INDEX IF NOT EXISTS idx_competitor_brands_date ON competitor_brands(date);

    CREATE TABLE IF NOT EXISTS competitor_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      brand TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      summary TEXT NOT NULL DEFAULT '',
      itemDate TEXT NOT NULL DEFAULT '',
      url TEXT NOT NULL DEFAULT '',
      domain TEXT NOT NULL DEFAULT '',
      channel TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_competitor_items_date ON competitor_items(date);
    CREATE INDEX IF NOT EXISTS idx_competitor_items_brand ON competitor_items(brand);

    CREATE TABLE IF NOT EXISTS competitor_ingested_files (
      filename TEXT PRIMARY KEY,
      date TEXT,
      ingestedAt TEXT NOT NULL,
      status TEXT NOT NULL,
      note TEXT
    );
  `);
  initialized = true;
}

/** Upsert one full day's competitor report (brand summaries + detail items) in a single transaction. */
export function upsertCompetitorDay({ date, brands = [], items = [] }) {
  ensureSchema();
  const db = getDb();
  db.exec('BEGIN');
  try {
    db.prepare(`DELETE FROM competitor_brands WHERE date = ?`).run(date);
    db.prepare(`DELETE FROM competitor_items WHERE date = ?`).run(date);

    const insBrand = db.prepare(`
      INSERT INTO competitor_brands (date, brand, badNews, newArticles, riskLevel, riskRaw, note, mainSources)
      VALUES (:date, :brand, :badNews, :newArticles, :riskLevel, :riskRaw, :note, :mainSources)
    `);
    for (const b of brands) insBrand.run({ ...b, date });

    const insItem = db.prepare(`
      INSERT INTO competitor_items (date, brand, type, title, summary, itemDate, url, domain, channel)
      VALUES (:date, :brand, :type, :title, :summary, :itemDate, :url, :domain, :channel)
    `);
    for (const it of items) insItem.run({ ...it, date });

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function getCompetitorDates() {
  ensureSchema();
  const db = getDb();
  return db.prepare(`SELECT DISTINCT date FROM competitor_brands ORDER BY date ASC`).all().map(r => r.date);
}

export function getCompetitorBrandsForDate(date) {
  ensureSchema();
  const db = getDb();
  const targetDate = date || db.prepare(`SELECT MAX(date) as d FROM competitor_brands`).get()?.d;
  if (!targetDate) return { date: null, brands: [] };
  const brands = db.prepare(`
    SELECT brand, badNews, newArticles, riskLevel, riskRaw, note, mainSources
    FROM competitor_brands WHERE date = ? ORDER BY badNews DESC, newArticles DESC, brand ASC
  `).all(targetDate);
  return { date: targetDate, brands };
}

export function getCompetitorItems({ date, brand, type } = {}) {
  ensureSchema();
  const db = getDb();
  const targetDate = date || db.prepare(`SELECT MAX(date) as d FROM competitor_items`).get()?.d;
  if (!targetDate) return [];
  let sql = `SELECT brand, type, title, summary, itemDate, url, domain, channel FROM competitor_items WHERE date = ?`;
  const params = [targetDate];
  if (brand) { sql += ` AND brand = ?`; params.push(brand); }
  if (type) { sql += ` AND type = ?`; params.push(type); }
  sql += ` ORDER BY id ASC`;
  return db.prepare(sql).all(...params);
}

export function getAllCompetitorBrandNames() {
  ensureSchema();
  const db = getDb();
  return db.prepare(`SELECT DISTINCT brand FROM competitor_brands ORDER BY brand ASC`).all().map(r => r.brand);
}

export function isCompetitorFileIngested(filename) {
  ensureSchema();
  const db = getDb();
  return !!db.prepare(`SELECT 1 FROM competitor_ingested_files WHERE filename = ?`).get(filename);
}

export function recordCompetitorIngestedFile({ filename, date, status, note }) {
  ensureSchema();
  const db = getDb();
  db.prepare(`
    INSERT INTO competitor_ingested_files (filename, date, ingestedAt, status, note)
    VALUES (:filename, :date, :ingestedAt, :status, :note)
    ON CONFLICT(filename) DO UPDATE SET date=excluded.date, ingestedAt=excluded.ingestedAt, status=excluded.status, note=excluded.note
  `).run({ filename, date: date || null, ingestedAt: new Date().toISOString(), status, note: note || '' });
}
