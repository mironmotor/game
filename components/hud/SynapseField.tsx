'use client';

/**
 * SynapseField — живой фон «вселенная синапсов MAX». Узлы в глубоком космосе
 * (звёзды + туманности + параллакс), связанные рёбрами, по которым ПЛАВНО текут
 * ЦВЕТНЫЕ импульсы и мягко поджигают узлы каскадом — как мысль идёт по мозгу.
 * Спокойно, медленно, без белого строба. HUD-боксы — реальные концепты графа.
 * Громче в комнате → чуть больше активности.
 *
 * Производительность: glow — пре-рендеренные спрайты; импульсы — дешёвые точки.
 * Слой pointer-events-none.
 */

import { useEffect, useRef } from 'react';
import { sendMax17Event } from '@/lib/max17-client';
import { ambientFrame } from '@/lib/ambient-audio';

interface FieldNode {
  wx: number;
  wy: number;
  hue: number; // индекс палитры
  r: number;
  depth: number;
  phase: number;
  flash: number;
}
interface Signal {
  e: number;
  dir: boolean;
  u: number;
  spd: number;
  hi: number; // индекс палитры
}

const HUES = [300, 268, 200, 172, 330, 45, 140, 220];

export function SynapseField({ className = '' }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const labelsRef = useRef<string[]>([]);

  useEffect(() => {
    let alive = true;
    const pull = async () => {
      try {
        const r = (await sendMax17Event({ type: 'graph_stats' })) as {
          graph_stats?: { top_concepts?: Array<{ concept: string }>; top_node_types?: Array<{ node_type: string }> };
        };
        if (!alive) return;
        const gc = r.graph_stats;
        const labels = [
          ...(gc?.top_concepts ?? []).map((c) => c.concept),
          ...(gc?.top_node_types ?? []).map((n) => n.node_type),
        ].filter(Boolean);
        if (labels.length) labelsRef.current = labels;
      } catch {
        /* мост может быть холодным */
      }
    };
    void pull();
    const t = setInterval(pull, 30_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const DPR = Math.min(window.devicePixelRatio || 1, 2);
    let W = 0;
    let H = 0;
    const resize = () => {
      const r = canvas.getBoundingClientRect();
      W = Math.max(2, r.width);
      H = Math.max(2, r.height);
      canvas.width = Math.round(W * DPR);
      canvas.height = Math.round(H * DPR);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const mkGlow = (h: number) => {
      const s = 128;
      const c = document.createElement('canvas');
      c.width = c.height = s;
      const g = c.getContext('2d')!;
      const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      grad.addColorStop(0, `hsla(${h},92%,66%,0.9)`);
      grad.addColorStop(0.32, `hsla(${h},90%,55%,0.34)`);
      grad.addColorStop(1, `hsla(${h},90%,50%,0)`);
      g.fillStyle = grad;
      g.fillRect(0, 0, s, s);
      return c;
    };
    const sprites = HUES.map(mkGlow);
    // Цветная мягкая искра (светлый центр под тон узла — НЕ белый строб).
    const sparkH = HUES.map((h) => {
      const s = 56;
      const c = document.createElement('canvas');
      c.width = c.height = s;
      const g = c.getContext('2d')!;
      const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      grad.addColorStop(0, `hsla(${h},100%,88%,0.9)`);
      grad.addColorStop(0.45, `hsla(${h},95%,62%,0.32)`);
      grad.addColorStop(1, `hsla(${h},90%,55%,0)`);
      g.fillStyle = grad;
      g.fillRect(0, 0, s, s);
      return c;
    });

    let seed = 20260619;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };

    const STARS = 220;
    const stars = Array.from({ length: STARS }, () => ({
      wx: rnd() * 2 - 1,
      wy: rnd() * 2 - 1,
      d: 0.06 + rnd() * 0.22,
      tw: rnd() * Math.PI * 2,
    }));

    const N = 92;
    const nodes: FieldNode[] = [];
    for (let i = 0; i < N; i++) {
      nodes.push({
        wx: rnd() * 2 - 1,
        wy: rnd() * 2 - 1,
        hue: Math.floor(rnd() * HUES.length),
        r: 0.3 + rnd() * 1.05,
        depth: 0.3 + rnd() * 1.0,
        phase: rnd() * Math.PI * 2,
        flash: 0,
      });
    }
    const edges: Array<[number, number]> = [];
    const adj: Array<Array<{ e: number; other: number }>> = nodes.map(() => []);
    for (let i = 0; i < N; i++) {
      const near = nodes
        .map((n, j) => ({ j, d: (n.wx - nodes[i].wx) ** 2 + (n.wy - nodes[i].wy) ** 2 }))
        .filter((o) => o.j !== i)
        .sort((a, b) => a.d - b.d)
        .slice(0, 2);
      for (const o of near)
        if (i < o.j) {
          const e = edges.length;
          edges.push([i, o.j]);
          adj[i].push({ e, other: o.j });
          adj[o.j].push({ e, other: i });
        }
    }

    const nebula = Array.from({ length: 3 }, () => ({
      wx: rnd() * 2 - 1,
      wy: rnd() * 2 - 1,
      hue: HUES[Math.floor(rnd() * HUES.length)],
    }));

    const signals: Signal[] = [];
    const MAX_SIG = 60; // спокойнее
    let spawnAcc = 0;
    let t = 0;
    let audio = 0;
    let raf = 0;
    const SPAN = 0.62;

    const screen = (wx: number, wy: number, depth: number, camX: number, camY: number) => {
      const par = 0.45 + depth * 0.55;
      return { sx: W * (0.5 + (wx - camX * par) * SPAN * 0.5), sy: H * (0.5 + (wy - camY * par) * SPAN * 0.5), par };
    };
    const spawn = (e: number, dir: boolean, hi: number) => {
      if (signals.length < MAX_SIG) signals.push({ e, dir, u: 0, spd: 0.22 + rnd() * 0.3, hi }); // медленно
    };
    const bez = (p0: number, p1: number, p2: number, u: number) => {
      const v = 1 - u;
      return v * v * p0 + 2 * v * u * p1 + u * u * p2;
    };

    const draw = () => {
      raf = requestAnimationFrame(draw);
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      const af = ambientFrame();
      audio += ((af ? af.level : 0) - audio) * 0.08;
      t += 0.0008; // медленный дрейф камеры
      ctx.clearRect(0, 0, W, H);

      const camX = Math.sin(t * 0.5) * 0.5;
      const camY = Math.cos(t * 0.37) * 0.4;

      ctx.globalCompositeOperation = 'lighter';

      for (const nb of nebula) {
        const p = screen(nb.wx, nb.wy, 0.12, camX, camY);
        const size = Math.max(W, H) * 1.1;
        ctx.globalAlpha = 0.05 + audio * 0.02;
        ctx.drawImage(mkGlow(nb.hue), p.sx - size / 2, p.sy - size / 2, size, size);
      }

      for (const s of stars) {
        const p = screen(s.wx, s.wy, s.d, camX, camY);
        const tw = 0.4 + (Math.sin(t * 4 + s.tw) * 0.5 + 0.5) * 0.6;
        ctx.globalAlpha = tw * (0.25 + s.d);
        ctx.fillStyle = '#dfeaff';
        ctx.fillRect(p.sx, p.sy, 1.1, 1.1);
      }

      const pos = nodes.map((n) => screen(n.wx, n.wy, n.depth, camX, camY));

      ctx.globalCompositeOperation = 'source-over';
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 9]);
      ctx.lineDashOffset = -t * 120;
      ctx.strokeStyle = `rgba(140,170,255,${0.04 + audio * 0.05})`;
      const ctrl: Array<[number, number]> = [];
      for (const [a, b] of edges) {
        const pa = pos[a];
        const pb = pos[b];
        const mx = (pa.sx + pb.sx) / 2;
        const my = (pa.sy + pb.sy) / 2 - 24;
        ctrl.push([mx, my]);
        ctx.beginPath();
        ctx.moveTo(pa.sx, pa.sy);
        ctx.quadraticCurveTo(mx, my, pb.sx, pb.sy);
        ctx.stroke();
      }
      ctx.setLineDash([]);

      // Импульсы — редкие, медленные, цветные.
      const want = 4 + audio * 16;
      spawnAcc += want / 60;
      while (spawnAcc >= 1) {
        spawnAcc -= 1;
        const e = Math.floor(rnd() * edges.length);
        spawn(e, rnd() < 0.5, nodes[edges[e][0]].hue);
      }

      ctx.globalCompositeOperation = 'lighter';
      for (let s = signals.length - 1; s >= 0; s--) {
        const sig = signals[s];
        sig.u += sig.spd * 0.016;
        const [a, b] = edges[sig.e];
        const src = sig.dir ? pos[a] : pos[b];
        const dst = sig.dir ? pos[b] : pos[a];
        const cp = ctrl[sig.e];
        const u = Math.min(1, sig.u);
        const img = sparkH[sig.hi];
        for (let k = 0; k < 2; k++) {
          const uu = Math.max(0, u - k * 0.06);
          const xx = bez(src.sx, cp[0], dst.sx, uu);
          const yy = bez(src.sy, cp[1], dst.sy, uu);
          const sz = (8 - k * 3) * (0.9 + audio * 0.4);
          ctx.globalAlpha = (0.55 - k * 0.28);
          ctx.drawImage(img, xx - sz / 2, yy - sz / 2, sz, sz);
        }
        if (sig.u >= 1) {
          const tgt = sig.dir ? b : a;
          nodes[tgt].flash = Math.min(1, nodes[tgt].flash + 0.7);
          if (rnd() < 0.38) {
            const links = adj[tgt];
            if (links.length) {
              const pick = links[Math.floor(rnd() * links.length)];
              spawn(pick.e, edges[pick.e][0] === tgt, nodes[tgt].hue);
            }
          }
          signals.splice(s, 1);
        }
      }

      // Узлы — свечение + мягкая цветная вспышка (плавно гаснет).
      for (let i = 0; i < N; i++) {
        const n = nodes[i];
        const p = pos[i];
        const pulse = 0.82 + Math.sin(t * 6 + n.phase) * 0.13 + audio * 0.35 + n.flash * 0.5;
        const size = (50 + n.r * 80) * p.par * pulse;
        ctx.globalAlpha = (0.3 + n.flash * 0.35) * p.par;
        ctx.drawImage(sprites[n.hue], p.sx - size / 2, p.sy - size / 2, size, size);
        if (n.flash > 0.02) {
          ctx.globalAlpha = n.flash * 0.45;
          ctx.strokeStyle = `hsla(${HUES[n.hue]},90%,75%,1)`;
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.arc(p.sx, p.sy, (1 - n.flash) * size * 0.5 + 5, 0, Math.PI * 2);
          ctx.stroke();
          n.flash *= 0.95; // медленное угасание, без блинка
        }
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';

      const labels = labelsRef.current;
      if (labels.length) {
        ctx.font = '9px ui-monospace, monospace';
        ctx.textBaseline = 'top';
        const count = Math.min(9, labels.length);
        for (let k = 0; k < count; k++) {
          const i = (k * 9 + 3) % N;
          const p = pos[i];
          const hue = HUES[nodes[i].hue];
          const text = labels[k].slice(0, 18);
          const bw = Math.max(58, text.length * 5.6 + 14);
          const bh = 15;
          const bx = p.sx - bw / 2;
          const by = p.sy - bh / 2;
          ctx.strokeStyle = `hsla(${hue},80%,72%,0.36)`;
          ctx.lineWidth = 1;
          ctx.strokeRect(bx, by, bw, bh);
          ctx.fillStyle = `hsla(${hue},85%,66%,0.85)`;
          ctx.fillRect(bx + 4, by + bh / 2 - 2.5, 5, 5);
          ctx.fillStyle = `hsla(${hue},90%,84%,0.68)`;
          ctx.fillText(text, bx + 13, by + 3.5);
        }
      }
    };
    draw();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return <canvas ref={ref} className={className} aria-hidden />;
}
