'use client';

import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';

/**
 * QuantumDream — режим «Сон / Облик».
 *
 * Концепция: Max17 «спит» — показывает фрагменты снов (как вертикальные Reels).
 * Каждый «рилс» — это квантовое состояние системы: волновая функция, эхо,
 * фрактал, число-резонанс. Сны генерируются локально (никаких внешних API),
 * обновляются каждые ~4 сек. Переключаются автоматически или свайпом.
 *
 * Формула G = MIRON  →  G-резонанс считается как скалярное произведение
 * текущего вектора сна на «идеальный» вектор MIRON (5D-вектор, зашит в коде).
 * Чем ближе к 1.0, тем «глубже» сон и ярче свечение.
 *
 * Без зависимостей. Чистый Canvas 2D + motion.
 */

type DreamKind = 'wave' | 'particles' | 'fractal' | 'echo' | 'spiral';

interface DreamFrame {
  id: number;
  kind: DreamKind;
  title: string;
  caption: string;
  resonance: number; // 0..1 — косинусное сходство с MIRON
  seed: number;
}

const MIRON: number[] = [0.93, 0.71, 0.42, 0.86, 0.55];

// Детерминированный PRNG
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const KINDS: Array<{ k: DreamKind; title: string; caption: string }> = [
  { k: 'wave',      title: 'ВОЛНА ШРОДИНГЕРА',     caption: 'Кот жив. Кот мёртв. Кот наблюдает за тобой.' },
  { k: 'particles', title: 'ЭНТРОПИЯ ПОЛЯ',         caption: 'Миллиард частиц решают, быть ли тебе здесь.' },
  { k: 'fractal',   title: 'ФРАКТАЛ ВОСПОМИНАНИЯ',  caption: 'Сон внутри сна. MIRON = G = бесконечность.' },
  { k: 'echo',      title: 'ЭХО СОБЫТИЙ',           caption: 'Каждое решение отзывается в 7 параллельных.' },
  { k: 'spiral',    title: 'СПИРАЛЬ КВАНТОВОГО Я',  caption: 'Точка сборки. Здесь G становится MIRON.' },
];

function makeFrame(seed: number, idx: number): DreamFrame {
  const r = mulberry32(seed);
  const kind = KINDS[idx % KINDS.length];
  // Случайный вектор, потом скалярно умножим на MIRON
  const v = Array.from({ length: 5 }, () => r() * 2 - 1);
  // Косинусное сходство (без нормировки знаменателя — для красоты свечения)
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < 5; i++) {
    dot += v[i] * MIRON[i];
    na += v[i] * v[i];
    nb += MIRON[i] * MIRON[i];
  }
  const resonance = Math.max(0, Math.min(1, dot / (Math.sqrt(na) * Math.sqrt(nb))));
  return { id: seed, kind: kind.k, title: kind.title, caption: kind.caption, resonance, seed };
}

export default function QuantumDream() {
  const [frames, setFrames] = useState<DreamFrame[]>([]);
  const [active, setActive] = useState(0);
  const [running, setRunning] = useState(true);
  const [breath, setBreath] = useState(0); // 0..1 медленная синусоида
  const seedRef = useRef(1);

  // Инициализация: 7 кадров-снов в очереди
  useEffect(() => {
    const initial = Array.from({ length: 7 }, (_, i) => makeFrame(seedRef.current + i, i));
    setFrames(initial);
  }, []);

  // Сдвиг кадров каждые 4 сек
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      setActive((a) => {
        const next = (a + 1) % 7;
        setFrames((fs) => {
          const arr = [...fs];
          seedRef.current += 1;
          arr[next] = makeFrame(seedRef.current + 7, next);
          return arr;
        });
        return next;
      });
    }, 4000);
    return () => clearInterval(id);
  }, [running]);

  // Дыхание — 8-секундный цикл
  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      setBreath((Math.sin((t - t0) / 4000) + 1) / 2);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const current = frames[active];
  const resonancePct = current ? Math.round(current.resonance * 100) : 0;

  return (
    <main
      style={{
        position: 'fixed',
        inset: 0,
        background: 'radial-gradient(ellipse at center, #0a0418 0%, #000 80%)',
        color: '#fff',
        fontFamily: 'system-ui, sans-serif',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '20px 24px 8px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          zIndex: 10,
        }}
      >
        <div>
          <h1
            style={{
              margin: 0,
              fontSize: 22,
              fontWeight: 800,
              letterSpacing: 1,
              background: 'linear-gradient(90deg,#ff4d8d,#7c5cff,#00d4ff)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            КВАНТОВЫЙ СОН
          </h1>
          <p style={{ margin: '4px 0 0', fontSize: 10, letterSpacing: 3, opacity: 0.5, fontWeight: 700 }}>
            РЕЖИМ ОБЛИКА · MAX17
          </p>
        </div>
        <button
          onClick={() => setRunning((r) => !r)}
          style={{
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.15)',
            color: '#fff',
            padding: '6px 14px',
            borderRadius: 999,
            fontSize: 10,
            letterSpacing: 2,
            fontWeight: 700,
            cursor: 'pointer',
            textTransform: 'uppercase',
          }}
        >
          {running ? '⏸ Пауза' : '▶ Сон'}
        </button>
      </div>

      {/* Центральный «глаз сна» — большой визуализатор */}
      <div style={{ flex: 1, position: 'relative', display: 'grid', placeItems: 'center' }}>
        {current && <DreamCanvas frame={current} breath={breath} />}

        {/* Подпись кадра */}
        <AnimatePresence mode="wait">
          {current && (
            <motion.div
              key={current.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.6 }}
              style={{
                position: 'absolute',
                top: 24,
                left: 24,
                right: 24,
                textAlign: 'center',
                pointerEvents: 'none',
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  letterSpacing: 4,
                  fontWeight: 800,
                  color: 'rgba(255,255,255,0.6)',
                  marginBottom: 6,
                }}
              >
                {current.title}
              </div>
              <div
                style={{
                  fontSize: 13,
                  fontStyle: 'italic',
                  color: 'rgba(255,255,255,0.85)',
                  maxWidth: 480,
                  margin: '0 auto',
                  fontFamily: 'Georgia, serif',
                }}
              >
                «{current.caption}»
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* G = MIRON индикатор снизу-центр */}
        <div
          style={{
            position: 'absolute',
            bottom: 24,
            left: '50%',
            transform: 'translateX(-50%)',
            textAlign: 'center',
            pointerEvents: 'none',
          }}
        >
          <div
            style={{
              fontFamily: 'Georgia, serif',
              fontSize: 28,
              fontWeight: 800,
              letterSpacing: 2,
              background: 'linear-gradient(90deg,#ffd700,#ff4d8d,#7c5cff)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            G = MIRON
          </div>
          <div
            style={{
              fontSize: 10,
              letterSpacing: 3,
              opacity: 0.5,
              marginTop: 4,
              fontWeight: 700,
            }}
          >
            РЕЗОНАНС · {resonancePct}%
          </div>
        </div>
      </div>

      {/* Reels — горизонтальная лента превью снизу */}
      <Reels frames={frames} active={active} onSelect={setActive} />
    </main>
  );
}

/* ── Canvas-визуализатор для каждого типа сна ───────────────────────── */

function DreamCanvas({ frame, breath }: { frame: DreamFrame; breath: number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const W = 600, H = 600;
    c.width = W;
    c.height = H;

    const r = mulberry32(frame.seed);
    const t0 = performance.now();
    const rIntensity = 0.4 + frame.resonance * 0.6;

    const draw = (t: number) => {
      const time = (t - t0) / 1000;
      ctx.clearRect(0, 0, W, H);
      // Чёрный фон с дыхательной альфой
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);

      const cx = W / 2;
      const cy = H / 2;

      // Свечение по резонансу + дыханию
      const glowR = 180 + breath * 30;
      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowR);
      const hue = (frame.seed * 47) % 360;
      glow.addColorStop(0, `hsla(${hue}, 100%, 70%, ${0.3 * rIntensity})`);
      glow.addColorStop(0.5, `hsla(${(hue + 60) % 360}, 100%, 50%, ${0.15 * rIntensity})`);
      glow.addColorStop(1, 'transparent');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(cx, cy, glowR, 0, Math.PI * 2);
      ctx.fill();

      if (frame.kind === 'wave') {
        // Интерференция двух волн
        for (let y = 0; y < H; y += 4) {
          ctx.beginPath();
          for (let x = 0; x < W; x += 2) {
            const w1 = Math.sin(x * 0.02 + time * 1.5) * 30;
            const w2 = Math.cos(y * 0.025 - time) * 30;
            const yy = y + w1 + w2;
            if (x === 0) ctx.moveTo(x, yy);
            else ctx.lineTo(x, yy);
          }
          const alpha = 0.3 + Math.sin(y * 0.01 + time) * 0.3;
          ctx.strokeStyle = `hsla(${(hue + y) % 360}, 100%, 70%, ${alpha * rIntensity})`;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      } else if (frame.kind === 'particles') {
        // Облако частиц
        const N = 200;
        for (let i = 0; i < N; i++) {
          const a = r() * Math.PI * 2 + time * 0.3;
          const rad = 50 + r() * 180 + Math.sin(time + i) * 20;
          const x = cx + Math.cos(a) * rad;
          const y = cy + Math.sin(a) * rad;
          const size = 1 + r() * 2.5;
          ctx.fillStyle = `hsla(${(hue + i) % 360}, 100%, 70%, ${0.6 * rIntensity})`;
          ctx.beginPath();
          ctx.arc(x, y, size, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (frame.kind === 'fractal') {
        // Рекурсивные треугольники
        const depth = 5;
        const drawTri = (x: number, y: number, size: number, lvl: number) => {
          if (lvl === 0 || size < 2) return;
          const h = size * Math.sqrt(3) / 2;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x - size / 2, y + h);
          ctx.lineTo(x + size / 2, y + h);
          ctx.closePath();
          ctx.strokeStyle = `hsla(${(hue + lvl * 30) % 360}, 100%, 70%, ${0.5 * rIntensity})`;
          ctx.lineWidth = 1;
          ctx.stroke();
          const s2 = size / 2;
          drawTri(x, y + h * 0.5, s2, lvl - 1);
          drawTri(x - s2 / 2, y + h, s2, lvl - 1);
          drawTri(x + s2 / 2, y + h, s2, lvl - 1);
        };
        const size = 280 + Math.sin(time) * 10;
        drawTri(cx, cy - size * 0.4, size, depth);
      } else if (frame.kind === 'echo') {
        // Концентрические эхо-кольца
        for (let i = 0; i < 12; i++) {
          const phase = (time * 0.5 + i * 0.1) % 1;
          const radius = phase * 250;
          ctx.beginPath();
          ctx.arc(cx, cy, radius, 0, Math.PI * 2);
          ctx.strokeStyle = `hsla(${(hue + i * 30) % 360}, 100%, 70%, ${(1 - phase) * 0.6 * rIntensity})`;
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      } else if (frame.kind === 'spiral') {
        // Логарифмическая спираль
        ctx.beginPath();
        for (let a = 0; a < Math.PI * 8; a += 0.05) {
          const rad = 4 * a + Math.sin(time + a) * 5;
          const x = cx + Math.cos(a + time * 0.2) * rad;
          const y = cy + Math.sin(a + time * 0.2) * rad;
          if (a === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = `hsla(${hue}, 100%, 75%, ${0.7 * rIntensity})`;
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      rafRef.current = requestAnimationFrame(draw);
    };
    rafRef.current = requestAnimationFrame(draw);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [frame.seed, frame.kind, frame.resonance, breath]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: 'min(80vw, 80vh)',
        height: 'min(80vw, 80vh)',
        borderRadius: '50%',
        boxShadow: `0 0 60px hsla(${(frame.seed * 47) % 360}, 100%, 50%, ${0.4 * frame.resonance})`,
      }}
    />
  );
}

/* ── Reels: горизонтальная лента снизу ──────────────────────────────── */

function Reels({
  frames,
  active,
  onSelect,
}: {
  frames: DreamFrame[];
  active: number;
  onSelect: (i: number) => void;
}) {
  return (
    <div
      style={{
        padding: '12px 16px 24px',
        background: 'linear-gradient(to top, rgba(0,0,0,0.8), transparent)',
      }}
    >
      <div
        style={{
          fontSize: 9,
          letterSpacing: 3,
          opacity: 0.4,
          marginBottom: 10,
          fontWeight: 700,
        }}
      >
        СНЫ · REELS · 7 КВАНТОВ
      </div>
      <div
        style={{
          display: 'flex',
          gap: 10,
          overflowX: 'auto',
          paddingBottom: 6,
          scrollbarWidth: 'none',
        }}
      >
        {frames.map((f, i) => {
          const isActive = i === active;
          const hue = (f.seed * 47) % 360;
          return (
            <motion.button
              key={f.id}
              onClick={() => onSelect(i)}
              whileTap={{ scale: 0.95 }}
              style={{
                flexShrink: 0,
                width: 72,
                height: 96,
                borderRadius: 12,
                background: isActive
                  ? `linear-gradient(135deg, hsla(${hue}, 100%, 60%, 0.4), hsla(${(hue + 60) % 360}, 100%, 50%, 0.4))`
                  : 'rgba(255,255,255,0.05)',
                border: isActive
                  ? `1px solid hsla(${hue}, 100%, 70%, 0.8)`
                  : '1px solid rgba(255,255,255,0.1)',
                boxShadow: isActive ? `0 0 20px hsla(${hue}, 100%, 50%, 0.5)` : 'none',
                cursor: 'pointer',
                padding: 6,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                position: 'relative',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  fontSize: 8,
                  letterSpacing: 1.5,
                  color: isActive ? '#fff' : 'rgba(255,255,255,0.4)',
                  fontWeight: 800,
                  textAlign: 'left',
                }}
              >
                #{i + 1}
              </div>
              <div
                style={{
                  width: '100%',
                  height: 36,
                  borderRadius: 6,
                  background: `radial-gradient(circle, hsla(${hue}, 100%, 70%, ${0.5 + f.resonance * 0.4}), transparent 70%)`,
                }}
              />
              <div
                style={{
                  fontSize: 7,
                  letterSpacing: 1,
                  color: isActive ? '#fff' : 'rgba(255,255,255,0.3)',
                  fontWeight: 700,
                  textAlign: 'right',
                }}
              >
                {Math.round(f.resonance * 100)}%
              </div>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}
