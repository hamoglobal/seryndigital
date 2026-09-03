'use client';

// app/pending/page.jsx
// Shown to a user who has signed in with Google but whose role is still
// 'pending' — middleware.js confines them here until an admin sets a role
// on the /admin page.
import { signOut, useSession } from 'next-auth/react';

export default function PendingPage() {
  const { data: session } = useSession();

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(180deg, var(--bg-page) 0%, var(--ivory-200) 100%)', padding: 24,
    }}>
      <div style={{
        width: '100%', maxWidth: 440, background: 'var(--surface-card)', borderRadius: 'var(--radius-lg, 20px)',
        border: '1px solid var(--border-subtle)', boxShadow: '0 20px 60px -20px rgba(27,35,80,0.25)',
        padding: '44px 40px', textAlign: 'center',
      }}>
        <div style={{
          width: 56, height: 56, borderRadius: '50%', background: 'var(--warning-100)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px', fontSize: 26,
        }}>
          ⏳
        </div>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-xl)', color: 'var(--seryn-navy)', margin: '0 0 10px' }}>
          Đang chờ admin duyệt
        </h1>
        <p style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--text-md)', color: 'var(--text-body)', margin: '0 0 6px' }}>
          Tài khoản <strong>{session?.user?.email}</strong> đã đăng nhập thành công.
        </p>
        <p style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--text-sm)', color: 'var(--text-muted)', margin: '0 0 28px' }}>
          Vui lòng chờ admin cấp quyền truy cập. Trang này sẽ tự mở khi bạn được duyệt — hãy tải lại sau vài phút.
        </p>
        <button
          onClick={() => signOut({ callbackUrl: '/login' })}
          style={{
            padding: '11px 24px', borderRadius: 'var(--radius-pill)', border: '1px solid var(--border-default)',
            background: 'transparent', cursor: 'pointer', fontFamily: 'var(--font-sans)', fontSize: 'var(--text-sm)',
            fontWeight: 600, color: 'var(--text-muted)',
          }}
        >
          Đăng xuất
        </button>
      </div>
    </div>
  );
}
