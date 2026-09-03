import NextAuthModule from 'next-auth';
import { authOptions } from '@/lib/auth';

// See lib/auth.js's comment on GoogleProvider: this project's
// "type": "module" package.json makes Next's server bundling of next-auth's
// CJS default export unreliable (comes through as the module namespace
// instead of the function itself in some builds) — unwrap defensively.
const NextAuth = NextAuthModule.default || NextAuthModule;

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
