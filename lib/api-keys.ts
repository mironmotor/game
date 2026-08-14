/**
 * Ключи MAX API: выпуск, проверка, учёт расхода.
 *
 * Премиум-коды для этого не годятся: код — это разовый пропуск на сайт, его
 * вводит человек глазами. Ключ живёт в чужом коде месяцами, ходит в каждом
 * запросе и должен уметь отзываться и считать деньги.
 *
 * Открытый ключ НЕ хранится. В файле лежит только его sha256: утечка этого
 * файла не даёт возможности ходить в API от чужого имени. Показать ключ можно
 * ровно один раз — в момент выпуска, дальше он существует лишь у владельца.
 *
 * Без БД: JSON рядом с mircoin.json, тот же паттерн и та же папка.
 */
import { createHash, randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DATA_DIR =
  process.env.MIRCOIN_DATA_DIR?.trim() ||
  process.env.CYBERLAB_DATA_DIR?.trim() ||
  path.join(os.homedir(), '.max17');
const STORE = path.join(DATA_DIR, 'api-keys.json');
const USAGE_LIMIT = 200;

export interface ApiUsage {
  ts: string;
  endpoint: string;
  tokens_in: number;
  tokens_out: number;
  cost: number;
  model?: string;
}

export interface ApiKey {
  id: string;
  hash: string;
  prefix: string;
  email: string;
  name: string;
  note: string;
  created_at: string;
  last_used_at?: string;
  revoked_at?: string;
  calls: number;
  tokens_in: number;
  tokens_out: number;
  spent: number;
  /**
   * Незакрытая дробь расхода.
   *
   * MIRCOIN целочисленный, а вызов стоит копейки: попытка списать 0.2 монеты
   * округлялась в ноль, и тысяча дешёвых запросов проходила бы бесплатно.
   * Здесь дробь копится между вызовами, а с баланса уходит только целое —
   * так не теряется ни одна сотая и не появляется несуществующих денег.
   */
  pending: number;
  usage: ApiUsage[];
}

type Store = { keys: Record<string, ApiKey> };

let chain: Promise<unknown> = Promise.resolve();
/** Последовательная запись: два одновременных списания не должны затирать друг друга. */
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.catch(() => undefined);
  return next;
}

function hashKey(key: string): string {
  return createHash('sha256').update(key.trim()).digest('hex');
}

async function read(): Promise<Store> {
  try {
    const raw = await fs.readFile(STORE, 'utf8');
    const data = JSON.parse(raw) as Store;
    if (data && typeof data === 'object' && data.keys) return data;
  } catch {
    // файла ещё нет — это нормально для первого запуска
  }
  return { keys: {} };
}

async function write(store: Store): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(STORE, JSON.stringify(store, null, 2), 'utf8');
}

function publicView(entry: ApiKey) {
  const { hash, usage, ...rest } = entry;
  void hash;
  return { ...rest, recent: usage.slice(0, 20) };
}
export type ApiKeyPublic = ReturnType<typeof publicView>;

/**
 * Выпустить ключ. Открытое значение возвращается ЕДИНСТВЕННЫЙ раз —
 * сохранить его должен тот, кто выпускает.
 */
export function issueKey(opts: {
  email: string;
  name?: string;
  note?: string;
}): Promise<{ key: string; entry: ApiKeyPublic }> {
  return serial(async () => {
    const store = await read();
    // 32 байта случайности: подобрать перебором невозможно, а глазами такой
    // ключ отличим от премиум-кода по префиксу.
    const secret = randomBytes(32).toString('hex');
    const key = `mx-live-${secret}`;
    const id = randomBytes(6).toString('hex');
    const entry: ApiKey = {
      id,
      hash: hashKey(key),
      prefix: key.slice(0, 16),
      email: String(opts.email || '').trim().toLowerCase(),
      name: String(opts.name || '').trim(),
      note: String(opts.note || '').trim(),
      created_at: new Date().toISOString(),
      calls: 0,
      tokens_in: 0,
      tokens_out: 0,
      spent: 0,
      pending: 0,
      usage: [],
    };
    store.keys[id] = entry;
    await write(store);
    return { key, entry: publicView(entry) };
  });
}

/** Кому принадлежит ключ. null — если ключа нет или он отозван. */
export async function verifyKey(key: string): Promise<ApiKey | null> {
  const raw = String(key || '').trim();
  if (!raw.startsWith('mx-live-')) return null;
  const store = await read();
  const hash = hashKey(raw);
  const found = Object.values(store.keys).find((k) => k.hash === hash);
  if (!found || found.revoked_at) return null;
  return found;
}

export async function listKeys(email?: string): Promise<ApiKeyPublic[]> {
  const store = await read();
  const wanted = String(email || '').trim().toLowerCase();
  return Object.values(store.keys)
    .filter((k) => !wanted || k.email === wanted)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map(publicView);
}

export function revokeKey(id: string): Promise<boolean> {
  return serial(async () => {
    const store = await read();
    const entry = store.keys[String(id || '').trim()];
    if (!entry || entry.revoked_at) return false;
    entry.revoked_at = new Date().toISOString();
    await write(store);
    return true;
  });
}

/**
 * Записать расход по ключу.
 *
 * Счётчики нужны не для красоты: по ним владелец видит, куда ушли деньги, а
 * спор «я столько не тратил» решается строкой в журнале, а не на слово.
 */
export function recordUsage(id: string, use: Omit<ApiUsage, 'ts'>): Promise<number> {
  return serial(async () => {
    const store = await read();
    const entry = store.keys[id];
    if (!entry) return 0;
    entry.calls += 1;
    entry.tokens_in += Math.max(0, Math.round(use.tokens_in));
    entry.tokens_out += Math.max(0, Math.round(use.tokens_out));
    entry.spent += Math.max(0, use.cost);
    entry.last_used_at = new Date().toISOString();
    entry.usage = [{ ts: entry.last_used_at, ...use }, ...entry.usage].slice(0, USAGE_LIMIT);

    // Копим дробь и отдаём наружу только целые монеты — их и спишет вызывающий.
    entry.pending = Number(((entry.pending || 0) + Math.max(0, use.cost)).toFixed(6));
    const whole = Math.floor(entry.pending);
    entry.pending = Number((entry.pending - whole).toFixed(6));
    await write(store);
    return whole;
  });
}
