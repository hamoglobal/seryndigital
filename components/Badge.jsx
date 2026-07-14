'use client';

const TONES = {
  brand: { bg: 'var(--coral-100)', color: 'var(--text-brand)' },
  gold: { bg: 'var(--gold-100)', color: 'var(--gold-600)' },
};

export default function Badge({ tone = 'brand', style, children }) {
  const c = TONES[tone] || TONES.brand;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '5px 14px',
        borderRadius: 'var(--radius-pill)',
        background: c.bg,
        color: c.color,
        fontSize: 'var(--text-xs)',
        fontWeight: 600,
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {children}
    </span>
  );
}
