'use client';

// components/TopNav.jsx
// Shared top navigation bar for the 2-item menu: "Seryn Digital" (this
// dashboard, "/") and "Đối Thủ" (the competitor-monitoring page, "/doi-thu").
// `statusSlot` lets each page render its own right-aligned status pill
// (e.g. the current risk-level indicator) without duplicating the nav markup.
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV_ITEMS = [
  { href: '/', label: 'Seryn Digital' },
  { href: '/doi-thu', label: 'Đối Thủ' },
];

export default function TopNav({ statusSlot }) {
  const pathname = usePathname();
  return (
    <div style={{ position: 'sticky', top: 0, zIndex: 30, background: 'rgba(251,246,241,0.85)', backdropFilter: 'blur(12px)', borderBottom: '1px solid var(--border-subtle)' }}>
      <div style={{ maxWidth: 1360, margin: '0 auto', padding: '14px 40px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <img src="/assets/logo-mark.png" alt="Seryn" style={{ height: 30, width: 'auto', display: 'block' }} />
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 17, letterSpacing: '0.14em', color: 'var(--seryn-navy)' }}>SERYN</span>
            <span style={{ fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: 600, color: 'var(--text-brand)', letterSpacing: '0.02em' }}>digital</span>
          </div>
          <nav style={{ display: 'flex', gap: 2, background: 'var(--ivory-200)', padding: 4, borderRadius: 'var(--radius-pill)' }}>
            {NAV_ITEMS.map(item => {
              const active = pathname === item.href;
              return (
                <Link key={item.href} href={item.href} style={{
                  textDecoration: 'none', padding: '8px 18px', borderRadius: 'var(--radius-pill)',
                  fontFamily: 'var(--font-sans)', fontSize: 'var(--text-sm)', fontWeight: 600,
                  background: active ? 'var(--surface-card)' : 'transparent',
                  color: active ? 'var(--text-brand)' : 'var(--text-muted)',
                  boxShadow: active ? 'var(--shadow-sm)' : 'none',
                  transition: 'all var(--dur-fast) var(--ease-out)',
                }}>{item.label}</Link>
              );
            })}
          </nav>
        </div>
        {statusSlot}
      </div>
    </div>
  );
}
