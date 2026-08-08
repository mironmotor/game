'use client';

import { useEffect, useRef } from 'react';
import { bounds, createSim, type SimDef, type SimState } from '@/lib/dream-sims';

/**
 * Рендер симуляции: перспективная проекция + накопительный буфер.
 *
 * Точки не рисуются через ctx.arc — на двенадцати тысячах частиц это тысячи
 * вызовов в кадр и заметные просадки на телефоне. Вместо этого пиксели
 * складываются вручную в ImageData: сложение вместо перекрытия даёт тот самый
 * свет в местах, где частиц много, и стоит один проход по массиву.
 *
 * Буфер между кадрами гасится, а не очищается: остаётся послесвечение, по
 * которому видно траекторию. Для Лоренца это половина смысла картинки.
 */

interface Props {
  def: SimDef;
  seed: number;
  hue: number;
  accentHue: number;
  running: boolean;
  /** 0..1 — насколько ярко. Резонанс сна. */
  intensity: number;
  size?: number;
  className?: string;
}

/** Таблица цветов: 256 оттенков от основного тона к акцентному. */
function buildLut(hue: number, accentHue: number): Uint8Array {
  const lut = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const k = i / 255;
    const h = (hue + (accentHue - hue) * k + 360) % 360;
    const light = 0.35 + k * 0.5;
    const [r, g, b] = hslToRgb(h / 360, 1, light);
    lut[i * 3] = r;
    lut[i * 3 + 1] = g;
    lut[i * 3 + 2] = b;
  }
  return lut;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)))));
  };
  return [f(0), f(8), f(4)];
}

export default function DreamSim3D({
  def,
  seed,
  hue,
  accentHue,
  running,
  intensity,
  size = 560,
  className,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const liveRef = useRef({ running, intensity, hue, accentHue });
  liveRef.current = { running, intensity, hue, accentHue };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    // Внутреннее разрешение фиксировано и не зависит от devicePixelRatio:
    // на ретине буфер вырос бы вчетверо, а с ним и цена каждого кадра.
    const W = 512;
    const H = 512;
    canvas.width = W;
    canvas.height = H;

    const image = ctx.createImageData(W, H);
    const data = image.data;
    for (let i = 3; i < data.length; i += 4) data[i] = 255; // альфа один раз

    let state: SimState = createSim(def, seed);
    let lut = buildLut(liveRef.current.hue, liveRef.current.accentHue);
    let lutKey = `${liveRef.current.hue}|${liveRef.current.accentHue}`;
    let box = bounds(state);
    let framesSinceFit = 0;
    let raf = 0;
    let last = performance.now();
    let yaw = 0;
    // Нормировка яркости по скорости. Абсолютные величины у симуляций разные
    // на порядки — у Лоренца это сотни, у стаи меньше единицы, — поэтому
    // масштаб берётся из самой картины и подтягивается медленно.
    let speedNorm = 1;

    const draw = (now: number) => {
      const live = liveRef.current;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      const key = `${live.hue}|${live.accentHue}`;
      if (key !== lutKey) {
        lut = buildLut(live.hue, live.accentHue);
        lutKey = key;
      }

      if (live.running) {
        // Два подшага: один большой шаг на упругих системах заметно грубее,
        // а два маленьких почти ничего не стоят.
        def.step(state, dt / 2);
        def.step(state, dt / 2);
        yaw += dt * 0.18;
        // Границы пересчитываем редко: они меняются медленно, а полный проход
        // по массиву каждый кадр — лишняя работа.
        if (++framesSinceFit > 15) {
          const next = bounds(state);
          box = {
            cx: box.cx + (next.cx - box.cx) * 0.35,
            cy: box.cy + (next.cy - box.cy) * 0.35,
            cz: box.cz + (next.cz - box.cz) * 0.35,
            radius: box.radius + (next.radius - box.radius) * 0.35,
          };
          framesSinceFit = 0;
        }
      }

      // Затухание вместо очистки — послесвечение.
      const decay = def.tint === 'speed' ? 0.86 : 0.7;
      for (let i = 0; i < data.length; i += 4) {
        data[i] = data[i] * decay;
        data[i + 1] = data[i + 1] * decay;
        data[i + 2] = data[i + 2] * decay;
      }

      const { pos, vel, count } = state;
      const scale = (Math.min(W, H) * 0.42) / box.radius;
      const cy = Math.cos(yaw), sy = Math.sin(yaw);
      const cp = Math.cos(def.pitch), sp = Math.sin(def.pitch);
      const bright = 40 + live.intensity * 160;
      const invSpeed = 255 / speedNorm;
      let maxSpeed = 1e-6;

      for (let i = 0; i < count; i++) {
        const k = i * 3;
        const x = pos[k] - box.cx;
        const y = pos[k + 1] - box.cy;
        const z = pos[k + 2] - box.cz;

        const x1 = x * cy - z * sy;
        const z1 = x * sy + z * cy;
        const y2 = y * cp - z1 * sp;
        const z2 = y * sp + z1 * cp;

        // Перспектива: коэффициент подобран так, чтобы облако читалось
        // объёмным, но не выворачивалось наизнанку у ближней границы.
        const persp = 3.2 / (3.2 + z2 / box.radius);
        const sx = (W / 2 + x1 * scale * persp) | 0;
        const syp = (H / 2 + y2 * scale * persp) | 0;
        if (sx < 0 || sx >= W || syp < 0 || syp >= H) continue;

        let shade: number;
        if (def.tint === 'speed') {
          const s = Math.hypot(vel[k], vel[k + 1], vel[k + 2]);
          if (s > maxSpeed) maxSpeed = s;
          shade = Math.min(255, (s * invSpeed) | 0);
        } else {
          shade = Math.min(255, Math.max(0, ((z2 / box.radius + 1) * 127) | 0));
        }

        const l = shade * 3;
        const idx = (syp * W + sx) * 4;
        const w = bright * persp;
        data[idx] = Math.min(255, data[idx] + (lut[l] * w) / 255);
        data[idx + 1] = Math.min(255, data[idx + 1] + (lut[l + 1] * w) / 255);
        data[idx + 2] = Math.min(255, data[idx + 2] + (lut[l + 2] * w) / 255);
      }

      if (def.tint === 'speed') speedNorm += (maxSpeed - speedNorm) * 0.06;

      ctx.putImageData(image, 0, 0);
      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [def, seed]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ width: size, height: size, maxWidth: '92vw', maxHeight: '92vw', display: 'block', borderRadius: 24 }}
      aria-label={`Симуляция: ${def.title}`}
      role="img"
    />
  );
}
