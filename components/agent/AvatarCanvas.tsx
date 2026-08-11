'use client';

import { useEffect, useRef } from 'react';
import { type AvatarConfig, palette, temperFactors } from '@/lib/agent-avatar';

/**
 * Рисование персонажа. Canvas 2D с собственной проекцией — без three.js.
 *
 * Почему без библиотеки: весь проект уже рисует так (Attractor, MaxSim,
 * NeuroDance), и точек здесь порядок тысячи — перспективная проекция вручную
 * дешевле, чем тащить в бандл целый рендерер ради одного аватара.
 *
 * Форма живёт в 3D и вращается; глаза рисуются поверх, в экранных координатах,
 * и следят за курсором. Это намеренно: глаз, который вращается вместе с телом,
 * перестаёт читаться как взгляд.
 */

interface Props {
  config: AvatarConfig;
  size?: number;
  /** Говорит — ядро раскрывается и пульсирует чаще. */
  speaking?: boolean;
  /** Слушает — зрачок сужается, аура тянется внутрь. */
  listening?: boolean;
  /**
   * `glasses` — облик для просвечивающего экрана очков.
   *
   * Там чёрный цвет означает «прозрачно», а не «чёрное»: всё тусклое просто
   * исчезает на фоне реального мира. Поэтому тысяча мелких точек и мягкая
   * аура превращаются в грязь, и вместо них рисуется силуэт — жирный контур,
   * десятки крупных точек и один цвет без подмешивания второго (на birdbath-
   * оптике края спектра расходятся, и двухцветные детали двоятся).
   */
  variant?: 'full' | 'glasses';
  className?: string;
}

interface P3 {
  x: number;
  y: number;
  z: number;
}

const TAU = Math.PI * 2;

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Вершины икосаэдра — основа «кристалла». */
function icosahedron(): { points: P3[]; edges: [number, number][] } {
  const t = (1 + Math.sqrt(5)) / 2;
  const raw: [number, number, number][] = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ];
  const norm = Math.hypot(1, t);
  const points = raw.map(([x, y, z]) => ({ x: x / norm, y: y / norm, z: z / norm }));
  // Ребро икосаэдра — ровно 2/norm. Ищем пары на этом расстоянии, вместо того
  // чтобы выписывать 30 рёбер руками и ошибиться в одном из них.
  const edge = 2 / norm;
  const edges: [number, number][] = [];
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const d = Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y, points[i].z - points[j].z);
      if (Math.abs(d - edge) < 1e-6) edges.push([i, j]);
    }
  }
  return { points, edges };
}

/** Облако точек формы. Считается один раз на конфиг, не каждый кадр. */
function buildShape(config: AvatarConfig): { points: P3[]; edges: [number, number][] } {
  const rand = mulberry32(config.hue * 977 + config.shape.length * 31 + 7);
  const count = Math.round(240 + config.density * 900);

  switch (config.shape) {
    case 'crystal': {
      const ico = icosahedron();
      const points = [...ico.points];
      // Точки вдоль рёбер: без них кристалл в движении выглядит как 12 искр.
      for (const [a, b] of ico.edges) {
        const steps = 6;
        for (let s = 1; s < steps; s++) {
          const k = s / steps;
          points.push({
            x: ico.points[a].x + (ico.points[b].x - ico.points[a].x) * k,
            y: ico.points[a].y + (ico.points[b].y - ico.points[a].y) * k,
            z: ico.points[a].z + (ico.points[b].z - ico.points[a].z) * k,
          });
        }
      }
      return { points, edges: ico.edges };
    }

    case 'ring': {
      const points: P3[] = [];
      const R = 1;
      const r = 0.3;
      for (let i = 0; i < count; i++) {
        const u = (i / count) * TAU;
        const v = rand() * TAU;
        points.push({
          x: (R + r * Math.cos(v)) * Math.cos(u),
          y: r * Math.sin(v),
          z: (R + r * Math.cos(v)) * Math.sin(u),
        });
      }
      return { points, edges: [] };
    }

    case 'swarm': {
      const points: P3[] = [];
      for (let i = 0; i < count; i++) {
        // Равномерно по объёму шара: кубический корень, иначе всё слипается
        // в центре и рой выглядит как клякса.
        const r = Math.cbrt(rand()) * 1.1;
        const theta = rand() * TAU;
        const phi = Math.acos(2 * rand() - 1);
        points.push({
          x: r * Math.sin(phi) * Math.cos(theta),
          y: r * Math.sin(phi) * Math.sin(theta),
          z: r * Math.cos(phi),
        });
      }
      return { points, edges: [] };
    }

    case 'column': {
      const points: P3[] = [];
      const turns = 5;
      for (let i = 0; i < count; i++) {
        const k = i / count;
        const a = k * TAU * turns;
        const radius = 0.55 * (0.4 + 0.6 * Math.sin(k * Math.PI));
        points.push({ x: radius * Math.cos(a), y: k * 2.4 - 1.2, z: radius * Math.sin(a) });
      }
      return { points, edges: [] };
    }

    default: {
      // Сфера Фибоначчи — точки ложатся ровно, без сгущения у полюсов.
      const points: P3[] = [];
      const golden = Math.PI * (3 - Math.sqrt(5));
      for (let i = 0; i < count; i++) {
        const y = 1 - (i / (count - 1)) * 2;
        const radius = Math.sqrt(Math.max(0, 1 - y * y));
        const theta = golden * i;
        points.push({ x: Math.cos(theta) * radius, y, z: Math.sin(theta) * radius });
      }
      return { points, edges: [] };
    }
  }
}

export default function AvatarCanvas({
  config,
  size = 320,
  speaking = false,
  listening = false,
  variant = 'full',
  className,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Через ref, а не через зависимость эффекта: перезапускать анимацию на каждом
  // движении мыши или на каждом слове — значит рвать её на части.
  const stateRef = useRef({ config, speaking, listening, variant, pointer: { x: 0, y: 0 } });
  stateRef.current.config = config;
  stateRef.current.speaking = speaking;
  stateRef.current.listening = listening;
  stateRef.current.variant = variant;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);

    let shapeKey = '';
    let shape = buildShape(stateRef.current.config);
    let raf = 0;
    let blinkUntil = 0;
    let nextBlink = performance.now() + 2000 + Math.random() * 3000;
    const t0 = performance.now();

    const onPointer = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      stateRef.current.pointer = {
        x: ((e.clientX - rect.left) / rect.width) * 2 - 1,
        y: ((e.clientY - rect.top) / rect.height) * 2 - 1,
      };
    };
    window.addEventListener('pointermove', onPointer);

    const draw = (now: number) => {
      const { config: cfg, speaking: isSpeaking, listening: isListening, pointer, variant: look } = stateRef.current;
      const glasses = look === 'glasses';
      const key = `${cfg.shape}|${cfg.density}|${cfg.hue}`;
      if (key !== shapeKey) {
        shape = buildShape(cfg);
        shapeKey = key;
      }

      const pal = palette(cfg);
      const temper = temperFactors(cfg.temper);
      const t = ((now - t0) / 1000) * cfg.tempo * temper.speed;
      const half = size / 2;

      // Дыхание: медленная синусоида. Когда говорит — вторая, быстрая, поверх.
      const breath = 0.5 + 0.5 * Math.sin(t * 0.9);
      const voice = isSpeaking ? 0.5 + 0.5 * Math.sin(t * 9) : 0;
      const scale = half * 0.44 * (1 + breath * 0.05 + voice * 0.12);

      ctx.clearRect(0, 0, size, size);

      // ── аура ───────────────────────────────────────────────────────────────
      // На очках ауры нет вовсе: плавный градиент на просвете читается как
      // мутное пятно поверх реального мира, а не как свечение.
      if (cfg.aura !== 'none' && !glasses) {
        const auraR =
          cfg.aura === 'storm'
            ? half * (0.78 + 0.18 * Math.sin(t * 3) + voice * 0.1)
            : cfg.aura === 'pulse'
              ? half * (0.72 + 0.2 * breath)
              : half * 0.82;
        const grad = ctx.createRadialGradient(half, half, scale * 0.5, half, half, auraR);
        grad.addColorStop(0, pal.mainGlow);
        grad.addColorStop(0.55, pal.accentSoft);
        grad.addColorStop(1, 'transparent');
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(half, half, auraR, 0, TAU);
        ctx.fill();

        if (cfg.aura === 'halo') {
          ctx.strokeStyle = pal.accent;
          ctx.globalAlpha = 0.45 + 0.25 * breath;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.ellipse(half, half - scale * 0.95, scale * 1.15, scale * 0.3, 0, 0, TAU);
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
        ctx.globalCompositeOperation = 'source-over';
      }

      // ── тело ───────────────────────────────────────────────────────────────
      const yaw = t * 0.5 + pointer.x * 0.35;
      const pitch = Math.sin(t * 0.31) * 0.22 + pointer.y * 0.22;
      const cy = Math.cos(yaw), sy = Math.sin(yaw);
      const cp = Math.cos(pitch), sp = Math.sin(pitch);

      const projected = shape.points.map((p, i) => {
        // Хаос разбрасывает точки по своим орбитам — форма перестаёт быть
        // жёсткой, но не рассыпается: смещение ограничено и привязано к индексу.
        const wob = cfg.chaos * 0.35 * temper.jitter;
        const px = p.x + (wob ? Math.sin(t * 1.7 + i * 0.7) * wob : 0);
        const py = p.y + (wob ? Math.cos(t * 1.3 + i * 1.1) * wob : 0);
        const pz = p.z + (wob ? Math.sin(t * 2.1 + i * 0.3) * wob : 0);

        const x1 = px * cy - pz * sy;
        const z1 = px * sy + pz * cy;
        const y2 = py * cp - z1 * sp;
        const z2 = py * sp + z1 * cp;

        const persp = 2.6 / (2.6 + z2);
        return {
          x: half + x1 * scale * persp,
          y: half + y2 * scale * persp,
          z: z2,
          persp,
        };
      });

      ctx.globalCompositeOperation = 'lighter';

      // Рёбра кристалла — рисуем до точек, чтобы вершины остались яркими.
      if (shape.edges.length) {
        ctx.lineWidth = glasses ? Math.max(2, size * 0.012) : 1;
        for (const [a, b] of shape.edges) {
          const pa = projected[a];
          const pb = projected[b];
          const depth = (pa.z + pb.z) / 2;
          if (glasses && depth > 0.35) continue;
          ctx.strokeStyle = pal.main;
          ctx.globalAlpha = glasses ? 1 : Math.max(0.05, 0.42 - depth * 0.18);
          ctx.beginPath();
          ctx.moveTo(pa.x, pa.y);
          ctx.lineTo(pb.x, pb.y);
          ctx.stroke();
        }
      }

      if (glasses) {
        // Силуэт: жирный контур плюс десятки крупных точек вместо тысячи мелких.
        // Порог по альфе тут не смягчается — на просвете полупрозрачное просто
        // не видно, поэтому всё либо горит в полную силу, либо не рисуется.
        ctx.strokeStyle = pal.main;
        ctx.lineWidth = Math.max(3, size * 0.018);
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.arc(half, half, scale * 1.02, 0, TAU);
        ctx.stroke();

        const step = Math.max(1, Math.ceil(projected.length / 44));
        ctx.fillStyle = pal.main;
        const dot = Math.max(2.5, size * 0.016);
        for (let i = 0; i < projected.length; i += step) {
          const p = projected[i];
          if (p.z > 0.35) continue; // ближняя половина: дальняя на просвете только мусорит
          ctx.beginPath();
          ctx.arc(p.x, p.y, dot, 0, TAU);
          ctx.fill();
        }
      } else {
        // Дальние точки рисуем первыми — иначе ближние тонут в дальних.
        projected.sort((a, b) => b.z - a.z);
        for (const p of projected) {
          const depth = (1.4 - p.z) / 2.6; // 0 — далеко, 1 — близко
          const r = (0.7 + depth * 1.9) * (1 + voice * 0.35) * temper.sharpness * 0.75;
          ctx.globalAlpha = Math.max(0.08, Math.min(1, 0.25 + depth * 0.85));
          ctx.fillStyle = p.z < 0 ? pal.main : pal.accent;
          ctx.beginPath();
          ctx.arc(p.x, p.y, Math.max(0.4, r), 0, TAU);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';

      // ── глаза ──────────────────────────────────────────────────────────────
      if (cfg.eyes !== 'none') {
        if (now > nextBlink) {
          blinkUntil = now + 130;
          nextBlink = now + 2400 + Math.random() * 4000;
        }
        const blinking = now < blinkUntil;
        const gaze = { x: pointer.x * scale * 0.12, y: pointer.y * scale * 0.12 };
        const eyeR = scale * (cfg.eyes === 'triad' ? 0.13 : 0.19);
        const pupilR = eyeR * (isListening ? 0.3 : 0.45) * (1 + voice * 0.2);

        const drawEye = (ex: number, ey: number, radius: number) => {
          if (!glasses) {
            ctx.fillStyle = 'rgba(4,2,12,0.9)';
            ctx.beginPath();
            ctx.arc(ex, ey, radius, 0, TAU);
            ctx.fill();
          } else {
            // На очках внутренность глаза оставляем прозрачной: заливать её
            // «почти чёрным» бессмысленно — на просвете это и есть прозрачность.
            ctx.beginPath();
            ctx.arc(ex, ey, radius, 0, TAU);
          }

          ctx.strokeStyle = glasses ? pal.main : pal.accent;
          ctx.lineWidth = glasses ? Math.max(2.5, size * 0.014) : 1.2;
          ctx.globalAlpha = glasses ? 1 : 0.8;
          ctx.stroke();
          ctx.globalAlpha = 1;

          if (blinking) {
            ctx.strokeStyle = pal.main;
            ctx.lineWidth = glasses ? Math.max(3, size * 0.018) : 2.4;
            ctx.beginPath();
            ctx.moveTo(ex - radius, ey);
            ctx.lineTo(ex + radius, ey);
            ctx.stroke();
            return;
          }
          ctx.globalCompositeOperation = 'lighter';
          ctx.fillStyle = pal.main;
          ctx.beginPath();
          ctx.arc(ex + gaze.x, ey + gaze.y, radius * (pupilR / eyeR), 0, TAU);
          ctx.fill();
          ctx.globalCompositeOperation = 'source-over';
        };

        if (cfg.eyes === 'visor') {
          const w = scale * 0.95;
          const h = scale * 0.17;
          ctx.fillStyle = 'rgba(4,2,12,0.85)';
          ctx.beginPath();
          ctx.roundRect(half - w / 2, half - h / 2, w, h, h / 2);
          ctx.fill();
          ctx.globalCompositeOperation = 'lighter';
          const vg = ctx.createLinearGradient(half - w / 2, 0, half + w / 2, 0);
          vg.addColorStop(0, 'transparent');
          vg.addColorStop(0.5 + pointer.x * 0.3, pal.main);
          vg.addColorStop(1, 'transparent');
          ctx.fillStyle = vg;
          ctx.globalAlpha = blinking ? 0.15 : 0.9;
          ctx.beginPath();
          ctx.roundRect(half - w / 2, half - h / 2, w, h, h / 2);
          ctx.fill();
          ctx.globalAlpha = 1;
          ctx.globalCompositeOperation = 'source-over';
        } else if (cfg.eyes === 'single') {
          drawEye(half, half, eyeR);
        } else if (cfg.eyes === 'pair') {
          drawEye(half - scale * 0.28, half, eyeR);
          drawEye(half + scale * 0.28, half, eyeR);
        } else {
          drawEye(half, half - scale * 0.22, eyeR);
          drawEye(half - scale * 0.26, half + scale * 0.16, eyeR);
          drawEye(half + scale * 0.26, half + scale * 0.16, eyeR);
        }
      }

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onPointer);
    };
  }, [size]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ width: size, height: size, display: 'block' }}
      aria-label={`Облик агента ${config.name}`}
      role="img"
    />
  );
}
