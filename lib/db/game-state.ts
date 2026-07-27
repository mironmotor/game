import 'server-only';

import { and, eq, sql } from 'drizzle-orm';

import { getDb, type Database } from './index';
import {
  createEmptyGameStateSnapshot,
  gameStates,
  type GameStateSnapshot,
  userProfiles,
} from './schema';

export const MAX_GAME_STATE_SNAPSHOT_BYTES = 3 * 1024 * 1024;

const stateSelection = {
  snapshot: gameStates.snapshot,
  version: gameStates.version,
  updatedAt: gameStates.updatedAt,
};

export interface StoredGameState {
  snapshot: GameStateSnapshot;
  version: number;
  updatedAt: Date;
  isNew: boolean;
}

export interface StoredUserProfile {
  locale: string;
  displayName: string | null;
  timeZone: string | null;
}

export class GameStateConflictError extends Error {
  constructor(
    readonly expectedVersion: number,
    readonly currentVersion: number | null,
  ) {
    super(
      currentVersion === null
        ? 'Game state does not exist.'
        : `Game state changed concurrently (expected version ${expectedVersion}, current version ${currentVersion}).`,
    );
    this.name = 'GameStateConflictError';
  }
}

export class GameStateTooLargeError extends Error {
  constructor(readonly byteLength: number) {
    super(`Game state is ${byteLength} bytes; the limit is ${MAX_GAME_STATE_SNAPSHOT_BYTES} bytes.`);
    this.name = 'GameStateTooLargeError';
  }
}

function assertValidUserId(userId: string): void {
  if (!userId.trim()) throw new TypeError('userId must not be empty.');
}

function assertSnapshotSize(snapshot: GameStateSnapshot): void {
  const byteLength = new TextEncoder().encode(JSON.stringify(snapshot)).byteLength;
  if (byteLength > MAX_GAME_STATE_SNAPSHOT_BYTES) {
    throw new GameStateTooLargeError(byteLength);
  }
}

/** Race-safe lazy creation for a user that already exists in auth_users. */
export async function ensureGameState(
  userId: string,
  database: Database = getDb(),
): Promise<StoredGameState> {
  assertValidUserId(userId);

  const [created] = await database
    .insert(gameStates)
    .values({ userId, snapshot: createEmptyGameStateSnapshot() })
    .onConflictDoNothing({ target: gameStates.userId })
    .returning(stateSelection);

  if (created) return { ...created, isNew: true };

  const [existing] = await database
    .select(stateSelection)
    .from(gameStates)
    .where(eq(gameStates.userId, userId))
    .limit(1);

  if (!existing) throw new GameStateConflictError(1, null);
  return { ...existing, isNew: false };
}

/**
 * Creates profile/state rows on first authenticated use. The inserts are
 * independently idempotent, so a retry repairs a partially completed request.
 */
export async function ensureUserData(
  userId: string,
  profile: { displayName?: string | null; locale?: string; timeZone?: string | null } = {},
  database: Database = getDb(),
): Promise<StoredGameState> {
  assertValidUserId(userId);

  await database
    .insert(userProfiles)
    .values({
      userId,
      displayName: profile.displayName,
      locale: profile.locale,
      timeZone: profile.timeZone,
    })
    .onConflictDoNothing({ target: userProfiles.userId });

  return ensureGameState(userId, database);
}

export async function loadUserProfile(
  userId: string,
  database: Database = getDb(),
): Promise<StoredUserProfile | null> {
  assertValidUserId(userId);
  const [profile] = await database
    .select({
      locale: userProfiles.locale,
      displayName: userProfiles.displayName,
      timeZone: userProfiles.timeZone,
    })
    .from(userProfiles)
    .where(eq(userProfiles.userId, userId))
    .limit(1);
  return profile ?? null;
}

export async function saveUserLocale(
  userId: string,
  locale: string,
  database: Database = getDb(),
): Promise<void> {
  assertValidUserId(userId);
  await database
    .update(userProfiles)
    .set({ locale, updatedAt: new Date() })
    .where(eq(userProfiles.userId, userId));
}

export async function loadGameState(
  userId: string,
  database: Database = getDb(),
): Promise<StoredGameState> {
  assertValidUserId(userId);

  const [state] = await database
    .select(stateSelection)
    .from(gameStates)
    .where(eq(gameStates.userId, userId))
    .limit(1);

  return state ? { ...state, isNew: false } : ensureGameState(userId, database);
}

/**
 * Optimistic write: callers must send the version they loaded. Exactly one of
 * two concurrent browser tabs wins; the other gets GameStateConflictError and
 * can reload before retrying instead of silently overwriting newer data.
 */
export async function saveGameState(
  userId: string,
  snapshot: GameStateSnapshot,
  expectedVersion: number,
  database: Database = getDb(),
): Promise<StoredGameState> {
  assertValidUserId(userId);
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
    throw new TypeError('expectedVersion must be a positive integer.');
  }
  assertSnapshotSize(snapshot);

  const [saved] = await database
    .update(gameStates)
    .set({
      snapshot,
      version: sql`${gameStates.version} + 1`,
      updatedAt: new Date(),
    })
    .where(and(eq(gameStates.userId, userId), eq(gameStates.version, expectedVersion)))
    .returning(stateSelection);

  if (saved) return { ...saved, isNew: false };

  const [current] = await database
    .select({ version: gameStates.version })
    .from(gameStates)
    .where(eq(gameStates.userId, userId))
    .limit(1);

  throw new GameStateConflictError(expectedVersion, current?.version ?? null);
}
