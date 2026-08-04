'use client';

import { useEffect, useRef, useState } from 'react';
import './vision.css';
import { IDLE_SIGNAL, type QuantumSignal } from '@/components/hud/QuantumEyes';
import { useEfirSignal, VISION_BANDS } from '@/hooks/use-efir-signal';

// ── Ядро MAX VISION ──────────────────────────────────────────────────────────
// Визуализация звука через эфир: жидкое чернильное цветение в духе TouchDesigner.
// Спектр голоса раскладывается радиально в «цветок» — каждая частотная полоса
// рождает поток частиц в свою сторону. Частицы текут по curl-полю, аддитивно
// светятся и оставляют следы; обратная связь (feedback-zoom) размазывает кадр,
// давая текучий дым. Палитра синь→фиолет→розовый→белое.
//   • спектр по ln f (как в слухе)   • затухание следа  свет ∝ e^(−t/τ)
//   • бас раздувает ядро  R ∝ e^(bass)  • верх крутит и турбулит поле

const E = 2.718281828459045;
const N = 6000; // пул частиц
const TWO_PI = Math.PI * 2;

const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const expE = (x: number) => Math.pow(E, x);

export default function MaxVision() {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const signalRef = useRef<QuantumSignal>({ ...IDLE_SIGNAL });
  const { listening, status, start, stop, spectrumRef } = useEfirSignal(signalRef);
  const [hud, setHud] = useState({ bass: 0, mid: 0, treble: 0, f0: 0, alive: 0 });

  const sim = useRef({
    px: new Float32Array(N),
    py: new Float32Array(N),
    vx: new Float32Array(N),
    vy: new Float32Array(N),
    born: new Float32Array(N).fill(-1e9),
    life: new Float32Array(N),
    hue: new Float32Array(N),
    sat: new Float32Array(N),
    cursor: 0,
    t: 0,
    rot: 0,
    w: 0,
    h: 0,
    dpr: 1,
    pointer: { x: 0, y: 0, active: false },
  });

  const resize = () => {
    const wrap = wrapRef.current;
    const cv = canvasRef.current;
    if (!wrap || !cv) return;
    const s = sim.current;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    s.w = wrap.clientWidth;
    s.h = wrap.clientHeight;
    s.dpr = dpr;
    cv.width = Math.round(s.w * dpr);
    cv.height = Math.round(s.h * dpr);
    cv.style.width = `${s.w}px`;
    cv.style.height = `${s.h}px`;
  };

  useEffect(() => {
    resize();
    window.addEventListener('resize', resize);
    const cv = canvasRef.current;
    const ctx = cv?.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    let last = 0;
    let hudAcc = 0;

    // curl-подобное поле течения: слои синусов дают органический завиток
    const flow = (x: number, y: number, t: number, turb: number) => {
      const a =
        Math.sin(x * 0.0016 + t * 0.15) +
        Math.cos(y * 0.0016 - t * 0.19) +
        Math.sin((x + y) * 0.0012 + t * 0.11);
      const ang = a * Math.PI * (0.7 + turb);
      return { fx: Math.cos(ang), fy: Math.sin(ang) };
    };

    // частота полосы → оттенок: низ — синий, верх — розовый/белый
    const bandHue = (bf: number) => lerp(212, 322, bf);

    const emit = (i: number, now: number, x: number, y: number, vx: number, vy: number, hue: number, sat: number, life: number) => {
      const s = sim.current;
      s.px[i] = x;
      s.py[i] = y;
      s.vx[i] = vx;
      s.vy[i] = vy;
      s.hue[i] = hue;
      s.sat[i] = sat;
      s.life[i] = life;
      s.born[i] = now;
    };

    const loop = (ts: number) => {
      const s = sim.current;
      const dt = last ? clamp((ts - last) / 1000, 0, 0.05) : 0.016;
      last = ts;
      s.t += dt;
      const now = s.t;
      const sig = signalRef.current;
      const spec = spectrumRef.current;

      // полосы энергии
      let bass = 0;
      let mid = 0;
      let treble = 0;
      const bEnd = Math.floor(VISION_BANDS * 0.18);
      const mEnd = Math.floor(VISION_BANDS * 0.55);
      for (let b = 0; b < VISION_BANDS; b++) {
        if (b < bEnd) bass += spec[b];
        else if (b < mEnd) mid += spec[b];
        else treble += spec[b];
      }
      bass = clamp(bass / Math.max(1, bEnd));
      mid = clamp(mid / Math.max(1, mEnd - bEnd));
      treble = clamp(treble / Math.max(1, VISION_BANDS - mEnd));

      const { w, h, dpr } = s;
      const cx = w / 2;
      const cy = h / 2;
      s.rot += (0.05 + treble * 0.6) * dt;

      // ЭМИССИЯ: спектр раскладывается радиально в цветок
      const activeIdle = !sig.voiced && bass + mid + treble < 0.02;
      const r0 = Math.min(w, h) * (0.05 + bass * 0.06);
      for (let b = 0; b < VISION_BANDS; b++) {
        const bf = b / VISION_BANDS;
        const eb = spec[b];
        // сколько частиц выпустить из этой полосы (∝ её энергии)
        const count = eb > 0.04 ? 1 + Math.floor(eb * 5) : 0;
        for (let k = 0; k < count; k++) {
          const ang = bf * TWO_PI + s.rot + (Math.random() - 0.5) * 0.25;
          const speed = 30 + eb * 300 * (0.7 + Math.random() * 0.6);
          const jitter = (Math.random() - 0.5) * 0.4;
          const ux = Math.cos(ang + jitter);
          const uy = Math.sin(ang + jitter);
          const hue = bandHue(bf) + (Math.random() - 0.5) * 12;
          const sat = clamp(1 - eb * 0.7); // громче — белее (к центру спектра)
          const life = (0.6 + eb * 1.6) * (0.8 + Math.random() * 0.5);
          emit(s.cursor, now, cx + ux * r0, cy + uy * r0, ux * speed, uy * speed, hue, sat, life);
          s.cursor = (s.cursor + 1) % N;
        }
      }

      // палец рисует светом
      if (s.pointer.active) {
        for (let k = 0; k < 6; k++) {
          const ang = Math.random() * TWO_PI;
          const sp = 30 + Math.random() * 120;
          emit(s.cursor, now, s.pointer.x, s.pointer.y, Math.cos(ang) * sp, Math.sin(ang) * sp, 210 + Math.random() * 120, 0.25, 1.0 + Math.random());
          s.cursor = (s.cursor + 1) % N;
        }
      }

      // фоновое дыхание в тишине, чтобы кадр жил
      if (activeIdle && Math.random() < 0.5) {
        const ang = Math.random() * TWO_PI;
        emit(s.cursor, now, cx, cy, Math.cos(ang) * 40, Math.sin(ang) * 40, 220 + Math.random() * 80, 0.5, 1.4);
        s.cursor = (s.cursor + 1) % N;
      }

      // ── рендер с обратной связью ──
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // затухание кадра
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(3,4,16,0.09)';
      ctx.fillRect(0, 0, w, h);
      // feedback-zoom: размазываем предыдущий кадр наружу → текучий дым
      const zoom = 1.004 + bass * 0.02;
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.translate(cx, cy);
      ctx.rotate((treble - 0.5) * 0.006);
      ctx.scale(zoom, zoom);
      ctx.translate(-cx, -cy);
      ctx.drawImage(cv, 0, 0, w, h);
      ctx.restore();
      ctx.globalAlpha = 1;

      // ядро-свечение (бас раздувает: R ∝ e^bass)
      const coreR = Math.min(w, h) * 0.05 * expE(bass * 1.1);
      const coreGlow = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR * 2.4);
      coreGlow.addColorStop(0, `hsla(260,100%,85%,${0.1 + bass * 0.5})`);
      coreGlow.addColorStop(0.5, `hsla(220,100%,65%,${0.06 + bass * 0.2})`);
      coreGlow.addColorStop(1, 'hsla(220,100%,60%,0)');
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = coreGlow;
      ctx.fillRect(cx - coreR * 2.4, cy - coreR * 2.4, coreR * 4.8, coreR * 4.8);

      // частицы
      const turb = treble * 1.2;
      let alive = 0;
      for (let i = 0; i < N; i++) {
        const born = s.born[i];
        if (born < 0) continue;
        const age = now - born;
        const life = s.life[i];
        const decay = expE(-age / life); // e^(−t/τ)
        if (decay < 0.05) {
          s.born[i] = -1e9;
          continue;
        }
        alive++;

        const f = flow(s.px[i], s.py[i], now, turb);
        // ускорение полем + лёгкий радиальный отток от баса
        s.vx[i] = s.vx[i] * 0.94 + f.fx * 60 * dt;
        s.vy[i] = s.vy[i] * 0.94 + f.fy * 60 * dt;
        s.px[i] += s.vx[i] * dt;
        s.py[i] += s.vy[i] * dt;

        const px = s.px[i];
        const py = s.py[i];
        if (px < -20 || px > w + 20 || py < -20 || py > h + 20) {
          s.born[i] = -1e9;
          continue;
        }
        const sp = Math.hypot(s.vx[i], s.vy[i]);
        const light = clamp(0.5 + sp / 400 + (1 - s.sat[i]) * 0.4, 0, 0.98);
        const alpha = decay * (0.22 + (1 - s.sat[i]) * 0.3);
        const size = 1 + decay * 2.2;
        ctx.fillStyle = `hsla(${s.hue[i]}, ${Math.round(s.sat[i] * 90 + 10)}%, ${Math.round(light * 100)}%, ${alpha})`;
        ctx.fillRect(px, py, size, size);
      }
      ctx.globalCompositeOperation = 'source-over';

      hudAcc += dt;
      if (hudAcc >= 0.2) {
        hudAcc = 0;
        setHud({ bass, mid, treble, f0: Math.round(sig.f0), alive });
      }

      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, [spectrumRef]);

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const s = sim.current;
    s.pointer = { x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY, active: true };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const s = sim.current;
    if (!s.pointer.active) return;
    s.pointer.x = e.nativeEvent.offsetX;
    s.pointer.y = e.nativeEvent.offsetY;
  };
  const onUp = () => {
    sim.current.pointer.active = false;
  };

  return (
    <div ref={wrapRef} className="mv-screen">
      <div className="mv-bar">
        <span className="mv-logo">◈</span>
        <div>
          <div className="mv-title">MAX VISION</div>
          <div className="mv-sub">визуализация звука через эфир · спектр ∝ ln f · свет ∝ e^(−t/τ)</div>
        </div>
        <button type="button" className={`mv-mic ${listening ? 'on' : ''}`} onClick={listening ? stop : start}>
          {listening ? '⏹ Закрыть' : '🎙 Впустить звук'}
        </button>
      </div>

      <canvas
        ref={canvasRef}
        className="mv-canvas"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerLeave={onUp}
      />

      {/* спектр-лента */}
      <div className="mv-spectrum" aria-hidden>
        <SpectrumBars spectrumRef={spectrumRef} />
      </div>

      <div className="mv-panel">
        <Meter label="Бас" v={hud.bass} c="#3b6bff" />
        <Meter label="Середина" v={hud.mid} c="#a06bff" />
        <Meter label="Верх" v={hud.treble} c="#ff7be0" />
        <div className="mv-row">
          <span>Тон f0</span>
          <b>{hud.f0 ? `${hud.f0} Гц` : '—'}</b>
        </div>
        <div className="mv-row">
          <span>Частиц в свете</span>
          <b className="mv-accent">{hud.alive}</b>
        </div>
      </div>

      <div className="mv-foot">{status} &nbsp;·&nbsp; каждая частотная полоса — лепесток; веди пальцем — рисуй светом</div>
    </div>
  );
}

// Живая спектр-лента снизу — читает spectrumRef напрямую своим RAF.
function SpectrumBars({ spectrumRef }: { spectrumRef: React.MutableRefObject<Float32Array> }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const cv = ref.current;
    const ctx = cv?.getContext('2d');
    if (!cv || !ctx) return;
    let raf = 0;
    const draw = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = cv.clientWidth;
      const h = cv.clientHeight;
      if (cv.width !== w * dpr || cv.height !== h * dpr) {
        cv.width = w * dpr;
        cv.height = h * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const spec = spectrumRef.current;
      const n = spec.length;
      const bw = w / n;
      for (let i = 0; i < n; i++) {
        const v = spec[i];
        const bh = v * h;
        const hue = 212 + (i / n) * 110;
        ctx.fillStyle = `hsla(${hue}, 90%, ${50 + v * 30}%, ${0.35 + v * 0.6})`;
        ctx.fillRect(i * bw, h - bh, Math.max(1, bw - 1), bh);
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [spectrumRef]);
  return <canvas ref={ref} className="mv-spectrum-cv" />;
}

function Meter({ label, v, c }: { label: string; v: number; c: string }) {
  return (
    <div className="mv-meter">
      <div className="mv-meter-head">
        <span>{label}</span>
        <span>{Math.round(v * 100)}%</span>
      </div>
      <div className="mv-meter-track">
        <div className="mv-meter-fill" style={{ width: `${Math.round(v * 100)}%`, background: c, boxShadow: `0 0 8px ${c}` }} />
      </div>
    </div>
  );
}
