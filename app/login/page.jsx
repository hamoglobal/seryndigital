'use client';

// app/login/page.jsx
// Public sign-in screen — the only page reachable without a session
// (see middleware.js). Google is the sole sign-in method.
import { Suspense } from 'react';
import { signIn, useSession } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.9c1.7-1.56 2.7-3.86 2.7-6.62z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.8.54-1.84.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.98v2.33A9 9 0 0 0 9 18z" />
      <path fill="#FBBC05" d="M3.95 10.7A5.4 5.4 0 0 1 3.67 9c0-.59.1-1.17.28-1.7V4.97H.98A9 9 0 0 0 0 9c0 1.45.35 2.83.98 4.03l2.97-2.33z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .98 4.97l2.97 2.33C4.66 5.17 6.65 3.58 9 3.58z" />
    </svg>
  );
}

function LoginCard() {
  const { status } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get('callbackUrl') || '/';

  useEffect(() => {
    if (status === 'authenticated') router.replace(callbackUrl);
  }, [status, callbackUrl, router]);

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(180deg, var(--bg-page) 0%, var(--ivory-200) 100%)', padding: 24,
    }}>
      <div style={{
        width: '100%', maxWidth: 420, background: 'var(--surface-card)', borderRadius: 'var(--radius-lg, 20px)',
        border: '1px solid var(--border-subtle)', boxShadow: '0 20px 60px -20px rgba(27,35,80,0.25)',
        padding: '44px 40px', textAlign: 'center',
      }}>
        <img src="/assets/logo-mark.png" alt="Seryn" style={{ height: 44, width: 'auto', margin: '0 auto 20px' }} />

        <div style={{
          fontFamily: 'var(--font-sans)', fontSize: 'var(--text-xs)', fontWeight: 700,
          letterSpacing: 'var(--tracking-widest)', color: 'var(--text-brand)', textTransform: 'uppercase',
        }}>
          AI AUTO RESEARCH
        </div>
        <p style={{
          fontFamily: 'var(--font-sans)', fontSize: 'var(--text-sm)', color: 'var(--text-muted)',
          margin: '6px 0 28px',
        }}>
          (Hệ thống lắng nghe &amp; cảnh báo tín hiệu truyền thông)
        </p>

        <h1 style={{
          fontFamily: 'var(--font-display)', fontSize: 'var(--text-2xl)', fontWeight: 600,
          color: 'var(--seryn-navy)', margin: '0 0 10px',
        }}>
          Chào mừng Seryners
        </h1>
        <p style={{
          fontFamily: 'var(--font-sans)', fontSize: 'var(--text-md)', color: 'var(--text-body)',
          margin: '0 0 32px',
        }}>
          Vui lòng đăng nhập để tiếp tục truy cập hệ thống.
        </p>

        <button
          onClick={() => signIn('google', { callbackUrl })}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
            width: '100%', padding: '13px 20px', borderRadius: 'var(--radius-pill)',
            border: '1px solid var(--border-default)', background: '#FFFFFF', cursor: 'pointer',
            fontFamily: 'var(--font-sans)', fontSize: 'var(--text-md)', fontWeight: 600,
            color: 'var(--text-body)', boxShadow: 'var(--shadow-sm, 0 1px 2px rgba(0,0,0,0.06))',
            transition: 'all 0.15s ease',
          }}
        >
          <GoogleIcon />
          Đăng nhập với Google
        </button>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginCard />
    </Suspense>
  );
}
