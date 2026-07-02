'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import './brain.css';

// ── Восстановленный визуализатор "мозга" AGI-агента ──────────────────────────
// Слои нейронов (INPUTS → скрытые → OUTPUTS), светящиеся синапсы, живой прогон
// сигнала слева-направо. Клик по слою меняет функцию активации.
// Пресет "Взорвать" разворачивает сеть до ~750 000 синапсов (EdgeAI-масштаб).

const ACTIVATIONS = ['ReLU', 'Tanh', 'Sigmoid', 'LeakyReLU', 'SiLU'] as const;
type Activation = (typeof ACTIVATIONS)[number];

const INPUT_NAMES = [
  'PLAYER X', 'PLAYER Y', 'TARGET X', 'TARGET Y', 'TARGET 2', 'DISTANCE',
  'VEL X', 'VEL Y', 'ANGLE', 'HP', 'ENEMY X', 'ENEMY Y',
  'RAY 1', 'RAY 2', 'RAY 3', 'RAY 4', 'RAY 5', 'RAY 6',
  'RAY 7', 'RAY 8', 'AMMO', 'SCORE', 'TIME', 'BIAS',
];
const OUTPUT_NAMES = ['UP', 'DOWN', 'LEFT', 'RIGHT', 'SHOOT', 'JUMP', 'DASH', 'RELOAD'];

interface LayerCfg {
  name: string;
  size: number;
  activation: Activation;
}

const DEMO_LAYERS: LayerCfg[] = [
  { name: 'INPUTS', size: INPUT_NAMES.length, activation: 'ReLU' },
  { name: 'HL 2', size: 22, activation: 'ReLU' },
  { name: 'HL 3', size: 37, activation: 'ReLU' },
  { name: 'HL 4', size: 22, activation: 'ReLU' },
  { name: 'HL 5', size: 22, activation: 'ReLU' },
  { name: 'OUTPUTS', size: OUTPUT_NAMES.length, activation: 'Sigmoid' },
];

// ~766 000 синапсов: 24·500 + 500·500·3 + 500·8
const HUGE_LAYERS: LayerCfg[] = [
  { name: 'INPUTS', size: INPUT_NAMES.length, activation: 'ReLU' },
  { name: 'HL 2', size: 500, activation: 'ReLU' },
  { name: 'HL 3', size: 500, activation: 'ReLU' },
  { name: 'HL 4', size: 500, activation: 'ReLU' },
  { name: 'HL 5', size: 500, activation: 'ReLU' },
  { name: 'OUTPUTS', size: OUTPUT_NAMES.length, activation: 'Sigmoid' },
];

const MAX_EDGES_PER_GAP = 1800; // лимит ОТРИСОВКИ ради FPS (математика идёт по всем)

function hash(a: number, b: number): number {
  let h = a * 374761393 + b * 668265263;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967295;
}

function applyActivation(fn: Activation, x: number): number {
  // вход x ∈ [-1,1] → яркость ∈ [0,1]
  switch (fn) {
    case 'ReLU': return Math.max(0, x);
    case 'LeakyReLU': return x > 0 ? x : Math.max(0, 0.15 * x + 0.05);
    case 'Tanh': return (Math.tanh(2 * x) + 1) / 2;
    case 'Sigmoid': return 1 / (1 + Math.exp(-5 * x));
    case 'SiLU': { const s = 1 / (1 + Math.exp(-4 * x)); return Math.min(1, Math.max(0, x * s + 0.3)); }
  }
}

interface NeuronPos { x: number; y: number; }
interface Edge { from: number; to: number; }
interface Pulse { gap: number; from: number; to: number; p: number; speed: number; }

export default function NeuralBrain() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const [layers, setLayers] = useState<LayerCfg[]>(DEMO_LAYERS);
  const [preset, setPreset] = useState<'demo' | 'huge'>('demo');
  const [running, setRunning] = useState(true);
  const [hud, setHud] = useState({ synapses: 0, neurons: 0, fps: 0 });

  // мутабельное состояние симуляции — чтобы не пересоздавать RAF
  const sim = useRef({
    layers: DEMO_LAYERS,
    running: true,
    positions: [] as NeuronPos[][],
    headers: [] as { x: number; y: number; w: number; h: number; layer: number }[],
    edges: [] as Edge[][], // отрисовываемое подмножество на каждый разрыв
    pulses: [] as Pulse[],
    hover: { layer: -1, idx: -1 },
    dpr: 1,
    w: 0,
    h: 0,
  });

  const totalSynapses = useCallback((ls: LayerCfg[]) => {
    let s = 0;
    for (let i = 0; i < ls.length - 1; i++) s += ls[i].size * ls[i + 1].size;
    return s;
  }, []);

  // пересчёт геометрии + выборки рёбер
  const rebuild = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const s = sim.current;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    s.dpr = dpr; s.w = w; s.h = h;

    const ls = s.layers;
    const padX = 90;
    const topPad = 90;
    const botPad = 40;
    const usableH = Math.max(80, h - topPad - botPad);
    const gapX = ls.length > 1 ? (w - padX * 2) / (ls.length - 1) : 0;

    const positions: NeuronPos[][] = [];
    const headers: typeof s.headers = [];
    for (let l = 0; l < ls.length; l++) {
      const x = padX + gapX * l;
      const n = ls[l].size;
      const spacing = n > 1 ? usableH / (n - 1) : 0;
      const colTop = n > 1 ? topPad : topPad + usableH / 2;
      const col: NeuronPos[] = [];
      for (let i = 0; i < n; i++) col.push({ x, y: colTop + spacing * i });
      positions.push(col);
      headers.push({ x: x - 46, y: 26, w: 92, h: 46, layer: l });
    }
    s.positions = positions;
    s.headers = headers;

    // выборка рёбер для отрисовки
    const edges: Edge[][] = [];
    for (let g = 0; g < ls.length - 1; g++) {
      const a = ls[g].size, b = ls[g + 1].size;
      const full = a * b;
      const list: Edge[] = [];
      if (full <= MAX_EDGES_PER_GAP) {
        for (let i = 0; i < a; i++) for (let j = 0; j < b; j++) list.push({ from: i, to: j });
      } else {
        for (let k = 0; k < MAX_EDGES_PER_GAP; k++) {
          const i = Math.floor(hash(g * 7 + 1, k) * a);
          const j = Math.floor(hash(g * 7 + 2, k) * b);
          list.push({ from: i, to: j });
        }
      }
      edges.push(list);
    }
    s.edges = edges;
  }, []);

  // применяем смену конфигурации
  useEffect(() => {
    sim.current.layers = layers;
    rebuild();
    setHud((p) => ({ ...p, synapses: totalSynapses(layers), neurons: layers.reduce((a, l) => a + l.size, 0) }));
  }, [layers, rebuild, totalSynapses]);

  useEffect(() => { sim.current.running = running; }, [running]);

  // главный цикл
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    rebuild();
    let raf = 0;
    let t = 0;
    let last = performance.now();
    let fpsAcc = 0, fpsFrames = 0, fpsTimer = 0;

    const act: number[][] = []; // яркости по слоям

    const computeActivations = () => {
      const s = sim.current;
      const ls = s.layers;
      act.length = 0;
      for (let l = 0; l < ls.length; l++) {
        const n = ls[l].size;
        const arr = new Array(n);
        const fn = ls[l].activation;
        for (let i = 0; i < n; i++) {
          const phase = hash(l, i) * Math.PI * 2;
          const freq = 0.4 + hash(i, l) * 1.6;
          // задержка по слоям → сигнал «течёт» слева направо
          const wave = Math.sin(t * freq * 0.9 + phase - l * 0.7);
          arr[i] = applyActivation(fn, wave);
        }
        act.push(arr);
      }
    };

    const draw = (now: number) => {
      const s = sim.current;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (s.running) t += dt;

      // fps
      fpsFrames++; fpsTimer += dt;
      if (fpsTimer >= 0.5) { fpsAcc = fpsFrames / fpsTimer; fpsFrames = 0; fpsTimer = 0; setHud((p) => ({ ...p, fps: Math.round(fpsAcc) })); }

      const { dpr, w, h, positions, edges } = s;
      const ls = s.layers;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // фон
      ctx.fillStyle = '#060616';
      ctx.fillRect(0, 0, w, h);

      computeActivations();

      // ── синапсы ──
      ctx.lineWidth = 1;
      for (let g = 0; g < edges.length; g++) {
        const list = edges[g];
        const pa = positions[g], pb = positions[g + 1];
        const aa = act[g], ab = act[g + 1];
        for (let e = 0; e < list.length; e++) {
          const { from, to } = list[e];
          const A = pa[from], B = pb[to];
          if (!A || !B) continue;
          const intensity = aa[from] * ab[to];
          const alpha = 0.025 + intensity * 0.55;
          if (alpha < 0.04) continue;
          const c = Math.floor(120 + intensity * 135);
          ctx.strokeStyle = `rgba(${Math.floor(c * 0.7)}, ${c}, ${Math.floor(180 + intensity * 75)}, ${alpha})`;
          ctx.beginPath();
          ctx.moveTo(A.x, A.y);
          const mx = (A.x + B.x) / 2;
          ctx.bezierCurveTo(mx, A.y, mx, B.y, B.x, B.y);
          ctx.stroke();
        }
      }

      // ── импульсы (бегущие точки) ──
      if (s.running && Math.random() < 0.4) {
        const g = Math.floor(Math.random() * edges.length);
        const list = edges[g];
        if (list.length) {
          const e = list[Math.floor(Math.random() * list.length)];
          s.pulses.push({ gap: g, from: e.from, to: e.to, p: 0, speed: 0.8 + Math.random() * 1.2 });
        }
      }
      for (let i = s.pulses.length - 1; i >= 0; i--) {
        const pu = s.pulses[i];
        pu.p += pu.speed * dt;
        if (pu.p >= 1) { s.pulses.splice(i, 1); continue; }
        const A = positions[pu.gap][pu.from], B = positions[pu.gap + 1][pu.to];
        if (!A || !B) { s.pulses.splice(i, 1); continue; }
        const x = A.x + (B.x - A.x) * pu.p;
        const y = A.y + (B.y - A.y) * pu.p;
        ctx.fillStyle = 'rgba(180, 255, 240, 0.9)';
        ctx.beginPath(); ctx.arc(x, y, 1.8, 0, Math.PI * 2); ctx.fill();
      }

      // ── нейроны ──
      const big = ls.some((l) => l.size > 120);
      const r = big ? 1.6 : 4;
      for (let l = 0; l < positions.length; l++) {
        const col = positions[l], a = act[l];
        for (let i = 0; i < col.length; i++) {
          const b = a[i];
          const isHover = s.hover.layer === l && s.hover.idx === i;
          ctx.beginPath();
          ctx.arc(col[i].x, col[i].y, r + b * (big ? 1.2 : 2.5) + (isHover ? 3 : 0), 0, Math.PI * 2);
          const g = Math.floor(80 + b * 175);
          ctx.fillStyle = isHover ? '#ffffff' : `rgba(${Math.floor(g * 0.4)}, ${g + 40 > 255 ? 255 : g + 40}, ${Math.floor(150 + b * 105)}, ${0.4 + b * 0.6})`;
          if (b > 0.6 || isHover) { ctx.shadowColor = 'rgba(0,255,200,0.8)'; ctx.shadowBlur = isHover ? 16 : 8; }
          ctx.fill();
          ctx.shadowBlur = 0;
        }
      }

      // ── подписи входов/выходов ──
      ctx.font = '9px var(--font-hud-mono, monospace)';
      ctx.textBaseline = 'middle';
      if (!big || true) {
        const inCol = positions[0];
        ctx.textAlign = 'right';
        ctx.fillStyle = 'rgba(120, 220, 200, 0.7)';
        for (let i = 0; i < Math.min(inCol.length, INPUT_NAMES.length); i++) {
          if (inCol.length > 60 && i % 2 !== 0) continue;
          ctx.fillText(INPUT_NAMES[i] || '', inCol[i].x - 10, inCol[i].y);
        }
        const outCol = positions[positions.length - 1];
        ctx.textAlign = 'left';
        for (let i = 0; i < Math.min(outCol.length, OUTPUT_NAMES.length); i++) {
          ctx.fillText(OUTPUT_NAMES[i] || '', outCol[i].x + 12, outCol[i].y);
        }
      }

      // ── заголовки слоёв ──
      ctx.textAlign = 'center';
      for (let l = 0; l < ls.length; l++) {
        const hx = positions[l][0]?.x ?? 0;
        ctx.font = 'bold 11px var(--font-hud-display, sans-serif)';
        ctx.fillStyle = 'rgba(0,255,200,0.95)';
        ctx.fillText(ls[l].name, hx, 22);
        ctx.font = '9px var(--font-hud-mono, monospace)';
        ctx.fillStyle = 'rgba(150,200,190,0.7)';
        ctx.fillText(`Neurons: ${ls[l].size}`, hx, 38);
        ctx.fillStyle = 'rgba(255,120,160,0.85)';
        ctx.fillText(`${ls[l].activation} (click)`, hx, 52);
      }

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    const onResize = () => rebuild();
    window.addEventListener('resize', onResize);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', onResize); };
  }, [rebuild]);

  // клики: по заголовку слоя — смена активации
  const onCanvasClick = (ev: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = ev.currentTarget.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const y = ev.clientY - rect.top;
    const s = sim.current;
    for (const hd of s.headers) {
      if (x >= hd.x && x <= hd.x + hd.w && y >= hd.y && y <= hd.y + hd.h) {
        setLayers((prev) => prev.map((l, i) => i === hd.layer
          ? { ...l, activation: ACTIVATIONS[(ACTIVATIONS.indexOf(l.activation) + 1) % ACTIVATIONS.length] }
          : l));
        return;
      }
    }
  };

  const onMove = (ev: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = ev.currentTarget.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const y = ev.clientY - rect.top;
    const s = sim.current;
    let best = { layer: -1, idx: -1, d: 18 * 18 };
    for (let l = 0; l < s.positions.length; l++) {
      const col = s.positions[l];
      for (let i = 0; i < col.length; i++) {
        const dx = col[i].x - x, dy = col[i].y - y;
        const d = dx * dx + dy * dy;
        if (d < best.d) best = { layer: l, idx: i, d };
      }
    }
    s.hover = { layer: best.layer, idx: best.idx };
  };

  return (
    <div className="brain-screen">
      <div className="brain-bar">
        <div className="brain-brand">
          <span className="brain-logo">△∞</span>
          <div>
            <div className="brain-title">EDGE&nbsp;AI · НЕЙРО-МОЗГ</div>
            <div className="brain-sub">главный AGI агента · восстановлено</div>
          </div>
        </div>
        <div className="brain-stats">
          <span><b>{hud.synapses.toLocaleString('ru-RU')}</b> синапсов</span>
          <span><b>{hud.neurons.toLocaleString('ru-RU')}</b> нейронов</span>
          <span><b>{hud.fps}</b> fps</span>
        </div>
        <div className="brain-actions">
          <button className={preset === 'demo' ? 'on' : ''} onClick={() => { setPreset('demo'); setLayers(DEMO_LAYERS); }}>Демо</button>
          <button className={preset === 'huge' ? 'on' : ''} onClick={() => { setPreset('huge'); setLayers(HUGE_LAYERS); }}>Взорвать ~750к</button>
          <button onClick={() => setRunning((r) => !r)}>{running ? 'Пауза' : 'Пуск'}</button>
        </div>
      </div>
      <div className="brain-canvas-wrap" ref={wrapRef}>
        <canvas
          ref={canvasRef}
          onClick={onCanvasClick}
          onMouseMove={onMove}
          onMouseLeave={() => { sim.current.hover = { layer: -1, idx: -1 }; }}
        />
      </div>
      <div className="brain-hint">Клик по шапке слоя — смена активации · наведи на нейрон — подсветка · «Взорвать» — развернуть до ~766 000 синапсов</div>
    </div>
  );
}
