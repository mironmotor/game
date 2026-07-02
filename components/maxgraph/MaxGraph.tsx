'use client';

import { useEffect, useRef, useState } from 'react';
import { sendMax17Event, type Max17Graph, type Max17GraphNode, type Max17GraphEdge } from '@/lib/max17-client';
import './maxgraph.css';

// Реальный синапс-граф ядра Max: тянем узлы/рёбра из mark17 (synapse_graph.db)
// и раскладываем force-directed. Это НЕ процедурная симуляция — это то, что
// ядро реально запомнило.

const TYPE_COLOR: Record<string, string> = {
  event: '#00ffc8',
  route: '#4ea8ff',
  self_evaluation: '#ff5d8f',
  adaptation: '#ffb14e',
  memory: '#b98bff',
  recalled_memory: '#b98bff',
};
function colorFor(t: string): string {
  return TYPE_COLOR[t] ?? '#9fe';
}

interface SimNode extends Max17GraphNode { x: number; y: number; vx: number; vy: number; }

export default function MaxGraph() {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ok' | 'empty' | 'error'>('idle');
  const [error, setError] = useState('');
  const [stats, setStats] = useState<Max17Graph['stats']>(undefined);

  const sim = useRef({
    nodes: [] as SimNode[],
    edges: [] as Max17GraphEdge[],
    byId: new Map<string, SimNode>(),
    hover: null as SimNode | null,
    w: 0, h: 0, dpr: 1,
    running: false,
  });

  const resize = () => {
    const wrap = wrapRef.current, cv = canvasRef.current;
    if (!wrap || !cv) return;
    const s = sim.current;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    s.w = wrap.clientWidth; s.h = wrap.clientHeight; s.dpr = dpr;
    cv.width = Math.floor(s.w * dpr); cv.height = Math.floor(s.h * dpr);
    cv.style.width = s.w + 'px'; cv.style.height = s.h + 'px';
  };

  async function connect() {
    setStatus('loading'); setError('');
    try {
      const res = await sendMax17Event({ type: 'synapse_graph', limit: 400 });
      const g = res.graph;
      if (!g || !g.nodes || g.nodes.length === 0) {
        setStats(g?.stats);
        setStatus('empty');
        return;
      }
      const s = sim.current;
      const cx = s.w / 2, cy = s.h / 2;
      s.nodes = g.nodes.map((n, i) => {
        const ang = (i / g.nodes!.length) * Math.PI * 2;
        return { ...n, x: cx + Math.cos(ang) * 120 + (Math.random() - 0.5) * 40, y: cy + Math.sin(ang) * 120 + (Math.random() - 0.5) * 40, vx: 0, vy: 0 };
      });
      s.byId = new Map(s.nodes.map((n) => [n.id, n]));
      s.edges = (g.edges || []).filter((e) => s.byId.has(e.source) && s.byId.has(e.target));
      s.running = true;
      setStats(g.stats);
      setStatus('ok');
    } catch (e: unknown) {
      setError(
        (e instanceof Error ? e.message : 'Ошибка') +
          ' · Синапс-граф читается из Python-ядра Max через /api/max17 — нужен `npm run dev` (не статический деплой).',
      );
      setStatus('error');
    }
  }

  useEffect(() => {
    resize();
    const onResize = () => resize();
    window.addEventListener('resize', onResize);
    const cv = canvasRef.current!;
    const ctx = cv.getContext('2d')!;
    let raf = 0;

    const step = () => {
      const s = sim.current;
      const { w, h, dpr, nodes, edges } = s;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#05060f';
      ctx.fillRect(0, 0, w, h);

      if (s.running && nodes.length) {
        // force-directed: репульсия + пружины + гравитация к центру
        const cx = w / 2, cy = h / 2;
        for (let i = 0; i < nodes.length; i++) {
          const a = nodes[i];
          for (let j = i + 1; j < nodes.length; j++) {
            const b = nodes[j];
            let dx = a.x - b.x, dy = a.y - b.y;
            let d2 = dx * dx + dy * dy;
            if (d2 < 1) { d2 = 1; dx = Math.random(); dy = Math.random(); }
            const rep = 1400 / d2;
            const d = Math.sqrt(d2);
            const fx = (dx / d) * rep, fy = (dy / d) * rep;
            a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
          }
          a.vx += (cx - a.x) * 0.008;
          a.vy += (cy - a.y) * 0.008;
        }
        for (const e of edges) {
          const a = s.byId.get(e.source)!, b = s.byId.get(e.target)!;
          const dx = b.x - a.x, dy = b.y - a.y;
          const d = Math.hypot(dx, dy) || 1;
          const target = 90;
          const k = (d - target) * 0.02 * (0.4 + e.weight);
          const fx = (dx / d) * k, fy = (dy / d) * k;
          a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
        }
        for (const n of nodes) {
          n.vx *= 0.82; n.vy *= 0.82;
          n.x += Math.max(-8, Math.min(8, n.vx));
          n.y += Math.max(-8, Math.min(8, n.vy));
          n.x = Math.max(16, Math.min(w - 16, n.x));
          n.y = Math.max(16, Math.min(h - 16, n.y));
        }
      }

      // рёбра
      for (const e of edges) {
        const a = s.byId.get(e.source)!, b = s.byId.get(e.target)!;
        const hot = s.hover && (a === s.hover || b === s.hover);
        ctx.strokeStyle = hot ? 'rgba(255,255,255,0.55)' : `rgba(120,200,190,${0.08 + e.weight * 0.35})`;
        ctx.lineWidth = hot ? 1.6 : 0.4 + e.weight * 1.6;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
      // узлы
      for (const n of nodes) {
        const r = 3 + Math.min(10, Math.sqrt(n.degree) * 2.2);
        const col = colorFor(n.type);
        ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
        ctx.fillStyle = col;
        ctx.shadowColor = col; ctx.shadowBlur = n === s.hover ? 16 : 6;
        ctx.fill(); ctx.shadowBlur = 0;
      }
      // подпись на hover
      if (s.hover) {
        const n = s.hover;
        const txt = `${n.type} · ${n.label} · deg ${n.degree}`;
        ctx.font = '11px var(--font-hud-mono, monospace)';
        const tw = ctx.measureText(txt).width;
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.fillRect(n.x + 10, n.y - 20, tw + 12, 18);
        ctx.fillStyle = '#eafff8'; ctx.textBaseline = 'middle';
        ctx.fillText(txt, n.x + 16, n.y - 11);
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', onResize); };
  }, []);

  const onMove = (ev: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = ev.currentTarget.getBoundingClientRect();
    const x = ev.clientX - rect.left, y = ev.clientY - rect.top;
    const s = sim.current;
    let best: SimNode | null = null, bd = 18 * 18;
    for (const n of s.nodes) {
      const dx = n.x - x, dy = n.y - y, d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = n; }
    }
    s.hover = best;
  };

  const types = Array.from(new Set(sim.current.nodes.map((n) => n.type)));

  return (
    <div className="mg-screen">
      <div className="mg-bar">
        <span className="mg-logo">△∞</span>
        <div className="mg-titlewrap">
          <div className="mg-title">СИНАПС-ГРАФ ЯДРА MAX</div>
          <div className="mg-sub">реальные синапсы mark17 · force-directed · не симуляция</div>
        </div>
        <div className="mg-stats">
          {stats && <>
            <span><b>{stats.total_synapses ?? 0}</b> синапсов</span>
            <span><b>{stats.nodes ?? 0}</b> узлов</span>
            <span>показано <b>{stats.shown_synapses ?? 0}</b></span>
          </>}
        </div>
        <button className="mg-connect" onClick={connect} disabled={status === 'loading'}>
          {status === 'loading' ? 'ПОДКЛЮЧАЮСЬ…' : status === 'ok' ? '↻ Обновить' : 'Подключить к Max'}
        </button>
      </div>

      <div className="mg-canvas-wrap" ref={wrapRef}>
        <canvas ref={canvasRef} onMouseMove={onMove} onMouseLeave={() => { sim.current.hover = null; }} />

        {status !== 'ok' && (
          <div className="mg-overlay">
            {status === 'idle' && <p>Нажми «Подключить к Max» — вытяну реальный синапс-граф из ядра mark17.</p>}
            {status === 'empty' && <p>Ядро Max пока пустое — синапсы появляются по мере работы системы (автоплан, диалоги, события). Поработай в приложении и обнови.</p>}
            {status === 'error' && <p className="mg-err">{error}</p>}
          </div>
        )}

        {status === 'ok' && types.length > 0 && (
          <div className="mg-legend">
            {types.map((t) => (
              <span key={t} className="mg-legend-item"><i style={{ background: colorFor(t) }} />{t}</span>
            ))}
          </div>
        )}
      </div>

      <div className="mg-hint">
        Узлы — сущности ядра (event / route / self_evaluation / adaptation / memory), рёбра — реальные ассоциации с весом. Тяни… наведи на узел для подписи. Данные читаются из Python-ядра Max (нужен `npm run dev`).
      </div>
    </div>
  );
}
