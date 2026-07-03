'use client';

import { useEffect, useRef } from 'react';

// Ядро: объёмная сфера из тысяч частиц с горячим световым центром
// (по референсу пользователя). Canvas, вращение, аддитивное свечение.

const P = 2600; // частиц на сфере

export default function CoreOrb({ listening }: { listening: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const listenRef = useRef(listening);
  useEffect(() => { listenRef.current = listening; }, [listening]);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const size = cv.clientWidth || 150;
    cv.width = size * dpr;
    cv.height = size * dpr;

    // сфера Фибоначчи + собственная фаза мерцания
    const pts = new Float32Array(P * 4); // x,y,z,phase
    const GA = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < P; i++) {
      const y = 1 - (i / (P - 1)) * 2;
      const r = Math.sqrt(1 - y * y);
      const th = GA * i;
      pts[i * 4] = Math.cos(th) * r;
      pts[i * 4 + 1] = y;
      pts[i * 4 + 2] = Math.sin(th) * r;
      pts[i * 4 + 3] = Math.random() * Math.PI * 2;
    }

    let raf = 0;
    let yaw = 0;
    let last = performance.now();

    const draw = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      yaw += dt * (listenRef.current ? 1.4 : 0.35);

      const c = size / 2;
      const R = size * 0.46;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);

      // горячее ядро света, чуть смещённое (как на референсе)
      const hot = listenRef.current ? 0.5 : 0.36;
      const g = ctx.createRadialGradient(c - R * 0.16, c - R * 0.05, 0, c, c, R * 0.85);
      g.addColorStop(0, `rgba(255,255,255,${hot + 0.45})`);
      g.addColorStop(0.25, 'rgba(240,225,255,0.5)');
      g.addColorStop(0.55, 'rgba(190,140,255,0.18)');
      g.addColorStop(1, 'rgba(120,70,200,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(c, c, R, 0, Math.PI * 2);
      ctx.fill();

      // частицы сферы
      ctx.globalCompositeOperation = 'lighter';
      const cy = Math.cos(yaw), sy = Math.sin(yaw);
      const tilt = 0.35, ct = Math.cos(tilt), st = Math.sin(tilt);
      for (let i = 0; i < P; i++) {
        const x0 = pts[i * 4], y0 = pts[i * 4 + 1], z0 = pts[i * 4 + 2];
        const x1 = x0 * cy - z0 * sy;
        const z1 = x0 * sy + z0 * cy;
        const y1 = y0 * ct - z1 * st;
        const z2 = y0 * st + z1 * ct;
        const px = c + x1 * R;
        const py = c + y1 * R;
        const front = (z2 + 1) / 2; // 0 — за сферой, 1 — к нам
        const tw = 0.6 + 0.4 * Math.sin(now / 400 + pts[i * 4 + 3]);
        const a = (0.12 + front * 0.5) * tw;
        // лаванда/фиолет, ярче у центра диска
        const lum = 190 + front * 65;
        ctx.fillStyle = `rgba(${lum},${150 + front * 60},255,${a})`;
        ctx.fillRect(px, py, 1.2, 1.2);
      }
      ctx.globalCompositeOperation = 'source-over';

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return <canvas ref={canvasRef} className="hud-orb-canvas" aria-hidden />;
}
