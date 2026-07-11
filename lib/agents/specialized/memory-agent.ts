import { BaseAgent } from '../base-agent';
import type { AgentContext, AgentInput, AgentOutput, AgentRole } from '../types';

/**
 * Memory Agent — memory, patterns, history, repeating cycles, user context.
 *
 * Reads through a MemoryStore (recall + pattern detection). Persisting is left
 * to MAX after synthesis, so the agent stays a pure reader. With no store wired
 * it reports the gap and proposes connecting persistent memory.
 */
export class MemoryAgent extends BaseAgent {
  readonly id = 'memory-agent';
  readonly name = 'Memory Agent';
  readonly role: AgentRole = 'memory';
  readonly description = 'Память: паттерны, история, повторяющиеся циклы, контекст пользователя.';
  readonly capabilities = ['recall', 'pattern-detection', 'context-continuity'];

  async run(input: AgentInput, context: AgentContext): Promise<AgentOutput> {
    const store = context.services?.memory;
    // Prefer the context the orchestrator already primed (single shared recall).
    const recalled = context.memories ?? (store ? await store.getRelevantMemories(input.text, 5) : null);

    if (recalled === null) {
      return this.output({
        summary: 'Память не подключена — контекст прошлого недоступен.',
        insights: ['Нет MemoryStore: persistent memory ещё не настроена.'],
        actions: ['Подключить MemoryStore (Max17 Hippocampus или БД) для непрерывности контекста.'],
        confidence: 0.2,
        metadata: { available: false },
      });
    }

    const patterns = store ? await store.detectPatterns() : [];

    const insights: string[] = [];
    if (recalled.length) {
      insights.push(`Похожее из памяти: ${recalled.slice(0, 3).map((r) => r.text).join('; ')}.`);
    } else {
      insights.push('Релевантных воспоминаний пока нет — это новый контекст.');
    }
    for (const pattern of patterns.slice(0, 3)) insights.push(pattern.summary);

    return this.output({
      summary: recalled.length
        ? `Нашёл ${recalled.length} связанных воспоминаний.`
        : 'Свежий контекст без истории — есть смысл его зафиксировать.',
      insights,
      actions: ['Сохранить сегодняшнюю цель в память, чтобы отследить повторяющийся цикл.'],
      confidence: recalled.length ? 0.6 : 0.4,
      metadata: {
        available: true,
        recalled,
        patterns,
        // Hint MAX about what is worth persisting after synthesis.
        toSave: { text: input.text, kind: 'event' as const },
      },
    });
  }
}
