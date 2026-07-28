'use client';

import { useEffect, useRef, useState } from 'react';
import './handbrain.css';

// ── Нейро-рука ───────────────────────────────────────────────────────────────
// Живая камера + трекинг кисти (MediaPipe HandLandmarker). На суставах — звёзды,
// между ними светящийся скелет и бегущие «синапс-импульсы». Как в рилсе.
// Модель и wasm грузятся с CDN в браузере пользователя (нужен HTTPS или localhost
// и разрешение на камеру).

const CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

// связи скелета кисти (21 точка MediaPipe)
const CONNECTIONS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

type Phase = 'idle' | 'loading' | 'live' | 'error';

function drawStar(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, rot: number) {
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const a = rot + (i * 2 * Math.PI) / 5 - Math.PI / 2;
    ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    const a2 = a + Math.PI / 5;
    ctx.lineTo(cx + Math.cos(a2) * r * 0.45, cy + Math.sin(a2) * r * 0.45);
  }
  ctx.closePath();
}

export default function HandBrain() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState('');
  const [hands, setHands] = useState(0);
  const [fps, setFps] = useState(0);
  const running = useRef(false);
  const pulses = useRef<{ c: number; p: number; speed: number }[]>([]);

  useEffect(() => () => { running.current = false; }, []);

  async function start() {
    setError('');
    setPhase('loading');
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Камера недоступна в этом браузере.');

      // 1) камера
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 1280, height: 720 }, audio: false });
      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play();

      // 2) MediaPipe с CDN (в браузере пользователя)
      const vision: any = await import(/* webpackIgnore: true */ `${CDN}/vision_bundle.mjs`);
      const fileset = await vision.FilesetResolver.forVisionTasks(`${CDN}/wasm`);
      const landmarker = await vision.HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL, delegate: 'GPU' },
        runningMode: 'VIDEO',
        numHands: 2,
      });

      setPhase('live');
      running.current = true;

      const canvas = canvasRef.current!;
      const ctx = canvas.getContext('2d')!;
      let last = performance.now(), fpsAcc = 0, fpsN = 0, fpsT = 0, lastVideoTs = -1;

      const loop = () => {
        if (!running.current) return;
        const now = performance.now();
        const dt = (now - last) / 1000; last = now;

        if (video.videoWidth > 0) {
          if (canvas.width !== video.videoWidth) { canvas.width = video.videoWidth; canvas.height = video.videoHeight; }
          ctx.save();
          // зеркалим как селфи
          ctx.setTransform(-1, 0, 0, 1, canvas.width, 0);
          ctx.clearRect(0, 0, canvas.width, canvas.height);

          let result: any = null;
          if (video.currentTime !== lastVideoTs) {
            lastVideoTs = video.currentTime;
            try { result = landmarker.detectForVideo(video, now); } catch { /* skip frame */ }
          }
          const landmarksList = result?.landmarks || [];
          setHands(landmarksList.length);

          for (let h = 0; h < landmarksList.length; h++) {
            const lm = landmarksList[h];
            const P = (i: number) => ({ x: lm[i].x * canvas.width, y: lm[i].y * canvas.height });

            // скелет
            ctx.lineWidth = 2;
            for (const [a, b] of CONNECTIONS) {
              const A = P(a), B = P(b);
              const grad = ctx.createLinearGradient(A.x, A.y, B.x, B.y);
              grad.addColorStop(0, 'rgba(255,90,220,0.55)');
              grad.addColorStop(1, 'rgba(120,220,255,0.55)');
              ctx.strokeStyle = grad;
              ctx.shadowColor = 'rgba(255,60,210,0.8)'; ctx.shadowBlur = 8;
              ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
            }
            ctx.shadowBlur = 0;

            // звёзды на суставах
            for (let i = 0; i < lm.length; i++) {
              const p = P(i);
              const r = i === 0 ? 11 : (i % 4 === 0 ? 9 : 7);
              drawStar(ctx, p.x, p.y, r, now / 700 + i);
              ctx.fillStyle = '#ff2bd6';
              ctx.shadowColor = 'rgba(255,43,214,0.9)'; ctx.shadowBlur = 12;
              ctx.fill();
              ctx.shadowBlur = 0;
            }

            // подпись как в рилсе
            const wrist = P(0);
            ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.font = '13px monospace'; ctx.fillStyle = 'rgba(200,230,255,0.7)';
            ctx.fillText(`window ${h + 1}`, canvas.width - wrist.x + 14, wrist.y);
            ctx.restore();

            // синапс-импульсы вдоль случайных связей
            if (Math.random() < 0.5) pulses.current.push({ c: Math.floor(Math.random() * CONNECTIONS.length), p: 0, speed: 1 + Math.random() });
            for (let k = pulses.current.length - 1; k >= 0; k--) {
              const pu = pulses.current[k]; pu.p += pu.speed * dt;
              if (pu.p >= 1) { pulses.current.splice(k, 1); continue; }
              const [a, b] = CONNECTIONS[pu.c]; const A = P(a), B = P(b);
              const x = A.x + (B.x - A.x) * pu.p, y = A.y + (B.y - A.y) * pu.p;
              ctx.beginPath(); ctx.arc(x, y, 2.4, 0, Math.PI * 2);
              ctx.fillStyle = 'rgba(210,255,250,0.95)'; ctx.fill();
            }
          }
          ctx.restore();
        }

        fpsN++; fpsT += dt;
        if (fpsT >= 0.5) { fpsAcc = fpsN / fpsT; fpsN = 0; fpsT = 0; setFps(Math.round(fpsAcc)); }
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    } catch (e: unknown) {
      running.current = false;
      const msg = e instanceof Error ? e.message : String(e);
      setError(
        /Permission|NotAllowed|Denied/i.test(msg)
          ? 'Доступ к камере запрещён. Разреши камеру для сайта и попробуй снова.'
          : /https|secure/i.test(msg)
          ? 'Камера работает только по HTTPS или на localhost.'
          : `Не удалось запустить: ${msg}. Нужен HTTPS/localhost, разрешение на камеру и доступ к CDN MediaPipe.`,
      );
      setPhase('error');
    }
  }

  return (
    <div className="hb-screen">
      <header className="hb-bar">
        <span className="hb-logo">△∞</span>
        <div>
          <div className="hb-title">НЕЙРО-РУКА · HAND BRAIN</div>
          <div className="hb-sub">трекинг кисти в реальном времени · звёзды на суставах</div>
        </div>
        <div className="hb-stats">
          {phase === 'live' && <><span>рук: <b>{hands}</b></span><span><b>{fps}</b> fps</span></>}
        </div>
      </header>

      <div className="hb-stage">
        <video ref={videoRef} className="hb-video" playsInline muted />
        <canvas ref={canvasRef} className="hb-canvas" />

        {phase !== 'live' && (
          <div className="hb-overlay">
            {phase === 'idle' && (
              <>
                <p className="hb-hint">Покажи руку в камеру — на суставах загорятся звёзды и соберётся нейро-скелет.</p>
                <button className="hb-go" onClick={start}>ВКЛЮЧИТЬ КАМЕРУ</button>
              </>
            )}
            {phase === 'loading' && <p className="hb-hint">Запрашиваю камеру и гружу модель кисти…</p>}
            {phase === 'error' && (
              <>
                <p className="hb-err">{error}</p>
                <button className="hb-go" onClick={start}>ПОВТОРИТЬ</button>
              </>
            )}
          </div>
        )}
      </div>

      <div className="hb-foot">Модель MediaPipe HandLandmarker · до 2 рук · всё считается на устройстве. Нужен HTTPS или localhost + разрешение на камеру.</div>
    </div>
  );
}
