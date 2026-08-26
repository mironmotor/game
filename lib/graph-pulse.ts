'use client';

/**
 * Общий пульс графа: ОДИН запрос `graph_stats` на всё приложение.
 *
 * Мост `/api/max17` поднимает Python-процесс на каждый вызов, поэтому три-четыре
 * фоновых слоя (солнечная система, земля мира, поле синапсов) не должны опрашивать
 * ядро каждый сам по себе. Здесь один интервал, один кэш и подписчики: новый
 * слой получает последний снимок мгновенно, а мост дёргается раз в PERIOD_MS.
 *
 * Опрос замирает, пока вкладка скрыта, и просыпается вместе с ней.
 */

import { sendMax17Event, type Max17GraphStats } from '@/lib/max17-client';

export type GraphPulse = Max17GraphStats;

const PERIOD_MS = 45_000;

let cache: GraphPulse | null = null;
let cachedAt = 0;
let timer: ReturnType<typeof setInterval> | null = null;
let inFlight: Promise<void> | null = null;
const listeners = new Set<(pulse: GraphPulse) => void>();

async function pull(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const r = await sendMax17Event({ type: 'graph_stats' });
      if (r.graph_stats) {
        cache = r.graph_stats;
        cachedAt = Date.now();
        listeners.forEach((fn) => {
          try {
            fn(cache as GraphPulse);
          } catch {
            /* один сломанный подписчик не роняет остальных */
          }
        });
      }
    } catch {
      /* мост холодный — держим прошлый снимок */
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/** Последний снимок без запроса — если его ещё никто не тянул, null. */
export function graphPulseNow(): GraphPulse | null {
  return cache;
}

/**
 * Подписка на пульс. Сразу отдаёт кэш (если он есть), затем — каждое обновление.
 * Возвращает функцию отписки; последний отписавшийся гасит интервал.
 */
export function subscribeGraphPulse(fn: (pulse: GraphPulse) => void): () => void {
  listeners.add(fn);
  if (cache) fn(cache);
  if (Date.now() - cachedAt > PERIOD_MS) void pull();
  if (!timer) {
    timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      void pull();
    }, PERIOD_MS);
  }
  return () => {
    listeners.delete(fn);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}
