'use client';

import React, { useState, useRef, useEffect, useCallback, Component, type ReactNode, type ErrorInfo } from 'react';
import { GameHud, type HudNavId } from './GameHud';
import { useGameState } from '@/hooks/use-game-state';
import { sendMax17Event, type Max17Response } from '@/lib/max17-client';
import './hud.css';

const AGI_INTRO =
  'Цифровой агент нового поколения, созданный помогать вам достигать целей и решать сложные задачи. GAME анализирует контекст, предлагает квесты и ведёт вас к результату.';

type Max17HudEvent = Record<string, unknown>;
type CameraStatus = 'off' | 'starting' | 'active' | 'error';

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

function sceneModeFromVision({
  brightness,
  contrast,
  dominantTone,
  motionScore,
}: {
  brightness: number;
  contrast: number;
  dominantTone: string;
  motionScore: number;
}) {
  if (brightness < 0.2) return 'dark';
  if (brightness > 0.72) return 'bright-room';
  if (
    contrast > 0.24 &&
    ['cool-blue', 'violet-blue', 'neutral'].includes(dominantTone)
  ) {
    return 'screen-facing';
  }
  if (motionScore > 0.16) return 'active-room';
  if (brightness >= 0.25 && brightness <= 0.68 && motionScore < 0.08) return 'desk';
  return 'room';
}

function visionSummaryText(observation: Omit<CameraObservation, 'summary'>) {
  const modeText: Record<string, string> = {
    dark: 'тёмная среда',
    'bright-room': 'яркая комната',
    'screen-facing': 'похоже на экран или рабочее место',
    'active-room': 'в кадре есть движение',
    desk: 'стабильное рабочее место',
    room: 'обычная комната',
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
    contrast,
    dominantTone,
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

  const [now, setNow] = useState(() => new Date());
  const [input, setInput] = useState('');
  const [agiMessage, setAgiMessage] = useState(AGI_INTRO);
  const [isListening, setIsListening] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSpeechEnabled, setIsSpeechEnabled] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [cameraStatus, setCameraStatus] = useState<CameraStatus>('off');
  const [activeNav, setActiveNav] = useState<HudNavId>('codex');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [max17State, setMax17State] = useState<Pick<Max17Response, 'route' | 'confidence' | 'next_adaptation'> | null>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null);
  const cameraCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const previousCameraLuminanceRef = useRef<number[] | null>(null);
  const systemStateSentRef = useRef(false);
  const knownTaskIdsRef = useRef<Set<string>>(new Set());
  const emittedFailedTaskIdsRef = useRef<Set<string>>(new Set());

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

  const emitMax17HudEvent = useCallback(
    async (event: Max17HudEvent, surfaceState = false) => {
      try {
        const max17 = await sendMax17Event(event);
        if (surfaceState) {
          setMax17State({
            route: max17.route,
            confidence: max17.confidence,
            next_adaptation: max17.next_adaptation,
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

  const captureEnvironmentObservation = useCallback(async (announce = true) => {
    const video = cameraVideoRef.current;
    const canvas = cameraCanvasRef.current;
    if (!video || !canvas) return null;

    const analysis = analyzeCameraFrame(video, canvas, previousCameraLuminanceRef.current);
    if (!analysis) return null;

    previousCameraLuminanceRef.current = analysis.luminance;
    const observation = analysis.observation;

    const max17 = await emitMax17HudEvent(
      {
        type: 'environment_observation',
        text: `Vision summary: ${observation.summary}. Scene mode ${observation.scene_mode}, brightness ${observation.brightness}, motion ${observation.motion_level}`,
        source: 'hud_camera',
        timestamp: new Date().toISOString(),
        camera: {
          active: true,
          ...observation,
          vision_summary: {
            scene_mode: observation.scene_mode,
            summary: observation.summary,
            light_level: observation.light_level,
            motion_level: observation.motion_level,
            stability: observation.stability,
            confidence: 0.42,
            method: 'local_frame_statistics_v0',
          },
          privacy: 'no_image_uploaded',
        },
      },
      true,
    );

    if (announce && max17?.answer?.text) {
      const reply = formatMax17HudReply(max17);
      setAgiMessage(`MAX17: ${reply}`);
      speakMax17(reply);
    }

    return observation;
  }, [emitMax17HudEvent, speakMax17]);

  const stopCamera = useCallback(() => {
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
    cameraStreamRef.current = null;
    previousCameraLuminanceRef.current = null;
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

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setCameraStatus('error');
      setAgiMessage('MAX17: камера недоступна в этом браузере.');
      window.setTimeout(() => setCameraStatus('off'), 1600);
      return;
    }

    try {
      setCameraStatus('starting');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
        },
        audio: false,
      });
      cameraStreamRef.current = stream;
      setCameraStatus('active');
    } catch (error) {
      console.error('Camera start failed:', error);
      setCameraStatus('error');
      setAgiMessage('MAX17: не смог получить доступ к камере. Разреши доступ в браузере и попробуй ещё раз.');
      window.setTimeout(() => setCameraStatus('off'), 2200);
    }
  }, [cameraStatus, stopCamera]);

  useEffect(() => {
    if (cameraStatus !== 'active') return;
    const video = cameraVideoRef.current;
    const stream = cameraStreamRef.current;
    if (!video || !stream) return;

    video.srcObject = stream;
    void video.play().catch(() => undefined);
    const timer = window.setTimeout(() => {
      void captureEnvironmentObservation(true);
    }, 900);
    const interval = window.setInterval(() => {
      void captureEnvironmentObservation(false);
    }, 15000);

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

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;
    const userMsg = input.trim();
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

      const fullResponse = max17
        ? formatMax17HudReply(max17)
        : 'Локальный Max17-мост сейчас недоступен. Сообщение принято, основной HUD продолжает работать.';

      setAgiMessage(`Вы: ${userMsg} MAX17: ${fullResponse}`);
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

  const promptText = cameraStatus === 'starting'
    ? 'Камера подключается...'
    : isSpeaking
      ? 'MAX17 говорит...'
      : isListening
    ? 'Слушаю вас...'
    : isLoading
      ? 'Думаю над ответом...'
      : 'Я слушаю. Что нужно сделать?';
  const max17Confidence = max17State ? Math.round(max17State.confidence * 100) : 0;

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
        promptText={promptText}
        input={input}
        isListening={isListening}
        isLoading={isLoading}
        isCameraActive={cameraStatus === 'active' || cameraStatus === 'starting'}
        isSpeechEnabled={isSpeechEnabled}
        activeNav={activeNav}
        friendsBadge={2}
        onInputChange={setInput}
        onSend={handleSend}
        onToggleListen={toggleListen}
        onToggleCamera={toggleCamera}
        onToggleSpeech={toggleSpeech}
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
        <div className="fixed bottom-[172px] left-1/2 z-10 w-[min(220px,calc(100vw-32px))] -translate-x-1/2 overflow-hidden rounded-md border border-cyan-300/25 bg-black/50 shadow-[0_0_22px_rgba(0,242,255,0.14)] backdrop-blur-md">
          {cameraStatus === 'active' ? (
            <video
              ref={cameraVideoRef}
              className="aspect-video w-full bg-black object-cover opacity-80"
              muted
              playsInline
              autoPlay
            />
          ) : (
            <div className="flex aspect-video w-full items-center justify-center bg-black/70 text-[9px] uppercase tracking-[0.24em] text-cyan-100/60">
              {cameraStatus === 'starting' ? 'camera boot' : 'camera error'}
            </div>
          )}
          <canvas ref={cameraCanvasRef} className="hidden" />
          <div className="flex items-center justify-between border-t border-cyan-300/15 px-2 py-1 text-[8px] uppercase tracking-[0.2em] text-cyan-100/55">
            <span>sensor</span>
            <span>{cameraStatus}</span>
          </div>
        </div>
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
      <HudContent />
    </FirestoreErrorBoundary>
  );
}
