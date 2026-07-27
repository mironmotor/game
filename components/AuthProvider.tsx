'use client';

import { SessionProvider } from 'next-auth/react';
import { authBasePath } from '@/lib/base-path';

// Wraps the app so client components can use useSession() / signIn / signOut.
export default function AuthProvider({ children }: { children: React.ReactNode }) {
  return <SessionProvider basePath={authBasePath}>{children}</SessionProvider>;
}
