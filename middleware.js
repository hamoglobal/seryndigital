// middleware.js
//
// Gate: every route requires a signed-in Google account, except /login,
// /pending, /api/auth/* (NextAuth's own endpoints) and static assets.
// A 'pending' user (logged in, not yet approved by an admin) is confined to
// /pending. /admin is further restricted to role 'admin'.
//
// Runs on the Edge runtime, so it can only read the already-signed JWT
// (getToken, secret-based, no filesystem/DB access) — see lib/auth.js's jwt
// callback for where token.role actually comes from.
import { NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';

const PUBLIC_PREFIXES = ['/login', '/api/auth', '/assets', '/fonts'];

export async function middleware(req) {
  const { pathname } = req.nextUrl;

  if (PUBLIC_PREFIXES.some(p => pathname === p || pathname.startsWith(p + '/'))) {
    return NextResponse.next();
  }

  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });

  if (!token) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    if (pathname !== '/') url.searchParams.set('callbackUrl', pathname);
    return NextResponse.redirect(url);
  }

  const role = token.role || 'pending';

  if (role === 'pending' && pathname !== '/pending') {
    const url = req.nextUrl.clone();
    url.pathname = '/pending';
    return NextResponse.redirect(url);
  }

  if (role !== 'pending' && pathname === '/pending') {
    const url = req.nextUrl.clone();
    url.pathname = '/';
    return NextResponse.redirect(url);
  }

  if (pathname.startsWith('/admin') && role !== 'admin') {
    const url = req.nextUrl.clone();
    url.pathname = '/';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|assets|fonts).*)'],
};
