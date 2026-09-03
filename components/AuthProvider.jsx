'use client';

// components/AuthProvider.jsx
// Wraps the app in NextAuth's client SessionProvider so useSession()/signIn()/
// signOut() work in any client component. Needs its own file because
// app/layout.jsx is a server component and can't use 'use client' directly.
import { SessionProvider } from 'next-auth/react';

export default function AuthProvider({ children }) {
  return <SessionProvider>{children}</SessionProvider>;
}
