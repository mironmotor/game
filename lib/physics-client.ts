// Клиент физики: один зонд к ядру, из которого приходят все десять уравнений.
//
// Событие physics — read-only: оно ничего в ядре не меняет, только измеряет.
// query нужен Эйнштейну (сравнить искривлённый recall с плоским), goal —
// Фейнману (сумма по траекториям плана).

import { sendMax17Event, type Max17Response } from '@/lib/max17-client';

export interface PhysicsProbe {
  response: Max17Response;
  error?: string;
}

function failed(e: unknown): PhysicsProbe {
  return {
    response: { route: 'error', memory: {}, plasticity: {}, llm: {}, confidence: 0, next_adaptation: '' },
    error: e instanceof Error ? e.message : String(e),
  };
}

export async function probePhysics(
  query = 'память ядра',
  goal = 'запустить продукт',
): Promise<PhysicsProbe> {
  try {
    const response = await sendMax17Event({ type: 'physics', query, goal });
    return { response };
  } catch (e) {
    return failed(e);
  }
}

// Скормить ядру мысль, а потом измерить.
//
// На холодном ядре половина уравнений честно показывает нули: Эйнштейну нечего
// линзировать, у графа нулевая площадь, поля Максвелла пусты — потому что ядро
// ещё ничего не делало. Зонд physics это не исправит: он read-only и специально
// ничего не меняет.
//
// Поэтому здесь два шага. Сначала обычное событие user_message — ядро реально
// работает: пишет память, тянет ассоциации, двигает пластичность. И только
// потом замер, уже по следам этой работы. Разделение намеренное: измерение
// остаётся измерением, а запись происходит только когда человек сам её попросил.
export async function feedThenProbe(text: string, goal = 'запустить продукт'): Promise<PhysicsProbe> {
  try {
    await sendMax17Event({ type: 'user_message', text });
    return await probePhysics(text, goal);
  } catch (e) {
    return failed(e);
  }
}
