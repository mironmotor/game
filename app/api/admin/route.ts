import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { appBasePath } from '@/lib/base-path';
import { premiumCodes } from '@/lib/premium';

export const runtime = 'nodejs';

// Админ-дашборд. Доступ ТОЛЬКО:
//   • Google-аккаунту Мирона (ADMIN_EMAILS, по умолчанию mironbocharov48@gmail.com),
//   • или по заголовку x-admin-token === ADMIN_TOKEN (пока Google OAuth не настроен).
// Всё остальное — 401 без деталей.

function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS || 'mironbocharov48@gmail.com')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

async function checkAdmin(request: Request): Promise<{ ok: boolean; via: string; email?: string }> {
  const token = (request.headers.get('x-admin-token') || '').trim();
  const wanted = (process.env.ADMIN_TOKEN || '').trim();
  if (wanted && token && token === wanted) return { ok: true, via: 'token' };
  try {
    const session = await auth();
    const email = session?.user?.email?.toLowerCase() || '';
    if (email && adminEmails().includes(email)) return { ok: true, via: 'google', email };
  } catch {
    /* auth unconfigured → not an admin path */
  }
  return { ok: false, via: 'none' };
}

function coreUrl(_request: Request): string {
  // Внутренний вызов ядра — localhost (за nginx self-fetch публичного URL падает).
  return `http://127.0.0.1:${process.env.PORT || '3000'}${appBasePath}/api/max17`;
}

async function callCore(request: Request, event: Record<string, unknown>): Promise<Record<string, unknown>> {
  try {
    const res = await fetch(coreUrl(request), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(30_000),
    });
    return (await res.json()) as Record<string, unknown>;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function GET(request: Request) {
  const admin = await checkAdmin(request);
  if (!admin.ok) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });

  const [health, graph] = await Promise.all([
    callCore(request, { type: 'health', action: 'sweep' }),
    callCore(request, { type: 'graph_stats' }),
  ]);

  return NextResponse.json({
    ok: true,
    via: admin.via,
    email: admin.email || null,
    health: health.health ?? null,
    graph: graph.graph_stats ?? graph.stats ?? graph.graph ?? null,
    premium: {
      codes: premiumCodes(),
      remote_core_configured: Boolean((process.env.MAX17_REMOTE_CORE_URL || '').trim()),
    },
    server: {
      uptime_sec: Math.round(process.uptime()),
      node: process.version,
      mem_mb: Math.round(process.memoryUsage().rss / 1048576),
    },
  });
}

export async function POST(request: Request) {
  const admin = await checkAdmin(request);
  if (!admin.ok) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });

  let fix = '';
  try {
    const body = await request.json();
    fix = typeof body?.fix === 'string' ? body.fix : '';
  } catch {
    /* ignore */
  }
  if (!fix) return NextResponse.json({ ok: false, error: 'fix required' }, { status: 400 });

  // Переиспользуем механизм фиксов Доктора (rewarm_daemon/clear_cache/…).
  // Внутренний вызов — localhost (за nginx self-fetch публичного URL падает).
  const internal = `http://127.0.0.1:${process.env.PORT || '3000'}${appBasePath}`;
  try {
    const res = await fetch(`${internal}/api/health`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fix }),
      signal: AbortSignal.timeout(60_000),
    });
    return NextResponse.json(await res.json());
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
