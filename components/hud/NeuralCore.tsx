'use client';

import { useEffect, useRef } from 'react';
import { ambientActive, ambientFrame, startAmbient } from '@/lib/ambient-audio';

export type NeuralCoreStatus = 'idle' | 'listening' | 'processing' | 'speaking';

/**
 * Адаптивное ядро MAX (2D-канвас): вращающаяся сфера из точек внутри светящегося
 * розового кольца-гало, которое деформируется и РЕАГИРУЕТ НА ЗВУК ПРОСТРАНСТВА
 * (микрофон — «уши» MAX). Свечение — через shadowBlur + двойной штрих, поэтому
 * чисто и ярко на любом размере. Без микрофона — спокойная органическая анимация.
 *
 * Микрофон не пишется и никуда не отправляется (см. lib/ambient-audio). Разрешение
 * запрашивается по первому жесту. Скорость/яркость также зависят от статуса
 * (idle / listening / processing / speaking) и от того, говорит ли MAX.
 */
export function NeuralCore({
  className = '',
  status = 'idle',
}: {
  className?: string;
  status?: NeuralCoreStatus;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const statusRef = useRef<NeuralCoreStatus>(status);
  const externalBusyRef = useRef(false);
  const speakingRef = useRef(false);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    const onThinking = (e: Event) => {
      externalBusyRef.current = Boolean((e as CustomEvent).detail?.active);
    };
    const onSpeaking = (e: Event) => {
      speakingRef.current = Boolean((e as CustomEvent).detail?.active);
    };
    window.addEventListener('max:thinking', onThinking as EventListener);
    window.addEventListener('max:speaking', onSpeaking as EventListener);
    return () => {
      window.removeEventListener('max:thinking', onThinking as EventListener);
      window.removeEventListener('max:speaking', onSpeaking as EventListener);
    };
  }, []);

  // «Уши» MAX: микрофон по первому жесту (политика браузера + согласие).
  useEffect(() => {
    if (ambientActive()) return;
    const tryStart = () => {
      void startAmbient();
      window.removeEventListener('pointerdown', tryStart);
      window.removeEventListener('keydown', tryStart);
    };
    window.addEventListener('pointerdown', tryStart);
    window.addEventListener('keydown', tryStart);
    return () => {
      window.removeEventListener('pointerdown', tryStart);
      window.removeEventListener('keydown', tryStart);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const DPR = Math.min(window.devicePixelRatio || 1, 2);
    let W = 0;
    let H = 0;
    const resize = () => {
      const r = canvas.getBoundingClientRect();
      W = Math.max(80, r.width);
      H = Math.max(80, r.height);
      canvas.width = Math.round(W * DPR);
      canvas.height = Math.round(H * DPR);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    // Сфера из точек (распределение Фибоначчи — равномерно по поверхности).
    const N = 520;
    const pts: Array<[number, number, number]> = [];
    for (let i = 0; i < N; i++) {
      const y = 1 - (i / (N - 1)) * 2;
      const rr = Math.sqrt(Math.max(0, 1 - y * y));
      const phi = i * Math.PI * (3 - Math.sqrt(5));
      pts.push([Math.cos(phi) * rr, y, Math.sin(phi) * rr]);
    }

    const RN = 180; // сегментов кольца
    const ringR = new Float32Array(RN); // временно-сглаженный радиус
    const ringRS = new Float32Array(RN); // + пространственно-сглаженный
    const ringX = new Float32Array(RN);
    const ringY = new Float32Array(RN);
    let ringInited = false;
    let t = 0;
    let audioLevel = 0;
    let raf = 0;

    const draw = () => {
      raf = requestAnimationFrame(draw);
      ctx.save();
      ctx.scale(DPR, DPR);

      const af = ambientFrame();
      const rawLevel = af ? af.level : 0;
      audioLevel += (rawLevel - audioLevel) * 0.2;

      let speed = 1;
      if (statusRef.current === 'processing' || externalBusyRef.current) speed = 2.4;
      else if (statusRef.current === 'speaking' || speakingRef.current) speed = 1.6;
      else if (statusRef.current === 'listening') speed = 0.6;
      speed += audioLevel * 1.8;
      t += 0.016 * speed;

      ctx.clearRect(0, 0, W, H);
      const cx = W / 2;
      const cy = H / 2;
      const minDim = Math.min(W, H);
      const sphereR = minDim * 0.3 + audioLevel * minDim * 0.03;
      const ringBase = minDim * 0.37;
      const deform = minDim * 0.14;

      // Лёгкое центральное свечение.
      const cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, sphereR * 1.3);
      cg.addColorStop(0, `rgba(255,60,220,${0.1 + audioLevel * 0.22})`);
      cg.addColorStop(1, 'rgba(255,60,220,0)');
      ctx.fillStyle = cg;
      ctx.fillRect(0, 0, W, H);

      // Вращающаяся сфера из точек.
      const ay = t * 0.4;
      const ax = Math.sin(t * 0.25) * 0.3;
      const cosY = Math.cos(ay);
      const sinY = Math.sin(ay);
      const cosX = Math.cos(ax);
      const sinX = Math.sin(ax);
      for (let i = 0; i < N; i++) {
        const p = pts[i];
        const x1 = p[0] * cosY - p[2] * sinY;
        const z1 = p[0] * sinY + p[2] * cosY;
        const y1 = p[1] * cosX - z1 * sinX;
        const z2 = p[1] * sinX + z1 * cosX;
        const depth = (z2 + 1) / 2;
        const px = cx + x1 * sphereR;
        const py = cy + y1 * sphereR;
        ctx.beginPath();
        ctx.arc(px, py, 0.6 + depth * (1 + minDim * 0.004), 0, 6.283);
        ctx.fillStyle = `rgba(255,${Math.round(55 + depth * 85)},${Math.round(200 + depth * 45)},${0.14 + depth * 0.55})`;
        ctx.fill();
      }

      // Светящееся кольцо-гало: органика + живой спектр микрофона.
      // 1) целевой радиус на сегмент → 2) временное сглаживание → 3) простран-
      // ственное сглаживание → 4) гладкая замкнутая кривая (квадратики через
      // средние точки). Так контур плавный, без рваных углов.
      for (let i = 0; i < RN; i++) {
        const a = (i / RN) * Math.PI * 2;
        let band = 0;
        if (af) {
          const bin = Math.floor((i / RN) * af.bins * 0.55);
          band = af.data[bin] / 255;
        }
        const organic = Math.sin(t * 0.9 + a * 3) * (minDim * 0.018) + Math.sin(t * 1.7 + a * 5 + 1.3) * (minDim * 0.013);
        const target = ringBase + organic + band * deform;
        ringR[i] = ringInited ? ringR[i] + (target - ringR[i]) * 0.3 : target;
      }
      ringInited = true;
      for (let pass = 0; pass < 2; pass++) {
        // циклическое сглаживание соседей (1-2-1), 2 прохода
        const src = pass === 0 ? ringR : ringRS;
        const dst = ringRS;
        for (let i = 0; i < RN; i++) {
          const pr = src[(i - 1 + RN) % RN];
          const nx = src[(i + 1) % RN];
          dst[i] = (pr + 2 * src[i] + nx) * 0.25;
        }
      }
      for (let i = 0; i < RN; i++) {
        const a = (i / RN) * Math.PI * 2;
        ringX[i] = Math.cos(a) * ringRS[i];
        ringY[i] = Math.sin(a) * ringRS[i];
      }

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(t * 0.05);
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.shadowColor = 'rgba(255,60,220,0.9)';
      ctx.shadowBlur = minDim * 0.06 + audioLevel * minDim * 0.09;
      for (let pass = 0; pass < 2; pass++) {
        ctx.beginPath();
        ctx.moveTo((ringX[RN - 1] + ringX[0]) * 0.5, (ringY[RN - 1] + ringY[0]) * 0.5);
        for (let i = 0; i < RN; i++) {
          const j = (i + 1) % RN;
          ctx.quadraticCurveTo(ringX[i], ringY[i], (ringX[i] + ringX[j]) * 0.5, (ringY[i] + ringY[j]) * 0.5);
        }
        ctx.closePath();
        ctx.strokeStyle = pass === 0 ? 'rgba(255,90,230,0.95)' : 'rgba(255,180,248,0.9)';
        ctx.lineWidth = pass === 0 ? Math.max(2, minDim * 0.016) : Math.max(1, minDim * 0.005);
        ctx.stroke();
      }
      ctx.restore();
      ctx.restore();
    };

    draw();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return <canvas ref={canvasRef} className={`hud-core-canvas ${className}`} />;
}
