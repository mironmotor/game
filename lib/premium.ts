// Server-side premium gate. Codes live in PREMIUM_ACCESS_CODES (comma-
// separated, server-only env) — they are never inlined into the client bundle,
// so the public mir.care build can't leak the gate. NEXT_PUBLIC_PREMIUM_CODE is
// kept as a legacy fallback for old local setups.
export function premiumCodes(): string[] {
  return (process.env.PREMIUM_ACCESS_CODES || process.env.NEXT_PUBLIC_PREMIUM_CODE || 'MIR-PREMIUM')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function isPremiumCode(code: unknown): boolean {
  return typeof code === 'string' && code.trim() !== '' && premiumCodes().includes(code.trim());
}
