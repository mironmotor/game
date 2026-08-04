'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { IDLE_SIGNAL, type QuantumSignal } from '@/components/hud/QuantumEyes';

// Хук эфира: держит микрофон + AudioContext, покадрово считает акустику голоса
// (тон f0, регистр, яркость, дрожание, энергию) и пишет её вместе с локальной
// оценкой состояния (возбуждение/позитив/напряжение) в переданный signalRef.
// Один источник правды для квантовых глаз и для 3D-реальности.

const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));

/** Автокорреляционный детектор основного тона (как в звуковой сигнатуре). */
function detectPitch(buf: Float32Array, sr: number): number {
  const N = buf.length;
  let rms = 0;
  for (let i = 0; i < N; i++) rms += buf[i] * buf[i];
  rms = Math.sqrt(rms / N);
  if (rms < 0.008) return -1;
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
  if (best < 0 || bestC < 0.45) return -1;
  let lag = best;
  const a = corr[best - 1];
  const b = corr[best];
  const cc = corr[best + 1];
  const d = a + cc - 2 * b;
  if (d !== 0) lag = best - (0.5 * (cc - a)) / d;
  return sr / lag;
}

export interface EfirSignalApi {
  listening: boolean;
  status: string;
  start: () => Promise<void>;
  stop: () => void;
}

export function useEfirSignal(signalRef: React.MutableRefObject<QuantumSignal>): EfirSignalApi {
  const audioCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const freqAnalyserRef = useRef<AnalyserNode | null>(null);
  const pitchAnalyserRef = useRef<AnalyserNode | null>(null);
  const freqRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const pitchBufRef = useRef<Float32Array<ArrayBuffer> | null>(null);
  const rafRef = useRef<number | null>(null);
  const binHzRef = useRef(0);
  const f0SmoothRef = useRef(0);
  const lastF0Ref = useRef(0);

  const [listening, setListening] = useState(false);
  const [status, setStatus] = useState('Впусти голос — эфир начнёт рождать материю');

  const stop = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    audioCtxRef.current?.close().catch(() => {});
    streamRef.current = null;
    audioCtxRef.current = null;
    freqAnalyserRef.current = null;
    pitchAnalyserRef.current = null;
    signalRef.current = { ...IDLE_SIGNAL };
    setListening(false);
    setStatus('Эфир закрыт. Материя испаряется…');
  }, [signalRef]);

  const start = useCallback(async () => {
    setStatus('Запрашиваю доступ к микрофону…');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const audioCtx = new Ctx();
      await audioCtx.resume();
      const src = audioCtx.createMediaStreamSource(stream);
      const freqA = audioCtx.createAnalyser();
      freqA.fftSize = 4096;
      freqA.smoothingTimeConstant = 0.7;
      const pitchA = audioCtx.createAnalyser();
      pitchA.fftSize = 2048;
      src.connect(freqA);
      src.connect(pitchA);

      audioCtxRef.current = audioCtx;
      streamRef.current = stream;
      freqAnalyserRef.current = freqA;
      pitchAnalyserRef.current = pitchA;
      freqRef.current = new Uint8Array(new ArrayBuffer(freqA.frequencyBinCount));
      pitchBufRef.current = new Float32Array(new ArrayBuffer(pitchA.fftSize * 4));
      binHzRef.current = audioCtx.sampleRate / 4096;
      f0SmoothRef.current = 0;

      const loop = () => {
        const fa = freqAnalyserRef.current;
        const pa = pitchAnalyserRef.current;
        if (!fa || !pa || !freqRef.current || !pitchBufRef.current) return;
        fa.getByteFrequencyData(freqRef.current);
        pa.getFloatTimeDomainData(pitchBufRef.current);

        const rawF0 = detectPitch(pitchBufRef.current, audioCtx.sampleRate);
        const voiced = rawF0 >= 65 && rawF0 <= 1200;
        if (voiced) f0SmoothRef.current = f0SmoothRef.current ? f0SmoothRef.current * 0.7 + rawF0 * 0.3 : rawF0;
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
        let jitter = 0;
        if (F0 && lastF0Ref.current) jitter = clamp(Math.abs(F0 - lastF0Ref.current) / 12);
        if (F0) lastF0Ref.current = F0;

        // локальная оценка состояния (те же правила, что и voice_state.py)
        const tension = clamp(0.55 * jitter + 0.25 * register + 0.2 * energy);
        const arousal = clamp(0.4 * register + 0.3 * brightness + 0.3 * energy);
        const valence = clamp(0.5 + 0.25 * (brightness - 0.5) - 0.4 * jitter - 0.25 * (tension - 0.5));

        signalRef.current = { f0: F0, register, brightness, jitter, energy, voiced, arousal, valence, tension };
        rafRef.current = requestAnimationFrame(loop);
      };

      setListening(true);
      setStatus('✅ Эфир открыт. Говори — голос становится материей');
      loop();
    } catch (err) {
      setStatus(`Микрофон недоступен: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [signalRef]);

  useEffect(() => () => stop(), [stop]);

  return { listening, status, start, stop };
}
