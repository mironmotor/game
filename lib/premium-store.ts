/**
 * Хранилище premium-кодов: выпуск, проверка, отзыв.
 *
 * Зачем: коды из PREMIUM_ACCESS_CODES — статический env-список, и каждая
 * продажа требовала правки переменной и редеплоя. Здесь код выписывается
 * кнопкой и живёт в файле, поэтому продать доступ можно за минуту любым
 * способом оплаты (перевод, наличные, потом — платёжка через вебхук).
 *
 * Без БД: JSON-файл рядом с mircoin.json (тот же паттерн и та же папка).
 */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const DATA_DIR =
  process.env.MIRCOIN_DATA_DIR?.trim() ||
  process.env.CYBERLAB_DATA_DIR?.trim() ||
  path.join(os.homedir(), '.max17');
const STORE = path.join(DATA_DIR, 'premium-codes.json');

export interface PremiumCode {
  code: string;
  note: string;          // кому/за что выдан — чтобы не потерять покупателя
  createdAt: string;
  expiresAt: string | null;  // null = бессрочно
  revoked: boolean;
  usedBy: string[];      // email'ы, которые им пользовались (для контроля)
  lastUsedAt: string | null;
  uses: number;
}

type Store = { codes: Record<string, PremiumCode> };

function key(code: string): string {
  return String(code || '').trim().toUpperCase();
}

async function read(): Promise<Store> {
  try {
    const parsed = JSON.parse(await fs.readFile(STORE, 'utf-8'));
    return parsed && typeof parsed === 'object' && parsed.codes ? (parsed as Store) : { codes: {} };
  } catch {
    return { codes: {} };
  }
}

async function write(store: Store): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(STORE, JSON.stringify(store), 'utf-8');
}

// Сериализация записей внутри процесса, чтобы параллельные выпуски не затирали
// друг друга (тот же приём, что в mircoin-store).
let chain: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => {});
  return run as Promise<T>;
}

/** Читаемый код вида MIR-XXXX-XXXX (без похожих символов 0/O, 1/I). */
export function generateCode(prefix = 'MIR'): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const pick = (n: number) =>
    Array.from(crypto.randomBytes(n))
      .map((b) => alphabet[b % alphabet.length])
      .join('');
  return `${prefix}-${pick(4)}-${pick(4)}`;
}

export function isExpired(entry: PremiumCode, now = Date.now()): boolean {
  return Boolean(entry.expiresAt) && new Date(entry.expiresAt as string).getTime() < now;
}

export function isActive(entry: PremiumCode, now = Date.now()): boolean {
  return !entry.revoked && !isExpired(entry, now);
}

export async function issueCode(opts: {
  note?: string;
  days?: number | null;
  code?: string;
} = {}): Promise<PremiumCode> {
  return serial(async () => {
    const store = await read();
    let code = key(opts.code || '');
    if (!code) {
      do {
        code = generateCode();
      } while (store.codes[code]);
    }
    const days = opts.days ?? null;
    const entry: PremiumCode = {
      code,
      note: String(opts.note || '').slice(0, 160),
      createdAt: new Date().toISOString(),
      expiresAt: days && days > 0 ? new Date(Date.now() + days * 86_400_000).toISOString() : null,
      revoked: false,
      usedBy: [],
      lastUsedAt: null,
      uses: 0,
    };
    store.codes[code] = entry;
    await write(store);
    return entry;
  });
}

export async function revokeCode(code: string): Promise<boolean> {
  return serial(async () => {
    const store = await read();
    const entry = store.codes[key(code)];
    if (!entry) return false;
    entry.revoked = true;
    await write(store);
    return true;
  });
}

export async function listCodes(): Promise<PremiumCode[]> {
  const store = await read();
  return Object.values(store.codes).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Проверка кода при использовании. Отмечает факт использования (кто и когда),
 * чтобы было видно, живёт ли покупатель и не гуляет ли код по рукам.
 */
export async function redeemCode(code: string, email?: string): Promise<boolean> {
  const k = key(code);
  if (!k) return false;
  return serial(async () => {
    const store = await read();
    const entry = store.codes[k];
    if (!entry || !isActive(entry)) return false;
    entry.uses += 1;
    entry.lastUsedAt = new Date().toISOString();
    const who = String(email || '').trim().toLowerCase();
    if (who && !entry.usedBy.includes(who)) entry.usedBy.push(who);
    await write(store);
    return true;
  });
}

/** Выписан ли такой код (в отличие от служебного env-кода). */
export async function isIssuedCode(code: string): Promise<boolean> {
  const k = key(code);
  if (!k) return false;
  const store = await read();
  return Boolean(store.codes[k]);
}

/** Только проверка, без записи (для горячего пути запросов). */
export async function checkCode(code: string): Promise<boolean> {
  const k = key(code);
  if (!k) return false;
  const store = await read();
  const entry = store.codes[k];
  return Boolean(entry && isActive(entry));
}
