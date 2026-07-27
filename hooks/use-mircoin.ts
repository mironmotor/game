'use client';

/**
 * MirCoin — внутриигровая валюта GAME. НЕ криптовалюта: не блокчейн, не токен,
 * нельзя продать или обменять на настоящие деньги. Это прозрачный локальный
 * журнал начислений (localStorage) — каждая монета имеет причину. Заменяет
 * декоративную формулу баланса (`xp * 12 + 8000`) настоящей бухгалтерией.
 */

import { useCallback, useEffect, useState } from 'react';
import { appBasePath } from '@/lib/base-path';

export interface MirCoinEntry {
  id: string;
  amount: number;
  reason: string;
  ts: string;
}

const BALANCE_KEY = 'mircoin_balance';
const LEDGER_KEY = 'mircoin_ledger';
const STARTING_BALANCE = 500;
const LEDGER_LIMIT = 200;
// Аккаунт-стор (respect basePath: '/game' локально, '' на сервере).
const MIRCOIN_API = `${appBasePath}/api/mircoin`;

function load<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function save(key: string, value: unknown) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
    window.dispatchEvent(new CustomEvent('game:local-state-change'));
  } catch {
    /* best-effort */
  }
}

export function useMirCoin() {
  const [balance, setBalance] = useState(STARTING_BALANCE);
  const [ledger, setLedger] = useState<MirCoinEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [canSync, setCanSync] = useState(false);

  useEffect(() => {
    setBalance(load(BALANCE_KEY, STARTING_BALANCE));
    setLedger(load(LEDGER_KEY, [] as MirCoinEntry[]));
    setLoaded(true);
    // Залогинен? Баланс берём из аккаунта (там грант/переводы). 401 — остаёмся
    // на localStorage (аноним / вход не настроен).
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(MIRCOIN_API, { cache: 'no-store' });
        if (cancelled || !res.ok) return;
        const data = (await res.json()) as { balance?: number };
        setCanSync(true);
        if (typeof data.balance === 'number') setBalance(data.balance);
      } catch {
        /* оффлайн — остаёмся локально */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Cross-instance sync, same pattern as use-game-state's tasks-sync.
  useEffect(() => {
    const onSync = () => {
      setBalance(load(BALANCE_KEY, STARTING_BALANCE));
      setLedger(load(LEDGER_KEY, [] as MirCoinEntry[]));
    };
    window.addEventListener('mircoin:sync', onSync);
    return () => window.removeEventListener('mircoin:sync', onSync);
  }, []);

  const earn = useCallback((amount: number, reason: string) => {
    if (!amount) return;
    const entry: MirCoinEntry = {
      id: `mc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      amount,
      reason,
      ts: new Date().toISOString(),
    };
    setBalance((prev) => {
      const next = Math.max(0, prev + amount);
      save(BALANCE_KEY, next);
      return next;
    });
    setLedger((prev) => {
      const next = [entry, ...prev].slice(0, LEDGER_LIMIT);
      save(LEDGER_KEY, next);
      return next;
    });
    window.dispatchEvent(new CustomEvent('mircoin:sync'));
    // Залогинен — зеркалим начисление в аккаунт (кросс-девайс) и берём
    // авторитетный баланс из ответа сервера.
    if (canSync) {
      void fetch(MIRCOIN_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'earn', amount, reason }),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (d && typeof d.balance === 'number') {
            setBalance(d.balance);
            save(BALANCE_KEY, d.balance);
          }
        })
        .catch(() => {});
    }
  }, [canSync]);

  return { balance, ledger, earn, loaded };
}
