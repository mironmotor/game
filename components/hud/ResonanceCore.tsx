'use client';

/**
 * ResonanceCore — «Резонанс». Нет плашек, нет чрома. Только фиолетовое ядро в
 * центре, которое дышит, и свет от него разливается во всё поле. По середине —
 * коды, стекающие к ядру. Это скин живого ядра MAX: минимум интерфейса, максимум
 * присутствия. Открыть: событие `resonance:toggle` (команда /резонанс). Esc/двойной
 * клик — выйти.
 */

import { useEffect, useRef, useState } from 'react';

export default function ResonanceCore() {
  const [open, setOpen] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const onToggle = () => setOpen((v) => !v);
    const onOpen = () => setOpen(true);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('resonance:toggle', onToggle);
    window.addEventListener('resonance:open', onOpen);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('resonance:toggle', onToggle);
      window.removeEventListener('resonance:open', onOpen);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  // Violet code-rain that concentrates toward the center and dissolves into the
  // core. Throttled to ~18fps so it stays feather-light on the Air.
  useEffect(() => {
    if (!open) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const fontSize = 16;
    const glyphs = 'アイウエオﾊﾐｷ01{}<>/=;()[]λΔΣΦΨ*+MAX17∞'.split('');
    let cols: number[] = [];
    let raf = 0;
    let last = 0;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      const count = Math.max(1, Math.floor(canvas.width / fontSize));
      cols = new Array(count).fill(0).map(() => (Math.random() * canvas.height) / fontSize);
    };
    resize();
    window.addEventListener('resize', resize);

    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      if (t - last < 55) return;
      last = t;
      const w = canvas.width;
      const h = canvas.height;
      ctx.fillStyle = 'rgba(5,4,10,0.34)';
      ctx.fillRect(0, 0, w, h);
      ctx.font = `${fontSize}px monospace`;
      const cx = w / 2;
      const cy = h / 2;
      const reach = Math.max(w, h) * 0.55;
      for (let i = 0; i < cols.length; i++) {
        const x = i * fontSize;
        const y = cols[i] * fontSize;
        const dist = Math.hypot(x - cx, y - cy);
        const near = Math.max(0, 1 - dist / reach); // brighter toward the core
        const g = glyphs[(Math.random() * glyphs.length) | 0];
        ctx.fillStyle = `rgba(180,120,255,${0.08 + near * 0.55})`;
        ctx.fillText(g, x, y);
        if (y > h && Math.random() > 0.975) cols[i] = 0;
        cols[i] += 0.5;
      }
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[70] overflow-hidden bg-[#05040a]"
      onDoubleClick={() => setOpen(false)}
    >
      <style>{`
        @keyframes rc-breathe {0%,100%{transform:translate(-50%,-50%) scale(1);opacity:.9}50%{transform:translate(-50%,-50%) scale(1.13);opacity:1}}
        @keyframes rc-spill {0%,100%{opacity:.55}50%{opacity:.95}}
        @keyframes rc-halo {0%,100%{opacity:.4;transform:translate(-50%,-50%) scale(1)}50%{opacity:.7;transform:translate(-50%,-50%) scale(1.2)}}
      `}</style>

      <canvas ref={canvasRef} className="absolute inset-0" />

      {/* Свет разливается во всё поле */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(circle at 50% 50%, rgba(124,58,237,0.55), rgba(88,28,135,0.18) 32%, rgba(5,4,10,0) 62%)',
          mixBlendMode: 'screen',
          animation: 'rc-spill 6s ease-in-out infinite',
        }}
      />

      {/* Дальнее гало — свет уходит за края */}
      <div
        className="pointer-events-none absolute left-1/2 top-1/2 h-[140vmax] w-[140vmax]"
        style={{
          background: 'radial-gradient(circle, rgba(124,58,237,0.28), rgba(5,4,10,0) 60%)',
          animation: 'rc-halo 9s ease-in-out infinite',
        }}
      />

      {/* Ядро */}
      <div
        className="pointer-events-none absolute left-1/2 top-1/2"
        style={{ animation: 'rc-breathe 4.6s ease-in-out infinite' }}
      >
        <div className="relative h-64 w-64">
          <div
            className="absolute inset-[-190px] rounded-full"
            style={{ background: 'radial-gradient(circle, rgba(124,58,237,0.40), transparent 70%)', filter: 'blur(90px)' }}
          />
          <div
            className="absolute inset-[-70px] rounded-full"
            style={{ background: 'radial-gradient(circle, rgba(168,85,247,0.65), transparent 70%)', filter: 'blur(45px)' }}
          />
          <div
            className="absolute inset-0 rounded-full"
            style={{
              background:
                'radial-gradient(circle, #fbf3ff 0%, #d8b4fe 16%, #c084fc 32%, #a855f7 50%, #7c3aed 68%, rgba(124,58,237,0) 78%)',
              filter: 'blur(4px)',
            }}
          />
        </div>
      </div>

      {/* Почти невидимый выход — чтобы не потеряться */}
      <div className="pointer-events-none absolute bottom-6 left-1/2 -translate-x-1/2 text-[10px] tracking-[0.45em] text-violet-300/20">
        РЕЗОНАНС · ESC
      </div>
    </div>
  );
}
