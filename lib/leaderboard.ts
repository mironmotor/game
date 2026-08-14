// Лидерборд — публичная витрина прогресса игроков и общий трекинг к миссии.
//
// Одна запись на игрока: leaderboard/{uid}. Читать может кто угодно, писать —
// только владелец и только свою (см. firestore.rules). Уровень и ранг здесь
// НЕ хранятся как отдельная истина: они выводятся из xp, чтобы не было двух
// расходящихся источников. В базе лежит ровно то, что игрок реально набрал.

import {
  collection,
  doc,
  getDocs,
  limit as fsLimit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import { firestore } from '@/firebase';

export const LEADERBOARD_COLLECTION = 'leaderboard';

/** Сколько XP стоит один уровень. Тот же шаг, что в HUD. */
export const XP_PER_LEVEL = 3200;

/**
 * Главная миссия компании: общая цель, к которой суммарно идут все игроки.
 * Прогресс считается как сумма XP всех записей на доске.
 */
export const MISSION = {
  title: 'Перевести жизнь в игру',
  subtitle: 'Общий прогресс всех игроков GAME',
  targetXp: 1_000_000,
} as const;

export interface LeaderboardEntry {
  uid: string;
  displayName: string;
  xp: number;
  level: number;
  updatedAt: number | null;
}

export function levelFromXp(xp: number): number {
  return Math.max(1, Math.floor(xp / XP_PER_LEVEL) + 1);
}

/** Прогресс внутри текущего уровня, 0..1 — для полоски в UI. */
export function levelProgress(xp: number): number {
  return (xp % XP_PER_LEVEL) / XP_PER_LEVEL;
}

/**
 * Записать/обновить свою строку на доске.
 * Возвращает false, если Firestore недоступен или запись отклонена правилами —
 * вызывающий код не должен от этого падать.
 */
export async function syncMyScore(params: {
  uid: string;
  displayName: string | null;
  xp: number;
}): Promise<boolean> {
  const db = firestore();
  if (!db) return false;

  const xp = Math.max(0, Math.floor(params.xp));
  const name = (params.displayName || 'Аноним').slice(0, 40);

  try {
    await setDoc(
      doc(db, LEADERBOARD_COLLECTION, params.uid),
      {
        uid: params.uid,
        displayName: name,
        xp,
        level: levelFromXp(xp),
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
    return true;
  } catch (e) {
    console.warn('[leaderboard] запись отклонена', e);
    return false;
  }
}

/** Сколько ждём Firestore, прежде чем считать, что связи нет. */
const READ_TIMEOUT_MS = 8000;

export class LeaderboardTimeout extends Error {
  constructor() {
    super('leaderboard read timed out');
    this.name = 'LeaderboardTimeout';
  }
}

/**
 * Firestore при недоступной сети не отклоняет промис, а бесконечно ретраит —
 * без этого ограничителя UI навсегда залипал бы на «загружаю».
 */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new LeaderboardTimeout()), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

/**
 * Топ игроков по XP.
 * Бросает при недоступной базе — вызывающий код должен показать это
 * пользователю, а не молча выдать пустую доску: «никого нет» и «не смогли
 * прочитать» — разные состояния, и путать их нельзя.
 */
export async function fetchTop(max = 50): Promise<LeaderboardEntry[]> {
  const db = firestore();
  if (!db) throw new Error('firestore unavailable');

  {
    const snap = await withTimeout(
      getDocs(
        query(
          collection(db, LEADERBOARD_COLLECTION),
          orderBy('xp', 'desc'),
          fsLimit(max),
        ),
      ),
      READ_TIMEOUT_MS,
    );

    return snap.docs.map((d) => {
      const data = d.data() as Record<string, unknown>;
      const xp = typeof data.xp === 'number' ? data.xp : 0;
      const ts = data.updatedAt as { toMillis?: () => number } | null | undefined;
      return {
        uid: d.id,
        displayName: typeof data.displayName === 'string' ? data.displayName : 'Аноним',
        xp,
        level: typeof data.level === 'number' ? data.level : levelFromXp(xp),
        updatedAt: ts?.toMillis ? ts.toMillis() : null,
      };
    });
  }
}

/** Суммарный прогресс к миссии по уже загруженной доске. */
export function missionProgress(entries: LeaderboardEntry[]) {
  const total = entries.reduce((sum, e) => sum + e.xp, 0);
  return {
    total,
    target: MISSION.targetXp,
    ratio: Math.min(1, total / MISSION.targetXp),
  };
}
