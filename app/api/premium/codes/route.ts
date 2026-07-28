import { NextResponse } from 'next/server';

import { auth } from '@/lib/auth';
import { issueCode, listCodes, revokeCode, isActive } from '@/lib/premium-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Выпуск и отзыв premium-кодов. Доступ — только админу: Google-email из
// ADMIN_EMAILS или заголовок x-admin-token (тот же принцип, что в /api/mircoin
// и /api/admin), чтобы коды нельзя было напечатать себе со стороны.

function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS || 'mironbocharov48@gmail.com')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

async function sessionEmail(): Promise<string | null> {
  try {
    const session = await auth();
    return session?.user?.email?.toLowerCase() || null;
  } catch {
    return null;
  }
}

async function isAdmin(request: Request): Promise<boolean> {
  const token = (request.headers.get('x-admin-token') || '').trim();
  const wanted = (process.env.ADMIN_TOKEN || '').trim();
  if (wanted && token && token === wanted) return true;
  const email = await sessionEmail();
  return Boolean(email && adminEmails().includes(email));
}

export async function GET(request: Request) {
  if (!(await isAdmin(request))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const codes = await listCodes();
  return NextResponse.json({
    codes: codes.map((c) => ({ ...c, active: isActive(c) })),
    active: codes.filter((c) => isActive(c)).length,
    total: codes.length,
  });
}

export async function POST(request: Request) {
  if (!(await isAdmin(request))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    /* пустое тело — выпустим код с настройками по умолчанию */
  }

  const action = String(body.action || 'issue');

  if (action === 'revoke') {
    const code = String(body.code || '');
    const ok = await revokeCode(code);
    return NextResponse.json({ ok }, { status: ok ? 200 : 404 });
  }

  const daysRaw = body.days;
  const days =
    daysRaw === null || daysRaw === undefined || daysRaw === ''
      ? null
      : Math.max(1, Math.min(3650, Number(daysRaw) || 30));
  const entry = await issueCode({ note: String(body.note || ''), days });
  return NextResponse.json({ ok: true, code: entry });
}
