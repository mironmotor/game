'use client';

import { useMemo, useState } from 'react';

// next.config.ts sets basePath '/game'; iframe/fetch srcs are NOT auto-prefixed
// (only next/link and router are), so prefix the API path explicitly.
const BASE = '/game';

export default function MarketPage() {
  const [ml, setMl] = useState(true);
  const [max, setMax] = useState(true);
  const [llm, setLlm] = useState(false);
  const [nonce, setNonce] = useState(0);
  const [loading, setLoading] = useState(true);

  const src = useMemo(() => {
    const params = new URLSearchParams();
    if (ml) params.set('ml', '1');
    if (max || llm) params.set('max', '1');
    if (llm) params.set('llm', '1');
    params.set('n', String(nonce));
    return `${BASE}/api/market?${params.toString()}`;
  }, [ml, max, llm, nonce]);

  const refresh = () => {
    setLoading(true);
    setNonce((n) => n + 1);
  };

  return (
    <main className="min-h-screen bg-[#0e1117] text-[#e6e6e6]">
      <header className="flex flex-wrap items-center gap-3 border-b border-[#232a33] px-4 py-3">
        <a
          href={`${BASE}/`}
          className="rounded-md border border-cyan-300/30 px-3 py-1 text-sm text-cyan-200 transition hover:border-cyan-300/60"
        >
          ← HUD
        </a>
        <h1 className="text-base font-semibold">GAME MARKET CORE</h1>
        <span className="text-xs text-[#9aa4b2]">live strategy dashboard · paper · not financial advice</span>

        <div className="ml-auto flex items-center gap-4 text-sm">
          <label className="flex cursor-pointer items-center gap-1.5">
            <input type="checkbox" checked={ml} onChange={(e) => setMl(e.target.checked)} />
            ML filter
          </label>
          <label className="flex cursor-pointer items-center gap-1.5">
            <input type="checkbox" checked={max} onChange={(e) => setMax(e.target.checked)} />
            Max advisor
          </label>
          <label className="flex cursor-pointer items-center gap-1.5" title="Needs Ollama running locally">
            <input type="checkbox" checked={llm} onChange={(e) => setLlm(e.target.checked)} />
            Max LLM
          </label>
          <button
            type="button"
            onClick={refresh}
            className="rounded-md border border-emerald-300/40 px-3 py-1 text-emerald-200 transition hover:border-emerald-300/70"
          >
            {loading ? 'Building…' : 'Refresh'}
          </button>
        </div>
      </header>

      {loading && (
        <div className="px-4 py-2 text-xs text-[#9aa4b2]">
          Building dashboard from real data (first run fetches BTC history; can take a few seconds)…
        </div>
      )}

      <iframe
        key={src}
        src={src}
        title="Market Core dashboard"
        onLoad={() => setLoading(false)}
        className="h-[calc(100vh-58px)] w-full border-0"
      />
    </main>
  );
}
