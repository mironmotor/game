// Server-side premium gate. Codes live in PREMIUM_ACCESS_CODES (comma-
// separated, server-only env) — they are never inlined into the client bundle,
// so the public mir.care build can't leak the gate. NEXT_PUBLIC_PREMIUM_CODE is
// kept as a legacy fallback for old local setups.
//
// Кроме env-списка есть выписываемые коды (lib/premium-store): их можно
// создать кнопкой на продажу, дать срок и отозвать — без правки env и
// редеплоя. Проверяются оба источника, env остаётся рабочим как раньше.
import { checkCode, redeemCode } from '@/lib/premium-store';

export function premiumCodes(): string[] {
  return (process.env.PREMIUM_ACCESS_CODES || process.env.NEXT_PUBLIC_PREMIUM_CODE || 'MIR-PREMIUM')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Синхронная проверка ТОЛЬКО env-кодов (оставлена ради старых вызовов). */
export function isPremiumCode(code: unknown): boolean {
  return typeof code === 'string' && code.trim() !== '' && premiumCodes().includes(code.trim());
}

/**
 * Полная проверка: env-коды + выписанные. `redeem` отмечает использование
 * (кто и когда) — включать только там, где это осмысленно (валидация кода
 * пользователем), но не на каждом фоновом запросе.
 */
export async function validatePremiumCode(
  code: unknown,
  opts: { email?: string; redeem?: boolean } = {},
): Promise<boolean> {
  if (typeof code !== 'string' || code.trim() === '') return false;
  if (isPremiumCode(code)) return true;
  try {
    return opts.redeem ? await redeemCode(code, opts.email) : await checkCode(code);
  } catch {
    // Хранилище недоступно (например, read-only ФС) — env-коды всё равно работают.
    return false;
  }
}
