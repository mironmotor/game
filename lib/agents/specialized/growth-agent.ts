import { BaseAgent } from '../base-agent';
import { clamp01, containsAny, extractEntities, extractQuantities, signalStrength } from '../nlp';
import type { AgentContext, AgentInput, AgentOutput, AgentRole } from '../types';

const GROWTH_TERMS = [
  'reels', 'рилс', 'рилз', 'контент', 'видео', 'пост', 'маркетинг', 'продвин', 'продвиж',
  'оффер', 'воронк', 'аудитори', 'охват', 'подписчик', 'канал', 'телеграм', 'telegram',
  'лид', 'трафик', 'reach', 'content', 'video', 'post', 'marketing', 'promote', 'offer',
  'funnel', 'audience', 'lead', 'traffic', 'growth',
];

const CONTENT_UNITS = /reel|рилс|рилз|видео|video|пост|post|story|стори|клип/i;

/**
 * Growth Agent — marketing, content, Reels, Telegram, offers, funnels, growth.
 *
 * Turns a promo intent into a concrete content + distribution + offer plan,
 * honoring any measurable target (e.g. "3 Reels").
 */
export class GrowthAgent extends BaseAgent {
  readonly id = 'growth-agent';
  readonly name = 'Growth Agent';
  readonly role: AgentRole = 'growth';
  readonly description = 'Рост: маркетинг, контент, Reels, Telegram, офферы, воронки.';
  readonly capabilities = ['content-plan', 'distribution', 'offer-funnel'];

  canHandle(input: AgentInput): boolean {
    return containsAny(input.text, GROWTH_TERMS);
  }

  async run(input: AgentInput, _context: AgentContext): Promise<AgentOutput> {
    const text = input.text || '';
    const subject = extractEntities(text)[0];
    const contentTargets = extractQuantities(text).filter((q) => CONTENT_UNITS.test(q.unit));
    const strength = signalStrength(text, GROWTH_TERMS);

    const topic = subject ? `по «${subject}»` : 'по теме дня';
    const insights: string[] = [];
    const actions: string[] = [];

    if (contentTargets.length) {
      for (const target of contentTargets) {
        insights.push(`Цель по контенту: ${target.amount} ${target.unit} ${topic}.`);
        actions.push(`Снять ${target.amount} ${target.unit} ${topic} — по одному сильному хуку на каждый.`);
      }
    } else {
      insights.push(`Промо ${topic}: нужен формат контента и канал распространения.`);
      actions.push(`Выбрать формат (Reels/пост/видео) ${topic} и снять минимум 1 единицу.`);
    }

    insights.push('Хук в первые 3 секунды решает охват сильнее, чем монтаж.');
    insights.push('Контент без оффера и следующего шага не конвертит.');

    if (containsAny(text, ['telegram', 'телеграм', 'канал'])) {
      actions.push('Опубликовать в Telegram-канал с явным призывом к действию.');
    } else {
      actions.push('Выбрать основной канал дистрибуции (Reels + Telegram) и выложить туда.');
    }
    actions.push(`Добавить один понятный оффер/CTA ${topic} в каждую единицу контента.`);

    const confidence = clamp01(0.4 + 0.2 * strength + (contentTargets.length ? 0.2 : 0));

    return this.output({
      summary: contentTargets.length
        ? `План роста: ${contentTargets.map((t) => `${t.amount} ${t.unit}`).join(', ')} ${topic} + оффер.`
        : `Готов собрать контент-план ${topic}.`,
      insights,
      actions,
      risks: ['Без хука и оффера контент даёт просмотры, но не рост.'],
      confidence,
      metadata: { subject: subject ?? null, contentTargets },
    });
  }
}
