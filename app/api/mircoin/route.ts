import { NextResponse } from 'next/server';

import { auth } from '@/lib/auth';
import { earn, getAccount, listAccounts, setBalance, transfer } from '@/lib/mircoin-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Админ = Google-email из ADMIN_EMAILS (по умолчанию mironbocharov48@gmail.com)
// или заголовок x-admin-token === ADMIN_TOKEN. (Тот же принцип, что в /api/admin.)
function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS || 'mironbocharov48@gmail.com')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

async function sessionEmail(): Promise<{ email: string; name?: string } | null> {
  try {
    const session = await auth();
    const email = session?.user?.email?.toLowerCase();
    if (!email) return null;
    return { email, name: session?.user?.name || undefined };
  } catch {
    return null;
  }
}

async function isAdmin(request: Request, email?: string): Promise<boolean> {
  const token = (request.headers.get('x-admin-token') || '').trim();
  const wanted = (process.env.ADMIN_TOKEN || '').trim();
  if (wanted && token && token === wanted) return true;
  return Boolean(email && adminEmails().includes(email));
}

export async function GET(request: Request) {
  const me = await sessionEmail();
  const scope = new URL(request.url).searchParams.get('scope');

  // Список всех аккаунтов — только админу (для выбора получателя перевода).
  if (scope === 'users') {
    if (!(await isAdmin(request, me?.email))) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    const users = (await listAccounts()).map((a) => ({ email: a.email, name: a.name || null, balance: a.balance }));
    return NextResponse.json({ users });
  }

  // Свой баланс (нужен вход).
  if (!me) return NextResponse.json({ error: 'authentication_required' }, { status: 401 });
  const account = await getAccount(me.email);
  return NextResponse.json({
    email: me.email,
    balance: account.balance,
    ledger: account.ledger.slice(0, 30),
    admin: await isAdmin(request, me.email),
  });
}

export async function POST(request: Request) {
  const me = await sessionEmail();
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const action = String(body.action || '');
  const amount = Math.round(Number(body.amount) || 0);

  // earn: залогиненный юзер начисляет СЕБЕ (зеркалит игровые начисления в аккаунт).
  if (action === 'earn') {
    if (!me) return NextResponse.json({ error: 'authentication_required' }, { status: 401 });
    const reason = String(body.reason || 'earn').slice(0, 160);
    const acc = await earn(me.email, amount, reason, me.name);
    return NextResponse.json({ ok: true, balance: acc.balance });
  }

  // grant / transfer — только админ.
  if (!(await isAdmin(request, me?.email))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  if (action === 'grant') {
    const target = String(body.email || me?.email || '').toLowerCase();
    if (!target) return NextResponse.json({ error: 'email_required' }, { status: 400 });
    const acc = await setBalance(target, amount, String(body.reason || 'admin grant'));
    return NextResponse.json({ ok: true, email: acc.email, balance: acc.balance });
  }

  if (action === 'transfer') {
    if (!me) return NextResponse.json({ error: 'authentication_required' }, { status: 401 });
    const to = String(body.to || '').toLowerCase();
    if (!to) return NextResponse.json({ error: 'recipient_required' }, { status: 400 });
    const res = await transfer(me.email, to, amount, String(body.reason || 'перевод'));
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });
    return NextResponse.json({
      ok: true,
      from: { email: res.from!.email, balance: res.from!.balance },
      to: { email: res.to!.email, balance: res.to!.balance },
    });
  }

  return NextResponse.json({ error: 'unknown_action' }, { status: 400 });
}
