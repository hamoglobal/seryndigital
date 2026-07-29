'use client';

// components/RecommendationsModal.jsx
// "Khuyến nghị Seryn" — in-app presentation of the advisory report built by
// lib/recommendations.js: a verdict ("đã đi đúng hướng chưa?", computed
// against the prior period of the same granularity) plus a mode-appropriate
// recommendation list, driven by whichever Ngày/Tuần/Tháng/Năm period the
// dashboard's own period switcher currently has selected. Styled with the
// same design tokens as the rest of the dashboard. `onExportPdf` hands off
// to Dashboard.jsx, which builds the matching branded PDF
// (lib/exportPdf.js#buildRecommendationsPdf) and opens it in the shared
// PdfPreviewModal — this component only renders the on-screen view.

const TONE_STYLES = {
  danger: { color: 'var(--danger-500)', bg: 'var(--danger-100)', border: 'var(--coral-300)' },
  warning: { color: 'var(--gold-600)', bg: 'var(--gold-100)', border: 'var(--gold-300)' },
  brand: { color: 'var(--text-brand)', bg: 'var(--coral-100)', border: 'var(--coral-300)' },
  success: { color: 'var(--success-500)', bg: 'var(--success-100)', border: '#CFE6D8' },
  navy: { color: 'var(--seryn-navy)', bg: 'var(--seryn-navy-soft)', border: 'var(--seryn-navy-soft)' },
};

function tone(t) { return TONE_STYLES[t] || TONE_STYLES.navy; }

function TagBadge({ label, toneName }) {
  const t = tone(toneName);
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', padding: '3px 11px', borderRadius: 'var(--radius-pill)',
      background: t.bg, color: t.color, fontSize: 'var(--text-2xs)', fontWeight: 700, letterSpacing: '0.03em',
      textTransform: 'uppercase', whiteSpace: 'nowrap',
    }}>{label}</span>
  );
}

function RecoCard({ reco }) {
  const t = tone(reco.tone);
  return (
    <div style={{
      background: 'var(--surface-card)', border: `1px solid var(--border-subtle)`, borderLeft: `3px solid ${t.color}`,
      borderRadius: 'var(--radius-md)', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 6,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <span style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--seryn-navy)', lineHeight: 'var(--leading-snug)' }}>{reco.title}</span>
        <TagBadge label={reco.tag} toneName={reco.tone} />
      </div>
      <p style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--text-muted)', lineHeight: 'var(--leading-relaxed)' }}>{reco.detail}</p>
    </div>
  );
}

function Section({ title, subtitle, items, emptyLabel }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10, gap: 10, flexWrap: 'wrap' }}>
        <h3 style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'var(--text-lg)', color: 'var(--seryn-navy)', margin: 0, letterSpacing: 'var(--tracking-tighter)' }}>{title}</h3>
        <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-subtle)' }}>{subtitle}</span>
      </div>
      {items && items.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {items.map((reco, i) => <RecoCard key={i} reco={reco} />)}
        </div>
      ) : (
        <div style={{ padding: '18px 0', textAlign: 'center', color: 'var(--text-subtle)', fontSize: 'var(--text-sm)' }}>{emptyLabel}</div>
      )}
    </div>
  );
}

/**
 * @param {Object} props
 * @param {Object|null} props.data - result of buildSerynRecommendations(), or null while not yet generated.
 * @param {boolean} props.competitorDataMissing - true if the recommendations were built without competitor data.
 * @param {() => void} props.onClose
 * @param {() => void} props.onExportPdf
 * @param {boolean} props.exporting
 */
export default function RecommendationsModal({ data, competitorDataMissing, onClose, onExportPdf, exporting }) {
  if (!data) return null;
  const verdictT = tone(data.verdict?.tone);

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(36,28,24,0.55)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 32 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--surface-card)', borderRadius: 'var(--radius-xl)', boxShadow: 'var(--shadow-lg)', width: '100%', maxWidth: 860, height: '88vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* HEADER */}
        <div style={{ padding: '22px 28px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
          <div>
            <span style={{ display: 'inline-block', fontSize: 'var(--text-2xs)', fontWeight: 600, letterSpacing: 'var(--tracking-widest)', textTransform: 'uppercase', color: 'var(--text-brand)', marginBottom: 6 }}>Cố vấn Marketing Seryn</span>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-xl)', fontWeight: 600, color: 'var(--seryn-navy)', letterSpacing: 'var(--tracking-tighter)' }}>Khuyến nghị Seryn</div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-subtle)', marginTop: 4 }}>{data.periodLabel}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button onClick={onExportPdf} disabled={exporting} style={{
              border: 'none', background: 'var(--seryn-navy)', color: '#fff', borderRadius: 'var(--radius-pill)',
              padding: '9px 20px', fontSize: 'var(--text-sm)', fontWeight: 600, cursor: exporting ? 'default' : 'pointer',
              whiteSpace: 'nowrap', opacity: exporting ? 0.7 : 1,
            }}>{exporting ? 'Đang tạo PDF…' : 'Xuất file PDF'}</button>
            <button onClick={onClose} style={{ border: 'none', background: 'var(--ivory-200)', width: 34, height: 34, borderRadius: '50%', cursor: 'pointer', fontSize: 16, color: 'var(--text-muted)', lineHeight: 1 }}>×</button>
          </div>
        </div>

        {/* BODY */}
        <div style={{ overflowY: 'auto', padding: '22px 28px 32px', display: 'flex', flexDirection: 'column', gap: 26 }}>

          {/* Verdict — "đã đi đúng hướng chưa?" for the currently-selected Ngày/Tuần/Tháng/Năm period */}
          <div style={{ background: verdictT.bg, border: `1px solid ${verdictT.border}`, borderRadius: 'var(--radius-lg)', padding: '18px 20px' }}>
            <span style={{
              display: 'inline-block', fontSize: 'var(--text-2xs)', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase',
              color: verdictT.color, background: 'var(--surface-card)', borderRadius: 'var(--radius-pill)', padding: '4px 12px', marginBottom: 10,
            }}>{data.verdict?.label}</span>
            <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--text-body)', lineHeight: 'var(--leading-relaxed)' }}>{data.verdict?.reasoning}</p>
            {competitorDataMissing && (
              <p style={{ margin: '10px 0 0', fontSize: 'var(--text-2xs)', color: 'var(--text-subtle)', fontStyle: 'italic' }}>
                * Chưa tải được dữ liệu đối thủ tại thời điểm tạo khuyến nghị — các mục liên quan đến đối thủ có thể chưa đầy đủ.
              </p>
            )}
          </div>

          <Section
            title={data.itemsSectionTitle}
            subtitle={`${data.items?.length || 0} khuyến nghị`}
            items={data.items}
            emptyLabel="Không có khuyến nghị nào cho kỳ này."
          />

          <p style={{ margin: 0, fontSize: 'var(--text-2xs)', color: 'var(--text-subtle)', lineHeight: 'var(--leading-relaxed)', borderTop: '1px solid var(--border-subtle)', paddingTop: 16 }}>
            Khuyến nghị được tổng hợp tự động từ dữ liệu giám sát thương hiệu Seryn và giám sát đối thủ cạnh tranh, theo góc nhìn chuyên gia marketing ngành thẩm mỹ — chăm sóc sức khoẻ. Đây là gợi ý tham khảo, không thay thế tư vấn pháp lý hoặc y khoa chuyên sâu trước khi triển khai.
          </p>
        </div>
      </div>
    </div>
  );
}
