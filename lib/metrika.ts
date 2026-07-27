/**
 * Цели Яндекс.Метрики для mir.care (нужны, чтобы Яндекс.Директ оптимизировался
 * на результат, а не крутился вслепую).
 *
 * ВАЖНО: цели с этими же идентификаторами нужно создать в интерфейсе Метрики
 * (Настройки → Цели → «JavaScript-событие»), иначе они не будут учитываться:
 *
 *   login_google    — человек вошёл через Google (регистрация/возврат)
 *   max_message     — отправил первое сообщение MAX за визит (главное действие)
 *   agent_run       — запустил прогон агента (глубокое вовлечение)
 *   cyberlab_open   — открыл Cyber Lab (интерес к обучению)
 *
 * Считается только на боевом: в dev счётчика нет (см. components/YandexMetrika).
 */

const COUNTER_ID = 111037211;

type Ym = (id: number, action: string, ...rest: unknown[]) => void;

export type MetrikaGoal = 'login_google' | 'max_message' | 'agent_run' | 'cyberlab_open';

/** Цели, которые имеют смысл только раз за визит (иначе завышают конверсию). */
const ONCE_PER_SESSION: ReadonlySet<MetrikaGoal> = new Set(['max_message', 'cyberlab_open']);
const fired = new Set<string>();

/**
 * Отправить цель. Полностью безопасно: если счётчика нет (dev, блокировщик
 * рекламы, оффлайн) — тихо ничего не делает и никогда не роняет интерфейс.
 */
export function reachGoal(goal: MetrikaGoal, params?: Record<string, unknown>): void {
  try {
    if (typeof window === 'undefined') return;
    if (ONCE_PER_SESSION.has(goal)) {
      if (fired.has(goal)) return;
      fired.add(goal);
    }
    const ym = (window as unknown as { ym?: Ym }).ym;
    if (typeof ym !== 'function') return; // счётчик не загружен — это нормально
    ym(COUNTER_ID, 'reachGoal', goal, params);
  } catch {
    /* аналитика никогда не ломает продукт */
  }
}
