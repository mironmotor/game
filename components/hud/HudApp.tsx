'use client';

import React, { useState, useRef, useEffect, useCallback, Component, type ReactNode, type ErrorInfo } from 'react';
import { GameHud, type HudNavId } from './GameHud';
import VoiceSignature from './VoiceSignature';
import { useGameState } from '@/hooks/use-game-state';
import { sendMax17Event, type Max17Response } from '@/lib/max17-client';
import { FlowStreamlines } from '@/components/hud/FlowStreamlines';
import './hud.css';

const AGI_INTRO =
  'Цифровой агент нового поколения, созданный помогать вам достигать целей и решать сложные задачи. GAME анализирует контекст, предлагает квесты и ведёт вас к результату.';

type Max17HudEvent = Record<string, unknown>;

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
  // Прикреплённый файл: содержимое уходит Максу вместе с сообщением.
  const [attached, setAttached] = useState<{ name: string; text: string } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [activeNav, setActiveNav] = useState<HudNavId>('codex');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [max17State, setMax17State] = useState<Pick<
    Max17Response,
    'route' | 'confidence' | 'next_adaptation' | 'flow'
  > | null>(null);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [conversationContext, setConversationContext] = useState('');
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const micRef = useRef<{ stream: MediaStream; ctx: AudioContext } | null>(null);
  const earModeRef = useRef<() => void>(() => {});
  const [srAvailable, setSrAvailable] = useState(true);
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
    setSrAvailable(!!SR);
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

    rec.onerror = (event: Event & { error?: string }) => {
      setIsListening(false);
      // На iOS/некоторых браузерах SR есть, но сервис падает сразу (network /
      // service-not-allowed). Тогда честно включаем микрофон — режим уха.
      const code = event.error ?? '';
      if (code && code !== 'aborted' && code !== 'no-speech') {
        setSrAvailable(false);
        earModeRef.current();
      }
    };
    rec.onend = () => setIsListening(false);
    recognitionRef.current = rec;
  }, []);

  const stopMicFallback = useCallback(() => {
    if (micRef.current) {
      micRef.current.stream.getTracks().forEach((t) => t.stop());
      micRef.current.ctx.close().catch(() => {});
      micRef.current = null;
    }
  }, []);

  const toggleListen = useCallback(async () => {
    if (isListening) {
      try { recognitionRef.current?.stop(); } catch { /* уже остановлен */ }
      stopMicFallback();
      setIsListening(false);
      return;
    }

    const rec = recognitionRef.current;
    if (rec) {
      try {
        rec.start();
        setIsListening(true);
        return;
      } catch { /* InvalidState и т.п. — падаем в фолбэк ниже */ }
    }

    await startEarMode();
  }, [isListening, stopMicFallback]); // eslint-disable-line react-hooks/exhaustive-deps

  // Фолбэк «режим уха»: браузер не умеет распознавание (iPhone и др.) —
  // честно включаем микрофон, чтобы кнопка реально работала и слушала.
  const startEarMode = useCallback(async () => {
    if (micRef.current) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx();
      ctx.createMediaStreamSource(stream); // держим граф живым
      micRef.current = { stream, ctx };
      setIsListening(true);
    } catch {
      setAgiMessage('Микрофон недоступен: разреши доступ к микрофону для этого сайта (нужен HTTPS) и попробуй ещё раз.');
    }
  }, []);

  useEffect(() => { earModeRef.current = () => { void startEarMode(); }; }, [startEarMode]);
  useEffect(() => () => stopMicFallback(), [stopMicFallback]);

  const emitMax17HudEvent = useCallback(
    async (event: Max17HudEvent, surfaceState = false) => {
      try {
        const max17 = await sendMax17Event(event);
        if (surfaceState) {
          setMax17State({
            route: max17.route,
            confidence: max17.confidence,
            next_adaptation: max17.next_adaptation,
            flow: max17.flow,
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

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;
    const userMsg = input.trim();
    setInput('');
    setConversationContext(userMsg);
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

      const textForCore = attached
        ? `${userMsg}\n\n[ФАЙЛ: ${attached.name}]\n${attached.text}`
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

      const fullResponse = max17
        ? formatMax17HudReply(max17)
        : 'Локальный Max17-мост сейчас недоступен. Сообщение принято, основной HUD продолжает работать.';

      setAgiMessage(`Вы: ${userMsg} MAX17: ${fullResponse}`);
      setAttached(null);
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

  const promptText = isListening
    ? srAvailable
      ? 'Слушаю вас...'
      : 'Режим уха: микрофон включён (распознавание речи в этом браузере недоступно)'
    : isLoading
      ? 'Думаю над ответом...'
      : 'Я слушаю. Что нужно сделать?';
  const max17Confidence = max17State ? Math.round(max17State.confidence * 100) : 0;

  // Файл читаем прямо в браузере: наружу уходит уже текст, сам файл никуда не
  // загружается. Ограничения — чтобы длинный файл не вытеснил из ответа всё.
  const handleFilePick = useCallback(async (file: File) => {
    const MAX_BYTES = 1_000_000;
    if (file.size > MAX_BYTES) {
      setAgiMessage(`MAX17: файл «${file.name}» больше 1 МБ — пришли кусок поменьше.`);
      return;
    }
    try {
      const text = await file.text();
      const trimmed = text.slice(0, 20_000);
      setAttached({ name: file.name, text: trimmed });
      setAgiMessage(
        `MAX17: файл «${file.name}» прочитан (${trimmed.length.toLocaleString('ru-RU')} символов). Напиши, что с ним сделать.`,
      );
    } catch {
      setAgiMessage(`MAX17: не смог прочитать «${file.name}» — нужен текстовый файл.`);
    }
  }, []);

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
        attachedName={attached?.name}
        onAttachClear={() => setAttached(null)}
        onFilePick={handleFilePick}
        isListening={isListening}
        isLoading={isLoading}
        activeNav={activeNav}
        friendsBadge={2}
        onInputChange={setInput}
        onSend={handleSend}
        onToggleListen={toggleListen}
        onNavChange={setActiveNav}
        onMissionToggle={handleMissionToggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
          }
        }}
      />
      <button
        type="button"
        onClick={() => setVoiceOpen(true)}
        className="fixed bottom-[72px] right-4 z-20 flex h-12 w-12 items-center justify-center rounded-full border border-cyan-300/30 bg-[#0a0818]/80 text-lg shadow-[0_0_22px_rgba(0,242,255,0.2)] backdrop-blur-md transition hover:scale-105 hover:border-cyan-300/60"
        title="Звуковая сигнатура — Max17 читает состояние по голосу"
        aria-label="Открыть звуковую сигнатуру"
      >
        ◉
      </button>
      <VoiceSignature
        open={voiceOpen}
        onClose={() => setVoiceOpen(false)}
        context={conversationContext}
        userId="miron"
      />
      {max17State && (
        <div
          className="pointer-events-none fixed bottom-[112px] left-1/2 z-10 max-w-[min(520px,calc(100vw-32px))] -translate-x-1/2 truncate border border-cyan-300/20 bg-black/40 px-3 py-1 text-[9px] uppercase tracking-[0.22em] text-cyan-100/70 shadow-[0_0_18px_rgba(0,242,255,0.12)] backdrop-blur-md"
          title={max17State.next_adaptation}
        >
          <span className="text-cyan-300/90">MAX17:</span>{' '}
          <span>{max17State.route}</span>
          <span className="px-1 text-white/25">·</span>
          <span>{max17Confidence}%</span>
          {max17State.flow?.stream?.length ? (
            <>
              <span className="px-1 text-white/25">·</span>
              <FlowStreamlines flow={max17State.flow} />
            </>
          ) : null}
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
