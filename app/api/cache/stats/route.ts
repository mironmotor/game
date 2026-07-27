import { NextResponse } from 'next/server';
import { appBasePath } from '@/lib/base-path';

export const runtime = 'nodejs';

// Fast-path LLM cache monitoring. GET -> { ok, cache: { hits, misses, hit_rate,
// size, ... } }. ?clear=1 resets counters. Thin proxy over the core's
// `cache_stats` event (the cache lives in mark17/gonka_bridge.py).

export async function GET(request: Request) {
  const url = new URL(request.url);
  const clear = url.searchParams.get('clear') === '1';
  // Next strips its configured basePath from request.url inside route handlers.
  const target = `${url.origin}${appBasePath}/api/max17`;
  try {
    const res = await fetch(target, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'cache_stats', clear }),
    });
    const data = (await res.json()) as { ok?: boolean; cache?: unknown; error?: string };
    return NextResponse.json({ ok: data.ok ?? false, cache: data.cache ?? null, error: data.error });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
