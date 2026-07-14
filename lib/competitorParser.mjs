// lib/competitorParser.mjs
//
// Parser for the competitor-brand monitoring reports ("Đối Thủ" page),
// sourced from BaoCao_TheoDoi_ThamMy_YYYY-MM-DD.xlsx in the "Digital Doi Thu"
// folder — a separate, pre-existing scheduled task ("bao-cao-tham-my-hang-ngay")
// tracks 14 aesthetic-clinic competitor brands daily (bad news/violations +
// new articles, each with a risk level). This app only reads that output; it
// does not touch or modify that task.
//
// Each report has 3 relevant sheets: an overview ("Tổng quan") with one row
// per brand (counts + risk level + note), and two detail sheets ("Tin xau -
// Vi pham" / "Bai viet moi") with one row per bad-news item / new-article
// item. Column headers vary slightly across the archive's two report-
// generation eras (e.g. "Tiêu đề" split into its own column vs. folded into
// "Mô tả chi tiết"; "Domain" present vs. derived from the URL) — handled via
// fuzzy label matching rather than fixed column positions, same approach as
// the main Seryn report parser (lib/parser.mjs).
import XLSX from 'xlsx';
import fs from 'node:fs';

function norm(s) {
  return String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cellStr(v) {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

function cellNum(v) {
  if (typeof v === 'number') return v;
  const n = parseFloat(String(v ?? '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function domainFromUrl(url) {
  try {
    return new URL(String(url).trim()).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** Normalize a free-text risk label ("CAO"/"Cao"/"TRUNG BÌNH"/"Thấp"...) to a stable 3-level scale. */
export function canonicalizeCompetitorRisk(raw) {
  const n = norm(raw);
  if (n.includes('cao')) return 'high';
  if (n.includes('trung')) return 'medium';
  if (n.includes('thap')) return 'low';
  return 'low';
}
export function competitorRiskLabel(level) {
  if (level === 'high') return 'CAO';
  if (level === 'medium') return 'TRUNG BÌNH';
  return 'THẤP';
}
export function competitorRiskColor(level) {
  if (level === 'high') return 'var(--danger-500)';
  if (level === 'medium') return 'var(--gold-600)';
  return 'var(--success-500)';
}
export function competitorRiskSoftBg(level) {
  if (level === 'high') return 'var(--danger-100)';
  if (level === 'medium') return 'var(--gold-100)';
  return 'var(--success-100)';
}

function sheetToMatrix(wb, nameCandidates) {
  const normNames = wb.SheetNames.map(n => ({ raw: n, n: norm(n) }));
  for (const cand of nameCandidates) {
    const nc = norm(cand);
    const hit = normNames.find(x => x.n === nc || x.n.includes(nc));
    if (hit) return XLSX.utils.sheet_to_json(wb.Sheets[hit.raw], { header: 1, defval: '' });
  }
  return null;
}

/**
 * Scan the first few rows for the header row (the one containing a "brand
 * name" column). Requires an EXACT cell match, not a substring — the report's
 * title/subtitle rows are free text that often happens to contain "thương
 * hiệu" inside a longer sentence (e.g. "Phạm vi: 14 thương hiệu | Nguồn:
 * ..."), which would otherwise be mistaken for the real header row.
 */
function findHeaderRowIndex(matrix, requiredTokens = ['thuong hieu', 'ten thuong hieu'], scanRows = 8) {
  for (let r = 0; r < Math.min(scanRows, matrix.length); r++) {
    const row = matrix[r] || [];
    if (row.some(cell => {
      const n = norm(cell);
      // exact match against known header phrasings, OR a short cell (real
      // headers are a few words; report title/subtitle sentences are much
      // longer) containing "thuong hieu" as a whole word — guards against
      // the title/subtitle rows that happen to mention "thương hiệu" inline
      // (e.g. "Phạm vi: 14 thương hiệu | Nguồn: ...") without hand-listing
      // every possible header phrasing.
      if (requiredTokens.includes(n)) return true;
      return n.length <= 25 && new RegExp(`(^|\\s)thuong hieu(\\s|$)`).test(n);
    })) return r;
  }
  return -1;
}

function colIndexFor(headerRow, synonyms) {
  const normed = headerRow.map(norm);
  for (const syn of synonyms) {
    let idx = normed.findIndex(c => c === syn);
    if (idx !== -1) return idx;
  }
  for (const syn of synonyms) {
    const idx = normed.findIndex(c => c.includes(syn));
    if (idx !== -1) return idx;
  }
  return -1;
}

// The watchlist is a small, fixed set of 14 named competitor brands (per the
// report's own "Phạm vi: 14 thương hiệu" subtitle). Brand text is written
// inconsistently across the archive's report-generation eras — with/without
// diacritics, "Viện thẩm mỹ" vs "TM" vs "Viện TM" abbreviations, "Bệnh viện"
// vs "BV" — so free-text grouping would badly fragment one real brand into
// many rows. A small canonical mapping (matched by a distinctive keyword) is
// more reliable here than generic normalization, since the watchlist itself
// is fixed and known.
const BRAND_CANONICAL_MAP = [
  { match: 'kangjin', canonical: 'Viện thẩm mỹ KangJin Sejung' },
  { match: 'kangnam', canonical: 'Bệnh viện thẩm mỹ Kangnam' },
  { match: 'thanh hang', canonical: 'Thanh Hằng Beauty Medi' },
  { match: 'lavender', canonical: 'Lavender By Chang' },
  { match: 'xuan huong', canonical: 'Thẩm mỹ viện Xuân Hương' },
  { match: 'bally', canonical: 'Viện thẩm mỹ Bally' },
  { match: 'hai le', canonical: 'Viện thẩm mỹ Dr. Hải Lê' },
  { match: 'ngoc dung', canonical: 'Thẩm mỹ viện Ngọc Dung' },
  { match: 'vietcharm', canonical: 'Thẩm mỹ viện VietCharm' },
  { match: 'thai ha', canonical: 'Thẩm mỹ viện Dr. Thái Hà' },
  { match: 'vita', canonical: 'Thẩm mỹ viện VITA Clinic' },
  { match: 'hongkong', canonical: 'Thẩm mỹ Hongkong' },
  { match: 'seoul', canonical: 'Thẩm mỹ Seoul' },
  { match: 'thu cuc', canonical: 'Thẩm mỹ Thu Cúc' },
];

/** Map a raw brand string to its canonical display name (or the trimmed raw value if no known match). */
export function canonicalizeBrandName(raw) {
  const n = norm(raw);
  for (const { match, canonical } of BRAND_CANONICAL_MAP) {
    if (n.includes(match)) return canonical;
  }
  return cellStr(raw);
}

// Legend/footer/total rows that occasionally land in the "brand" column
// (e.g. a risk-level legend explaining "CAO – Có tin xấu/vi phạm pháp lý", or
// a "TỔNG" totals row) — not real brands, must be filtered out. Matched
// against the NORMALIZED text (norm() already strips the "–"/punctuation
// that visually sets these apart, so match on the leading risk-level word
// instead — no real brand name in the watchlist starts with one of these).
const NON_BRAND_PREFIXES = ['cao ', 'trung binh ', 'thap ', 'nghiem trong '];

function isRealBrandRow(raw) {
  const n = norm(raw);
  if (!n) return false;
  if (n === 'tong' || n === 'tong cong') return false;
  if (/^\d+\s*thuong hieu$/.test(n)) return false;
  if (NON_BRAND_PREFIXES.some(p => n.startsWith(p))) return false;
  return true;
}

function parseOverviewSheet(matrix) {
  if (!matrix) return [];
  const headerIdx = findHeaderRowIndex(matrix);
  if (headerIdx === -1) return [];
  const header = matrix[headerIdx];
  const col = {
    brand: colIndexFor(header, ['thuong hieu']),
    badNews: colIndexFor(header, ['tin xau', 'vi pham']),
    newArticles: colIndexFor(header, ['bai viet moi', 'so bai viet']),
    riskLevel: colIndexFor(header, ['muc do rui ro']),
    note: colIndexFor(header, ['ghi chu']),
    mainSources: colIndexFor(header, ['nguon chinh']),
  };
  const out = [];
  for (let r = headerIdx + 1; r < matrix.length; r++) {
    const row = matrix[r] || [];
    const rawBrand = cellStr(row[col.brand]);
    if (!rawBrand || !isRealBrandRow(rawBrand)) continue;
    out.push({
      brand: canonicalizeBrandName(rawBrand),
      badNews: col.badNews !== -1 ? cellNum(row[col.badNews]) : 0,
      newArticles: col.newArticles !== -1 ? cellNum(row[col.newArticles]) : 0,
      riskLevel: canonicalizeCompetitorRisk(col.riskLevel !== -1 ? row[col.riskLevel] : ''),
      riskRaw: col.riskLevel !== -1 ? cellStr(row[col.riskLevel]) : '',
      note: col.note !== -1 ? cellStr(row[col.note]) : '',
      mainSources: col.mainSources !== -1 ? cellStr(row[col.mainSources]) : '',
    });
  }
  return out;
}

function parseDetailSheet(matrix, type) {
  if (!matrix) return [];
  const headerIdx = findHeaderRowIndex(matrix);
  if (headerIdx === -1) return [];
  const header = matrix[headerIdx];
  const col = {
    brand: colIndexFor(header, ['thuong hieu']),
    title: colIndexFor(header, ['tieu de', 'loai vi pham']),
    summary: colIndexFor(header, ['tom tat', 'mo ta chi tiet', 'noi dung']),
    itemDate: colIndexFor(header, ['ngay bao cao', 'ngay', 'thoi gian']),
    url: colIndexFor(header, ['url', 'nguon (url)', 'nguon']),
    domain: colIndexFor(header, ['domain']),
    channel: colIndexFor(header, ['kenh']),
  };
  const out = [];
  for (let r = headerIdx + 1; r < matrix.length; r++) {
    const row = matrix[r] || [];
    const rawBrand = cellStr(row[col.brand]);
    if (!rawBrand || !isRealBrandRow(rawBrand)) continue;
    const url = col.url !== -1 ? cellStr(row[col.url]) : '';
    out.push({
      brand: canonicalizeBrandName(rawBrand),
      type,
      title: col.title !== -1 ? cellStr(row[col.title]) : '',
      summary: col.summary !== -1 ? cellStr(row[col.summary]) : '',
      itemDate: col.itemDate !== -1 ? cellStr(row[col.itemDate]) : '',
      url,
      domain: col.domain !== -1 ? cellStr(row[col.domain]) : domainFromUrl(url),
      channel: col.channel !== -1 ? cellStr(row[col.channel]) : '',
    });
  }
  return out;
}

/** date extracted from the filename, e.g. BaoCao_TheoDoi_ThamMy_2026-07-14.xlsx -> "2026-07-14" */
function dateFromFilename(filePath) {
  const m = /(\d{4}-\d{2}-\d{2})/.exec(filePath);
  return m ? m[1] : null;
}

export function parseCompetitorReportFile(filePath) {
  const date = dateFromFilename(filePath);
  if (!date) throw new Error(`Could not determine report date from filename: ${filePath}`);
  if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);

  const wb = XLSX.readFile(filePath);
  const overviewMatrix = sheetToMatrix(wb, ['tong quan']);
  const badNewsMatrix = sheetToMatrix(wb, ['tin xau - vi pham', 'tin xau']);
  const newArticlesMatrix = sheetToMatrix(wb, ['bai viet moi']);

  const brands = parseOverviewSheet(overviewMatrix);
  const badNewsItems = parseDetailSheet(badNewsMatrix, 'bad_news');
  const newArticleItems = parseDetailSheet(newArticlesMatrix, 'new_article');

  if (brands.length === 0) {
    throw new Error(`No brand rows found in "Tổng quan" sheet: ${filePath}`);
  }

  return { date, brands, items: [...badNewsItems, ...newArticleItems] };
}
