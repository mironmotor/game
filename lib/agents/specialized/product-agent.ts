import { BaseAgent } from '../base-agent';
import { clamp01, containsAny, extractEntities, signalStrength } from '../nlp';
import type { AgentContext, AgentInput, AgentOutput, AgentRole } from '../types';

const PRODUCT_TERMS = [
  'продукт', 'фича', 'функци', 'интерфейс', 'логика', 'архитектур', 'сервис', 'экран',
  'онбординг', 'удержани', 'воронк', 'баг', 'релиз', 'апи',
  'product', 'feature', 'ux', 'ui', 'api', 'service', 'screen', 'onboarding', 'retention',
  'bug', 'release', 'flow', 'value',
];

/**
 * Product Agent — product, UX, architecture, features, API, service logic.
 *
 * Anchors the work to a concrete product/feature and to the user value the
 * effort should deliver (so growth/content does not run disconnected from product).
 */
export class ProductAgent extends BaseAgent {
  readonly id = 'product-agent';
  readonly name = 'Product Agent';
  readonly role: AgentRole = 'product';
  readonly description = 'Продукт: UX, архитектура, фичи, API, логика сервиса.';
  readonly capabilities = ['product-anchoring', 'ux-flow', 'value-mapping'];

  canHandle(input: AgentInput): boolean {
    return containsAny(input.text, PRODUCT_TERMS) || extractEntities(input.text).length > 0;
  }

  async run(input: AgentInput, _context: AgentContext): Promise<AgentOutput> {
    const text = input.text || '';
    const entities = extractEntities(text);
    const product = entities[0];
    const termStrength = signalStrength(text, PRODUCT_TERMS);

    const insights: string[] = [];
    const actions: string[] = [];

    if (product) {
      insights.push(`Продукт в фокусе: ${product}.`);
      insights.push(`Любой контент/действие должно вести к конкретной ценности «${product}», а не в пустоту.`);
      actions.push(`Определить целевое действие в «${product}», к которому ведёт сегодняшняя работа.`);
      actions.push(`Подготовить рабочую ссылку/CTA на «${product}» для распространения.`);
    } else {
      insights.push('Конкретный продукт в запросе не назван — стоит привязать усилие к фиче или экрану.');
      actions.push('Назвать продукт/фичу, вокруг которой строится день.');
    }
    actions.push('Проверить, что путь пользователя (вход → ценность) без трения.');

    const confidence = clamp01(0.35 + (product ? 0.25 : 0) + 0.2 * termStrength);

    return this.output({
      summary: product ? `Привязываю усилия к продукту «${product}».` : 'Нужна привязка к конкретному продукту/фиче.',
      insights,
      actions,
      risks: product ? undefined : ['Контент без привязки к продукту = охваты без результата.'],
      confidence,
      metadata: { product: product ?? null, entities },
    });
  }
}
