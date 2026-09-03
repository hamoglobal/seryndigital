// lib/auth.js
//
// NextAuth (v4) configuration: Google is the only sign-in method. Access
// role ('pending' | 'viewer' | 'admin') is NOT part of Google's identity —
// it's looked up from lib/usersStore.js (data/export/users.json) and
// stamped onto the JWT so middleware.js can read it without touching the
// filesystem (middleware runs on the Edge runtime, which can't use fs).
import GoogleProviderModule from 'next-auth/providers/google';
import { upsertUserOnLogin, getUserByEmail } from './usersStore.js';

// This project's package.json sets "type": "module", which changes how
// Next.js's server webpack bundle interops with next-auth's CJS provider
// packages — the plain default import can come through as the whole module
// namespace object instead of the function itself, which broke `next build`
// with "TypeError: n is not a function" when GoogleProvider(...) was called.
// Unwrapping .default defensively here fixes it in both bundling shapes.
const GoogleProvider = GoogleProviderModule.default || GoogleProviderModule;

export const authOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
  ],
  session: { strategy: 'jwt' },
  pages: {
    signIn: '/login',
  },
  callbacks: {
    async signIn({ user }) {
      if (!user?.email) return false;
      await upsertUserOnLogin({ email: user.email, name: user.name, image: user.image });
      return true;
    },
    // Runs at sign-in, and again whenever the client re-checks the session
    // (useSession()/getSession() -> GET /api/auth/session) — so a role an
    // admin just changed reaches an already-logged-in user without them
    // needing to sign out first.
    async jwt({ token, user }) {
      if (user?.email) token.email = user.email;
      if (token.email) {
        const record = getUserByEmail(token.email);
        token.role = record?.role || 'pending';
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.email = token.email;
        session.user.role = token.role || 'pending';
      }
      return session;
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
};
