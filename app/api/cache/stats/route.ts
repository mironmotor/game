import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

// Fast-path LLM cache monitoring. GET -> { ok, cache: { hits, misses, hit_rate,
// size, ... } }. ?clear=1 resets counters. Thin proxy over the core's
// `cache_stats` event (the cache lives in mark17/gonka_bridge.py).

export async function GET(request: Request) {
  const url = new URL(request.url);
  const clear = url.searchParams.get('clear') === '1';
  // Next strips basePath from request.url, so rebuild it explicitly (matches
  // next.config basePath '/game'; the bare /api/max17 path is a 404).
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '/game';
  const target = `${url.origin}${basePath}/api/max17`;
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
