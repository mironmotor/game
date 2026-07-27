'use client';

/**
 * usePremium — премиум-доступ к «Ядру Мирона» (настоящий MAX на локалке Мирона).
 * Механика РУЧНАЯ: Мирон выдаёт код тому, кто оплатил; человек вводит код →
 * сервер проверяет его по PREMIUM_ACCESS_CODES (server-only env) → код
 * сохраняется в localStorage и уезжает с каждым событием как premium_code.
 * На сервере премиум-чат маршрутизируется в настоящее ядро через туннель.
 * Это НЕ приём платежей — оплату и авто-выдачу кодов подключим позже.
 */

import { useCallback, useEffect, useState } from 'react';
import { appBasePath } from '@/lib/base-path';

const KEY = 'mir_premium_code';
const LEGACY_KEY = 'mir_premium';

export function getPremiumCode(): string {
  if (typeof window === 'undefined') return '';
  try {
    return (localStorage.getItem(KEY) || '').trim();
  } catch {
    return '';
  }
}

export function usePremium() {
  const [premium, setPremium] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setPremium(getPremiumCode() !== '');
    // Старый гейт хранил только флаг 'granted' без кода — он больше не даёт
    // доступа (код теперь проверяет сервер), чистим чтобы не путать.
    try {
      localStorage.removeItem(LEGACY_KEY);
    } catch {
      /* ignore */
    }
    setLoaded(true);
  }, []);

  const unlock = useCallback(async (code: string): Promise<boolean> => {
    const trimmed = code.trim();
    if (!trimmed) return false;
    try {
      const res = await fetch(`${appBasePath}/api/premium`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: trimmed }),
      });
      const data = (await res.json()) as { ok?: boolean };
      if (data.ok) {
        try {
          localStorage.setItem(KEY, trimmed);
        } catch {
          /* ignore */
        }
        setPremium(true);
        return true;
      }
    } catch {
      /* network error → treat as invalid */
    }
    return false;
  }, []);

  const lock = useCallback(() => {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
    setPremium(false);
  }, []);

  return { premium, loaded, unlock, lock };
}
