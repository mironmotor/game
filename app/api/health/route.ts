import { NextResponse } from 'next/server';
import { appBasePath } from '@/lib/base-path';
import { daemonStatus, rewarmDaemon } from '../max17/max17-daemon';

export const runtime = 'nodejs';

// Doctor dashboard backend. Aggregates the core health sweep (mark17/doctor.py via
// the `health` event) with TS-side daemon liveness, and runs the safe auto-fixes.
//   GET                    -> health sweep (no browser errors)
//   POST {client_errors?}  -> sweep including recent browser errors
//   POST {fix}             -> run a fix (rewarm_daemon here; others forwarded to core), then re-sweep

function coreUrl(_request: Request): string {
  // ВНУТРЕННИЙ вызов ядра — ТОЛЬКО на localhost. За nginx origin запроса =
  // публичный https://mir.care, а сервер не может зафетчить свой публичный URL
  // (fetch failed → Доктор показывал 0%). Порт = где слушает next (3000).
  return `http://127.0.0.1:${process.env.PORT || '3000'}${appBasePath}/api/max17`;
}

async function callCore(request: Request, event: Record<string, unknown>) {
  const res = await fetch(coreUrl(request), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(event),
  });
  return (await res.json()) as { ok?: boolean; health?: Record<string, unknown>; error?: string };
}

async function sweep(request: Request, clientErrors: unknown[]) {
  // Демон засыпает от простоя и греется по требованию — это НЕ поломка. Но свип
  // на холодном демоне давал ложные 0% («demon_down» critical). Раз Доктор
  // активно проверяет здоровье — законно разбудить демона и мерить уже живого.
  let daemon = daemonStatus();
  if (!daemon.alive) {
    rewarmDaemon();
    daemon = daemonStatus();
  }
  const data = await callCore(request, { type: 'health', action: 'sweep', client_errors: clientErrors, daemon });
  return { ok: data.ok ?? false, health: data.health ?? null, daemon, error: data.error };
}

export async function GET(request: Request) {
  try {
    return NextResponse.json(await sweep(request, []));
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}

export async function POST(request: Request) {
  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }
  const clientErrors = Array.isArray(body.client_errors) ? body.client_errors : [];
  const fix = typeof body.fix === 'string' ? body.fix : '';

  try {
    if (fix === 'rewarm_daemon') {
      const r = rewarmDaemon();
      const s = await sweep(request, clientErrors);
      return NextResponse.json({ ...s, fix: { ok: r.ok, action: 'rewarm_daemon', result: r } });
    }
    if (fix) {
      // Core-side fix: clear_cache / reseed_missions / voice_fallback.
      const daemon = daemonStatus();
      const data = await callCore(request, {
        type: 'health',
        action: 'fix',
        fix_action: fix,
        client_errors: clientErrors,
        daemon,
      });
      return NextResponse.json({ ok: data.ok ?? false, health: data.health ?? null, daemon, error: data.error });
    }
    return NextResponse.json(await sweep(request, clientErrors));
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
