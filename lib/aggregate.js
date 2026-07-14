// lib/aggregate.js
// Pure aggregation/formatting helpers ported 1:1 from the design prototype's
// Component logic (design_reference/Seryn Digital.dc.html) so the UI behaves
// identically, now driven by API data instead of a static JS import.

export function fmtDateLabel(iso) {
  if (!iso) return '';
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
}

export function fmtDateFull(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

export function isoWeekInfo(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const dayNum = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const weekNum = 1 + Math.round(((date - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return { year: date.getUTCFullYear(), week: weekNum };
}

export function riskRank(level) { return level === 'red' ? 2 : level === 'yellow' ? 1 : 0; }
export function worstRisk(a, b) { return riskRank(a) >= riskRank(b) ? a : b; }

/**
 * A 'red' flag with zero negative sources is a stale/carry-forward watch item, not a confirmed
 * violation this period — treat it as 'yellow' so it never contradicts a 0-negative KPI card.
 */
export function effectiveRiskLevel(d) {
  if (d.riskLevel === 'red' && (!d.negative || d.negative === 0)) return 'yellow';
  return d.riskLevel;
}

export function cap(s) {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function buildBuckets(days, mode) {
  if (mode === 'day') {
    return days.map(d => ({
      key: d.date,
      label: fmtDateFull(d.date),
      total: d.total, positive: d.positive, neutral: d.neutral, negative: d.negative,
      newSources: d.newSources, riskLevel: effectiveRiskLevel(d), riskNote: d.riskNote, dayCount: 1, dates: [d.date],
    }));
  }
  const map = new Map();
  for (const d of days) {
    let key, label;
    if (mode === 'week') {
      const wi = isoWeekInfo(d.date);
      key = `${wi.year}-W${String(wi.week).padStart(2, '0')}`;
      label = `Tuần ${wi.week}, ${wi.year}`;
    } else if (mode === 'month') {
      const [y, m] = d.date.split('-');
      key = `${y}-${m}`;
      label = `Tháng ${m}/${y}`;
    } else {
      const y = d.date.split('-')[0];
      key = y;
      label = `Năm ${y}`;
    }
    if (!map.has(key)) {
      map.set(key, { key, label, total: 0, positive: 0, neutral: 0, negative: 0, newSources: 0, riskLevel: 'green', riskNote: '', dayCount: 0, lastDate: d.date, firstDate: d.date, dates: [] });
    }
    const b = map.get(key);
    b.total += d.total; b.positive += d.positive; b.neutral += d.neutral; b.negative += d.negative;
    b.newSources += d.newSources;
    b.riskLevel = worstRisk(b.riskLevel, effectiveRiskLevel(d));
    b.dayCount += 1;
    b.lastDate = d.date;
    b.dates.push(d.date);
  }
  return Array.from(map.values());
}

export function sourcesForBucket(sourcesByDay, bucket, category) {
  if (!sourcesByDay) return [];
  const all = [];
  for (const date of bucket.dates) {
    const rows = sourcesByDay[date] || [];
    all.push(...rows);
  }
  if (category === 'positive') return all.filter(s => s.sentiment === 'positive');
  if (category === 'neutral') return all.filter(s => s.sentiment === 'neutral');
  if (category === 'negative') return all.filter(s => s.sentiment === 'negative');
  if (category === 'new') return all.filter(s => s.isNew);
  return all;
}

export function colorForRisk(level) {
  if (level === 'red') return 'var(--danger-500)';
  if (level === 'yellow') return 'var(--gold-600)';
  return 'var(--success-500)';
}
export function softBgForRisk(level) {
  if (level === 'red') return 'var(--danger-100)';
  if (level === 'yellow') return 'var(--gold-100)';
  return 'var(--success-100)';
}
export function borderForRisk(level) {
  if (level === 'red') return 'var(--coral-300)';
  if (level === 'yellow') return 'var(--gold-300)';
  return '#CFE6D8';
}
export function labelForRisk(level) {
  if (level === 'red') return 'CẢNH BÁO ĐỎ';
  if (level === 'yellow') return 'VÀNG — CẦN THEO DÕI';
  return 'AN TOÀN';
}

// ---------------------------------------------------------------------------
// Dedup + tag/type statistics
// ---------------------------------------------------------------------------

function isRealUrl(u) {
  return !!u && /^https?:\/\//i.test(String(u).trim());
}

/**
 * Merge repeat appearances of the same source into one entry — both exact
 * same-day duplicate rows (a handful of report dates list e.g. seryn.vn
 * twice) and the same site/article being checked again on later days (the
 * expected, common case: a monitored URL like the homepage or a press
 * article shows up in the Top10 list every day it's still relevant). Without
 * this, a week/month/year view's source list is mostly the same handful of
 * URLs repeated over and over.
 *
 * Matched by real URL when there is one; report "note" rows (no real link,
 * e.g. a carry-forward observation) often share a placeholder like "-" as
 * their url, so those fall back to matching on the exact title text instead
 * — otherwise unrelated notes would incorrectly collide on that placeholder.
 */
export function dedupeSources(list) {
  const map = new Map();
  let anon = 0;
  for (const s of list) {
    let key = isRealUrl(s.url)
      ? `url:${s.url.trim().toLowerCase().replace(/\/+$/, '')}`
      : `title:${(s.title || '').trim().toLowerCase()}`;
    if (key === 'url:' || key === 'title:') key = `anon:${anon++}`;

    const existing = map.get(key);
    if (!existing) {
      map.set(key, { ...s, occurrences: 1, firstDate: s.date || '', lastDate: s.date || '' });
      continue;
    }
    existing.occurrences += 1;
    const d = s.date || '';
    if (d && (!existing.firstDate || d < existing.firstDate)) existing.firstDate = d;
    if (d && d >= existing.lastDate) {
      existing.lastDate = d;
      // keep the most recent occurrence's changeable fields (sentiment/type
      // can shift over time — the freshest read is the most relevant one)
      existing.sentiment = s.sentiment;
      existing.type = s.type;
      existing.title = s.title;
      existing.date = s.date;
    }
    existing.isNew = existing.isNew || s.isNew;
  }
  return Array.from(map.values());
}

function normType(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase();
}

// The report's own "loại nguồn" field is analyst-written free text — 100+
// distinct raw strings across the historical archive (diacritic/casing
// variants, near-synonyms, the odd sentiment label reused as a "type").
// This buckets them into a small, stable set for the stats table.
const TYPE_CATEGORY_RULES = [
  { label: 'Website chính thức', match: ['website chinh thuc', 'owned', 'trang noi bo website', 'blog chinh thuc', 'blog moi', 'blog', 'landing page', 'website - blog', 'website - landing page', 'chi nhanh moi'] },
  { label: 'Báo chí / PR', match: ['bao chi', 'bao dien tu', 'tap chi', 'pr bao', 'pr/', 'pr media', 'tong hop bao chi', 'tong hop tin tuc', 'tong hop tag bao', 'website - bao chi', 'website - tong hop bao chi', 'giai thuong'] },
  { label: 'Mạng xã hội', match: ['mang xa hoi', 'mxh', 'kenh video', 'video marketing'] },
  { label: 'Y tế / Dược phẩm', match: ['y te', 'duoc pham', 'suc khoe', 'nen tang y te', 'danh muc y te', 'platform dat kham'] },
  { label: 'Rủi ro / Rà soát', match: ['rui ro', 'canh bao', 'ket qua ra soat', 'khong co canh bao'] },
  { label: 'Directory / Hồ sơ / Tuyển dụng', match: ['directory', 'listing', 'ho so', 'tuyen dung', 'viec lam', 'profile', 'tra cuu'] },
  { label: 'Không liên quan / Nhầm thương hiệu', match: ['khong lien quan', 'nham thuong hieu', 'phong kham khac'] },
];

/** Collapse a report's free-text "type" field into one of a handful of stable tag categories. */
export function canonicalizeSourceType(rawType) {
  const n = normType(rawType);
  if (!n) return 'Khác';
  // A few report generations left the "type" field as a bare sentiment word
  // (analyst reused "Tích cực"/"Trung tính"/"Sạch" instead of a real
  // category) — that's not a meaningful tag, call it out distinctly rather
  // than lump it into the generic "Khác" catch-all.
  if (['tich cuc', 'trung tinh', 'sach'].some(m => n === m)) return 'Chưa phân loại';
  for (const rule of TYPE_CATEGORY_RULES) {
    if (rule.match.some(m => n.includes(m))) return rule.label;
  }
  return 'Khác';
}

/** Per-tag counts (+ share of total) over a (typically already-deduped) source list. */
export function typeStats(sources) {
  const counts = new Map();
  for (const s of sources) {
    const label = canonicalizeSourceType(s.type);
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  const total = sources.length || 1;
  return Array.from(counts.entries())
    .map(([label, count]) => ({ label, count, pct: Math.round((count / total) * 100) }))
    .sort((a, b) => b.count - a.count);
}
