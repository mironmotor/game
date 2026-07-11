import { NextResponse } from 'next/server';
import { daemonStatus, rewarmDaemon } from '../max17/max17-daemon';

export const runtime = 'nodejs';

// Doctor dashboard backend. Aggregates the core health sweep (mark17/doctor.py via
// the `health` event) with TS-side daemon liveness, and runs the safe auto-fixes.
//   GET                    -> health sweep (no browser errors)
//   POST {client_errors?}  -> sweep including recent browser errors
//   POST {fix}             -> run a fix (rewarm_daemon here; others forwarded to core), then re-sweep

function coreUrl(request: Request): string {
  const url = new URL(request.url);
  // Next strips basePath from request.url, so rebuild it explicitly (matches
  // next.config basePath '/game'; the bare /api/max17 path is a 404).
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '/game';
  return `${url.origin}${basePath}/api/max17`;
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
  const daemon = daemonStatus();
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
