'use client';

import { useEffect, useRef, useState } from 'react';
import './evolution.css';

// ── Эволюционная кузница ─────────────────────────────────────────────────────
// «Скомпилировать 1 триллион синапсов за 2000 лет эволюции».
// Честно: 10^12 дискретных синапсов нельзя хранить/рисовать в браузере.
// Поэтому: фрактал z = z²·c + abs(c) — живая нейро-подложка эволюции;
// 110 агентов с настоящими синапсами между собой; а счётчик синапсов растёт
// АНАЛИТИЧЕСКИ по экспоненте 1 → 1·10^12 за 2000 «лет», затем зацикливается
// (∞ unlimited, поколения без предела).

const TARGET_SYNAPSES = 1e12;   // 1 триллион
const SPAN_YEARS = 2000;
const AGENTS = 110;
const MAX_AGENT_EDGES = 1400;   // лимит ОТРИСОВКИ связей между агентами

function fmtBig(n: number): string {
  if (n >= 1e12) return (n / 1e12).toFixed(2) + ' трлн';
  if (n >= 1e9) return (n / 1e9).toFixed(2) + ' млрд';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + ' млн';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + ' тыс';
  return Math.floor(n).toString();
}

interface Agent { x: number; y: number; vx: number; vy: number; e: number; }

export default function EvolutionForge() {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const fxRef = useRef<HTMLCanvasElement | null>(null);   // фрактальная подложка
  const netRef = useRef<HTMLCanvasElement | null>(null);  // агенты + синапсы

  const [running, setRunning] = useState(true);
  const [speed, setSpeed] = useState(120); // лет/сек
  const [hud, setHud] = useState({ year: 0, synapses: 1, neurons: 1, generation: 1, unlimited: false, fps: 0 });

  const sim = useRef({
    running: true,
    speed: 120,
    year: 0,
    generation: 1,
    unlimited: false,
    agents: [] as Agent[],
    w: 0, h: 0, dpr: 1,
    fractalYear: -1,
  });

  useEffect(() => { sim.current.running = running; }, [running]);
  useEffect(() => { sim.current.speed = speed; }, [speed]);

  // фрактал z = z²·c + abs(c), морфит вместе с «годом»
  const renderFractal = (p: number) => {
    const fx = fxRef.current;
    if (!fx) return;
    const ctx = fx.getContext('2d');
    if (!ctx) return;
    const W = fx.width, H = fx.height;
    const img = ctx.createImageData(W, H);
    const data = img.data;
    const zoom = 1.6 - 0.9 * p;                 // медленный «зум жизни»
    const cx0 = -0.5 + 0.35 * Math.sin(p * Math.PI * 2);
    const cy0 = 0.0 + 0.25 * Math.cos(p * Math.PI);
    const maxIter = 48;
    for (let py = 0; py < H; py++) {
      const cy = (py / H - 0.5) * zoom * 2 + cy0;
      for (let px = 0; px < W; px++) {
        const cxr = (px / W - 0.5) * zoom * 2 + cx0;
        const absC = Math.sqrt(cxr * cxr + cy * cy) * (0.5 + p);
        let zr = 0, zi = 0, it = 0;
        for (; it < maxIter; it++) {
          // z = z²·c + abs(c)
          const z2r = zr * zr - zi * zi;
          const z2i = 2 * zr * zi;
          const nr = z2r * cxr - z2i * cy + absC;
          const ni = z2r * cy + z2i * cxr;
          zr = nr; zi = ni;
          if (zr * zr + zi * zi > 16) break;
        }
        const t = it / maxIter;
        const i4 = (py * W + px) * 4;
        // палитра: глубокий космос → бирюза → пурпур (как на референсе)
        const g = Math.floor(120 * t + 60 * Math.sin(t * 6.28 + p * 4));
        data[i4] = Math.floor(40 + 180 * t * t);
        data[i4 + 1] = Math.floor(60 + 195 * t);
        data[i4 + 2] = Math.floor(90 + 120 * Math.abs(Math.sin(t * 3.14 + 1)));
        data[i4 + 3] = 255;
        // подавим шум
        if (it >= maxIter) { data[i4] = 8; data[i4 + 1] = 8; data[i4 + 2] = 22; }
        void g;
      }
    }
    ctx.putImageData(img, 0, 0);
  };

  const rebuild = () => {
    const wrap = wrapRef.current, fx = fxRef.current, net = netRef.current;
    if (!wrap || !fx || !net) return;
    const s = sim.current;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = wrap.clientWidth, h = wrap.clientHeight;
    s.w = w; s.h = h; s.dpr = dpr;

    // фрактал — низкое разрешение, растягиваем (мягкая «живая» подложка)
    const fw = Math.max(120, Math.floor(w / 5));
    const fh = Math.max(120, Math.floor(h / 5));
    fx.width = fw; fx.height = fh;
    fx.style.width = w + 'px'; fx.style.height = h + 'px';

    net.width = Math.floor(w * dpr); net.height = Math.floor(h * dpr);
    net.style.width = w + 'px'; net.style.height = h + 'px';

    if (s.agents.length === 0) {
      for (let i = 0; i < AGENTS; i++) {
        s.agents.push({
          x: Math.random() * w, y: Math.random() * h,
          vx: (Math.random() - 0.5) * 30, vy: (Math.random() - 0.5) * 30,
          e: Math.random(),
        });
      }
    }
    s.fractalYear = -1; // форсируем перерисовку фрактала
  };

  useEffect(() => {
    rebuild();
    const onResize = () => rebuild();
    window.addEventListener('resize', onResize);

    const net = netRef.current!;
    const ctx = net.getContext('2d')!;
    let raf = 0, last = performance.now();
    let fpsAcc = 0, fpsFrames = 0, fpsTimer = 0;

    const loop = (now: number) => {
      const s = sim.current;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      if (s.running) {
        s.year += s.speed * dt;
        if (s.year >= SPAN_YEARS) {
          s.year = 0;
          s.generation += 1;
          s.unlimited = true; // первый цикл пройден → ∞
        }
      }
      const p = s.year / SPAN_YEARS;
      // экспоненциальный рост: 1 → 1e12
      const synapses = Math.pow(TARGET_SYNAPSES, p);
      const neurons = Math.pow(TARGET_SYNAPSES, p * 0.5); // ~ до 1 млн

      // фрактал перерисовываем не каждый кадр
      const yk = Math.floor(s.year / 25);
      if (yk !== s.fractalYear) { s.fractalYear = yk; renderFractal(p); }

      // ── агенты + их синапсы ──
      const { w, h, dpr } = s;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const ag = s.agents;
      const speedScale = 1 + p * 2;
      for (const a of ag) {
        a.x += a.vx * dt * speedScale; a.y += a.vy * dt * speedScale;
        if (a.x < 0 || a.x > w) a.vx *= -1;
        if (a.y < 0 || a.y > h) a.vy *= -1;
        a.x = Math.max(0, Math.min(w, a.x));
        a.y = Math.max(0, Math.min(h, a.y));
        a.e += (Math.random() - 0.5) * 0.05;
        a.e = Math.max(0.1, Math.min(1, a.e));
      }
      // связи между близкими агентами (живые синапсы)
      const linkDist = 60 + p * 140;
      let drawn = 0;
      ctx.lineWidth = 1;
      for (let i = 0; i < ag.length && drawn < MAX_AGENT_EDGES; i++) {
        for (let j = i + 1; j < ag.length && drawn < MAX_AGENT_EDGES; j++) {
          const dx = ag[i].x - ag[j].x, dy = ag[i].y - ag[j].y;
          const d = Math.hypot(dx, dy);
          if (d < linkDist) {
            const inten = (1 - d / linkDist) * ag[i].e * ag[j].e;
            ctx.strokeStyle = `rgba(150,255,235,${0.05 + inten * 0.5})`;
            ctx.beginPath(); ctx.moveTo(ag[i].x, ag[i].y); ctx.lineTo(ag[j].x, ag[j].y); ctx.stroke();
            drawn++;
          }
        }
      }
      for (const a of ag) {
        ctx.beginPath(); ctx.arc(a.x, a.y, 2 + a.e * 3, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(180,255,240,${0.5 + a.e * 0.5})`;
        ctx.shadowColor = 'rgba(0,255,200,0.8)'; ctx.shadowBlur = 8;
        ctx.fill(); ctx.shadowBlur = 0;
      }

      // fps + hud
      fpsFrames++; fpsTimer += dt;
      if (fpsTimer >= 0.4) {
        fpsAcc = fpsFrames / fpsTimer; fpsFrames = 0; fpsTimer = 0;
        setHud({
          year: Math.floor(s.year), synapses, neurons,
          generation: s.generation, unlimited: s.unlimited, fps: Math.round(fpsAcc),
        });
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', onResize); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const p = Math.min(1, hud.year / SPAN_YEARS);

  return (
    <div className="evo-screen">
      <div className="evo-bar">
        <div className="evo-brand">
          <span className="evo-logo">△∞</span>
          <div>
            <div className="evo-title">ЭВОЛЮЦИОННАЯ КУЗНИЦА</div>
            <code className="evo-formula">z = z² · c + abs(c)</code>
          </div>
        </div>
        <div className="evo-stats">
          <span><b>{fmtBig(hud.synapses)}</b> синапсов</span>
          <span><b>{fmtBig(hud.neurons)}</b> нейронов</span>
          <span><b>{hud.year}</b> / {SPAN_YEARS} лет</span>
          <span><b>{AGENTS}</b> агентов</span>
          <span>поколение <b>{hud.generation}</b></span>
          <span className={hud.unlimited ? 'evo-inf on' : 'evo-inf'}>{hud.unlimited ? '∞ UNLIMITED' : 'LOOP'}</span>
          <span><b>{hud.fps}</b> fps</span>
        </div>
        <div className="evo-actions">
          <button onClick={() => setRunning((r) => !r)}>{running ? 'Пауза' : 'Пуск'}</button>
          <button onClick={() => setSpeed((s) => (s >= 480 ? 30 : s * 2))}>×скорость ({speed})</button>
        </div>
      </div>

      <div className="evo-progress"><div className="evo-progress-fill" style={{ width: `${p * 100}%` }} /></div>

      <div className="evo-canvas-wrap" ref={wrapRef}>
        <canvas ref={fxRef} className="evo-fractal" />
        <canvas ref={netRef} className="evo-net" />
        <div className="evo-target">
          <div className="evo-target-num">{fmtBig(hud.synapses)}</div>
          <div className="evo-target-sub">из 1.00 трлн синапсов · {Math.floor(p * 100)}%</div>
        </div>
      </div>

      <div className="evo-hint">
        Фрактал = живая нейро-подложка по формуле со скрина. Синапсы растут аналитически 1 → 10¹² (буквально хранить триллион рёбер в браузере нельзя). 110 агентов плетут настоящие связи; после 2000 лет цикл уходит в ∞ unlimited.
      </div>
    </div>
  );
}
