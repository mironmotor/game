// Тарифы и лимиты. Один источник правды: и UI, и стена доступа читают отсюда.
// tier живёт в users/{uid}.tier в Firestore. Меняет его только доверенный код
// (Stripe-вебхук / админ) — правила Firestore запрещают юзеру повышать себе тариф.

export type Tier = 'free' | 'pro';

export const DEFAULT_TIER: Tier = 'free';

export interface TierPlan {
  id: Tier;
  name: string;
  priceLabel: string;      // что показываем на кнопке
  priceMonthly: number;    // в евро, 0 = бесплатно
  blurb: string;
  perks: string[];
}

export const PLANS: Record<Tier, TierPlan> = {
  free: {
    id: 'free',
    name: 'Free',
    priceLabel: 'Бесплатно',
    priceMonthly: 0,
    blurb: 'Попробовать GAME и лёгкие режимы.',
    perks: [
      'HUD и визуальные режимы',
      'Воронка — 3 идеи в день',
      'Базовый доступ к ядру',
    ],
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    priceLabel: '€9 / мес',
    priceMonthly: 9,
    blurb: 'Полный доступ к ядру Max и всем тяжёлым режимам.',
    perks: [
      'Безлимитная Воронка',
      'Автоплан и граф синапсов',
      'Эволюционная кузница',
      'Приоритет ядра Max',
    ],
  },
};

// Какие фичи требуют какого тарифа. Всё, чего тут нет, доступно всем вошедшим.
export const FEATURE_MIN_TIER: Record<string, Tier> = {
  autoplan: 'pro',
  maxgraph: 'pro',
  evolution: 'pro',
  funnel: 'free',   // доступна на free, но с дневным лимитом (ниже)
};

// Дневные лимиты по тарифам (0 или отсутствие ключа = безлимит).
export const DAILY_LIMITS: Record<Tier, Record<string, number>> = {
  free: { funnel: 3 },
  pro: {},
};

// ── GODMODE ────────────────────────────────────────────────────────────────
// Все замки сняты: каждый режим открыт каждому, дневных лимитов нет, вход не
// требуется. Это один выключатель — поставь false, и тарифная стена вернётся
// ровно такой, какой была: таблицы выше не тронуты.
//
// Таблицы FEATURE_MIN_TIER и DAILY_LIMITS сознательно оставлены как есть —
// они описывают, каким продукт будет без GODMODE, и их не нужно
// восстанавливать по памяти.
export const GODMODE = true;

const ORDER: Tier[] = ['free', 'pro'];

export function tierAtLeast(have: Tier, need: Tier): boolean {
  if (GODMODE) return true;
  return ORDER.indexOf(have) >= ORDER.indexOf(need);
}

// Может ли пользователь с данным тарифом открыть фичу?
export function canUseFeature(tier: Tier, feature: string): boolean {
  if (GODMODE) return true;
  const need = FEATURE_MIN_TIER[feature];
  if (!need) return true;
  return tierAtLeast(tier, need);
}

export function dailyLimitFor(tier: Tier, feature: string): number {
  if (GODMODE) return 0; // 0 = без лимита
  return DAILY_LIMITS[tier]?.[feature] ?? 0;
}
