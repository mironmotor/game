import { BaseAgent } from '../base-agent';
import { extractQuantities, uniq } from '../nlp';
import type { AgentContext, AgentInput, AgentOutput, AgentRole } from '../types';

const CONTENT_UNIT = /reel|рилс|рилз|видео|video|пост|post/i;

function shortFail(text: string, max = 50): string {
  const t = (text || '')
    .replace(/^(failure|partial|skipped):\s*/i, '')
    .replace(/^Action (did not work|partially worked|was skipped):\s*/i, '')
    .replace(/\s*Next:.*$/i, '')
    .trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}
/** Above this many proposed actions, a single day starts to fracture. */
const ACTION_OVERLOAD = 7;
const REALISTIC_ACTIONS = '3–5';

/**
 * Guardian Agent — safety, risks, balance, limits, sanity check.
 *
 * Always runs LAST: it reviews the other agents' outputs (via context.peerOutputs,
 * never by talking to them directly), surfaces risks, flags overload and keeps
 * the plan realistic. It stabilizes the plan; it does not block creativity.
 */
export class GuardianAgent extends BaseAgent {
  readonly id = 'guardian-agent';
  readonly name = 'Guardian Agent';
  readonly role: AgentRole = 'guardian';
  readonly description = 'Защита: риски, баланс, ограничения, проверка на перегибы.';
  readonly capabilities = ['risk-review', 'overload-check', 'reality-check'];

  async run(input: AgentInput, context: AgentContext): Promise<AgentOutput> {
    const peers = context.peerOutputs ?? [];
    const totalActions = peers.reduce((sum, o) => sum + o.actions.length, 0);

    const risks: string[] = [];
    const insights: string[] = ['Стабилизирую план: убираю хаос, не креатив.'];
    const actions: string[] = [];

    // Inherit peer-flagged risks.
    for (const peer of peers) {
      for (const risk of peer.risks ?? []) risks.push(risk);
    }

    // Learning loop: warn against repeating what failed before.
    const failures = (context.outcomes ?? []).filter((o) => o.status === 'failure').slice(0, 2);
    for (const f of failures) {
      risks.push(`Не наступи снова: в прошлый раз не сработало «${shortFail(f.text)}» — меняй подход или уменьши шаг.`);
    }
    if (failures.length) insights.push(`Учитываю ${failures.length} прошлых неудач(и).`);

    // Overload of actions.
    if (totalActions > ACTION_OVERLOAD) {
      risks.push(`Перегруз: предложено ${totalActions} действий — реалистично закрыть ${REALISTIC_ACTIONS} за день.`);
      actions.push(`Оставить ${REALISTIC_ACTIONS} ключевых действий, остальное — в бэклог.`);
    }

    // Ambitious content quantities.
    for (const q of extractQuantities(input.text)) {
      if (q.amount >= 3 && CONTENT_UNIT.test(q.unit)) {
        risks.push(`${q.amount} ${q.unit} за день — амбициозно: заложи время на съёмку и монтаж или сократи объём.`);
      }
    }

    // Confidence sanity.
    const scored = peers.filter((p) => p.confidence > 0);
    const avg = scored.length ? scored.reduce((s, p) => s + p.confidence, 0) / scored.length : 0;
    if (scored.length && avg < 0.4) {
      insights.push('Совокупный сигнал слабый — уточни цель одним предложением до старта.');
    }

    actions.push('Сверить план с реальным временем и энергией на сегодня, затем начать с одного шага.');

    const deduped = uniq(risks);
    return this.output({
      summary: deduped.length ? `Вижу ${deduped.length} риск(ов) — план стабилизирован.` : 'Риски в норме, план реалистичен.',
      insights,
      actions,
      risks: deduped,
      confidence: 0.7,
      metadata: { reviewedAgents: peers.map((p) => p.role), totalActions },
    });
  }
}
