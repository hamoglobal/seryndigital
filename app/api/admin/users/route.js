// app/api/admin/users/route.js
//
// Admin-only user management API backing the /admin page:
//   GET   -> list every Google account that has ever signed in, with role.
//   PATCH -> change one user's role (pending | viewer | admin).
// Both are gated on the caller's own session role — middleware.js already
// keeps non-admins out of /admin pages, but API routes are matched too, and
// we double-check here since this route can be hit directly.
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { listUsers, setUserRole, getUserByEmail } from '@/lib/usersStore';

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email || session.user.role !== 'admin') return null;
  return session;
}

export async function GET() {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return NextResponse.json({ users: listUsers(), me: session.user.email });
}

export async function PATCH(req) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json().catch(() => null);
  const email = body?.email;
  const role = body?.role;
  if (!email || !role) {
    return NextResponse.json({ error: 'Missing email or role' }, { status: 400 });
  }

  // Guard rail: don't let the last admin demote themselves and lock everyone out.
  if (email.toLowerCase() === session.user.email.toLowerCase() && role !== 'admin') {
    const admins = listUsers().filter(u => u.role === 'admin');
    if (admins.length <= 1) {
      return NextResponse.json({ error: 'Không thể tự hạ quyền — bạn là admin cuối cùng.' }, { status: 400 });
    }
  }

  try {
    const updated = await setUserRole(email, role);
    return NextResponse.json({ user: updated });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
