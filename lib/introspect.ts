// Клиент саморефлексии Макса: /api/max17 (event: introspect).

import { appBasePath } from './base-path';

export interface Priority {
  action: string;
  why: string;
}

export interface Introspection {
  ok: boolean;
  source: string;
  assessment: string;
  mood: string;
  focus: string;
  priorities: Priority[];
  state: {
    memories: number;
    synapses_total: number;
    recent_actions: string[];
    top_relations: string[];
  };
}

/**
 * Самоанализ ядра.
 *
 * Клиент писался под ветку main, где ядро отвечало полем `introspection` с
 * готовыми оценкой, настроением и приоритетами. Боевое ядро устроено иначе:
 * оно кладёт `self_state` — своё внутреннее состояние, откуда всё это надо
 * собрать. Из-за расхождения страница «Самосознание» показывала «ядро
 * недоступно», хотя ядро отвечало за секунду.
 *
 * Переписывать ядро под интерфейс было бы неверно: состояние — это то, что оно
 * действительно про себя знает, а формулировки для экрана собираются здесь.
 */
export async function introspectMax(): Promise<Introspection | null> {
  try {
    const res = await fetch(`${appBasePath}/api/max17`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'introspect' }),
    });
    const data = await res.json();

    // Старый формат — если ядро когда-нибудь начнёт отвечать им напрямую.
    const legacy = data?.introspection;
    if (legacy?.ok) return legacy as Introspection;

    const st = data?.self_state;
    if (!st || typeof st !== 'object') return null;

    const signals = (st.signals ?? {}) as Record<string, unknown>;
    const gaps = Number(signals.gaps_open ?? 0);
    const growth = Number(signals.growth ?? 0);
    const synapses = Number(st.synapse_count ?? 0);

    // Приоритеты не выдумываем: каждый следует из измеренного сигнала, и если
    // сигнала нет — строки тоже нет.
    const priorities: Priority[] = [];
    if (gaps > 0) {
      priorities.push({
        action: `Закрыть пробелы в знании (${gaps})`,
        why: 'Открытые вопросы — то, чего ядро про мир пока не знает',
      });
    }
    if (growth > 0) {
      priorities.push({
        action: `Закрепить рост (+${growth})`,
        why: 'Новые связи стоит подтвердить опытом, иначе они распадутся',
      });
    }
    if (String(signals.user_voice || '').trim()) {
      priorities.push({ action: 'Ответить на состояние человека', why: `В голосе слышно: ${signals.user_voice}` });
    }

    return {
      ok: true,
      source: 'self_state',
      assessment: String(st.reflection ?? ''),
      mood: `${st.emoji ?? ''} ${st.feeling ?? ''}`.trim(),
      focus: gaps > 0 ? `${gaps} открытых вопросов` : 'ровное состояние, срочного нет',
      priorities,
      state: {
        memories: Number(data?.memory?.stored ?? 0),
        synapses_total: synapses,
        recent_actions: [],
        top_relations: [],
      },
    };
  } catch {
    return null;
  }
}
