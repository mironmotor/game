'use client';

import { useEffect, useRef, useState } from 'react';
import './evolution.css';

// ── Эволюционная кузница ─────────────────────────────────────────────────────
// «Скомпилировать 1 триллион синапсов за 2000 лет эволюции».
// Честно: 10^12 дискретных синапсов нельзя хранить/рисовать в браузере.
// Поэтому: фрактал z = z²·c + abs(c) — живая нейро-подложка эволюции;
// 110 агентов с настоящими синапсами между собой; а счётчик синапсов растёт
// АНАЛИТИЧЕСКИ по экспоненте 1 → 1·10^12 за 2000 «лет», затем зацикливается.
// Pulse — всплеск мутации, Reset — пересев, мышь по canvas — ручной аттрактор.

const TARGET_SYNAPSES = 1e12;   // 1 триллион
const SPAN_YEARS = 2000;
const AGENTS = 110;
const MAX_AGENT_EDGES = 1400;   // лимит ОТРИСОВКИ связей между агентами
const BASE_MUTATION = 0.12;
const LOG_CAP = 9;

function fmtBig(n: number): string {
  if (n >= 1e12) return (n / 1e12).toFixed(2) + ' трлн';
  if (n >= 1e9) return (n / 1e9).toFixed(2) + ' млрд';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + ' млн';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + ' тыс';
  return Math.floor(n).toString();
}

interface Agent { x: number; y: number; vx: number; vy: number; e: number; }
interface LogEntry { year: number; gen: number; msg: string; }

export default function EvolutionForge() {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const fxRef = useRef<HTMLCanvasElement | null>(null);   // фрактальная подложка
  const netRef = useRef<HTMLCanvasElement | null>(null);  // агенты + синапсы

  const [running, setRunning] = useState(true);
  const [speed, setSpeed] = useState(120); // лет/сек
  const [hud, setHud] = useState({
    year: 0, synapses: 1, neurons: 1, generation: 1, unlimited: false, fps: 0,
    fitness: 0.3, entropy: 0.3, links: 0, mutation: BASE_MUTATION,
  });
  const [log, setLog] = useState<LogEntry[]>([]);

  const sim = useRef({
    running: true,
    speed: 120,
    year: 0,
    generation: 1,
    unlimited: false,
    agents: [] as Agent[],
    w: 0, h: 0, dpr: 1,
    fractalYear: -1,
    mutation: BASE_MUTATION,
    fitness: 0.3,
    entropy: 0.3,
    links: 0,
    attractor: { x: 0, y: 0, active: false },
    log: [] as LogEntry[],
    milestones: new Set<string>(),
    resetSeed: 0,
  });

  useEffect(() => { sim.current.running = running; }, [running]);
  useEffect(() => { sim.current.speed = speed; }, [speed]);

  const pushLog = (msg: string) => {
    const s = sim.current;
    s.log = [{ year: Math.floor(s.year), gen: s.generation, msg }, ...s.log].slice(0, LOG_CAP);
  };

  // фрактал z = z²·c + abs(c), морфит вместе с «годом»
  const renderFractal = (p: number) => {
    const fx = fxRef.current;
    if (!fx) return;
    const ctx = fx.getContext('2d');
    if (!ctx) return;
    const W = fx.width, H = fx.height;
    const img = ctx.createImageData(W, H);
    const data = img.data;
    const zoom = 1.6 - 0.9 * p;
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
          const z2r = zr * zr - zi * zi;
          const z2i = 2 * zr * zi;
          const nr = z2r * cxr - z2i * cy + absC;
          const ni = z2r * cy + z2i * cxr;
          zr = nr; zi = ni;
          if (zr * zr + zi * zi > 16) break;
        }
        const t = it / maxIter;
        const i4 = (py * W + px) * 4;
        data[i4] = Math.floor(40 + 180 * t * t);
        data[i4 + 1] = Math.floor(60 + 195 * t);
        data[i4 + 2] = Math.floor(90 + 120 * Math.abs(Math.sin(t * 3.14 + 1)));
        data[i4 + 3] = 255;
        if (it >= maxIter) { data[i4] = 8; data[i4 + 1] = 8; data[i4 + 2] = 22; }
      }
    }
    ctx.putImageData(img, 0, 0);
  };

  const seedAgents = () => {
    const s = sim.current;
    s.agents = [];
    for (let i = 0; i < AGENTS; i++) {
      s.agents.push({
        x: Math.random() * s.w, y: Math.random() * s.h,
        vx: (Math.random() - 0.5) * 30, vy: (Math.random() - 0.5) * 30,
        e: Math.random(),
      });
    }
  };

  const rebuild = () => {
    const wrap = wrapRef.current, fx = fxRef.current, net = netRef.current;
    if (!wrap || !fx || !net) return;
    const s = sim.current;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = wrap.clientWidth, h = wrap.clientHeight;
    s.w = w; s.h = h; s.dpr = dpr;
    const fw = Math.max(120, Math.floor(w / 5));
    const fh = Math.max(120, Math.floor(h / 5));
    fx.width = fw; fx.height = fh;
    fx.style.width = w + 'px'; fx.style.height = h + 'px';
    net.width = Math.floor(w * dpr); net.height = Math.floor(h * dpr);
    net.style.width = w + 'px'; net.style.height = h + 'px';
    if (s.agents.length === 0) seedAgents();
    s.fractalYear = -1;
  };

  // публичные действия
  const doPulse = () => {
    const s = sim.current;
    s.mutation = Math.min(1, s.mutation + 0.6);
    for (const a of s.agents) {
      a.vx += (Math.random() - 0.5) * 220;
      a.vy += (Math.random() - 0.5) * 220;
      a.e = Math.min(1, a.e + Math.random() * 0.4);
    }
    pushLog('⚡ PULSE — всплеск мутации, сеть пересобирается');
  };

  const doReset = () => {
    const s = sim.current;
    seedAgents();
    s.year = 0; s.generation = 1; s.unlimited = false;
    s.mutation = BASE_MUTATION; s.fitness = 0.3; s.entropy = 0.3;
    s.milestones.clear();
    s.fractalYear = -1;
    pushLog('↻ RESET — кузница засеяна заново');
  };

  useEffect(() => {
    rebuild();
    const onResize = () => rebuild();
    window.addEventListener('resize', onResize);
    pushLog('Кузница запущена · 110 агентов посеяны');

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
          s.unlimited = true;
          s.milestones.clear();
          pushLog(`✦ Поколение ${s.generation} — цикл 2000 лет пройден, loop ∞`);
        }
      }
      const p = s.year / SPAN_YEARS;
      const synapses = Math.pow(TARGET_SYNAPSES, p);
      const neurons = Math.pow(TARGET_SYNAPSES, p * 0.5);

      // milestones
      const checkMs = (key: string, val: number, label: string) => {
        if (synapses >= val && !s.milestones.has(key)) { s.milestones.add(key); pushLog(label); }
      };
      checkMs('m6', 1e6, '◇ Достигнут 1 млн синапсов');
      checkMs('m9', 1e9, '◈ Достигнут 1 млрд синапсов');
      checkMs('m12', 1e12 * 0.999, '★ 1 ТРИЛЛИОН синапсов скомпилирован');

      // mutation relaxes to baseline
      s.mutation += (BASE_MUTATION - s.mutation) * Math.min(1, dt * 0.6);

      // fractal redraw throttled
      const yk = Math.floor(s.year / 25);
      if (yk !== s.fractalYear) { s.fractalYear = yk; renderFractal(p); }

      const { w, h, dpr } = s;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const ag = s.agents;
      const speedScale = 1 + p * 2 + s.mutation * 2;
      const jitter = 6 + s.mutation * 90;
      let energySum = 0, vxSum = 0, vySum = 0, vx2 = 0, vy2 = 0;
      for (const a of ag) {
        // ручной аттрактор
        if (s.attractor.active) {
          const dx = s.attractor.x - a.x, dy = s.attractor.y - a.y;
          const d = Math.hypot(dx, dy) || 1;
          a.vx += (dx / d) * 320 * dt;
          a.vy += (dy / d) * 320 * dt;
        }
        a.vx += (Math.random() - 0.5) * jitter;
        a.vy += (Math.random() - 0.5) * jitter;
        // лёгкое демпфирование, чтобы не разлетались
        a.vx *= 0.99; a.vy *= 0.99;
        a.x += a.vx * dt * speedScale; a.y += a.vy * dt * speedScale;
        if (a.x < 0 || a.x > w) a.vx *= -1;
        if (a.y < 0 || a.y > h) a.vy *= -1;
        a.x = Math.max(0, Math.min(w, a.x));
        a.y = Math.max(0, Math.min(h, a.y));
        a.e += (Math.random() - 0.5) * 0.05;
        a.e = Math.max(0.1, Math.min(1, a.e));
        energySum += a.e; vxSum += a.vx; vySum += a.vy; vx2 += a.vx * a.vx; vy2 += a.vy * a.vy;
      }

      // связи
      const linkDist = 60 + p * 140 + s.mutation * 40;
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
      s.links = drawn;

      // аттрактор-маркер
      if (s.attractor.active) {
        ctx.strokeStyle = 'rgba(255,125,240,0.7)';
        ctx.beginPath(); ctx.arc(s.attractor.x, s.attractor.y, 14 + 6 * Math.sin(now / 120), 0, Math.PI * 2); ctx.stroke();
      }

      // агенты
      for (const a of ag) {
        ctx.beginPath(); ctx.arc(a.x, a.y, 2 + a.e * 3, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(180,255,240,${0.5 + a.e * 0.5})`;
        ctx.shadowColor = 'rgba(0,255,200,0.8)'; ctx.shadowBlur = 8;
        ctx.fill(); ctx.shadowBlur = 0;
      }

      // метрики
      const n = ag.length || 1;
      const avgE = energySum / n;
      const varV = (vx2 + vy2) / n - ((vxSum / n) ** 2 + (vySum / n) ** 2);
      const entropyRaw = Math.min(1, Math.max(0, 0.25 + s.mutation * 0.7 + Math.min(0.3, varV / 60000)));
      const fitnessRaw = Math.min(1, Math.max(0, 0.2 + p * 0.6 + avgE * 0.2 + drawn / (MAX_AGENT_EDGES * 4)));
      s.fitness += (fitnessRaw - s.fitness) * Math.min(1, dt * 1.5);
      s.entropy += (entropyRaw - s.entropy) * Math.min(1, dt * 1.5);

      // fps + hud push
      fpsFrames++; fpsTimer += dt;
      if (fpsTimer >= 0.4) {
        fpsAcc = fpsFrames / fpsTimer; fpsFrames = 0; fpsTimer = 0;
        setHud({
          year: Math.floor(s.year), synapses, neurons,
          generation: s.generation, unlimited: s.unlimited, fps: Math.round(fpsAcc),
          fitness: s.fitness, entropy: s.entropy, links: s.links, mutation: s.mutation,
        });
        setLog(s.log.slice());
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', onResize); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // мышь → аттрактор
  const ptr = (ev: React.PointerEvent<HTMLCanvasElement>, active: boolean) => {
    const rect = ev.currentTarget.getBoundingClientRect();
    const s = sim.current;
    s.attractor.x = ev.clientX - rect.left;
    s.attractor.y = ev.clientY - rect.top;
    if (active !== undefined) s.attractor.active = active;
  };

  const p = Math.min(1, hud.year / SPAN_YEARS);
  const Bar = ({ v, c }: { v: number; c: string }) => (
    <div className="evo-meter"><div className="evo-meter-fill" style={{ width: `${Math.round(v * 100)}%`, background: c }} /></div>
  );

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
          <span><b>{hud.year}</b> / {SPAN_YEARS} лет</span>
          <span><b>{AGENTS}</b> агентов</span>
          <span>поколение <b>{hud.generation}</b></span>
          <span className={hud.unlimited ? 'evo-inf on' : 'evo-inf'}>{hud.unlimited ? '∞ UNLIMITED' : 'LOOP'}</span>
        </div>
        <div className="evo-actions">
          <button onClick={doPulse} className="evo-pulse">⚡ Pulse</button>
          <button onClick={doReset}>↻ Reset</button>
          <button onClick={() => setRunning((r) => !r)}>{running ? 'Пауза' : 'Пуск'}</button>
          <button onClick={() => setSpeed((s) => (s >= 480 ? 30 : s * 2))}>×скор ({speed})</button>
        </div>
      </div>

      <div className="evo-progress"><div className="evo-progress-fill" style={{ width: `${p * 100}%` }} /></div>

      <div className="evo-canvas-wrap" ref={wrapRef}>
        <canvas ref={fxRef} className="evo-fractal" />
        <canvas
          ref={netRef}
          className="evo-net"
          onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); ptr(e, true); }}
          onPointerMove={(e) => sim.current.attractor.active && ptr(e, true)}
          onPointerUp={(e) => ptr(e, false)}
          onPointerLeave={(e) => ptr(e, false)}
        />

        <div className="evo-target">
          <div className="evo-target-num">{fmtBig(hud.synapses)}</div>
          <div className="evo-target-sub">из 1.00 трлн синапсов · {Math.floor(p * 100)}%</div>
        </div>

        {/* Панель телеметрии */}
        <aside className="evo-panel">
          <div className="evo-panel-title">ТЕЛЕМЕТРИЯ</div>
          <div className="evo-metric"><span>fitness</span><b>{hud.fitness.toFixed(3)}</b></div>
          <Bar v={hud.fitness} c="#00ffc8" />
          <div className="evo-metric"><span>entropy</span><b>{hud.entropy.toFixed(3)}</b></div>
          <Bar v={hud.entropy} c="#ffb14e" />
          <div className="evo-metric"><span>mutation pressure</span><b>{hud.mutation.toFixed(3)}</b></div>
          <Bar v={hud.mutation} c="#ff5d8f" />
          <div className="evo-metric"><span>active links</span><b>{hud.links}</b></div>
          <div className="evo-metric"><span>neurons</span><b>{fmtBig(hud.neurons)}</b></div>
          <div className="evo-metric"><span>fps</span><b>{hud.fps}</b></div>

          <div className="evo-panel-title evo-log-title">ЛОГ СОБЫТИЙ</div>
          <div className="evo-log">
            {log.length === 0 && <div className="evo-log-item dim">— тишина —</div>}
            {log.map((e, i) => (
              <div key={i} className="evo-log-item">
                <span className="evo-log-ts">[g{e.gen}·{e.year}л]</span> {e.msg}
              </div>
            ))}
          </div>
        </aside>
      </div>

      <div className="evo-hint">
        Фрактал = живая нейро-подложка. Синапсы растут аналитически 1 → 10¹². ⚡Pulse — всплеск мутации · ↻Reset — пересев · тяни мышью по полю — ручной аттрактор.
      </div>
    </div>
  );
}
