'use client';

/**
 * AttractorViz — «Хаос-аттрактор · 3D». Живое вращающееся облако точек хаотических
 * аттракторов (Thomas по умолчанию, + Lorenz / Aizawa / Halvorsen). Чистый Canvas 2D
 * со своей 3D-проекцией и аддитивным свечением (log-density цвет) — без зависимостей,
 * работает и локально, и на статике/Vercel. Открыть: событие `attractor:toggle`
 * (команда /аттрактор или /хаос). Мышь — орбита, Esc — закрыть.
 */

import { useEffect, useRef, useState } from 'react';
import { Atom, Pause, Play, RotateCcw, X } from 'lucide-react';

type Attractor = {
  id: string;
  name: string;
  formula: string;
  step: (x: number, y: number, z: number, p: number) => [number, number, number];
  param: number;
  paramLabel: string;
  paramMin: number;
  paramMax: number;
  paramStep: number;
  dt: number;
  scale: number;
  spawn: number; // разброс начального облака
};

const ATTRACTORS: Attractor[] = [
  {
    id: 'thomas',
    name: 'Thomas',
    formula: 'ẋ=sin(y)−b·x  ẏ=sin(z)−b·y  ż=sin(x)−b·z',
    step: (x, y, z, b) => [Math.sin(y) - b * x, Math.sin(z) - b * y, Math.sin(x) - b * z],
    param: 0.1992, paramLabel: 'b', paramMin: 0.05, paramMax: 0.35, paramStep: 0.001,
    dt: 0.05, scale: 34, spawn: 4,
  },
  {
    id: 'lorenz',
    name: 'Lorenz',
    formula: 'ẋ=σ(y−x)  ẏ=x(ρ−z)−y  ż=xy−βz',
    step: (x, y, z) => [10 * (y - x), x * (28 - z) - y, x * y - (8 / 3) * z],
    param: 28, paramLabel: 'ρ', paramMin: 14, paramMax: 40, paramStep: 0.2,
    dt: 0.006, scale: 6, spawn: 1,
  },
  {
    id: 'aizawa',
    name: 'Aizawa',
    formula: 'ẋ=(z−b)x−dy  ẏ=dx+(z−b)y  ż=c+az−z³/3−(x²+y²)(1+ez)+fzx³',
    step: (x, y, z) => {
      const a = 0.95, b = 0.7, c = 0.6, d = 3.5, e = 0.25, f = 0.1;
      return [
        (z - b) * x - d * y,
        d * x + (z - b) * y,
        c + a * z - (z * z * z) / 3 - (x * x + y * y) * (1 + e * z) + f * z * x * x * x,
      ];
    },
    param: 0.95, paramLabel: 'a', paramMin: 0.7, paramMax: 1.2, paramStep: 0.01,
    dt: 0.01, scale: 90, spawn: 0.5,
  },
  {
    id: 'halvorsen',
    name: 'Halvorsen',
    formula: 'ẋ=−ax−4y−4z−y²  (цикл по x,y,z)',
    step: (x, y, z, a) => [
      -a * x - 4 * y - 4 * z - y * y,
      -a * y - 4 * z - 4 * x - z * z,
      -a * z - 4 * x - 4 * y - x * x,
    ],
    param: 1.89, paramLabel: 'a', paramMin: 1.3, paramMax: 2.5, paramStep: 0.01,
    dt: 0.005, scale: 14, spawn: 1,
  },
];

const N = 24000; // частиц

export default function AttractorViz() {
  const [open, setOpen] = useState(false);
  const [attrId, setAttrId] = useState('thomas');
  const [param, setParam] = useState(ATTRACTORS[0].param);
  const [speed, setSpeed] = useState(2); // под-шагов/кадр
  const [paused, setPaused] = useState(false);
  const [fps, setFps] = useState(0);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const posRef = useRef<Float32Array | null>(null);
  const yawRef = useRef(0);
  const pitchRef = useRef(0.5);
  const dragRef = useRef<{ on: boolean; x: number; y: number }>({ on: false, x: 0, y: 0 });
  // live refs so the RAF loop reads current controls without re-subscribing
  const stateRef = useRef({ attrId, param, speed, paused });
  stateRef.current = { attrId, param, speed, paused };

  const attr = ATTRACTORS.find((a) => a.id === attrId) ?? ATTRACTORS[0];

  const reseed = (a: Attractor) => {
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() - 0.5) * a.spawn;
      pos[i * 3 + 1] = (Math.random() - 0.5) * a.spawn;
      pos[i * 3 + 2] = (Math.random() - 0.5) * a.spawn + (a.id === 'lorenz' ? 25 : 0);
    }
    posRef.current = pos;
  };

  useEffect(() => {
    const onToggle = () => setOpen((v) => !v);
    const onOpen = () => setOpen(true);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('attractor:toggle', onToggle);
    window.addEventListener('attractor:open', onOpen);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('attractor:toggle', onToggle);
      window.removeEventListener('attractor:open', onOpen);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  // On attractor change: reset params + reseed.
  useEffect(() => {
    setParam(attr.param);
    reseed(attr);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attrId]);

  // Main loop.
  useEffect(() => {
    if (!open) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    if (!posRef.current) reseed(attr);

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const r = canvas.getBoundingClientRect();
      canvas.width = Math.max(2, r.width * dpr);
      canvas.height = Math.max(2, r.height * dpr);
    };
    resize();
    window.addEventListener('resize', resize);

    let frames = 0;
    let fpsT = performance.now();

    const loop = () => {
      rafRef.current = requestAnimationFrame(loop);
      const w = canvas.width;
      const h = canvas.height;
      const st = stateRef.current;
      const a = ATTRACTORS.find((x) => x.id === st.attrId) ?? ATTRACTORS[0];
      const pos = posRef.current!;

      // integrate
      if (!st.paused) {
        const dt = a.dt;
        for (let s = 0; s < st.speed; s++) {
          for (let i = 0; i < N; i++) {
            const ix = i * 3;
            const x = pos[ix], y = pos[ix + 1], z = pos[ix + 2];
            const [dx, dy, dz] = a.step(x, y, z, st.param);
            pos[ix] = x + dx * dt;
            pos[ix + 1] = y + dy * dt;
            pos[ix + 2] = z + dz * dt;
          }
        }
      }

      // auto-rotate + mouse orbit
      if (!st.paused) yawRef.current += 0.0025;
      const yaw = yawRef.current;
      const pitch = pitchRef.current;
      const cy = Math.cos(yaw), sy = Math.sin(yaw);
      const cp = Math.cos(pitch), sp = Math.sin(pitch);
      const cx2 = w / 2, cy2 = h / 2;
      const scale = a.scale * (Math.min(w, h) / 600);
      const zc = a.id === 'lorenz' ? 25 : 0;

      // trails: soft fade instead of clear
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = 'rgba(6,6,18,0.22)';
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'lighter';

      for (let i = 0; i < N; i++) {
        const ix = i * 3;
        let x = pos[ix], y = pos[ix + 1], z = pos[ix + 2] - zc;
        // yaw around Y
        let rx = x * cy - z * sy;
        let rz = x * sy + z * cy;
        // pitch around X
        let ry = y * cp - rz * sp;
        rz = y * sp + rz * cp;
        const persp = 320 / (320 + rz * scale * 0.35);
        const px = cx2 + rx * scale * persp;
        const py = cy2 + ry * scale * persp;
        if (px < 0 || px >= w || py < 0 || py >= h) continue;
        // log-density-ish color by depth: white -> lavender -> pink
        const t = Math.max(0, Math.min(1, (rz + 4) / 8));
        const rr = 200 + t * 55;
        const gg = 120 + (1 - t) * 90;
        const bb = 230 + t * 25;
        ctx.fillStyle = `rgba(${rr | 0},${gg | 0},${bb | 0},0.5)`;
        ctx.fillRect(px, py, persp > 1 ? 1.6 : 1, persp > 1 ? 1.6 : 1);
      }

      frames++;
      const now = performance.now();
      if (now - fpsT > 500) {
        setFps(Math.round((frames * 1000) / (now - fpsT)));
        frames = 0;
        fpsT = now;
      }
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      window.removeEventListener('resize', resize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const onDown = (e: React.PointerEvent) => {
    dragRef.current = { on: true, x: e.clientX, y: e.clientY };
  };
  const onMove = (e: React.PointerEvent) => {
    if (!dragRef.current.on) return;
    yawRef.current += (e.clientX - dragRef.current.x) * 0.005;
    pitchRef.current = Math.max(-1.4, Math.min(1.4, pitchRef.current + (e.clientY - dragRef.current.y) * 0.005));
    dragRef.current.x = e.clientX;
    dragRef.current.y = e.clientY;
  };
  const onUp = () => {
    dragRef.current.on = false;
  };

  return (
    <div className="fixed inset-0 z-[68] flex flex-col bg-[#06060f]">
      <div className="flex items-center gap-2 border-b border-fuchsia-400/15 px-4 py-3">
        <Atom className="h-4 w-4 text-fuchsia-300" />
        <span className="text-sm font-semibold tracking-[0.2em] text-fuchsia-200">△∞ ХАОС-АТТРАКТОР · 3D</span>
        <span className="ml-3 text-[10px] text-white/35">{fps} fps · {N.toLocaleString('ru-RU').replace(/,/g, ' ')} точек</span>
        <button type="button" onClick={() => setOpen(false)} className="ml-auto rounded-lg p-1 text-white/40 hover:bg-white/10 hover:text-white/80">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="relative flex-1 overflow-hidden">
        <canvas
          ref={canvasRef}
          className="absolute inset-0 h-full w-full cursor-grab active:cursor-grabbing"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerLeave={onUp}
        />

        {/* формула активного аттрактора */}
        <div className="pointer-events-none absolute left-4 top-4 rounded-xl border border-fuchsia-400/20 bg-black/45 px-3 py-2 backdrop-blur-sm">
          <div className="text-[11px] uppercase tracking-widest text-fuchsia-300/70">{attr.name}</div>
          <div className="mt-1 font-mono text-[11px] text-white/60">{attr.formula}</div>
          <div className="mt-1 text-[10px] text-white/35">цвет ≈ log-плотность · тяни мышью — вращать</div>
        </div>

        {/* контролы */}
        <div className="absolute bottom-4 left-1/2 flex max-w-[calc(100vw-32px)] -translate-x-1/2 flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-black/55 px-3 py-2 backdrop-blur-md">
          <select
            value={attrId}
            onChange={(e) => setAttrId(e.target.value)}
            className="rounded-md border border-white/10 bg-black/60 px-2 py-1 text-xs text-white outline-none"
          >
            {ATTRACTORS.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
          <label className="flex items-center gap-1.5 text-[11px] text-white/55">
            {attr.paramLabel}
            <input type="range" min={attr.paramMin} max={attr.paramMax} step={attr.paramStep} value={param} onChange={(e) => setParam(Number(e.target.value))} className="w-24" />
            <span className="w-10 text-right text-white/80">{param.toFixed(3)}</span>
          </label>
          <label className="flex items-center gap-1.5 text-[11px] text-white/55">
            скорость
            <input type="range" min={1} max={5} step={1} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} className="w-16" />
          </label>
          <button type="button" onClick={() => setPaused((p) => !p)} className="flex items-center gap-1 rounded-lg bg-white/10 px-2.5 py-1 text-xs text-white/80 hover:bg-white/20">
            {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
            {paused ? 'играть' : 'пауза'}
          </button>
          <button type="button" onClick={() => reseed(attr)} className="flex items-center gap-1 rounded-lg bg-white/10 px-2.5 py-1 text-xs text-white/80 hover:bg-white/20">
            <RotateCcw className="h-3.5 w-3.5" /> сброс
          </button>
        </div>
      </div>
    </div>
  );
}
