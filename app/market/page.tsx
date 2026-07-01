'use client';

import { useMemo, useState } from 'react';

// next.config.ts sets basePath '/game'.
const BASE = '/game';
const DEFAULT_URL = 'http://127.0.0.1:8000';

// Server mode is on (see next.config.ts), so app/api/** route handlers DO
// run here. This page still embeds the Python dashboard server directly
// (rather than spawning python3 from a Vercel serverless function) because
// that spawn is not reliably available in a Node serverless runtime and has
// no persistent process/port across invocations. Run it in a terminal:
//   cd game_market_core && python3 main.py serve   (optionally --ml --max)
// then this tab shows it inside the Game. This works today when the Game and
// the dashboard server run on the same machine (local dev); making it visible
// to remote visitors on the deployed site needs an always-on hosted backend.
export default function MarketPage() {
  const [url, setUrl] = useState(DEFAULT_URL);
  const [active, setActive] = useState(DEFAULT_URL);
  const [nonce, setNonce] = useState(0);
  const [loading, setLoading] = useState(true);

  const src = useMemo(() => `${active}/?n=${nonce}`, [active, nonce]);

  const connect = () => {
    setLoading(true);
    setActive(url);
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
        <span className="text-xs text-[#9aa4b2]">live dashboard · paper · not financial advice</span>

        <div className="ml-auto flex items-center gap-2 text-sm">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && connect()}
            className="w-56 rounded-md border border-[#232a33] bg-[#161b22] px-2 py-1 text-xs"
            spellCheck={false}
          />
          <button
            type="button"
            onClick={connect}
            className="rounded-md border border-emerald-300/40 px-3 py-1 text-emerald-200 transition hover:border-emerald-300/70"
          >
            {loading ? 'Loading…' : 'Reload'}
          </button>
          <a
            href={active}
            target="_blank"
            rel="noreferrer"
            className="rounded-md border border-[#232a33] px-3 py-1 text-[#9aa4b2] transition hover:text-white"
          >
            ↗ open
          </a>
        </div>
      </header>

      <div className="border-b border-[#232a33] bg-[#0b0f14] px-4 py-2 text-xs text-[#9aa4b2]">
        Start the server first:{' '}
        <code className="text-emerald-300">cd game_market_core &amp;&amp; python3 main.py serve --ml --max</code>{' '}
        — then click Reload. If the panel is blank, the server isn&apos;t running on that address.
      </div>

      <iframe
        key={src}
        src={src}
        title="Market Core dashboard"
        onLoad={() => setLoading(false)}
        className="h-[calc(100vh-90px)] w-full border-0"
      />
    </main>
  );
}
