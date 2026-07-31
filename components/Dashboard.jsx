'use client';

// Dashboard.jsx — Seryn Digital brand-monitoring dashboard.
// Ported layout/interaction 1:1 from the design prototype
// (design_handoff_seryn_digital_dashboard/design_reference/Seryn Digital.dc.html),
// now fetching from /api/days, /api/sources, /api/latest instead of importing a
// static data/seryn-data.js file. See lib/aggregate.js for the ported logic.

import { useEffect, useState } from 'react';
import Card from './Card';
import Badge from './Badge';
import {
  fmtDateLabel, fmtDateFull, buildBuckets, sourcesForBucket, dedupedSourcesForBucket, dedupeSources, typeStats,
  colorForRisk, softBgForRisk, borderForRisk, labelForRisk, cap, canonicalizeSourceType,
} from '@/lib/aggregate';
import {
  buildListPdf, buildOverviewPdf, buildRecommendationsPdf, pdfToPreviewUrl, revokePdfPreviewUrl, sentimentRgb, riskTone,
} from '@/lib/exportPdf';
import { buildSerynRecommendations } from '@/lib/recommendations';
import PdfPreviewModal from './PdfPreviewModal';
import RecommendationsModal from './RecommendationsModal';
import TopNav from './TopNav';

const VIEW_MODES = ['day', 'week', 'month', 'year'];
const MODE_NOUN = { day: 'ngày', week: 'tuần', month: 'tháng', year: 'năm' };
const MODAL_CAP = 150;
const CATEGORY_LABELS = {
  total: 'Tổng nguồn', positive: 'Nguồn tích cực', neutral: 'Nguồn trung tính',
  negative: 'Nguồn tiêu cực / cảnh báo', new: 'Nguồn mới', unclassified: 'Nguồn chưa phân loại',
};

function sentimentDotColor(sentiment) {
  if (sentiment === 'negative') return 'var(--danger-500)';
  if (sentiment === 'neutral') return 'var(--gold-600)';
  // Rows the parser couldn't classify (missing/undetected "Đánh giá" column
  // on that report date — see 'unclassified' in lib/aggregate.js) aren't
  // positive; falling through to the success-green default would visually
  // mislabel them, so call them out with a neutral grey dot instead.
  if (!sentiment || sentiment === 'unknown') return 'var(--text-muted)';
  return 'var(--success-500)';
}
function rawSentimentDotColor(rawLabel) {
  const n = (rawLabel || '').toLowerCase();
  if (n.includes('tieu') || n.includes('tiêu')) return 'var(--danger-500)';
  if (n.includes('trung')) return 'var(--gold-600)';
  return 'var(--success-500)';
}

// Fixed, on-brand palette for "Thống kê theo loại nguồn" — one distinct hue
// per tag. canonicalizeSourceType() only ever returns one of a known, small,
// fixed set of Vietnamese category labels (see TYPE_CATEGORY_RULES in
// lib/aggregate.js) plus 'Khác'/'Chưa phân loại', so those are mapped to
// colors directly — guarantees no two *simultaneously visible* tags collide.
// Anything outside that known set (shouldn't happen, but defensive) falls
// back to a hash of the label into the same palette.
const TAG_COLOR_PALETTE = [
  '#F0826B', '#1B2350', '#4C9A6E', '#C29A57', '#4472CA',
  '#B85C9E', '#2FA8A0', '#D2553F', '#8C5E3C', '#7A6FE0',
];
const TAG_LABEL_COLORS = {
  'Báo chí / PR': '#F0826B',
  'Website chính thức': '#4472CA',
  'Mạng xã hội': '#1B2350',
  'Y tế / Dược phẩm': '#4C9A6E',
  'Rủi ro / Rà soát': '#D2553F',
  'Directory / Hồ sơ / Tuyển dụng': '#C29A57',
  'Không liên quan / Nhầm thương hiệu': '#8C5E3C',
  'Chưa phân loại': '#7A6FE0',
  'Khác': '#2FA8A0',
};
function hashToIndex(str, mod) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h % mod;
}
function colorForTag(label) {
  return TAG_LABEL_COLORS[label] || TAG_COLOR_PALETTE[hashToIndex(label || '', TAG_COLOR_PALETTE.length)];
}
function slugifyTag(label) {
  return (label || 'khac')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || 'khac';
}

export default function Dashboard() {
  const [days, setDays] = useState(null);
  const [latest, setLatest] = useState(null);
  const [sourcesByDay, setSourcesByDay] = useState(null);
  const [loadError, setLoadError] = useState(null);

  const [viewMode, setViewMode] = useState('day');
  const [selectedKey, setSelectedKey] = useState(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [modalCategory, setModalCategory] = useState(null);
  const [channelModal, setChannelModal] = useState(null);
  const [tagModal, setTagModal] = useState(null);
  const [riskModalOpen, setRiskModalOpen] = useState(false);
  const [pdfPreview, setPdfPreview] = useState(null); // { url, filename, doc }
  const [competitors, setCompetitors] = useState(null); // { date, brands } from /api/competitors/brands, feeds "Khuyến nghị Seryn"
  const [recoModalOpen, setRecoModalOpen] = useState(false);
  const [recoExporting, setRecoExporting] = useState(false);

  async function openPdfPreview({ title, subtitle, items, filename }) {
    const doc = await buildListPdf({ title, subtitle, items });
    const url = pdfToPreviewUrl(doc);
    setPdfPreview(prev => {
      if (prev) revokePdfPreviewUrl(prev.url);
      return { url, filename, doc };
    });
  }
  function closePdfPreview() {
    setPdfPreview(prev => {
      if (prev) revokePdfPreviewUrl(prev.url);
      return null;
    });
  }
  async function openOverviewPdfPreview(overviewData) {
    const doc = await buildOverviewPdf(overviewData);
    const url = pdfToPreviewUrl(doc);
    setPdfPreview(prev => {
      if (prev) revokePdfPreviewUrl(prev.url);
      return { url, filename: overviewData.filename, doc };
    });
  }
  async function openRecommendationsPdfPreview(pdfData) {
    setRecoExporting(true);
    try {
      const doc = await buildRecommendationsPdf(pdfData);
      const url = pdfToPreviewUrl(doc);
      setPdfPreview(prev => {
        if (prev) revokePdfPreviewUrl(prev.url);
        return { url, filename: pdfData.filename, doc };
      });
    } finally {
      setRecoExporting(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [daysRes, sourcesRes, latestRes] = await Promise.all([
          fetch('/api/days'), fetch('/api/sources'), fetch('/api/latest'),
        ]);
        const [daysJson, sourcesJson, latestJson] = await Promise.all([
          daysRes.json(), sourcesRes.json(), latestRes.ok ? latestRes.json() : null,
        ]);
        if (cancelled) return;
        setDays(daysJson);
        setSourcesByDay(sourcesJson);
        setLatest(latestJson);
      } catch (err) {
        if (!cancelled) setLoadError(err.message || String(err));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Fetches independently of the days/sources/latest load above: "Khuyến nghị
  // Seryn" degrades gracefully (buildSerynRecommendations treats competitors
  // as optional) if the competitor-monitoring feed is unavailable, so a
  // failure here must never block the main dashboard from rendering.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/competitors/brands').then(r => r.json()).then(d => {
      if (!cancelled) setCompetitors(d);
    }).catch(() => { /* non-fatal — recommendations just note competitor data is missing */ });
    return () => { cancelled = true; };
  }, []);

  function setModeAndReset(mode) {
    setViewMode(mode);
    setSelectedKey(null);
    setDropdownOpen(false);
  }

  if (loadError) {
    return (
      <div style={{ padding: 60, textAlign: 'center', fontFamily: 'var(--font-sans)', color: 'var(--danger-500)' }}>
        Không tải được dữ liệu dashboard: {loadError}
      </div>
    );
  }

  if (!days || !latest) {
    return (
      <div style={{ padding: 60, textAlign: 'center', fontFamily: 'var(--font-sans)', color: 'var(--text-muted)' }}>
        Đang tải dữ liệu giám sát…
      </div>
    );
  }

  if (days.length === 0) {
    return (
      <div style={{ padding: 60, textAlign: 'center', fontFamily: 'var(--font-sans)', color: 'var(--text-muted)' }}>
        Chưa có dữ liệu báo cáo nào được nạp. Thả file báo cáo hằng ngày vào thư mục{' '}
        <code>reports/incoming</code> rồi chạy <code>npm run watch-ingest</code>, hoặc chạy{' '}
        <code>npm run seed</code> để nạp dữ liệu mẫu lịch sử.
      </div>
    );
  }

  const lastDay = days[days.length - 1];
  const firstDay = days[0];
  const mode = viewMode;
  const buckets = buildBuckets(days, mode, sourcesByDay);
  const selBucket = (selectedKey && buckets.find(b => b.key === selectedKey)) || buckets[buckets.length - 1];
  // Immediately preceding bucket of the SAME granularity as `mode` (previous
  // day/week/month/year) — feeds "Khuyến nghị Seryn"'s verdict (đã đi đúng
  // hướng chưa?), which compares the selected period against it.
  const selBucketIndex = buckets.findIndex(b => b.key === selBucket.key);
  const prevBucket = selBucketIndex > 0 ? buckets[selBucketIndex - 1] : null;
  const selTotal = selBucket.total || 1;
  const positivePct = Math.round((selBucket.positive / selTotal) * 100);
  const neutralPct = Math.round((selBucket.neutral / selTotal) * 100);
  const modeNoun = MODE_NOUN[mode];
  const selPeriodLabel = mode === 'day' ? 'Google · Báo chí · MXH' : `Gộp ${selBucket.dayCount} ngày trong ${modeNoun}`;
  const selRiskDaysNote = selBucket.negative > 0 ? `Phát hiện trong ${modeNoun} này` : 'Không phát hiện vi phạm';
  const negativeColor = selBucket.negative > 0 ? 'var(--danger-500)' : 'var(--success-500)';

  const periodOptionsList = buckets.slice().reverse();

  // ---- chart geometry (fine-grained fallback when too few buckets) ----
  const W = 1080, H = 220, padTop = 20, padBottom = 20;
  const finerMode = { day: 'day', week: 'day', month: 'week', year: 'month' }[mode];
  let chartBuckets = buildBuckets(days, mode, sourcesByDay);
  let chartMode = mode;
  if (chartBuckets.length < 3 && finerMode !== mode) {
    chartBuckets = buildBuckets(days, finerMode, sourcesByDay);
    chartMode = finerMode;
  }
  chartBuckets = chartBuckets.slice().sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const chartIsFallback = chartMode !== mode;
  const maxVal = Math.max(...chartBuckets.map(b => b.total), 1);
  const scaleY = (v) => padTop + (1 - v / maxVal) * (H - padTop - padBottom);
  const single = chartBuckets.length < 2;
  const scaleX = (i) => (single ? (i === 0 ? 0 : W) : (i / (chartBuckets.length - 1)) * W);
  const lineFor = (getVal) => (single
    ? `0,${scaleY(getVal(chartBuckets[0])).toFixed(1)} ${W},${scaleY(getVal(chartBuckets[0])).toFixed(1)}`
    : chartBuckets.map((b, i) => `${scaleX(i).toFixed(1)},${scaleY(getVal(b)).toFixed(1)}`).join(' '));
  const positiveLine = lineFor(b => b.positive);
  const positiveArea = `0,${H - padBottom} ` + positiveLine + ` ${W},${H - padBottom}`;
  const neutralLine = lineFor(b => b.neutral);
  const negativeLine = lineFor(b => b.negative);
  const chartPoints = chartBuckets.map((b, i) => ({
    cx: scaleX(i).toFixed(1), cy: scaleY(b.positive).toFixed(1),
    title: `${b.label}: ${b.total} nguồn · ${b.positive} tích cực`,
  }));
  const axisLabel = (b) => (chartMode === 'day' ? fmtDateLabel(b.key) : b.label);
  const singleBucket = chartBuckets.length < 2;
  const chartModeNoun = MODE_NOUN[chartMode];
  const chartFallbackNote = chartIsFallback ? `Hiển thị theo ${chartModeNoun} do chỉ có dữ liệu trong một ${modeNoun}` : '';
  const firstDateLabel = chartBuckets.length ? axisLabel(chartBuckets[0]) : '';
  const midDateLabel = (!singleBucket && chartBuckets.length >= 3) ? axisLabel(chartBuckets[Math.floor((chartBuckets.length - 1) / 2)]) : '';
  const lastDateLabel = (!singleBucket && chartBuckets.length >= 2) ? axisLabel(chartBuckets[chartBuckets.length - 1]) : '';

  const topSources = dedupeSources(latest.topSources || []).map(s => ({ ...s, dotColor: sentimentDotColor(s.sentiment) }));

  const channelMap = {};
  (latest.social || []).forEach(s => { const key = s.platform || 'Khác'; channelMap[key] = (channelMap[key] || 0) + 1; });
  const channels = Object.keys(channelMap).map(platform => ({ platform, count: channelMap[platform] }));

  const watchItems = (latest.alerts || []).filter(a => {
    const lvl = (a.level || '').toLowerCase();
    return lvl.includes('vàng') || lvl.includes('vang');
  }).map(a => ({ type: a.type, summary: a.summary }));

  // Deduped once for the selected bucket and reused below for the KPI
  // click-through modal, the tag-stats table, and the tag modal — this is
  // the same resolved list buildBuckets() used to compute selBucket's KPI
  // numbers, so every one of those numbers matches exactly what its modal
  // shows (see dedupedSourcesForBucket in lib/aggregate.js).
  const bucketSourcesDeduped = dedupedSourcesForBucket(sourcesByDay, selBucket);

  // ---- KPI click-through modal ----
  const modalOpen = !!modalCategory;
  let modalItems = [], modalTotalCount = 0;
  if (modalOpen) {
    const raw = sourcesForBucket(bucketSourcesDeduped, modalCategory);
    modalTotalCount = raw.length;
    modalItems = raw.slice(0, MODAL_CAP).map(s => ({ ...s, dotColor: sentimentDotColor(s.sentiment), dateLabel: fmtDateLabel(s.lastDate || s.date) }));
  }
  const modalTruncated = modalTotalCount > MODAL_CAP;
  const modalHiddenCount = modalTotalCount - MODAL_CAP;
  const modalTitle = modalOpen ? `${CATEGORY_LABELS[modalCategory]} — ${selBucket.label}` : '';

  const tagStats = typeStats(bucketSourcesDeduped);

  // ---- "Thống kê theo loại nguồn" row click-through modal ----
  const tagModalOpen = !!tagModal;
  const tagModalItems = tagModalOpen
    ? bucketSourcesDeduped
        .filter(s => canonicalizeSourceType(s.type) === tagModal)
        .map(s => ({ ...s, dotColor: sentimentDotColor(s.sentiment), dateLabel: fmtDateLabel(s.lastDate || s.date) }))
    : [];

  const channelModalOpen = !!channelModal;
  const channelModalItems = channelModalOpen
    ? (latest.social || []).filter(s => s.platform === channelModal).map(s => ({ ...s, dotColor: rawSentimentDotColor(s.sentiment) }))
    : [];

  const rangeLabel = `${fmtDateLabel(firstDay.date)} – ${fmtDateLabel(lastDay.date)}`;
  const latestDateLabel = fmtDateLabel(lastDay.date);
  const latestRiskLabel = labelForRisk(lastDay.riskLevel);
  const latestRiskColor = colorForRisk(lastDay.riskLevel);
  const latestRiskColorSoft = softBgForRisk(lastDay.riskLevel);

  // ---- "Xuất báo cáo tổng thể" — full branded overview PDF for the selected period ----
  const overviewRiskNote = selBucket.riskNote || (selBucket.riskLevel === 'green' ? 'Không phát hiện nội dung tiêu cực' : `${cap(modeNoun)} này có mục cần theo dõi`);
  const overviewReportData = {
    eyebrow: 'AI AUTO RESEARCH',
    title: `Báo cáo tổng thể — ${selBucket.label}`,
    subtitle: `Kỳ báo cáo ${rangeLabel} · Seryn Clinic`,
    generatedLabel: `Xuất ngày ${fmtDateFull(lastDay.date)}`,
    filename: `bao-cao-tong-the-seryn-${selBucket.key}.pdf`,
    kpis: [
      { label: 'Tổng nguồn', value: selBucket.total, tone: 'navy', foot: selPeriodLabel },
      { label: 'Tích cực', value: selBucket.positive, tone: 'success', foot: `${positivePct}% tổng nguồn` },
      { label: 'Trung tính', value: selBucket.neutral, tone: 'warning', foot: `${neutralPct}% tổng nguồn` },
      { label: 'Tiêu cực / cảnh báo', value: selBucket.negative, tone: 'danger', foot: selRiskDaysNote },
      { label: 'Nguồn mới', value: `+${selBucket.newSources}`, tone: 'brand', foot: 'So với kỳ trước' },
      { label: 'Trạng thái rủi ro', value: labelForRisk(selBucket.riskLevel), tone: riskTone(selBucket.riskLevel), foot: overviewRiskNote },
      // Only shown when the period includes report dates whose "Đánh giá"
      // column the parser couldn't detect (see the KPI-row footnote above) —
      // otherwise this would always read 0 and add noise to every PDF.
      ...(selBucket.unclassified > 0
        ? [{ label: 'Chưa phân loại', value: selBucket.unclassified, tone: 'navy', foot: 'Thiếu dữ liệu đánh giá gốc' }]
        : []),
    ],
    sentiment: { positive: selBucket.positive, neutral: selBucket.neutral, negative: selBucket.negative },
    sections: [
      {
        type: 'list', heading: 'Nguồn nổi bật', rightNote: `${topSources.length} kết quả`, numbered: false,
        items: topSources.map(s => ({
          heading: s.title,
          lines: [[s.type, s.isNew ? 'Mới' : null].filter(Boolean).join(' · '), s.url].filter(Boolean),
          dotColor: sentimentRgb(s.sentiment),
        })),
        emptyLabel: 'Không có nguồn nổi bật nào trong kỳ này.',
      },
      {
        type: 'table', heading: 'Kênh hiện diện', rightNote: `${channels.length} kênh`,
        columns: [
          { key: 'platform', label: 'Kênh', width: 0.7 },
          { key: 'count', label: 'Số trang', width: 0.3, align: 'right' },
        ],
        rows: channels,
        emptyLabel: 'Chưa ghi nhận kênh mạng xã hội nào.',
      },
      {
        type: 'list', heading: 'Cần theo dõi', rightNote: `${watchItems.length} mục`, numbered: false,
        items: watchItems.map(w => ({ heading: w.type, lines: [w.summary] })),
        emptyLabel: 'Không có mục nào cần theo dõi.',
      },
      {
        type: 'table', heading: 'Thống kê theo loại nguồn', rightNote: `${tagStats.length} loại · ${bucketSourcesDeduped.length} nguồn duy nhất`,
        columns: [
          { key: 'label', label: 'Loại nguồn / tag', width: 0.5 },
          { key: 'count', label: 'Số nguồn', width: 0.2, align: 'right' },
          { key: 'pct', label: 'Tỷ trọng', width: 0.3, align: 'right' },
        ],
        rows: tagStats.map(t => ({ label: t.label, count: t.count, pct: `${t.pct}%` })),
        emptyLabel: 'Không có dữ liệu thống kê cho kỳ này.',
      },
    ],
  };

  // ---- "Khuyến nghị Seryn" — mode-aware marketing advisory: switching the
  // period switcher (Ngày/Tuần/Tháng/Năm) changes `mode`/`selBucket`/
  // `prevBucket` above, so the verdict + recommendation list here are always
  // computed from whichever granularity is currently selected (see
  // lib/recommendations.js). Pure/cheap, so recomputed on every render
  // rather than cached in state; `competitors` is null until its fetch
  // resolves, which buildSerynRecommendations handles gracefully.
  const recoData = buildSerynRecommendations({
    mode, modeNoun, selBucket, prevBucket, lastDay, days, channels, tagStats, watchItems, competitors,
  });

  return (
    <div style={{ minHeight: '100vh', background: 'radial-gradient(1100px 520px at 12% -8%, var(--coral-100), transparent), var(--bg-page)', fontFamily: 'var(--font-sans)', color: 'var(--text-body)' }}>

      {/* ============ TOP BAR ============ */}
      <TopNav statusSlot={
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-pill)', padding: '7px 16px 7px 7px', boxShadow: 'var(--shadow-sm)' }}>
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: latestRiskColor, boxShadow: `0 0 0 4px ${latestRiskColorSoft}`, animation: 'pulseDot 2.4s var(--ease-in-out) infinite' }} />
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>Cập nhật {latestDateLabel} ·</span>
          <span style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: latestRiskColor }}>{latestRiskLabel}</span>
        </div>
      } />

      {/* ============ HERO ============ */}
      <div style={{ maxWidth: 1360, margin: '0 auto', padding: '44px 40px 0' }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap' }}>
          <div>
            <span style={{ display: 'inline-block', fontFamily: 'var(--font-sans)', fontSize: 'var(--text-xs)', fontWeight: 600, letterSpacing: 'var(--tracking-widest)', textTransform: 'uppercase', color: 'var(--text-brand)', marginBottom: 14 }}>AI AUTO RESEARCH</span>
            <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 600, letterSpacing: 'var(--tracking-tighter)', fontSize: 'clamp(32px,4vw,46px)', lineHeight: 'var(--leading-tight)', margin: 0, color: 'var(--seryn-navy)' }}>AI AUTO RESEARCH</h1>
            <p style={{ fontSize: 'var(--text-md)', color: 'var(--text-muted)', margin: '14px 0 0', maxWidth: 620, lineHeight: 'var(--leading-relaxed)' }}>(Hệ thống lắng nghe &amp; cảnh báo tín hiệu truyền thông)</p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 12 }}>
            <Badge tone="gold" style={{ height: 28, fontSize: 13 }}>Kỳ báo cáo {rangeLabel}</Badge>
            <button onClick={() => openOverviewPdfPreview(overviewReportData)} style={{
              display: 'flex', alignItems: 'center', gap: 8, border: 'none', background: 'var(--seryn-navy)', color: '#fff',
              borderRadius: 'var(--radius-pill)', padding: '11px 22px', fontSize: 'var(--text-sm)', fontWeight: 600,
              cursor: 'pointer', whiteSpace: 'nowrap', boxShadow: 'var(--shadow-sm)',
            }}>Xuất báo cáo tổng thể</button>
            <button onClick={() => setRecoModalOpen(true)} style={{
              display: 'flex', alignItems: 'center', gap: 8, border: '1px solid var(--seryn-navy)', background: 'var(--surface-card)', color: 'var(--seryn-navy)',
              borderRadius: 'var(--radius-pill)', padding: '11px 22px', fontSize: 'var(--text-sm)', fontWeight: 600,
              cursor: 'pointer', whiteSpace: 'nowrap', boxShadow: 'var(--shadow-sm)',
            }}>Khuyến nghị Seryn</button>
          </div>
        </div>
      </div>

      {/* ============ PERIOD SELECTOR ============ */}
      <div style={{ maxWidth: 1360, margin: '0 auto', padding: '28px 40px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 14 }}>
          <div style={{ display: 'inline-flex', background: 'var(--ivory-200)', padding: 4, borderRadius: 'var(--radius-pill)', gap: 2 }}>
            {VIEW_MODES.map(m => {
              const active = m === mode;
              return (
                <button key={m} onClick={() => setModeAndReset(m)} style={{
                  border: 'none', cursor: 'pointer', padding: '8px 20px', borderRadius: 'var(--radius-pill)',
                  fontFamily: 'var(--font-sans)', fontSize: 'var(--text-sm)', fontWeight: 600,
                  background: active ? 'var(--surface-card)' : 'transparent',
                  color: active ? 'var(--text-brand)' : 'var(--text-muted)',
                  boxShadow: active ? 'var(--shadow-sm)' : 'none',
                  transition: 'all var(--dur-fast) var(--ease-out)',
                }}>{cap(MODE_NOUN[m])}</button>
              );
            })}
          </div>
          <div style={{ position: 'relative' }}>
            <button onClick={() => setDropdownOpen(o => !o)} style={{
              display: 'flex', alignItems: 'center', gap: 10, fontFamily: 'var(--font-sans)', fontSize: 'var(--text-sm)',
              fontWeight: 500, color: 'var(--text-body)', background: 'var(--surface-card)', border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-pill)', padding: '9px 18px', cursor: 'pointer', minWidth: 220, justifyContent: 'space-between',
            }}>
              <span>{selBucket.label}</span>
              <span style={{ color: 'var(--text-subtle)', fontSize: 11 }}>▾</span>
            </button>
            {dropdownOpen && (
              <>
                <div onClick={() => setDropdownOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
                <div style={{
                  position: 'absolute', top: 'calc(100% + 6px)', right: 0, minWidth: 240, maxHeight: 320, overflowY: 'auto',
                  background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)',
                  boxShadow: 'var(--shadow-lg)', zIndex: 41, padding: 6,
                }}>
                  {periodOptionsList.map(b => (
                    <div key={b.key} onClick={() => { setSelectedKey(b.key); setDropdownOpen(false); }} style={{
                      padding: '9px 14px', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: 'var(--text-sm)', fontWeight: 500,
                      background: b.key === selBucket.key ? 'var(--coral-100)' : 'transparent',
                      color: b.key === selBucket.key ? 'var(--text-brand)' : 'var(--text-body)',
                    }}>{b.label}</div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ============ KPI ROW ============ */}
      <div style={{ maxWidth: 1360, margin: '0 auto', padding: '20px 40px 0' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 16 }}>

          <Card elevation="sm" onClick={() => setModalCategory('total')} style={{ minHeight: 140, cursor: 'pointer' }}>
            <KpiLabel>Tổng nguồn</KpiLabel>
            <KpiValue color="var(--seryn-navy)">{selBucket.total}</KpiValue>
            <KpiFoot>{selPeriodLabel}</KpiFoot>
            {/* Only the legacy report dates whose "Đánh giá" column the parser
                couldn't detect leave a gap here — this is why Tích cực % +
                Trung tính % (+ Tiêu cực) can fall short of 100% for a period
                that spans one of those dates (e.g. "Năm"). Surfaced here,
                click-through, instead of silently vanishing from the count. */}
            {selBucket.unclassified > 0 && (
              <div
                onClick={(e) => { e.stopPropagation(); setModalCategory('unclassified'); }}
                title="Nguồn có trong báo cáo nhưng thiếu dữ liệu đánh giá (Tích cực/Trung tính/Tiêu cực) do lỗi định dạng báo cáo gốc ở ngày đó — không tính được vào 3 mục bên cạnh."
                style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', marginTop: 6, textDecoration: 'underline', cursor: 'pointer' }}
              >
                {selBucket.unclassified} chưa phân loại ({Math.round((selBucket.unclassified / selTotal) * 100)}%)
              </div>
            )}
          </Card>

          <Card elevation="sm" onClick={() => setModalCategory('positive')} style={{ minHeight: 140, cursor: 'pointer' }}>
            <KpiLabel>Tích cực</KpiLabel>
            <KpiValue color="var(--success-500)">{selBucket.positive}</KpiValue>
            <KpiFoot>{positivePct}% tổng nguồn</KpiFoot>
          </Card>

          <Card elevation="sm" onClick={() => setModalCategory('neutral')} style={{ minHeight: 140, cursor: 'pointer' }}>
            <KpiLabel>Trung tính</KpiLabel>
            <KpiValue color="var(--gold-600)">{selBucket.neutral}</KpiValue>
            <KpiFoot>{neutralPct}% tổng nguồn</KpiFoot>
          </Card>

          <Card elevation="sm" onClick={() => setModalCategory('negative')} style={{ minHeight: 140, cursor: 'pointer' }}>
            <KpiLabel>Tiêu cực / cảnh báo</KpiLabel>
            <KpiValue color={negativeColor}>{selBucket.negative}</KpiValue>
            <KpiFoot>{selRiskDaysNote}</KpiFoot>
          </Card>

          <Card elevation="sm" onClick={() => setModalCategory('new')} style={{ minHeight: 140, cursor: 'pointer' }}>
            <KpiLabel>Nguồn mới</KpiLabel>
            <KpiValue color="var(--text-brand)">+{selBucket.newSources}</KpiValue>
            <KpiFoot>So với kỳ trước · nhấn để xem</KpiFoot>
          </Card>

          <div
            onClick={() => selBucket.riskNote && setRiskModalOpen(true)}
            style={{
              borderRadius: 'var(--radius-xl)', padding: 'var(--space-8)', boxShadow: 'var(--shadow-sm)',
              background: softBgForRisk(selBucket.riskLevel), border: `1px solid ${borderForRisk(selBucket.riskLevel)}`,
              display: 'flex', flexDirection: 'column', justifyContent: 'center',
              minHeight: 140, maxHeight: 140, overflow: 'hidden',
              cursor: selBucket.riskNote ? 'pointer' : 'default',
            }}>
            <KpiLabel>Trạng thái rủi ro</KpiLabel>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-xl)', fontWeight: 600, color: colorForRisk(selBucket.riskLevel), lineHeight: 1.15 }}>{labelForRisk(selBucket.riskLevel)}</div>
            <div style={{
              fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginTop: 8, lineHeight: 'var(--leading-snug)',
              display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
            }}>
              {selBucket.riskNote || (selBucket.riskLevel === 'green' ? 'Không phát hiện nội dung tiêu cực' : `${cap(modeNoun)} này có mục cần theo dõi`)}
            </div>
            {selBucket.riskNote && (
              <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-brand)', marginTop: 4, fontWeight: 600, flexShrink: 0 }}>Xem chi tiết ›</div>
            )}
          </div>

        </div>
      </div>

      {/* ============ TREND CHART ============ */}
      <div style={{ maxWidth: 1360, margin: '0 auto', padding: '28px 40px 0' }}>
        <Card elevation="md" style={{ padding: 28 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 8 }}>
            <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'var(--text-xl)', color: 'var(--seryn-navy)', margin: 0, letterSpacing: 'var(--tracking-tighter)' }}>Xu hướng nguồn theo thời gian</h2>
            <div style={{ display: 'flex', gap: 18, fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
              <LegendDot color="var(--success-500)" label="Tích cực" />
              <LegendDot color="var(--gold-600)" label="Trung tính" />
              <LegendDot color="var(--danger-500)" label="Tiêu cực" />
            </div>
          </div>
          {chartFallbackNote && <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-brand)', margin: '-8px 0 12px' }}>{chartFallbackNote}</div>}

          <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 220, display: 'block', overflow: 'visible', animation: 'chartFadeIn .5s var(--ease-out)' }}>
            <defs>
              <linearGradient id="posFillGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--success-500)" stopOpacity="0.28" />
                <stop offset="100%" stopColor="var(--success-500)" stopOpacity="0" />
              </linearGradient>
            </defs>
            <line x1="0" y1="20" x2={W} y2="20" stroke="var(--border-subtle)" strokeWidth="1" />
            <line x1="0" y1="90" x2={W} y2="90" stroke="var(--border-subtle)" strokeWidth="1" />
            <line x1="0" y1="160" x2={W} y2="160" stroke="var(--border-subtle)" strokeWidth="1" />
            <polygon points={positiveArea} fill="url(#posFillGrad)" />
            <polyline points={negativeLine} fill="none" stroke="var(--danger-500)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
            <polyline points={neutralLine} fill="none" stroke="var(--gold-600)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
            <polyline points={positiveLine} fill="none" stroke="var(--success-500)" strokeWidth="2.75" strokeLinejoin="round" strokeLinecap="round" style={{ filter: 'drop-shadow(0 2px 5px rgba(76,154,110,0.35))' }} />
            {chartPoints.map((pt, i) => (
              <circle key={i} cx={pt.cx} cy={pt.cy} r="3" fill="var(--success-500)" stroke="var(--ivory-0)" strokeWidth="1.5" style={{ cursor: 'pointer' }}>
                <title>{pt.title}</title>
              </circle>
            ))}
          </svg>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 'var(--text-2xs)', color: 'var(--text-subtle)' }}>
            <span>{firstDateLabel}</span><span>{midDateLabel}</span><span>{lastDateLabel}</span>
          </div>

          <div style={{ marginTop: 22, borderTop: '1px solid var(--border-subtle)', paddingTop: 18 }}>
            <div style={{ fontSize: 'var(--text-2xs)', letterSpacing: 'var(--tracking-wider)', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600, marginBottom: 10 }}>
              Lịch sử trạng thái rủi ro — {chartBuckets.length} {chartModeNoun}
            </div>
            <div style={{ display: 'flex', gap: 3 }}>
              {chartBuckets.map((b, i) => (
                <div key={i} title={`${b.label} — ${labelForRisk(b.riskLevel)}${b.riskNote ? ' — ' + b.riskNote : ''}`} style={{
                  flex: '1 1 0%', minWidth: 5, height: 22, borderRadius: 3, background: colorForRisk(b.riskLevel),
                  transition: 'background var(--dur-base) var(--ease-out)',
                }} />
              ))}
            </div>
          </div>
        </Card>
      </div>

      {/* ============ DETAIL: SOURCES + SOCIAL ============ */}
      <div style={{ maxWidth: 1360, margin: '0 auto', padding: '28px 40px 0', display: 'grid', gridTemplateColumns: 'minmax(0,1.4fr) minmax(0,1fr)', gap: 20, alignItems: 'start' }}>

        <Card elevation="md" style={{ padding: 28 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
            <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'var(--text-xl)', color: 'var(--seryn-navy)', margin: 0, letterSpacing: 'var(--tracking-tighter)' }}>Nguồn nổi bật hôm nay</h2>
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-subtle)' }}>{topSources.length} kết quả · Top10 Google + báo chí</span>
          </div>
          <div style={{ maxHeight: 520, overflowY: 'auto', marginTop: 10, paddingRight: 4 }}>
            {topSources.map((s, i) => (
              <a key={i} href={s.url} target="_blank" rel="noopener noreferrer" style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 6px', borderBottom: '1px solid var(--border-subtle)', textDecoration: 'none' }}>
                <span style={{ width: 8, height: 8, minWidth: 8, borderRadius: '50%', background: s.dotColor }} />
                <span style={{ flex: '1 1 0%', minWidth: 0, overflow: 'hidden' }}>
                  <span style={{ display: 'block', fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--text-body)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.title}</span>
                  <span style={{ display: 'block', fontSize: 'var(--text-2xs)', color: 'var(--text-subtle)', marginTop: 2 }}>{s.type}</span>
                </span>
                {s.isNew && <Badge tone="brand" style={{ height: 22 }}>Mới</Badge>}
              </a>
            ))}
          </div>
        </Card>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <Card elevation="md" style={{ padding: 28 }}>
            <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'var(--text-xl)', color: 'var(--seryn-navy)', margin: '0 0 14px', letterSpacing: 'var(--tracking-tighter)' }}>Kênh hiện diện</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 230, overflowY: 'auto' }}>
              {channels.map((ch, i) => (
                <div key={i} onClick={() => setChannelModal(ch.platform)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 4px', borderBottom: '1px solid var(--border-subtle)', cursor: 'pointer' }}>
                  <span style={{ fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--text-body)' }}>{ch.platform}</span>
                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>{ch.count} trang ›</span>
                </div>
              ))}
            </div>
          </Card>

          <Card elevation="md" style={{ padding: 28 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'var(--text-xl)', color: 'var(--seryn-navy)', margin: 0, letterSpacing: 'var(--tracking-tighter)' }}>Cần theo dõi</h2>
              <Badge tone="gold" style={{ height: 22 }}>{watchItems.length} Mục</Badge>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxHeight: 220, overflowY: 'auto', paddingRight: 4 }}>
              {watchItems.map((w, i) => (
                <div key={i} style={{ borderLeft: '3px solid var(--gold-500)', padding: '2px 0 2px 12px' }}>
                  <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-body)' }}>{w.type}</div>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginTop: 3, lineHeight: 'var(--leading-snug)' }}>{w.summary}</div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>

      {/* ============ TAG / SOURCE-TYPE STATS ============ */}
      <div style={{ maxWidth: 1360, margin: '0 auto', padding: '28px 40px 0' }}>
        <Card elevation="md" style={{ padding: 28 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 18, flexWrap: 'wrap', gap: 8 }}>
            <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'var(--text-xl)', color: 'var(--seryn-navy)', margin: 0, letterSpacing: 'var(--tracking-tighter)' }}>Thống kê theo loại nguồn</h2>
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-subtle)' }}>{bucketSourcesDeduped.length} nguồn duy nhất (đã gộp trùng lặp) · {selBucket.label}</span>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '6px 8px 10px 6px', borderBottom: '1px solid var(--border-subtle)', fontSize: 'var(--text-2xs)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wider)', color: 'var(--text-muted)', fontWeight: 600 }}>Loại nguồn / tag</th>
                <th style={{ textAlign: 'right', padding: '6px 8px 10px 6px', borderBottom: '1px solid var(--border-subtle)', fontSize: 'var(--text-2xs)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wider)', color: 'var(--text-muted)', fontWeight: 600 }}>Số nguồn</th>
                <th style={{ textAlign: 'left', padding: '6px 8px 10px 6px', borderBottom: '1px solid var(--border-subtle)', fontSize: 'var(--text-2xs)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wider)', color: 'var(--text-muted)', fontWeight: 600, width: '38%' }}>Tỷ trọng</th>
              </tr>
            </thead>
            <tbody>
              {tagStats.map((t, i) => {
                const tagColor = colorForTag(t.label);
                return (
                  <tr
                    key={i}
                    className="tag-stat-row"
                    onClick={() => setTagModal(t.label)}
                    title="Nhấn để xem danh sách nguồn"
                    style={{ '--tag-ring-color': `${tagColor}55` }}
                  >
                    <td style={{ padding: '11px 8px', borderBottom: '1px solid var(--border-subtle)', fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--text-body)' }}>
                      <span className="tag-dot" style={{ display: 'inline-block', width: 9, height: 9, minWidth: 9, borderRadius: '50%', background: tagColor, marginRight: 10, verticalAlign: 'middle' }} />
                      {t.label}
                    </td>
                    <td style={{ padding: '11px 8px', borderBottom: '1px solid var(--border-subtle)', textAlign: 'right', fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--seryn-navy)' }}>{t.count} ›</td>
                    <td style={{ padding: '11px 8px', borderBottom: '1px solid var(--border-subtle)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ flex: '1 1 0%', height: 6, borderRadius: 3, background: 'var(--ivory-200)', overflow: 'hidden' }}>
                          <div style={{ width: `${t.pct}%`, height: '100%', background: tagColor, borderRadius: 3 }} />
                        </div>
                        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-subtle)', minWidth: 32, textAlign: 'right' }}>{t.pct}%</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      </div>

      <div style={{ maxWidth: 1360, margin: '0 auto', padding: '28px 40px 56px', textAlign: 'center' }}>
        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-subtle)' }}>Dữ liệu tổng hợp tự động từ thư mục báo cáo giám sát hằng ngày · {rangeLabel} · Phòng khám đa khoa Seryn</p>
      </div>

      {/* ============ SOURCE LIST MODAL ============ */}
      {modalOpen && (
        <div onClick={() => setModalCategory(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(36,28,24,0.45)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 32 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--surface-card)', borderRadius: 'var(--radius-xl)', boxShadow: 'var(--shadow-lg)', width: '100%', maxWidth: 680, maxHeight: '80vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '24px 28px', borderBottom: '1px solid var(--border-subtle)' }}>
              <div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-lg)', fontWeight: 600, color: 'var(--seryn-navy)', letterSpacing: 'var(--tracking-tighter)' }}>{modalTitle}</div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-subtle)', marginTop: 4 }}>{modalTotalCount} nguồn duy nhất (đã gộp trùng lặp)</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <button onClick={() => openPdfPreview({
                  title: modalTitle,
                  subtitle: `${modalTotalCount} nguồn duy nhất (đã gộp trùng lặp) · ${selBucket.label} · xuất ngày ${fmtDateFull(lastDay.date)}`,
                  items: modalItems.map(m => ({
                    heading: m.title,
                    lines: [
                      [m.type, m.occurrences > 1 ? `Xuất hiện ${m.occurrences} lần` : null].filter(Boolean).join(' · '),
                      m.url,
                    ],
                  })),
                  filename: `nguon-${modalCategory}-${selBucket.key}.pdf`,
                })} style={{ border: '1px solid var(--border-default)', background: 'var(--surface-card)', borderRadius: 'var(--radius-pill)', padding: '7px 16px', fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-brand)', cursor: 'pointer', whiteSpace: 'nowrap' }}>Xuất file PDF</button>
                <button onClick={() => setModalCategory(null)} style={{ border: 'none', background: 'var(--ivory-200)', width: 32, height: 32, borderRadius: '50%', cursor: 'pointer', fontSize: 16, color: 'var(--text-muted)', lineHeight: 1 }}>×</button>
              </div>
            </div>
            <div style={{ overflowY: 'auto', padding: '8px 28px 24px' }}>
              {modalItems.length > 0 ? modalItems.map((m, i) => (
                <a key={i} href={m.url} target="_blank" rel="noopener noreferrer" style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '14px 0', borderBottom: '1px solid var(--border-subtle)', textDecoration: 'none' }}>
                  <span style={{ width: 8, height: 8, minWidth: 8, marginTop: 6, borderRadius: '50%', background: m.dotColor }} />
                  <span style={{ flex: '1 1 0%', minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--text-body)' }}>{m.title}</span>
                    <span style={{ display: 'block', fontSize: 'var(--text-2xs)', color: 'var(--text-subtle)', marginTop: 3 }}>{m.type}{m.occurrences > 1 ? ` · xuất hiện ${m.occurrences} lần` : ''}</span>
                  </span>
                </a>
              )) : (
                <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-subtle)', fontSize: 'var(--text-sm)' }}>Không có nguồn nào trong mục này cho kỳ đã chọn.</div>
              )}
              {modalTruncated && (
                <div style={{ padding: '16px 0 4px', textAlign: 'center', color: 'var(--text-subtle)', fontSize: 'var(--text-xs)' }}>... và {modalHiddenCount} nguồn khác trong kỳ này (thu hẹp phạm vi để xem đầy đủ)</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ============ TAG / SOURCE-TYPE LIST MODAL ============ */}
      {tagModalOpen && (
        <div onClick={() => setTagModal(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(36,28,24,0.45)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 32 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--surface-card)', borderRadius: 'var(--radius-xl)', boxShadow: 'var(--shadow-lg)', width: '100%', maxWidth: 680, maxHeight: '80vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '24px 28px', borderBottom: '1px solid var(--border-subtle)' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ width: 10, height: 10, minWidth: 10, borderRadius: '50%', background: colorForTag(tagModal) }} />
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-lg)', fontWeight: 600, color: 'var(--seryn-navy)', letterSpacing: 'var(--tracking-tighter)' }}>{tagModal}</div>
                </div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-subtle)', marginTop: 4 }}>{tagModalItems.length} nguồn duy nhất (đã gộp trùng lặp) · {selBucket.label}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <button onClick={() => openPdfPreview({
                  title: `Thống kê theo loại nguồn — ${tagModal}`,
                  subtitle: `${tagModalItems.length} nguồn duy nhất (đã gộp trùng lặp) · ${selBucket.label} · xuất ngày ${fmtDateFull(lastDay.date)}`,
                  items: tagModalItems.map(m => ({
                    heading: m.title,
                    lines: [
                      [m.type, m.occurrences > 1 ? `Xuất hiện ${m.occurrences} lần` : null].filter(Boolean).join(' · '),
                      m.url,
                    ],
                  })),
                  filename: `loai-nguon-${slugifyTag(tagModal)}-${selBucket.key}.pdf`,
                })} style={{ border: '1px solid var(--border-default)', background: 'var(--surface-card)', borderRadius: 'var(--radius-pill)', padding: '7px 16px', fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-brand)', cursor: 'pointer', whiteSpace: 'nowrap' }}>Xuất file PDF</button>
                <button onClick={() => setTagModal(null)} style={{ border: 'none', background: 'var(--ivory-200)', width: 32, height: 32, borderRadius: '50%', cursor: 'pointer', fontSize: 16, color: 'var(--text-muted)', lineHeight: 1 }}>×</button>
              </div>
            </div>
            <div style={{ overflowY: 'auto', padding: '8px 28px 24px' }}>
              {tagModalItems.length > 0 ? tagModalItems.map((m, i) => (
                <a key={i} href={m.url} target="_blank" rel="noopener noreferrer" style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '14px 0', borderBottom: '1px solid var(--border-subtle)', textDecoration: 'none' }}>
                  <span style={{ width: 8, height: 8, minWidth: 8, marginTop: 6, borderRadius: '50%', background: m.dotColor }} />
                  <span style={{ flex: '1 1 0%', minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--text-body)' }}>{m.title}</span>
                    <span style={{ display: 'block', fontSize: 'var(--text-2xs)', color: 'var(--text-subtle)', marginTop: 3 }}>{m.type}{m.occurrences > 1 ? ` · xuất hiện ${m.occurrences} lần` : ''}</span>
                  </span>
                </a>
              )) : (
                <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-subtle)', fontSize: 'var(--text-sm)' }}>Không có nguồn nào cho loại này trong kỳ đã chọn.</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ============ RISK NOTE DETAIL MODAL ============ */}
      {riskModalOpen && (
        <div onClick={() => setRiskModalOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(36,28,24,0.45)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 32 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--surface-card)', borderRadius: 'var(--radius-xl)', boxShadow: 'var(--shadow-lg)', width: '100%', maxWidth: 640, maxHeight: '80vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '24px 28px', borderBottom: '1px solid var(--border-subtle)' }}>
              <div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-lg)', fontWeight: 600, color: colorForRisk(selBucket.riskLevel), letterSpacing: 'var(--tracking-tighter)' }}>{labelForRisk(selBucket.riskLevel)}</div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-subtle)', marginTop: 4 }}>{selBucket.label}</div>
              </div>
              <button onClick={() => setRiskModalOpen(false)} style={{ border: 'none', background: 'var(--ivory-200)', width: 32, height: 32, borderRadius: '50%', cursor: 'pointer', fontSize: 16, color: 'var(--text-muted)', lineHeight: 1 }}>×</button>
            </div>
            <div style={{ overflowY: 'auto', padding: '20px 28px 28px', fontSize: 'var(--text-sm)', color: 'var(--text-body)', lineHeight: 'var(--leading-relaxed)', whiteSpace: 'pre-wrap' }}>
              {selBucket.riskNote || (selBucket.riskLevel === 'green' ? 'Không phát hiện nội dung tiêu cực' : `${cap(modeNoun)} này có mục cần theo dõi`)}
            </div>
          </div>
        </div>
      )}

      {/* ============ CHANNEL LIST MODAL ============ */}
      {channelModalOpen && (
        <div onClick={() => setChannelModal(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(36,28,24,0.45)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 32 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--surface-card)', borderRadius: 'var(--radius-xl)', boxShadow: 'var(--shadow-lg)', width: '100%', maxWidth: 680, maxHeight: '80vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '24px 28px', borderBottom: '1px solid var(--border-subtle)' }}>
              <div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-lg)', fontWeight: 600, color: 'var(--seryn-navy)', letterSpacing: 'var(--tracking-tighter)' }}>{channelModal}</div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-subtle)', marginTop: 4 }}>Danh sách trang / tài khoản</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <button onClick={() => openPdfPreview({
                  title: `Kênh hiện diện — ${channelModal}`,
                  subtitle: `${channelModalItems.length} trang / tài khoản · ${fmtDateFull(lastDay.date)}`,
                  items: channelModalItems.map(cm => ({
                    heading: cm.account,
                    lines: [[cm.accountType, cm.note].filter(Boolean).join(' · '), cm.url],
                  })),
                  filename: `kenh-${channelModal}.pdf`,
                })} style={{ border: '1px solid var(--border-default)', background: 'var(--surface-card)', borderRadius: 'var(--radius-pill)', padding: '7px 16px', fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-brand)', cursor: 'pointer', whiteSpace: 'nowrap' }}>Xuất file PDF</button>
                <button onClick={() => setChannelModal(null)} style={{ border: 'none', background: 'var(--ivory-200)', width: 32, height: 32, borderRadius: '50%', cursor: 'pointer', fontSize: 16, color: 'var(--text-muted)', lineHeight: 1 }}>×</button>
              </div>
            </div>
            <div style={{ overflowY: 'auto', padding: '8px 28px 24px' }}>
              {channelModalItems.length > 0 ? channelModalItems.map((c, i) => (
                <a key={i} href={c.url} target="_blank" rel="noopener noreferrer" style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '14px 0', borderBottom: '1px solid var(--border-subtle)', textDecoration: 'none' }}>
                  <span style={{ width: 8, height: 8, minWidth: 8, marginTop: 6, borderRadius: '50%', background: c.dotColor }} />
                  <span style={{ flex: '1 1 0%', minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--text-body)' }}>{c.account}</span>
                    <span style={{ display: 'block', fontSize: 'var(--text-2xs)', color: 'var(--text-subtle)', marginTop: 3 }}>{c.accountType} · {c.note}</span>
                  </span>
                </a>
              )) : (
                <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-subtle)', fontSize: 'var(--text-sm)' }}>Không có trang nào cho kênh này.</div>
              )}
            </div>
          </div>
        </div>
      )}

    {recoModalOpen && (
      <RecommendationsModal
        data={recoData}
        competitorDataMissing={!competitors}
        exporting={recoExporting}
        onClose={() => setRecoModalOpen(false)}
        onExportPdf={() => openRecommendationsPdfPreview({
          eyebrow: 'Seryn Clinic · Cố vấn Marketing',
          title: `Khuyến nghị Seryn — ${recoData.periodLabel}`,
          subtitle: `${cap(modeNoun)} đang chọn: ${recoData.periodLabel} · Seryn Clinic`,
          generatedLabel: `Xuất ngày ${fmtDateFull(lastDay.date)}`,
          filename: `khuyen-nghi-seryn-${mode}-${selBucket.key}.pdf`,
          verdictLabel: recoData.verdict?.label,
          verdictTone: recoData.verdict?.tone,
          reasoning: recoData.verdict?.reasoning,
          itemsSectionTitle: recoData.itemsSectionTitle,
          items: recoData.items,
        })}
      />
    )}

    <PdfPreviewModal pdfPreview={pdfPreview} onClose={closePdfPreview} />
    </div>
  );
}

function KpiLabel({ children }) {
  return <div style={{ fontSize: 'var(--text-2xs)', letterSpacing: 'var(--tracking-wider)', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600, marginBottom: 10 }}>{children}</div>;
}
function KpiValue({ color, children }) {
  return <div style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-3xl)', fontWeight: 600, color, lineHeight: 1 }}>{children}</div>;
}
function KpiFoot({ children }) {
  return <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-subtle)', marginTop: 8 }}>{children}</div>;
}
function LegendDot({ color, label }) {
  return <span><span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: '50%', background: color, marginRight: 6 }} />{label}</span>;
}
