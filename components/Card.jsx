'use client';

const ELEVATIONS = {
  sm: 'var(--shadow-sm)',
  md: 'var(--shadow-md)',
  lg: 'var(--shadow-lg)',
};

export default function Card({ elevation = 'sm', onClick, style, children }) {
  return (
    <div
      onClick={onClick}
      style={{
        background: 'var(--surface-card)',
        borderRadius: 'var(--radius-xl)',
        boxShadow: ELEVATIONS[elevation] || ELEVATIONS.sm,
        padding: 24,
        ...style,
      }}
    >
      {children}
    </div>
  );
}
