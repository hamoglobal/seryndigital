// lib/exportPdf.js
// Client-side PDF export ("Xuất file PDF" buttons) with a preview step before
// download: each build*Pdf() function renders a branded jsPDF document and
// pdfToPreviewUrl() turns it into a blob: URL for an <iframe> preview;
// downloadPdf() triggers the actual save once the user confirms. jsPDF is
// dynamically imported so it's only pulled into the bundle when someone
// actually opens a PDF, not on initial page load.
//
// Every report shares one branded letterhead template (Seryn logo + navy
// header band + coral accent + footer) via drawFirstPageHeader/
// drawContinuationHeader/finalizeFooters below:
//   - buildListPdf(...)      simple itemized list (per-category source /
//                             channel / competitor-brand exports)
//   - buildOverviewPdf(...)  full "báo cáo tổng thể" — KPI summary,
//                             sentiment breakdown, tables and lists in one
//                             polished multi-section report
//
// Font note: jsPDF's built-in "helvetica" is a base-14 Latin font with no
// Vietnamese glyphs (ă, đ, ơ, ư, and all the tone-marked vowels), so any
// Vietnamese text rendered with it shows up broken/garbled. We embed Roboto
// (public/fonts/Roboto-*.ttf, full Vietnamese coverage) into every doc and
// use it for all text instead.

const FONT_NAME = 'Roboto';
let fontDataPromise = null;
let logoDataPromise = null;

function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

// Fetches + base64-encodes the Vietnamese-capable font once per session and
// caches the result, since every PDF build otherwise re-fetches the same
// ~170KB files.
function getFontData() {
  if (!fontDataPromise) {
    fontDataPromise = Promise.all([
      fetch('/fonts/Roboto-Regular.ttf').then(r => r.arrayBuffer()),
      fetch('/fonts/Roboto-Bold.ttf').then(r => r.arrayBuffer()),
    ]).then(([regular, bold]) => ({
      regular: arrayBufferToBase64(regular),
      bold: arrayBufferToBase64(bold),
    }));
  }
  return fontDataPromise;
}

// Cropped letterhead logo (public/assets/logo-seryn-pdf.png, 368×324 —
// cropped from the source logo-seryn.png's transparent content bbox so it
// sits tight against the header instead of floating in a lot of padding).
const LOGO_RATIO = 368 / 324;
function getLogoData() {
  if (!logoDataPromise) {
    logoDataPromise = fetch('/assets/logo-seryn-pdf.png')
      .then(r => r.arrayBuffer())
      .then(buf => ({ base64: arrayBufferToBase64(buf), ratio: LOGO_RATIO }))
      .catch(() => ({ base64: null, ratio: LOGO_RATIO }));
  }
  return logoDataPromise;
}

// ---- Seryn brand palette (kept in sync with app/globals.css tokens) ----
const COLOR = {
  navy: [27, 35, 80],           // --seryn-navy
  navySoft: [233, 234, 241],    // --seryn-navy-soft
  coral: [240, 130, 107],       // --coral-600 / --text-brand
  coralStrong: [217, 105, 79],  // --brand-strong
  coralSoft: [252, 228, 220],   // --coral-100
  gold: [194, 154, 87],         // --gold-600
  goldSoft: [251, 241, 223],    // --gold-100
  success: [76, 154, 110],      // --success-500
  successSoft: [227, 242, 233], // --success-100
  danger: [210, 85, 63],        // --danger-500
  dangerSoft: [251, 228, 223],  // --danger-100
  body: [46, 38, 34],           // --text-body
  muted: [122, 111, 104],       // --text-muted
  subtle: [167, 156, 147],      // --text-subtle
  borderSubtle: [236, 227, 218],
  ivory: [251, 246, 241],       // --ivory-100
  white: [255, 255, 255],
};
const TONE_COLOR = { success: COLOR.success, warning: COLOR.gold, danger: COLOR.danger, brand: COLOR.coral, navy: COLOR.navy };
const TONE_SOFT = { success: COLOR.successSoft, warning: COLOR.goldSoft, danger: COLOR.dangerSoft, brand: COLOR.coralSoft, navy: COLOR.navySoft };

const PAGE_W = 595.28; // A4, pt
const PAGE_H = 841.89;
const MARGIN_X = 40;
const CONTENT_W = PAGE_W - MARGIN_X * 2;
const FOOTER_ZONE = 46;

function setFill(doc, c) { doc.setFillColor(c[0], c[1], c[2]); }
function setText(doc, c) { doc.setTextColor(c[0], c[1], c[2]); }
function setDraw(doc, c) { doc.setDrawColor(c[0], c[1], c[2]); }

function fmtNowVN() {
  try {
    return new Intl.DateTimeFormat('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    }).format(new Date());
  } catch (e) {
    return new Date().toLocaleString('vi-VN');
  }
}

async function setupDoc() {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const [{ regular, bold }, logo] = await Promise.all([getFontData(), getLogoData()]);
  doc.addFileToVFS('Roboto-Regular.ttf', regular);
  doc.addFont('Roboto-Regular.ttf', FONT_NAME, 'normal');
  doc.addFileToVFS('Roboto-Bold.ttf', bold);
  doc.addFont('Roboto-Bold.ttf', FONT_NAME, 'bold');
  doc.setFont(FONT_NAME, 'normal');
  setText(doc, COLOR.body);
  return { doc, logo };
}

/** Draws the tall letterhead band used at the top of page 1. Returns the y just below the band. */
function drawFirstPageHeader(doc, logo, { eyebrow, title, subtitle, meta }) {
  const bandH = 104;
  setFill(doc, COLOR.navy);
  doc.rect(0, 0, PAGE_W, bandH, 'F');
  setFill(doc, COLOR.coral);
  doc.rect(0, bandH, PAGE_W, 3, 'F');

  const logoH = 42;
  const logoW = logo.base64 ? logoH * logo.ratio : 0;
  if (logo.base64) {
    try { doc.addImage(logo.base64, 'PNG', MARGIN_X, (bandH - logoH) / 2, logoW, logoH); } catch (e) { /* non-fatal */ }
  }

  const textRight = PAGE_W - MARGIN_X;
  const textMaxWidth = PAGE_W - MARGIN_X - (MARGIN_X + logoW + 20);
  let ty = 28;
  if (eyebrow) {
    setText(doc, COLOR.coralSoft);
    doc.setFont(FONT_NAME, 'bold');
    doc.setFontSize(8.5);
    doc.text(eyebrow.toUpperCase(), textRight, ty, { align: 'right' });
    ty += 14;
  }
  setText(doc, COLOR.white);
  doc.setFont(FONT_NAME, 'bold');
  doc.setFontSize(15);
  const titleLines = doc.splitTextToSize(title || 'Báo cáo', textMaxWidth).slice(0, 2);
  doc.text(titleLines, textRight, ty, { align: 'right' });
  ty += titleLines.length * 17;
  doc.setFont(FONT_NAME, 'normal');
  doc.setFontSize(9);
  setText(doc, [205, 208, 227]);
  if (subtitle) {
    const subLines = doc.splitTextToSize(subtitle, textMaxWidth).slice(0, 1);
    doc.text(subLines, textRight, ty, { align: 'right' });
    ty += 12.5;
  }
  if (meta) {
    doc.setFontSize(8);
    doc.text(meta, textRight, ty, { align: 'right' });
  }
  setText(doc, COLOR.body);
  return bandH + 3;
}

/** Smaller running header repeated on continuation pages. Returns the y just below the band. */
function drawContinuationHeader(doc, logo, runningTitle) {
  const bandH = 36;
  setFill(doc, COLOR.navySoft);
  doc.rect(0, 0, PAGE_W, bandH, 'F');
  const logoH = 16;
  const logoW = logo.base64 ? logoH * logo.ratio : 0;
  if (logo.base64) {
    try { doc.addImage(logo.base64, 'PNG', MARGIN_X, (bandH - logoH) / 2, logoW, logoH); } catch (e) { /* non-fatal */ }
  }
  setText(doc, COLOR.navy);
  doc.setFont(FONT_NAME, 'bold');
  doc.setFontSize(9);
  const lines = doc.splitTextToSize(runningTitle || 'Báo cáo', CONTENT_W - logoW - 20).slice(0, 1);
  doc.text(lines, PAGE_W - MARGIN_X, bandH / 2 + 3.5, { align: 'right' });
  setFill(doc, COLOR.coral);
  doc.rect(0, bandH, PAGE_W, 1.5, 'F');
  setText(doc, COLOR.body);
  return bandH + 1.5;
}

/** Adds the "Phòng khám đa khoa Seryn · nội bộ / trang x/y" footer to every page already in the doc. Call once, after all content is drawn. */
function finalizeFooters(doc) {
  const pageCount = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    const y = PAGE_H - 26;
    setDraw(doc, COLOR.borderSubtle);
    doc.setLineWidth(0.75);
    doc.line(MARGIN_X, y, PAGE_W - MARGIN_X, y);
    setText(doc, COLOR.subtle);
    doc.setFont(FONT_NAME, 'normal');
    doc.setFontSize(7.5);
    doc.text('Phòng khám đa khoa Seryn · Báo cáo giám sát thương hiệu · Nội bộ, bảo mật', MARGIN_X, y + 12);
    doc.text(`Trang ${i}/${pageCount}`, PAGE_W - MARGIN_X, y + 12, { align: 'right' });
  }
}

/** Tracks the write cursor and inserts a continuation-page header whenever content would overflow. */
function makeLayout(doc, logo, runningTitle) {
  let y = 0;
  return {
    setY(v) { y = v; },
    getY() { return y; },
    advance(dy) { y += dy; },
    ensure(needed) {
      if (y + needed > PAGE_H - FOOTER_ZONE) {
        doc.addPage();
        y = drawContinuationHeader(doc, logo, runningTitle) + 20;
      }
    },
  };
}

function sectionHeading(doc, layout, text, rightNote) {
  layout.ensure(28);
  const y = layout.getY();
  setFill(doc, COLOR.coral);
  doc.rect(MARGIN_X, y - 9, 3, 13, 'F');
  setText(doc, COLOR.navy);
  doc.setFont(FONT_NAME, 'bold');
  doc.setFontSize(12.5);
  doc.text(text, MARGIN_X + 10, y);
  if (rightNote) {
    setText(doc, COLOR.subtle);
    doc.setFont(FONT_NAME, 'normal');
    doc.setFontSize(8.5);
    const lines = doc.splitTextToSize(rightNote, 240).slice(0, 1);
    doc.text(lines, PAGE_W - MARGIN_X, y, { align: 'right' });
  }
  setText(doc, COLOR.body);
  layout.advance(16);
}

/** Grid of stat tiles (KPIs), wrapping to a new row every `perRow` tiles. */
function kpiGrid(doc, layout, kpis, perRow = 3) {
  const gap = 10;
  for (let start = 0; start < kpis.length; start += perRow) {
    const rowKpis = kpis.slice(start, start + perRow);
    const boxH = 62;
    layout.ensure(boxH + 10);
    const y = layout.getY();
    const boxW = (CONTENT_W - gap * (rowKpis.length - 1)) / rowKpis.length;
    rowKpis.forEach((k, i) => {
      const x = MARGIN_X + i * (boxW + gap);
      setFill(doc, k.soft || COLOR.ivory);
      doc.roundedRect(x, y, boxW, boxH, 5, 5, 'F');
      setText(doc, COLOR.muted);
      doc.setFont(FONT_NAME, 'bold');
      doc.setFontSize(6.6);
      const labelLines = doc.splitTextToSize((k.label || '').toUpperCase(), boxW - 16).slice(0, 1);
      doc.text(labelLines, x + 10, y + 15);
      setText(doc, k.color || COLOR.navy);
      doc.setFont(FONT_NAME, 'bold');
      doc.setFontSize(16.5);
      const valueLines = doc.splitTextToSize(String(k.value), boxW - 16).slice(0, 1);
      doc.text(valueLines, x + 10, y + 35);
      if (k.foot) {
        setText(doc, COLOR.subtle);
        doc.setFont(FONT_NAME, 'normal');
        doc.setFontSize(6.8);
        const footLines = doc.splitTextToSize(k.foot, boxW - 16).slice(0, 2);
        doc.text(footLines, x + 10, y + 47);
      }
    });
    layout.advance(boxH + 14);
  }
  setText(doc, COLOR.body);
}

/** Stacked horizontal sentiment bar (positive / neutral / negative) with a legend underneath. */
function sentimentBar(doc, layout, { positive = 0, neutral = 0, negative = 0 }) {
  const total = Math.max(positive + neutral + negative, 1);
  const barH = 14;
  layout.ensure(barH + 30);
  const y = layout.getY();
  let x = MARGIN_X;
  setFill(doc, COLOR.borderSubtle);
  doc.roundedRect(MARGIN_X, y, CONTENT_W, barH, 3, 3, 'F');
  const segs = [
    { v: positive, c: COLOR.success },
    { v: neutral, c: COLOR.gold },
    { v: negative, c: COLOR.danger },
  ];
  segs.forEach(s => {
    const segW = (s.v / total) * CONTENT_W;
    if (segW > 0.4) {
      setFill(doc, s.c);
      doc.rect(x, y, segW, barH, 'F');
      x += segW;
    }
  });
  layout.advance(barH + 16);
  const legendY = layout.getY();
  const legend = [
    { label: `Tích cực  ${positive}`, c: COLOR.success },
    { label: `Trung tính  ${neutral}`, c: COLOR.gold },
    { label: `Tiêu cực  ${negative}`, c: COLOR.danger },
  ];
  let lx = MARGIN_X;
  doc.setFont(FONT_NAME, 'normal');
  doc.setFontSize(8.5);
  legend.forEach(l => {
    setFill(doc, l.c);
    doc.circle(lx + 3, legendY - 3, 3, 'F');
    setText(doc, COLOR.body);
    doc.text(l.label, lx + 11, legendY);
    lx += doc.getTextWidth(l.label) + 36;
  });
  setText(doc, COLOR.body);
  layout.advance(18);
}

/** Simple striped table. columns: [{ key, label, width (0–1 fraction of content width), align, bold, colorFn(row) }] */
function table(doc, layout, { columns, rows, emptyLabel }) {
  const rowH = 20;
  const headH = 21;
  layout.ensure(headH + rowH);
  let y = layout.getY();
  setFill(doc, COLOR.navySoft);
  doc.rect(MARGIN_X, y, CONTENT_W, headH, 'F');
  setText(doc, COLOR.navy);
  doc.setFont(FONT_NAME, 'bold');
  doc.setFontSize(7.5);
  let cx = MARGIN_X;
  columns.forEach(col => {
    const w = col.width * CONTENT_W;
    const tx = col.align === 'right' ? cx + w - 8 : cx + 8;
    doc.text(col.label.toUpperCase(), tx, y + 14, { align: col.align === 'right' ? 'right' : 'left' });
    cx += w;
  });
  layout.setY(y + headH);

  if (!rows || rows.length === 0) {
    layout.ensure(rowH);
    y = layout.getY();
    setText(doc, COLOR.subtle);
    doc.setFont(FONT_NAME, 'normal');
    doc.setFontSize(8.5);
    doc.text(emptyLabel || 'Không có dữ liệu.', MARGIN_X + 8, y + 13);
    layout.advance(rowH + 6);
    setText(doc, COLOR.body);
    return;
  }

  rows.forEach((row, i) => {
    layout.ensure(rowH);
    y = layout.getY();
    if (i % 2 === 1) {
      setFill(doc, COLOR.ivory);
      doc.rect(MARGIN_X, y, CONTENT_W, rowH, 'F');
    }
    let cx2 = MARGIN_X;
    columns.forEach(col => {
      const w = col.width * CONTENT_W;
      const val = row[col.key];
      setText(doc, col.colorFn ? col.colorFn(row) : COLOR.body);
      doc.setFont(FONT_NAME, col.bold ? 'bold' : 'normal');
      doc.setFontSize(8.3);
      const tx = col.align === 'right' ? cx2 + w - 8 : cx2 + 8;
      const lines = doc.splitTextToSize(val == null ? '' : String(val), w - 16).slice(0, 1);
      doc.text(lines, tx, y + 13.5, { align: col.align === 'right' ? 'right' : 'left' });
      cx2 += w;
    });
    setDraw(doc, COLOR.borderSubtle);
    doc.setLineWidth(0.5);
    doc.line(MARGIN_X, y + rowH, MARGIN_X + CONTENT_W, y + rowH);
    layout.advance(rowH);
  });
  setText(doc, COLOR.body);
  layout.advance(8);
}

/** Numbered / dotted item list — headline + a couple of muted meta lines each, with a divider. */
function itemList(doc, layout, items, { numbered = true, emptyLabel } = {}) {
  if (!items || items.length === 0) {
    layout.ensure(20);
    setText(doc, COLOR.subtle);
    doc.setFont(FONT_NAME, 'normal');
    doc.setFontSize(9);
    doc.text(emptyLabel || 'Không có mục nào.', MARGIN_X, layout.getY());
    layout.advance(20);
    setText(doc, COLOR.body);
    return;
  }

  items.forEach((item, i) => {
    const xOff = MARGIN_X + (item.dotColor ? 13 : 0);
    const maxW = CONTENT_W - (item.dotColor ? 13 : 0);
    const headingText = `${numbered ? (i + 1) + '. ' : ''}${item.heading || '(không có tiêu đề)'}`;
    const headingLines = doc.splitTextToSize(headingText, maxW);
    const lineBlocks = (item.lines || []).filter(Boolean).map(l => doc.splitTextToSize(l, maxW));
    const neededHeight = headingLines.length * 12.5 + lineBlocks.reduce((s, b) => s + b.length * 10.5, 0) + 14;
    layout.ensure(neededHeight);
    let y = layout.getY();

    if (item.dotColor) {
      setFill(doc, item.dotColor);
      doc.circle(MARGIN_X + 3, y - 3, 3, 'F');
    }
    setText(doc, COLOR.navy);
    doc.setFont(FONT_NAME, 'bold');
    doc.setFontSize(9.5);
    doc.text(headingLines, xOff, y);
    y += headingLines.length * 12.5;

    doc.setFont(FONT_NAME, 'normal');
    doc.setFontSize(8.3);
    setText(doc, COLOR.muted);
    lineBlocks.forEach(block => {
      doc.text(block, xOff, y);
      y += block.length * 10.5;
    });

    setDraw(doc, COLOR.borderSubtle);
    doc.setLineWidth(0.4);
    doc.line(MARGIN_X, y + 3, PAGE_W - MARGIN_X, y + 3);
    layout.setY(y + 12);
  });
  setText(doc, COLOR.body);
}

// ---------------------------------------------------------------------------
// Public builders
// ---------------------------------------------------------------------------

/** Simple branded itemized-list report (per-category source / channel / competitor-brand exports). */
export async function buildListPdf({ title, subtitle, items, eyebrow }) {
  const { doc, logo } = await setupDoc();
  const runningTitle = title || 'Danh sách';
  const layout = makeLayout(doc, logo, runningTitle);

  const headerBottom = drawFirstPageHeader(doc, logo, {
    eyebrow: eyebrow || 'Seryn Clinic · Báo cáo giám sát',
    title: runningTitle,
    subtitle,
    meta: `Xuất lúc ${fmtNowVN()}`,
  });
  layout.setY(headerBottom + 28);

  itemList(doc, layout, items, { numbered: true, emptyLabel: 'Không có mục nào để xuất.' });

  finalizeFooters(doc);
  return doc;
}

/**
 * Full "báo cáo tổng thể" — polished multi-section overview report.
 * data: {
 *   eyebrow, title, subtitle, generatedLabel,
 *   kpis: [{ label, value, tone: 'success'|'warning'|'danger'|'brand'|'navy', foot }],
 *   sentiment: { positive, neutral, negative },
 *   sections: [
 *     { type: 'table', heading, rightNote, columns, rows, emptyLabel } |
 *     { type: 'list',  heading, rightNote, items, numbered, emptyLabel } |
 *     { type: 'note',  heading, text }
 *   ],
 * }
 */
export async function buildOverviewPdf(data) {
  const { doc, logo } = await setupDoc();
  const runningTitle = data.title || 'Báo cáo tổng thể';
  const layout = makeLayout(doc, logo, runningTitle);

  const headerBottom = drawFirstPageHeader(doc, logo, {
    eyebrow: data.eyebrow || 'Seryn Clinic · Báo cáo giám sát thương hiệu',
    title: runningTitle,
    subtitle: data.subtitle,
    meta: data.generatedLabel || `Xuất lúc ${fmtNowVN()}`,
  });
  layout.setY(headerBottom + 24);

  if (data.kpis && data.kpis.length) {
    const kpis = data.kpis.map(k => ({ ...k, color: TONE_COLOR[k.tone] || COLOR.navy, soft: TONE_SOFT[k.tone] || COLOR.ivory }));
    kpiGrid(doc, layout, kpis, 3);
  }

  if (data.sentiment) {
    sectionHeading(doc, layout, 'Tỷ trọng cảm xúc nguồn tin');
    sentimentBar(doc, layout, data.sentiment);
  }

  (data.sections || []).forEach(sec => {
    sectionHeading(doc, layout, sec.heading, sec.rightNote);
    if (sec.type === 'table') {
      table(doc, layout, { columns: sec.columns, rows: sec.rows, emptyLabel: sec.emptyLabel });
    } else if (sec.type === 'list') {
      itemList(doc, layout, sec.items, { numbered: sec.numbered !== false, emptyLabel: sec.emptyLabel });
    } else if (sec.type === 'note') {
      layout.ensure(24);
      setText(doc, COLOR.muted);
      doc.setFont(FONT_NAME, 'normal');
      doc.setFontSize(9);
      const lines = doc.splitTextToSize(sec.text || '', CONTENT_W);
      doc.text(lines, MARGIN_X, layout.getY());
      layout.advance(lines.length * 12 + 8);
      setText(doc, COLOR.body);
    }
    layout.advance(6);
  });

  finalizeFooters(doc);
  return doc;
}

/**
 * "Khuyến nghị Seryn" advisory report — a verdict ("đã đi đúng hướng chưa?",
 * computed by comparing the selected period to the prior period of the same
 * granularity) plus a mode-appropriate recommendation list (see
 * lib/recommendations.js for how `data.verdict*`/`data.items` are built from
 * live dashboard + competitor data, driven by the dashboard's own Ngày/Tuần/
 * Tháng/Năm period switcher).
 * data: {
 *   eyebrow, title, subtitle, generatedLabel, filename,
 *   verdictLabel, verdictTone: 'success'|'warning'|'danger'|'brand'|'navy',
 *   reasoning: string,
 *   itemsSectionTitle: string,
 *   items: [{ title, detail, tag, tone }],
 * }
 */
export async function buildRecommendationsPdf(data) {
  const { doc, logo } = await setupDoc();
  const runningTitle = data.title || 'Khuyến nghị Seryn';
  const layout = makeLayout(doc, logo, runningTitle);

  const headerBottom = drawFirstPageHeader(doc, logo, {
    eyebrow: data.eyebrow || 'Seryn Clinic · Cố vấn Marketing',
    title: runningTitle,
    subtitle: data.subtitle,
    meta: data.generatedLabel || `Xuất lúc ${fmtNowVN()}`,
  });
  layout.setY(headerBottom + 24);

  if (data.verdictLabel) {
    layout.ensure(30);
    const y = layout.getY();
    const badgeColor = TONE_COLOR[data.verdictTone] || COLOR.navy;
    const badgeSoft = TONE_SOFT[data.verdictTone] || COLOR.ivory;
    const label = data.verdictLabel.toUpperCase();
    doc.setFont(FONT_NAME, 'bold');
    doc.setFontSize(9);
    const boxW = doc.getTextWidth(label) + 24;
    setFill(doc, badgeSoft);
    doc.roundedRect(MARGIN_X, y - 12, boxW, 20, 10, 10, 'F');
    setText(doc, badgeColor);
    doc.text(label, MARGIN_X + 12, y + 2);
    setText(doc, COLOR.body);
    layout.advance(26);
  }

  if (data.reasoning) {
    layout.ensure(24);
    doc.setFont(FONT_NAME, 'normal');
    doc.setFontSize(9.5);
    setText(doc, COLOR.muted);
    const lines = doc.splitTextToSize(data.reasoning, CONTENT_W);
    doc.text(lines, MARGIN_X, layout.getY());
    layout.advance(lines.length * 13 + 10);
    setText(doc, COLOR.body);
  }

  const items = data.items || [];
  sectionHeading(doc, layout, data.itemsSectionTitle || 'Khuyến nghị', `${items.length} khuyến nghị`);
  itemList(doc, layout, items.map(it => ({
    heading: it.title,
    lines: [it.tag, it.detail].filter(Boolean),
    dotColor: TONE_COLOR[it.tone] || COLOR.navy,
  })), { numbered: true, emptyLabel: 'Không có khuyến nghị nào cho kỳ này.' });

  finalizeFooters(doc);
  return doc;
}

/** Maps a dashboard sentiment label ('positive'|'neutral'|'negative') to the matching brand RGB, for item dotColor. */
export function sentimentRgb(sentiment) {
  if (sentiment === 'negative') return TONE_COLOR.danger;
  if (sentiment === 'neutral') return TONE_COLOR.warning;
  return TONE_COLOR.success;
}

/** Maps a risk level ('red'|'yellow'|'green') to the matching brand tone name, for kpi/section tone props. */
export function riskTone(level) {
  if (level === 'red') return 'danger';
  if (level === 'yellow') return 'warning';
  return 'success';
}

/** Resolves a tone name ('success'|'warning'|'danger'|'brand'|'navy') to its brand RGB — for table column colorFn callbacks. */
export function toneRgb(tone) {
  return TONE_COLOR[tone] || COLOR.body;
}

/** Turn a built jsPDF doc into a blob: URL suitable for an <iframe>/<embed> preview. Caller must revokePdfPreviewUrl() when done. */
export function pdfToPreviewUrl(doc) {
  const blob = doc.output('blob');
  return URL.createObjectURL(blob);
}

export function revokePdfPreviewUrl(url) {
  if (url) URL.revokeObjectURL(url);
}

export function downloadPdf(doc, filename) {
  doc.save(filename || 'export.pdf');
}
