// lib/parser.mjs
//
// Robust parser for the daily Seryn Clinic brand-monitoring report. Across the
// real historical file set (94 files, 2026-05-05 through today) the report has
// gone through at least THREE distinct template generations:
//   - Vietnamese sheet names "Tong Quan / Top10 Google / Mang Xa Hoi / Canh Bao
//     / Nhat Ky" with a plain label+value-same-row KPI block.
//   - Numbered English sheet names "1. Dashboard / 2. Sources / 3. Social Media
//     / 4. Alerts / 5. Methodology" whose KPI block is a HEADER ROW of labels
//     followed by a VALUE ROW below it, spread across multiple columns
//     (e.g. row "TONG NGUON | | TICH CUC | | TRUNG TINH | | CANH BAO DO" then
//     the numbers directly underneath) rather than label+value on the same row.
//   - Flat CSV exports, of which there are two shapes: a simple one-row-per-
//     source table, and a "multi-section" export that flattens all the sheets
//     above into one CSV separated by section-title rows.
// This parser never assumes fixed cell coordinates or a fixed sheet name: it
// locates sheets by trying known name variants, and locates header rows/columns
// within a sheet by matching a set of known label synonyms
// (case/diacritic/language-insensitive), the way a human would read it.
import XLSX from 'xlsx';
import path from 'node:path';
import fs from 'node:fs';

// ---------------------------------------------------------------------------
// text normalization helpers
// ---------------------------------------------------------------------------

/** lowercase, strip Vietnamese diacritics, collapse whitespace/punctuation */
export function norm(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // strip diacritics
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9\s?/.-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isBlankRow(row) {
  return !row || row.every(c => c === null || c === undefined || String(c).trim() === '');
}

function cellStr(v) {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

function cellNum(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** does a normalized cell contain any of the given normalized synonym substrings? */
function matches(normCell, synonyms) {
  return synonyms.some(syn => normCell.includes(syn));
}

// ---------------------------------------------------------------------------
// generic header/column detection
// ---------------------------------------------------------------------------

/**
 * Scan the first `scanRows` rows for the one that best matches a set of
 * expected columns (>=2 distinct fields recognized). Returns the header row
 * index and a field->columnIndex map (null if a field's column wasn't found).
 */
function detectHeader(matrix, fieldSynonyms, { scanRows = 14, minMatches = 2 } = {}) {
  let best = { rowIdx: -1, colIndex: {}, score: 0 };
  const fieldNames = Object.keys(fieldSynonyms);

  for (let r = 0; r < Math.min(scanRows, matrix.length); r++) {
    const row = matrix[r] || [];
    const colIndex = {};
    const usedCols = new Set();
    for (const field of fieldNames) {
      const syns = fieldSynonyms[field];
      let foundCol = null;
      for (let c = 0; c < row.length; c++) {
        if (usedCols.has(c)) continue;
        const n = norm(row[c]);
        if (!n) continue;
        if (matches(n, syns)) { foundCol = c; break; }
      }
      if (foundCol !== null) { colIndex[field] = foundCol; usedCols.add(foundCol); }
    }
    const score = Object.keys(colIndex).length;
    if (score > best.score) best = { rowIdx: r, colIndex, score };
  }
  if (best.score < minMatches) return null;
  for (const field of fieldNames) if (!(field in best.colIndex)) best.colIndex[field] = null;
  return best;
}

function getCol(row, colIdx) {
  if (colIdx === null || colIdx === undefined) return null;
  return row[colIdx];
}

/** Read data rows following a header row until a blank/terminating row. */
function readDataRows(matrix, startRow, colIndex, primaryFields) {
  const out = [];
  for (let r = startRow; r < matrix.length; r++) {
    const row = matrix[r] || [];
    if (isBlankRow(row)) break;
    const hasPrimary = primaryFields.some(f => cellStr(getCol(row, colIndex[f])) !== '');
    if (!hasPrimary) break;
    out.push(row);
  }
  return out;
}

// ---------------------------------------------------------------------------
// sentiment / flags normalization
// ---------------------------------------------------------------------------

export function normalizeSentiment(raw) {
  const n = norm(raw);
  if (!n) return 'unknown';
  if (n.includes('tieu cuc')) return 'negative';
  if (n.includes('trung tinh')) return 'neutral';
  if (n.includes('tich cuc')) return 'positive';
  if (n.includes('an toan')) return 'positive';
  return 'unknown';
}

export function isTruthyFlag(raw) {
  // Checkmark/emoji-style markers (the most common "is new" indicator in the
  // real reports) carry meaning on their own and MUST be tested against the
  // raw value before norm() runs — norm() is ASCII-only and silently strips
  // '✓'/'✅'/etc. down to '', so the old code's '✓' entry in the synonym list
  // below could never actually match (it was dead code: by the time n was
  // compared, the checkmark that produced it was already gone).
  const rawStr = raw === null || raw === undefined ? '' : String(raw).trim();
  if (/[\u2713\u2714\u2611\u2705\ud83c\udd95]/.test(rawStr)) return true;
  const n = norm(raw);
  if (!n) return false;
  if (n === 'false' || n === 'no' || n === 'khong') return false;
  return ['x', 'moi', 'v', 'yes', 'co', 'true', '1'].some(t => n === t || n.includes(t));
}

function domainFromUrl(url) {
  try {
    const u = new URL(String(url));
    return u.hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// risk level / raw text classification
// ---------------------------------------------------------------------------

/**
 * Classify a free-text Vietnamese risk status string into green/yellow/red.
 * Reports always phrase "safe" as "không có/không phát hiện cảnh báo đỏ", so a
 * naive substring check for "đỏ" would misfire — red is only inferred when the
 * text mentions "đỏ" WITHOUT a nearby negation ("không").
 */
export function classifyRiskLevel(rawText) {
  const n = norm(rawText);
  if (!n) return 'green';
  const hasNegation = n.includes('khong');
  if (n.includes('do') && !hasNegation) return 'red';
  if (n.includes('vang')) return 'yellow';
  return 'green';
}

// ---------------------------------------------------------------------------
// per-section parsers (operate on a plain row matrix — used both for a real
// worksheet's rows and for a slice of a flattened multi-section CSV)
// ---------------------------------------------------------------------------

const TOP10_FIELDS = {
  title: ['tieu de', 'nguon', 'ten kenh', 'ten trang', 'title'],
  domain: ['domain'],
  type: ['loai noi dung', 'loai nguon', 'source type', 'loai'],
  url: ['url', 'lien ket', 'link'],
  sentiment: ['danh gia', 'phan loai', 'sentiment', 'tong'],
  isNew: ['moi', 'is new', 'new'],
  note: ['ghi chu', 'note'],
};

function parseTop10Sheet(matrix, dateIso) {
  const header = detectHeader(matrix, TOP10_FIELDS, { minMatches: 3 });
  if (!header) return [];
  const rows = readDataRows(matrix, header.rowIdx + 1, header.colIndex, ['title', 'url']);
  return rows.map(row => {
    const url = cellStr(getCol(row, header.colIndex.url));
    const domain = cellStr(getCol(row, header.colIndex.domain)) || domainFromUrl(url);
    return {
      date: dateIso,
      title: cellStr(getCol(row, header.colIndex.title)),
      url,
      domain,
      type: cellStr(getCol(row, header.colIndex.type)),
      sentiment: normalizeSentiment(getCol(row, header.colIndex.sentiment)),
      isNew: isTruthyFlag(getCol(row, header.colIndex.isNew)),
    };
  }).filter(s => s.title || s.url);
}

const SOCIAL_FIELDS = {
  platform: ['nen tang', 'platform'],
  account: ['tai khoan', 'ten kenh', 'ten trang', 'bai dang', 'channel name'],
  accountType: ['loai tai khoan', 'channel type'],
  url: ['url', 'lien ket', 'link'],
  sentiment: ['danh gia', 'phan loai', 'sentiment', 'tong'],
  note: ['ghi chu', 'note', 'status', 'trang thai'],
};

function parseSocialSheet(matrix, dateIso) {
  const header = detectHeader(matrix, SOCIAL_FIELDS, { minMatches: 3 });
  if (!header) return [];
  const rows = readDataRows(matrix, header.rowIdx + 1, header.colIndex, ['account', 'platform']);
  return rows.map(row => ({
    date: dateIso,
    platform: cellStr(getCol(row, header.colIndex.platform)),
    account: cellStr(getCol(row, header.colIndex.account)),
    url: cellStr(getCol(row, header.colIndex.url)),
    accountType: cellStr(getCol(row, header.colIndex.accountType)),
    sentiment: cellStr(getCol(row, header.colIndex.sentiment)), // kept raw (Vietnamese label) per schema
    note: cellStr(getCol(row, header.colIndex.note)),
  })).filter(s => s.account || s.url);
}

const ALERT_FIELDS = {
  level: ['muc do', 'level'],
  type: ['loai rui ro', 'loai van de', 'category', 'noi dung'],
  source: ['nguon', 'link'],
  alertDate: ['ngay phat hien', 'ngay', 'date'],
  summary: ['mo ta', 'noi dung tom tat', 'tom tat', 'ly do', 'finding', 'reason'],
  action: ['de xuat xu ly', 'hanh dong de xuat', 'de xuat', 'khuyen nghi', 'recommendation'],
};

function parseAlertsSheet(matrix, dateIso) {
  const header = detectHeader(matrix, ALERT_FIELDS, { minMatches: 2 });
  let statusLine = '';
  for (const row of matrix.slice(0, 8)) {
    const joined = row.map(cellStr).join(' ');
    if (norm(joined).includes('trang thai hom nay') || norm(joined).includes('tinh trang hom nay')) {
      statusLine = joined.replace(/^[^:]*:\s*/, '');
      break;
    }
  }
  if (!header) return { alerts: [], statusLine };
  const rows = readDataRows(matrix, header.rowIdx + 1, header.colIndex, ['type', 'level', 'summary']);
  const alerts = rows.map(row => ({
    date: dateIso,
    level: cellStr(getCol(row, header.colIndex.level)),
    type: cellStr(getCol(row, header.colIndex.type)),
    source: cellStr(getCol(row, header.colIndex.source)),
    alertDate: cellStr(getCol(row, header.colIndex.alertDate)) || dateIso,
    summary: cellStr(getCol(row, header.colIndex.summary)),
    action: cellStr(getCol(row, header.colIndex.action)),
  })).filter(a => a.type || a.summary);
  return { alerts, statusLine };
}

const STEP_LOG_FIELDS = {
  time: ['thoi gian', 'time'],
  step: ['buoc', 'step'],
  result: ['ket qua', 'result'],
  note: ['ghi chu', 'link', 'loi', 'note'],
};

function parseActivityLogSheet(matrix, dateIso) {
  const header = detectHeader(matrix, STEP_LOG_FIELDS, { minMatches: 2 });
  if (!header) return []; // some templates use a different shape entirely — skip rather than misparse
  const rows = readDataRows(matrix, header.rowIdx + 1, header.colIndex, ['step', 'result']);
  return rows.map(row => ({
    date: dateIso,
    time: cellStr(getCol(row, header.colIndex.time)),
    step: cellStr(getCol(row, header.colIndex.step)),
    result: cellStr(getCol(row, header.colIndex.result)),
    note: cellStr(getCol(row, header.colIndex.note)),
  })).filter(l => l.step || l.result);
}

// ---------------------------------------------------------------------------
// "Tong Quan"-equivalent KPI extraction — two layouts seen in the wild:
//  (a) label+value on the SAME row (label in col0, value in col1) — every row
//      in the sheet is a label/value pair candidate.
//  (b) a HEADER ROW of KPI labels spread across several columns, with the
//      VALUES directly on the row below in the same columns (e.g.
//      "TONG NGUON | TICH CUC | TRUNG TINH | CANH BAO DO" then the numbers).
// Both are harvested into the same {normLabel, value, note} shape so the rest
// of the pipeline (findKpi) doesn't need to know which layout it came from.
// ---------------------------------------------------------------------------

function harvestSameRowPairs(matrix) {
  const pairs = [];
  for (const row of matrix) {
    const label = cellStr(row[0]);
    if (!label) continue;
    const value = row[1];
    if (value === null || value === undefined || cellStr(value) === '') continue;
    pairs.push({ normLabel: norm(label), value, note: cellStr(row[2]) });
  }
  return pairs;
}

const ROW_PAIR_KPI_LABELS = {
  total: ['tong nguon'],
  positive: ['tich cuc'],
  neutral: ['trung tinh'],
  negative: ['canh bao do', 'canh bao đỏ'],
  newSources: ['nguon moi'],
};

function harvestRowPairKpis(matrix) {
  const pairs = [];
  for (let r = 0; r < matrix.length - 1; r++) {
    const row = matrix[r] || [];
    const nextRow = matrix[r + 1] || [];
    for (let c = 0; c < row.length; c++) {
      const n = norm(row[c]);
      if (!n) continue;
      // Exact match only (not "includes") — this scan checks every column of every
      // row, including free-text note/description cells, and a note that happens to
      // mention e.g. "khong co canh bao do" (no red alert) must NOT be treated as the
      // "CANH BAO DO" KPI header it resembles under substring matching. Real headers
      // in this layout are short standalone labels, so exact equality is safe.
      for (const [field, syns] of Object.entries(ROW_PAIR_KPI_LABELS)) {
        if (syns.some(s => n === s)) {
          const val = nextRow[c];
          if (val !== null && val !== undefined && cellStr(val) !== '') {
            pairs.push({ normLabel: field, value: val, note: '' }); // normLabel IS the field key here
          }
        }
      }
    }
  }
  return pairs;
}

function harvestLabelValuePairs(matrix) {
  return [...harvestSameRowPairs(matrix), ...harvestRowPairKpis(matrix)];
}

function findKpi(pairs, synonyms, { numeric = true } = {}) {
  for (const p of pairs) {
    if (synonyms.some(s => p.normLabel === s || p.normLabel.includes(s))) {
      if (numeric) {
        // A "%" value means this KPI is reported as a rate (e.g. "Ty le noi dung
        // tich cuc: 80%"), not a raw count — some templates report both a rate AND
        // a separate absolute total elsewhere. Treating the percentage number as a
        // raw count would badly inflate the figure, so skip and keep searching /
        // fall back to counting the parsed source rows instead.
        if (cellStr(p.value).includes('%')) continue;
        const n = cellNum(p.value);
        if (n !== null) return { value: n, note: p.note };
      } else {
        // A bare number (e.g. "0") is a count row that happens to also match a risk-status
        // synonym by coincidence (e.g. a "Noi dung tieu cuc / Canh bao do" count row) — a real
        // risk-status value is descriptive text, never just digits. Skip and keep searching.
        const str = cellStr(p.value);
        if (str !== '' && cellNum(str) !== null && /^[\d.,%\s-]+$/.test(str)) continue;
        return { value: str, note: p.note };
      }
    }
  }
  return null;
}

function extractDateFromTongQuan(pairs, filenameDate) {
  const found = findKpi(pairs, ['ngay bao cao'], { numeric: false });
  if (found && found.value) {
    // accepts dd/mm/yyyy or yyyy-mm-dd (possibly with extra trailing text)
    const m1 = found.value.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (m1) return `${m1[1]}-${m1[2]}-${m1[3]}`;
    const m2 = found.value.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if (m2) return `${m2[3]}-${m2[2]}-${m2[1]}`;
  }
  return filenameDate;
}

/**
 * Shared KPI reconciliation: prefer the report's own authoritative numbers
 * (label-matched, from either layout above), falling back to counting the
 * parsed Top10/Sources rows when a given template doesn't carry a figure at
 * all (e.g. the earliest template had no positive/neutral breakdown).
 */
function computeDayFields({ pairs, sources, alerts, statusLine, date }) {
  const totalKpi = findKpi(pairs, ['tong ket qua thu thap', 'tong nguon tim thay', 'tong nguon giam sat', 'tong so nguon', 'total', 'tong nguon']);
  const positiveKpi = findKpi(pairs, ['noi dung tich cuc', 'nguon tich cuc', 'positive', 'tich cuc']);
  const neutralKpi = findKpi(pairs, ['noi dung trung tinh', 'nguon trung tinh', 'neutral', 'trung tinh']);
  const negativeKpi = findKpi(pairs, ['noi dung tieu cuc', 'nguon canh bao do', 'nguon tieu cuc', 'negative']);
  const newKpi = findKpi(pairs, ['nguon moi']);
  const riskKpi = findKpi(pairs, ['trang thai hom nay', 'trang thai rui ro', 'canh bao do'], { numeric: false });

  const countBySentiment = (s) => sources.filter(x => x.sentiment === s).length;

  const positive = positiveKpi ? positiveKpi.value : countBySentiment('positive');
  const neutral = neutralKpi ? neutralKpi.value : countBySentiment('neutral');
  const negative = negativeKpi ? negativeKpi.value : countBySentiment('negative');
  const total = totalKpi ? totalKpi.value : (positive + neutral + negative);
  const newSources = newKpi ? newKpi.value : sources.filter(s => s.isNew).length;

  const riskRawCandidate = (riskKpi && riskKpi.value) || statusLine || (negative > 0 ? 'ĐỎ' : 'XANH - AN TOÀN');
  const riskLevel = classifyRiskLevel(riskRawCandidate);
  const riskNote = (riskKpi && riskKpi.note) ||
    (alerts.filter(a => classifyRiskLevel(a.level) !== 'green').map(a => a.summary).filter(Boolean).join(' ')) || '';

  return { date, total, positive, neutral, negative, newSources, riskRaw: riskRawCandidate, riskLevel, riskNote };
}

// ---------------------------------------------------------------------------
// top-level: parse one workbook (.xlsx) or flat export (.csv)
// ---------------------------------------------------------------------------

function dateFromFilename(filePath) {
  const m = path.basename(filePath).match(/(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

export function parseReportFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const filenameDate = dateFromFilename(filePath);

  if (ext === '.csv') {
    // Read as explicit UTF-8 text ourselves rather than letting SheetJS guess the
    // encoding from the raw file bytes — some of the real report CSVs have no
    // byte-order-mark, which made SheetJS's auto-detection misread accented
    // Vietnamese text as Latin-1 (mojibake) on at least one historical file.
    const text = fs.readFileSync(filePath, 'utf8').replace(/^﻿/, '');
    const wb = XLSX.read(text, { type: 'string', cellDates: false });
    return parseCsv(wb, filenameDate, filePath);
  }

  const wb = XLSX.readFile(filePath, { cellDates: false });
  if (wb.SheetNames.length === 1) return parseCsv(wb, filenameDate, filePath);
  return parseFullWorkbook(wb, filenameDate, filePath);
}

// Each logical "sheet" is tried against several known name variants — the
// template has used both Vietnamese names (Tong Quan, Top10 Google, ...) and
// numbered English names (1. Dashboard, 2. Sources, ...) across the history.
const SHEET_NAME_CANDIDATES = {
  tongquan: ['tong quan', 'dashboard'],
  top10: ['top10 google', 'top 10 google', 'sources'],
  social: ['mang xa hoi', 'social media', 'social'],
  alerts: ['canh bao', 'alerts'],
  log: ['nhat ky', 'methodology'],
};

function sheetToMatrix(wb, logicalName) {
  const candidates = SHEET_NAME_CANDIDATES[logicalName] || [logicalName];
  for (const cand of candidates) {
    const found = wb.SheetNames.find(n => norm(n) === norm(cand)) || wb.SheetNames.find(n => norm(n).includes(norm(cand)));
    if (found) return XLSX.utils.sheet_to_json(wb.Sheets[found], { header: 1, raw: true, defval: '' });
  }
  return null;
}

function parseFullWorkbook(wb, filenameDate, filePath) {
  const tongQuanMatrix = sheetToMatrix(wb, 'tongquan') || [];
  const top10Matrix = sheetToMatrix(wb, 'top10') || [];
  const socialMatrix = sheetToMatrix(wb, 'social') || [];
  const alertMatrix = sheetToMatrix(wb, 'alerts') || [];
  const logMatrix = sheetToMatrix(wb, 'log') || [];

  const pairs = harvestLabelValuePairs(tongQuanMatrix);
  const date = extractDateFromTongQuan(pairs, filenameDate);

  const sources = parseTop10Sheet(top10Matrix, date);
  const social = parseSocialSheet(socialMatrix, date);
  const { alerts, statusLine } = parseAlertsSheet(alertMatrix, date);
  const activityLog = parseActivityLogSheet(logMatrix, date);

  const day = computeDayFields({ pairs, sources, alerts, statusLine, date });

  return { file: path.basename(filePath), day, sources, social, alerts, activityLog };
}

// ---------------------------------------------------------------------------
// flat CSV exports — two different shapes have been seen in the real files:
//  (a) simple one-row-per-source table (columns NGAY_BAO_CAO/NGUON/LINK/...)
//  (b) a "multi-section" export that flattens all 4-5 sheets into one CSV,
//      each section introduced by a title row (THONG TIN BAO CAO / KPI TONG
//      QUAN / TOP KET QUA GOOGLE / MANG XA HOI / CANH BAO...).
// Both are only used when no authoritative .xlsx exists for that date.
// ---------------------------------------------------------------------------

const SECTION_MARKERS = {
  tongquan: ['thong tin bao cao', 'kpi tong quan'],
  top10: ['top ket qua google', 'top10 google', 'top ket qua tim kiem'],
  social: ['mang xa hoi', 'tin hieu mang xa hoi'],
  alerts: ['canh bao', 'phat hien noi dung tieu cuc'],
};

/** Split a flattened multi-section CSV matrix into per-section row slices. Returns null if no section markers are found (i.e. this is the simple flat-table shape instead). */
function splitMultiSectionCsv(matrix) {
  const markers = [];
  for (let i = 0; i < matrix.length; i++) {
    const row = matrix[i] || [];
    const firstCell = norm(row[0]);
    if (!firstCell) continue;
    for (const [section, syns] of Object.entries(SECTION_MARKERS)) {
      if (syns.some(s => firstCell.includes(s))) { markers.push({ section, start: i }); break; }
    }
  }
  if (markers.length === 0) return null;
  const sections = {};
  for (let i = 0; i < markers.length; i++) {
    const { section, start } = markers[i];
    const end = i + 1 < markers.length ? markers[i + 1].start : matrix.length;
    (sections[section] ||= []).push(...matrix.slice(start + 1, end)); // skip the marker row itself
  }
  return sections;
}

function parseMultiSectionCsv(sections, filenameDate, filePath) {
  const pairs = harvestLabelValuePairs(sections.tongquan || []);
  const date = extractDateFromTongQuan(pairs, filenameDate);
  const sources = parseTop10Sheet(sections.top10 || [], date);
  const social = parseSocialSheet(sections.social || [], date);
  const { alerts, statusLine } = parseAlertsSheet(sections.alerts || [], date);
  const day = computeDayFields({ pairs, sources, alerts, statusLine, date });
  return {
    file: path.basename(filePath), day, sources, social, alerts, activityLog: [],
  };
}

// Simple flat table: columns NGAY_BAO_CAO, NGUON, LINK, LOAI, DANH_GIA, MOI.
const CSV_FIELDS = {
  date: ['ngay bao cao', 'ngay'],
  title: ['nguon'],
  url: ['link', 'url'],
  type: ['loai'],
  sentiment: ['danh gia'],
  isNew: ['moi'],
};

function parseSimpleFlatCsv(matrix, filenameDate, filePath) {
  const header = detectHeader(matrix, CSV_FIELDS, { minMatches: 3, scanRows: 3 });
  if (!header) throw new Error(`Could not detect columns in flat CSV: ${filePath}`);
  const rows = readDataRows(matrix, header.rowIdx + 1, header.colIndex, ['title', 'url']);

  let date = filenameDate;
  const sources = rows.map(row => {
    const rowDateRaw = cellStr(getCol(row, header.colIndex.date));
    const m = rowDateRaw.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (m && !date) date = `${m[1]}-${m[2]}-${m[3]}`;
    const url = cellStr(getCol(row, header.colIndex.url));
    return {
      date: (m ? `${m[1]}-${m[2]}-${m[3]}` : date),
      title: cellStr(getCol(row, header.colIndex.title)),
      url,
      domain: domainFromUrl(url),
      type: cellStr(getCol(row, header.colIndex.type)),
      sentiment: normalizeSentiment(getCol(row, header.colIndex.sentiment)),
      isNew: isTruthyFlag(getCol(row, header.colIndex.isNew)),
    };
  }).filter(s => s.title || s.url);

  const positive = sources.filter(s => s.sentiment === 'positive').length;
  const neutral = sources.filter(s => s.sentiment === 'neutral').length;
  const negative = sources.filter(s => s.sentiment === 'negative').length;
  const newSources = sources.filter(s => s.isNew).length;
  const total = sources.length;
  const riskRaw = negative > 0 ? 'ĐỎ (suy ra từ CSV rút gọn — chưa có bảng cảnh báo đầy đủ)' : 'XANH - AN TOÀN (suy ra từ CSV rút gọn)';

  return {
    file: path.basename(filePath),
    day: {
      date, total, positive, neutral, negative, newSources,
      riskRaw, riskLevel: classifyRiskLevel(riskRaw),
      riskNote: 'Nguồn dữ liệu là bản CSV rút gọn (không có sheet Cảnh Báo/Nhật Ký đầy đủ) — nên ưu tiên nạp lại từ file .xlsx đầy đủ cùng ngày nếu có.',
    },
    sources,
    social: [],
    alerts: [],
    activityLog: [],
  };
}

function parseCsv(wb, filenameDate, filePath) {
  const matrix = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '' });
  const sections = splitMultiSectionCsv(matrix);
  if (sections) return parseMultiSectionCsv(sections, filenameDate, filePath);
  return parseSimpleFlatCsv(matrix, filenameDate, filePath);
}
