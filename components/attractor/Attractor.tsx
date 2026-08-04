'use client';

import { useEffect, useRef, useState } from 'react';
import './attractor.css';

// ── 3D Хаос-аттрактор ────────────────────────────────────────────────────────
// Облако частиц интегрирует систему ОДУ хаотического аттрактора и рисуется
// аддитивно (плотность/свечение, log-цвет) с вращением. Чисто клиентский Canvas 2D.

const N = 24000; // частиц

interface Attr {
  name: string;
  formula: string;
  params: { key: string; label: string; min: number; max: number; step: number; def: number }[];
  scale: number;
  spawn: number; // радиус облака при пересеве
  step: (x: number, y: number, z: number, p: number[]) => [number, number, number];
  dt: number;
}

const ATTRACTORS: Attr[] = [
  {
    name: 'Thomas',
    formula: 'ẋ=sin(y)−b·x · ẏ=sin(z)−b·y · ż=sin(x)−b·z',
    params: [{ key: 'b', label: 'b', min: 0.05, max: 0.32, step: 0.0004, def: 0.1992 }],
    scale: 40, spawn: 8, dt: 0.05,
    step: (x, y, z, p) => [Math.sin(y) - p[0] * x, Math.sin(z) - p[0] * y, Math.sin(x) - p[0] * z],
  },
  {
    name: 'Lorenz',
    formula: 'ẋ=σ(y−x) · ẏ=x(ρ−z)−y · ż=xy−βz',
    params: [
      { key: 'σ', label: 'σ', min: 5, max: 20, step: 0.1, def: 10 },
      { key: 'ρ', label: 'ρ', min: 14, max: 40, step: 0.1, def: 28 },
      { key: 'β', label: 'β', min: 1, max: 4, step: 0.01, def: 8 / 3 },
    ],
    scale: 8, spawn: 2, dt: 0.006,
    step: (x, y, z, p) => [p[0] * (y - x), x * (p[1] - z) - y, x * y - p[2] * z],
  },
  {
    name: 'Aizawa',
    formula: 'ẋ=(z−b)x−dy · ẏ=dx+(z−b)y · ż=c+az−z³/3−(x²+y²)(1+ez)+fzx³',
    params: [
      { key: 'a', label: 'a', min: 0.7, max: 1.1, step: 0.005, def: 0.95 },
      { key: 'b', label: 'b', min: 0.5, max: 0.8, step: 0.005, def: 0.7 },
    ],
    scale: 150, spawn: 0.6, dt: 0.01,
    step: (x, y, z, p) => {
      const a = p[0], b = p[1], c = 0.6, d = 3.5, e = 0.25, f = 0.1;
      return [
        (z - b) * x - d * y,
        d * x + (z - b) * y,
        c + a * z - (z * z * z) / 3 - (x * x + y * y) * (1 + e * z) + f * z * x * x * x,
      ];
    },
  },
  {
    name: 'Halvorsen',
    formula: 'ẋ=−ax−4y−4z−y² · (цикл. по x,y,z)',
    params: [{ key: 'a', label: 'a', min: 1.0, max: 1.8, step: 0.01, def: 1.4 }],
    scale: 18, spawn: 1, dt: 0.005,
    step: (x, y, z, p) => {
      const a = p[0];
      return [
        -a * x - 4 * y - 4 * z - y * y,
        -a * y - 4 * z - 4 * x - z * z,
        -a * z - 4 * x - 4 * y - x * x,
      ];
    },
  },
];

export default function Attractor() {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [idx, setIdx] = useState(0);
  const [params, setParams] = useState<number[]>(ATTRACTORS[0].params.map((p) => p.def));
  const [running, setRunning] = useState(true);
  const [substeps, setSubsteps] = useState(4);
  const [fps, setFps] = useState(0);

  const sim = useRef({
    idx: 0, params: ATTRACTORS[0].params.map((p) => p.def), running: true, substeps: 4,
    xs: new Float32Array(N), ys: new Float32Array(N), zs: new Float32Array(N),
    yaw: 0.4, pitch: 0.5, drag: false, moved: false, lastX: 0, lastY: 0,
    w: 0, h: 0, dpr: 1,
  });

  useEffect(() => { sim.current.idx = idx; }, [idx]);
  useEffect(() => { sim.current.params = params; }, [params]);
  useEffect(() => { sim.current.running = running; }, [running]);
  useEffect(() => { sim.current.substeps = substeps; }, [substeps]);

  const reseed = (attrIndex: number) => {
    const s = sim.current;
    const a = ATTRACTORS[attrIndex];
    for (let i = 0; i < N; i++) {
      s.xs[i] = (Math.random() - 0.5) * a.spawn;
      s.ys[i] = (Math.random() - 0.5) * a.spawn;
      s.zs[i] = (Math.random() - 0.5) * a.spawn + (a.name === 'Aizawa' ? 0.5 : 0);
    }
    s.moved = true; // очистить накопленный кадр
  };

  // смена аттрактора → дефолтные параметры + пересев
  const selectAttractor = (i: number) => {
    setIdx(i);
    setParams(ATTRACTORS[i].params.map((p) => p.def));
    sim.current.idx = i;
    sim.current.params = ATTRACTORS[i].params.map((p) => p.def);
    reseed(i);
  };

  const resize = () => {
    const wrap = wrapRef.current, cv = canvasRef.current;
    if (!wrap || !cv) return;
    const s = sim.current;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    s.w = wrap.clientWidth; s.h = wrap.clientHeight; s.dpr = dpr;
    cv.width = Math.floor(s.w * dpr); cv.height = Math.floor(s.h * dpr);
    cv.style.width = s.w + 'px'; cv.style.height = s.h + 'px';
  };

  useEffect(() => {
    reseed(0);
    resize();
    const onResize = () => resize();
    window.addEventListener('resize', onResize);

    const cv = canvasRef.current!;
    const ctx = cv.getContext('2d')!;
    let raf = 0, last = performance.now(), fpsN = 0, fpsT = 0;

    const loop = (now: number) => {
      const s = sim.current;
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      const a = ATTRACTORS[s.idx];

      // интегрирование + постоянный подсев (чтобы аттрактор ЗАПОЛНЯЛСЯ, как накопление)
      if (s.running) {
        const steps = s.substeps;
        for (let k = 0; k < steps; k++) {
          for (let i = 0; i < N; i++) {
            const x = s.xs[i], y = s.ys[i], z = s.zs[i];
            const [dx, dy, dz] = a.step(x, y, z, s.params);
            s.xs[i] = x + dx * a.dt; s.ys[i] = y + dy * a.dt; s.zs[i] = z + dz * a.dt;
          }
        }
        // ~0.4% частиц пересеваем — редко, чтобы траектории успевали уйти в большие петли
        const R = (N * 0.004) | 0;
        for (let r = 0; r < R; r++) {
          const i = (Math.random() * N) | 0;
          s.xs[i] = (Math.random() - 0.5) * a.spawn;
          s.ys[i] = (Math.random() - 0.5) * a.spawn;
          s.zs[i] = (Math.random() - 0.5) * a.spawn;
        }
      }

      // вращение
      const cy = Math.cos(s.yaw), sy = Math.sin(s.yaw);
      const cp = Math.cos(s.pitch), sp = Math.sin(s.pitch);
      const { w, h, dpr } = s;
      const cxp = w / 2, cyp = h / 2, sc = a.scale;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // накопление: при статике почти не гасим (аттрактор заполняется), при вращении
      // мышью — сильный фейд, чтобы не смазывалось.
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = s.moved ? 'rgba(8,8,22,0.45)' : 'rgba(8,8,22,0.05)';
      ctx.fillRect(0, 0, w, h);
      s.moved = false;

      // аддитивные точки
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < N; i++) {
        const x = s.xs[i], y = s.ys[i], z = s.zs[i];
        // yaw вокруг Y, затем pitch вокруг X
        const x1 = x * cy - z * sy;
        const z1 = x * sy + z * cy;
        const y1 = y * cp - z1 * sp;
        const z2 = y * sp + z1 * cp;
        const persp = 260 / (260 + z2 * sc * 0.02 + 6);
        const px = cxp + x1 * sc * persp;
        const py = cyp + y1 * sc * persp;
        if (px < 0 || px >= w || py < 0 || py >= h) continue;
        // цвет по глубине: белый→лаванда→розовый
        const t = Math.min(1, Math.max(0, (z2 + 4) / 8));
        const r = 200 + t * 55;
        const g = 150 + (1 - t) * 60;
        const b = 220 + t * 35;
        ctx.fillStyle = `rgba(${r | 0},${g | 0},${b | 0},0.32)`;
        ctx.fillRect(px, py, 1.2, 1.2);
      }
      ctx.globalCompositeOperation = 'source-over';

      fpsN++; fpsT += dt;
      if (fpsT >= 0.4) { setFps(Math.round(fpsN / fpsT)); fpsN = 0; fpsT = 0; }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', onResize); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // орбита мышью
  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const s = sim.current; s.drag = true; s.moved = true; s.lastX = e.clientX; s.lastY = e.clientY;
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const s = sim.current; if (!s.drag) return;
    s.yaw += (e.clientX - s.lastX) * 0.01;
    s.pitch += (e.clientY - s.lastY) * 0.01;
    s.lastX = e.clientX; s.lastY = e.clientY; s.moved = true;
  };
  const onUp = () => { sim.current.drag = false; };

  const a = ATTRACTORS[idx];

  return (
    <div className="at-screen">
      <div className="at-bar">
        <span className="at-logo">△∞</span>
        <div>
          <div className="at-title">БЕЗДНА ХАОСА ∞</div>
          <code className="at-formula">{a.formula}</code>
        </div>
        <div className="at-stats"><span>частиц: <b>{N.toLocaleString('ru-RU')}</b></span><span><b>{fps}</b> fps</span></div>
      </div>

      <div className="at-canvas-wrap" ref={wrapRef}>
        <canvas ref={canvasRef} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp} />

        <aside className="at-panel">
          <div className="at-panel-title">АТТРАКТОР</div>
          <div className="at-tabs">
            {ATTRACTORS.map((x, i) => (
              <button key={x.name} className={i === idx ? 'on' : ''} onClick={() => selectAttractor(i)}>{x.name}</button>
            ))}
          </div>

          {a.params.map((pp, i) => (
            <div className="at-ctl" key={pp.key}>
              <div className="at-ctl-row"><span>{pp.label}</span><b>{params[i]?.toFixed(4)}</b></div>
              <input type="range" min={pp.min} max={pp.max} step={pp.step} value={params[i] ?? pp.def}
                onChange={(e) => { sim.current.moved = true; setParams((prev) => prev.map((v, j) => (j === i ? Number(e.target.value) : v))); }} />
            </div>
          ))}
          <div className="at-ctl">
            <div className="at-ctl-row"><span>скорость</span><b>{substeps}×</b></div>
            <input type="range" min={1} max={6} step={1} value={substeps} onChange={(e) => setSubsteps(Number(e.target.value))} />
          </div>
          <div className="at-actions">
            <button onClick={() => setRunning((r) => !r)}>{running ? 'Пауза' : 'Пуск'}</button>
            <button onClick={() => reseed(sim.current.idx)}>↻ Reset</button>
          </div>
        </aside>

        <div className="at-legend">
          <div className="at-legend-title">COLOR · LOG DENSITY</div>
          <div className="at-legend-bar" />
          <div className="at-legend-row"><span>low</span><span>high</span></div>
        </div>
      </div>

      <div className="at-foot">Тяни мышью — орбита · переключай аттрактор и параметры справа. Чистая симуляция ОДУ на устройстве, без сети.</div>
    </div>
  );
}
