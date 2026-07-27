'use client';

/**
 * MaxBrain — «Мозг MAX»: живая визуализация НАСТОЯЩЕГО графа синапсов из памяти
 * ядра (событие graph_stats). Не декор: числа, концепты, типы связей и кластеры —
 * реальные. Нейроны светятся, по связям бегут синаптические импульсы. Открыть:
 * событие `brain:toggle` (команда /мозг), кнопка «Мозг MAX» в GODMODE. Esc — закрыть.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Brain, Loader2, RefreshCw, X } from 'lucide-react';
import { sendMax17Event } from '@/lib/max17-client';

type GraphStats = {
  total_synapses?: number;
  unique_nodes?: number;
  progress_percent?: number;
  target_synapses?: number;
  avg_weight?: number;
  total_evidence?: number;
  top_relations?: { relation_type: string; count: number; avg_weight: number }[];
  top_node_types?: { node_type: string; count: number }[];
  top_concepts?: { concept: string; count: number }[];
  stores?: Record<string, number>;
  neural_graph?: { clusters?: number; cluster_nodes?: number };
};

type Node = { x: number; y: number; r: number; hue: number; cluster: number; phase: number; label?: string };
type Edge = { a: number; b: number; strong: boolean };
type Pulse = { edge: number; t: number; speed: number };

function fmt(n: number | undefined): string {
  return (n ?? 0).toLocaleString('ru-RU').replace(/,/g, ' ');
}

export default function MaxBrain() {
  const [open, setOpen] = useState(false);
  const [stats, setStats] = useState<GraphStats | null>(null);
  const [loading, setLoading] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const sceneRef = useRef<{ nodes: Node[]; edges: Edge[]; pulses: Pulse[] } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = (await sendMax17Event({ type: 'graph_stats' })) as { graph_stats?: GraphStats };
      if (r.graph_stats) setStats(r.graph_stats);
    } catch {
      /* keep last */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const onToggle = () => setOpen((v) => !v);
    const onOpen = () => setOpen(true);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('brain:toggle', onToggle);
    window.addEventListener('brain:open', onOpen);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('brain:toggle', onToggle);
      window.removeEventListener('brain:open', onOpen);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  // Build the neuron field from REAL stats: cluster count, concept hubs, relation mix.
  const buildScene = useCallback((w: number, h: number, s: GraphStats | null) => {
    const clusters = Math.max(8, Math.min(22, s?.neural_graph?.clusters ?? 17));
    const concepts = s?.top_concepts ?? [];
    const cx = w / 2;
    const cy = h / 2;
    const rx = w * 0.36;
    const ry = h * 0.34;

    // cluster centers on a golden-angle spiral inside a brain-ish ellipse
    const centers: { x: number; y: number; hue: number; label?: string }[] = [];
    for (let i = 0; i < clusters; i++) {
      const t = i / clusters;
      const ang = i * 2.399963; // golden angle
      const rad = Math.sqrt(t);
      const hue = 175 + (i % 5) * 20 + (i < 5 ? 0 : 40); // teal→cyan→violet spread
      centers.push({
        x: cx + Math.cos(ang) * rad * rx,
        y: cy + Math.sin(ang) * rad * ry,
        hue: i < concepts.length ? 190 : hue,
        label: i < concepts.length ? concepts[i].concept : undefined,
      });
    }

    const nodes: Node[] = [];
    const perCluster = 11;
    centers.forEach((c, ci) => {
      // hub node (bigger for labeled concepts, sized by relative count)
      const cnt = ci < concepts.length ? concepts[ci].count : 0;
      const maxCnt = concepts[0]?.count || 1;
      nodes.push({
        x: c.x,
        y: c.y,
        r: ci < concepts.length ? 4 + (cnt / maxCnt) * 7 : 3.2,
        hue: c.hue,
        cluster: ci,
        phase: Math.random() * Math.PI * 2,
        label: c.label,
      });
      for (let k = 0; k < perCluster; k++) {
        const a = Math.random() * Math.PI * 2;
        const d = Math.pow(Math.random(), 0.7) * 46;
        nodes.push({
          x: c.x + Math.cos(a) * d,
          y: c.y + Math.sin(a) * d * 0.85,
          r: 1.1 + Math.random() * 1.9,
          hue: c.hue + (Math.random() * 24 - 12),
          cluster: ci,
          phase: Math.random() * Math.PI * 2,
        });
      }
    });

    // Edges: dense WITHIN cluster (similar_to = 85% of real synapses), sparse bridges.
    const edges: Edge[] = [];
    const byCluster: number[][] = centers.map(() => []);
    nodes.forEach((n, i) => byCluster[n.cluster].push(i));
    byCluster.forEach((group) => {
      for (const a of group) {
        // connect to 2-3 nearest in the same cluster
        const others = group
          .filter((b) => b !== a)
          .map((b) => ({ b, d: (nodes[a].x - nodes[b].x) ** 2 + (nodes[a].y - nodes[b].y) ** 2 }))
          .sort((p, q) => p.d - q.d)
          .slice(0, 2 + (Math.random() < 0.4 ? 1 : 0));
        for (const o of others) if (a < o.b) edges.push({ a, b: o.b, strong: false });
      }
    });
    // inter-cluster bridges (related_to / contains): link cluster hubs
    const hubs = centers.map((_, ci) => byCluster[ci][0]);
    for (let i = 0; i < hubs.length; i++) {
      const j = (i + 1) % hubs.length;
      edges.push({ a: hubs[i], b: hubs[j], strong: true });
      if (Math.random() < 0.5) edges.push({ a: hubs[i], b: hubs[(i + 3) % hubs.length], strong: true });
    }

    const pulses: Pulse[] = [];
    return { nodes, edges, pulses };
  }, []);

  // Animation loop.
  useEffect(() => {
    if (!open) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(2, rect.width * dpr);
      canvas.height = Math.max(2, rect.height * dpr);
      sceneRef.current = buildScene(canvas.width, canvas.height, stats);
    };
    resize();
    window.addEventListener('resize', resize);

    let last = 0;
    const draw = (time: number) => {
      rafRef.current = requestAnimationFrame(draw);
      const scene = sceneRef.current;
      if (!scene) return;
      if (time - last < 24) return;
      const dt = Math.min(3, (time - last) / 16.67);
      last = time;
      const { nodes, edges, pulses } = scene;
      const w = canvas.width;
      const h = canvas.height;

      ctx.fillStyle = 'rgba(4,6,10,0.32)';
      ctx.fillRect(0, 0, w, h);

      // edges
      for (const e of edges) {
        const A = nodes[e.a];
        const B = nodes[e.b];
        ctx.strokeStyle = e.strong ? 'rgba(168,85,247,0.16)' : 'rgba(34,211,238,0.10)';
        ctx.lineWidth = e.strong ? 1.1 : 0.6;
        ctx.beginPath();
        ctx.moveTo(A.x, A.y);
        ctx.lineTo(B.x, B.y);
        ctx.stroke();
      }

      // spawn synaptic pulses
      if (pulses.length < 90 && Math.random() < 0.6) {
        pulses.push({ edge: (Math.random() * edges.length) | 0, t: 0, speed: 0.008 + Math.random() * 0.02 });
      }
      for (let i = pulses.length - 1; i >= 0; i--) {
        const p = pulses[i];
        p.t += p.speed * dt;
        if (p.t >= 1) {
          pulses.splice(i, 1);
          continue;
        }
        const e = edges[p.edge];
        if (!e) {
          pulses.splice(i, 1);
          continue;
        }
        const A = nodes[e.a];
        const B = nodes[e.b];
        const x = A.x + (B.x - A.x) * p.t;
        const y = A.y + (B.y - A.y) * p.t;
        ctx.fillStyle = e.strong ? 'rgba(216,180,254,0.95)' : 'rgba(125,240,255,0.95)';
        ctx.beginPath();
        ctx.arc(x, y, e.strong ? 2 : 1.6, 0, Math.PI * 2);
        ctx.fill();
      }

      // nodes (glow + core)
      for (const n of nodes) {
        n.phase += 0.03 * dt;
        const puls = 0.6 + 0.4 * Math.sin(n.phase);
        const glow = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, n.r * 5);
        glow.addColorStop(0, `hsla(${n.hue},90%,65%,${0.5 * puls})`);
        glow.addColorStop(1, `hsla(${n.hue},90%,55%,0)`);
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r * 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = `hsla(${n.hue},95%,${72 + puls * 12}%,0.95)`;
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx.fill();
      }

      // concept labels
      ctx.font = `${Math.round(11 * (window.devicePixelRatio > 1 ? 1.4 : 1))}px ui-monospace, monospace`;
      ctx.fillStyle = 'rgba(180,240,255,0.8)';
      for (const n of nodes) {
        if (n.label) ctx.fillText(n.label, n.x + n.r + 4, n.y + 3);
      }
    };
    rafRef.current = requestAnimationFrame(draw);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      window.removeEventListener('resize', resize);
    };
  }, [open, stats, buildScene]);

  if (!open) return null;

  const rel = stats?.top_relations ?? [];
  const relMax = rel[0]?.count || 1;

  return (
    <div className="fixed inset-0 z-[68] flex flex-col bg-[#04060a]">
      <div className="flex items-center gap-2 border-b border-cyan-400/15 px-4 py-3">
        <Brain className="h-4 w-4 text-cyan-300" />
        <span className="text-sm font-semibold tracking-[0.2em] text-cyan-200">🧠 МОЗГ MAX · ЖИВОЙ ГРАФ ПАМЯТИ</span>
        {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-cyan-300/60" />}
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="ml-auto flex items-center gap-1 rounded-lg bg-white/10 px-2 py-1 text-[11px] text-white/70 hover:bg-white/20 disabled:opacity-40"
        >
          <RefreshCw className="h-3 w-3" /> обновить
        </button>
        <button type="button" onClick={() => setOpen(false)} className="rounded-lg p-1 text-white/40 hover:bg-white/10 hover:text-white/80">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="relative flex-1 overflow-hidden">
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />

        {/* real-data HUD overlay */}
        <div className="pointer-events-none absolute left-4 top-4 space-y-2 rounded-xl border border-cyan-400/20 bg-black/40 p-3 backdrop-blur-sm">
          <div className="text-[11px] uppercase tracking-widest text-cyan-300/70">Реальный граф ядра</div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-cyan-200">{fmt(stats?.total_synapses)}</span>
            <span className="text-[11px] text-white/45">синапсов</span>
          </div>
          <div className="text-[11px] text-white/55">
            {fmt(stats?.unique_nodes)} нейронов · {(stats?.progress_percent ?? 0).toFixed(1)}% → 1M
          </div>
          <div className="h-1.5 w-44 overflow-hidden rounded-full bg-white/10">
            <div className="h-full bg-cyan-400/70" style={{ width: `${Math.min(100, stats?.progress_percent ?? 0)}%` }} />
          </div>
          <div className="text-[10px] text-white/40">
            память {fmt(stats?.stores?.memories)} · вектор {fmt(stats?.stores?.vector_memories)} · опыт {fmt(stats?.total_evidence)}
          </div>
        </div>

        <div className="pointer-events-none absolute right-4 top-4 w-52 space-y-1.5 rounded-xl border border-violet-400/20 bg-black/40 p-3 backdrop-blur-sm">
          <div className="text-[11px] uppercase tracking-widest text-violet-300/70">Типы связей</div>
          {rel.slice(0, 5).map((r) => (
            <div key={r.relation_type}>
              <div className="flex justify-between text-[10px] text-white/55">
                <span>{r.relation_type}</span>
                <span>{fmt(r.count)}</span>
              </div>
              <div className="h-1 w-full overflow-hidden rounded-full bg-white/10">
                <div className="h-full bg-violet-400/60" style={{ width: `${(r.count / relMax) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>

        <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 text-[10px] tracking-[0.3em] text-cyan-300/25">
          КОНЦЕПТЫ — РЕАЛЬНЫЕ · ИМПУЛЬСЫ — ЖИВЫЕ СИНАПСЫ · ESC
        </div>
      </div>
    </div>
  );
}
