'use client';

import { useEffect, useRef, useState } from 'react';
import './neurodance.css';

// ── ХАОС НЕЙРО ДЭНС ──────────────────────────────────────────────────────────
// Руки в камере = аттракторы: кончики пальцев светятся (как в GAME OS постере),
// а рой нейро-частиц танцует вокруг них по хаотической динамике (поле Томаса +
// притяжение к пальцам). Без камеры — авто-дэнс: виртуальные руки по Лиссажу.

const CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const TIP_IDS = [4, 8, 12, 16, 20]; // большой..мизинец

const N = 6000;
const B = 0.19; // затухание хаос-поля

type Phase = 'idle' | 'loading' | 'live' | 'auto' | 'error';

interface Tip { x: number; y: number; }

export default function NeuroDance() {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState('');
  const [ui, setUi] = useState({ fps: 0, sync: 0, hands: 0 });

  const sim = useRef({
    running: false,
    mode: 'auto' as 'auto' | 'camera',
    px: new Float32Array(N), py: new Float32Array(N),
    vx: new Float32Array(N), vy: new Float32Array(N),
    hue: new Float32Array(N),
    tips: [] as Tip[],
    w: 0, h: 0, dpr: 1,
    t: 0,
    energy: 0, // «синк» — сколько энергии в танце
    stop: () => {},
  });

  useEffect(() => () => { sim.current.running = false; sim.current.stop(); }, []);

  const seed = () => {
    const s = sim.current;
    for (let i = 0; i < N; i++) {
      s.px[i] = Math.random() * s.w;
      s.py[i] = Math.random() * s.h;
      s.vx[i] = 0; s.vy[i] = 0;
      s.hue[i] = Math.random();
    }
  };

  const resize = () => {
    const wrap = wrapRef.current, cv = canvasRef.current;
    if (!wrap || !cv) return;
    const s = sim.current;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    s.w = wrap.clientWidth; s.h = wrap.clientHeight; s.dpr = dpr;
    cv.width = Math.floor(s.w * dpr); cv.height = Math.floor(s.h * dpr);
    cv.style.width = s.w + 'px'; cv.style.height = s.h + 'px';
  };

  const startLoop = () => {
    const s = sim.current;
    const cv = canvasRef.current!;
    const ctx = cv.getContext('2d')!;
    let raf = 0, last = performance.now(), fpsN = 0, fpsT = 0;
    s.running = true;

    const loop = (now: number) => {
      if (!s.running) return;
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      s.t += dt;
      const { w, h, dpr } = s;

      // авто-режим: две виртуальные «руки» танцуют по Лиссажу
      if (s.mode === 'auto') {
        const t = s.t * 0.8;
        s.tips = [];
        for (let hnd = 0; hnd < 2; hnd++) {
          const cx = w * (0.5 + (hnd ? 0.24 : -0.24) * Math.sin(t * 0.7 + hnd * 2));
          const cy = h * (0.5 + 0.22 * Math.sin(t * 1.1 + hnd * Math.PI));
          for (let f = 0; f < 5; f++) {
            const a = t * 1.6 + f * 1.256 + hnd * Math.PI;
            s.tips.push({ x: cx + Math.cos(a) * 60, y: cy + Math.sin(a) * 60 });
          }
        }
        s.energy = 0.6 + 0.4 * Math.abs(Math.sin(s.t * 0.9));
      }

      // ── физика: хаос-поле Томаса (2D-проекция) + притяжение к пальцам ──
      const tips = s.tips;
      const sc = 0.006; // мир→поле
      let flow = 0;
      for (let i = 0; i < N; i++) {
        const x = s.px[i], y = s.py[i];
        // поле Томаса: dx = sin(y') - b x', dy = sin(x'+фаза) - b y'
        const fx = (Math.sin(y * sc * 6 + s.t * 0.3) - B * (x - w / 2) * sc) * 0.6;
        const fy = (Math.sin(x * sc * 6 - s.t * 0.25) - B * (y - h / 2) * sc) * 0.6;
        s.vx[i] += fx * 46 * dt;
        s.vy[i] += fy * 46 * dt;
        // притяжение к ближайшему пальцу
        let bd = 1e9, bx = 0, by = 0;
        for (let k = 0; k < tips.length; k++) {
          const dx = tips[k].x - x, dy = tips[k].y - y;
          const d = dx * dx + dy * dy;
          if (d < bd) { bd = d; bx = dx; by = dy; }
        }
        if (tips.length && bd < 380 * 380) {
          const d = Math.sqrt(bd) || 1;
          const pull = (1 - d / 380) * 330 * dt;
          s.vx[i] += (bx / d) * pull;
          s.vy[i] += (by / d) * pull;
          // вихрь вокруг пальца — «дэнс»
          s.vx[i] += (-by / d) * pull * 0.9;
          s.vy[i] += (bx / d) * pull * 0.9;
        }
        s.vx[i] *= 0.96; s.vy[i] *= 0.96;
        s.px[i] += s.vx[i] * dt * 60 * 0.016 * 60; // норм. к 60fps
        s.py[i] += s.vy[i] * dt * 60 * 0.016 * 60;
        if (s.px[i] < 0) s.px[i] += w; else if (s.px[i] >= w) s.px[i] -= w;
        if (s.py[i] < 0) s.py[i] += h; else if (s.py[i] >= h) s.py[i] -= h;
        flow += Math.abs(s.vx[i]) + Math.abs(s.vy[i]);
      }
      const sync = Math.min(99, Math.round((flow / N) * 14 + (tips.length ? 30 : 0)));

      // ── рендер ──
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = 'rgba(8,2,18,0.22)';
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'lighter';

      for (let i = 0; i < N; i++) {
        const v = Math.min(1, (Math.abs(s.vx[i]) + Math.abs(s.vy[i])) * 0.12);
        const hu = s.hue[i];
        // палитра GAME OS: фиолет → маджента → лаванда
        const r = 150 + hu * 60 + v * 45;
        const g = 60 + v * 60;
        const b2 = 220 + hu * 35;
        ctx.fillStyle = `rgba(${r | 0},${g | 0},${b2 | 0},${0.25 + v * 0.5})`;
        ctx.fillRect(s.px[i], s.py[i], 1.6, 1.6);
      }

      // пальцы: светящиеся точки + линии между ними (как на постере)
      if (tips.length) {
        ctx.lineWidth = 1;
        for (let k = 0; k < tips.length; k++) {
          const nk = (k + 1) % tips.length;
          if (Math.floor(k / 5) === Math.floor(nk / 5)) {
            ctx.strokeStyle = 'rgba(200,140,255,0.28)';
            ctx.beginPath(); ctx.moveTo(tips[k].x, tips[k].y); ctx.lineTo(tips[nk].x, tips[nk].y); ctx.stroke();
          }
        }
        for (const tp of tips) {
          ctx.beginPath(); ctx.arc(tp.x, tp.y, 5, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(235,210,255,0.95)';
          ctx.shadowColor = 'rgba(190,120,255,1)'; ctx.shadowBlur = 18;
          ctx.fill(); ctx.shadowBlur = 0;
        }
      }
      ctx.globalCompositeOperation = 'source-over';

      fpsN++; fpsT += dt;
      if (fpsT >= 0.4) {
        setUi({ fps: Math.round(fpsN / fpsT), sync, hands: Math.ceil(tips.length / 5) });
        fpsN = 0; fpsT = 0;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    s.stop = () => cancelAnimationFrame(raf);
  };

  const startAuto = () => {
    const s = sim.current;
    s.mode = 'auto';
    resize(); seed();
    setPhase('auto');
    startLoop();
  };

  async function startCamera() {
    setError('');
    setPhase('loading');
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Камера недоступна в этом браузере.');
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 1280, height: 720 }, audio: false });
      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play();

      const vision: any = await import(/* webpackIgnore: true */ `${CDN}/vision_bundle.mjs`);
      const fileset = await vision.FilesetResolver.forVisionTasks(`${CDN}/wasm`);
      const landmarker = await vision.HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL, delegate: 'GPU' },
        runningMode: 'VIDEO',
        numHands: 2,
      });

      const s = sim.current;
      s.mode = 'camera';
      resize(); seed();
      setPhase('live');
      startLoop();

      // отдельный цикл трекинга — пишет s.tips
      let lastTs = -1;
      const track = () => {
        if (!s.running || s.mode !== 'camera') return;
        if (video.videoWidth > 0 && video.currentTime !== lastTs) {
          lastTs = video.currentTime;
          try {
            const res = landmarker.detectForVideo(video, performance.now());
            const tips: Tip[] = [];
            for (const lm of res?.landmarks ?? []) {
              for (const id of TIP_IDS) {
                // зеркалим по X как селфи
                tips.push({ x: (1 - lm[id].x) * s.w, y: lm[id].y * s.h });
              }
            }
            s.tips = tips;
            s.energy = tips.length ? 1 : 0.3;
          } catch { /* skip frame */ }
        }
        requestAnimationFrame(track);
      };
      requestAnimationFrame(track);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(
        /Permission|NotAllowed|Denied/i.test(msg)
          ? 'Доступ к камере запрещён. Разреши камеру или запусти авто-дэнс.'
          : `Камера не запустилась: ${msg}. Нужен HTTPS/localhost. Попробуй авто-дэнс.`,
      );
      setPhase('error');
    }
  }

  useEffect(() => {
    const onResize = () => resize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return (
    <div className="nd-screen">
      <header className="nd-bar">
        <span className="nd-logo">△∞</span>
        <div>
          <div className="nd-title">ХАОС НЕЙРО ДЭНС</div>
          <div className="nd-sub">пальцы = аттракторы · рой танцует по хаос-полю</div>
        </div>
        <div className="nd-stats">
          {(phase === 'live' || phase === 'auto') && (
            <>
              <span className="nd-sync">SYNC: <b>{ui.sync}%</b></span>
              <span>руки: <b>{ui.hands}</b></span>
              <span><b>{N.toLocaleString('ru-RU')}</b> частиц</span>
              <span><b>{ui.fps}</b> fps</span>
            </>
          )}
        </div>
      </header>

      <div className="nd-stage" ref={wrapRef}>
        <video ref={videoRef} className="nd-video" playsInline muted />
        <canvas ref={canvasRef} className="nd-canvas" />

        {(phase === 'idle' || phase === 'loading' || phase === 'error') && (
          <div className="nd-overlay">
            {phase === 'loading' ? (
              <p className="nd-hint">Запрашиваю камеру и гружу модель кисти…</p>
            ) : (
              <>
                {phase === 'error' && <p className="nd-err">{error}</p>}
                <p className="nd-hint">
                  Танцуй руками перед камерой — кончики пальцев станут аттракторами,
                  и {N.toLocaleString('ru-RU')} нейро-частиц закружатся вокруг них.
                </p>
                <div className="nd-actions">
                  <button className="nd-go" onClick={startCamera}>С КАМЕРОЙ</button>
                  <button className="nd-go nd-alt" onClick={startAuto}>АВТО-ДЭНС</button>
                </div>
              </>
            )}
          </div>
        )}

        {phase === 'auto' && (
          <button className="nd-switch" onClick={startCamera}>включить камеру →</button>
        )}
      </div>

      <div className="nd-foot">Хаос-поле Томаса + вихревое притяжение к пальцам · MediaPipe Hands · всё на устройстве. Камера — HTTPS/localhost.</div>
    </div>
  );
}
