/**
 * Tiny, dependency-free text helpers for the deterministic agent heuristics.
 * Bilingual (ru/en) by design — the project speaks both.
 */

export function normalize(text: string): string {
  return (text || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

export function tokenize(text: string): string[] {
  return normalize(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

export function containsAny(text: string, terms: string[]): boolean {
  const n = normalize(text);
  return terms.some((t) => n.includes(normalize(t)));
}

/** Which of `terms` appear in `text` (case-insensitive substring match). */
export function matchedTerms(text: string, terms: string[]): string[] {
  const n = normalize(text);
  return terms.filter((t) => n.includes(normalize(t)));
}

/** 0..1 signal strength = matched terms / a soft saturation point. */
export function signalStrength(text: string, terms: string[], saturateAt = 3): number {
  const hits = matchedTerms(text, terms).length;
  return clamp01(hits / saturateAt);
}

export function detectLocale(text: string): 'ru' | 'en' {
  return /[а-яё]/i.test(text) ? 'ru' : 'en';
}

export interface Quantity {
  amount: number;
  unit: string;
}

/** Extract "3 reels", "5 постов" style quantity+noun pairs. */
export function extractQuantities(text: string): Quantity[] {
  const out: Quantity[] = [];
  const re = /(\d+)\s+([\p{L}]+)/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push({ amount: Number(m[1]), unit: m[2].toLowerCase() });
  }
  return out;
}

const STOP_ENTITIES = new Set(['я', 'reels', 'reel', 'telegram', 'ai']);

/**
 * Heuristic "named entity" grab: CamelCase / TitleCase / ALLCAPS tokens, which
 * in this domain are usually product / project names (e.g. "AstroMap").
 */
export function extractEntities(text: string): string[] {
  const matches =
    text.match(/\b([A-ZА-ЯЁ][a-zа-яё0-9]*[A-ZА-ЯЁ][A-Za-zА-Яа-яЁё0-9]*|[A-ZА-ЯЁ]{2,}|[A-ZА-ЯЁ][a-zа-яё]{3,})\b/gu) ||
    [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of matches) {
    if (STOP_ENTITIES.has(w.toLowerCase())) continue;
    if (!seen.has(w)) {
      seen.add(w);
      out.push(w);
    }
  }
  return out;
}

export function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

export function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

export function genId(prefix = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
