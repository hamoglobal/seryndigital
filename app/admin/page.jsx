'use client';

// app/admin/page.jsx
// Admin-only: list of every Google account that has ever signed in, with a
// per-row role selector (pending / viewer / admin). Backed by
// app/api/admin/users/route.js. middleware.js already blocks non-admins
// from reaching this route; the API double-checks server-side too.
import { useEffect, useState } from 'react';
import TopNav from '@/components/TopNav';

const ROLE_LABEL = {
  pending: 'Chờ duyệt',
  viewer: 'Xem (Viewer)',
  admin: 'Admin',
};
const ROLE_COLOR = {
  pending: { bg: 'var(--warning-100)', fg: 'var(--warning-500)' },
  viewer: { bg: 'var(--seryn-navy-soft)', fg: 'var(--seryn-navy)' },
  admin: { bg: 'var(--success-100)', fg: 'var(--success-500)' },
};

function fmt(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('vi-VN', { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

export default function AdminPage() {
  const [users, setUsers] = useState(null);
  const [me, setMe] = useState(null);
  const [error, setError] = useState('');
  const [savingEmail, setSavingEmail] = useState(null);

  async function load() {
    setError('');
    const res = await fetch('/api/admin/users');
    if (!res.ok) {
      setError('Không thể tải danh sách người dùng.');
      return;
    }
    const data = await res.json();
    setUsers(data.users);
    setMe(data.me);
  }

  useEffect(() => { load(); }, []);

  async function changeRole(email, role) {
    setSavingEmail(email);
    setError('');
    const res = await fetch('/api/admin/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, role }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data?.error || 'Cập nhật quyền thất bại.');
    } else {
      setUsers(prev => prev.map(u => (u.email === email ? data.user : u)));
    }
    setSavingEmail(null);
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-page)' }}>
      <TopNav />
      <div style={{ maxWidth: 1040, margin: '0 auto', padding: '36px 40px 80px' }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-2xl)', color: 'var(--seryn-navy)', margin: '0 0 6px' }}>
          Quản lý người dùng
        </h1>
        <p style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--text-sm)', color: 'var(--text-muted)', margin: '0 0 28px' }}>
          Danh sách các tài khoản Google đã từng đăng nhập vào hệ thống. Chọn quyền cho từng người bên dưới.
        </p>

        {error && (
          <div style={{
            background: 'var(--danger-100)', color: 'var(--danger-500)', padding: '12px 16px', borderRadius: 10,
            fontFamily: 'var(--font-sans)', fontSize: 'var(--text-sm)', marginBottom: 20,
          }}>
            {error}
          </div>
        )}

        {!users ? (
          <p style={{ fontFamily: 'var(--font-sans)', color: 'var(--text-muted)' }}>Đang tải…</p>
        ) : users.length === 0 ? (
          <p style={{ fontFamily: 'var(--font-sans)', color: 'var(--text-muted)' }}>Chưa có ai đăng nhập.</p>
        ) : (
          <div style={{
            background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', borderRadius: 16,
            overflow: 'hidden', boxShadow: 'var(--shadow-sm, 0 1px 2px rgba(0,0,0,0.06))',
          }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-sans)' }}>
              <thead>
                <tr style={{ background: 'var(--ivory-200)' }}>
                  {['Người dùng', 'Đăng nhập lần đầu', 'Đăng nhập gần nhất', 'Quyền'].map(h => (
                    <th key={h} style={{
                      textAlign: 'left', padding: '12px 20px', fontSize: 'var(--text-xs)', fontWeight: 700,
                      color: 'var(--text-muted)', letterSpacing: 'var(--tracking-wider)', textTransform: 'uppercase',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.email} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                    <td style={{ padding: '14px 20px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        {u.image ? (
                          <img src={u.image} alt="" style={{ width: 32, height: 32, borderRadius: '50%' }} />
                        ) : (
                          <div style={{
                            width: 32, height: 32, borderRadius: '50%', background: 'var(--seryn-navy-soft)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: 'var(--seryn-navy)',
                          }}>{(u.name || u.email)[0]?.toUpperCase()}</div>
                        )}
                        <div>
                          <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-body)' }}>
                            {u.name || '—'} {u.email === me && <span style={{ color: 'var(--text-brand)' }}>(bạn)</span>}
                          </div>
                          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>{u.email}</div>
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: '14px 20px', fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>{fmt(u.createdAt)}</td>
                    <td style={{ padding: '14px 20px', fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>{fmt(u.lastLoginAt)}</td>
                    <td style={{ padding: '14px 20px' }}>
                      <select
                        value={u.role}
                        disabled={savingEmail === u.email}
                        onChange={e => changeRole(u.email, e.target.value)}
                        style={{
                          padding: '6px 12px', borderRadius: 'var(--radius-pill)', border: '1px solid var(--border-default)',
                          background: ROLE_COLOR[u.role]?.bg, color: ROLE_COLOR[u.role]?.fg,
                          fontFamily: 'var(--font-sans)', fontSize: 'var(--text-xs)', fontWeight: 700, cursor: 'pointer',
                        }}
                      >
                        {Object.entries(ROLE_LABEL).map(([value, label]) => (
                          <option key={value} value={value}>{label}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
