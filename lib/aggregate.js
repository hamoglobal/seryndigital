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

export function buildBuckets(days, mode, sourcesByDay) {
  let buckets;
  if (mode === 'day') {
    buckets = days.map(d => ({
      key: d.date,
      label: fmtDateFull(d.date),
      total: d.total, positive: d.positive, neutral: d.neutral, negative: d.negative,
      newSources: d.newSources, riskLevel: effectiveRiskLevel(d), riskNote: d.riskNote, dayCount: 1, dates: [d.date],
    }));
  } else {
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
    buckets = Array.from(map.values());
  }

  // The sums above come straight from each day's raw report figures (or a raw
  // row count), which can include the same source counted more than once —
  // either an exact duplicate row within one day's report, or the same URL
  // reappearing across days once a bucket spans more than a day (week/month/
  // year views). When the caller supplies sourcesByDay, replace those raw sums
  // with counts over the deduped source list so "Tổng nguồn" and its breakdown
  // (Tích cực/Trung tính/Tiêu cực/Nguồn mới) always reflect unique sources —
  // matching the source-list modals, which dedupe via dedupedSourcesForBucket.
  //
  // Dedupe ONCE per bucket (not once per category independently) and derive
  // every category count by filtering that single resolved list. Deduping a
  // sentiment-filtered subset of raw rows separately for each category (the
  // previous approach) let the same real-world source — re-classified by the
  // analyst on a later day within the same week/month/year — land in TWO
  // category buckets at once (e.g. counted once under "positive" from an
  // early occurrence and again under "neutral" from a later one), while
  // "Tổng nguồn" (deduped across all sentiments together) counted it only
  // once. That made Tích cực + Trung tính + Tiêu cực sum to MORE than Tổng
  // nguồn in some periods. Resolving each source to a single entry first (its
  // most-recent occurrence's sentiment, same "latest wins" rule dedupeSources
  // already uses everywhere else) makes the categories a true partition of
  // the total — Tổng nguồn always equals Tích cực + Trung tính + Tiêu cực
  // plus any rows whose sentiment couldn't be classified by the parser (see
  // canonicalizeSourceType's 'unknown' fallback in parser.mjs) — never less,
  // never more.
  if (sourcesByDay) {
    buckets = buckets.map(b => {
      const deduped = dedupedSourcesForBucket(sourcesByDay, b);
      return {
        ...b,
        total: deduped.length,
        positive: sourcesForBucket(deduped, 'positive').length,
        neutral: sourcesForBucket(deduped, 'neutral').length,
        negative: sourcesForBucket(deduped, 'negative').length,
        newSources: sourcesForBucket(deduped, 'new').length,
      };
    });
  }
  return buckets;
}

/**
 * Collect every countable source row across a bucket's dates and resolve
 * repeat appearances of the same real-world source into one entry (see
 * dedupeSources). This is the single source of truth for a bucket's source
 * list — buildBuckets' counts and every click-through modal in Dashboard.jsx
 * both filter THIS list rather than deduping independently, so a KPI number
 * always matches what the matching modal shows and the categories always sum
 * back up to the total (see the comment in buildBuckets above).
 */
export function dedupedSourcesForBucket(sourcesByDay, bucket) {
  if (!sourcesByDay) return [];
  const all = [];
  for (const date of bucket.dates) {
    const rows = sourcesByDay[date] || [];
    all.push(...rows);
  }
  // Rows with no real link whose "type" free-text is a risk-check / carry-
  // forward status note (e.g. "Không tìm thấy nội dung tiêu cực hôm nay")
  // aren't a source/citation — they're the analyst's daily risk-scan status,
  // re-worded slightly by the report generator every single day. Left in,
  // each day's rewording would dedupe as a "new" unique source and inflate
  // Tổng nguồn/Tích cực/Trung tính over a week/month/year view. A risk-check
  // row WITH a real link (rare, but it happens when a note cites a specific
  // page) is still a real source and stays.
  const countable = all.filter(s => isRealUrl(s.url) || canonicalizeSourceType(s.type) !== 'Rủi ro / Rà soát');
  return dedupeSources(countable);
}

/** Filter an already-deduped bucket source list (see dedupedSourcesForBucket) down to one category. */
export function sourcesForBucket(deduped, category) {
  if (category === 'positive') return deduped.filter(s => s.sentiment === 'positive');
  if (category === 'neutral') return deduped.filter(s => s.sentiment === 'neutral');
  if (category === 'negative') return deduped.filter(s => s.sentiment === 'negative');
  if (category === 'new') return deduped.filter(s => s.isNew);
  return deduped;
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
  const t = String(u || '').trim();
  if (!t || t === '-') return false;
  if (/^https?:\/\//i.test(t)) return true;
  // A handful of report rows give a bare domain (or domain+path) with no
  // protocol, e.g. "eva.vn" instead of "https://eva.vn" — still a real,
  // identifiable source, just not a well-formed URL string.
  return !/\s/.test(t) && /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(t);
}

// Diacritic/case-insensitive normalization for text matching — same idea as
// the parser's own norm(), duplicated here (kept intentionally dependency-free
// since this file is imported directly into the client bundle).
function normText(s) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// Strips a trailing "- source"/"– source"/"| source" attribution clause and
// any trailing "(...)" aside from an already diacritic/case-normalized title.
// Different report-template generations render the same article's title with
// vs. without its outlet name tacked on the end ("Điều gì giúp Seryn Clinic
// nổi bật - YAN.vn (đăng lại, báo uy tín)" vs. "Điều gì giúp Seryn Clinic nổi
// bật – YAN") for rows that also lack a real URL (see coreTitle's caller) —
// without this, those collide with nothing and each generation's phrasing
// counts as a separate "unique" source. Runs a couple of passes since some
// titles carry both a parenthetical AND a dash-clause.
function coreTitle(normalizedTitle) {
  let t = normalizedTitle;
  for (let i = 0; i < 2; i++) {
    const before = t;
    t = t.replace(/\s*\([^)]*\)\s*$/, '').trim();
    t = t.replace(/\s*[-–—|]\s*[^-–—|]+$/, '').trim();
    if (t === before) break;
  }
  return t;
}

const TRACKING_QUERY_PARAMS = new Set(['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid', 'ref', 'ref_src', 'spm']);
// Trailing path "tabs" that don't change which channel/profile is being
// monitored (a YouTube channel's /about vs /videos vs bare channel URL is
// still the same channel).
const IGNORED_TRAILING_SEGMENTS = /\/(about|videos|featured|posts|community|playlists|photos|reviews)\/?$/i;

/**
 * Canonicalize a URL so the same real-world page/profile matches regardless
 * of protocol, www., trailing slash, percent-encoding, tracking params, or
 * (for a couple of known platforms) which tab of a profile was linked.
 * Falls back to a lowercased raw string if the URL doesn't parse.
 */
function canonicalizeUrl(raw) {
  const trimmed = String(raw).trim();
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let u;
  try {
    u = new URL(withProtocol);
  } catch {
    return trimmed.toLowerCase();
  }
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  let path = u.pathname;
  try { path = decodeURIComponent(path); } catch { /* leave as-is if malformed */ }

  // Facebook pages/profiles are identified by a numeric ID that can appear
  // either as ?id=... or as the trailing segment of /p/<name-slug>-<id>/ or
  // bare /<id> — the human-readable name-slug part varies (diacritics,
  // encoding, casing) across report generations even though it's the same
  // page, so once we have the numeric ID that alone is the identity.
  if (host.includes('facebook.com')) {
    const idFromQuery = u.searchParams.get('id');
    const idFromPath = path.match(/(\d{6,})\/?$/);
    const fbId = idFromQuery || (idFromPath && idFromPath[1]);
    if (fbId) return `facebook.com/id:${fbId}`;
  }

  path = path.replace(IGNORED_TRAILING_SEGMENTS, '');
  path = path.replace(/\/+$/, '');

  const keptParams = [...u.searchParams.entries()].filter(([k]) => !TRACKING_QUERY_PARAMS.has(k.toLowerCase()));
  keptParams.sort(([a], [b]) => a.localeCompare(b));
  const query = keptParams.length ? '?' + keptParams.map(([k, v]) => `${k}=${v}`).join('&') : '';

  return `${host}${path.toLowerCase()}${query}`;
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
 * Matched by canonicalized URL when there is one — protocol/www/trailing-
 * slash/percent-encoding/tracking-param differences and a couple of known
 * "same profile, different tab" URL shapes (YouTube /about, Facebook's
 * name-slug-vs-numeric-id variants) are normalized away first, since those
 * otherwise defeat naive exact-string matching. Report "note" rows (no real
 * link, e.g. a carry-forward observation) often share a placeholder like "-"
 * as their url, so those fall back to matching on diacritic/case-normalized
 * title text instead — otherwise unrelated notes would incorrectly collide
 * on that placeholder, and Vietnamese text written with vs. without
 * diacritics (different report-template generations do both) would
 * incorrectly count as different sources.
 */
export function dedupeSources(list) {
  const map = new Map();
  let anon = 0;
  for (const s of list) {
    // Title-less rows are keyed on the EXACT normalized title, not the looser
    // coreTitle used below in the second pass — two different orphan rows
    // (no real URL on either) can legitimately share a coreTitle while being
    // different real sources (the same PR story syndicated near-verbatim to
    // two different outlets, e.g. "...nổi bật – YAN" vs "...nổi bật –
    // TheThaoVanHoa"), and collapsing those here would conflate them with no
    // safety net. coreTitle is only used in the second pass below, where it
    // exclusively bridges an orphan to an UNAMBIGUOUS URL-identified source.
    let key = isRealUrl(s.url)
      ? `url:${canonicalizeUrl(s.url)}`
      : `title:${normText(s.title)}`;
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
      existing.sentiment = s.sentiment;
      existing.type = s.type;
      existing.title = s.title;
      existing.date = s.date;
    }
    existing.isNew = existing.isNew || s.isNew;
  }

  // Second pass: a source we otherwise track by URL is sometimes missing the
  // URL on a given day's row (usually an earlier report-template generation
  // that didn't carry a link for that entry), so the pass above bucketed it
  // under a fallback title key instead of the URL key everything else already
  // agrees on — leaving the same real-world article as two "unique" sources.
  // Fold any such orphan into the URL-identified entry for the same
  // article/page, matched on title with its trailing "- source"/"(source)"
  // attribution stripped (coreTitle). Skipped below a short-title floor,
  // where a coincidental match across unrelated rows becomes plausible, AND
  // skipped whenever two or more DIFFERENT url-keyed sources share the same
  // coreTitle — this genuinely happens (the same PR story syndicated near-
  // verbatim to several outlets, titled "X - Outlet1" / "X - Outlet2", which
  // are meant to count as separate sources), so an ambiguous coreTitle is
  // left unresolved rather than risking a merge into the wrong outlet.
  const CORE_TITLE_MATCH_FLOOR = 12;
  const coreTitleCounts = new Map();
  for (const entry of map.values()) {
    if (!isRealUrl(entry.url)) continue;
    const ct = coreTitle(normText(entry.title));
    if (ct.length < CORE_TITLE_MATCH_FLOOR) continue;
    coreTitleCounts.set(ct, (coreTitleCounts.get(ct) || 0) + 1);
  }
  const byCoreTitle = new Map();
  for (const entry of map.values()) {
    if (!isRealUrl(entry.url)) continue;
    const ct = coreTitle(normText(entry.title));
    if (ct.length < CORE_TITLE_MATCH_FLOOR) continue;
    if (coreTitleCounts.get(ct) === 1) byCoreTitle.set(ct, entry);
  }
  for (const [key, entry] of Array.from(map.entries())) {
    if (isRealUrl(entry.url)) continue;
    const ct = coreTitle(normText(entry.title));
    if (ct.length < CORE_TITLE_MATCH_FLOOR) continue;
    const target = byCoreTitle.get(ct);
    if (!target || target === entry) continue;
    target.occurrences += entry.occurrences;
    if (entry.firstDate && (!target.firstDate || entry.firstDate < target.firstDate)) target.firstDate = entry.firstDate;
    if (entry.lastDate && entry.lastDate >= target.lastDate) {
      // Adopt the more recent occurrence's sentiment/type, but keep the
      // URL-bearing entry's own title/url — that's the more informative,
      // trustworthy identity for display even if the merged-in row happens
      // to be newer.
      target.lastDate = entry.lastDate;
      target.sentiment = entry.sentiment;
      target.type = entry.type;
    }
    target.isNew = target.isNew || entry.isNew;
    map.delete(key);
  }

  // Third pass: a bare domain (e.g. "eva.vn", no path) isn't specific enough
  // to identify one article either — a handful of early report-template rows
  // wrote just the outlet's domain where a later/parallel row for the exact
  // same story carries the full article URL on that same host. Fold the
  // bare-domain entry into that full-path entry when the title (with its
  // trailing "- source"/"(source)" attribution stripped) matches, and only
  // one such same-host candidate exists — a domain genuinely only ever
  // mentioned at the bare-domain level (e.g. the brand's own homepage, which
  // has no competing "more specific" URL to fold into) is left as its own
  // entry, unaffected.
  for (const [key, entry] of Array.from(map.entries())) {
    if (!key.startsWith('url:') || key.slice(4).includes('/')) continue;
    const host = key.slice(4);
    const ct = coreTitle(normText(entry.title));
    if (ct.length < CORE_TITLE_MATCH_FLOOR) continue;
    const candidates = [];
    for (const [k2, e2] of map.entries()) {
      if (k2 === key || !k2.startsWith(`url:${host}/`)) continue;
      if (coreTitle(normText(e2.title)) === ct) candidates.push(e2);
    }
    if (candidates.length !== 1) continue;
    const target = candidates[0];
    target.occurrences += entry.occurrences;
    if (entry.firstDate && (!target.firstDate || entry.firstDate < target.firstDate)) target.firstDate = entry.firstDate;
    if (entry.lastDate && entry.lastDate >= target.lastDate) {
      target.lastDate = entry.lastDate;
      target.sentiment = entry.sentiment;
      target.type = entry.type;
    }
    target.isNew = target.isNew || entry.isNew;
    map.delete(key);
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
