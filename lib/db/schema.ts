import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import type { AdapterAccountType } from 'next-auth/adapters';

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface GameTaskSnapshot {
  id: string;
  uid?: string;
  desc: string;
  mgr: 'MGR-1' | 'MGR-2' | 'MGR-3';
  xp: number;
  status: 'pending' | 'active' | 'completed' | 'failed';
  aiAgentEnabled?: boolean;
  aiAgentStatus?: 'idle' | 'running' | 'completed' | 'failed';
  aiAgentResult?: string;
  aiAgentPlan?: string;
  scheduledTime?: string;
  deadline?: string;
  failureHandled?: boolean;
  createdAt?: JsonValue;
  completedAt?: string;
}

export interface GameChatSessionSnapshot {
  id: string;
  title: string;
  mode: string;
  createdAt: JsonValue;
  updatedAt: JsonValue;
}

export interface GameMessageSnapshot {
  id: string;
  sessionId?: string;
  role: 'user' | 'model';
  content: string;
  timestamp: JsonValue;
  imageUrl?: string;
}

export interface DailyXpSnapshot {
  date: string;
  xp: number;
}

export interface MirCoinEntrySnapshot {
  id: string;
  amount: number;
  reason: string;
  ts: string;
}

export interface MirCoinSnapshot {
  balance: number;
  ledger: MirCoinEntrySnapshot[];
}

/**
 * Version 1 mirrors the state currently persisted by useGameState. Keeping it
 * as one document makes the first server sync small and reversible; high-volume
 * chat history can be normalized in a later migration without blocking launch.
 */
export interface GameStateSnapshot {
  xp: number;
  tasks: GameTaskSnapshot[];
  messages: GameMessageSnapshot[];
  sessions: GameChatSessionSnapshot[];
  dailyHistory: DailyXpSnapshot[];
  lastLaunch: string | null;
  mirCoin: MirCoinSnapshot;
}

export const GAME_STATE_SCHEMA_VERSION = 1;

export function createEmptyGameStateSnapshot(): GameStateSnapshot {
  return {
    xp: 0,
    tasks: [],
    messages: [],
    sessions: [],
    dailyHistory: [],
    lastLaunch: null,
    mirCoin: {
      balance: 500,
      ledger: [],
    },
  };
}

// Auth.js owns these four tables. auth_users is the canonical GAME identity;
// Google and future OAuth providers are linked rows in auth_accounts.
export const authUsers = pgTable('auth_users', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text('name'),
  email: text('email').unique(),
  emailVerified: timestamp('email_verified', { mode: 'date', withTimezone: true }),
  image: text('image'),
});

export const authAccounts = pgTable(
  'auth_accounts',
  {
    userId: text('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    type: text('type').$type<AdapterAccountType>().notNull(),
    provider: text('provider').notNull(),
    providerAccountId: text('provider_account_id').notNull(),
    refresh_token: text('refresh_token'),
    access_token: text('access_token'),
    expires_at: integer('expires_at'),
    token_type: text('token_type'),
    scope: text('scope'),
    id_token: text('id_token'),
    session_state: text('session_state'),
  },
  (account) => [
    primaryKey({ columns: [account.provider, account.providerAccountId] }),
    index('auth_accounts_user_id_idx').on(account.userId),
  ],
);

export const authSessions = pgTable(
  'auth_sessions',
  {
    sessionToken: text('session_token').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    expires: timestamp('expires', { mode: 'date', withTimezone: true }).notNull(),
  },
  (session) => [index('auth_sessions_user_id_idx').on(session.userId)],
);

export const authVerificationTokens = pgTable(
  'auth_verification_tokens',
  {
    identifier: text('identifier').notNull(),
    token: text('token').notNull(),
    expires: timestamp('expires', { mode: 'date', withTimezone: true }).notNull(),
  },
  (token) => [primaryKey({ columns: [token.identifier, token.token] })],
);

export const userProfiles = pgTable('user_profiles', {
  userId: text('user_id')
    .primaryKey()
    .references(() => authUsers.id, { onDelete: 'cascade' }),
  displayName: text('display_name'),
  locale: text('locale').notNull().default('en'),
  timeZone: text('time_zone'),
  createdAt: timestamp('created_at', { mode: 'date', withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const gameStates = pgTable(
  'game_states',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    snapshot: jsonb('snapshot')
      .$type<GameStateSnapshot>()
      .notNull()
      .default(createEmptyGameStateSnapshot()),
    version: integer('version').notNull().default(GAME_STATE_SCHEMA_VERSION),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (state) => [check('game_states_version_positive', sql`${state.version} >= 1`)],
);

/**
 * Append-only, idempotent ledger. A balance is 500 plus SUM(amount), matching
 * the current local wallet while retaining an auditable reason for every entry.
 */
export const mirCoinEntries = pgTable(
  'mircoin_entries',
  {
    userId: text('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    id: text('id').notNull(),
    amount: integer('amount').notNull(),
    reason: text('reason').notNull(),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (entry) => [
    primaryKey({ columns: [entry.userId, entry.id] }),
    index('mircoin_entries_user_created_idx').on(entry.userId, entry.createdAt),
    check('mircoin_entries_amount_nonzero', sql`${entry.amount} <> 0`),
  ],
);
