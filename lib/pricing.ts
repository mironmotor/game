/**
 * Тарифы MAX API — единственное место, где живут цены.
 *
 * Считаем в MIRCOIN. Это внутренняя единица: сколько она стоит в деньгах,
 * решает продавец в момент продажи кода, и менять курс можно не трогая код.
 *
 * Два тарифа не случайно. Чат — это перепродажа чужой модели: там маржа
 * тонкая, и цена должна оставаться сравнимой с рынком, иначе клиент уйдёт
 * к первоисточнику. Ядро MAX — зрение, память, физика, сны — не перепродаётся
 * ниоткуда, у него нет цены для сравнения, и стоит оно дороже именно потому,
 * что его больше нигде нет.
 */

/** Цена за миллион токенов, отдельно вход и выход: выход у моделей всегда дороже. */
export interface TokenRate {
  in: number;
  out: number;
}

export const CHAT_RATES: Record<string, TokenRate> = {
  // Базовая модель — то, что стоит в цепочке Gonka первым.
  'max-1': { in: 120, out: 360 },
  // Модель побольше: медленнее и дороже, зовётся явно.
  'max-1-large': { in: 200, out: 600 },
};

export const DEFAULT_CHAT_MODEL = 'max-1';

/**
 * Ядро MAX: цена за вызов, а не за токены.
 *
 * Токены тут не при чём — зрение считает пиксели, физика считает поля, и
 * стоимость определяется работой, а не длиной текста. Мерить их в токенах
 * значило бы врать о том, что происходит внутри.
 */
export const CORE_PRICES: Record<string, number> = {
  see: 60, // разбор кадра: палитра, свет, ритм, геометрия, узнавание
  world: 25, // кадр как состояние вселенной + законы мира
  dream: 30, // параметры сна и ветки развития
  remember: 12, // запись в память и поиск похожего
};

/** Сколько MIRCOIN стоит вызов чата с таким расходом токенов. */
export function chatCost(model: string, tokensIn: number, tokensOut: number): number {
  const rate = CHAT_RATES[model] || CHAT_RATES[DEFAULT_CHAT_MODEL];
  const cost = (Math.max(0, tokensIn) / 1e6) * rate.in + (Math.max(0, tokensOut) / 1e6) * rate.out;
  // Округляем вверх до сотой: иначе тысяча дешёвых запросов пройдёт бесплатно
  // за счёт того, что каждый по отдельности округлился в ноль.
  return Math.ceil(cost * 100) / 100;
}

export function coreCost(endpoint: string): number {
  return CORE_PRICES[endpoint] ?? 20;
}

/** Минимальный баланс, ниже которого запрос не начинается. */
export const MIN_BALANCE = 1;

/** Витрина тарифов для /api/v1/models и документации. */
export function priceList() {
  return {
    currency: 'MIRCOIN',
    chat: Object.entries(CHAT_RATES).map(([id, rate]) => ({
      model: id,
      per_million_input: rate.in,
      per_million_output: rate.out,
    })),
    core: Object.entries(CORE_PRICES).map(([endpoint, price]) => ({
      endpoint: `/v1/max/${endpoint}`,
      per_call: price,
    })),
    note: 'Списание идёт с баланса MIRCOIN, привязанного к ключу.',
  };
}
