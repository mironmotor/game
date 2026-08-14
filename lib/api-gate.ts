/**
 * Ворота MAX API: кто пришёл, есть ли у него деньги, сколько списать.
 *
 * Один слой на все эндпоинты — чтобы проверка ключа и баланса не расползлась
 * копиями по роутам и не разошлась в них по мелочам.
 *
 * Деньги списываются ПОСЛЕ ответа, по факту израсходованного. До запроса
 * проверяется лишь то, что баланс не в нуле: заранее списать нельзя — сколько
 * токенов породит модель, до ответа не знает никто.
 */
import { NextResponse } from 'next/server';
import { getAccount, earn } from '@/lib/mircoin-store';
import { recordUsage, verifyKey, type ApiKey } from '@/lib/api-keys';
import { MIN_BALANCE } from '@/lib/pricing';

export interface Caller {
  key: ApiKey;
  balance: number;
}

function bearer(request: Request): string {
  const header = request.headers.get('authorization') || '';
  const m = header.match(/^Bearer\s+(.+)$/i);
  if (m) return m[1].trim();
  // x-api-key — привычка тех, кто приходит не из OpenAI-мира.
  return (request.headers.get('x-api-key') || '').trim();
}

/** Ошибка в формате, который понимают клиенты OpenAI SDK. */
export function apiError(message: string, status: number, type = 'invalid_request_error') {
  return NextResponse.json({ error: { message, type, code: status } }, { status });
}

/**
 * Пустить или отказать. Возвращает либо звонящего, либо готовый ответ с отказом.
 */
export async function authorize(request: Request): Promise<Caller | NextResponse> {
  const raw = bearer(request);
  if (!raw) {
    return apiError('Нужен ключ: заголовок Authorization: Bearer mx-live-…', 401, 'authentication_error');
  }
  const key = await verifyKey(raw);
  if (!key) {
    return apiError('Ключ не найден или отозван', 401, 'authentication_error');
  }
  const account = await getAccount(key.email);
  if ((account?.balance ?? 0) < MIN_BALANCE) {
    return apiError(
      `Недостаточно MIRCOIN на балансе (${account?.balance ?? 0}). Пополни доступ у владельца ключа.`,
      402,
      'insufficient_quota',
    );
  }
  return { key, balance: account?.balance ?? 0 };
}

/**
 * Списать за выполненный вызов.
 *
 * Списываем даже в минус: запрос уже отработал, отказать задним числом нельзя,
 * а простить расход означало бы, что нулевой баланс — это бесплатный тариф.
 * Следующий запрос такого ключа не пройдёт проверку, и это правильный момент
 * для отказа — до работы, а не после.
 */
export async function charge(
  caller: Caller,
  opts: { endpoint: string; cost: number; tokens_in?: number; tokens_out?: number; model?: string },
): Promise<number> {
  const cost = Math.max(0, opts.cost);
  // Сначала журнал: он копит дробь и возвращает, сколько целых монет созрело
  // к списанию. Списывать сам cost нельзя — MIRCOIN целочисленный, и всё,
  // что меньше половины монеты, округлилось бы в ноль.
  const whole = await recordUsage(caller.key.id, {
    endpoint: opts.endpoint,
    tokens_in: opts.tokens_in ?? 0,
    tokens_out: opts.tokens_out ?? 0,
    cost,
    model: opts.model,
  });
  if (whole > 0) {
    await earn(caller.key.email, -whole, `MAX API: ${opts.endpoint}`);
  }
  const account = await getAccount(caller.key.email);
  return account?.balance ?? 0;
}

/** Заголовки расхода — чтобы клиент видел цену и остаток, не запрашивая их отдельно. */
export function billingHeaders(cost: number, balance: number): Record<string, string> {
  return {
    'X-MAX-Cost': String(cost),
    'X-MAX-Balance': String(balance),
    'X-MAX-Currency': 'MIRCOIN',
  };
}
