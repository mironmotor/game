/**
 * Реальность-гейт со стороны приложения: запись сигналов в тот же журнал,
 * что читает ядро (mark17/reality.py).
 *
 * Зачем здесь, а не только в Python: единственный по-настоящему внешний
 * сигнал, который приложение видит первым, — это активация купленного
 * premium-кода. Человек заплатил и пришёл. Такое нельзя выдумать за
 * ноутбуком, поэтому оно и есть «блок».
 *
 * Формат намеренно совпадает с reality.py — обе стороны просто дописывают
 * записи в общий журнал.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';

// Те же виды, что в reality.py: блоки — сигналы извне, остальное — перебор.
const BLOCK_KINDS = new Set(['payment', 'user_returned', 'user_signup', 'reply', 'rejection']);

interface RealityEntry {
  kind: string;
  block: boolean;
  note: string;
  amount: number;
  source: string;
  ts: number;
}

function ledgerPath(): string {
  const dir = process.env.MAX17_STATE_DIR?.trim() || path.join(process.cwd(), 'mark17', 'state');
  return path.join(dir, 'reality.json');
}

/**
 * Дописать событие в журнал. Никогда не бросает: журнал полезен, но ради
 * него нельзя ронять оплату или ответ пользователю.
 */
export async function recordReality(
  kind: string,
  opts: { note?: string; amount?: number; source?: string } = {},
): Promise<void> {
  const file = ledgerPath();
  const entry: RealityEntry = {
    kind: String(kind || '').trim().toLowerCase(),
    block: BLOCK_KINDS.has(String(kind || '').trim().toLowerCase()),
    note: String(opts.note || '').slice(0, 200),
    amount: Math.round((Number(opts.amount) || 0) * 100) / 100,
    source: String(opts.source || '').slice(0, 60),
    ts: Date.now() / 1000,
  };

  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    let data: { entries: RealityEntry[] } = { entries: [] };
    try {
      const parsed = JSON.parse(await fs.readFile(file, 'utf-8'));
      if (parsed && Array.isArray(parsed.entries)) data = parsed;
    } catch {
      /* журнала ещё нет или он повреждён — начнём заново */
    }
    data.entries.push(entry);
    data.entries = data.entries.slice(-2000);
    await fs.writeFile(file, JSON.stringify(data), 'utf-8');
  } catch {
    /* нет прав на запись (например, эфемерная ФС) — молча пропускаем */
  }
}
