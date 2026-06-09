'use client';

// Hands-free voice activation for the HUD.
//
// Two ways to wake Max17 without touching the keyboard:
//   1. Wake word — a continuous SpeechRecognition stream listens for "Макс17 /
//      просыпайся". If the wake phrase is followed by a command in the same
//      utterance ("Макс17, закрой карту") the command fires immediately;
//      otherwise it opens a short window and the NEXT utterance is the command.
//   2. Clap — a Web Audio analyser watches the mic for a sharp energy spike and
//      opens the same command window.
//
// On any captured command we call onCommand(text) — the HUD sends it straight to
// Max17 (no manual "send"). Everything is opt-in (mic permission) and degrades
// gracefully: if SpeechRecognition is missing the clap still works, and vice
// versa.

import { useEffect, useRef } from 'react';

type SpeechRecognitionCtor = new () => SpeechRecognition;

export interface VoiceWakeOptions {
  enabled: boolean;
  lang?: string;
  wakeWords?: string[];
  commandWindowMs?: number;
  onCommand: (text: string) => void;
  onWake?: () => void;
  onStatus?: (status: string) => void;
}

const DEFAULT_WAKE = [
  'макс17',
  'макс 17',
  'максим',
  'макс',
  'max17',
  'max 17',
  'max',
  'просыпайся',
  'проснись',
  'слушай макс',
];

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function useVoiceWake(options: VoiceWakeOptions): void {
  // Latest handlers/config, read at call-time so the effect needn't restart.
  const optsRef = useRef<VoiceWakeOptions>(options);
  useEffect(() => {
    optsRef.current = options;
  });

  // Shared across recognizer + clap detector: when > now, the next utterance is
  // treated as a command.
  const awakeUntilRef = useRef(0);
  const lastClapRef = useRef(0);

  useEffect(() => {
    if (!options.enabled || typeof window === 'undefined') return;

    const SR = (window.SpeechRecognition ?? window.webkitSpeechRecognition) as
      | SpeechRecognitionCtor
      | undefined;
    const wakeWords = (optsRef.current.wakeWords ?? DEFAULT_WAKE).map(normalize);
    const windowMs = optsRef.current.commandWindowMs ?? 8000;
    const lang = optsRef.current.lang ?? 'ru-RU';

    let stopped = false;
    let rec: SpeechRecognition | null = null;
    let restartTimer: number | undefined;

    const status = (s: string) => optsRef.current.onStatus?.(s);

    const stripWake = (text: string): string => {
      let padded = ` ${text} `;
      for (const word of wakeWords) {
        padded = padded.split(` ${word} `).join(' ');
      }
      return padded.replace(/\s+/g, ' ').trim();
    };
    const hasWake = (text: string): boolean => wakeWords.some((word) => text.includes(word));

    const handleTranscript = (raw: string) => {
      const text = normalize(raw);
      if (!text) return;
      const now = Date.now();
      if (awakeUntilRef.current > now) {
        awakeUntilRef.current = 0;
        const command = stripWake(text) || text;
        if (command) optsRef.current.onCommand(command);
        return;
      }
      if (hasWake(text)) {
        const remainder = stripWake(text);
        if (remainder) {
          optsRef.current.onCommand(remainder); // "Макс17, <команда>" in one breath
        } else {
          awakeUntilRef.current = now + windowMs; // woke; next utterance is the command
          optsRef.current.onWake?.();
        }
      }
      // otherwise: ambient speech, ignore.
    };

    // ---- Wake / command recognizer ----
    if (SR) {
      const startRec = () => {
        if (stopped) return;
        try {
          rec = new SR();
          rec.continuous = true;
          rec.interimResults = false;
          rec.lang = lang;
          rec.onresult = (event: SpeechRecognitionEvent) => {
            for (let i = event.resultIndex; i < event.results.length; i++) {
              const result = event.results[i];
              if (result.isFinal) handleTranscript(result[0].transcript);
            }
          };
          rec.onerror = (event) => {
            const err = (event as { error?: string }).error;
            if (err === 'not-allowed' || err === 'service-not-allowed') {
              stopped = true;
              status('mic-denied');
            }
          };
          rec.onend = () => {
            // Chrome ends continuous recognition on silence/timeouts; re-arm it.
            if (!stopped) restartTimer = window.setTimeout(startRec, 400);
          };
          rec.start();
          status('armed');
        } catch {
          // start() throws if already running — safe to ignore.
        }
      };
      startRec();
    } else {
      status('no-speech-api');
    }

    // ---- Clap detector ----
    let audioCtx: AudioContext | null = null;
    let micStream: MediaStream | null = null;
    let rafId = 0;
    let prevLoud = false;

    if (navigator.mediaDevices?.getUserMedia) {
      navigator.mediaDevices
        .getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
        .then((stream) => {
          if (stopped) {
            stream.getTracks().forEach((track) => track.stop());
            return;
          }
          micStream = stream;
          const Ctx =
            window.AudioContext ??
            (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
          if (!Ctx) return;
          audioCtx = new Ctx();
          const source = audioCtx.createMediaStreamSource(stream);
          const analyser = audioCtx.createAnalyser();
          analyser.fftSize = 1024;
          source.connect(analyser);
          const buffer = new Uint8Array(analyser.fftSize);

          const tick = () => {
            if (stopped) return;
            analyser.getByteTimeDomainData(buffer);
            let sum = 0;
            for (let i = 0; i < buffer.length; i++) {
              const v = (buffer[i] - 128) / 128;
              sum += v * v;
            }
            const rms = Math.sqrt(sum / buffer.length);
            const now = Date.now();
            // Rising edge above a loud threshold = clap; debounce 500ms.
            if (rms > 0.18 && !prevLoud && now - lastClapRef.current > 500) {
              lastClapRef.current = now;
              if (awakeUntilRef.current <= now) {
                awakeUntilRef.current = now + windowMs;
                optsRef.current.onWake?.();
              }
            }
            prevLoud = rms > 0.08;
            rafId = window.requestAnimationFrame(tick);
          };
          rafId = window.requestAnimationFrame(tick);
        })
        .catch(() => {
          // Mic denied for clap — wake word may still be active.
        });
    }

    return () => {
      stopped = true;
      if (restartTimer) window.clearTimeout(restartTimer);
      if (rec) {
        rec.onend = null;
        try {
          rec.stop();
        } catch {
          // already stopped
        }
        rec = null;
      }
      if (rafId) window.cancelAnimationFrame(rafId);
      if (audioCtx) audioCtx.close().catch(() => {});
      if (micStream) micStream.getTracks().forEach((track) => track.stop());
    };
  }, [options.enabled, options.lang]);
}
