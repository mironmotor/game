import { BaseAgent } from '../base-agent';
import { clamp01, detectLocale, extractEntities, extractQuantities, matchedTerms } from '../nlp';
import type { AgentContext, AgentInput, AgentOutput, AgentRole, Mission } from '../types';

const GOAL_TERMS = [
  'хочу', 'цель', 'нужно', 'надо', 'план', 'задача', 'сегодня', 'приоритет', 'миссия',
  'goal', 'want', 'need', 'plan', 'task', 'today', 'priority', 'mission', 'focus',
];

function firstClause(text: string): string {
  const clause = text.split(/[.,;\n]| и | and /i)[0].trim();
  return clause.length > 60 ? `${clause.slice(0, 57)}…` : clause;
}

/** Turn a stored outcome ("success: Action helped: X. Next: …") into the bare action. */
function cleanOutcome(text: string, max = 56): string {
  const t = (text || '')
    .replace(/^(success|failure|partial|skipped):\s*/i, '')
    .replace(/^Action (helped|did not work|partially worked|was skipped):\s*/i, '')
    .replace(/\s*Next:.*$/i, '')
    .trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/**
 * Strategy Agent — strategy, priorities, goals, missions, next steps.
 *
 * Distills the input into a focus + measurable targets and proposes a "mission
 * of the day" seed (MAX finalizes it during synthesis).
 */
export class StrategyAgent extends BaseAgent {
  readonly id = 'strategy-agent';
  readonly name = 'Strategy Agent';
  readonly role: AgentRole = 'strategy';
  readonly description = 'Стратегия: приоритеты, цели, миссии, следующие шаги.';
  readonly capabilities = ['goal-extraction', 'prioritization', 'mission-design'];

  async run(input: AgentInput, context: AgentContext): Promise<AgentOutput> {
    const text = input.text || '';
    const locale = (input.locale as 'ru' | 'en') || detectLocale(text);
    const entities = extractEntities(text);
    const quantities = extractQuantities(text);
    const focus = entities.length ? entities : text ? [firstClause(text)] : [];
    const goalSignals = matchedTerms(text, GOAL_TERMS);

    const insights: string[] = [];
    insights.push(`Главный фокус: ${focus.join(', ') || '—'}.`);
    if (quantities.length) {
      insights.push(`Измеримые цели: ${quantities.map((q) => `${q.amount} ${q.unit}`).join(', ')}.`);
    }
    insights.push('Один день — один главный вектор; всё остальное вторично.');

    const actions: string[] = [];
    if (focus.length) actions.push(`Сделать «${focus[0]}» целью №1 на сегодня.`);
    for (const q of quantities) actions.push(`Закрыть измеримый результат: ${q.amount} ${q.unit}.`);
    actions.push('Определить первый конкретный шаг и стартовать с него в ближайший час.');

    // Outcome-conditioned planning: learn from what worked / failed before.
    const outcomes = context.outcomes ?? [];
    const failures = outcomes.filter((o) => o.status === 'failure').slice(0, 2);
    const successes = outcomes.filter((o) => o.status === 'success').slice(0, 1);
    for (const s of successes) {
      insights.unshift(`Раньше сработало: «${cleanOutcome(s.text)}» — закрепляю этот подход.`);
    }
    for (const f of failures) {
      insights.unshift(`Прошлый раз не сработало: «${cleanOutcome(f.text)}» — беру шаг меньше/иначе.`);
      actions.unshift(`Не повторять провал «${cleanOutcome(f.text, 40)}» — сделать меньший, более простой шаг.`);
    }

    const mission: Mission = {
      title: focus[0]
        ? locale === 'ru'
          ? `Двигаю «${focus[0]}» вперёд`
          : `Push "${focus[0]}" forward`
        : locale === 'ru'
          ? 'Миссия дня'
          : 'Mission of the day',
      focus,
      why: 'Сфокусированный день даёт реальный сдвиг, распылённый — нет.',
      successCriteria: quantities.map((q) => `${q.amount} ${q.unit} готово`),
    };

    const confidence = clamp01(
      0.4 + 0.1 * goalSignals.length + (focus.length ? 0.1 : 0) + (outcomes.length ? 0.1 : 0),
    );

    return this.output({
      summary: focus.length ? `Стратегия дня вокруг «${focus[0]}».` : 'Уточняю цель и приоритеты дня.',
      insights,
      actions,
      confidence,
      metadata: {
        focus,
        quantities,
        mission,
        outcomesUsed: outcomes.length,
        // Concrete anchors present? Drives MAX's auto-escalation to deep mode.
        grounded: entities.length > 0 || quantities.length > 0,
      },
    });
  }
}
