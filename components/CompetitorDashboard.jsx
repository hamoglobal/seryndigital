'use client';

// components/CompetitorDashboard.jsx — "Đối Thủ" (competitor monitoring) page.
// Data source: BaoCao_TheoDoi_ThamMy_*.xlsx reports in the "Digital Doi Thu"
// folder (a separate, pre-existing scheduled task tracking 14 aesthetic-
// clinic competitor brands daily — bad news/violations + new articles, each
// with a risk level). This app only reads that task's output.
//
// Shape follows the data: each report is a fresh ranked snapshot of 14 named
// brands (not a single continuously-tracked metric like the main Seryn
// dashboard), so the UI here is a date picker + ranked brand table, rather
// than a day/week/month/year trend view.
import { useEffect, useState } from 'react';
import Card from './Card';
import Badge from './Badge';
import TopNav from './TopNav';
import PdfPreviewModal from './PdfPreviewModal';
import { buildListPdf, buildOverviewPdf, pdfToPreviewUrl, revokePdfPreviewUrl, toneRgb } from '@/lib/exportPdf';
import { fmtDateFull } from '@/lib/aggregate';

function riskColor(level) {
  if (level === 'high') return 'var(--danger-500)';
  if (level === 'medium') return 'var(--gold-600)';
  return 'var(--success-500)';
}
function riskSoftBg(level) {
  if (level === 'high') return 'var(--danger-100)';
  if (level === 'medium') return 'var(--gold-100)';
  return 'var(--success-100)';
}
function riskLabel(level) {
  if (level === 'high') return 'CAO';
  if (level === 'medium') return 'TRUNG BÌNH';
  return 'THẤP';
}
const TYPE_LABELS = { bad_news: 'Tin xấu / vi phạm', new_article: 'Bài viết mới' };
const STAT_LABELS = { total: 'Thương hiệu theo dõi', high: 'Rủi ro cao', bad_news: 'Tin xấu / vi phạm', new_article: 'Bài viết mới' };

// The report's "Nguồn (URL)" cell isn't a clean single URL: depending on the
// report-generation era it's a bare publisher name ("Báo Dân Trí"), a
// placeholder ("—" / "Không có"), a bare domain with no scheme
// ("kangjinsejung.com.vn"), or — most commonly for the current format — one
// or more "Tiêu đề bài viết (https://...)" citations packed into one cell,
// semicolon-separated. Rendering that raw string as a single href is what
// produced the broken links. This extracts the real, individually-clickable
// URL(s) actually present in the cell and drops anything without one, per
// the requirement to only show sources that have a real recorded link.
function extractCitations(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return [];
  if (['—', '-', 'khong co', 'không có', 'n/a', 'na'].includes(s.toLowerCase())) return [];
  const out = [];
  const seen = new Set();
  // "Title text (https://example.com/article)" — the common packed format.
  const pairRe = /([^;]*?)\(((https?:\/\/[^\s()]+))\)/g;
  let m;
  while ((m = pairRe.exec(s))) {
    const url = m[2].trim();
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({ heading: m[1].replace(/^[;,\s]+|[;,\s]+$/g, '').trim(), url });
  }
  // Any bare http(s) URLs not already captured above (covers cells that are
  // just newline/space/semicolon-separated URLs with no "Title (...)" wrapper).
  const bareRe = /https?:\/\/[^\s()]+/g;
  while ((m = bareRe.exec(s))) {
    const url = m[0].replace(/[)\].,;]+$/, '');
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({ heading: '', url });
  }
  if (out.length > 0) return out;
  // Bare domain, no scheme, single token (e.g. "kangjinsejung.com.vn") — the
  // exact source as recorded, just missing "https://".
  if (!s.includes(' ') && !s.includes('\n') && /^[a-z0-9.-]+\.[a-z]{2,}(\/[^\s]*)?$/i.test(s)) {
    return [{ heading: '', url: `https://${s}` }];
  }
  return [];
}
function competitorRiskTone(level) {
  if (level === 'high') return 'danger';
  if (level === 'medium') return 'warning';
  return 'success';
}

export default function CompetitorDashboard() {
  const [dates, setDates] = useState(null);
  const [selectedDate, setSelectedDate] = useState(null);
  const [brandData, setBrandData] = useState(null); // { date, brands }
  const [loadError, setLoadError] = useState(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [brandModal, setBrandModal] = useState(null); // brand name
  const [brandItems, setBrandItems] = useState(null);
  const [pdfPreview, setPdfPreview] = useState(null);
  const [statModal, setStatModal] = useState(null); // 'total' | 'high' | 'bad_news' | 'new_article'
  const [statItems, setStatItems] = useState(null); // detail items for bad_news/new_article stat modals

  useEffect(() => {
    let cancelled = false;
    fetch('/api/competitors/dates').then(r => r.json()).then(d => {
      if (!cancelled) setDates(d);
    }).catch(err => !cancelled && setLoadError(err.message || String(err)));
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const qs = selectedDate ? `?date=${selectedDate}` : '';
    fetch(`/api/competitors/brands${qs}`).then(r => r.json()).then(d => {
      if (!cancelled) setBrandData(d);
    }).catch(err => !cancelled && setLoadError(err.message || String(err)));
    return () => { cancelled = true; };
  }, [selectedDate]);

  useEffect(() => {
    if (!brandModal || !brandData?.date) { setBrandItems(null); return; }
    let cancelled = false;
    fetch(`/api/competitors/items?date=${brandData.date}&brand=${encodeURIComponent(brandModal)}`)
      .then(r => r.json()).then(d => { if (!cancelled) setBrandItems(d); })
      .catch(err => !cancelled && setLoadError(err.message || String(err)));
    return () => { cancelled = true; };
  }, [brandModal, brandData?.date]);

  useEffect(() => {
    if (statModal !== 'bad_news' && statModal !== 'new_article') { setStatItems(null); return; }
    if (!brandData?.date) return;
    let cancelled = false;
    setStatItems(null);
    fetch(`/api/competitors/items?date=${brandData.date}&type=${statModal}`)
      .then(r => r.json()).then(d => { if (!cancelled) setStatItems(d); })
      .catch(err => !cancelled && setLoadError(err.message || String(err)));
    return () => { cancelled = true; };
  }, [statModal, brandData?.date]);

  async function openPdfPreview({ title, subtitle, items, filename }) {
    const doc = await buildListPdf({ title, subtitle, items });
    const url = pdfToPreviewUrl(doc);
    setPdfPreview(prev => { if (prev) revokePdfPreviewUrl(prev.url); return { url, filename, doc }; });
  }
  function closePdfPreview() {
    setPdfPreview(prev => { if (prev) revokePdfPreviewUrl(prev.url); return null; });
  }
  async function openOverviewPdfPreview(overviewData) {
    const doc = await buildOverviewPdf(overviewData);
    const url = pdfToPreviewUrl(doc);
    setPdfPreview(prev => { if (prev) revokePdfPreviewUrl(prev.url); return { url, filename: overviewData.filename, doc }; });
  }

  if (loadError) {
    return <div style={{ padding: 60, textAlign: 'center', fontFamily: 'var(--font-sans)', color: 'var(--danger-500)' }}>Không tải được dữ liệu đối thủ: {loadError}</div>;
  }
  if (!dates || !brandData) {
    return <div style={{ padding: 60, textAlign: 'center', fontFamily: 'var(--font-sans)', color: 'var(--text-muted)' }}>Đang tải dữ liệu giám sát đối thủ…</div>;
  }
  if (dates.length === 0) {
    return (
      <div style={{ padding: 60, textAlign: 'center', fontFamily: 'var(--font-sans)', color: 'var(--text-muted)' }}>
        Chưa có báo cáo đối thủ nào được nạp. Chạy <code>npm run competitor-seed</code> (hoặc chờ lịch tự động hằng ngày) để nạp dữ liệu từ thư mục "Digital Doi Thu".
      </div>
    );
  }

  const brands = brandData.brands || [];
  const displayDate = brandData.date;
  const highCount = brands.filter(b => b.riskLevel === 'high').length;
  const totalBadNews = brands.reduce((s, b) => s + b.badNews, 0);
  const totalNewArticles = brands.reduce((s, b) => s + b.newArticles, 0);
  const datesDesc = dates.slice().reverse();

  const modalBrand = brandModal ? brands.find(b => b.brand === brandModal) : null;
  // Flatten each DB item into its real, individually-linkable citation(s);
  // items with no recorded URL are dropped entirely (not shown, not counted).
  function toCitationRows(items, keyPrefix) {
    return items.flatMap((it, i) => extractCitations(it.url).map((c, ci) => ({
      key: `${keyPrefix}-${i}-${ci}`,
      heading: c.heading || (it.summary ? it.summary.slice(0, 100) : it.brand),
      summary: c.heading ? it.summary : null, // avoid showing the same text twice when there's no distinct article title
      itemDate: it.itemDate, domain: it.domain, channel: it.channel,
      url: c.url,
    })));
  }
  const badNewsRows = toCitationRows((brandItems || []).filter(i => i.type === 'bad_news'), 'bn');
  const newArticleRows = toCitationRows((brandItems || []).filter(i => i.type === 'new_article'), 'na');

  // ---- KPI click-through stat modal ("Đối Thủ" side of the click-to-detail pattern used in the main Seryn Digital dashboard) ----
  const statModalOpen = !!statModal;
  const statModalLoading = (statModal === 'bad_news' || statModal === 'new_article') && statItems === null;
  let statModalRows = [];
  if (statModal === 'total') {
    statModalRows = brands.map(b => ({
      key: b.brand, heading: b.brand,
      lines: [`${b.badNews} tin xấu · ${b.newArticles} bài viết mới · ${riskLabel(b.riskLevel)}`, b.note].filter(Boolean),
      dotColor: riskColor(b.riskLevel),
    }));
  } else if (statModal === 'high') {
    statModalRows = brands.filter(b => b.riskLevel === 'high').map(b => ({
      key: b.brand, heading: b.brand,
      lines: [`${b.badNews} tin xấu · ${b.newArticles} bài viết mới`, b.note].filter(Boolean),
      dotColor: riskColor(b.riskLevel),
    }));
  } else if (statModal === 'bad_news' || statModal === 'new_article') {
    // Flatten each DB item into its real citation(s); items with no recorded
    // URL are dropped entirely rather than shown with a broken/placeholder link.
    statModalRows = (statItems || []).flatMap((it, i) => extractCitations(it.url).map((c, ci) => ({
      key: `${i}-${ci}`,
      heading: c.heading || (it.summary ? it.summary.slice(0, 100) : it.brand),
      lines: [[it.brand, it.itemDate].filter(Boolean).join(' · '), c.heading ? it.summary : null].filter(Boolean),
      url: c.url,
      dotColor: statModal === 'bad_news' ? 'var(--danger-500)' : 'var(--text-brand)',
    })));
  }
  const statModalTitle = statModalOpen ? `${STAT_LABELS[statModal]} — ${fmtDateFull(displayDate)}` : '';

  // ---- "Xuất báo cáo tổng thể" — full branded overview PDF of the brand ranking for the selected date ----
  const overviewReportData = {
    eyebrow: 'Giám sát đối thủ',
    title: 'Báo cáo tổng thể — Đối thủ cạnh tranh',
    subtitle: displayDate ? `Báo cáo ngày ${fmtDateFull(displayDate)} · Seryn Clinic` : 'Seryn Clinic',
    filename: `bao-cao-tong-the-doi-thu-${displayDate || 'moi-nhat'}.pdf`,
    kpis: [
      { label: 'Thương hiệu theo dõi', value: brands.length, tone: 'navy', foot: 'Tổng số thương hiệu cạnh tranh' },
      { label: 'Rủi ro cao', value: highCount, tone: 'danger', foot: 'Thương hiệu cần chú ý' },
      { label: 'Tin xấu / vi phạm', value: totalBadNews, tone: 'navy', foot: 'Tổng cộng trong báo cáo' },
      { label: 'Bài viết mới', value: totalNewArticles, tone: 'brand', foot: 'Tổng cộng trong báo cáo' },
    ],
    sections: [
      {
        type: 'table', heading: 'Xếp hạng theo mức độ rủi ro', rightNote: `${brands.length} thương hiệu`,
        columns: [
          { key: 'brand', label: 'Thương hiệu', width: 0.2, bold: true },
          { key: 'badNews', label: 'Tin xấu', width: 0.11, align: 'right' },
          { key: 'newArticles', label: 'Bài viết mới', width: 0.13, align: 'right' },
          { key: 'riskLabel', label: 'Mức độ rủi ro', width: 0.18, bold: true, colorFn: row => toneRgb(row.tone) },
          { key: 'note', label: 'Ghi chú', width: 0.38 },
        ],
        rows: brands.map(b => ({
          brand: b.brand, badNews: b.badNews, newArticles: b.newArticles,
          riskLabel: riskLabel(b.riskLevel), tone: competitorRiskTone(b.riskLevel), note: b.note,
        })),
        emptyLabel: 'Chưa có dữ liệu thương hiệu nào cho ngày này.',
      },
    ],
  };

  return (
    <div style={{ minHeight: '100vh', background: 'radial-gradient(1100px 520px at 12% -8%, var(--coral-100), transparent), var(--bg-page)', fontFamily: 'var(--font-sans)', color: 'var(--text-body)' }}>

      <TopNav statusSlot={
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-pill)', padding: '7px 16px 7px 7px', boxShadow: 'var(--shadow-sm)' }}>
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: highCount > 0 ? 'var(--danger-500)' : 'var(--success-500)' }} />
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>{displayDate ? fmtDateFull(displayDate) : ''} ·</span>
          <span style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: highCount > 0 ? 'var(--danger-500)' : 'var(--success-500)' }}>{highCount} thương hiệu rủi ro cao</span>
        </div>
      } />

      {/* HERO */}
      <div style={{ maxWidth: 1360, margin: '0 auto', padding: '44px 40px 0' }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap' }}>
          <div>
            <span style={{ display: 'inline-block', fontFamily: 'var(--font-sans)', fontSize: 'var(--text-xs)', fontWeight: 600, letterSpacing: 'var(--tracking-widest)', textTransform: 'uppercase', color: 'var(--text-brand)', marginBottom: 14 }}>Giám sát đối thủ</span>
            <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 600, letterSpacing: 'var(--tracking-tighter)', fontSize: 'clamp(32px,4vw,46px)', lineHeight: 'var(--leading-tight)', margin: 0, color: 'var(--seryn-navy)' }}>Theo dõi 14 thương hiệu thẩm mỹ cạnh tranh</h1>
            <p style={{ fontSize: 'var(--text-md)', color: 'var(--text-muted)', margin: '14px 0 0', maxWidth: 640, lineHeight: 'var(--leading-relaxed)' }}>Tin xấu / vi phạm pháp lý và bài viết mới của các thương hiệu thẩm mỹ cạnh tranh, tổng hợp từ Google, báo chí và mạng xã hội.</p>
          </div>
          <button onClick={() => openOverviewPdfPreview(overviewReportData)} style={{
            display: 'flex', alignItems: 'center', gap: 8, border: 'none', background: 'var(--seryn-navy)', color: '#fff',
            borderRadius: 'var(--radius-pill)', padding: '11px 22px', fontSize: 'var(--text-sm)', fontWeight: 600,
            cursor: 'pointer', whiteSpace: 'nowrap', boxShadow: 'var(--shadow-sm)',
          }}>Xuất báo cáo tổng thể</button>
        </div>
      </div>

      {/* DATE PICKER */}
      <div style={{ maxWidth: 1360, margin: '0 auto', padding: '28px 40px 0' }}>
        <div style={{ position: 'relative', display: 'inline-block' }}>
          <button onClick={() => setDropdownOpen(o => !o)} style={{
            display: 'flex', alignItems: 'center', gap: 10, fontFamily: 'var(--font-sans)', fontSize: 'var(--text-sm)',
            fontWeight: 500, color: 'var(--text-body)', background: 'var(--surface-card)', border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-pill)', padding: '9px 18px', cursor: 'pointer', minWidth: 200, justifyContent: 'space-between',
          }}>
            <span>Báo cáo ngày {displayDate ? fmtDateFull(displayDate) : '—'}</span>
            <span style={{ color: 'var(--text-subtle)', fontSize: 11 }}>▾</span>
          </button>
          {dropdownOpen && (
            <>
              <div onClick={() => setDropdownOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
              <div style={{
                position: 'absolute', top: 'calc(100% + 6px)', left: 0, minWidth: 200, maxHeight: 320, overflowY: 'auto',
                background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)',
                boxShadow: 'var(--shadow-lg)', zIndex: 41, padding: 6,
              }}>
                {datesDesc.map(d => (
                  <div key={d} onClick={() => { setSelectedDate(d); setDropdownOpen(false); }} style={{
                    padding: '9px 14px', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: 'var(--text-sm)', fontWeight: 500,
                    background: d === displayDate ? 'var(--coral-100)' : 'transparent',
                    color: d === displayDate ? 'var(--text-brand)' : 'var(--text-body)',
                  }}>{fmtDateFull(d)}</div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* KPI ROW */}
      <div style={{ maxWidth: 1360, margin: '0 auto', padding: '20px 40px 0' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16 }}>
          <Card elevation="sm" onClick={() => setStatModal('total')} style={{ minHeight: 120, cursor: 'pointer' }}>
            <div style={{ fontSize: 'var(--text-2xs)', letterSpacing: 'var(--tracking-wider)', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600, marginBottom: 10 }}>Thương hiệu theo dõi</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-3xl)', fontWeight: 600, color: 'var(--seryn-navy)', lineHeight: 1 }}>{brands.length}</div>
          </Card>
          <Card elevation="sm" onClick={() => setStatModal('high')} style={{ minHeight: 120, cursor: 'pointer' }}>
            <div style={{ fontSize: 'var(--text-2xs)', letterSpacing: 'var(--tracking-wider)', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600, marginBottom: 10 }}>Rủi ro cao</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-3xl)', fontWeight: 600, color: 'var(--danger-500)', lineHeight: 1 }}>{highCount}</div>
          </Card>
          <Card elevation="sm" onClick={() => setStatModal('bad_news')} style={{ minHeight: 120, cursor: 'pointer' }}>
            <div style={{ fontSize: 'var(--text-2xs)', letterSpacing: 'var(--tracking-wider)', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600, marginBottom: 10 }}>Tin xấu / vi phạm</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-3xl)', fontWeight: 600, color: 'var(--seryn-navy)', lineHeight: 1 }}>{totalBadNews}</div>
          </Card>
          <Card elevation="sm" onClick={() => setStatModal('new_article')} style={{ minHeight: 120, cursor: 'pointer' }}>
            <div style={{ fontSize: 'var(--text-2xs)', letterSpacing: 'var(--tracking-wider)', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600, marginBottom: 10 }}>Bài viết mới</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-3xl)', fontWeight: 600, color: 'var(--text-brand)', lineHeight: 1 }}>{totalNewArticles}</div>
          </Card>
        </div>
      </div>

      {/* BRAND TABLE */}
      <div style={{ maxWidth: 1360, margin: '0 auto', padding: '28px 40px 56px' }}>
        <Card elevation="md" style={{ padding: 28 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 16 }}>
            <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'var(--text-xl)', color: 'var(--seryn-navy)', margin: 0, letterSpacing: 'var(--tracking-tighter)' }}>Xếp hạng theo mức độ rủi ro</h2>
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-subtle)' }}>Nhấn vào một thương hiệu để xem chi tiết</span>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '6px 8px 10px 6px', borderBottom: '1px solid var(--border-subtle)', fontSize: 'var(--text-2xs)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wider)', color: 'var(--text-muted)', fontWeight: 600 }}>Thương hiệu</th>
                <th style={{ textAlign: 'right', padding: '6px 8px 10px 6px', borderBottom: '1px solid var(--border-subtle)', fontSize: 'var(--text-2xs)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wider)', color: 'var(--text-muted)', fontWeight: 600 }}>Tin xấu</th>
                <th style={{ textAlign: 'right', padding: '6px 8px 10px 6px', borderBottom: '1px solid var(--border-subtle)', fontSize: 'var(--text-2xs)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wider)', color: 'var(--text-muted)', fontWeight: 600 }}>Bài viết mới</th>
                <th style={{ textAlign: 'left', padding: '6px 8px 10px 6px', borderBottom: '1px solid var(--border-subtle)', fontSize: 'var(--text-2xs)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wider)', color: 'var(--text-muted)', fontWeight: 600 }}>Mức độ rủi ro</th>
                <th style={{ textAlign: 'left', padding: '6px 8px 10px 6px', borderBottom: '1px solid var(--border-subtle)', fontSize: 'var(--text-2xs)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wider)', color: 'var(--text-muted)', fontWeight: 600, width: '34%' }}>Ghi chú</th>
              </tr>
            </thead>
            <tbody>
              {brands.map((b, i) => (
                <tr key={i} onClick={() => setBrandModal(b.brand)} style={{ cursor: 'pointer' }}>
                  <td style={{ padding: '13px 8px', borderBottom: '1px solid var(--border-subtle)', fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-body)' }}>{b.brand}</td>
                  <td style={{ padding: '13px 8px', borderBottom: '1px solid var(--border-subtle)', textAlign: 'right', fontSize: 'var(--text-sm)', fontWeight: 600, color: b.badNews > 0 ? 'var(--danger-500)' : 'var(--text-subtle)' }}>{b.badNews}</td>
                  <td style={{ padding: '13px 8px', borderBottom: '1px solid var(--border-subtle)', textAlign: 'right', fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-brand)' }}>{b.newArticles}</td>
                  <td style={{ padding: '13px 8px', borderBottom: '1px solid var(--border-subtle)' }}>
                    <span style={{ display: 'inline-block', padding: '4px 12px', borderRadius: 'var(--radius-pill)', fontSize: 'var(--text-2xs)', fontWeight: 700, letterSpacing: '0.04em', color: riskColor(b.riskLevel), background: riskSoftBg(b.riskLevel) }}>{riskLabel(b.riskLevel)}</span>
                  </td>
                  <td style={{
                    padding: '13px 8px', borderBottom: '1px solid var(--border-subtle)', fontSize: 'var(--text-xs)', color: 'var(--text-muted)',
                    display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                  }}>{b.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      {/* BRAND DETAIL MODAL */}
      {brandModal && (
        <div onClick={() => setBrandModal(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(36,28,24,0.45)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 32 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--surface-card)', borderRadius: 'var(--radius-xl)', boxShadow: 'var(--shadow-lg)', width: '100%', maxWidth: 720, maxHeight: '84vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '24px 28px', borderBottom: '1px solid var(--border-subtle)' }}>
              <div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-lg)', fontWeight: 600, color: 'var(--seryn-navy)', letterSpacing: 'var(--tracking-tighter)' }}>{brandModal}</div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-subtle)', marginTop: 4 }}>
                  {modalBrand ? <>{modalBrand.badNews} tin xấu · {modalBrand.newArticles} bài viết mới · {fmtDateFull(displayDate)}</> : null}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <button onClick={() => openPdfPreview({
                  title: `Đối thủ — ${brandModal}`,
                  subtitle: `${badNewsRows.length + newArticleRows.length} nguồn có link · Báo cáo ngày ${fmtDateFull(displayDate)}`,
                  items: [...badNewsRows.map(r => ({ ...r, typeLabel: TYPE_LABELS.bad_news })), ...newArticleRows.map(r => ({ ...r, typeLabel: TYPE_LABELS.new_article }))].map(r => ({
                    heading: `[${r.typeLabel}] ${r.heading}`,
                    lines: [r.summary, [r.itemDate, r.channel].filter(Boolean).join(' · '), r.url].filter(Boolean),
                  })),
                  filename: `doi-thu-${brandModal}-${displayDate}.pdf`,
                })} style={{ border: '1px solid var(--border-default)', background: 'var(--surface-card)', borderRadius: 'var(--radius-pill)', padding: '7px 16px', fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-brand)', cursor: 'pointer', whiteSpace: 'nowrap' }}>Xuất file PDF</button>
                <button onClick={() => setBrandModal(null)} style={{ border: 'none', background: 'var(--ivory-200)', width: 32, height: 32, borderRadius: '50%', cursor: 'pointer', fontSize: 16, color: 'var(--text-muted)', lineHeight: 1 }}>×</button>
              </div>
            </div>
            <div style={{ overflowY: 'auto', padding: '8px 28px 24px' }}>
              {modalBrand && modalBrand.note && (
                <div style={{ margin: '14px 0', padding: '12px 14px', borderRadius: 'var(--radius-md)', background: riskSoftBg(modalBrand.riskLevel), fontSize: 'var(--text-sm)', color: 'var(--text-body)' }}>{modalBrand.note}</div>
              )}
              {badNewsRows.length > 0 && (
                <>
                  <div style={{ fontSize: 'var(--text-2xs)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wider)', color: 'var(--text-muted)', fontWeight: 600, margin: '18px 0 8px' }}>Tin xấu / vi phạm ({badNewsRows.length})</div>
                  {badNewsRows.map(r => (
                    <a key={r.key} href={r.url} target="_blank" rel="noopener noreferrer" style={{ display: 'block', padding: '12px 0', borderBottom: '1px solid var(--border-subtle)', textDecoration: 'none' }}>
                      <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-body)' }}>{r.heading}</div>
                      {r.summary && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginTop: 3, lineHeight: 'var(--leading-snug)' }}>{r.summary}</div>}
                      <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-subtle)', marginTop: 4 }}>{r.itemDate}{r.domain ? ` · ${r.domain}` : ''}</div>
                    </a>
                  ))}
                </>
              )}
              {newArticleRows.length > 0 && (
                <>
                  <div style={{ fontSize: 'var(--text-2xs)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wider)', color: 'var(--text-muted)', fontWeight: 600, margin: '18px 0 8px' }}>Bài viết mới ({newArticleRows.length})</div>
                  {newArticleRows.map(r => (
                    <a key={r.key} href={r.url} target="_blank" rel="noopener noreferrer" style={{ display: 'block', padding: '12px 0', borderBottom: '1px solid var(--border-subtle)', textDecoration: 'none' }}>
                      <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-body)' }}>{r.heading}</div>
                      {r.summary && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginTop: 3, lineHeight: 'var(--leading-snug)' }}>{r.summary}</div>}
                      <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-subtle)', marginTop: 4 }}>{r.itemDate}{r.channel ? ` · ${r.channel}` : ''}{r.domain ? ` · ${r.domain}` : ''}</div>
                    </a>
                  ))}
                </>
              )}
              {badNewsRows.length === 0 && newArticleRows.length === 0 && (
                <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-subtle)', fontSize: 'var(--text-sm)' }}>Không có nguồn nào có link hợp lệ cho thương hiệu này trong báo cáo ngày {fmtDateFull(displayDate)}.</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* STAT DETAIL MODAL — click-through from the 4 KPI cards above */}
      {statModalOpen && (
        <div onClick={() => setStatModal(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(36,28,24,0.45)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 32 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--surface-card)', borderRadius: 'var(--radius-xl)', boxShadow: 'var(--shadow-lg)', width: '100%', maxWidth: 680, maxHeight: '80vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '24px 28px', borderBottom: '1px solid var(--border-subtle)' }}>
              <div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-lg)', fontWeight: 600, color: 'var(--seryn-navy)', letterSpacing: 'var(--tracking-tighter)' }}>{statModalTitle}</div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-subtle)', marginTop: 4 }}>{statModalRows.length} mục</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <button onClick={() => openPdfPreview({
                  title: statModalTitle,
                  subtitle: `${statModalRows.length} mục · Báo cáo ngày ${fmtDateFull(displayDate)} · Seryn Clinic`,
                  items: statModalRows.map(r => ({ heading: r.heading, lines: r.lines })),
                  filename: `doi-thu-thong-ke-${statModal}-${displayDate || 'moi-nhat'}.pdf`,
                })} style={{ border: '1px solid var(--border-default)', background: 'var(--surface-card)', borderRadius: 'var(--radius-pill)', padding: '7px 16px', fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-brand)', cursor: 'pointer', whiteSpace: 'nowrap' }}>Xuất file PDF</button>
                <button onClick={() => setStatModal(null)} style={{ border: 'none', background: 'var(--ivory-200)', width: 32, height: 32, borderRadius: '50%', cursor: 'pointer', fontSize: 16, color: 'var(--text-muted)', lineHeight: 1 }}>×</button>
              </div>
            </div>
            <div style={{ overflowY: 'auto', padding: '8px 28px 24px' }}>
              {statModalRows.length > 0 ? statModalRows.map((r, i) => {
                const inner = (
                  <>
                    <span style={{ width: 8, height: 8, minWidth: 8, marginTop: 6, borderRadius: '50%', background: r.dotColor }} />
                    <span style={{ flex: '1 1 0%', minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-body)' }}>{r.heading}</span>
                      {r.lines.map((line, li) => (
                        <span key={li} style={{ display: 'block', fontSize: li === 0 ? 'var(--text-xs)' : 'var(--text-2xs)', color: li === 0 ? 'var(--text-muted)' : 'var(--text-subtle)', marginTop: 3, lineHeight: 'var(--leading-snug)' }}>{line}</span>
                      ))}
                    </span>
                  </>
                );
                return r.url ? (
                  <a key={r.key ?? i} href={r.url} target="_blank" rel="noopener noreferrer" style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '14px 0', borderBottom: '1px solid var(--border-subtle)', textDecoration: 'none' }}>{inner}</a>
                ) : (
                  <div key={r.key ?? i} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '14px 0', borderBottom: '1px solid var(--border-subtle)' }}>{inner}</div>
                );
              }) : (
                <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-subtle)', fontSize: 'var(--text-sm)' }}>
                  {statModalLoading ? 'Đang tải…' : 'Không có dữ liệu cho mục này trong báo cáo ngày ' + (displayDate ? fmtDateFull(displayDate) : '') + '.'}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <PdfPreviewModal pdfPreview={pdfPreview} onClose={closePdfPreview} />

      <div style={{ maxWidth: 1360, margin: '0 auto', padding: '0 40px 56px', textAlign: 'center' }}>
        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-subtle)' }}>Dữ liệu tổng hợp tự động từ thư mục báo cáo giám sát đối thủ hằng ngày · Phòng khám đa khoa Seryn</p>
      </div>
    </div>
  );
}
