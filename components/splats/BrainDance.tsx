'use client';

import { useEffect, useRef, useState } from 'react';
import './braindance.css';

// ── Брейнданс · 4D сплаты ────────────────────────────────────────────────────
// Мини-рендерер в духе Gaussian Splatting: каждый сплат несёт 4 параметра
// (position / scale / color / opacity), рисуется гауссовым спрайтом аддитивно.
// 4-е измерение — ВРЕМЯ: сцена морфит по таймлайну, который можно играть,
// перематывать и крутить камеру свободно (как брейнданс в Cyberpunk).
// Честно: это не тренировка настоящих 4DGS (там CUDA и датасеты) — это живой
// процедурный сплат-движок с теми же принципами, работает везде.

const N = 4500;          // сплатов
const LOOP = 12;         // секунд на полный цикл сцены
const SHAPES = ['МОЗГ', 'ГАЛАКТИКА', 'УЗЕЛ'] as const;

interface SplatBase { a: number; b: number; r: number; hue: number; sc: number; op: number; tw: number; }

function shapePoint(shape: number, s: SplatBase, time: number): [number, number, number] {
  switch (shape % 3) {
    case 0: { // «мозг» — бугристая сфера
      const bump = 1 + 0.18 * Math.sin(5 * s.a + time) * Math.sin(4 * s.b + s.tw) + 0.08 * Math.sin(9 * s.b);
      const R = (1.05 + 0.25 * s.r) * bump;
      return [
        R * Math.sin(s.b) * Math.cos(s.a),
        R * Math.cos(s.b) * 0.82,
        R * Math.sin(s.b) * Math.sin(s.a),
      ];
    }
    case 1: { // галактика — спиральный диск
      const arm = (s.a * 3) % (Math.PI * 2);
      const rad = 0.25 + 1.35 * s.r;
      const ang = arm + rad * 2.6 + time * 0.15;
      return [
        rad * Math.cos(ang),
        (s.b - Math.PI / 2) * 0.22 * (1.4 - rad * 0.6),
        rad * Math.sin(ang),
      ];
    }
    default: { // трилистный узел
      const t = s.a * 2 + s.tw * 0.03;
      const tube = 0.16 * (0.5 + s.r);
      return [
        (Math.sin(t) + 2 * Math.sin(2 * t)) * 0.42 + tube * Math.cos(s.b * 7),
        (Math.cos(t) - 2 * Math.cos(2 * t)) * 0.42 + tube * Math.sin(s.b * 7),
        -Math.sin(3 * t) * 0.5 + tube * Math.cos(s.b * 5),
      ];
    }
  }
}

const smooth = (x: number) => x * x * (3 - 2 * x);

export default function BrainDance() {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [ui, setUi] = useState({ t: 0, fps: 0, shape: SHAPES[0] as string });

  const sim = useRef({
    playing: true, speed: 1, t: 0,
    splats: [] as SplatBase[],
    yaw: 0.6, pitch: 0.25, drag: false, lastX: 0, lastY: 0, auto: true,
    scrub: false,
    w: 0, h: 0, dpr: 1,
    sprites: [] as HTMLCanvasElement[],
  });

  useEffect(() => { sim.current.playing = playing; }, [playing]);
  useEffect(() => { sim.current.speed = speed; }, [speed]);

  useEffect(() => {
    const s = sim.current;
    // сплаты: стабильные базовые параметры (4 параметра сплата: pos/scale/color/opacity)
    s.splats = Array.from({ length: N }, () => ({
      a: Math.random() * Math.PI * 2,
      b: Math.acos(2 * Math.random() - 1),
      r: Math.random(),
      hue: Math.random(),
      sc: 0.5 + Math.random() * 1.6,
      op: 0.25 + Math.random() * 0.75,
      tw: Math.random() * Math.PI * 2,
    }));
    // гауссовы спрайты трёх оттенков (фиолет/розовый/циан) — радиальный градиент
    const mk = (r: number, g: number, b: number) => {
      const c = document.createElement('canvas'); c.width = c.height = 64;
      const x = c.getContext('2d')!;
      const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, `rgba(${r},${g},${b},1)`);
      gr.addColorStop(0.4, `rgba(${r},${g},${b},0.35)`);
      gr.addColorStop(1, `rgba(${r},${g},${b},0)`);
      x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
      return c;
    };
    s.sprites = [mk(190, 120, 255), mk(255, 110, 220), mk(110, 220, 255)];

    const resize = () => {
      const wrap = wrapRef.current, cv = canvasRef.current;
      if (!wrap || !cv) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      s.w = wrap.clientWidth; s.h = wrap.clientHeight; s.dpr = dpr;
      cv.width = Math.floor(s.w * dpr); cv.height = Math.floor(s.h * dpr);
      cv.style.width = s.w + 'px'; cv.style.height = s.h + 'px';
    };
    resize();
    window.addEventListener('resize', resize);

    const cv = canvasRef.current!;
    const ctx = cv.getContext('2d')!;
    let raf = 0, last = performance.now(), fpsN = 0, fpsT = 0;

    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      if (s.playing && !s.scrub) s.t = (s.t + dt * s.speed) % LOOP;
      if (s.auto) s.yaw += dt * 0.12;

      // фаза морфа: три сцены по LOOP/3
      const seg = LOOP / 3;
      const idx = Math.floor(s.t / seg) % 3;
      const next = (idx + 1) % 3;
      const f = smooth(Math.min(1, Math.max(0, (s.t - idx * seg) / seg * 1.25))); // морф в конце сегмента

      const cyaw = Math.cos(s.yaw), syaw = Math.sin(s.yaw);
      const cp = Math.cos(s.pitch), sp = Math.sin(s.pitch);
      const { w, h, dpr } = s;
      const scale = Math.min(w, h) * 0.34;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#07031a';
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'lighter';

      const time = s.t * 0.9;
      for (let i = 0; i < N; i++) {
        const sb = s.splats[i];
        const A = shapePoint(idx, sb, time);
        const B = shapePoint(next, sb, time);
        const x0 = A[0] + (B[0] - A[0]) * f;
        const y0 = A[1] + (B[1] - A[1]) * f;
        const z0 = A[2] + (B[2] - A[2]) * f;
        // вращение камеры
        const x1 = x0 * cyaw - z0 * syaw;
        const z1 = x0 * syaw + z0 * cyaw;
        const y1 = y0 * cp - z1 * sp;
        const z2 = y0 * sp + z1 * cp;
        const persp = 2.4 / (2.4 + z2);
        const px = w / 2 + x1 * scale * persp;
        const py = h / 2 + y1 * scale * persp;
        if (px < -20 || px > w + 20 || py < -20 || py > h + 20) continue;
        const size = sb.sc * 10 * persp;
        ctx.globalAlpha = sb.op * Math.min(1, persp) * 0.85;
        const spr = s.sprites[(sb.hue * 3) | 0];
        ctx.drawImage(spr, px - size / 2, py - size / 2, size, size);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';

      fpsN++; fpsT += dt;
      if (fpsT >= 0.4) {
        setUi({ t: s.t, fps: Math.round(fpsN / fpsT), shape: SHAPES[idx] });
        fpsN = 0; fpsT = 0;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); };
  }, []);

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const s = sim.current; s.drag = true; s.auto = false; s.lastX = e.clientX; s.lastY = e.clientY;
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const s = sim.current; if (!s.drag) return;
    s.yaw += (e.clientX - s.lastX) * 0.008;
    s.pitch = Math.max(-1.2, Math.min(1.2, s.pitch + (e.clientY - s.lastY) * 0.008));
    s.lastX = e.clientX; s.lastY = e.clientY;
  };
  const onUp = () => { sim.current.drag = false; sim.current.auto = true; };

  return (
    <div className="bd-screen">
      <header className="bd-bar">
        <span className="bd-logo">△∞</span>
        <div>
          <div className="bd-title">БРЕЙНДАНС · 4D СПЛАТЫ</div>
          <div className="bd-sub">position · scale · color · opacity — и время как 4-е измерение</div>
        </div>
        <div className="bd-stats">
          <span>сцена: <b>{ui.shape}</b></span>
          <span><b>{N.toLocaleString('ru-RU')}</b> сплатов</span>
          <span><b>{ui.fps}</b> fps</span>
        </div>
      </header>

      <div className="bd-stage" ref={wrapRef}>
        <canvas ref={canvasRef} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp} />
      </div>

      {/* Брейнданс-плеер: время = 4-е измерение */}
      <div className="bd-player">
        <button className="bd-play" onClick={() => setPlaying((p) => !p)}>{playing ? '⏸' : '▶'}</button>
        <input
          className="bd-scrub"
          type="range" min={0} max={LOOP} step={0.01} value={ui.t}
          onChange={(e) => { sim.current.t = Number(e.target.value); }}
          onPointerDown={() => { sim.current.scrub = true; }}
          onPointerUp={() => { sim.current.scrub = false; }}
        />
        <span className="bd-time">{ui.t.toFixed(1)}s / {LOOP}s</span>
        <button className="bd-speed" onClick={() => setSpeed((v) => (v >= 4 ? 0.5 : v * 2))}>×{speed}</button>
      </div>

      <div className="bd-foot">
        Тяни по сцене — свободная камера · скраббер — перемотка времени. Настоящие 4DGS-пайплайны (fudan-zvg, hustvl) требуют CUDA-тренировки; свои сплаты можно снять телефоном (Luma/Polycam/Scaniverse).
      </div>
    </div>
  );
}
