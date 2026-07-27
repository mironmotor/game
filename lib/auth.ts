import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import { authBasePath } from '@/lib/base-path';
import { createAuthAdapter } from '@/lib/db/auth-adapter';

// NextAuth v5 (Auth.js). Reads AUTH_SECRET, AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET
// from the environment automatically. Configuration is lazy so builds do not
// need a database connection; Google sign-in is exposed only when persistence
// and all OAuth secrets are configured.
export const { handlers, signIn, signOut, auth } = NextAuth(() => {
  const databaseReady = Boolean(process.env.DATABASE_URL?.trim());
  // Google sign-in works with stateless JWT sessions — a database is NOT
  // required (the adapter/persistence is a bonus when DATABASE_URL is set).
  const googleReady = Boolean(
    process.env.AUTH_SECRET?.trim() &&
      process.env.AUTH_GOOGLE_ID?.trim() &&
      process.env.AUTH_GOOGLE_SECRET?.trim(),
  );

  return {
    adapter: databaseReady ? createAuthAdapter() : undefined,
    session: { strategy: databaseReady ? 'database' : 'jwt' },
    providers: googleReady ? [Google] : [],
    basePath: authBasePath,
    // За nginx/туннелем Auth.js должен доверять Host/X-Forwarded-Proto, иначе
    // secure-куки и redirect_uri считаются неверно → InvalidCheck pkce на колбэке.
    trustHost: true,
    callbacks: {
      session({ session, user }) {
        if (user?.id) session.user.id = user.id;
        return session;
      },
    },
  };
});
