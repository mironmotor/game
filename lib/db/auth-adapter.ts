import 'server-only';

import { DrizzleAdapter } from '@auth/drizzle-adapter';

import { getDb, type Database } from './index';
import {
  authAccounts,
  authSessions,
  authUsers,
  authVerificationTokens,
} from './schema';

/** Official Auth.js adapter wired to GAME's canonical identity tables. */
export function createAuthAdapter(database: Database = getDb()) {
  return DrizzleAdapter(database, {
    usersTable: authUsers,
    accountsTable: authAccounts,
    sessionsTable: authSessions,
    verificationTokensTable: authVerificationTokens,
  });
}

