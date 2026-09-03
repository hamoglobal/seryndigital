'use client';

// components/TopNav.jsx
// Shared top navigation bar. Base menu is "Seryn Digital" (this dashboard,
// "/") and "Đối Thủ" (the competitor-monitoring page, "/doi-thu"); an
// "Admin" item appears only for signed-in users with role 'admin'.
// `statusSlot` lets each page render its own right-aligned status pill
// (e.g. the current risk-level indicator) without duplicating the nav markup.
// The right side also shows the signed-in user's avatar + a sign-out button.
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';

const NAV_ITEMS = [
  { href: '/', label: 'Seryn Digital' },
  { href: '/doi-thu', label: 'Đối Thủ' },
];

export default function TopNav({ statusSlot }) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === 'admin';
  const navItems = isAdmin ? [...NAV_ITEMS, { href: '/admin', label: 'Admin' }] : NAV_ITEMS;

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
            {navItems.map(item => {
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          {statusSlot}
          {session?.user && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {session.user.image ? (
                <img src={session.user.image} alt="" style={{ width: 28, height: 28, borderRadius: '50%' }} />
              ) : (
                <div style={{
                  width: 28, height: 28, borderRadius: '50%', background: 'var(--seryn-navy-soft)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: 'var(--seryn-navy)',
                }}>{(session.user.name || session.user.email || '?')[0]?.toUpperCase()}</div>
              )}
              <span style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--text-xs)', color: 'var(--text-muted)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {session.user.name || session.user.email}
              </span>
              <button
                onClick={() => signOut({ callbackUrl: '/login' })}
                style={{
                  border: '1px solid var(--border-default)', background: 'transparent', borderRadius: 'var(--radius-pill)',
                  padding: '6px 14px', fontFamily: 'var(--font-sans)', fontSize: 'var(--text-xs)', fontWeight: 600,
                  color: 'var(--text-muted)', cursor: 'pointer',
                }}
              >
                Đăng xuất
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
