'use client';

// Мост между локальным прогрессом и публичной доской.
//
// XP игрока считается на клиенте (useGameState, localStorage), личность даёт
// Firebase Auth. Этот хук переносит первое во второе — но только когда игрок
// реально вошёл. Аноним без входа на доску не попадает: писать в Firestore
// разрешено лишь владельцу записи.
//
// Запись дебаунсится: XP капает по чуть-чуть при каждом выполненном квесте,
// и слать отдельный setDoc на каждое изменение — это лишняя нагрузка и лишние
// деньги. Пишем через паузу после того, как значение устоялось.

import { useEffect, useRef } from 'react';
import { useAuth } from '@/lib/auth';
import { syncMyScore } from '@/lib/leaderboard';

const DEBOUNCE_MS = 4000;

export function useLeaderboardSync(xp: number, enabled = true) {
  const { user } = useAuth();
  const lastSent = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled || !user) return;
    if (xp <= 0) return;
    if (lastSent.current === xp) return;

    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const name =
        user.displayName ||
        user.email?.split('@')[0] ||
        (user.isAnonymous ? 'Гость' : 'Игрок');

      syncMyScore({ uid: user.uid, displayName: name, xp }).then((ok) => {
        if (ok) lastSent.current = xp;
      });
    }, DEBOUNCE_MS);

    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [xp, user, enabled]);
}
