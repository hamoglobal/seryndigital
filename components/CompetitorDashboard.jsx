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
import { buildListPdf, pdfToPreviewUrl, revokePdfPreviewUrl } from '@/lib/exportPdf';
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

export default function CompetitorDashboard() {
  const [dates, setDates] = useState(null);
  const [selectedDate, setSelectedDate] = useState(null);
  const [brandData, setBrandData] = useState(null); // { date, brands }
  const [loadError, setLoadError] = useState(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [brandModal, setBrandModal] = useState(null); // brand name
  const [brandItems, setBrandItems] = useState(null);
  const [pdfPreview, setPdfPreview] = useState(null);

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

  async function openPdfPreview({ title, subtitle, items, filename }) {
    const doc = await buildListPdf({ title, subtitle, items });
    const url = pdfToPreviewUrl(doc);
    setPdfPreview(prev => { if (prev) revokePdfPreviewUrl(prev.url); return { url, filename, doc }; });
  }
  function closePdfPreview() {
    setPdfPreview(prev => { if (prev) revokePdfPreviewUrl(prev.url); return null; });
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
  const badNewsItems = (brandItems || []).filter(i => i.type === 'bad_news');
  const newArticleItems = (brandItems || []).filter(i => i.type === 'new_article');

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
        <span style={{ display: 'inline-block', fontFamily: 'var(--font-sans)', fontSize: 'var(--text-xs)', fontWeight: 600, letterSpacing: 'var(--tracking-widest)', textTransform: 'uppercase', color: 'var(--text-brand)', marginBottom: 14 }}>Giám sát đối thủ</span>
        <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 600, letterSpacing: 'var(--tracking-tighter)', fontSize: 'clamp(32px,4vw,46px)', lineHeight: 'var(--leading-tight)', margin: 0, color: 'var(--seryn-navy)' }}>Theo dõi 14 thương hiệu thẩm mỹ cạnh tranh</h1>
        <p style={{ fontSize: 'var(--text-md)', color: 'var(--text-muted)', margin: '14px 0 0', maxWidth: 640, lineHeight: 'var(--leading-relaxed)' }}>Tin xấu / vi phạm pháp lý và bài viết mới của các thương hiệu thẩm mỹ cạnh tranh, tổng hợp từ Google, báo chí và mạng xã hội.</p>
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
          <Card elevation="sm" style={{ minHeight: 120 }}>
            <div style={{ fontSize: 'var(--text-2xs)', letterSpacing: 'var(--tracking-wider)', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600, marginBottom: 10 }}>Thương hiệu theo dõi</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-3xl)', fontWeight: 600, color: 'var(--seryn-navy)', lineHeight: 1 }}>{brands.length}</div>
          </Card>
          <Card elevation="sm" style={{ minHeight: 120 }}>
            <div style={{ fontSize: 'var(--text-2xs)', letterSpacing: 'var(--tracking-wider)', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600, marginBottom: 10 }}>Rủi ro cao</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-3xl)', fontWeight: 600, color: 'var(--danger-500)', lineHeight: 1 }}>{highCount}</div>
          </Card>
          <Card elevation="sm" style={{ minHeight: 120 }}>
            <div style={{ fontSize: 'var(--text-2xs)', letterSpacing: 'var(--tracking-wider)', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600, marginBottom: 10 }}>Tin xấu / vi phạm</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-3xl)', fontWeight: 600, color: 'var(--seryn-navy)', lineHeight: 1 }}>{totalBadNews}</div>
          </Card>
          <Card elevation="sm" style={{ minHeight: 120 }}>
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
                  subtitle: `${(brandItems || []).length} mục · Báo cáo ngày ${fmtDateFull(displayDate)}`,
                  items: (brandItems || []).map(it => ({
                    heading: `[${TYPE_LABELS[it.type] || it.type}] ${it.title || it.summary?.slice(0, 60) || '(không có tiêu đề)'}`,
                    lines: [it.summary, [it.itemDate, it.channel].filter(Boolean).join(' · '), it.url].filter(Boolean),
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
              {badNewsItems.length > 0 && (
                <>
                  <div style={{ fontSize: 'var(--text-2xs)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wider)', color: 'var(--text-muted)', fontWeight: 600, margin: '18px 0 8px' }}>Tin xấu / vi phạm ({badNewsItems.length})</div>
                  {badNewsItems.map((it, i) => (
                    <a key={i} href={it.url} target="_blank" rel="noopener noreferrer" style={{ display: 'block', padding: '12px 0', borderBottom: '1px solid var(--border-subtle)', textDecoration: 'none' }}>
                      <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-body)' }}>{it.title}</div>
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginTop: 3, lineHeight: 'var(--leading-snug)' }}>{it.summary}</div>
                      <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-subtle)', marginTop: 4 }}>{it.itemDate}{it.domain ? ` · ${it.domain}` : ''}</div>
                    </a>
                  ))}
                </>
              )}
              {newArticleItems.length > 0 && (
                <>
                  <div style={{ fontSize: 'var(--text-2xs)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wider)', color: 'var(--text-muted)', fontWeight: 600, margin: '18px 0 8px' }}>Bài viết mới ({newArticleItems.length})</div>
                  {newArticleItems.map((it, i) => (
                    <a key={i} href={it.url} target="_blank" rel="noopener noreferrer" style={{ display: 'block', padding: '12px 0', borderBottom: '1px solid var(--border-subtle)', textDecoration: 'none' }}>
                      <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-body)' }}>{it.title}</div>
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginTop: 3, lineHeight: 'var(--leading-snug)' }}>{it.summary}</div>
                      <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-subtle)', marginTop: 4 }}>{it.itemDate}{it.channel ? ` · ${it.channel}` : ''}{it.domain ? ` · ${it.domain}` : ''}</div>
                    </a>
                  ))}
                </>
              )}
              {badNewsItems.length === 0 && newArticleItems.length === 0 && (
                <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-subtle)', fontSize: 'var(--text-sm)' }}>Không có mục chi tiết nào cho thương hiệu này trong báo cáo ngày {fmtDateFull(displayDate)}.</div>
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
