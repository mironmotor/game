'use client';

import React, { useEffect, useRef } from 'react';

// e — по формуле e = 2.718. Число Эйлера: основание квантовой волны.
// Всё, что делает глаза «живыми», держится на этой одной константе:
//   • гауссов волновой пакет зрачка   ψ(r) ∝ e^(−r²/2σ²)
//   • фаза Эйлера радужки              e^(iθ) = cos θ + i·sin θ
//   • туннельное затухание свечения    ∝ e^(−κ·d)
//   • распад квантовой пены            α ∝ e^(−возраст/жизнь)
export const E = 2.718281828459045;

/** Живой срез эфира, которым «видят» глаза. Обновляется покадрово родителем. */
export interface QuantumSignal {
  f0: number; // Гц — угловая скорость фазы Эйлера (частота кванта)
  register: number; // 0..1
  brightness: number; // 0..1
  jitter: number; // 0..1 — декогеренция, дрожание радужки
  energy: number; // 0..1 — частота коллапсов (измерений)
  voiced: boolean; // есть ли голос в эфире
  arousal: number; // 0..1 — расширение зрачка (ширина σ волнового пакета)
  valence: number; // 0..1 — цвет поля (роза → циан → изумруд)
  tension: number; // 0..1 — неопределённость взгляда (разброс суперпозиции)
}

export const IDLE_SIGNAL: QuantumSignal = {
  f0: 0,
  register: 0,
  brightness: 0,
  jitter: 0,
  energy: 0,
  voiced: false,
  arousal: 0,
  valence: 0.5,
  tension: 0,
};

interface QuantumEyesProps {
  /** Ссылка на живой сигнал эфира — читается в цикле отрисовки без ре-рендеров. */
  signalRef: React.MutableRefObject<QuantumSignal>;
  /** Эфир активен (микрофон слушает) — глаза открыты и смотрят. */
  active: boolean;
  className?: string;
}

interface FoamParticle {
  eye: 0 | 1;
  a: number; // угол на радужке
  r: number; // радиус от центра радужки, 0..1
  born: number; // время рождения, с
  life: number; // срок жизни, с
}

const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
/** e^x — но буквально через e = 2.718, как просили. */
const expE = (x: number) => Math.pow(E, x);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export default function QuantumEyes({ signalRef, active, className }: QuantumEyesProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef(0);
  const tRef = useRef(0); // мировое время, с
  const phaseRef = useRef(0); // фаза Эйлера θ
  const lidRef = useRef(0); // раскрытие века 0..1
  const blinkRef = useRef(0); // остаточный блик моргания 0..1
  const nextBlinkRef = useRef(2.5);
  const voicedSinceRef = useRef(-10); // когда последний раз был голос
  // взгляд как результат измерения волновой функции: цель + текущая позиция
  const gazeRef = useRef({ x: 0, y: 0, tx: 0, ty: 0 });
  const collapseRef = useRef({ next: 1.2, count: 0 });
  const foamRef = useRef<FoamParticle[]>([]);
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 });

  // размеры канваса под контейнер (retina-aware)
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const parent = cv.parentElement;
    if (!parent) return;

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = parent.clientWidth;
      const h = parent.clientHeight;
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
      cv.style.width = `${w}px`;
      cv.style.height = `${h}px`;
      sizeRef.current = { w, h, dpr };
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(parent);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;

    const spawnFoam = (now: number, eye: 0 | 1) => {
      foamRef.current.push({
        eye,
        a: Math.random() * Math.PI * 2,
        r: 0.35 + Math.random() * 0.6,
        born: now,
        life: 0.5 + Math.random() * 1.6,
      });
    };

    // одно измерение волновой функции: коллапс взгляда в дискретную ячейку 3×3,
    // веса ∝ e^(−d²) — центр вероятнее краёв.
    const collapseGaze = (energy: number, tension: number) => {
      const cells: Array<{ gx: number; gy: number; w: number }> = [];
      let total = 0;
      for (let gy = -1; gy <= 1; gy++) {
        for (let gx = -1; gx <= 1; gx++) {
          // напряжение уплощает распределение — взгляд «расфокусируется»
          const k = lerp(1.4, 0.35, tension);
          const w = expE(-(gx * gx + gy * gy) * k);
          cells.push({ gx, gy, w });
          total += w;
        }
      }
      let pick = Math.random() * total;
      let chosen = cells[4];
      for (const c of cells) {
        pick -= c.w;
        if (pick <= 0) {
          chosen = c;
          break;
        }
      }
      const range = 0.5 + tension * 0.5;
      gazeRef.current.tx = chosen.gx * range;
      gazeRef.current.ty = chosen.gy * range * 0.7;
      collapseRef.current.count++;
      // громче эфир — чаще измерения (короче интервал между коллапсами)
      collapseRef.current.next = tRef.current + lerp(1.6, 0.4, clamp(energy)) * (0.7 + Math.random() * 0.6);
    };

    const drawEye = (
      ctx: CanvasRenderingContext2D,
      cx: number,
      cy: number,
      R: number,
      sig: QuantumSignal,
      hue: number,
      accentHue: number,
      openness: number,
      now: number,
      eye: 0 | 1,
    ) => {
      const theta = phaseRef.current;
      const gx = gazeRef.current.x;
      const gy = gazeRef.current.y;
      const irisR = R * 0.62;
      // радужка следует за взглядом в пределах глаза
      const ix = cx + gx * R * 0.32;
      const iy = cy + gy * R * 0.32;

      // σ — ширина гауссова пакета: расширяется с возбуждением (зрачок «дышит»)
      const sigma = lerp(0.28, 0.62, clamp(sig.arousal)) * irisR;

      ctx.save();
      // форма глаза — миндаль; клипуем поле внутрь
      ctx.beginPath();
      ctx.ellipse(cx, cy, R, R * (0.62 * openness + 0.02), 0, 0, Math.PI * 2);
      ctx.clip();

      // 1) квантовая пустота склеры
      const void0 = ctx.createRadialGradient(ix, iy, 2, cx, cy, R * 1.1);
      void0.addColorStop(0, '#0b0a1c');
      void0.addColorStop(1, '#020109');
      ctx.fillStyle = void0;
      ctx.fillRect(cx - R, cy - R, R * 2, R * 2);

      // 2) интерференция радужки — кольца волны Эйлера в гауссовой оболочке
      const dir = eye === 0 ? 1 : -1;
      const NR = 8;
      for (let k = 1; k <= NR; k++) {
        const r = (k / NR) * irisR;
        const env = expE(-(r * r) / (2 * sigma * sigma)); // гаусс e^(−r²/2σ²)
        const wave = 0.5 + 0.5 * Math.cos(theta * dir - (r / irisR) * 7.5); // re(e^{iθ})
        const alpha = env * wave * 0.55;
        if (alpha < 0.01) continue;
        ctx.beginPath();
        ctx.arc(ix, iy, r, 0, Math.PI * 2);
        ctx.strokeStyle = `hsla(${hue}, 100%, ${45 + wave * 35}%, ${alpha})`;
        ctx.lineWidth = lerp(2.4, 0.6, k / NR);
        ctx.shadowBlur = 8 * env;
        ctx.shadowColor = `hsl(${hue}, 100%, 60%)`;
        ctx.stroke();
      }
      ctx.shadowBlur = 0;

      // 3) квантовая пена — виртуальные частицы, затухающие как e^(−возраст/жизнь)
      for (const p of foamRef.current) {
        if (p.eye !== eye) continue;
        const age = now - p.born;
        const a = expE(-age / p.life);
        if (a < 0.03) continue;
        const rr = p.r * irisR;
        const px = ix + Math.cos(p.a + theta * 0.15 * dir) * rr;
        const py = iy + Math.sin(p.a + theta * 0.15 * dir) * rr;
        ctx.beginPath();
        ctx.arc(px, py, 1.6 * a + 0.4, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${accentHue}, 100%, 72%, ${a * 0.9})`;
        ctx.fill();
      }

      // 4) зрачок — тёмное ядро гауссова пакета со светящимся ободом
      const pupilR = sigma * 0.62;
      const pupil = ctx.createRadialGradient(ix, iy, 0, ix, iy, pupilR);
      pupil.addColorStop(0, '#000');
      pupil.addColorStop(0.7, '#000');
      pupil.addColorStop(1, `hsla(${hue}, 100%, 8%, 0)`);
      ctx.fillStyle = pupil;
      ctx.beginPath();
      ctx.arc(ix, iy, pupilR, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(ix, iy, pupilR, 0, Math.PI * 2);
      ctx.strokeStyle = `hsla(${hue}, 100%, 72%, 0.9)`;
      ctx.lineWidth = 1.4;
      ctx.shadowBlur = 12;
      ctx.shadowColor = `hsl(${hue}, 100%, 65%)`;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // 5) блик-катлайт — продаёт «глаз»
      ctx.beginPath();
      ctx.arc(ix - pupilR * 0.5, iy - pupilR * 0.6, pupilR * 0.28 + 1, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fill();

      ctx.restore();

      // контур глаза поверх клипа
      ctx.beginPath();
      ctx.ellipse(cx, cy, R, R * (0.62 * openness + 0.02), 0, 0, Math.PI * 2);
      ctx.strokeStyle = `hsla(${hue}, 90%, 60%, ${0.25 + sig.energy * 0.4})`;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      return { ix, iy, irisR };
    };

    const drawResting = () => {
      const { w, h, dpr } = sizeRef.current;
      if (!w || !h) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const cy = h / 2;
      const R = Math.min(h * 0.4, w * 0.2);
      const gap = R * 1.5;
      for (const cx of [w / 2 - gap, w / 2 + gap]) {
        ctx.beginPath();
        ctx.moveTo(cx - R, cy);
        ctx.quadraticCurveTo(cx, cy + R * 0.18, cx + R, cy);
        ctx.strokeStyle = 'rgba(120,180,220,0.35)';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(150,190,220,0.35)';
      ctx.font = '10px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillText('глаза спят · e = 2.718', w / 2, h - 10);
    };

    const frame = (ts: number) => {
      const { w, h, dpr } = sizeRef.current;
      if (!w || !h) {
        rafRef.current = requestAnimationFrame(frame);
        return;
      }
      const dt = lastTsRef.current ? clamp((ts - lastTsRef.current) / 1000, 0, 0.05) : 0.016;
      lastTsRef.current = ts;
      tRef.current += dt;
      const now = tRef.current;

      const sig = signalRef.current;
      if (sig.voiced) voicedSinceRef.current = now;
      const sinceVoice = now - voicedSinceRef.current;

      // фаза Эйлера θ: угловая скорость из тона голоса (частота кванта)
      const cyclesPerSec = sig.voiced ? clamp(sig.f0 / 220, 0.2, 6) : 0.35;
      phaseRef.current += Math.PI * 2 * cyclesPerSec * dt;

      // веки: голос — глаза распахнуты; тишина > 1.2 c — полуприкрыты (Макс отдыхает)
      const targetOpen = sinceVoice < 1.2 ? 1 : 0.32;
      lidRef.current = lerp(lidRef.current, targetOpen, 1 - expE(-dt * 6));

      // моргание
      nextBlinkRef.current -= dt;
      if (nextBlinkRef.current <= 0 && lidRef.current > 0.6) {
        blinkRef.current = 1;
        nextBlinkRef.current = 2 + Math.random() * 4;
      }
      blinkRef.current = Math.max(0, blinkRef.current - dt * 7);
      const openness = clamp(lidRef.current * (1 - blinkRef.current));

      // измерение → коллапс взгляда
      if (now >= collapseRef.current.next) collapseGaze(sig.energy, sig.tension);
      // релаксация к цели + дрожание неопределённости ∝ напряжение (декогеренция)
      const g = gazeRef.current;
      const relax = 1 - expE(-dt * 7);
      g.x = lerp(g.x, g.tx, relax);
      g.y = lerp(g.y, g.ty, relax);
      const unc = sig.tension * 0.16;
      g.x += (Math.random() - 0.5) * unc;
      g.y += (Math.random() - 0.5) * unc;
      g.x = clamp(g.x, -1, 1);
      g.y = clamp(g.y, -1, 1);

      // рождение квантовой пены (интенсивнее с яркостью/энергией)
      const foamRate = 6 + sig.brightness * 22 + sig.energy * 14;
      if (Math.random() < foamRate * dt) spawnFoam(now, Math.random() < 0.5 ? 0 : 1);
      foamRef.current = foamRef.current.filter((p) => now - p.born < p.life * 3.5 && expE(-(now - p.born) / p.life) > 0.03);
      if (foamRef.current.length > 60) foamRef.current.splice(0, foamRef.current.length - 60);

      // цвет поля: валентность → оттенок (роза → циан → изумруд); напряжение → акцент
      const hue = lerp(350, 158, clamp(sig.valence));
      const accentHue = lerp(hue, 45, clamp(sig.tension) * 0.7);

      // --- рендер ---
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const cy = h / 2 - 4;
      const R = Math.min(h * 0.4, w * 0.19);
      const gap = R * 1.55;
      const cxL = w / 2 - gap;
      const cxR = w / 2 + gap;

      // 0) туннельное свечение вокруг глаз: α ∝ e^(−κ·d), κ мягче при позитиве
      const kappa = lerp(3.4, 1.4, clamp(sig.valence));
      const glowA = (sig.voiced ? 0.5 : 0.12) * (0.4 + sig.energy);
      for (const cx of [cxL, cxR]) {
        const gr = ctx.createRadialGradient(cx, cy, R * 0.4, cx, cy, R * 2.2);
        for (let s = 0; s <= 4; s++) {
          const d = s / 4;
          gr.addColorStop(d, `hsla(${hue}, 100%, 62%, ${glowA * expE(-kappa * d)})`);
        }
        ctx.fillStyle = gr;
        ctx.fillRect(cx - R * 2.2, cy - R * 2.2, R * 4.4, R * 4.4);
      }

      const left = drawEye(ctx, cxL, cy, R, sig, hue, accentHue, openness, now, 0);
      const right = drawEye(ctx, cxR, cy, R, sig, hue, accentHue, openness, now, 1);

      // запутанность: тонкая когерентная нить между зрачками, декогерирует с напряжением
      if (openness > 0.4) {
        const coh = clamp(1 - sig.tension) * clamp(sig.arousal + 0.2);
        if (coh > 0.05) {
          ctx.beginPath();
          const steps = 40;
          for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const x = lerp(left.ix, right.ix, t);
            const yb = lerp(left.iy, right.iy, t);
            const y = yb + Math.sin(t * Math.PI * 6 + phaseRef.current) * 5 * coh * Math.sin(t * Math.PI);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.strokeStyle = `hsla(${accentHue}, 100%, 70%, ${coh * 0.5})`;
          ctx.lineWidth = 1;
          ctx.shadowBlur = 6;
          ctx.shadowColor = `hsl(${accentHue}, 100%, 65%)`;
          ctx.stroke();
          ctx.shadowBlur = 0;
        }
      }

      // читаемая телеметрия квантового мира
      const thetaDeg = Math.round(((phaseRef.current % (Math.PI * 2)) / Math.PI) * 180);
      const sigmaN = (lerp(0.28, 0.62, clamp(sig.arousal))).toFixed(2);
      ctx.fillStyle = 'rgba(180,220,240,0.5)';
      ctx.font = '10px ui-monospace, monospace';
      ctx.textAlign = 'left';
      ctx.fillText(`ψ ∝ e^(−r²/2σ²)·e^(iθ)`, 10, h - 22);
      ctx.textAlign = 'right';
      ctx.fillText(
        `e=2.718 · θ=${thetaDeg}° · σ=${sigmaN} · коллапс ×${collapseRef.current.count}`,
        w - 10,
        h - 22,
      );
      ctx.textAlign = 'center';
      ctx.fillStyle = sig.voiced ? 'rgba(0,242,255,0.75)' : 'rgba(150,190,220,0.4)';
      ctx.fillText(
        sig.voiced ? 'Макс видит тебя сквозь эфир' : 'эфир тих — глаза дремлют',
        w / 2,
        h - 8,
      );

      rafRef.current = requestAnimationFrame(frame);
    };

    if (active) {
      lastTsRef.current = 0;
      rafRef.current = requestAnimationFrame(frame);
    } else {
      // один статичный кадр покоя, петля не крутится
      const id = requestAnimationFrame(() => drawResting());
      return () => cancelAnimationFrame(id);
    }

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [active, signalRef]);

  return (
    <div className={`relative w-full overflow-hidden rounded-2xl border border-cyan-300/15 bg-[radial-gradient(circle_at_50%_40%,#0a0a1e,#040210)] ${className ?? ''}`}>
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  );
}
