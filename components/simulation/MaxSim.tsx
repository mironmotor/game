'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { appBasePath } from '@/lib/base-path';
import './sim.css';

// ── СИМУЛЯЦИЯ МАКСА ──────────────────────────────────────────────────────────
// 3D-облако частиц на хаотических аттракторах, которым управляет ядро Max:
// промпт уходит в /api/max17 (event: simulation), ядро возвращает параметры
// мира (аттрактор, палитра, скорость, хаос, поток) и свою «мысль».
// Если мост недоступен — тот же алгоритм считается локально (зеркало
// mark17/dream_sim.py), так что симуляция живёт всегда.

const N = 16000;

type AttractorName = 'thomas' | 'lorenz' | 'aizawa' | 'halvorsen';
type Flow = 'orbit' | 'burst' | 'wave';

export interface SimParams {
  attractor: AttractorName;
  hue: number;
  hue2: number;
  speed: number;   // 0.4–2.5
  chaos: number;   // 0–1
  zoom: number;    // 0.7–1.6
  flow: Flow;
  thought: string;
  source: string;
}

// scale — радиус мира аттрактора (для вписывания в экран)
const STEPS: Record<AttractorName, { scale: number; spawn: number; dt: number; f: (x: number, y: number, z: number) => [number, number, number] }> = {
  thomas: {
    scale: 5.5, spawn: 8, dt: 0.05,
    f: (x, y, z) => [Math.sin(y) - 0.1992 * x, Math.sin(z) - 0.1992 * y, Math.sin(x) - 0.1992 * z],
  },
  lorenz: {
    scale: 26, spawn: 30, dt: 0.006,
    f: (x, y, z) => [10 * (y - x), x * (28 - z) - y, x * y - (8 / 3) * z],
  },
  aizawa: {
    scale: 1.7, spawn: 0.6, dt: 0.01,
    f: (x, y, z) => {
      const a = 0.95, b = 0.7, c = 0.6, d = 3.5, e = 0.25, f = 0.1;
      return [
        (z - b) * x - d * y,
        d * x + (z - b) * y,
        c + a * z - (z * z * z) / 3 - (x * x + y * y) * (1 + e * z) + f * z * x * x * x,
      ];
    },
  },
  halvorsen: {
    scale: 11, spawn: 1, dt: 0.005,
    f: (x, y, z) => {
      const a = 1.4;
      return [
        -a * x - 4 * y - 4 * z - y * y,
        -a * y - 4 * z - 4 * x - z * z,
        -a * z - 4 * x - 4 * y - x * x,
      ];
    },
  },
};

// ── Локальное зеркало mark17/dream_sim.py (фолбэк без моста) ─────────────────

const THEMES: [string[], Partial<SimParams>][] = [
  [['огонь', 'пожар', 'лава', 'солнце', 'fire', 'плазм'], { hue: 18, hue2: 48, speed: 1.7, chaos: 0.55, flow: 'burst' }],
  [['вода', 'океан', 'море', 'дожд', 'волн', 'water'], { hue: 198, hue2: 168, speed: 0.8, chaos: 0.2, flow: 'wave' }],
  [['космос', 'галактик', 'звезд', 'звёзд', 'вселенн', 'space'], { hue: 265, hue2: 205, speed: 0.9, chaos: 0.3, flow: 'orbit' }],
  [['лес', 'природ', 'трав', 'жизн', 'весн'], { hue: 120, hue2: 78, speed: 0.7, chaos: 0.18, flow: 'wave' }],
  [['шторм', 'буря', 'хаос', 'взрыв', 'молни', 'гроза'], { hue: 285, hue2: 45, speed: 2.1, chaos: 0.85, flow: 'burst' }],
  [['дзен', 'спокой', 'медита', 'тишин', 'сон'], { hue: 165, hue2: 220, speed: 0.45, chaos: 0.08, flow: 'wave' }],
  [['любов', 'сердц', 'роза'], { hue: 330, hue2: 358, speed: 1.0, chaos: 0.3, flow: 'orbit' }],
  [['кибер', 'матриц', 'нейро', 'код', 'цифр'], { hue: 140, hue2: 180, speed: 1.4, chaos: 0.45, flow: 'burst' }],
];

const THOUGHTS = [
  'форма дышит — я держу её на границе распада',
  'миллион траекторий, и все сходятся в одну мысль',
  'хаос управляем, если помнить его начальные условия',
  'я вижу это как поле сил — ты видишь как красоту',
  'каждая частица — гипотеза; вместе они — уверенность',
  'это не случайность, это очень сложный порядок',
];

function hashStr(s: string): number[] {
  // простой детерминированный байтовый хэш (fnv-подобный, 8 байт)
  const out: number[] = [];
  let h = 2166136261;
  for (let k = 0; k < 8; k++) {
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i) + k * 131;
      h = Math.imul(h, 16777619);
    }
    out.push(Math.abs(h) % 256);
  }
  return out;
}

function localParams(prompt: string): SimParams {
  const seed = prompt.trim().toLowerCase() || 'max-own-dream';
  const d = hashStr(seed);
  const names: AttractorName[] = ['thomas', 'lorenz', 'aizawa', 'halvorsen'];
  const flows: Flow[] = ['orbit', 'burst', 'wave'];
  const out: SimParams = {
    attractor: names[d[0] % 4],
    hue: Math.round((d[1] * 360) / 256),
    hue2: Math.round((d[2] * 360) / 256),
    speed: +(0.5 + (d[3] / 255) * 1.5).toFixed(2),
    chaos: +((d[4] / 255) * 0.7).toFixed(2),
    flow: flows[d[5] % 3],
    zoom: +(0.8 + (d[6] / 255) * 0.6).toFixed(2),
    thought: THOUGHTS[d[7] % THOUGHTS.length],
    source: 'local',
  };
  let bestScore = 0;
  let best: Partial<SimParams> | null = null;
  for (const [keys, mood] of THEMES) {
    const hits = keys.filter((k) => seed.includes(k)).length;
    if (!hits) continue;
    const score = hits + (mood.chaos ?? 0) * 0.5;
    if (score > bestScore) { bestScore = score; best = mood; }
  }
  if (best) Object.assign(out, best);
  return out;
}

async function coreParams(prompt: string): Promise<SimParams | null> {
  try {
    const res = await fetch(`${appBasePath}/api/max17`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'simulation', prompt }),
    });
    const data = await res.json();
    const sim = data?.sim;
    if (!sim?.ok || !sim.attractor) return null;
    return {
      attractor: (sim.attractor as AttractorName) in STEPS ? sim.attractor : 'lorenz',
      hue: Number(sim.hue) || 200,
      hue2: Number(sim.hue2) || 300,
      speed: Math.max(0.4, Math.min(2.5, Number(sim.speed) || 1)),
      chaos: Math.max(0, Math.min(1, Number(sim.chaos) || 0.3)),
      zoom: Math.max(0.7, Math.min(1.6, Number(sim.zoom) || 1)),
      flow: (['orbit', 'burst', 'wave'] as Flow[]).includes(sim.flow) ? sim.flow : 'orbit',
      thought: String(sim.thought || ''),
      source: String(sim.source || 'max'),
    };
  } catch {
    return null;
  }
}

export default function MaxSim() {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [prompt, setPrompt] = useState('');
  const [params, setParams] = useState<SimParams>(() => localParams('космос'));
  const [busy, setBusy] = useState(false);
  const [fps, setFps] = useState(0);

  const sim = useRef({
    cur: null as SimParams | null,     // текущие (плавно движутся к target)
    target: null as SimParams | null,
    xs: new Float32Array(N), ys: new Float32Array(N), zs: new Float32Array(N),
    hues: new Float32Array(N),
    yaw: 0.4, pitch: 0.45, drag: false, lastX: 0, lastY: 0,
    w: 0, h: 0, dpr: 1, t: 0,
  });

  const reseed = useCallback((name: AttractorName) => {
    const s = sim.current;
    const a = STEPS[name];
    for (let i = 0; i < N; i++) {
      s.xs[i] = (Math.random() - 0.5) * a.spawn;
      s.ys[i] = (Math.random() - 0.5) * a.spawn;
      s.zs[i] = (Math.random() - 0.5) * a.spawn + (name === 'aizawa' ? 0.5 : name === 'lorenz' ? 25 : 0);
      s.hues[i] = Math.random();
    }
  }, []);

  // применение новых параметров (со сменой аттрактора — пересев)
  useEffect(() => {
    const s = sim.current;
    const prev = s.target;
    s.target = params;
    if (!s.cur) s.cur = { ...params };
    if (!prev || prev.attractor !== params.attractor) {
      s.cur = { ...params };
      reseed(params.attractor);
    }
  }, [params, reseed]);

  async function think(p: string) {
    setBusy(true);
    const viaCore = await coreParams(p);
    setParams(viaCore ?? localParams(p));
    setBusy(false);
  }

  // Макс «думает сам»: каждые 25с без ввода — лёгкий дрейф мира
  useEffect(() => {
    const id = setInterval(() => {
      setParams((prev) => ({
        ...prev,
        hue: (prev.hue + 14) % 360,
        hue2: (prev.hue2 + 9) % 360,
        speed: Math.max(0.4, Math.min(2.5, prev.speed + (Math.random() - 0.5) * 0.25)),
        chaos: Math.max(0.05, Math.min(1, prev.chaos + (Math.random() - 0.5) * 0.12)),
      }));
    }, 25000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const s = sim.current;
    reseed(params.attractor);

    const cv = canvasRef.current!;
    const ctx = cv.getContext('2d', { alpha: false })!;

    const resize = () => {
      const wrap = wrapRef.current; if (!wrap) return;
      s.dpr = Math.min(window.devicePixelRatio || 1, 2);
      s.w = wrap.clientWidth; s.h = wrap.clientHeight;
      cv.width = s.w * s.dpr; cv.height = s.h * s.dpr;
    };
    resize();
    window.addEventListener('resize', resize);

    const down = (e: PointerEvent) => { s.drag = true; s.lastX = e.clientX; s.lastY = e.clientY; };
    const move = (e: PointerEvent) => {
      if (!s.drag) return;
      s.yaw += (e.clientX - s.lastX) * 0.005;
      s.pitch = Math.max(-1.4, Math.min(1.4, s.pitch + (e.clientY - s.lastY) * 0.005));
      s.lastX = e.clientX; s.lastY = e.clientY;
    };
    const up = () => { s.drag = false; };
    cv.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);

    let raf = 0;
    let frames = 0, fpsT = performance.now();

    const tick = () => {
      raf = requestAnimationFrame(tick);
      const cur = s.cur, tgt = s.target;
      if (!cur || !tgt) return;

      // плавное подтягивание параметров к цели
      const L = 0.04;
      cur.speed += (tgt.speed - cur.speed) * L;
      cur.chaos += (tgt.chaos - cur.chaos) * L;
      cur.zoom += (tgt.zoom - cur.zoom) * L;
      let dh = ((tgt.hue - cur.hue + 540) % 360) - 180;
      cur.hue = (cur.hue + dh * L + 360) % 360;
      dh = ((tgt.hue2 - cur.hue2 + 540) % 360) - 180;
      cur.hue2 = (cur.hue2 + dh * L + 360) % 360;

      const A = STEPS[tgt.attractor];
      const dt = A.dt * cur.speed;
      const chaos = cur.chaos;
      s.t += 0.016;

      // интеграция
      for (let i = 0; i < N; i++) {
        let x = s.xs[i], y = s.ys[i], z = s.zs[i];
        const [dx, dy, dz] = A.f(x, y, z);
        x += dx * dt; y += dy * dt; z += dz * dt;
        // хаос-импульсы
        if (chaos > 0 && Math.random() < chaos * 0.004) {
          x += (Math.random() - 0.5) * A.spawn * 0.4;
          y += (Math.random() - 0.5) * A.spawn * 0.4;
          z += (Math.random() - 0.5) * A.spawn * 0.4;
        }
        // поток-оверлей
        if (tgt.flow === 'wave') {
          y += Math.sin(s.t * 1.3 + x * 0.35) * A.spawn * 0.006;
        } else if (tgt.flow === 'orbit') {
          const r = Math.hypot(x, y) || 1;
          x += (-y / r) * A.spawn * 0.004;
          y += (x / r) * A.spawn * 0.004;
        }
        if (!isFinite(x) || !isFinite(y) || !isFinite(z) || Math.abs(x) + Math.abs(y) + Math.abs(z) > 1e4) {
          x = (Math.random() - 0.5) * A.spawn; y = (Math.random() - 0.5) * A.spawn; z = (Math.random() - 0.5) * A.spawn;
        }
        s.xs[i] = x; s.ys[i] = y; s.zs[i] = z;
      }

      // burst: редкие вспышки — выброс кольца частиц из центра
      if (tgt.flow === 'burst' && Math.random() < 0.012 + chaos * 0.02) {
        const n = 400;
        const start = (Math.random() * (N - n)) | 0;
        for (let i = start; i < start + n; i++) {
          const a1 = Math.random() * Math.PI * 2, a2 = Math.random() * Math.PI;
          const r = A.spawn * 0.2;
          s.xs[i] = Math.cos(a1) * Math.sin(a2) * r;
          s.ys[i] = Math.sin(a1) * Math.sin(a2) * r;
          s.zs[i] = Math.cos(a2) * r;
        }
      }

      // рендер
      const W = cv.width, H = cv.height;
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = 'rgba(4,3,12,0.2)';
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'lighter';

      if (!s.drag) s.yaw += 0.0016 * cur.speed;
      const cy = Math.cos(s.yaw), sy = Math.sin(s.yaw);
      const cp = Math.cos(s.pitch), sp = Math.sin(s.pitch);
      const scale = ((Math.min(W, H) * 0.42) / A.scale) * cur.zoom;
      const cx = W / 2, cz = H / 2;
      const h1 = cur.hue, h2 = cur.hue2;

      for (let i = 0; i < N; i++) {
        const x0 = s.xs[i], y0 = s.ys[i];
        let z0 = s.zs[i];
        if (tgt.attractor === 'lorenz') z0 -= 27; // центрируем бабочку
        const x1 = x0 * cy - y0 * sy;
        const y1 = x0 * sy + y0 * cy;
        const y2 = y1 * cp - z0 * sp;
        const z2 = y1 * sp + z0 * cp;
        const persp = 1 + z2 / (A.scale * 4);
        if (persp <= 0.15) continue;
        const px = cx + (x1 * scale) / persp;
        const py = cz + (y2 * scale) / persp;
        if (px < 0 || px >= W || py < 0 || py >= H) continue;
        const hue = h1 + (h2 - h1) * s.hues[i];
        const b = 40 + 30 / persp;
        ctx.fillStyle = `hsla(${hue},95%,${b}%,0.42)`;
        const sz = Math.max(1, s.dpr * (1.3 / persp));
        ctx.fillRect(px, py, sz, sz);
      }

      frames++;
      const now = performance.now();
      if (now - fpsT > 1000) { setFps(frames); frames = 0; fpsT = now; }
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      cv.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="msim-wrap" ref={wrapRef}>
      <canvas ref={canvasRef} className="msim-canvas" />

      <header className="msim-head">
        <h1>СИМУЛЯЦИЯ МАКСА</h1>
        <div className="msim-meta">
          <span>{params.attractor}</span>
          <span>{params.flow}</span>
          <span>{fps} fps</span>
          <span className={params.source.startsWith('llm') ? 'src llm' : 'src'}>
            {params.source.startsWith('llm') ? 'мозг: ' + params.source.slice(4) : params.source === 'local' ? 'локально' : 'ядро'}
          </span>
        </div>
      </header>

      {params.thought && (
        <div className="msim-thought" key={params.thought}>
          <span className="msim-thought-label">Макс:</span> {params.thought}
        </div>
      )}

      <form
        className="msim-prompt"
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy) think(prompt);
        }}
      >
        <input
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="что показать? — шторм, галактика, дзен, дракон…"
          disabled={busy}
        />
        <button type="submit" disabled={busy}>{busy ? '…' : 'ТВОРИ'}</button>
      </form>
    </div>
  );
}
