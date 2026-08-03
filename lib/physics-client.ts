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

export async function probePhysics(
  query = 'память ядра',
  goal = 'запустить продукт',
): Promise<PhysicsProbe> {
  try {
    const response = await sendMax17Event({ type: 'physics', query, goal });
    return { response };
  } catch (e) {
    return {
      response: { route: 'error', memory: {}, plasticity: {}, llm: {}, confidence: 0, next_adaptation: '' },
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
