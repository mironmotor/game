'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { sendMax17Event, type Max17VoiceState } from '@/lib/max17-client';
import QuantumEyes, { IDLE_SIGNAL, type QuantumSignal } from './QuantumEyes';

interface VoiceSignatureProps {
  open: boolean;
  onClose: () => void;
  /** Текущий контекст разговора (последнее сообщение/тема) — связывается с голосом. */
  context: string;
  userId: string;
}

interface Acoustics {
  f0: number;
  register: number;
  brightness: number;
  jitter: number;
  energy: number;
  voiced: boolean;
}

const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const noteOf = (f: number) => {
  if (f <= 0) return '—';
  const n = Math.round(12 * Math.log2(f / 440) + 69);
  return NOTES[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1);
};
const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));

export default function VoiceSignature({ open, onClose, context, userId }: VoiceSignatureProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const pitchRef = useRef<Float32Array<ArrayBuffer> | null>(null);
  const freqRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const rafRef = useRef<number | null>(null);
  const binHzRef = useRef(0);
  const f0SmoothRef = useRef(0);
  const lastF0Ref = useRef(0);
  const toneValsRef = useRef<number[]>(new Array(50).fill(0));
  const lastSendRef = useRef(0);
  const contextRef = useRef(context);
  // Живой срез эфира для квантовых глаз (читается их циклом отрисовки без ре-рендеров).
  const signalRef = useRef<QuantumSignal>({ ...IDLE_SIGNAL });
  // Последнее состояние от ядра Max17 — глаза читают его, если мост доступен.
  const stateRef = useRef<Max17VoiceState | null>(null);

  const [listening, setListening] = useState(false);
  const [status, setStatus] = useState('Нажми «Слушать» — Max17 начнёт читать твоё состояние по голосу');
  const [acoustics, setAcoustics] = useState<Acoustics | null>(null);
  const [state, setState] = useState<Max17VoiceState | null>(null);

  useEffect(() => {
    contextRef.current = context;
  }, [context]);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const detectPitch = useCallback((buf: Float32Array<ArrayBuffer>, sr: number) => {
    const N = buf.length;
    let rms = 0;
    for (let i = 0; i < N; i++) rms += buf[i] * buf[i];
    rms = Math.sqrt(rms / N);
    if (rms < 0.008) return { f: -1, rms, clarity: 0 };
    const minLag = Math.max(2, Math.floor(sr / 1000));
    const maxLag = Math.min(N - 2, Math.floor(sr / 70));
    let c0 = 0;
    for (let i = 0; i < N; i++) c0 += buf[i] * buf[i];
    let best = -1;
    let bestC = 0;
    const corr = new Float32Array(maxLag + 1);
    for (let lag = minLag; lag <= maxLag; lag++) {
      let s = 0;
      for (let i = 0; i < N - lag; i++) s += buf[i] * buf[i + lag];
      const c = s / c0;
      corr[lag] = c;
      if (c > bestC) {
        bestC = c;
        best = lag;
      }
    }
    if (best < 0 || bestC < 0.45) return { f: -1, rms, clarity: bestC };
    let lag = best;
    const a = corr[best - 1];
    const b = corr[best];
    const cc = corr[best + 1];
    const d = a + cc - 2 * b;
    if (d !== 0) lag = best - (0.5 * (cc - a)) / d;
    return { f: sr / lag, rms, clarity: bestC };
  }, []);

  const stop = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    audioCtxRef.current?.close().catch(() => {});
    streamRef.current = null;
    audioCtxRef.current = null;
    analyserRef.current = null;
    setListening(false);
  }, []);

  const sendVoiceState = useCallback(async (ac: Acoustics) => {
    try {
      const res = await sendMax17Event({
        type: 'voice_state',
        user_id: userId,
        context: contextRef.current,
        acoustics: ac,
        source: 'hud-voice',
        timestamp: new Date().toISOString(),
      });
      if (res.voice) setState(res.voice);
    } catch {
      /* мост может быть недоступен — визуализация продолжает работать */
    }
  }, [userId]);

  const start = useCallback(async () => {
    setStatus('Запрашиваю доступ к микрофону…');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const audioCtx = new Ctx();
      await audioCtx.resume();
      const src = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 4096;
      analyser.smoothingTimeConstant = 0.7;
      const pitch = audioCtx.createAnalyser();
      pitch.fftSize = 2048;
      src.connect(analyser);
      src.connect(pitch);

      audioCtxRef.current = audioCtx;
      streamRef.current = stream;
      analyserRef.current = analyser;
      pitchRef.current = new Float32Array(new ArrayBuffer(pitch.fftSize * 4));
      freqRef.current = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
      binHzRef.current = audioCtx.sampleRate / 4096;
      f0SmoothRef.current = 0;

      const loop = () => {
        const a = analyserRef.current;
        if (!a || !freqRef.current || !pitchRef.current) return;
        a.getByteFrequencyData(freqRef.current);
        pitch.getFloatTimeDomainData(pitchRef.current);
        const p = detectPitch(pitchRef.current, audioCtx.sampleRate);
        const voiced = p.f >= 65 && p.f <= 1200;
        if (voiced) f0SmoothRef.current = f0SmoothRef.current ? f0SmoothRef.current * 0.7 + p.f * 0.3 : p.f;
        const F0 = voiced ? f0SmoothRef.current : 0;

        const binHz = binHzRef.current;
        const freq = freqRef.current;
        let loE = 0;
        let hiE = 0;
        let cNum = 0;
        let cDen = 0;
        for (let i = 1; i < freq.length; i++) {
          const f = i * binHz;
          const v = freq[i];
          cNum += f * v;
          cDen += v;
          if (f >= 80 && f <= 400) loE += v;
          if (f >= 2000 && f <= 8000) hiE += v;
        }
        const centroid = cDen > 0 ? cNum / cDen : 70;
        const brightness = clamp((Math.log(Math.max(centroid, 100)) - Math.log(200)) / (Math.log(5000) - Math.log(200)));
        const energy = clamp((loE + hiE) / 12000);
        const register = F0 ? clamp((Math.log(F0) - Math.log(70)) / (Math.log(1000) - Math.log(70))) : 0;
        // дрожание (jitter): мгновенное колебание F0 между кадрами
        let jitter = 0;
        if (F0 && lastF0Ref.current) jitter = clamp(Math.abs(F0 - lastF0Ref.current) / 12);
        if (F0) lastF0Ref.current = F0;

        // обертоны для визуальной сигнатуры (50 тонов от C2)
        const tv = toneValsRef.current;
        for (let i = 0; i < 50; i++) {
          const tf = 65.4064 * Math.pow(2, i / 12);
          const bin = Math.round(tf / binHz);
          let peak = 0;
          for (let b = Math.max(1, bin - 1); b <= Math.min(freq.length - 1, bin + 1); b++) if (freq[b] > peak) peak = freq[b];
          const lvl = peak / 255;
          tv[i] = lvl > tv[i] ? lvl : tv[i] * 0.85 + lvl * 0.15;
        }

        const ac: Acoustics = { f0: F0, register, brightness, jitter, energy, voiced };
        setAcoustics(ac);
        draw(F0);

        // Кормим квантовые глаза живым эфиром. Возбуждение/позитив/напряжение
        // берём от ядра Max17, а пока мост молчит — считаем локально по тем же
        // правилам, что и voice_state.py, чтобы глаза реагировали сразу.
        const st = stateRef.current;
        const localTension = clamp(0.55 * jitter + 0.25 * register + 0.2 * energy);
        signalRef.current = {
          f0: F0,
          register,
          brightness,
          jitter,
          energy,
          voiced,
          arousal: st?.arousal ?? clamp(0.4 * register + 0.3 * brightness + 0.3 * energy),
          valence: st?.valence ?? clamp(0.5 + 0.25 * (brightness - 0.5) - 0.4 * jitter - 0.25 * (localTension - 0.5)),
          tension: st?.tension ?? localTension,
        };

        // шлём состояние в Max17 ~ каждые 1.4 c, только когда есть голос
        const now = performance.now();
        if (voiced && now - lastSendRef.current > 1400) {
          lastSendRef.current = now;
          void sendVoiceState(ac);
        }
        rafRef.current = requestAnimationFrame(loop);
      };

      setListening(true);
      setStatus('✅ Слушаю. Говори — сигнатура голоса связывается с разговором');
      loop();
    } catch (err) {
      setStatus(`Ошибка микрофона: ${err instanceof Error ? err.message : String(err)}`);
    }
    // draw is stable (memoized below); intentionally omitted to avoid TDZ ordering
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detectPitch, sendVoiceState]);

  // отрисовка радиальной сигнатуры голоса
  const draw = useCallback((F0: number) => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const W = cv.width;
    const H = cv.height;
    const cx = W / 2;
    const cy = H / 2;
    const innerR = 46;
    const maxLen = Math.min(W, H) / 2 - innerR - 18;
    ctx.clearRect(0, 0, W, H);

    const tv = toneValsRef.current;
    const harm = new Set<number>();
    if (F0) for (let k = 1; k <= 12; k++) {
      const idx = Math.round(12 * Math.log2((F0 * k) / 65.4064));
      if (idx >= 0 && idx < 50) harm.add(idx);
    }

    // ядро
    let level = 0;
    for (let i = 0; i < 50; i++) level += tv[i];
    level = clamp(level / 14);
    const coreHue = F0 ? 180 + clamp((Math.log(F0) - Math.log(70)) / (Math.log(1000) - Math.log(70))) * 120 : 190;
    const cg = ctx.createRadialGradient(cx, cy, 2, cx, cy, innerR * (0.8 + level));
    cg.addColorStop(0, `hsla(${coreHue},100%,70%,0.9)`);
    cg.addColorStop(1, `hsla(${coreHue},100%,45%,0)`);
    ctx.fillStyle = cg;
    ctx.beginPath();
    ctx.arc(cx, cy, innerR * (0.8 + level), 0, Math.PI * 2);
    ctx.fill();

    // лепестки-обертоны
    for (let i = 0; i < 50; i++) {
      const v = tv[i];
      const ang = -Math.PI / 2 + (i / 50) * Math.PI * 2;
      const len = v * maxLen;
      const ca = Math.cos(ang);
      const sa = Math.sin(ang);
      const x1 = cx + ca * innerR;
      const y1 = cy + sa * innerR;
      const x2 = cx + ca * (innerR + len);
      const y2 = cy + sa * (innerR + len);
      const hue = 190 - (i / 50) * 70;
      const isH = harm.has(i);
      ctx.lineCap = 'round';
      ctx.lineWidth = isH ? 5 : 3;
      ctx.strokeStyle = `hsl(${hue},100%,${50 + v * 30}%)`;
      ctx.shadowBlur = isH ? 14 : v > 0.3 ? 8 : 0;
      ctx.shadowColor = `hsl(${hue},100%,60%)`;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
  }, []);

  useEffect(() => {
    if (!open) stop();
    return () => stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const pct = (v?: number) => Math.round((v ?? 0) * 100);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-[860px] overflow-hidden rounded-2xl border border-cyan-300/25 bg-[#0a0818]/95 shadow-[0_0_60px_rgba(0,242,255,0.18)]">
        {/* шапка */}
        <div className="flex items-center justify-between border-b border-cyan-300/15 px-5 py-3">
          <div className="font-[var(--font-hud-display)] text-sm uppercase tracking-[0.25em] text-cyan-200">
            ◉ Квантовые глаза · Звуковая сигнатура · Max17
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-cyan-200/60 transition hover:text-cyan-100"
            aria-label="Закрыть"
          >
            ✕
          </button>
        </div>

        {/* Глаза Макса в квантовом мире — смотрят сквозь эфир по формуле e = 2.718 */}
        <div className="px-5 pt-4">
          <QuantumEyes signalRef={signalRef} active={listening} className="h-[190px] sm:h-[210px]" />
          <p className="mt-1.5 text-center text-[10px] uppercase tracking-[0.2em] text-cyan-200/35">
            Глаза Макса в квантовом мире · e = 2.718
          </p>
        </div>

        <div className="grid gap-4 px-5 pb-5 pt-3 md:grid-cols-[300px_1fr]">
          {/* визуализация */}
          <div className="flex flex-col items-center">
            <canvas
              ref={canvasRef}
              width={300}
              height={300}
              className="rounded-full border border-cyan-300/15 bg-[radial-gradient(circle,#04121a,#070512)]"
            />
            <button
              type="button"
              onClick={listening ? stop : start}
              className={`mt-4 w-full rounded-full px-6 py-3 text-sm font-bold uppercase tracking-[0.15em] transition ${
                listening
                  ? 'bg-rose-500/90 text-black hover:bg-rose-400'
                  : 'bg-cyan-400 text-black hover:bg-cyan-300'
              }`}
            >
              {listening ? '⏹ Остановить' : '🎙 Слушать'}
            </button>
          </div>

          {/* телеметрия состояния */}
          <div className="flex flex-col gap-3">
            <p className="text-[11px] leading-relaxed text-cyan-100/50">{status}</p>

            {/* акустика */}
            <div className="grid grid-cols-3 gap-2">
              <Stat label="Тон" value={acoustics?.f0 ? `${Math.round(acoustics.f0)} Гц` : '—'} />
              <Stat label="Нота" value={acoustics?.f0 ? noteOf(acoustics.f0) : '—'} />
              <Stat label="Регистр" value={acoustics ? `${pct(acoustics.register)}%` : '—'} />
            </div>

            {/* состояние, прочитанное Max17 */}
            <div className="rounded-xl border border-cyan-300/15 bg-cyan-300/[0.03] px-4 py-3">
              <div className="text-[9px] uppercase tracking-[0.2em] text-cyan-200/50">
                Состояние человека по голосу
              </div>
              <div className="mt-1 text-lg font-bold text-cyan-100">
                {state?.label ?? (listening ? 'считываю…' : '—')}
              </div>
              {state?.baseline?.warming_up && (
                <div className="mt-1 text-[10px] text-amber-300/70">
                  учу твой голос ({state.baseline.obs ?? 0} набл.) — строю норму
                </div>
              )}
            </div>

            <Bar label="Возбуждение" value={state?.arousal} color="from-cyan-500 to-cyan-300" />
            <Bar label="Позитив" value={state?.valence} color="from-emerald-500 to-emerald-300" />
            <Bar label="Напряжение" value={state?.tension} color="from-rose-500 to-amber-300" />

            {/* связь с контекстом разговора */}
            <div className="rounded-xl border border-white/5 bg-white/[0.02] px-4 py-2">
              <div className="text-[9px] uppercase tracking-[0.2em] text-white/35">Контекст разговора</div>
              <div className="mt-0.5 truncate text-[12px] text-white/60">
                {context ? `«${context}»` : 'нет активного сообщения'}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-cyan-300/10 bg-white/[0.02] px-3 py-2 text-center">
      <div className="text-[9px] uppercase tracking-[0.15em] text-cyan-200/40">{label}</div>
      <div className="text-base font-bold text-cyan-100">{value}</div>
    </div>
  );
}

function Bar({ label, value, color }: { label: string; value?: number; color: string }) {
  const pct = Math.round((value ?? 0) * 100);
  return (
    <div>
      <div className="mb-1 flex justify-between text-[10px] uppercase tracking-[0.12em] text-white/45">
        <span>{label}</span>
        <span className="text-cyan-200/70">{pct}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full border border-white/10 bg-black/40">
        <div className={`h-full rounded-full bg-gradient-to-r ${color} transition-all duration-150`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
