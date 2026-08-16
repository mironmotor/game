'use client';

/**
 * EYE — проекция плотности. Портирован из артефакта в React как есть по сути,
 * но иначе по устройству: там всё жило в замыкании IIFE, здесь состояние
 * держится в рефах, а не в React-состоянии.
 *
 * Это не стилистика. Цикл рисует до шестидесяти кадров в секунду и трогает
 * массивы на миллионы чисел; проведи их через setState — и React будет
 * перерисовывать дерево на каждом кадре вместо холста. В состоянии живёт
 * только то, что видит человек: подписи, положения ползунков, режим взгляда.
 *
 * Математика — двумерное отображение
 *     x' = sin(x² − y² + a)
 *     y' = cos(2xy + b)
 * Точка прыгает по нему миллионы раз, и накапливается не картинка, а
 * плотность попаданий: сколько раз траектория прошла через каждый пиксель.
 * Отсюда и название — светится то, где орбита бывает чаще, и глаз проявляется
 * сам, как на фотопластинке.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

interface Preset {
  n: string;
  a: number;
  b: number;
}

const PRESETS: Preset[] = [
  { n: 'IRIS', a: 0.4, b: 1.6 },
  { n: 'BLOOM', a: 0.4, b: -1.6 },
  { n: 'STORM', a: -2.6, b: -2.2 },
  { n: 'HALO', a: 2.8, b: 2.4 },
  { n: 'DRIFT', a: 0.6, b: 1.0 },
];

// Цветовая шкала: индиго → фиолет → магента → роза → янтарь → тёплый белый.
const STOPS: number[][] = [
  [0.0, 0.1, 0.06, 0.28],
  [0.22, 0.36, 0.13, 0.55],
  [0.45, 0.66, 0.18, 0.62],
  [0.65, 0.9, 0.3, 0.52],
  [0.82, 1.0, 0.55, 0.25],
  [1.0, 1.0, 0.85, 0.6],
];

const CAP = 48e6; // сколько итераций считать полной выдержкой
const BATCH = 220_000; // шаг накопления в статике
const BATCH_GAZE = 170_000; // в режиме взгляда — меньше, кадр должен успевать
const DECAY = 0.88; // затухание следа, чтобы взгляд оставлял шлейф
const RA = 0.85;
const RB = 1.05;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function buildLut(): Float32Array {
  const lut = new Float32Array(256 * 3);
  for (let i = 0; i < 256; i += 1) {
    const t = i / 255;
    let k = 0;
    while (k < STOPS.length - 2 && t > STOPS[k + 1][0]) k += 1;
    const p0 = STOPS[k];
    const p1 = STOPS[k + 1];
    const f = clamp((t - p0[0]) / (p1[0] - p0[0]), 0, 1);
    lut[i * 3] = p0[1] + (p1[1] - p0[1]) * f;
    lut[i * 3 + 1] = p0[2] + (p1[2] - p0[2]) * f;
    lut[i * 3 + 2] = p0[3] + (p1[3] - p0[3]) * f;
  }
  return lut;
}

export default function DensityEye() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const reticleRef = useRef<HTMLDivElement | null>(null);

  const [anchorA, setAnchorA] = useState(0.4);
  const [anchorB, setAnchorB] = useState(1.6);
  const [exposure, setExposure] = useState(1.05);
  const [gaze, setGaze] = useState(false);
  const [tel, setTel] = useState({ a: 0.4, b: 1.6, iters: 0, peak: 0, state: 'DEVELOPING' });

  // Всё, что меняется каждый кадр, живёт здесь и мимо React.
  const engine = useRef({
    W: 0, H: 0, s: 0, cx: 0, cy: 0,
    dens: null as Float32Array | null,
    vsum: null as Float32Array | null,
    img: null as ImageData | null,
    toneMax: 1, covered: 0, iters: 0,
    x: 0.1, y: 0.1,
    a: 0.4, b: 1.6,
    anchorA: 0.4, anchorB: 1.6,
    exposure: 1.05,
    gaze: false,
    offA: 0, offB: 0,
    pointerActive: false, lastMove: 0,
    raf: 0, running: false,
    lut: buildLut(),
    reduceMotion: false,
  });

  useEffect(() => { engine.current.anchorA = anchorA; }, [anchorA]);
  useEffect(() => { engine.current.anchorB = anchorB; }, [anchorB]);
  useEffect(() => { engine.current.exposure = exposure; }, [exposure]);

  const sizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (!canvas || !stage) return;
    const e = engine.current;
    const rect = stage.getBoundingClientRect();
    let cw = Math.max(2, Math.round(rect.width));
    let ch = Math.max(2, Math.round(rect.height));
    // Потолок в 1400 px по длинной стороне: холст на ретине вчетверо больше по
    // числу пикселей, и на телефоне полный размер съедает кадр целиком.
    const cap = 1400;
    const lng = Math.max(cw, ch);
    if (lng > cap) {
      const k = cap / lng;
      cw = Math.round(cw * k);
      ch = Math.round(ch * k);
    }
    e.W = cw; e.H = ch;
    canvas.width = cw; canvas.height = ch;
    e.s = (Math.min(cw, ch) / 2) * 0.9;
    e.cx = cw / 2; e.cy = ch / 2;
    e.dens = new Float32Array(cw * ch);
    e.vsum = new Float32Array(cw * ch);
    const ctx = canvas.getContext('2d', { alpha: false });
    if (ctx) e.img = ctx.createImageData(cw, ch);
  }, []);

  const clearField = useCallback(() => {
    const e = engine.current;
    e.dens?.fill(0);
    e.vsum?.fill(0);
    e.toneMax = 1;
    e.iters = 0;
    e.x = (Math.random() * 2 - 1) * 0.5;
    e.y = (Math.random() * 2 - 1) * 0.5;
    // Сорок холостых шагов: первые точки ещё не на аттракторе и оставили бы
    // случайный след в плотности.
    for (let i = 0; i < 40; i += 1) {
      const nx = Math.sin(e.x * e.x - e.y * e.y + e.a);
      const ny = Math.cos(2 * e.x * e.y + e.b);
      e.x = nx; e.y = ny;
    }
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (!canvas || !stage) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;
    const e = engine.current;
    e.reduceMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

    function accumulate(n: number) {
      const { dens, vsum } = e;
      if (!dens || !vsum) return;
      let px0 = e.x;
      let py0 = e.y;
      for (let i = 0; i < n; i += 1) {
        const nx = Math.sin(px0 * px0 - py0 * py0 + e.a);
        const ny = Math.cos(2 * px0 * py0 + e.b);
        const dx = nx - px0;
        const dy = ny - py0;
        const v = Math.sqrt(dx * dx + dy * dy);
        const px = (e.cx + nx * e.s) | 0;
        const py = (e.cy + ny * e.s) | 0;
        if (px >= 0 && px < e.W && py >= 0 && py < e.H) {
          const idx = py * e.W + px;
          dens[idx] += 1;
          // Копим ещё и длину прыжка: по ней потом красим — медленные участки
          // орбиты выходят холодными, быстрые тёплыми.
          vsum[idx] += v;
        }
        px0 = nx; py0 = ny;
      }
      e.x = px0; e.y = py0; e.iters += n;
    }

    function render() {
      const { dens, vsum, img, lut } = e;
      if (!dens || !vsum || !img) return;
      const buf = img.data;
      const lg = 1 / Math.log(1 + e.toneMax);
      const invG = 1 / 2.2;
      let nm = 1;
      let cov = 0;
      for (let i = 0, o = 0; i < dens.length; i += 1, o += 4) {
        const d = dens[i];
        if (d > 1e-4) {
          if (d > nm) nm = d;
          cov += 1;
          // Логарифм с гаммой: плотность в центре на порядки выше краёв, и
          // линейная шкала показала бы белое пятно на чёрном.
          let t = Math.pow(Math.log(1 + d) * lg, invG) * e.exposure;
          t = t > 1 ? 1 : t < 0 ? 0 : t;
          const av = vsum[i] / d;
          let vn = (av - 0.2) / 0.95;
          vn = vn < 0 ? 0 : vn > 1 ? 1 : vn;
          const c = ((vn * 255) | 0) * 3;
          const wht = t * t * t * t * 0.9;
          const r = 10 / 255 + lut[c] * t + wht;
          const g = 8 / 255 + lut[c + 1] * t + wht;
          const bl = 18 / 255 + lut[c + 2] * t + wht;
          buf[o] = r > 1 ? 255 : (r * 255) | 0;
          buf[o + 1] = g > 1 ? 255 : (g * 255) | 0;
          buf[o + 2] = bl > 1 ? 255 : (bl * 255) | 0;
        } else {
          buf[o] = 10; buf[o + 1] = 8; buf[o + 2] = 18;
        }
        buf[o + 3] = 255;
      }
      ctx!.putImageData(img, 0, 0);
      e.toneMax = nm;
      e.covered = cov;
    }

    function updateGaze() {
      const now = performance.now();
      if (!(e.pointerActive && now - e.lastMove < 650)) {
        e.pointerActive = false;
        if (reticleRef.current) reticleRef.current.style.opacity = '0';
        if (e.reduceMotion) {
          e.offA *= 0.94; e.offB *= 0.94;
        } else {
          const t = now / 1000;
          e.offA = Math.sin(t * 0.13) * RA * 0.82;
          e.offB = Math.sin(t * 0.097 + 1.6) * RB * 0.82;
        }
      }
      e.a = clamp(e.anchorA + e.offA, -3.5, 3.5);
      e.b = clamp(e.anchorB + e.offB, -3.5, 3.5);
    }

    let telTick = 0;
    function frame() {
      if (e.gaze) {
        updateGaze();
        const { dens, vsum } = e;
        if (dens && vsum) {
          for (let i = 0; i < dens.length; i += 1) { dens[i] *= DECAY; vsum[i] *= DECAY; }
        }
        accumulate(BATCH_GAZE);
      } else if (e.iters < CAP) {
        accumulate(BATCH);
      }
      render();

      // Телеметрию отдаём в React втрое реже кадров: цифры глазом всё равно
      // не читаются быстрее, а каждый setState — это перерисовка.
      telTick += 1;
      if (telTick % 3 === 0) {
        const dead = e.dens ? e.covered < e.dens.length * 0.004 : false;
        let state: string;
        if (e.gaze) state = dead ? 'COLLAPSED' : e.pointerActive ? 'GAZE·TRACK' : 'GAZE·DRIFT';
        else if (e.iters >= CAP) state = 'COMPLETE';
        else state = e.iters > 1.5e6 && dead ? 'COLLAPSED' : 'DEVELOPING';
        setTel({ a: e.a, b: e.b, iters: e.iters, peak: Math.round(e.toneMax), state });
      }

      if (!e.gaze && e.iters >= CAP) { e.running = false; e.raf = 0; return; }
      e.raf = requestAnimationFrame(frame);
    }

    function start() {
      if (!e.running) { e.running = true; e.raf = requestAnimationFrame(frame); }
    }

    function reset() {
      if (e.raf) cancelAnimationFrame(e.raf);
      e.raf = 0; e.running = false;
      e.a = e.anchorA; e.b = e.anchorB;
      clearField(); start();
    }

    sizeCanvas();
    reset();
    (engine.current as unknown as { reset?: () => void }).reset = reset;
    (engine.current as unknown as { start?: () => void }).start = start;

    let resizeTimer = 0;
    const onResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        sizeCanvas();
        if (e.gaze) { clearField(); start(); } else reset();
      }, 160);
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      clearTimeout(resizeTimer);
      if (e.raf) cancelAnimationFrame(e.raf);
      e.running = false;
    };
  }, [sizeCanvas, clearField]);

  // Смена якоря: в статике пересобираем выдержку, во взгляде просто едем дальше.
  useEffect(() => {
    const e = engine.current as unknown as { reset?: () => void; start?: () => void; gaze: boolean };
    if (e.gaze) e.start?.();
    else e.reset?.();
  }, [anchorA, anchorB]);

  useEffect(() => {
    const e = engine.current as unknown as { reset?: () => void; start?: () => void; gaze: boolean; offA: number; offB: number };
    e.gaze = gaze;
    if (gaze) e.start?.();
    else { e.offA = 0; e.offB = 0; e.reset?.(); }
  }, [gaze]);

  function onPointerMove(ev: React.PointerEvent<HTMLDivElement>) {
    const e = engine.current;
    if (!e.gaze) return;
    const stage = stageRef.current;
    const reticle = reticleRef.current;
    if (!stage) return;
    const r = stage.getBoundingClientRect();
    e.offA = ((ev.clientX - r.left) / r.width * 2 - 1) * RA;
    e.offB = -((ev.clientY - r.top) / r.height * 2 - 1) * RB;
    e.pointerActive = true;
    e.lastMove = performance.now();
    if (reticle) {
      reticle.style.opacity = '1';
      reticle.style.left = `${ev.clientX - r.left}px`;
      reticle.style.top = `${ev.clientY - r.top}px`;
    }
  }

  function savePng() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = `eye_a${tel.a.toFixed(2)}_b${tel.b.toFixed(2)}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  }

  function randomize() {
    const p = PRESETS[(Math.random() * PRESETS.length) | 0];
    setAnchorA(clamp(p.a + (Math.random() * 2 - 1) * 0.5, -3.5, 3.5));
    setAnchorB(clamp(p.b + (Math.random() * 2 - 1) * 0.5, -3.5, 3.5));
  }

  const fmt = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(0)}K` : `${n | 0}`);
  const stateColor =
    tel.state === 'COMPLETE' || tel.state.startsWith('GAZE') ? '#ff9a4d'
      : tel.state === 'COLLAPSED' ? '#e0607a' : '#8b83c9';

  return (
    <div className="flex h-[100dvh] min-h-screen flex-col bg-[#08070e] font-mono text-[#d9d4ec]">
      <div
        ref={stageRef}
        onPointerMove={onPointerMove}
        onPointerLeave={() => { engine.current.pointerActive = false; if (reticleRef.current) reticleRef.current.style.opacity = '0'; }}
        className={`relative min-h-0 flex-1 overflow-hidden touch-none ${gaze ? 'cursor-crosshair' : ''}`}
      >
        <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" />
        <div
          className="pointer-events-none absolute inset-0"
          style={{ background: 'radial-gradient(120% 100% at 50% 46%,transparent 45%,rgba(0,0,0,.55) 100%)' }}
        />
        <div className="pointer-events-none absolute inset-[10px] rounded-[14px] border border-[rgba(139,131,201,0.16)]" />
        <div
          ref={reticleRef}
          className="reticle pointer-events-none absolute left-0 top-0 h-[52px] w-[52px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-[rgba(255,154,77,0.75)] opacity-0 mix-blend-screen transition-opacity duration-200"
        >
          {/* Перекрестие обычными элементами, а не псевдоэлементами styled-jsx:
              тот ломал production-сборку страницы при пререндере. */}
          <span className="absolute left-1/2 -top-[9px] -bottom-[9px] w-px -translate-x-1/2 bg-[rgba(255,154,77,0.7)]" />
          <span className="absolute top-1/2 -left-[9px] -right-[9px] h-px -translate-y-1/2 bg-[rgba(255,154,77,0.7)]" />
        </div>

        <div className="pointer-events-none absolute left-[30px] top-[26px] text-[11px] leading-[1.55] text-[#8b83c9]">
          <div>x<sub>n+1</sub> = sin(x² − y² + a)</div>
          <div>y<sub>n+1</sub> = cos(2xy + b)</div>
        </div>

        <div className="pointer-events-none absolute right-8 top-6 text-right">
          <div className="text-[clamp(15px,1.9vw,20px)] font-extralight tracking-[0.62em] text-[#d9d4ec]">EYE</div>
          <div className="mt-1 text-[10px] tracking-[0.34em] text-[#8983a8]">ПРОЕКЦИЯ ПЛОТНОСТИ</div>
        </div>

        <div className="pointer-events-none absolute bottom-6 left-[30px] flex flex-col gap-[7px] text-[10.5px] uppercase tracking-[0.14em] text-[#8983a8]">
          <div className="flex items-baseline gap-2">
            <span>A</span><span className="min-w-[2.6em] tabular-nums text-[#d9d4ec]">{tel.a.toFixed(2)}</span>
            <span>B</span><span className="min-w-[2.6em] tabular-nums text-[#d9d4ec]">{tel.b.toFixed(2)}</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span>Шагов</span><span className="min-w-[2.6em] tabular-nums text-[#d9d4ec]">{fmt(tel.iters)}</span>
            <span>Пик</span><span className="min-w-[2.6em] tabular-nums text-[#d9d4ec]">{fmt(tel.peak)}</span>
          </div>
          <div className="tracking-[0.28em]" style={{ color: stateColor }}>{tel.state}</div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-4 border-t border-[rgba(139,131,201,0.18)] bg-[#0c0a14] px-4 py-3.5 sm:px-8">
        <div className="flex flex-wrap gap-[7px]">
          {PRESETS.map((p) => {
            const active = Math.abs(p.a - anchorA) < 1e-6 && Math.abs(p.b - anchorB) < 1e-6;
            return (
              <button
                key={p.n}
                type="button"
                aria-pressed={active}
                onClick={() => { setAnchorA(p.a); setAnchorB(p.b); }}
                className={`rounded-sm border px-3 py-[7px] text-[10px] uppercase tracking-[0.22em] transition ${
                  active
                    ? 'border-[#8b83c9] bg-[#8b83c9] text-[#08070e]'
                    : 'border-[rgba(139,131,201,0.28)] text-[#8983a8] hover:border-[#8b83c9] hover:text-[#d9d4ec]'
                }`}
              >
                {p.n}
              </button>
            );
          })}
        </div>

        <div className="flex min-w-0 flex-1 flex-wrap gap-x-6 gap-y-4">
          {([
            ['A', anchorA, setAnchorA, -3.5, 3.5, 0.01],
            ['B', anchorB, setAnchorB, -3.5, 3.5, 0.01],
            ['Выдержка', exposure, setExposure, 0.4, 2.2, 0.01],
          ] as const).map(([label, value, setter, min, max, step]) => (
            <label key={label} className="flex items-center gap-2.5 whitespace-nowrap text-[10px] uppercase tracking-[0.2em] text-[#8983a8]">
              {label}
              <input
                type="range"
                min={min}
                max={max}
                step={step}
                value={value}
                onChange={(ev) => setter(Number(ev.target.value))}
                className="h-0.5 w-[clamp(84px,13vw,160px)] cursor-pointer accent-[#8b83c9]"
              />
              <output className="min-w-[3.1em] text-[11px] tabular-nums text-[#d9d4ec]">{value.toFixed(2)}</output>
            </label>
          ))}
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            aria-pressed={gaze}
            onClick={() => setGaze((v) => !v)}
            className={`rounded-sm border px-3.5 py-2 text-[10px] uppercase tracking-[0.22em] transition ${
              gaze
                ? 'border-[#ff9a4d] bg-[#ff9a4d] font-semibold text-[#08070e]'
                : 'border-[rgba(139,131,201,0.28)] text-[#8983a8] hover:border-[#8b83c9] hover:text-[#d9d4ec]'
            }`}
          >
            Взгляд
          </button>
          <button
            type="button"
            onClick={randomize}
            className="rounded-sm border border-[rgba(139,131,201,0.28)] px-3.5 py-2 text-[10px] uppercase tracking-[0.22em] text-[#8983a8] transition hover:border-[#8b83c9] hover:text-[#d9d4ec]"
          >
            Случайно
          </button>
          <button
            type="button"
            onClick={savePng}
            className="rounded-sm border border-[#ff9a4d] bg-[#ff9a4d] px-3.5 py-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-[#08070e] transition hover:brightness-110"
          >
            Сохранить PNG
          </button>
        </div>
      </div>


    </div>
  );
}
