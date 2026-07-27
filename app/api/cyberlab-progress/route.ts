import { NextResponse } from 'next/server';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

import { auth } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Прогресс Cyber Lab, привязанный к аккаунту (email залогиненного юзера).
// Без БД: маленький JSON-стор в домашней папке (пишется и на Mac, и на Linux-
// сервере; не зависит от DATABASE_URL). Ключ — хэш email, а не сам email.
const DATA_DIR = process.env.CYBERLAB_DATA_DIR?.trim() || path.join(os.homedir(), '.max17');
const STORE = path.join(DATA_DIR, 'cyberlab-progress.json');

const MODULE_IDS = new Set(['scope', 'network', 'linux', 'web', 'tools', 'labs', 'reporting']);

type Progress = { acknowledged: boolean; completed: string[]; quizPassed: boolean };

function sanitize(value: unknown): Progress {
  const o = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return {
    acknowledged: o.acknowledged === true,
    completed: Array.isArray(o.completed)
      ? Array.from(new Set(o.completed.filter((x): x is string => typeof x === 'string' && MODULE_IDS.has(x)))).slice(0, MODULE_IDS.size)
      : [],
    quizPassed: o.quizPassed === true,
  };
}

async function readAll(): Promise<Record<string, Progress>> {
  try {
    const raw = await fs.readFile(STORE, 'utf-8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, Progress>) : {};
  } catch {
    return {};
  }
}

async function writeAll(data: Record<string, Progress>): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(STORE, JSON.stringify(data), 'utf-8');
}

function keyFor(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex').slice(0, 32);
}

export async function GET() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: 'authentication_required' }, { status: 401 });
  const all = await readAll();
  return NextResponse.json({ progress: all[keyFor(email)] ?? null });
}

export async function PUT(request: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: 'authentication_required' }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const incoming = body && typeof body === 'object' && 'progress' in (body as Record<string, unknown>)
    ? (body as Record<string, unknown>).progress
    : body;
  const progress = sanitize(incoming);

  const all = await readAll();
  all[keyFor(email)] = progress;
  await writeAll(all);
  return NextResponse.json({ progress, saved: true });
}
