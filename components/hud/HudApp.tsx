'use client';

import React, { useState, useRef, useEffect, useCallback, Component, type ReactNode, type ErrorInfo } from 'react';
import { GameHud, type HudNavId } from './GameHud';
import { useGameState } from '@/hooks/use-game-state';
import { getGeminiResponseStream } from '@/lib/gemini';
import './hud.css';

const AGI_INTRO =
  'Цифровой агент нового поколения, созданный помогать вам достигать целей и решать сложные задачи. GAME анализирует контекст, предлагает квесты и ведёт вас к результату.';

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

function HudContent() {
  const {
    xp,
    tasks,
    rank,
    isLoaded,
    completeTask,
    createSession,
    saveMessage,
    messages: dbMessages,
    sessions,
  } = useGameState();

  const [now, setNow] = useState(() => new Date());
  const [input, setInput] = useState('');
  const [agiMessage, setAgiMessage] = useState(AGI_INTRO);
  const [isListening, setIsListening] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [activeNav, setActiveNav] = useState<HudNavId>('codex');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);

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

  const getHistoryContext = useCallback(() => {
    return `Total XP: ${xp}. Rank: #${rank}. Active tasks: ${tasks.filter((t) => t.status !== 'completed').length}.`;
  }, [xp, rank, tasks]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;
    const userMsg = input.trim();
    setInput('');
    setIsLoading(true);
    setAgiMessage('Обрабатываю запрос...');

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

      const sessionMessages = dbMessages.filter((m) => m.sessionId === activeSessionId);
      const history = sessionMessages.slice(-10).map((m) => ({
        role: m.role as 'user' | 'model',
        parts: [{ text: m.content }],
      }));

      const stream = await getGeminiResponseStream(userMsg, history, getHistoryContext());
      let fullResponse = '';

      for await (const chunk of stream) {
        if (chunk.text) {
          fullResponse += chunk.text;
          setAgiMessage(fullResponse);
        }
      }

      if (fullResponse) {
        await saveMessage('model', fullResponse, sid);
      } else {
        setAgiMessage('Не удалось получить ответ. Попробуйте ещё раз.');
      }
    } catch (e) {
      console.error(e);
      setAgiMessage('Ошибка связи с AGI. Проверьте GEMINI_API_KEY в .env.local');
    } finally {
      setIsLoading(false);
    }
  };

  const handleMissionToggle = async (taskId: string) => {
    const task = tasks.find((t) => t.id === taskId);
    if (task && task.status !== 'completed') {
      await completeTask(taskId);
    }
  };

  const pendingTasks = tasks.filter((t) => t.status !== 'completed' && t.status !== 'failed');
  const rewardXp = pendingTasks.reduce((sum, t) => sum + (t.xp || 0), 0) || 5000;

  const reputationLevel = Math.max(1, Math.floor(xp / 450) + 1);
  const energy = Math.min(99, 70 + Math.floor((xp % 1000) / 15));
  const focus = Math.min(99, 75 + Math.floor((xp % 500) / 12));
  const balance = Math.max(12450, xp * 12 + 8000);

  const promptText = isListening
    ? 'Слушаю вас...'
    : isLoading
      ? 'Думаю над ответом...'
      : 'Я слушаю. Что нужно сделать?';

  if (!isLoaded) {
    return <div className="hud-loading">Загрузка HUD...</div>;
  }

  return (
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
  );
}

export default function HudApp() {
  return (
    <FirestoreErrorBoundary>
      <HudContent />
    </FirestoreErrorBoundary>
  );
}
