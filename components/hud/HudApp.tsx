'use client';

import React, { useState, useRef, useEffect, useCallback, Component, type ReactNode, type ErrorInfo } from 'react';
import { GameHud, type HudNavId } from './GameHud';
import { useGameState } from '@/hooks/use-game-state';
import { sendMax17Event, type Max17Response } from '@/lib/max17-client';
import { VoiceSignature } from './VoiceSignature';
import { AppearancePanel } from './AppearancePanel';
import { applyTheme, initTheme } from './themes';
import { WindowManagerProvider, useWindowManager } from './window-manager';
import { interpretUiCommand, type UiCommand } from './ui-commands';
import { detectFaces, prewarmFaceApi, type FaceReading } from './face-detect';
import { useVoiceWake } from './use-voice-wake';
import { CodeConsole } from './CodeConsole';
import { DesktopConsole } from './DesktopConsole';
import { ArchitectConsole } from './ArchitectConsole';
import { ModelSwitcher } from './ModelSwitcher';
import './hud.css';

const AGI_INTRO =
  'Цифровой агент нового поколения, созданный помогать вам достигать целей и решать сложные задачи. GAME анализирует контекст, предлагает квесты и ведёт вас к результату.';

type Max17HudEvent = Record<string, unknown>;
type CameraStatus = 'off' | 'starting' | 'active' | 'error';

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

class FirestoreErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; errorInfo: unknown }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error) {
    try {
      return { hasError: true, errorInfo: JSON.parse(error.message) };
    } catch {
      return { hasError: true, errorInfo: { error: error.message } };
    }
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

function formatClock(d: Date) {
  return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function formatDate(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())} / ${pad(d.getMonth() + 1)} / ${d.getFullYear()}`;
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
  const {
    xp,
    tasks,
    rank,
    isLoaded,
    completeTask,
    createSession,
    saveMessage,
    sessions,
  } = useGameState();

  const wm = useWindowManager();

  const [now, setNow] = useState(() => new Date());
  const [input, setInput] = useState('');
  const [agiMessage, setAgiMessage] = useState(AGI_INTRO);
  const [isListening, setIsListening] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [handsFree, setHandsFree] = useState(false);
  const [codeOpen, setCodeOpen] = useState(false);
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
  }, []);
  const [isSpeechEnabled, setIsSpeechEnabled] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [cameraStatus, setCameraStatus] = useState<CameraStatus>('off');
  const [cameraError, setCameraError] = useState('');
  const [cameraCorner, setCameraCorner] = useState<'bottom' | 'left' | 'right' | 'top'>('bottom');
  const [activeNav, setActiveNav] = useState<HudNavId>('codex');
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

  useEffect(() => {
    isLoadingRef.current = isLoading;
  }, [isLoading]);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const SR = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!SR) return;

    const rec = new SR();
    rec.continuous = false;
    rec.interimResults = true;
    rec.lang = 'ru-RU';

    rec.onresult = (event: SpeechRecognitionEvent) => {
      let finalTranscript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript;
        }
      }
      if (finalTranscript) {
        setInput((prev) => (prev ? `${prev} ${finalTranscript}` : finalTranscript).trim());
      }
    };

    rec.onerror = () => setIsListening(false);
    rec.onend = () => setIsListening(false);
    recognitionRef.current = rec;
  }, []);

  const toggleListen = useCallback(() => {
    const rec = recognitionRef.current;
    if (!rec) return;
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
      if (!isSpeechEnabled || typeof window === 'undefined' || !window.speechSynthesis) return;
      const cleanText = text.replace(/\s+/g, ' ').trim();
      if (!cleanText) return;

      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(cleanText);
      utterance.lang = 'ru-RU';
      utterance.rate = 0.95;
      utterance.pitch = 0.92;
      utterance.onstart = () => setIsSpeaking(true);
      utterance.onend = () => setIsSpeaking(false);
      utterance.onerror = () => setIsSpeaking(false);
      window.speechSynthesis.speak(utterance);
    },
    [isSpeechEnabled],
  );

  const toggleSpeech = useCallback(() => {
    setIsSpeechEnabled((enabled) => {
      const next = !enabled;
      if (enabled && typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel();
        setIsSpeaking(false);
      }
      return next;
    });
  }, []);

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

  const pushLog = useCallback((line: string) => {
    const clean = line.trim();
    if (!clean) return;
    setLog((prev) => [clean, ...prev].slice(0, 24));
  }, []);

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
    [wm],
  );

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
        ? ' Открой страницу как http://localhost:3002/game — по сетевому IP (192.168.x.x) браузер блокирует камеру без HTTPS.'
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
        hint = ' Открой страницу как http://localhost:3002/game (камера требует HTTPS/localhost).';
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
      if (active) detectTimer = window.setTimeout(detectLoop, 220);
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
          const boxes = faceReadingRef.current?.boxes ?? [];
          ctx.shadowColor = 'rgba(0,242,255,0.8)';
          ctx.shadowBlur = 8;
          for (const b of boxes) {
            const x = b.x * w;
            const y = b.y * h;
            const bw = b.w * w;
            const bh = b.h * h;
            ctx.fillStyle = 'rgba(0,242,255,0.08)';
            ctx.fillRect(x, y, bw, bh);
            ctx.lineWidth = 2;
            ctx.strokeStyle = 'rgba(0,242,255,0.9)';
            ctx.strokeRect(x, y, bw, bh);
            ctx.shadowBlur = 0;
            ctx.fillStyle = 'rgba(0,242,255,0.95)';
            ctx.font = '9px monospace';
            ctx.fillText('лицо', x + 2, Math.max(10, y - 3));
            ctx.shadowBlur = 8;
          }
          ctx.shadowBlur = 0;
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
      const res = await emitMax17HudEvent({ type: 'autonomous_research', limit: 3 });
      const note = res?.next_adaptation;
      if (note && /придумал|закрыл/i.test(note)) {
        pushLog(`🧠 ${note}`);
        setAgiMessage(`MAX17: ${note}`);
      }
    };
    const interval = window.setInterval(() => {
      void tick();
    }, 60_000);
    return () => window.clearInterval(interval);
  }, [emitMax17HudEvent, pushLog]);

  const handleSend = async (override?: string) => {
    const userMsg = (override ?? input).trim();
    if (!userMsg || isLoading) return;
    lastActivityRef.current = Date.now(); // reset the idle-flywheel timer

    // Fast local path: interface control by text or voice ("закрой миссии",
    // "смени фон", "сбрось окна"). Executed instantly; still forwarded to Max17
    // in the background so the cognitive core keeps the memory trace.
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
      return;
    }

    setInput('');
    setIsLoading(true);
    setAgiMessage(`Вы: ${userMsg} MAX17: обрабатываю событие...`);

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

      const max17 = await emitMax17HudEvent(
        {
          type: 'user_message',
          text: userMsg,
          source: 'hud',
          timestamp: new Date().toISOString(),
        },
        true,
      );

      // Orchestrator: a code/desktop task is routed to its agent automatically.
      const dispatch = max17?.dispatch;
      if (dispatch?.instruction && (dispatch.route === 'code' || dispatch.route === 'desktop')) {
        const note = max17?.answer?.text || 'Передаю задачу агенту…';
        if (dispatch.route === 'code') {
          setCodeTask(dispatch.instruction);
          setCodeOpen(true);
        } else {
          setDesktopTask(dispatch.instruction);
          setDesktopOpen(true);
        }
        setAgiMessage(`Вы: ${userMsg} MAX17: ${note}`);
        pushLog(`Вы: ${userMsg}`);
        pushLog(`MAX17: ${note}`);
        speakMax17(note);
        await saveMessage('model', note, sid);
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
    } catch (e) {
      console.error(e);
      setAgiMessage(
        `Вы: ${userMsg} MAX17: не удалось сохранить или обработать сообщение. HUD остаётся активным без Gemini.`,
      );
    } finally {
      setIsLoading(false);
    }
  };

  // Hands-free: wake word ("Макс17 / просыпайся") or a clap opens a listening
  // window; the captured command is sent to Max17 immediately (no manual send).
  useVoiceWake({
    enabled: handsFree,
    onCommand: (text) => {
      setInput('');
      void handleSend(text);
    },
    onWake: () => {
      playCue();
      setAgiMessage('MAX17: слушаю команду…');
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

  const pendingTasks = tasks.filter((t) => t.status !== 'completed' && t.status !== 'failed');
  const rewardXp = pendingTasks.reduce((sum, t) => sum + (t.xp || 0), 0) || 5000;

  const reputationLevel = Math.max(1, Math.floor(xp / 450) + 1);
  const energy = Math.min(99, 70 + Math.floor((xp % 1000) / 15));
  const focus = Math.min(99, 75 + Math.floor((xp % 500) / 12));
  const balance = Math.max(12450, xp * 12 + 8000);

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
    ? 'Камера недоступна...'
    : cameraStatus === 'starting'
    ? 'Камера подключается...'
    : isSpeaking
      ? 'MAX17 говорит...'
      : isListening
    ? 'Слушаю вас...'
    : isLoading
      ? 'Думаю над ответом...'
      : 'Я слушаю. Что нужно сделать?';
  const max17Confidence = max17State ? Math.round(max17State.confidence * 100) : 0;
  const coreStatus: 'idle' | 'listening' | 'processing' | 'speaking' = isLoading
    ? 'processing'
    : isSpeaking
      ? 'speaking'
      : isListening
        ? 'listening'
        : 'idle';

  if (!isLoaded) {
    return <div className="hud-loading">Загрузка HUD...</div>;
  }

  return (
    <>
      <GameHud
        rank={rank}
        topPercent={calcTopPercent(rank)}
        time={formatClock(now)}
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
        friendsBadge={2}
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
        onNavChange={setActiveNav}
        onMissionToggle={handleMissionToggle}
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
      {codeOpen && (
        <CodeConsole onClose={() => setCodeOpen(false)} initialTask={codeTask} initialTarget={codeTarget} />
      )}
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
