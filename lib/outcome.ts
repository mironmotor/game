/**
 * Петля исхода — единственное, что превращает память MAX в опыт.
 *
 * Любая поверхность, которая ЧТО-ТО СДЕЛАЛА (шаг автопилота, прогон агента,
 * фикс Доктора, ответ тьютора, миссия), обязана закрыть петлю одной строкой:
 *
 *     recordOutcome({ goal: 'первые платящие клиенты', action: 'письмо в Solarus', ok: true });
 *
 * Ядро (mark17/outcome.py) превращает это в синапс `leads_to` (цель → исход) и
 * `action_result` (действие → исход), усиливая то, что сработало, и ослабляя
 * то, что нет. БЕЗ `goal` причинная связь не создаётся — поэтому goal обязателен.
 *
 * Правило: исход пишется только по РЕАЛЬНОМУ результату, а не по факту запуска.
 * Пустой/выдуманный исход отравляет память сильнее, чем его отсутствие.
 */

import { sendMax17Event } from '@/lib/max17-client';

export type OutcomeStatus = 'success' | 'failure' | 'partial' | 'skipped';

export interface OutcomeInput {
  /** Ради какой цели делалось. Без неё `leads_to` не родится. */
  goal: string;
  /** Что конкретно сделано («отправил письмо», «перезапустил демон»). */
  action: string;
  /** Итог. true/false — сокращение для success/failure. */
  ok?: boolean;
  status?: OutcomeStatus;
  /** Необязательная деталь результата (попадёт в текст события). */
  detail?: string;
  /** Кто выполнял: autopilot | runner | doctor | tutor | agent | … */
  agent?: string;
}

const EVENT_BY_STATUS: Record<OutcomeStatus, string> = {
  success: 'outcome_success',
  failure: 'outcome_failure',
  partial: 'outcome_partial',
  skipped: 'action_skipped',
};

/**
 * Записать исход. Никогда не бросает и не блокирует поток — обучение памяти
 * не должно ломать пользовательский сценарий.
 * Возвращает подсказку ядра «что скорректировать» (если ядро её дало).
 */
export async function recordOutcome(input: OutcomeInput): Promise<string | null> {
  const goal = String(input.goal || '').trim();
  const action = String(input.action || '').trim();
  if (!goal || !action) return null; // нечего связывать — не мусорим в память

  const status: OutcomeStatus = input.status ?? (input.ok === false ? 'failure' : 'success');
  try {
    const res = await sendMax17Event({
      type: EVENT_BY_STATUS[status],
      goal,
      action,
      text: input.detail ? `${action} — ${input.detail}` : action,
      ...(input.agent ? { agent: input.agent } : {}),
    });
    const r = res as { outcome?: { next_adjustment?: string }; next_adaptation?: string };
    return r.outcome?.next_adjustment || r.next_adaptation || null;
  } catch {
    return null; // best-effort: петля не мешает работе
  }
}
