/**
 * Серверный стор MIRCOIN — баланс, привязанный к Google-аккаунту (email).
 * Внутриигровая валюта (НЕ крипта, не деньги — см. hooks/use-mircoin.ts).
 * Без БД: JSON-файл в домашней папке (работает и на Mac, и на сервере).
 * Записи сериализованы, чтобы гранты/переводы не гонялись друг с другом.
 */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DATA_DIR =
  process.env.MIRCOIN_DATA_DIR?.trim() ||
  process.env.CYBERLAB_DATA_DIR?.trim() ||
  path.join(os.homedir(), '.max17');
const STORE = path.join(DATA_DIR, 'mircoin.json');
const LEDGER_LIMIT = 100;

export interface MirCoinTx {
  id: string;
  amount: number;
  reason: string;
  ts: string;
}
export interface MirCoinAccount {
  email: string;
  name?: string;
  balance: number;
  ledger: MirCoinTx[];
}
type Store = { accounts: Record<string, MirCoinAccount> };

function key(email: string): string {
  return String(email || '').trim().toLowerCase();
}

async function read(): Promise<Store> {
  try {
    const parsed = JSON.parse(await fs.readFile(STORE, 'utf-8'));
    return parsed && typeof parsed === 'object' && parsed.accounts ? (parsed as Store) : { accounts: {} };
  } catch {
    return { accounts: {} };
  }
}

async function write(store: Store): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(STORE, JSON.stringify(store), 'utf-8');
}

function ensure(store: Store, email: string, name?: string): MirCoinAccount {
  const k = key(email);
  if (!store.accounts[k]) store.accounts[k] = { email: k, name, balance: 0, ledger: [] };
  if (name && !store.accounts[k].name) store.accounts[k].name = name;
  return store.accounts[k];
}

function tx(amount: number, reason: string): MirCoinTx {
  return {
    id: `mc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    amount: Math.round(amount),
    reason: String(reason || '').slice(0, 160),
    ts: new Date().toISOString(),
  };
}

// Простая сериализация записей внутри процесса (без БД-транзакций).
let chain: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => {});
  return run as Promise<T>;
}

export async function getAccount(email: string): Promise<MirCoinAccount> {
  const store = await read();
  return store.accounts[key(email)] ?? { email: key(email), balance: 0, ledger: [] };
}

export async function listAccounts(): Promise<MirCoinAccount[]> {
  const store = await read();
  return Object.values(store.accounts).sort((a, b) => b.balance - a.balance);
}

export function ensureAccount(email: string, name?: string): Promise<MirCoinAccount> {
  return serial(async () => {
    const store = await read();
    const acc = ensure(store, email, name);
    await write(store);
    return acc;
  });
}

/** Начислить дельту (может быть отрицательной). Баланс не уходит ниже 0. */
export function earn(email: string, amount: number, reason: string, name?: string): Promise<MirCoinAccount> {
  return serial(async () => {
    const store = await read();
    const acc = ensure(store, email, name);
    acc.balance = Math.max(0, Math.round(acc.balance + amount));
    acc.ledger = [tx(amount, reason), ...acc.ledger].slice(0, LEDGER_LIMIT);
    await write(store);
    return acc;
  });
}

/** Установить точный баланс (для гранта). */
export function setBalance(email: string, balance: number, reason: string, name?: string): Promise<MirCoinAccount> {
  return serial(async () => {
    const store = await read();
    const acc = ensure(store, email, name);
    const target = Math.max(0, Math.round(balance));
    acc.ledger = [tx(target - acc.balance, reason), ...acc.ledger].slice(0, LEDGER_LIMIT);
    acc.balance = target;
    await write(store);
    return acc;
  });
}

export interface TransferResult {
  ok: boolean;
  error?: string;
  from?: MirCoinAccount;
  to?: MirCoinAccount;
}

/** Перевод между аккаунтами: атомарно списываем у from, зачисляем to. */
export function transfer(fromEmail: string, toEmail: string, amount: number, reason = 'перевод'): Promise<TransferResult> {
  return serial(async () => {
    const amt = Math.round(amount);
    if (!Number.isFinite(amt) || amt <= 0) return { ok: false, error: 'bad_amount' };
    if (key(fromEmail) === key(toEmail)) return { ok: false, error: 'same_account' };
    const store = await read();
    const from = ensure(store, fromEmail);
    if (from.balance < amt) return { ok: false, error: 'insufficient' };
    const to = ensure(store, toEmail);
    from.balance -= amt;
    to.balance += amt;
    from.ledger = [tx(-amt, `${reason} → ${key(toEmail)}`), ...from.ledger].slice(0, LEDGER_LIMIT);
    to.ledger = [tx(amt, `${reason} ← ${key(fromEmail)}`), ...to.ledger].slice(0, LEDGER_LIMIT);
    await write(store);
    return { ok: true, from, to };
  });
}
