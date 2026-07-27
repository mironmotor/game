'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useSession } from 'next-auth/react';

import { getApiPath } from '@/lib/max17-client';
import { useI18n } from '@/components/I18nProvider';
import { getActiveLocale } from '@/lib/i18n/runtime';

type CloudStatus = 'idle' | 'loading' | 'synced' | 'saving' | 'offline' | 'error';

interface LocalGameState {
  xp: number;
  tasks: unknown[];
  messages: unknown[];
  sessions: unknown[];
  dailyHistory: unknown[];
  lastLaunch: string | null;
  mirCoin: {
    balance: number;
    ledger: unknown[];
  };
}

interface StateResponse {
  state?: LocalGameState;
  version?: number;
  isNew?: boolean;
  locale?: string;
  error?: string;
}

const KEYS = {
  xp: 'game_xp',
  tasks: 'game_tasks',
  messages: 'game_messages',
  sessions: 'game_sessions',
  dailyHistory: 'game_history',
  lastLaunch: 'game_last_launch',
  mirCoinBalance: 'mircoin_balance',
  mirCoinLedger: 'mircoin_ledger',
} as const;

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

function readLocalState(): LocalGameState {
  return {
    xp: readJson(KEYS.xp, 0),
    tasks: readJson(KEYS.tasks, []),
    messages: readJson(KEYS.messages, []),
    sessions: readJson(KEYS.sessions, []),
    dailyHistory: readJson(KEYS.dailyHistory, []),
    lastLaunch: readJson<string | null>(KEYS.lastLaunch, null),
    mirCoin: {
      balance: readJson(KEYS.mirCoinBalance, 500),
      ledger: readJson(KEYS.mirCoinLedger, []),
    },
  };
}

function hasLocalProgress(state: LocalGameState): boolean {
  return (
    state.xp !== 0 ||
    state.tasks.length > 0 ||
    state.messages.length > 0 ||
    state.sessions.length > 0 ||
    state.dailyHistory.length > 0 ||
    state.lastLaunch !== null ||
    state.mirCoin.balance !== 500 ||
    state.mirCoin.ledger.length > 0
  );
}

function writeLocalState(state: LocalGameState) {
  localStorage.setItem(KEYS.xp, JSON.stringify(state.xp));
  localStorage.setItem(KEYS.tasks, JSON.stringify(state.tasks));
  localStorage.setItem(KEYS.messages, JSON.stringify(state.messages));
  localStorage.setItem(KEYS.sessions, JSON.stringify(state.sessions));
  localStorage.setItem(KEYS.dailyHistory, JSON.stringify(state.dailyHistory));
  localStorage.setItem(KEYS.lastLaunch, JSON.stringify(state.lastLaunch));
  localStorage.setItem(KEYS.mirCoinBalance, JSON.stringify(state.mirCoin.balance));
  localStorage.setItem(KEYS.mirCoinLedger, JSON.stringify(state.mirCoin.ledger));
  window.dispatchEvent(new CustomEvent('game:state-sync'));
  window.dispatchEvent(new CustomEvent('mircoin:sync'));
}

function publishStatus(status: CloudStatus) {
  window.dispatchEvent(new CustomEvent('game:cloud-status', { detail: status }));
}

export default function CloudStateSync() {
  const { locale, preference, setAutomaticLocale } = useI18n();
  const { data: session, status } = useSession();
  const versionRef = useRef<number | null>(null);
  const hydratedIdentityRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef(false);
  const pendingRef = useRef(false);

  const persist = useCallback(async () => {
    if (savingRef.current || versionRef.current === null) {
      pendingRef.current = true;
      return;
    }

    savingRef.current = true;
    pendingRef.current = false;
    publishStatus('saving');

    try {
      const response = await fetch(getApiPath('game-state'), {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          state: readLocalState(),
          version: versionRef.current,
          locale: getActiveLocale(),
        }),
        keepalive: true,
      });
      const payload = (await response.json()) as StateResponse;

      if (response.status === 409 && payload.state && payload.version) {
        versionRef.current = payload.version;
        writeLocalState(payload.state);
        publishStatus('synced');
        return;
      }

      if (!response.ok || !payload.version) {
        publishStatus(response.status === 503 ? 'offline' : 'error');
        return;
      }

      versionRef.current = payload.version;
      publishStatus('synced');
    } catch {
      publishStatus('offline');
    } finally {
      savingRef.current = false;
      if (pendingRef.current) void persist();
    }
  }, []);

  useEffect(() => {
    if (status !== 'authenticated' || !session?.user) {
      versionRef.current = null;
      hydratedIdentityRef.current = null;
      publishStatus(status === 'loading' ? 'loading' : 'idle');
      return;
    }

    const identity = session.user.email || session.user.name || 'game-account';
    if (hydratedIdentityRef.current === identity) return;
    hydratedIdentityRef.current = identity;

    const hydrate = async () => {
      publishStatus('loading');
      try {
        const response = await fetch(getApiPath('game-state'), {
          cache: 'no-store',
          headers: { 'x-game-locale': locale },
        });
        const payload = (await response.json()) as StateResponse;
        if (!response.ok || !payload.state || !payload.version) {
          versionRef.current = null;
          publishStatus(response.status === 503 ? 'offline' : 'error');
          return;
        }

        versionRef.current = payload.version;
        if (payload.locale && preference === 'auto' && payload.locale !== locale) {
          setAutomaticLocale(payload.locale);
        }
        const localState = readLocalState();
        if (payload.isNew && hasLocalProgress(localState)) {
          await persist();
        } else {
          writeLocalState(payload.state);
          publishStatus('synced');
        }
      } catch {
        versionRef.current = null;
        publishStatus('offline');
      }
    };

    void hydrate();
  }, [locale, persist, preference, session, setAutomaticLocale, status]);

  useEffect(() => {
    const scheduleSave = () => {
      if (versionRef.current === null) return;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => void persist(), 900);
    };

    window.addEventListener('game:local-state-change', scheduleSave);
    window.addEventListener('game:locale-change', scheduleSave);
    return () => {
      window.removeEventListener('game:local-state-change', scheduleSave);
      window.removeEventListener('game:locale-change', scheduleSave);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [persist]);

  return null;
}
