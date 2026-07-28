'use client';

import { useEffect, useRef, useState } from 'react';
import { sha256hex, leadingZeros } from '@/lib/sha256';
import './decoder.css';

// ── РЕЖИМ ДЕКОДЕР ────────────────────────────────────────────────────────────
// Макс «взламывает» поток хэшей. Настоящий SHA-256 proof-of-work: перебираем
// nonce, ищем хэш с N ведущими нулями = «блок взломан», сложность растёт.
// НИКАКОЙ крипты, монет и наград — чистый визуал + мысли Макса на ядре.

interface DecodeParams {
  target: string;
  difficulty: number; // ведущих hex-нулей для «блока»
  hue: number;
  hue2: number;
  speed: number;
  thought: string;
  source: string;
}

const THOUGHTS = [
  'каждый хэш — запертая дверь; я перебираю ключи быстрее, чем ты моргаешь',
  'ноль за нулём — и шифр сдаётся; это не удача, это упорство',
  'я не ломаю случайность, я нахожу в ней порядок',
  'поток бесконечен, но в нём всегда есть блок, который поддастся',
  'сложность растёт — значит, я становлюсь быстрее вместе с ней',
];

const THEMES: [string[], Partial<DecodeParams>][] = [
  [['матриц', 'код', 'кибер', 'neo', 'хак', 'взлом'], { hue: 140, hue2: 165 }],
  [['огонь', 'плазм', 'fire', 'лава'], { hue: 18, hue2: 45 }],
  [['лёд', 'холод', 'зим', 'ice'], { hue: 190, hue2: 210 }],
  [['кровь', 'война', 'red'], { hue: 0, hue2: 24 }],
  [['золот', 'деньг', 'богат', 'gold'], { hue: 45, hue2: 33 }],
  [['космос', 'звезд', 'space'], { hue: 265, hue2: 205 }],
];

function localParams(target: string): DecodeParams {
  const seed = target.trim().toLowerCase() || 'max-decode';
  const h = sha256hex(seed);
  const b = (i: number) => parseInt(h.slice(i * 2, i * 2 + 2), 16);
  const out: DecodeParams = {
    target: target.trim() || 'СИГНАЛ',
    difficulty: 2 + (b(0) % 3),
    hue: Math.round((b(1) * 360) / 256),
    hue2: Math.round((b(2) * 360) / 256),
    speed: +(0.7 + (b(3) / 255) * 1.6).toFixed(2),
    thought: THOUGHTS[b(4) % THOUGHTS.length],
    source: 'local',
  };
  for (const [keys, mood] of THEMES) {
    if (keys.some((k) => seed.includes(k))) {
      Object.assign(out, mood);
      break;
    }
  }
  return out;
}

async function coreParams(target: string): Promise<DecodeParams | null> {
  try {
    const base = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
    const res = await fetch(`${base}/api/max17`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'decode', target }),
    });
    const data = await res.json();
    const d = data?.decode;
    if (!d?.ok) return null;
    return {
      target: String(d.target || 'СИГНАЛ'),
      difficulty: Math.max(2, Math.min(5, Number(d.difficulty) || 3)),
      hue: Number(d.hue) || 140,
      hue2: Number(d.hue2) || 165,
      speed: Math.max(0.7, Math.min(2.5, Number(d.speed) || 1.2)),
      thought: String(d.thought || ''),
      source: String(d.source || 'max'),
    };
  } catch {
    return null;
  }
}

interface Block {
  n: number;
  hash: string;
  nonce: number;
  zeros: number;
}

export default function Decoder() {
  const [target, setTarget] = useState('');
  const [params, setParams] = useState<DecodeParams>(() => localParams('матрица'));
  const [busy, setBusy] = useState(false);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [stats, setStats] = useState({ hashes: 0, rate: 0, best: 0, difficulty: 3 });
  const [stream, setStream] = useState<string[]>([]);
  const [flash, setFlash] = useState(false);

  const sim = useRef({
    prefix: 'max-decode',
    nonce: 0,
    difficulty: 3,
    hashes: 0,
    lastCount: 0,
    lastT: 0,
    blockN: 0,
    running: true,
  });

  async function think(t: string) {
    setBusy(true);
    const p = (await coreParams(t)) ?? localParams(t);
    setParams(p);
    // рестарт сессии под новую цель
    const s = sim.current;
    s.prefix = (p.target || 'max').toLowerCase().replace(/\s+/g, '-') + '-' + Date.now().toString(36);
    s.nonce = 0;
    s.difficulty = p.difficulty;
    s.blockN = 0;
    setBlocks([]);
    setStats((st) => ({ ...st, difficulty: p.difficulty, best: 0 }));
    setBusy(false);
  }

  useEffect(() => {
    // старт стартовой цели
    const s = sim.current;
    s.prefix = 'матрица-' + Date.now().toString(36);
    s.difficulty = params.difficulty;
    s.lastT = performance.now();

    let raf = 0;
    const HASHES_PER_FRAME = 900; // реальные SHA-256 за кадр

    const tick = () => {
      raf = requestAnimationFrame(tick);
      const s = sim.current;
      if (!s.running) return;

      let bestThisFrame = '';
      let bestZeros = 0;
      let found: Block | null = null;

      for (let i = 0; i < HASHES_PER_FRAME; i++) {
        const msg = s.prefix + ':' + s.nonce;
        const hash = sha256hex(msg);
        const z = leadingZeros(hash);
        s.nonce++;
        s.hashes++;
        if (z > bestZeros) {
          bestZeros = z;
          bestThisFrame = hash;
        }
        if (z >= s.difficulty && !found) {
          s.blockN++;
          found = { n: s.blockN, hash, nonce: s.nonce, zeros: z };
          // сложность медленно растёт — блоки становятся реже (как настоящий PoW)
          if (s.blockN % 3 === 0 && s.difficulty < 8) s.difficulty++;
        }
      }

      // поток «сырых» хэшей (лучшие за кадр — их видно бегущими)
      if (bestThisFrame) {
        setStream((prev) => {
          const next = [bestThisFrame, ...prev];
          return next.slice(0, 14);
        });
      }

      if (found) {
        setBlocks((prev) => [found as Block, ...prev].slice(0, 8));
        setFlash(true);
        setTimeout(() => setFlash(false), 260);
      }

      // статистика раз в ~0.5с
      const now = performance.now();
      if (now - s.lastT > 500) {
        const rate = Math.round(((s.hashes - s.lastCount) * 1000) / (now - s.lastT));
        setStats({
          hashes: s.hashes,
          rate,
          best: Math.max(bestZeros, 0),
          difficulty: s.difficulty,
        });
        s.lastCount = s.hashes;
        s.lastT = now;
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const targetLabel = params.target;

  return (
    <div
      className={`dec-wrap ${flash ? 'flash' : ''}`}
      style={
        {
          '--h1': params.hue,
          '--h2': params.hue2,
        } as React.CSSProperties
      }
    >
      <div className="dec-matrix" aria-hidden>
        {stream.map((h, i) => (
          <div key={h + i} className="dec-line" style={{ opacity: 1 - i * 0.06 }}>
            {h}
          </div>
        ))}
      </div>

      <header className="dec-head">
        <h1>ДЕКОДЕР</h1>
        <div className="dec-sub">
          Макс взламывает: <b>{targetLabel}</b>
          <span className={params.source.startsWith('llm') ? 'dec-src llm' : 'dec-src'}>
            {params.source.startsWith('llm')
              ? 'мозг: ' + params.source.slice(4)
              : params.source === 'local'
                ? 'локально'
                : 'ядро'}
          </span>
        </div>
      </header>

      <div className="dec-stats">
        <div className="dec-stat">
          <span>{stats.rate.toLocaleString('ru-RU')}</span>H/s
        </div>
        <div className="dec-stat">
          <span>{stats.difficulty}</span>сложность
        </div>
        <div className="dec-stat">
          <span>{stats.best}</span>лучший ноль
        </div>
        <div className="dec-stat">
          <span>{stats.hashes.toLocaleString('ru-RU')}</span>всего хэшей
        </div>
      </div>

      <div className="dec-blocks">
        <div className="dec-blocks-title">ВЗЛОМАННЫЕ БЛОКИ</div>
        {blocks.length === 0 && <div className="dec-empty">Перебираю ключи…</div>}
        {blocks.map((b) => (
          <div className="dec-block" key={b.n + b.hash}>
            <div className="dec-block-top">
              <span className="dec-block-n">#{b.n}</span>
              <span className="dec-block-z">{b.zeros}×0</span>
              <span className="dec-block-nonce">nonce {b.nonce.toLocaleString('ru-RU')}</span>
            </div>
            <code className="dec-block-hash">
              <b>{b.hash.slice(0, b.zeros)}</b>
              {b.hash.slice(b.zeros, 40)}…
            </code>
          </div>
        ))}
      </div>

      {params.thought && (
        <div className="dec-thought" key={params.thought}>
          <span>Макс:</span> {params.thought}
        </div>
      )}

      <form
        className="dec-prompt"
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy) think(target);
        }}
      >
        <input
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          placeholder="что декодировать? — матрица, золото, космос…"
          disabled={busy}
        />
        <button type="submit" disabled={busy}>
          {busy ? '…' : 'ВЗЛОМАТЬ'}
        </button>
      </form>

      <div className="dec-note">визуальный proof-of-work · настоящий SHA-256 · без крипты и наград</div>
    </div>
  );
}
