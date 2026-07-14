'use client';

// components/PdfPreviewModal.jsx
// Shared "preview before download" modal for the "Xuất file PDF" buttons
// across the dashboard and the "Đối Thủ" (competitor) page. Renders the
// already-built PDF (as a blob: URL) in an <iframe> — modern browsers show
// their native PDF viewer inline — with explicit "Tải xuống" / "Đóng"
// actions, rather than downloading immediately on click.
import { downloadPdf } from '@/lib/exportPdf';

export default function PdfPreviewModal({ pdfPreview, onClose }) {
  if (!pdfPreview) return null;
  const { url, filename, doc } = pdfPreview;

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(36,28,24,0.55)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: 32 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--surface-card)', borderRadius: 'var(--radius-xl)', boxShadow: 'var(--shadow-lg)', width: '100%', maxWidth: 820, height: '86vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 24px', borderBottom: '1px solid var(--border-subtle)' }}>
          <div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-lg)', fontWeight: 600, color: 'var(--seryn-navy)', letterSpacing: 'var(--tracking-tighter)' }}>Xem trước PDF</div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-subtle)', marginTop: 3 }}>{filename}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button onClick={() => downloadPdf(doc, filename)} style={{ border: 'none', background: 'var(--seryn-navy)', color: '#fff', borderRadius: 'var(--radius-pill)', padding: '9px 20px', fontSize: 'var(--text-sm)', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>Tải xuống</button>
            <button onClick={onClose} style={{ border: 'none', background: 'var(--ivory-200)', width: 34, height: 34, borderRadius: '50%', cursor: 'pointer', fontSize: 16, color: 'var(--text-muted)', lineHeight: 1 }}>×</button>
          </div>
        </div>
        <div style={{ flex: '1 1 0%', background: 'var(--ivory-200)' }}>
          <iframe src={url} title="PDF preview" style={{ width: '100%', height: '100%', border: 'none' }} />
        </div>
      </div>
    </div>
  );
}
