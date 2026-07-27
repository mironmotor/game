import { NextResponse } from 'next/server';
import type { Session } from 'next-auth';

import { auth } from '@/lib/auth';
import {
  DatabaseNotConfiguredError,
  getDb,
} from '@/lib/db';
import {
  GameStateConflictError,
  GameStateTooLargeError,
  ensureUserData,
  loadGameState,
  loadUserProfile,
  saveGameState,
  saveUserLocale,
} from '@/lib/db/game-state';
import type { GameStateSnapshot } from '@/lib/db/schema';
import { canonicalizeLocale } from '@/lib/i18n/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getUserId(session: Session | null): string | null {
  const id = session?.user?.id;
  return typeof id === 'string' && id.trim() ? id : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isGameStateSnapshot(value: unknown): value is GameStateSnapshot {
  if (!isRecord(value)) return false;

  return (
    typeof value.xp === 'number' &&
    Number.isFinite(value.xp) &&
    Array.isArray(value.tasks) &&
    Array.isArray(value.messages) &&
    Array.isArray(value.sessions) &&
    Array.isArray(value.dailyHistory) &&
    (typeof value.lastLaunch === 'string' || value.lastLaunch === null) &&
    isRecord(value.mirCoin) &&
    typeof value.mirCoin.balance === 'number' &&
    Number.isFinite(value.mirCoin.balance) &&
    Array.isArray(value.mirCoin.ledger)
  );
}

function unavailable(error: unknown) {
  if (error instanceof DatabaseNotConfiguredError) {
    return NextResponse.json(
      { error: 'database_not_configured' },
      { status: 503 },
    );
  }

  console.error('[game-state] database error', error);
  return NextResponse.json({ error: 'database_unavailable' }, { status: 503 });
}

export async function GET(request: Request) {
  const session = await auth();
  const userId = getUserId(session);
  if (!userId) {
    return NextResponse.json({ error: 'authentication_required' }, { status: 401 });
  }

  try {
    const database = getDb();
    const requestLocale = canonicalizeLocale(request.headers.get('x-game-locale'));
    const state = await ensureUserData(
      userId,
      {
        displayName: session?.user?.name,
        locale: requestLocale,
      },
      database,
    );
    const profile = await loadUserProfile(userId, database);

    return NextResponse.json({
      state: state.snapshot,
      version: state.version,
      isNew: state.isNew,
      locale: profile?.locale || requestLocale,
      updatedAt: state.updatedAt.toISOString(),
    });
  } catch (error) {
    return unavailable(error);
  }
}

export async function PUT(request: Request) {
  const session = await auth();
  const userId = getUserId(session);
  if (!userId) {
    return NextResponse.json({ error: 'authentication_required' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  if (!isRecord(body) || !isGameStateSnapshot(body.state)) {
    return NextResponse.json({ error: 'invalid_game_state' }, { status: 400 });
  }

  const expectedVersion = body.version;
  if (!Number.isInteger(expectedVersion) || (expectedVersion as number) < 1) {
    return NextResponse.json({ error: 'invalid_version' }, { status: 400 });
  }

  try {
    const locale = typeof body.locale === 'string' ? canonicalizeLocale(body.locale) : null;
    const saved = await saveGameState(
      userId,
      body.state,
      expectedVersion as number,
    );
    if (locale) await saveUserLocale(userId, locale);

    return NextResponse.json({
      state: saved.snapshot,
      version: saved.version,
      ...(locale ? { locale } : {}),
      updatedAt: saved.updatedAt.toISOString(),
    });
  } catch (error) {
    if (error instanceof GameStateConflictError) {
      const latest = await loadGameState(userId);
      return NextResponse.json(
        {
          error: 'version_conflict',
          state: latest.snapshot,
          version: latest.version,
          updatedAt: latest.updatedAt.toISOString(),
        },
        { status: 409 },
      );
    }

    if (error instanceof GameStateTooLargeError) {
      return NextResponse.json(
        { error: 'game_state_too_large', maxBytes: 3 * 1024 * 1024 },
        { status: 413 },
      );
    }

    return unavailable(error);
  }
}
