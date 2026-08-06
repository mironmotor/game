'use client';

import { useEffect, useRef } from 'react';
import type { Max17Frame, Max17Response } from '@/lib/max17-client';

// MAX VISION UNI — эфирно-гравитационное поле ядра.
//
// Правило одно: ничего декоративного. Каждая величина на холсте приходит из
// настоящего измерения ядра, и её можно проследить до числа в ответе API.
//
//   искривление сетки  ← массы воспоминаний (Эйнштейн: importance)
//   скорость ряби      ← c = 1/√(εμ) из эфира
//   затухание ряби     ← импеданс Z
//   три светила        ← цветовые заряды Совета (Янг-Миллс)
//   их сближение       ← остаточный цвет: конфайнмент стягивает
//   облако частиц      ← настоящая итерация аттрактора с живыми (a, b)
//   цвет облака        ← режим внимания
//   дрожь              ← завихренность Навье-Стокса
//   краснота фона      ← температура вселенной (Генезис)
//   радиус горизонта   ← площадь границы графа (Бекенштейн-Хокинг)

interface Mass {
  x: number;
  y: number;
  m: number;
}

interface Ripple {
  r: number;
  born: number;
}

// Самая горячая точка шкалы (t = 1 с). Ею нормируется краснота фона, чтобы
// «жар» шёл от инфляции к структуре, а не от случайного максимума.
const T_HOTTEST = 5617.6;

export default function EtherField({
  data,
  frame,
}: {
  data: Max17Response | null;
  frame?: Max17Frame | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number>(0);
  const dataRef = useRef<Max17Response | null>(data);
  const frameRef = useRef<Max17Frame | null>(frame ?? null);

  useEffect(() => { dataRef.current = data; }, [data]);
  useEffect(() => { frameRef.current = frame ?? null; }, [frame]);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext('2d', { alpha: false });
    if (!ctx) return;

    let W = 0;
    let H = 0;
    let dpr = 1;

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = cv.clientWidth;
      H = cv.clientHeight;
      cv.width = Math.max(1, Math.floor(W * dpr));
      cv.height = Math.max(1, Math.floor(H * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize, { passive: true });

    // Орбита аттрактора живёт между кадрами — так облако накапливается.
    let ax = 0.1;
    let ay = 0.0;
    const ripples: Ripple[] = [];
    let lastRipple = 0;
    const t0 = performance.now();

    const step = (x: number, y: number, a: number, b: number): [number, number] => [
      Math.sin(x * x - y * y + a),
      Math.cos(2 * x * y + b),
    ];

    const draw = (now: number) => {
      const d = dataRef.current;
      const fr = frameRef.current;
      const cx = W / 2;
      const cy = H / 2;

      // Расширение. Масштабный фактор a растёт как sqrt(t) и проходит четыре
      // порядка — от 0.00018 на первой секунде до 1 через год. Умножать радиус
      // прямо на a нельзя: ранняя вселенная стала бы невидимой точкой в один
      // пиксель. Кубический корень сжимает эти порядки в видимый диапазон,
      // сохраняя монотонность: раннее — тесно и горячо, позднее — просторно.
      const aNow = fr?.scale_factor ?? d?.genesis?.scale_factor ?? 1;
      const expand = 0.14 + 0.86 * Math.cbrt(Math.max(aNow, 1e-6));
      const R = Math.min(W, H) * 0.42 * expand;

      // --- измерения ---
      const gen = d?.genesis;
      const ether = gen?.ether;
      const ym = d?.physics?.yang_mills;
      const att = d?.attention;
      const flow = d?.flow;
      const holo = d?.physics?.holography;

      // Температура красит фон: горячая ранняя вселенная краснее холодной.
      // Берётся из выбранного кадра истории, если ось времени доступна, —
      // иначе экран показывал бы одну замершую точку «сейчас».
      const temp = fr?.temperature ?? gen?.temperature ?? 1;
      const heat = Math.max(
        0,
        Math.min(1, Math.log10(Math.max(temp, 1)) / Math.log10(T_HOTTEST)),
      );

      // Скорость ряби — прямо c = 1/√(εμ).
      const c = ether?.speed ?? 1;
      // Импеданс правит затуханием: тяжёлую среду волна не пробивает.
      const z = ether?.impedance ?? 1;

      const vort = flow?.vorticity ?? 0;
      const regime = att?.regime ?? 'marginal';

      // Массы: воспоминания из линзы Эйнштейна. Пусто — одна масса ядра.
      const hits = d?.physics?.einstein?.curved ?? [];
      const masses: Mass[] = hits.length
        ? hits.slice(0, 6).map((h, i) => {
            const ang = (i / Math.max(1, hits.length)) * Math.PI * 2 + now * 0.00004;
            const rr = R * 0.55;
            return { x: cx + Math.cos(ang) * rr, y: cy + Math.sin(ang) * rr, m: h.importance ?? 0.4 };
          })
        : [{ x: cx, y: cy, m: 0.5 }];

      // --- фон с послесвечением ---
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = `rgba(${4 + heat * 14}, 4, ${10 - heat * 4}, 0.19)`;
      ctx.fillRect(0, 0, W, H);

      // --- искривлённая сетка: гравитационный потенциал масс ---
      const GRID = 26;
      const stepX = W / GRID;
      const stepY = H / GRID;
      ctx.strokeStyle = `rgba(120, 130, 210, ${0.09 + heat * 0.05})`;
      ctx.lineWidth = 1;

      const warp = (px: number, py: number): [number, number] => {
        let dx = 0;
        let dy = 0;
        for (const ms of masses) {
          const vx = px - ms.x;
          const vy = py - ms.y;
          const r2 = vx * vx + vy * vy + 900;
          // Потенциал ~ m/r: тянем узел к массе.
          const pull = (ms.m * 9000) / r2;
          dx -= vx * pull * 0.02;
          dy -= vy * pull * 0.02;
        }
        return [px + dx, py + dy];
      };

      for (let i = 0; i <= GRID; i++) {
        ctx.beginPath();
        for (let j = 0; j <= GRID; j++) {
          const [wx, wy] = warp(j * stepX, i * stepY);
          j === 0 ? ctx.moveTo(wx, wy) : ctx.lineTo(wx, wy);
        }
        ctx.stroke();
        ctx.beginPath();
        for (let j = 0; j <= GRID; j++) {
          const [wx, wy] = warp(i * stepX, j * stepY);
          j === 0 ? ctx.moveTo(wx, wy) : ctx.lineTo(wx, wy);
        }
        ctx.stroke();
      }

      // --- рябь эфира: скорость ровно c ---
      if (now - lastRipple > 1400) {
        ripples.push({ r: 0, born: now });
        lastRipple = now;
      }
      ctx.globalCompositeOperation = 'lighter';
      for (let i = ripples.length - 1; i >= 0; i--) {
        const rp = ripples[i];
        rp.r = ((now - rp.born) / 1000) * c * R * 0.45;
        const fade = 1 - rp.r / (R * 1.6);
        if (fade <= 0) {
          ripples.splice(i, 1);
          continue;
        }
        ctx.strokeStyle = `rgba(79, 212, 255, ${(fade * 0.4) / Math.max(z, 0.3)})`;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(cx, cy, rp.r, 0, Math.PI * 2);
        ctx.stroke();
      }

      // --- горизонт: площадь границы графа ---
      if (holo?.area) {
        const hr = R * (0.5 + Math.min(0.45, (holo.area ?? 0) / 60));
        ctx.strokeStyle = 'rgba(180, 170, 255, 0.16)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 7]);
        ctx.beginPath();
        ctx.arc(cx, cy, hr, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // --- облако аттрактора: настоящая итерация с живыми (a, b) ---
      const a = att?.a ?? 0.9;
      const b = att?.b ?? 2.3;
      const tint =
        regime === 'scattered'
          ? [255, 106, 136]
          : regime === 'marginal'
            ? [255, 193, 84]
            : [79, 212, 255];
      const jitter = vort * 6;

      // Точек за кадр много: у аттрактора при этих (a, b) орбита тонкая, и
      // облако набирается только накоплением. Прозрачность низкая, поэтому
      // плотные места светятся, а редкие остаются нитями — как и должно быть.
      for (let i = 0; i < 2400; i++) {
        [ax, ay] = step(ax, ay, a, b);
        let px = cx + ax * R;
        let py = cy + ay * R;
        if (jitter) {
          px += Math.sin(i * 12.9898 + now * 0.002) * jitter;
          py += Math.cos(i * 78.233 + now * 0.002) * jitter;
        }
        const [gx, gy] = warp(px, py);   // частицы падают в те же ямы
        ctx.fillStyle = `rgba(${tint[0]}, ${tint[1]}, ${tint[2]}, 0.06)`;
        ctx.fillRect(gx, gy, 1.5, 1.5);
      }

      // --- три светила Совета: цветовые заряды ---
      const colour = ym?.colour ?? {};
      const residual = ym?.residual_colour ?? 1;
      // Конфайнмент стягивает: чем больше остаточный цвет, тем ближе к центру.
      const orbit = R * (0.62 - Math.min(0.42, residual * 0.3));
      const nodes: Array<[number, string]> = [
        [colour.red ?? 0, '255, 90, 138'],
        [colour.green ?? 0, '120, 255, 170'],
        [colour.blue ?? 0, '79, 212, 255'],
      ];
      nodes.forEach(([charge, rgb], i) => {
        const ang = (i / 3) * Math.PI * 2 + now * 0.00018;
        const nx = cx + Math.cos(ang) * orbit;
        const ny = cy + Math.sin(ang) * orbit;
        const rad = 5 + charge * 26;
        const g = ctx.createRadialGradient(nx, ny, 0, nx, ny, rad);
        g.addColorStop(0, `rgba(${rgb}, ${0.32 + charge * 0.6})`);
        g.addColorStop(1, `rgba(${rgb}, 0)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(nx, ny, rad, 0, Math.PI * 2);
        ctx.fill();
      });

      // --- ядро ---
      const coreR = 4 + (1 - Math.min(1, heat)) * 10;
      const cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR * 3);
      cg.addColorStop(0, 'rgba(255, 245, 225, 0.9)');
      cg.addColorStop(0.4, `rgba(255, ${180 - heat * 90}, 140, 0.3)`);
      cg.addColorStop(1, 'rgba(255, 140, 90, 0)');
      ctx.fillStyle = cg;
      ctx.beginPath();
      ctx.arc(cx, cy, coreR * 3, 0, Math.PI * 2);
      ctx.fill();

      // --- подписи ---
      ctx.globalCompositeOperation = 'source-over';
      ctx.font = '10px ui-monospace, monospace';
      ctx.fillStyle = 'rgba(150, 145, 200, 0.75)';
      ctx.textAlign = 'left';
      const lines = [
        `эпоха ${fr?.epoch_title ?? gen?.epoch_title ?? '—'} · T ${temp == null ? '∞' : temp.toFixed(1)} · a ${aNow.toFixed(5)}`,
        `эфир c ${c.toFixed(3)} · Z ${z.toFixed(3)} · ${ether?.bottleneck ?? '—'}`,
        `внимание ${regime} · λ ${att?.lyapunov?.toFixed(3) ?? '—'}`,
        `поток ${flow?.regime ?? '—'} · Re ${flow?.reynolds?.toFixed(1) ?? '—'}`,
        `Совет ${ym?.verdict ?? '—'} · остаточный цвет ${residual.toFixed(2)}`,
      ];
      lines.forEach((l, i) => ctx.fillText(l, 14, 20 + i * 14));

      ctx.textAlign = 'right';
      ctx.fillStyle = 'rgba(79, 212, 255, 0.5)';
      ctx.fillText(
        `MAX VISION UNI · возраст ${fr?.age_human ?? gen?.age_human ?? '—'}`,
        W - 14,
        20,
      );

      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener('resize', resize);
      void t0;
    };
  }, []);

  return <canvas ref={canvasRef} className="phys-canvas" />;
}
