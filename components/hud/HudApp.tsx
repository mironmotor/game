'use client';

import React, { useState, useRef, useEffect, useCallback, Component, type ReactNode, type ErrorInfo } from 'react';
import { GameHud, type HudNavId } from './GameHud';
import { useGameState, type Task } from '@/hooks/use-game-state';
import { useMirCoin } from '@/hooks/use-mircoin';
import { sendMax17Event, type Max17Response } from '@/lib/max17-client';
import { reachGoal } from '@/lib/metrika';
import { VoiceSignature } from './VoiceSignature';
import { MusicDecomposer } from './music-decompose';
import { generateDreamTrack, playBuffer, type DreamTaste } from './dream-music';
import { AppearancePanel } from './AppearancePanel';
import { applyTheme, initTheme } from './themes';
import { initRainbow } from './rainbow';
import { WindowManagerProvider, useWindowManager } from './window-manager';
import { interpretUiCommand, type UiCommand } from './ui-commands';
import { detectFaces, prewarmFaceApi, type FaceReading } from './face-detect';
import { useVoiceWake } from './use-voice-wake';
import { CodeConsole } from './CodeConsole';
import { CodeTerminal } from './CodeTerminal';
import { DesktopConsole } from './DesktopConsole';
import { ArchitectConsole } from './ArchitectConsole';
import { ModelSwitcher } from './ModelSwitcher';
import { initJarvis } from '@/lib/jarvis-voice';
import { getPersona, speakNeural, stopNeural } from '@/lib/neural-voice';
import { useI18n } from '@/components/I18nProvider';
import './hud.css';
import './rainbow.css';

type Max17HudEvent = Record<string, unknown>;
type CameraStatus = 'off' | 'starting' | 'active' | 'error';
type GodModeAction =
  | 'chat'
  | 'stars'
  | 'import'
  | 'map'
  | 'dream'
  | 'neural'
  | 'status'
  | 'evolution'
  | 'council'
  | 'kickoff'
  | 'sleep'
  | 'all'
  | 'reset';

// Voice-movable camera positions (full literal classes so Tailwind JIT keeps them).
const CAMERA_POS: Record<'bottom' | 'left' | 'right' | 'top', string> = {
  bottom: 'bottom-[172px] left-1/2 -translate-x-1/2',
  left: 'bottom-[172px] left-4',
  right: 'bottom-[172px] right-4',
  top: 'top-24 left-1/2 -translate-x-1/2',
};

interface CameraObservation {
  width: number;
  height: number;
  brightness: number;
  contrast: number;
  motion_score: number;
  stability: number;
  dominant_color: {
    r: number;
    g: number;
    b: number;
  };
  dominant_tone: string;
  light_level: string;
  motion_level: string;
  scene_mode: string;
  summary: string;
}

interface CameraFrameAnalysis {
  observation: CameraObservation;
  luminance: number[];
}

interface PrivateReflectionPayload {
  trigger: string;
  ok: boolean;
  userText?: string;
  route?: string;
  confidence?: number;
  next?: string;
  error?: string;
  latencyMs?: number;
}

class FirestoreErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; errorInfo: unknown }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error) {
    // The HUD's data path throws plain Error objects (e.g. an empty or failed
    // /api/max17 response), so don't assume error.message is JSON. Use a parsed
    // object only when it actually decodes to one carrying an `error` field;
    // otherwise fall back to the raw message.
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(error.message);
    } catch {
      parsed = null;
    }
    if (parsed && typeof parsed === 'object' && 'error' in parsed) {
      return { hasError: true, errorInfo: parsed };
    }
    return { hasError: true, errorInfo: { error: error.message } };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('HUD Firestore error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      const info = this.state.errorInfo as { error?: string };
      return (
        <div className="hud-loading" style={{ flexDirection: 'column', gap: 16 }}>
          <p>Ошибка синхронизации</p>
          <p style={{ letterSpacing: '0.1em', opacity: 0.6, fontSize: 10 }}>
            {info?.error || 'Неизвестная ошибка'}
          </p>
          <button type="button" onClick={() => window.location.reload()} style={{ color: '#00f2ff' }}>
            Перезагрузить
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function calcTopPercent(rank: number) {
  const total = 782739;
  return Math.min(99.99, (rank / total) * 100).toFixed(2);
}

function getLlmText(response: Max17Response) {
  const text = response.llm?.text;
  if (typeof text !== 'string') return '';
  if (response.llm?.status === 'skipped') return '';
  return text.trim();
}

function getSecureGameUrl() {
  if (typeof window === 'undefined') return 'https://<IP этого Mac>:3002/game';
  return `https://${window.location.hostname}:3002/game`;
}

function formatRecalledMemory(response: Max17Response) {
  const recalled = response.memory?.recalled ?? [];
  if (!recalled.length) return 'Память: близких совпадений пока нет.';

  return `Память: ${recalled
    .slice(0, 3)
    .map((item) => item.summary || item.reinforce || item.event_type || 'событие')
    .join(' · ')}`;
}

function formatMax17HudReply(response: Max17Response) {
  const composedText = response.answer?.text?.trim();
  if (composedText) return composedText;

  const llmText = getLlmText(response);
  if (llmText) {
    return [
      llmText,
      formatRecalledMemory(response),
      response.next_adaptation ? `Подсказка Max17: ${response.next_adaptation}` : '',
    ]
      .filter(Boolean)
      .join(' ');
  }

  const confidence = Math.round(response.confidence * 100);
  const routeLine = `Маршрут: ${response.route || 'unknown'} · уверенность ${confidence}%`;
  const adaptationLine = response.next_adaptation
    ? `Следующая адаптация: ${response.next_adaptation}`
    : 'Следующая адаптация: наблюдать паттерн и копить контекст.';
  const reason = response.self_evaluation?.reason
    ? `Оценка: ${response.self_evaluation.reason}`
    : '';

  return [routeLine, formatRecalledMemory(response), adaptationLine, reason].filter(Boolean).join(' ');
}

function toneFromRgb(r: number, g: number, b: number) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max - min < 18) return 'neutral';
  if (r >= g && r >= b) return g > b ? 'warm' : 'red';
  if (g >= r && g >= b) return r > b ? 'yellow-green' : 'green';
  return r > g ? 'violet-blue' : 'cool-blue';
}

function lightLevelFromBrightness(brightness: number) {
  if (brightness < 0.22) return 'low';
  if (brightness < 0.58) return 'medium';
  return 'high';
}

function motionLevelFromScore(score: number) {
  if (score < 0.035) return 'still';
  if (score < 0.12) return 'subtle';
  return 'moving';
}

// Honest scene label from measurable signals only (light + motion). We do NOT
// recognize objects, faces or furniture, so we never claim "desk"/"screen"/"room"
// — that was guesswork that made Max17 say "за столом" when it cannot know.
function sceneModeFromVision({
  brightness,
  motionScore,
}: {
  brightness: number;
  motionScore: number;
}) {
  if (motionScore > 0.16) return 'active';
  if (brightness < 0.2) return 'dark';
  if (brightness > 0.72) return 'bright';
  return 'calm';
}

function visionSummaryText(observation: Omit<CameraObservation, 'summary'>) {
  const modeText: Record<string, string> = {
    dark: 'темно',
    bright: 'светло',
    active: 'в кадре есть движение',
    calm: 'спокойно, заметного движения нет',
  };
  const lightText: Record<string, string> = {
    low: 'слабый свет',
    medium: 'средний свет',
    high: 'яркий свет',
  };
  const motionText: Record<string, string> = {
    still: 'кадр почти неподвижен',
    subtle: 'есть небольшое движение',
    moving: 'заметное движение',
  };

  return [
    modeText[observation.scene_mode] ?? observation.scene_mode,
    lightText[observation.light_level] ?? observation.light_level,
    motionText[observation.motion_level] ?? observation.motion_level,
  ].join('; ');
}

function analyzeCameraFrame(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  previousLuminance: number[] | null,
): CameraFrameAnalysis | null {
  const sourceWidth = video.videoWidth;
  const sourceHeight = video.videoHeight;
  if (!sourceWidth || !sourceHeight) return null;

  const sampleWidth = 64;
  const sampleHeight = Math.max(1, Math.round((sourceHeight / sourceWidth) * sampleWidth));
  canvas.width = sampleWidth;
  canvas.height = sampleHeight;

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  ctx.drawImage(video, 0, 0, sampleWidth, sampleHeight);
  const data = ctx.getImageData(0, 0, sampleWidth, sampleHeight).data;
  let r = 0;
  let g = 0;
  let b = 0;
  let brightness = 0;
  const luminance: number[] = [];
  const pixels = data.length / 4;

  for (let i = 0; i < data.length; i += 4) {
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
    const y = (data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722) / 255;
    brightness += y;
    luminance.push(y);
  }

  const avgR = Math.round(r / pixels);
  const avgG = Math.round(g / pixels);
  const avgB = Math.round(b / pixels);
  const normalizedBrightness = brightness / pixels;
  const variance =
    luminance.reduce((sum, value) => sum + (value - normalizedBrightness) ** 2, 0) / pixels;
  const contrast = Math.sqrt(variance);
  const motionScore =
    previousLuminance && previousLuminance.length === luminance.length
      ? luminance.reduce((sum, value, index) => sum + Math.abs(value - previousLuminance[index]), 0) /
        luminance.length
      : 0;
  const dominantTone = toneFromRgb(avgR, avgG, avgB);
  const lightLevel = lightLevelFromBrightness(normalizedBrightness);
  const motionLevel = motionLevelFromScore(motionScore);
  const sceneMode = sceneModeFromVision({
    brightness: normalizedBrightness,
    motionScore,
  });
  const observationWithoutSummary = {
    width: sourceWidth,
    height: sourceHeight,
    brightness: Number(normalizedBrightness.toFixed(3)),
    contrast: Number(contrast.toFixed(3)),
    motion_score: Number(motionScore.toFixed(3)),
    stability: Number((1 - Math.min(1, motionScore * 4)).toFixed(3)),
    dominant_color: {
      r: avgR,
      g: avgG,
      b: avgB,
    },
    dominant_tone: dominantTone,
    light_level: lightLevel,
    motion_level: motionLevel,
    scene_mode: sceneMode,
  };

  return {
    observation: {
      ...observationWithoutSummary,
      summary: visionSummaryText(observationWithoutSummary),
    },
    luminance,
  };
}

async function requestCameraStream() {
  // facingMode is only meaningful on phones; on a laptop it can trigger an
  // OverconstrainedError on some browsers. Try the preference first, then fall
  // back to the most compatible request so a Mac front camera always works.
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false,
    });
  } catch (firstError) {
    if (process.env.NODE_ENV === 'development') {
      console.debug('[Max17 HUD] preferred camera unavailable, trying generic camera', firstError);
    }
  }

  return navigator.mediaDevices.getUserMedia({ video: true, audio: false });
}

function HudContent() {
  const { locale, t, formatTime, formatDate, adaptToText } = useI18n();
  const {
    xp,
    tasks,
    rank,
    isLoaded,
    completeTask,
    addTasks,
    createSession,
    saveMessage,
    sessions,
  } = useGameState();
  const { balance: mirCoinBalance, earn: earnMirCoin } = useMirCoin();

  const wm = useWindowManager();

  const [now, setNow] = useState(() => new Date());
  const [input, setInput] = useState('');
  // Прикреплённый файл: содержимое уходит Максу вместе с сообщением.
  const [attached, setAttached] = useState<{ name: string; text: string } | null>(null);
  const [agiMessage, setAgiMessage] = useState(() => t('hud.tagline'));
  const [isListening, setIsListening] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [handsFree, setHandsFree] = useState(false);
  const [codeOpen, setCodeOpen] = useState(false);
  /**
   * Узкий экран. Порог 700px — тот же, что у раскладки HUD в hud.css, а не
   * Tailwind-овские 640: иначе в промежутке телефон получал бы десктопный
   * терминал, оставаясь мобильным во всём остальном.
   *
   * Стартовое значение false, а не измерение при инициализации: на сервере
   * ширины нет, и любое «угаданное» значение разошлось бы с разметкой при
   * гидратации.
   */
  const [compactViewport, setCompactViewport] = useState(false);

  useEffect(() => {
    const query = window.matchMedia('(max-width: 700px)');
    const sync = () => setCompactViewport(query.matches);
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);
  const [codeTask, setCodeTask] = useState('');
  const [codeTarget, setCodeTarget] = useState<'sandbox' | 'project'>('sandbox');
  const [desktopOpen, setDesktopOpen] = useState(false);
  const [desktopTask, setDesktopTask] = useState('');
  const [architectOpen, setArchitectOpen] = useState(false);
  const [modelsOpen, setModelsOpen] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [appearanceOpen, setAppearanceOpen] = useState(false);

  // Restore the persisted HUD theme (CSS variable overrides) on mount.
  useEffect(() => {
    initTheme();
    initRainbow();
  }, []);
  const [isSpeechEnabled, setIsSpeechEnabled] = useState(true);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [cameraStatus, setCameraStatus] = useState<CameraStatus>('off');
  const [cameraError, setCameraError] = useState('');
  const [cameraCorner, setCameraCorner] = useState<'bottom' | 'left' | 'right' | 'top'>('bottom');
  const [activeNav, setActiveNav] = useState<HudNavId>('codex');
  const [navBadges, setNavBadges] = useState<Partial<Record<HudNavId, number>>>({});
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [max17State, setMax17State] = useState<
    | (Pick<Max17Response, 'route' | 'confidence' | 'next_adaptation'> & {
        voiceModel?: string;
        voiceOk?: boolean;
      })
    | null
  >(null);
  const [log, setLog] = useState<string[]>([]);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null);
  const cameraCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const cameraOverlayRef = useRef<HTMLCanvasElement | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const previousCameraLuminanceRef = useRef<number[] | null>(null);
  const faceReadingRef = useRef<FaceReading | null>(null);
  const motionRef = useRef(0);
  const cameraStatusRef = useRef<CameraStatus>('off');
  const toggleCameraRef = useRef<() => void>(() => {});
  const systemStateSentRef = useRef(false);
  const knownTaskIdsRef = useRef<Set<string>>(new Set());
  const emittedFailedTaskIdsRef = useRef<Set<string>>(new Set());
  // Phase 3 autonomous flywheel: while the HUD is idle the core researches its
  // OWN self-proposed topics in the background (actual web fetch is gated
  // server-side by MAX17_AUTO_WEB). These refs track when to trigger it.
  const lastActivityRef = useRef<number>(Date.now());
  const lastGrowRef = useRef<number>(0);
  const isLoadingRef = useRef<boolean>(false);
  const privateReflectionRef = useRef<{ lastAt: number; lastKey: string }>({ lastAt: 0, lastKey: '' });
  // Music ears (Phase 9): while ON, ~20s listening windows go to the core as
  // music_observation — Max evaluates tracks (кайф-скор) and grows taste.
  const musicRef = useRef<MusicDecomposer | null>(null);
  const [musicListening, setMusicListening] = useState(false);
  // Dreaming Music: Max composes under his own mood — on request or on insight.
  const dreamStopRef = useRef<(() => void) | null>(null);
  const lastComposeRef = useRef<number>(0);

  useEffect(() => {
    if (!musicListening) {
      musicRef.current?.stop();
      musicRef.current = null;
      return;
    }
    const ears = new MusicDecomposer();
    musicRef.current = ears;
    void ears.start().then((ok) => {
      if (!ok) {
        setMusicListening(false);
        setAgiMessage('MAX17: не получил доступ к микрофону для музыки.');
      }
    });
    const interval = window.setInterval(() => {
      const summary = musicRef.current?.summarize(20);
      if (!summary || summary.energy < 0.04) return;
      void emitMax17HudEvent({ type: 'music_observation', music: summary }).then((res) => {
        const note = res?.answer?.text;
        if (note) pushLog(`🎵 ${note}`);
      });
    }, 21000);
    return () => {
      window.clearInterval(interval);
      ears.stop();
      if (musicRef.current === ears) musicRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [musicListening]);

  useEffect(() => {
    isLoadingRef.current = isLoading;
  }, [isLoading]);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Client-error ring buffer for the Doctor dashboard. Browser JS errors and
  // unhandled promise rejections are logged to window.__maxClientErrors (last 20);
  // the /доктор sweep reads them and surfaces them as GAME health issues.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const w = window as unknown as { __maxClientErrors?: string[] };
    if (!Array.isArray(w.__maxClientErrors)) w.__maxClientErrors = [];
    const push = (msg: string) => {
      const buf = w.__maxClientErrors!;
      buf.push(`${new Date().toISOString()} ${msg}`.slice(0, 240));
      if (buf.length > 20) buf.splice(0, buf.length - 20);
    };
    const onError = (e: ErrorEvent) => push(`error: ${e.message || 'unknown'}`);
    const onRej = (e: PromiseRejectionEvent) => {
      const r = e.reason;
      push(`unhandled: ${r instanceof Error ? r.message : String(r)}`);
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRej);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRej);
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const SR = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!SR) return;

    const rec = new SR();
    rec.continuous = false;
    rec.interimResults = true;
    rec.lang = locale;

    rec.onresult = (event: SpeechRecognitionEvent) => {
      let finalTranscript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript;
        }
      }
      if (finalTranscript) {
        adaptToText(finalTranscript);
        setInput((prev) => (prev ? `${prev} ${finalTranscript}` : finalTranscript).trim());
      }
    };

    rec.onerror = () => setIsListening(false);
    rec.onend = () => setIsListening(false);
    recognitionRef.current = rec;
    return () => {
      rec.onresult = null;
      rec.onerror = null;
      rec.onend = null;
      try {
        rec.stop();
      } catch {
        // Recognition was not started.
      }
      if (recognitionRef.current === rec) recognitionRef.current = null;
    };
  }, [adaptToText, locale]);

  const toggleListen = useCallback(() => {
    if (typeof window !== 'undefined' && !window.isSecureContext) {
      setAgiMessage(`MAX17: микрофон заблокирован HTTP. Открой ${getSecureGameUrl()} в Safari.`);
      return;
    }
    const rec = recognitionRef.current;
    if (!rec) {
      setAgiMessage('MAX17: этот браузер не поддерживает голосовой ввод. Открой GAME напрямую в Safari, не во встроенном браузере мессенджера.');
      return;
    }
    if (isListening) {
      rec.stop();
      setIsListening(false);
    } else {
      setIsListening(true);
      rec.start();
    }
  }, [isListening]);

  const speakMax17 = useCallback(
    (text: string) => {
      if (!isSpeechEnabled || typeof window === 'undefined') return;
      const cleanText = text.replace(/\s+/g, ' ').trim();
      if (!cleanText) return;
      // Neural ElevenLabs voice (JARVIS/Пятница), with system-voice fallback;
      // both paths emit max:speaking so the arc-reactor/core glow under speech.
      void speakNeural(cleanText, {
        onStart: () => setIsSpeaking(true),
        onEnd: () => setIsSpeaking(false),
      });
    },
    [isSpeechEnabled],
  );

  // Any component can make MAX speak aloud (e.g. the game-companion reactions).
  useEffect(() => {
    const onSay = (e: Event) => {
      const t = (e as CustomEvent<{ text?: string }>).detail?.text;
      if (t) speakMax17(String(t));
    };
    window.addEventListener('max:say', onSay as EventListener);
    return () => window.removeEventListener('max:say', onSay as EventListener);
  }, [speakMax17]);

  // Short rising "beep" so waking is felt even with TTS off.
  const playCue = useCallback(() => {
    if (typeof window === 'undefined') return;
    try {
      const Ctx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 880;
      osc.connect(gain);
      gain.connect(ctx.destination);
      const t = ctx.currentTime;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.2, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      osc.start(t);
      osc.stop(t + 0.2);
      osc.onended = () => ctx.close().catch(() => {});
    } catch {
      // audio cue is best-effort
    }
  }, []);

  const toggleSpeech = useCallback(() => {
    if (isSpeechEnabled) {
      stopNeural();
      setIsSpeaking(false);
      setIsSpeechEnabled(false);
      return;
    }

    setIsSpeechEnabled(true);
    playCue();
    void speakNeural(t('hud.soundOn'), {
      onStart: () => setIsSpeaking(true),
      onEnd: () => setIsSpeaking(false),
    });
  }, [isSpeechEnabled, playCue, t]);

  const toggleHandsFree = useCallback(() => setHandsFree((on) => !on), []);

  const emitMax17HudEvent = useCallback(
    async (event: Max17HudEvent, surfaceState = false) => {
      try {
        const max17 = await sendMax17Event(event);
        if (surfaceState) {
          // Surface WHICH brain voiced this answer, so the Gonka link is visible
          // (llm_voice is the cloud voice layer; "синапсы" = deterministic core).
          const voice = (max17 as { llm_voice?: { model?: string; status?: string } }).llm_voice;
          setMax17State({
            route: max17.route,
            confidence: max17.confidence,
            next_adaptation: max17.next_adaptation,
            voiceModel: voice?.status === 'ok' ? String(voice.model || '').split('/').pop() : undefined,
            voiceOk: voice?.status === 'ok',
          });
        }
        if (process.env.NODE_ENV === 'development') {
          console.debug('[Max17 HUD]', {
            type: event.type,
            route: max17.route,
            confidence: max17.confidence,
            next_adaptation: max17.next_adaptation,
          });
        }
        return max17;
      } catch (error) {
        if (surfaceState) {
          setMax17State(null);
        }
        if (process.env.NODE_ENV === 'development') {
          console.debug('[Max17 HUD] event skipped', { type: event.type, error });
        }
        return null;
      }
    },
    [],
  );

  // Nav tabs open the real panels (not just highlight the tab).
  const handleNavChange = useCallback((id: HudNavId) => {
    setActiveNav(id);
    const ev: Record<HudNavId, string> = {
      inventory: 'godmode:open',
      skills: 'skills:toggle',
      codex: 'corpus:open',
      quests: 'missions:open',
      friends: 'angels:open',
    };
    window.dispatchEvent(new CustomEvent(ev[id]));
  }, []);

  // Live nav badge: number of open missions on the «Квесты» tab (refreshed each minute).
  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      try {
        const r = (await sendMax17Event({ type: 'missions', action: 'list' })) as { missions?: { open_count?: number } };
        if (alive) setNavBadges((b) => ({ ...b, quests: r.missions?.open_count ?? 0 }));
      } catch {
        /* badge is best-effort */
      }
    };
    void refresh();
    const t = setInterval(refresh, 60000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const recordPrivateReflection = useCallback((payload: PrivateReflectionPayload) => {
    const now = Date.now();
    const key = [
      payload.trigger,
      payload.ok ? 'ok' : 'fail',
      payload.route ?? '',
      (payload.userText ?? '').slice(0, 96),
    ].join('|');
    if (privateReflectionRef.current.lastKey === key && now - privateReflectionRef.current.lastAt < 30_000) return;
    privateReflectionRef.current = { lastAt: now, lastKey: key };

    const text = [
      `private_self_reflection trigger=${payload.trigger}`,
      `ok=${payload.ok}`,
      payload.route ? `route=${payload.route}` : '',
      typeof payload.confidence === 'number' ? `confidence=${Math.round(payload.confidence * 100)}%` : '',
      typeof payload.latencyMs === 'number' ? `latency_ms=${payload.latencyMs}` : '',
      payload.userText ? `user="${payload.userText.slice(0, 220)}"` : '',
      payload.next ? `next="${payload.next.slice(0, 220)}"` : '',
      payload.error ? `error="${payload.error.slice(0, 220)}"` : '',
      'visibility=private_only_for_max',
    ]
      .filter(Boolean)
      .join(' | ');

    void sendMax17Event({
      type: 'agent_experience',
      agent: 'max_private_reflection',
      text,
      ok: payload.ok,
      private: true,
      source: 'hud_private_reflection',
      trigger: payload.trigger,
      route: payload.route,
      confidence: payload.confidence,
      latency_ms: payload.latencyMs,
      next_adaptation: payload.next,
      timestamp: new Date(now).toISOString(),
    }).catch(() => {});
  }, []);

  const pushLog = useCallback((line: string) => {
    const clean = line.trim();
    if (!clean) return;
    setLog((prev) => [clean, ...prev].slice(0, 24));
  }, []);

  // Светило в сцене будит ядро вне расписания: обычный такт приходит раз в
  // минуту, но человеку иногда нужно «сейчас». Ответ возвращаем событием —
  // кнопка живёт в фоне и о сети ничего не знает.
  useEffect(() => {
    const onUltra = async () => {
      window.dispatchEvent(new CustomEvent('max:thinking', { detail: { active: true } }));
      try {
        const res = await emitMax17HudEvent({ type: 'ultra_think' });
        const ultra = (res as { ultra?: { decision?: { action?: string; reason?: string } } })?.ultra;
        const action = ultra?.decision?.action;
        const reason = ultra?.decision?.reason;
        const note = action ? `${action}${reason ? ` — ${reason}` : ''}` : String(res?.next_adaptation || 'такт прошёл');
        if (note) {
          pushLog(`🌈 УЛЬТРА: ${note}`);
          setAgiMessage(`MAX17: ${note}`);
        }
        window.dispatchEvent(new CustomEvent('max:ultra-result', { detail: { ok: true, note } }));
      } catch (e) {
        window.dispatchEvent(
          new CustomEvent('max:ultra-result', { detail: { ok: false, note: 'ядро не ответило' } }),
        );
        console.error('ultra по клику не прошёл:', e);
      } finally {
        window.dispatchEvent(new CustomEvent('max:thinking', { detail: { active: false } }));
      }
    };
    window.addEventListener('max:ultra', onUltra as EventListener);
    return () => window.removeEventListener('max:ultra', onUltra as EventListener);
  }, [emitMax17HudEvent, pushLog]);


  // JARVIS приветствует при входе: текст сразу, голос — на первый жест
  // пользователя (политика автоплея браузера блокирует звук до взаимодействия).
  const greetedRef = useRef(false);
  const greetedLocaleRef = useRef('');
  useEffect(() => {
    initJarvis();
    const persona = getPersona();
    const greeting = t(
      persona === 'friday' ? 'greeting.friday' : 'greeting.jarvis',
      { name: 'GAME' },
    );
    const who = persona === 'friday' ? 'FRIDAY' : 'JARVIS';
    if (greetedLocaleRef.current !== locale) {
      greetedLocaleRef.current = locale;
      setAgiMessage(`MAX17: ${greeting}`);
      pushLog(`${who}: ${greeting}`);
    }
    if (greetedRef.current) return;
    greetedRef.current = true;
    const speakOnce = () => {
      window.removeEventListener('pointerdown', speakOnce);
      window.removeEventListener('keydown', speakOnce);
      speakMax17(greeting);
    };
    window.addEventListener('pointerdown', speakOnce, { once: true });
    window.addEventListener('keydown', speakOnce, { once: true });
    return () => {
      window.removeEventListener('pointerdown', speakOnce);
      window.removeEventListener('keydown', speakOnce);
    };
  }, [locale, pushLog, speakMax17, t]);

  // Max composes under his own mood — on voice request («сочини трек») or
  // automatically on insight / when Ultra decides "compose".
  const composeMoodTrack = useCallback(
    async (auto = false) => {
      const now = Date.now();
      if (auto && now - lastComposeRef.current < 600_000) return; // авто — не чаще раза в 10 мин
      lastComposeRef.current = now;
      try {
        const res = (await sendMax17Event({ type: 'dream_mood', insight: auto })) as {
          dream_mood?: DreamTaste & { label?: string; reason?: string };
        };
        const mood = res.dream_mood || {};
        const buffer = await generateDreamTrack(mood, mood.label || 'mood');
        dreamStopRef.current?.();
        dreamStopRef.current = playBuffer(buffer);
        const note = `🎼 ${auto ? 'Инсайт! ' : ''}Dreaming: ${mood.label || 'трек'} (~${mood.avg_bpm} BPM, ${mood.fav_key} ${mood.mode})`;
        pushLog(note);
        setAgiMessage(`MAX17: ${note}`);
      } catch {
        if (!auto) setAgiMessage('MAX17: не смог сочинить — попробуй ещё раз.');
      }
    },
    [pushLog],
  );

  const executeUiCommand = useCallback(
    (command: UiCommand) => {
      switch (command.kind) {
        case 'open':
          wm.openWindow(command.target);
          break;
        case 'close':
          wm.closeWindow(command.target);
          break;
        case 'toggle':
          wm.toggleWindow(command.target);
          break;
        case 'minimize':
          wm.minimizeWindow(command.target, true);
          break;
        case 'background':
          if (command.value === 'next') wm.cycleBackground();
          else wm.setBackground(command.value);
          break;
        case 'theme':
          applyTheme(command.value);
          break;
        case 'music':
          setMusicListening(command.action === 'start');
          break;
        case 'compose':
          void composeMoodTrack(false);
          break;
        case 'introspect':
          void emitMax17HudEvent({ type: 'introspect' }).then((res) => {
            const note = res?.answer?.text;
            if (note) {
              pushLog(`💭 ${note}`);
              setAgiMessage(`MAX17: ${note}`);
              speakMax17(note.replace(/^[^\wа-яА-Я]+/, ''));
            }
          });
          break;
        case 'reset':
          wm.resetLayout();
          break;
        case 'showAll':
          wm.showAll();
          break;
        case 'closeAll':
          wm.closeAll();
          break;
        case 'camera': {
          const active = cameraStatusRef.current === 'active' || cameraStatusRef.current === 'starting';
          if (command.action === 'move') {
            const corner = { left: 'left', right: 'right', up: 'top', down: 'bottom', center: 'bottom' } as const;
            setCameraCorner(corner[command.dir ?? 'center']);
          } else if (command.action === 'open') {
            if (!active) toggleCameraRef.current();
          } else if (command.action === 'close') {
            if (active) toggleCameraRef.current();
          } else {
            toggleCameraRef.current();
          }
          break;
        }
      }
    },
    [wm, composeMoodTrack, emitMax17HudEvent, pushLog, speakMax17],
  );

  const runGodModeAction = useCallback(
    async (action: GodModeAction) => {
      let reflectionNote = '';
      switch (action) {
        case 'chat':
          executeUiCommand({ kind: 'open', target: 'chat' });
          executeUiCommand({ kind: 'open', target: 'output' });
          reflectionNote = 'chat and output windows opened';
          setAgiMessage('MAX17: чат открыт.');
          break;
        case 'stars':
          window.dispatchEvent(new CustomEvent('max3d:toggle'));
          reflectionNote = '3D star core toggled';
          setAgiMessage('MAX17: звёздное ядро переключено.');
          break;
        case 'import':
          window.dispatchEvent(new CustomEvent('corpus:toggle'));
          reflectionNote = 'corpus import toggled';
          setAgiMessage('MAX17: импорт корпуса открыт.');
          break;
        case 'map':
          executeUiCommand({ kind: 'open', target: 'minimap' });
          reflectionNote = 'minimap opened';
          setAgiMessage('MAX17: карта открыта.');
          break;
        case 'dream':
          setAppearanceOpen(true);
          executeUiCommand({ kind: 'compose' });
          reflectionNote = 'dream synthesis started';
          setAgiMessage('MAX17: синтез сна запущен.');
          break;
        case 'neural': {
          pushLog('⚒ Кузница синапсов: кую связи по смыслу…');
          setAgiMessage('MAX17: нейросинтез запущен.');
          window.dispatchEvent(new CustomEvent('max:thinking', { detail: { active: true } }));
          try {
            const res = await emitMax17HudEvent({ type: 'synapse_forge' });
            const note = res?.answer?.text || res?.next_adaptation || 'Нейросинтез завершён.';
            reflectionNote = note;
            pushLog(`⚒ ${note}`);
            setAgiMessage(`MAX17: ${note}`);
          } finally {
            window.dispatchEvent(new CustomEvent('max:thinking', { detail: { active: false } }));
          }
          break;
        }
        case 'status':
          executeUiCommand({ kind: 'open', target: 'status' });
          executeUiCommand({ kind: 'open', target: 'player' });
          reflectionNote = 'status and player windows opened';
          setAgiMessage('MAX17: статус игры открыт.');
          break;
        case 'evolution': {
          pushLog('🧠 MAX растёт: ищу пробелы и учусь…');
          setAgiMessage('MAX17: эволюция запущена.');
          window.dispatchEvent(new CustomEvent('max:thinking', { detail: { active: true } }));
          try {
            const grow = await emitMax17HudEvent({ type: 'autonomous_research', limit: 3 });
            const ar = (grow as {
              autonomous_research?: { network?: boolean; facts_learned?: number; items?: Array<{ topic: string; facts: number }> };
            })?.autonomous_research;
            const line = ar?.network
              ? `MAX изучил ${(ar.items ?? []).length} тем (+${ar.facts_learned ?? 0} фактов)`
              : 'Веб-обучение выключено, рост остался локальным.';
            reflectionNote = line;
            pushLog(`🧠 ${line}`);
            setAgiMessage(`MAX17: ${line}`);
          } finally {
            window.dispatchEvent(new CustomEvent('max:thinking', { detail: { active: false } }));
          }
          break;
        }
        case 'council':
          window.dispatchEvent(new CustomEvent('angels:open'));
          reflectionNote = 'council opened';
          setAgiMessage('MAX17: совет открыт.');
          break;
        case 'kickoff':
          window.dispatchEvent(new CustomEvent('angels:kickoff'));
          reflectionNote = 'day kickoff started';
          setAgiMessage('MAX17: разгон дня запущен.');
          break;
        case 'sleep': {
          setAppearanceOpen(true);
          pushLog('☾ Сон: консолидация памяти…');
          setAgiMessage('MAX17: ухожу в сон и консолидацию.');
          window.dispatchEvent(new CustomEvent('max:thinking', { detail: { active: true } }));
          try {
            const res = await emitMax17HudEvent({ type: 'sleep_consolidation' });
            const note = res?.answer?.text || res?.next_adaptation || 'Сон завершён.';
            reflectionNote = note;
            pushLog(`☾ ${note}`);
            setAgiMessage(`MAX17: ${note}`);
          } finally {
            window.dispatchEvent(new CustomEvent('max:thinking', { detail: { active: false } }));
          }
          break;
        }
        case 'all':
          executeUiCommand({ kind: 'showAll' });
          reflectionNote = 'all windows shown';
          setAgiMessage('MAX17: все окна показаны.');
          break;
        case 'reset':
          executeUiCommand({ kind: 'reset' });
          reflectionNote = 'HUD layout reset';
          setAgiMessage('MAX17: HUD сброшен.');
          break;
      }
      recordPrivateReflection({
        trigger: `godmode:${action}`,
        ok: true,
        route: 'godmode',
        next: reflectionNote || action,
      });
    },
    [emitMax17HudEvent, executeUiCommand, pushLog, recordPrivateReflection],
  );

  useEffect(() => {
    const onRun = (event: Event) => {
      const action = (event as CustomEvent<{ action?: GodModeAction }>).detail?.action;
      if (!action) return;
      void runGodModeAction(action);
    };
    window.addEventListener('godmode:run', onRun);
    return () => window.removeEventListener('godmode:run', onRun);
  }, [runGodModeAction]);

  const captureEnvironmentObservation = useCallback(async (announce = true) => {
    const video = cameraVideoRef.current;
    const canvas = cameraCanvasRef.current;
    if (!video || !canvas) return null;

    const analysis = analyzeCameraFrame(video, canvas, previousCameraLuminanceRef.current);
    if (!analysis) return null;

    previousCameraLuminanceRef.current = analysis.luminance;
    const observation = analysis.observation;
    // Face detection runs in the overlay loop; reuse its latest result here so we
    // don't run TinyFaceDetector twice. null => model not ready / unavailable.
    const faceReading = faceReadingRef.current;
    const hasFaces = faceReading ? faceReading.count > 0 : undefined;
    const facesText = faceReading
      ? faceReading.count > 0
        ? `, лиц в кадре: ${faceReading.count}`
        : ', лиц в кадре нет'
      : '';

    const max17 = await emitMax17HudEvent(
      {
        type: 'environment_observation',
        text: `Vision: свет ${observation.light_level}, движение ${observation.motion_level}${facesText}`,
        source: 'hud_camera',
        timestamp: new Date().toISOString(),
        camera: {
          active: true,
          ...observation,
          faces: faceReading?.count,
          person: hasFaces,
          face_coverage: faceReading?.coverage,
          vision_summary: {
            scene_mode: observation.scene_mode,
            summary: observation.summary,
            light_level: observation.light_level,
            motion_level: observation.motion_level,
            stability: observation.stability,
            faces: faceReading?.count,
            person: hasFaces,
            face_coverage: faceReading?.coverage,
            confidence: faceReading ? 0.6 : 0.42,
            method: faceReading ? 'tiny_face_detector_v1+frame_stats' : 'local_frame_statistics_v0',
          },
          privacy: 'no_image_uploaded',
        },
      },
      true,
    );

    if (announce && max17?.answer?.text) {
      const reply = formatMax17HudReply(max17);
      setAgiMessage(`MAX17: ${reply}`);
      pushLog(`MAX17 · среда: ${reply}`);
      speakMax17(reply);
    }

    return observation;
  }, [emitMax17HudEvent, pushLog, speakMax17]);

  // Cyber Lab — свой безопасный маршрут тьютора. Ответ проходит через общий
  // HUD-вывод MAX (лог + голос), а также возвращается в панель Cyber Lab.
  useEffect(() => {
    const onCyberLabAsk = (event: Event) => {
      const detail = (event as CustomEvent<{ moduleId?: string; message?: string }>).detail;
      const message = detail?.message?.trim();
      if (!message) return;

      const run = async () => {
        window.dispatchEvent(new CustomEvent('max:thinking', { detail: { active: true } }));
        try {
          const response = (await emitMax17HudEvent({
            type: 'security_tutor',
            moduleId: detail?.moduleId,
            text: message,
          })) as { answer?: { text?: string }; llm?: { text?: string } };
          const answerText = response?.answer?.text;
          const llmText = response?.llm?.text;
          const answer =
            typeof answerText === 'string'
              ? answerText
              : typeof llmText === 'string'
                ? llmText
                : 'MAX: сейчас не смог получить ответ наставника. Оставайся в локальной лаборатории и попробуй ещё раз.';
          pushLog(`🛡 CYBER LAB: ${answer}`);
          setAgiMessage(`MAX17: ${answer}`);
          speakMax17(answer);
          window.dispatchEvent(
            new CustomEvent('cyberlab:tutor-response', {
              detail: { text: answer, moduleId: detail?.moduleId },
            }),
          );
        } finally {
          window.dispatchEvent(new CustomEvent('max:thinking', { detail: { active: false } }));
        }
      };

      void run();
    };

    window.addEventListener('cyberlab:ask-max', onCyberLabAsk as EventListener);
    return () => window.removeEventListener('cyberlab:ask-max', onCyberLabAsk as EventListener);
  }, [emitMax17HudEvent, pushLog, speakMax17]);

  const stopCamera = useCallback(() => {
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
    cameraStreamRef.current = null;
    previousCameraLuminanceRef.current = null;
    setCameraError('');
    setCameraStatus('off');
    void emitMax17HudEvent({
      type: 'environment_observation',
      text: 'Camera sensor disabled',
      source: 'hud_camera',
      timestamp: new Date().toISOString(),
      camera: {
        active: false,
        privacy: 'no_image_uploaded',
      },
    });
  }, [emitMax17HudEvent]);

  const toggleCamera = useCallback(async () => {
    if (cameraStatus === 'active' || cameraStatus === 'starting') {
      stopCamera();
      return;
    }

    const insecure = typeof window !== 'undefined' && !window.isSecureContext;
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      const hint = insecure
        ? ` Открой страницу как ${getSecureGameUrl()} — по сетевому IP браузер блокирует камеру без HTTPS.`
        : ' Браузер не поддерживает getUserMedia.';
      setCameraError(`Камера недоступна.${hint}`);
      setCameraStatus('error');
      setAgiMessage(`MAX17: камера недоступна.${hint}`);
      // Error stays visible until the next click so the reason can be read.
      return;
    }

    try {
      setCameraError('');
      setCameraStatus('starting');
      const stream = await requestCameraStream();
      cameraStreamRef.current = stream;
      setCameraStatus('active');
      // Warm the face model so the first observation isn't slow (non-blocking).
      prewarmFaceApi();
    } catch (error) {
      console.error('Camera start failed:', error);
      const name = error instanceof DOMException ? error.name : '';
      let hint = '';
      if (name === 'NotAllowedError') {
        hint = ' Доступ к камере запрещён — разреши его в настройках браузера для этого сайта и нажми ещё раз.';
      } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
        hint = ' Камера не найдена этим браузером.';
      } else if (name === 'NotReadableError') {
        hint = ' Камеру занял другой процесс (Zoom/FaceTime?). Закрой его и попробуй снова.';
      } else if (insecure) {
        hint = ` Открой страницу как ${getSecureGameUrl()} (камера требует HTTPS).`;
      }
      const reason =
        error instanceof Error ? `${name || error.name}: ${error.message}` : 'unknown camera error';
      setCameraError(`${reason}.${hint}`);
      setCameraStatus('error');
      setAgiMessage(`MAX17: не смог включить камеру. ${hint || reason}`);
      // Keep the error on screen until the next click instead of auto-hiding.
    }
  }, [cameraStatus, stopCamera]);

  // Keep refs that voice commands read in sync (avoids stale closures / churn).
  useEffect(() => {
    cameraStatusRef.current = cameraStatus;
  }, [cameraStatus]);
  useEffect(() => {
    toggleCameraRef.current = () => {
      void toggleCamera();
    };
  }, [toggleCamera]);

  // Visual sensors: while the camera is on, detect the face outline + a motion
  // level and paint them onto an overlay canvas over the video preview.
  useEffect(() => {
    if (cameraStatus !== 'active') return;
    const video = cameraVideoRef.current;
    if (!video) return;

    let active = true;
    let detectTimer: number | undefined;
    let raf = 0;
    const motionCanvas = document.createElement('canvas');
    motionCanvas.width = 32;
    motionCanvas.height = 24;
    const mctx = motionCanvas.getContext('2d', { willReadFrequently: true });
    let prevLuma: Float32Array | null = null;

    const detectLoop = async () => {
      if (!active) return;
      try {
        const reading = await detectFaces(video);
        if (reading) faceReadingRef.current = reading;
        if (mctx && video.videoWidth) {
          mctx.drawImage(video, 0, 0, 32, 24);
          const data = mctx.getImageData(0, 0, 32, 24).data;
          const luma = new Float32Array(32 * 24);
          let diff = 0;
          for (let i = 0, p = 0; i < data.length; i += 4, p++) {
            const y = (data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722) / 255;
            luma[p] = y;
            if (prevLuma) diff += Math.abs(y - prevLuma[p]);
          }
          if (prevLuma) motionRef.current = Math.min(1, (diff / luma.length) * 6);
          prevLuma = luma;
        }
      } catch {
        // detection best-effort
      }
      if (active) detectTimer = window.setTimeout(detectLoop, 120);
    };

    // 68-точечные группы лица (контуры) для «фрактальной» сетки.
    const FACE_GROUPS: Array<{ a: number; b: number; closed: boolean }> = [
      { a: 0, b: 16, closed: false }, // челюсть
      { a: 17, b: 21, closed: false }, // правая бровь
      { a: 22, b: 26, closed: false }, // левая бровь
      { a: 27, b: 30, closed: false }, // спинка носа
      { a: 31, b: 35, closed: false }, // низ носа
      { a: 36, b: 41, closed: true }, // правый глаз
      { a: 42, b: 47, closed: true }, // левый глаз
      { a: 48, b: 59, closed: true }, // внешние губы
      { a: 60, b: 67, closed: true }, // внутренние губы
    ];

    const drawMesh = (
      c: CanvasRenderingContext2D,
      mesh: Array<{ x: number; y: number }>,
      mapX: (n: number) => number,
      mapY: (n: number) => number,
      time: number,
    ) => {
      const P = mesh.map((p) => [mapX(p.x), mapY(p.y)] as [number, number]);
      // 1) фрактальная сеть: каждая точка к 2 ближайшим соседям.
      c.shadowBlur = 0;
      c.lineWidth = 1;
      c.strokeStyle = 'rgba(120,220,255,0.16)';
      for (let i = 0; i < P.length; i++) {
        let a = -1;
        let b = -1;
        let da = 1e9;
        let db = 1e9;
        for (let j = 0; j < P.length; j++) {
          if (j === i) continue;
          const dx = P[i][0] - P[j][0];
          const dy = P[i][1] - P[j][1];
          const d = dx * dx + dy * dy;
          if (d < da) {
            db = da;
            b = a;
            da = d;
            a = j;
          } else if (d < db) {
            db = d;
            b = j;
          }
        }
        for (const j of [a, b]) {
          if (j > i) {
            c.beginPath();
            c.moveTo(P[i][0], P[i][1]);
            c.lineTo(P[j][0], P[j][1]);
            c.stroke();
          }
        }
      }
      // 2) контуры черт лица (светящиеся).
      c.shadowColor = 'rgba(0,242,255,0.7)';
      c.shadowBlur = 6;
      c.strokeStyle = 'rgba(0,242,255,0.5)';
      c.lineWidth = 1.1;
      for (const g of FACE_GROUPS) {
        c.beginPath();
        for (let k = g.a; k <= g.b; k++) {
          if (k === g.a) c.moveTo(P[k][0], P[k][1]);
          else c.lineTo(P[k][0], P[k][1]);
        }
        if (g.closed) c.closePath();
        c.stroke();
      }
      // 3) пульсирующие узлы поверх каждой точки.
      for (let i = 0; i < P.length; i++) {
        const pr = 1.0 + (Math.sin(time * 3 + i * 0.7) * 0.5 + 0.5) * 1.4;
        c.beginPath();
        c.arc(P[i][0], P[i][1], pr, 0, Math.PI * 2);
        c.fillStyle = 'rgba(190,245,255,0.92)';
        c.fill();
      }
      c.shadowBlur = 0;
    };

    const draw = () => {
      if (!active) return;
      const overlay = cameraOverlayRef.current;
      const ctx = overlay?.getContext('2d');
      if (overlay && ctx) {
        const w = overlay.clientWidth;
        const h = overlay.clientHeight;
        if (w && h) {
          if (overlay.width !== w) overlay.width = w;
          if (overlay.height !== h) overlay.height = h;
          ctx.clearRect(0, 0, w, h);
          // Точное совмещение с лицом: проецируем нормированные точки через ту же
          // object-cover трансформацию, что и <video>, + автодетект зеркала.
          const vid = cameraVideoRef.current;
          const vw = vid?.videoWidth || w;
          const vh = vid?.videoHeight || h;
          const scale = Math.max(w / vw, h / vh);
          const dvw = vw * scale;
          const dvh = vh * scale;
          const ox = (w - dvw) / 2;
          const oy = (h - dvh) / 2;
          let mirror = false;
          if (vid) {
            const tr = getComputedStyle(vid).transform;
            if (tr && tr.startsWith('matrix')) {
              const a = parseFloat(tr.slice(tr.indexOf('(') + 1).split(',')[0]);
              if (a < 0) mirror = true;
            }
          }
          const mapX = (n: number) => {
            const sx = ox + n * dvw;
            return mirror ? w - sx : sx;
          };
          const mapY = (n: number) => oy + n * dvh;

          const reading = faceReadingRef.current;
          const meshes = reading?.meshes ?? [];
          if (reading?.hasMesh && meshes.length) {
            // Зрение MAX: лицо как фрактальная точечная сетка (не квадрат).
            const now = performance.now() * 0.001;
            for (const m of meshes) drawMesh(ctx, m, mapX, mapY, now);
          } else {
            // Фолбэк (модель лэндмарков не загрузилась) — рамка по лицу.
            const boxes = reading?.boxes ?? [];
            ctx.shadowColor = 'rgba(0,242,255,0.8)';
            ctx.shadowBlur = 8;
            for (const b of boxes) {
              const x0 = mapX(b.x);
              const x1 = mapX(b.x + b.w);
              const rx = Math.min(x0, x1);
              const rw = Math.abs(x1 - x0);
              const ry = mapY(b.y);
              const rh = b.h * dvh;
              ctx.fillStyle = 'rgba(0,242,255,0.08)';
              ctx.fillRect(rx, ry, rw, rh);
              ctx.lineWidth = 2;
              ctx.strokeStyle = 'rgba(0,242,255,0.9)';
              ctx.strokeRect(rx, ry, rw, rh);
            }
            ctx.shadowBlur = 0;
          }
          // Motion meter along the bottom edge.
          const m = motionRef.current;
          ctx.fillStyle = `rgba(0,242,255,${0.2 + 0.6 * m})`;
          ctx.fillRect(0, h - 3, w * m, 3);
        }
      }
      raf = window.requestAnimationFrame(draw);
    };

    void detectLoop();
    raf = window.requestAnimationFrame(draw);
    return () => {
      active = false;
      if (detectTimer) window.clearTimeout(detectTimer);
      window.cancelAnimationFrame(raf);
      faceReadingRef.current = null;
      motionRef.current = 0;
    };
  }, [cameraStatus]);

  useEffect(() => {
    if (cameraStatus !== 'active') return;
    const video = cameraVideoRef.current;
    const stream = cameraStreamRef.current;
    if (!video || !stream) return;

    video.srcObject = stream;
    void video.play().catch(() => undefined);
    const timer = window.setTimeout(() => {
      void captureEnvironmentObservation(true);
    }, 700);
    const interval = window.setInterval(() => {
      void captureEnvironmentObservation(false);
    }, 8000);

    return () => {
      window.clearTimeout(timer);
      window.clearInterval(interval);
    };
  }, [cameraStatus, captureEnvironmentObservation]);

  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
      cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  // Autonomous flywheel (Phase 3): after a few idle minutes the core asks its
  // own questions and learns from the web on its own. Bounded: only when idle,
  // not mid-request, and at most once every few minutes. Server still gates the
  // network via MAX17_AUTO_WEB, so this is a no-op if self-learning is disabled.
  useEffect(() => {
    const IDLE_MS = 180_000; // 3 min without user activity
    const MIN_GAP_MS = 300_000; // at most one auto-grow per 5 min
    const tick = async () => {
      const now = Date.now();
      if (isLoadingRef.current) return;
      if (now - lastActivityRef.current < IDLE_MS) return;
      if (now - lastGrowRef.current < MIN_GAP_MS) return;
      lastGrowRef.current = now;

      // Show the core thinking while MAX grows on his own.
      window.dispatchEvent(new CustomEvent('max:thinking', { detail: { active: true } }));
      try {
        // Autonomous growth: MAX seeds his own topics from the graph, researches
        // them on the web, and distills facts into (neural) memory + the synapse
        // graph. Surfaced so you can SEE what he learned; synapses tick up in /jarvis.
        const grow = await emitMax17HudEvent({ type: 'autonomous_research', limit: 2 });
        const ar = (grow as {
          autonomous_research?: {
            network?: boolean;
            facts_learned?: number;
            items?: Array<{ topic: string; facts: number; status: string }>;
          };
        })?.autonomous_research;
        if (ar?.network) {
          const learned = (ar.items ?? []).filter((i) => i.facts > 0).map((i) => i.topic);
          if (ar.facts_learned && learned.length) {
            const line = `🧠 MAX сам изучил: ${learned.slice(0, 3).join(', ')} (+${ar.facts_learned} фактов)`;
            pushLog(line);
            setAgiMessage(`MAX17: ${line}`);
          } else if ((ar.items ?? []).length) {
            pushLog(`🧠 MAX поискал: ${(ar.items ?? []).slice(0, 3).map((i) => i.topic).join(', ')} — пока без новых фактов`);
          }
        }

        // Phase 8: Ultra also decides its own next action (compile/consolidate/
        // tree/compose) via the LLM — agency beyond pure research.
        const res = await emitMax17HudEvent({ type: 'ultra_think' });
        const note = res?.next_adaptation;
        if (note && /ультра|придумал|закрыл/i.test(note)) {
          pushLog(`🧠 ${note}`);
          setAgiMessage(`MAX17: ${note}`);
        }
        const ultra = (res as { ultra?: { decision?: { action?: string }; executed?: { insight?: boolean } } })?.ultra;
        if (ultra?.decision?.action === 'compose' || ultra?.executed?.insight) {
          void composeMoodTrack(true);
        }
      } finally {
        window.dispatchEvent(new CustomEvent('max:thinking', { detail: { active: false } }));
      }
    };
    const interval = window.setInterval(() => {
      void tick();
    }, 60_000);
    return () => window.clearInterval(interval);
  }, [emitMax17HudEvent, pushLog, composeMoodTrack]);

  const handleSend = async (override?: string) => {
    // React passes a MouseEvent to a bare onClick handler. Only explicit text
    // overrides belong here; every pointer/keyboard send otherwise uses input.
    const userMsg = (typeof override === 'string' ? override : input).trim();
    if (!userMsg || isLoading) return;
    adaptToText(userMsg);
    lastActivityRef.current = Date.now(); // reset the idle-flywheel timer

    // «/godmode» — открыть Терминал бога (окно режимов), не отправляя в ядро.
    if (/^\/godmode(?=\s|$)/i.test(userMsg)) {
      setInput('');
      window.dispatchEvent(new CustomEvent('godmode:open'));
      pushLog('⚡ /godmode — Терминал бога');
      setAgiMessage('MAX17: GODMODE открыт.');
      return;
    }

    // «/jarvis» — включить/выключить Iron-Man оверлей (arc-reactor + гейджи).
    if (/^\/jarvis(?=\s|$)/i.test(userMsg)) {
      setInput('');
      window.dispatchEvent(new CustomEvent('jarvis:toggle'));
      pushLog('⚡ /jarvis — Iron-Man HUD переключён');
      setAgiMessage('MAX17: JARVIS HUD.');
      return;
    }

    // «/кластер» — пульт MAX GOD: связка M3 (первичный) ↔ i5 (воркер) по LAN.
    if (/^\/(кластер|cluster|god)(?=\s|$)/i.test(userMsg)) {
      setInput('');
      window.dispatchEvent(new CustomEvent('cluster:toggle'));
      pushLog('⛓ /кластер — MAX GOD');
      setAgiMessage('MAX17: кластер.');
      return;
    }

    // «/миссии» — живая доска миссий (трекер реальных целей, MAX пушит к шагу).
    if (/^\/(миссии|missions|цели|goals)(?=\s|$)/i.test(userMsg)) {
      setInput('');
      window.dispatchEvent(new CustomEvent('missions:toggle'));
      pushLog('🎯 /миссии — доска миссий');
      setAgiMessage('MAX17: миссии.');
      return;
    }

    // «/резонанс» / «/свет» — режим Резонанс: нет плашек, только фиолетовое ядро,
    // дышит, свет разливается во всё поле, коды стекают к центру.
    if (/^\/(резонанс|resonance|свет|light|ядросвет)(?=\s|$)/i.test(userMsg)) {
      setInput('');
      window.dispatchEvent(new CustomEvent('resonance:toggle'));
      pushLog('🟣 /резонанс — фиолетовое ядро, только свет');
      setAgiMessage('MAX17: резонанс.');
      return;
    }

    // «/аура» — бинауральные ритмы под человека (поток/фокус/медитация), «под меня» от MAX.
    if (/^\/(аура|aura|ритмы|binaural|поток)(?=\s|$)/i.test(userMsg)) {
      setInput('');
      window.dispatchEvent(new CustomEvent('aura:toggle'));
      pushLog('◐ /аура — бинауральные ритмы');
      setAgiMessage('MAX17: аура.');
      return;
    }

    // «/рядом» — MAX-компаньон: смотрит твой экран игры и реагирует голосом.
    if (/^\/(рядом|компаньон|buddy|companion|game)(?=\s|$)/i.test(userMsg)) {
      setInput('');
      window.dispatchEvent(new CustomEvent('buddy:toggle'));
      pushLog('🎮 /рядом — MAX-компаньон');
      setAgiMessage('MAX17: рядом.');
      return;
    }

    // «/mircoin» / «/кошелёк» — журнал внутриигровой валюты (не крипта).
    if (/^\/(mircoin|миркоин|коин|coin|кошелёк|кошелек|wallet)(?=\s|$)/i.test(userMsg)) {
      setInput('');
      window.dispatchEvent(new CustomEvent('mircoin:toggle'));
      pushLog('Ⓜ /mircoin — кошелёк');
      setAgiMessage('MAX17: кошелёк.');
      return;
    }

    // «/аттрактор» — 3D-визуализатор хаотических аттракторов (Thomas/Lorenz/…).
    if (/^\/(аттрактор|хаос|attractor|chaos)(?=\s|$)/i.test(userMsg)) {
      setInput('');
      window.dispatchEvent(new CustomEvent('attractor:toggle'));
      pushLog('△∞ /аттрактор — 3D хаос-аттрактор');
      setAgiMessage('MAX17: аттрактор.');
      return;
    }

    // «/сон» — режим Сна MAX: internal_dream (синергии) + консолидация памяти.
    if (/^\/(сон|sleep|сны|dream)(?=\s|$)/i.test(userMsg)) {
      setInput('');
      window.dispatchEvent(new CustomEvent('sleep:toggle'));
      pushLog('🌙 /сон — MAX спит и видит сны');
      setAgiMessage('MAX17: сон.');
      return;
    }

    // «/мозг» — живая визуализация настоящего графа синапсов MAX (graph_stats).
    if (/^\/(мозг|brain|граф|graph)(?=\s|$)/i.test(userMsg)) {
      setInput('');
      window.dispatchEvent(new CustomEvent('brain:toggle'));
      pushLog('🧠 /мозг — живой граф памяти MAX');
      setAgiMessage('MAX17: мозг.');
      return;
    }

    // «/рефлексия» — петля саморефлексии MAX (introspect + консолидация, локально 24/7).
    if (/^\/(рефлексия|рефлекс|reflection|loop|луп)(?=\s|$)/i.test(userMsg)) {
      setInput('');
      window.dispatchEvent(new CustomEvent('reflection:toggle'));
      pushLog('♾ /рефлексия — петля MAX');
      setAgiMessage('MAX17: рефлексия.');
      return;
    }

    // «/фаза» — ChronoSync «Фаза дня»: 3 действия из миссий + фокус + стоп по фазе месяца.
    if (/^\/(фаза|phase|chrono|хроно)(?=\s|$)/i.test(userMsg)) {
      setInput('');
      window.dispatchEvent(new CustomEvent('phase:toggle'));
      pushLog('🕒 /фаза — фаза дня (ChronoSync)');
      setAgiMessage('MAX17: фаза дня.');
      return;
    }

    // «/доктор» — дашборд здоровья GAME+MAX: свип логов, авто-фиксы, квесты.
    if (/^\/(доктор|doctor|health|здоровье)(?=\s|$)/i.test(userMsg)) {
      setInput('');
      window.dispatchEvent(new CustomEvent('doctor:toggle'));
      pushLog('🩺 /доктор — здоровье системы');
      setAgiMessage('MAX17: доктор.');
      return;
    }

    // «/прогон» — режим прогона по шагам: MAX раскладывает цель на шаги и выполняет.
    if (/^\/(прогон|run|шаги|runner)(?=\s|$)/i.test(userMsg)) {
      setInput('');
      window.dispatchEvent(new CustomEvent('runner:toggle'));
      pushLog('🚀 /прогон — MAX выполняет шаги');
      setAgiMessage('MAX17: раскладываю на шаги и выполняю.');
      return;
    }

    // «/автопилот» — MAX сам разбирает миссии: что может делает, где нужен ты — шлёт запрос.
    if (/^\/(автопилот|autopilot|разбор)(?=\s|$)/i.test(userMsg)) {
      setInput('');
      window.dispatchEvent(new CustomEvent('autopilot:toggle'));
      pushLog('🛫 /автопилот — MAX разбирает миссии');
      setAgiMessage('MAX17: разбираю миссии, делаю что могу.');
      return;
    }

    // «/мультиагент» — бригада под-агентов: Планировщик → под-агенты → Синтезатор.
    if (/^\/(мультиагент|агенты|мульти|multi|multiagent)(?=\s|$)/i.test(userMsg)) {
      setInput('');
      window.dispatchEvent(new CustomEvent('multi:toggle'));
      pushLog('🧩 /мультиагент — бригада агентов MAX');
      setAgiMessage('MAX17: собираю бригаду агентов.');
      return;
    }

    // «/деньги» — агент-стратег по заработку: реальные пути под навыки + миссии.
    if (/^\/(деньги|заработок|money|доход)(?=\s|$)/i.test(userMsg)) {
      setInput('');
      window.dispatchEvent(new CustomEvent('money:toggle'));
      pushLog('💰 /деньги — агент заработка');
      setAgiMessage('MAX17: ищу реальные пути заработка.');
      return;
    }

    // «/эфир» — 3D-радар реальных устройств рядом (Bluetooth/Wi-Fi/сеть).
    if (/^\/(эфир|радар|сканер|ether|radar|scan)(?=\s|$)/i.test(userMsg)) {
      setInput('');
      window.dispatchEvent(new CustomEvent('ether:toggle'));
      pushLog('📡 /эфир — радар устройств рядом');
      setAgiMessage('MAX17: сканирую эфир.');
      return;
    }

    // «/сон3д» — объёмная карта настоящего сна MAX (граф синергий-концептов).
    if (/^\/(сон3д|сон3d|dream3d|сновидение)(?=\s|$)/i.test(userMsg)) {
      setInput('');
      window.dispatchEvent(new CustomEvent('dream3d:toggle'));
      pushLog('🌌 /сон3д — вход в сон MAX (3D)');
      setAgiMessage('MAX17: сон в 3D.');
      return;
    }

    // «/админ» — дашборд владельца (только Мирон: Google-аккаунт или админ-токен).
    if (/^\/(админ|admin)(?=\s|$)/i.test(userMsg)) {
      setInput('');
      window.dispatchEvent(new CustomEvent('admin:toggle'));
      pushLog('👑 /админ — панель владельца');
      setAgiMessage('MAX17: админ.');
      return;
    }

    // «/мудрец» / «/sage» — голосовой Мудрец из особняка (спутник для игры).
    if (/^\/(мудрец|sage)(?=\s|$)/i.test(userMsg)) {
      setInput('');
      window.dispatchEvent(new CustomEvent('sage:toggle'));
      pushLog('🧙 /мудрец — Мудрец из особняка');
      setAgiMessage('MAX17: Мудрец.');
      return;
    }

    // «/3d» / «/ядро» — объёмное 3D-присутствие MAX (WebGL-ядро в центре меты).
    if (/^\/(3d|ядро|core)(?=\s|$)/i.test(userMsg)) {
      setInput('');
      window.dispatchEvent(new CustomEvent('max3d:toggle'));
      pushLog('🌐 /3d — 3D-ядро MAX переключено');
      setAgiMessage('MAX17: 3D-ядро.');
      return;
    }

    // «/навыки» — открыть инвентарь навыков (динамическая компетенция).
    if (/^\/(навыки|skills|инвентарь|inventory)(?=\s|$)/i.test(userMsg)) {
      setInput('');
      window.dispatchEvent(new CustomEvent('skills:toggle'));
      pushLog('🎒 /навыки — инвентарь навыков');
      setAgiMessage('MAX17: инвентарь навыков.');
      return;
    }

    // «/куй» — Кузница синапсов: семантический kNN-бриджинг → полезные связи к 1M.
    if (/^\/(куй|forge|кузница)(?=\s|$)/i.test(userMsg)) {
      setInput('');
      pushLog('⚒️ Кузница синапсов: кую связи по смыслу…');
      setAgiMessage('MAX17: кую синапсы.');
      window.dispatchEvent(new CustomEvent('max:thinking', { detail: { active: true } }));
      try {
        const res = await emitMax17HudEvent({ type: 'synapse_forge' });
        const note = res?.answer?.text || res?.next_adaptation || 'Кузница завершена.';
        pushLog(`⚒️ ${note}`);
        setAgiMessage(`MAX17: ${note}`);
      } finally {
        window.dispatchEvent(new CustomEvent('max:thinking', { detail: { active: false } }));
      }
      return;
    }

    // «/расти» — запустить автономный рост сейчас: MAX сам ищет пробелы, учит из
    // веба и распределяет в нейро-память + граф. (Иначе это идёт само в простое.)
    if (/^\/(расти|grow|учись|learn)(?=\s|$)/i.test(userMsg)) {
      setInput('');
      pushLog('🧠 MAX растёт: ищу пробелы и учусь…');
      setAgiMessage('MAX17: расту — исследую свои пробелы.');
      window.dispatchEvent(new CustomEvent('max:thinking', { detail: { active: true } }));
      try {
        const grow = await emitMax17HudEvent({ type: 'autonomous_research', limit: 3 });
        const ar = (grow as {
          autonomous_research?: { network?: boolean; facts_learned?: number; items?: Array<{ topic: string; facts: number }> };
        })?.autonomous_research;
        if (!ar?.network) {
          pushLog('🧠 Веб-обучение выключено (MAX17_AUTO_WEB=false).');
        } else {
          const learned = (ar.items ?? []).filter((i) => i.facts > 0).map((i) => i.topic);
          const line = learned.length
            ? `🧠 MAX изучил: ${learned.slice(0, 3).join(', ')} (+${ar.facts_learned} фактов)`
            : `🧠 MAX поискал ${(ar.items ?? []).length} тем — новых фактов пока нет`;
          pushLog(line);
          setAgiMessage(`MAX17: ${line}`);
        }
      } finally {
        window.dispatchEvent(new CustomEvent('max:thinking', { detail: { active: false } }));
      }
      return;
    }

    // Fast local path: interface control by text or voice ("закрой миссии",
    // "смени фон", "сбрось окна"). Executed instantly; still forwarded to Max17
    // in the background so the cognitive core keeps the memory trace.
    // Bulk-ingest prefix: «впитай <текст>» / «изучи проект <путь>» — feed Max a
    // corpus so it grows the synapse graph (the road to 1M). Checked before the
    // word-limit-bound command interpreter, so long pastes still work.
    const ingestMatch = userMsg.match(/^\s*(впитай|проглоти|запомни текст|изучи проект)[:\s]+([\s\S]+)/i);
    if (ingestMatch) {
      setInput('');
      const isPath = /изучи проект/i.test(ingestMatch[1]);
      const body = ingestMatch[2].trim();
      pushLog(`Вы: ${userMsg.slice(0, 80)}`);
      setAgiMessage('MAX17: впитываю…');
      const res = await emitMax17HudEvent(isPath ? { type: 'ingest_corpus', path: body } : { type: 'ingest_corpus', text: body });
      const note = res?.answer?.text || 'готово';
      pushLog(`🧩 ${note}`);
      setAgiMessage(`MAX17: ${note}`);
      speakMax17(note.split('.')[0]);
      recordPrivateReflection({
        trigger: isPath ? 'ingest_project' : 'ingest_text',
        ok: Boolean(res),
        userText: userMsg,
        route: res?.route || 'ingest_corpus',
        confidence: res?.confidence,
        next: note,
      });
      return;
    }

    const uiCommand = interpretUiCommand(userMsg);
    if (uiCommand) {
      setInput('');
      executeUiCommand(uiCommand.command);
      setAgiMessage(`MAX17: ${uiCommand.reply}`);
      pushLog(`Вы: ${userMsg}`);
      pushLog(`MAX17: ${uiCommand.reply}`);
      speakMax17(uiCommand.reply);
      void emitMax17HudEvent({
        type: 'user_message',
        text: userMsg,
        source: 'hud_command',
        timestamp: new Date().toISOString(),
      });
      recordPrivateReflection({
        trigger: 'hud_command',
        ok: true,
        userText: userMsg,
        route: 'ui_command',
        next: uiCommand.reply,
      });
      return;
    }

    setInput('');
    setIsLoading(true);
    setAgiMessage(`Вы: ${userMsg} MAX17: обрабатываю событие...`);
    const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const elapsedMs = () => Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt);

    let activeSessionId = sessionId;
    try {
      if (!activeSessionId) {
        const existing = sessions.find((s) => !s.mode?.startsWith('agi_'));
        if (existing) {
          activeSessionId = existing.id;
        } else {
          activeSessionId = await createSession('HUD сеанс', 'game');
        }
        setSessionId(activeSessionId);
      }

      const sid = activeSessionId ?? undefined;
      await saveMessage('user', userMsg, sid);
      reachGoal('max_message'); // цель Метрики: главное действие — заговорил с MAX

      const attachedNow = attached;
      setAttached(null);
      const textForCore = attachedNow
        ? `${userMsg}\n\n[ФАЙЛ: ${attachedNow.name}]\n${attachedNow.text}`
        : userMsg;

      const max17 = await emitMax17HudEvent(
        {
          type: 'user_message',
          text: textForCore,
          source: 'hud',
          timestamp: new Date().toISOString(),
        },
        true,
      );

      // Orchestrator: a code/desktop/music task is routed to its real engine
      // automatically — the chat LLM only talks, the engine actually does it.
      // Ядро может не только сказать, но и ПОКАЗАТЬ: панель с кодом, картинкой
      // или разбором открывается окном рядом со штатными. Поле ui добавлено
      // рядом с dispatch, а не вместо — маршрутизация задач осталась прежней.
      const panels = (max17 as { ui?: { panels?: unknown } } | undefined)?.ui?.panels;
      if (Array.isArray(panels)) {
        for (const raw of panels.slice(0, 4)) {
          const panel = raw as { id?: string; title?: string; kind?: string; body?: string; lang?: string };
          const body = String(panel?.body || '');
          if (!body) continue;
          wm.openPanel({
            id: String(panel.id || `p${Date.now().toString(36)}`),
            title: String(panel.title || 'MAX показывает'),
            kind: panel.kind === 'image' || panel.kind === 'code' ? panel.kind : 'text',
            body: body.slice(0, 40_000),
            lang: panel.lang ? String(panel.lang) : undefined,
          });
        }
      }

      const dispatch = max17?.dispatch;
      if (dispatch?.instruction && (dispatch.route === 'code' || dispatch.route === 'desktop' || dispatch.route === 'music')) {
        const note = max17?.answer?.text || 'Передаю задачу агенту…';
        if (dispatch.route === 'code') {
          setCodeTask(dispatch.instruction);
          setCodeOpen(true);
        } else if (dispatch.route === 'music') {
          // Open GODMODE (mounts Mode777), then tell it to compose from scratch.
          window.dispatchEvent(new CustomEvent('godmode:open'));
          window.setTimeout(
            () => window.dispatchEvent(new CustomEvent('mode777:compose', { detail: { instruction: dispatch.instruction } })),
            600,
          );
        } else {
          setDesktopTask(dispatch.instruction);
          setDesktopOpen(true);
        }
        setAgiMessage(`Вы: ${userMsg} MAX17: ${note}`);
        pushLog(`Вы: ${userMsg}`);
        pushLog(`MAX17: ${note}`);
        speakMax17(note);
        await saveMessage('model', note, sid);
        recordPrivateReflection({
          trigger: `dispatch:${dispatch.route}`,
          ok: true,
          userText: userMsg,
          route: max17?.route || dispatch.route,
          confidence: max17?.confidence,
          next: note,
          latencyMs: elapsedMs(),
        });
        return;
      }

      const fullResponse = max17
        ? formatMax17HudReply(max17)
        : 'Локальный Max17-мост сейчас недоступен. Сообщение принято, основной HUD продолжает работать.';

      setAgiMessage(`Вы: ${userMsg} MAX17: ${fullResponse}`);
      pushLog(`Вы: ${userMsg}`);
      pushLog(`MAX17: ${fullResponse}`);
      speakMax17(fullResponse);
      await saveMessage('model', fullResponse, sid);
      recordPrivateReflection({
        trigger: 'chat_turn',
        ok: Boolean(max17),
        userText: userMsg,
        route: max17?.route || 'bridge_unavailable',
        confidence: max17?.confidence,
        next: fullResponse,
        latencyMs: elapsedMs(),
      });
    } catch (e) {
      console.error(e);
      const errorMessage = e instanceof Error ? e.message : String(e);
      setAgiMessage(
        `Вы: ${userMsg} MAX17: не удалось сохранить или обработать сообщение. HUD остаётся активным без Gemini.`,
      );
      recordPrivateReflection({
        trigger: 'chat_turn',
        ok: false,
        userText: userMsg,
        route: 'hud_error',
        error: errorMessage,
        latencyMs: elapsedMs(),
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Hands-free: wake word ("Макс17 / просыпайся") or a clap opens a listening
  // window; the captured command is sent to Max17 immediately (no manual send).
  useVoiceWake({
    enabled: handsFree,
    lang: locale,
    onCommand: (text) => {
      setInput('');
      void handleSend(text);
    },
    onWake: () => {
      playCue();
      setAgiMessage(`MAX17: ${t('hud.wakeReady')}`);
    },
    onStatus: (status) => {
      if (status === 'mic-denied') {
        setHandsFree(false);
        setAgiMessage('MAX17: микрофон запрещён — разреши доступ, чтобы включить hands-free.');
      } else if (status === 'no-speech-api') {
        setAgiMessage('MAX17: распознавание речи недоступно в этом браузере (нужен Chrome). Хлопок всё ещё работает.');
      }
    },
  });

  const handleMissionToggle = async (taskId: string) => {
    const task = tasks.find((t) => t.id === taskId);
    if (task && task.status !== 'completed') {
      await completeTask(taskId);
      earnMirCoin(Math.max(10, Math.round((task.xp || 50) * 0.8)), `Задача: ${task.desc}`);
      void emitMax17HudEvent({
        type: 'task_completed',
        task: {
          id: task.id,
          desc: task.desc,
          mgr: task.mgr,
          xp: task.xp,
          status: 'completed',
          deadline: task.deadline,
        },
        source: 'hud',
        timestamp: new Date().toISOString(),
      });
    }
  };

  // Демо-миссии новичка (когда своих задач ещё нет). Клик по галочке заводит
  // РЕАЛЬНУЮ задачу и сразу закрывает её — с XP, MirCoin и записью в память,
  // как при обычном выполнении. Раньше тут был мёртвый readOnly-чекбокс.
  const handleDefaultMissionComplete = async (label: string) => {
    const desc = String(label || '').trim();
    if (!desc) return;
    const task: Task = {
      id: `dm_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      desc,
      mgr: 'MGR-1',
      xp: 100,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    await addTasks([task]);
    await completeTask(task.id);
    earnMirCoin(80, `Задача: ${desc}`);
    void emitMax17HudEvent({
      type: 'task_completed',
      task: { id: task.id, desc, mgr: task.mgr, xp: task.xp, status: 'completed' },
      source: 'hud',
      timestamp: new Date().toISOString(),
    });
    pushLog(`✅ ${desc}`);
  };

  const pendingTasks = tasks.filter((t) => t.status !== 'completed' && t.status !== 'failed');
  const rewardXp = pendingTasks.reduce((sum, t) => sum + (t.xp || 0), 0) || 5000;

  const reputationLevel = Math.max(1, Math.floor(xp / 450) + 1);
  const energy = Math.min(99, 70 + Math.floor((xp % 1000) / 15));
  const focus = Math.min(99, 75 + Math.floor((xp % 500) / 12));
  // MirCoin — реальный журнал начислений (не формула). См. hooks/use-mircoin.ts.
  const balance = mirCoinBalance;

  useEffect(() => {
    if (!isLoaded) return;

    if (!systemStateSentRef.current) {
      systemStateSentRef.current = true;
      knownTaskIdsRef.current = new Set(tasks.map((task) => task.id));
      emittedFailedTaskIdsRef.current = new Set(
        tasks.filter((task) => task.status === 'failed').map((task) => task.id),
      );
      void emitMax17HudEvent({
        type: 'system_state',
        source: 'hud',
        timestamp: new Date().toISOString(),
        energy,
        focus,
        reputation: reputationLevel,
        balance,
        tasks_count: tasks.length,
        active_tasks_count: pendingTasks.length,
      });
      return;
    }

    const knownTaskIds = knownTaskIdsRef.current;
    const emittedFailedTaskIds = emittedFailedTaskIdsRef.current;

    for (const task of tasks) {
      if (!knownTaskIds.has(task.id)) {
        knownTaskIds.add(task.id);
        void emitMax17HudEvent({
          type: 'task_created',
          task: {
            id: task.id,
            desc: task.desc,
            mgr: task.mgr,
            xp: task.xp,
            status: task.status,
            scheduledTime: task.scheduledTime,
            deadline: task.deadline,
          },
          source: 'hud',
          timestamp: new Date().toISOString(),
        });
      }

      if (task.status === 'failed' && !emittedFailedTaskIds.has(task.id)) {
        emittedFailedTaskIds.add(task.id);
        void emitMax17HudEvent({
          type: 'deadline_failed',
          task: {
            id: task.id,
            desc: task.desc,
            mgr: task.mgr,
            xp: task.xp,
            status: task.status,
            deadline: task.deadline,
          },
          source: 'hud',
          timestamp: new Date().toISOString(),
        });
      }
    }
  }, [balance, emitMax17HudEvent, energy, focus, isLoaded, pendingTasks.length, reputationLevel, tasks]);

  const promptText = cameraStatus === 'error'
    ? t('hud.camera')
    : cameraStatus === 'starting'
    ? `${t('hud.camera')}…`
    : isSpeaking
      ? `${t('hud.voice')}…`
      : isListening
    ? `${t('hud.voiceInput')}…`
    : isLoading
      ? `${t('common.loading')}…`
      : t('hud.wakeReady');
  const max17Confidence = max17State ? Math.round(max17State.confidence * 100) : 0;
  const coreStatus: 'idle' | 'listening' | 'processing' | 'speaking' = isLoading
    ? 'processing'
    : isSpeaking
      ? 'speaking'
      : isListening
        ? 'listening'
        : 'idle';

  // Файл читаем прямо в браузере: наружу уходит уже текст, сам файл никуда не
  // загружается. Потолки — чтобы длинный файл не вытеснил из ответа всё остальное.
  const handleFilePick = async (file: File) => {
    // Фото и видео идут не в текст, а в зрение: file.text() на картинке даёт
    // бинарный мусор, из которого ядру нечего понять.
    const isImage = file.type.startsWith('image/');
    const isVideo = file.type.startsWith('video/');
    if (isImage || isVideo) {
      const MAX_MEDIA_BYTES = 12_000_000;
      if (file.size > MAX_MEDIA_BYTES) {
        setAgiMessage(
          `MAX17: «${file.name}» — ${(file.size / 1048576).toFixed(1)} МБ, а я беру до 12 МБ. Сожми или обрежь.`,
        );
        return;
      }
      setAttached(null);
      setIsLoading(true);
      // Пишем и в ленту, и в строку статуса: GameHud показывает agiMessage
      // ТОЛЬКО пока лента пуста, поэтому после первого же диалога ответ,
      // отправленный лишь в agiMessage, не виден вообще.
      const seeSay = (line: string) => {
        pushLog(line);
        setAgiMessage(line);
      };
      // Взгляд идёт десятки секунд (видео — минуты), поэтому говорим об этом
      // сразу: молчащий интерфейс здесь читается как «не загрузилось».
      seeSay(`MAX17: смотрю «${file.name}»…`);
      try {
        let dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ''));
          reader.onerror = () => reject(reader.error ?? new Error('read failed'));
          reader.readAsDataURL(file);
        });

        // Снимок с телефона весит мегабайты, а base64 добавляет к ним ещё
        // треть — nginx рубит такое тело, и загрузка молча не доезжает. Ядру
        // подробности не нужны: и пиксельный разбор, и модель работают с
        // уменьшенной копией. Видео не трогаем — его не пережать на канвасе.
        if (isImage) {
          dataUrl = await new Promise<string>((resolve) => {
            const img = new Image();
            img.onload = () => {
              const side = 1600;
              const scale = Math.min(1, side / Math.max(img.width, img.height));
              if (scale >= 1) return resolve(dataUrl);
              const canvas = document.createElement('canvas');
              canvas.width = Math.round(img.width * scale);
              canvas.height = Math.round(img.height * scale);
              const ctx = canvas.getContext('2d');
              if (!ctx) return resolve(dataUrl);
              ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
              resolve(canvas.toDataURL('image/jpeg', 0.85));
            };
            img.onerror = () => resolve(dataUrl);
            img.src = dataUrl;
          });
        }
        const seen = await sendMax17Event({
          type: 'see',
          image: dataUrl,
          name: file.name,
          mime: file.type,
          mode: isVideo ? 'video' : 'photo',
        });
        const text = String(seen?.answer?.text || '').trim();
        if (text) {
          seeSay(`MAX17: ${text}`);
          // Взгляд обязан осесть в истории беседы. Раньше описание жило только
          // в ленте статуса, и на вопрос «а что там слева?» ядру нечего было
          // вспомнить: в диалоге картинки как будто не было.
          try {
            const sid = sessionId ?? undefined;
            await saveMessage('user', `[прислал файл: ${file.name}]`, sid);
            await saveMessage('model', text, sid);
          } catch {
            /* история не критична для показа ответа */
          }
        } else {
          const why = String((seen as { error?: unknown })?.error || 'ничего не разглядел');
          seeSay(`MAX17: не увидел «${file.name}» — ${why}`);
        }
      } catch (error) {
        const why = error instanceof Error ? error.message : String(error);
        seeSay(`MAX17: не смог посмотреть «${file.name}» — ${why}`);
      } finally {
        setIsLoading(false);
      }
      return;
    }

    const MAX_BYTES = 1_000_000;
    if (file.size > MAX_BYTES) {
      setAgiMessage(`MAX17: файл «${file.name}» больше 1 МБ — пришли кусок поменьше.`);
      return;
    }
    try {
      const text = await file.text();
      // Признак двоичного файла: управляющие символы и «замены» от декодера.
      const damaged = (text.slice(0, 4000).match(/[\uFFFD\u0000-\u0008\u000E-\u001F]/g) || []).length;
      if (damaged > 40 || text.startsWith('%PDF')) {
        setAgiMessage(
          `MAX17: «${file.name}» — это не текст, а двоичный файл. Читать его как текст бессмысленно: ` +
          `пришли картинкой, если это скан, или выгрузи содержимое в .txt/.md.`,
        );
        return;
      }
      const trimmed = text.slice(0, 20_000);
      setAttached({ name: file.name, text: trimmed });
      setAgiMessage(
        `MAX17: файл «${file.name}» прочитан (${trimmed.length.toLocaleString('ru-RU')} символов). Напиши, что с ним сделать.`,
      );
    } catch {
      setAgiMessage(`MAX17: не смог прочитать «${file.name}» — нужен текстовый файл.`);
    }
  };

  if (!isLoaded) {
    return <div className="hud-loading">{t('common.loading')}…</div>;
  }

  return (
    <>
      <GameHud
        rank={rank}
        topPercent={calcTopPercent(rank)}
        time={formatTime(now)}
        date={formatDate(now)}
        temperature={28}
        missions={tasks}
        rewardXp={rewardXp}
        energy={energy}
        focus={focus}
        reputationLevel={reputationLevel}
        balance={balance}
        onlineCount={1247}
        agiMessage={agiMessage}
        log={log}
        promptText={promptText}
        input={input}
        attachedName={attached?.name}
        onAttachClear={() => setAttached(null)}
        onFilePick={handleFilePick}
        isListening={isListening}
        isLoading={isLoading}
        isCameraActive={cameraStatus === 'active' || cameraStatus === 'starting'}
        isSpeechEnabled={isSpeechEnabled}
        isHandsFree={handsFree}
        isCodeOpen={codeOpen}
        isDesktopOpen={desktopOpen}
        isArchitectOpen={architectOpen}
        isModelsOpen={modelsOpen}
        isVoiceOpen={voiceOpen}
        coreStatus={coreStatus}
        activeNav={activeNav}
        navBadges={navBadges}
        onInputChange={setInput}
        onSend={handleSend}
        onToggleListen={toggleListen}
        onToggleCamera={toggleCamera}
        onToggleSpeech={toggleSpeech}
        onToggleHandsFree={toggleHandsFree}
        onToggleCode={() => setCodeOpen((v) => !v)}
        onToggleDesktop={() => setDesktopOpen((v) => !v)}
        onToggleArchitect={() => setArchitectOpen((v) => !v)}
        onToggleModels={() => setModelsOpen((v) => !v)}
        onToggleVoice={() => setVoiceOpen((v) => !v)}
        onToggleAppearance={() => setAppearanceOpen((v) => !v)}
        onNavChange={handleNavChange}
        onMissionToggle={handleMissionToggle}
        onDefaultMissionComplete={handleDefaultMissionComplete}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
          }
        }}
      />
      {cameraStatus !== 'off' && (
        <div className={`fixed ${CAMERA_POS[cameraCorner]} z-10 w-[min(220px,calc(100vw-32px))] overflow-hidden rounded-md border border-cyan-300/25 bg-black/50 shadow-[0_0_22px_rgba(0,242,255,0.14)] backdrop-blur-md`}>
          {cameraStatus === 'active' ? (
            <div className="relative">
              <video
                ref={cameraVideoRef}
                className="aspect-video w-full bg-black object-cover opacity-80"
                muted
                playsInline
                autoPlay
              />
              <canvas
                ref={cameraOverlayRef}
                className="pointer-events-none absolute inset-0 h-full w-full"
              />
            </div>
          ) : (
            <div className="flex aspect-video w-full items-center justify-center bg-black/70 px-3 text-center text-[9px] uppercase tracking-[0.18em] text-cyan-100/60">
              {cameraStatus === 'starting' ? 'camera boot' : cameraError || 'camera error'}
            </div>
          )}
          <canvas ref={cameraCanvasRef} className="hidden" />
          <div className="flex items-center justify-between border-t border-cyan-300/15 px-2 py-1 text-[8px] uppercase tracking-[0.2em] text-cyan-100/55">
            <span>sensor</span>
            <span>{cameraStatus}</span>
          </div>
        </div>
      )}
      {codeOpen &&
        // На телефоне остаётся прежняя консоль: терминал живёт клавиатурой —
        // историей по стрелкам, автодополнением по Tab, слэш-командами, — а на
        // экранной клавиатуре всего этого нет, и вместо управления получается
        // борьба с вводом. Порог тот же, что у остального HUD (hud.css, 700px).
        (compactViewport ? (
          <CodeConsole onClose={() => setCodeOpen(false)} initialTask={codeTask} initialTarget={codeTarget} />
        ) : (
          <CodeTerminal onClose={() => setCodeOpen(false)} initialTask={codeTask} initialTarget={codeTarget} />
        ))}
      {desktopOpen && <DesktopConsole onClose={() => setDesktopOpen(false)} initialTask={desktopTask} />}
      {architectOpen && (
        <ArchitectConsole
          onClose={() => setArchitectOpen(false)}
          onImplement={(task) => {
            setCodeTarget('project');
            setCodeTask(task);
            setCodeOpen(true);
            setArchitectOpen(false);
          }}
        />
      )}
      {modelsOpen && <ModelSwitcher onClose={() => setModelsOpen(false)} />}
      {appearanceOpen && (
        <AppearancePanel
          onClose={() => setAppearanceOpen(false)}
          background={wm.background}
          onSetBackground={(id) => wm.setBackground(id)}
        />
      )}
      {voiceOpen && (
        <VoiceSignature
          onClose={() => setVoiceOpen(false)}
          contextText={input}
          onObservation={(payload) => {
            void emitMax17HudEvent(payload as Max17HudEvent).then((res) => {
              const note = res?.answer?.text;
              if (note) pushLog(`🎙 ${note}`);
            });
          }}
        />
      )}
      {max17State && (
        <div
          className="pointer-events-none fixed bottom-[112px] left-1/2 z-10 max-w-[min(520px,calc(100vw-32px))] -translate-x-1/2 truncate border border-cyan-300/20 bg-black/40 px-3 py-1 text-[9px] uppercase tracking-[0.22em] text-cyan-100/70 shadow-[0_0_18px_rgba(0,242,255,0.12)] backdrop-blur-md"
          title={max17State.next_adaptation}
        >
          <span className="text-cyan-300/90">MAX17:</span>{' '}
          <span>{max17State.route}</span>
          <span className="px-1 text-white/25">·</span>
          <span>{max17Confidence}%</span>
          <span className="px-1 text-white/25">·</span>
          <span className={max17State.voiceOk ? 'text-emerald-300/90' : 'text-white/45'}>
            {max17State.voiceOk ? `⚡ ${max17State.voiceModel}` : '⚙ синапсы'}
          </span>
          {max17State.next_adaptation && (
            <>
              <span className="px-1 text-white/25">·</span>
              <span className="normal-case tracking-normal text-white/45">
                {max17State.next_adaptation}
              </span>
            </>
          )}
        </div>
      )}
    </>
  );
}

export default function HudApp() {
  return (
    <FirestoreErrorBoundary>
      <WindowManagerProvider>
        <HudContent />
      </WindowManagerProvider>
    </FirestoreErrorBoundary>
  );
}
