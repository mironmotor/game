'use client';

import React, { useState, useRef, useEffect, Component, ErrorInfo, ReactNode } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Terminal, Send, Zap, Trophy, ListChecks, Play, CheckCircle2, Circle, Home, BarChart3, User as UserIcon, AlertTriangle, Cpu, Loader2, ChevronDown, ChevronUp, Flame, BatteryMedium, CloudFog, Target, X, Activity, Mic, MicOff, Code, FileText, Brain, Image as ImageIcon, Plus, History } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { getGeminiResponse, getGeminiResponseStream } from '@/lib/gemini';
import { useGameState, Task, Message as GameMessage } from '@/hooks/use-game-state';
import { useBinauralBeats, AuraFrequency } from '@/hooks/use-binaural-beats';
import { AuraBackground } from '@/components/AuraVisualizer';
// firebase stub imported for any remaining references
import '@/firebase';

import Image from 'next/image';

interface Message {
  role: 'user' | 'model';
  content: string;
}

import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';

// Error Boundary for Firestore Errors
class FirestoreErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean, errorInfo: any }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, errorInfo: null };
  }

  static getDerivedStateFromError(error: any) {
    try {
      const info = JSON.parse(error.message);
      return { hasError: true, errorInfo: info };
    } catch {
      return { hasError: true, errorInfo: { error: error.message } };
    }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-black text-red-500 font-mono p-8 flex flex-col items-center justify-center text-center">
          <AlertTriangle size={48} className="mb-4 animate-pulse" />
          <h2 className="text-2xl font-black mb-2 uppercase tracking-tighter">Критическая ошибка синхронизации</h2>
          <div className="max-w-md bg-red-500/10 border border-red-500/30 p-4 rounded-lg text-xs leading-relaxed">
            {this.state.errorInfo?.error || "Произошла неизвестная ошибка при доступе к базе данных."}
          </div>
          <button 
            onClick={() => window.location.reload()}
            className="mt-6 px-6 py-2 border border-red-500 text-red-500 hover:bg-red-500 hover:text-black transition-all uppercase text-[10px] font-black"
          >
            Перезагрузить систему
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function GameContent() {
  const { user, xp, tasks, messages: dbMessages, sessions, rank, dailyHistory, updateTasks, completeTask, addXp, launchGame, setTaskActive, saveMessage, createSession, updateSessionTitle, deleteSession, executeTaskWithAi, deleteTasks, isLoaded } = useGameState();
  const [isStarted, setIsStarted] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [currentAgiSessionId, setCurrentAgiSessionId] = useState<string | null>(null);
  const [sessionToDelete, setSessionToDelete] = useState<string | null>(null);
  const recognitionRef = useRef<any>(null);
  const voiceTargetRef = useRef<'home' | 'agi'>('home');
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const hasAutoSelectedSession = useRef(false);

  useEffect(() => {
    if (isLoaded && sessions.length > 0 && !hasAutoSelectedSession.current) {
      hasAutoSelectedSession.current = true;
      const recentSession = sessions.find(s => !s.mode || !s.mode.startsWith('agi_'));
      if (recentSession) {
        setCurrentSessionId(recentSession.id);
        setMessages(dbMessages.filter(m => m.sessionId === recentSession.id));
      }
    }
  }, [isLoaded, sessions, dbMessages]);

  useEffect(() => {
    // Initialize audio element
    audioRef.current = new Audio();
  }, []);

  useEffect(() => {
    if (isLoaded && isStarted) {
      const activeTasks = tasks.filter(t => t.status !== 'completed' && t.status !== 'failed');
      if (activeTasks.length > 0) {
        setAgentInsight(`Обнаружено ${activeTasks.length} активных задач. Ближайший дедлайн: ${activeTasks[0].desc}. Чем могу помочь с их выполнением?`);
      } else {
        setAgentInsight('Все задачи выполнены. Ожидаю новых директив.');
      }
    }
  }, [isLoaded, isStarted, tasks.length]);
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognition) {
        recognitionRef.current = new SpeechRecognition();
        recognitionRef.current.continuous = false;
        recognitionRef.current.interimResults = true;
        recognitionRef.current.lang = 'ru-RU';

        recognitionRef.current.onresult = (event: any) => {
          let interimTranscript = '';
          let finalTranscript = '';

          for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
              finalTranscript += event.results[i][0].transcript;
            } else {
              interimTranscript += event.results[i][0].transcript;
            }
          }
          
          if (finalTranscript) {
            if (voiceTargetRef.current === 'agi') {
              setAgiInput(prev => {
                const newText = prev + (prev ? ' ' : '') + finalTranscript;
                setTimeout(() => {
                  const sendBtn = document.getElementById('agi-send-btn');
                  if (sendBtn) sendBtn.click();
                }, 500);
                return newText;
              });
            } else {
              setInput(prev => {
                const newText = prev + (prev ? ' ' : '') + finalTranscript;
                setTimeout(() => {
                  const sendBtn = document.getElementById('send-btn');
                  if (sendBtn) sendBtn.click();
                }, 500);
                return newText;
              });
            }
          }
        };

        recognitionRef.current.onerror = (event: any) => {
          console.error('Speech recognition error', event.error);
          setIsListening(false);
        };

        recognitionRef.current.onend = () => {
          setIsListening(false);
        };
      }
    }
  }, []);

  const toggleVoiceInput = (target: 'home' | 'agi' = 'home') => {
    if (isListening) {
      if (voiceTargetRef.current !== target) {
        // Switch target while listening
        voiceTargetRef.current = target;
      } else {
        recognitionRef.current?.stop();
        setIsListening(false);
      }
    } else {
      voiceTargetRef.current = target;
      recognitionRef.current?.start();
      setIsListening(true);
    }
  };
  const [isLoading, setIsLoading] = useState(false);
  const [systemModel, setSystemModel] = useState<'gemini3' | 'multiagent'>('gemini3');
  const [time, setTime] = useState<string>('');
  const [agentInsight, setAgentInsight] = useState<string>('Инициализация нейросети... Ожидание паттернов поведения.');
  const [currentTab, setCurrentTab] = useState<'home' | 'stats' | 'character' | 'god'>('character');
  const [energyMode, setEnergyMode] = useState<'idle' | 'high' | 'normal' | 'low'>('idle');
  const [selectedOrbitalTaskId, setSelectedOrbitalTaskId] = useState<string | null>(null);
  const [isAgiPanelOpen, setIsAgiPanelOpen] = useState(false);
  const [isAgiHistoryOpen, setIsAgiHistoryOpen] = useState(false);
  const [selectedAgiMode, setSelectedAgiMode] = useState<'code' | 'text' | 'psychology' | 'game' | 'background' | 'image' | null>(null);
  const [characterBg, setCharacterBg] = useState<string>('default');
  const [isAgiInitializing, setIsAgiInitializing] = useState(false);
  const [agiSessionActive, setAgiSessionActive] = useState(false);
  const [agiMessages, setAgiMessages] = useState<GameMessage[]>([]);
  const [agiInput, setAgiInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const agiScrollRef = useRef<HTMLDivElement>(null);
  const [expandedAiTask, setExpandedAiTask] = useState<string | null>(null);
  const [showBonus, setShowBonus] = useState(false);
  const [auraFreq, setAuraFreq] = useState<AuraFrequency>('off');
  const [isAuraPanelOpen, setIsAuraPanelOpen] = useState(false);

  // Hook for binaural audio
  useBinauralBeats(auraFreq, 0.4);

  const handleCompleteTask = async (taskId: string) => {
    const isAllCompleted = await completeTask(taskId);
    if (selectedOrbitalTaskId === taskId) {
      setSelectedOrbitalTaskId(null);
    }
    if (isAllCompleted) {
      setShowBonus(true);
      setTimeout(() => setShowBonus(false), 10000);
    }
  };

  const getHistoryContext = () => {
    const historyStr = dailyHistory.map(h => `${h.date}: ${h.xp} XP`).join(', ');
    const recentMsgs = (dbMessages || []).slice(-10).map(m => `${m.role}: ${m.content}`).join('\n');
    const activeTasks = tasks.filter(t => t.status !== 'completed' && t.status !== 'failed');
    const currentTasksStr = activeTasks.map(t => `[ID: ${t.id}] ${t.desc} (Status: ${t.status})`).join('\n');
    
    const completedTasks = tasks.filter(t => t.status === 'completed').slice(-5).map(t => t.desc).join(', ');
    const failedTasks = tasks.filter(t => t.status === 'failed').slice(-5).map(t => t.desc).join(', ');

    return `Total XP: ${xp}. Rank: #${rank}. Daily History: ${historyStr}. Today is ${new Date().toISOString()}.
    
    CURRENT ACTIVE TASKS:
    ${currentTasksStr || 'No active tasks.'}

    RECENTLY COMPLETED TASKS (Successes):
    ${completedTasks || 'None recently.'}

    RECENTLY FAILED TASKS (Struggles):
    ${failedTasks || 'None recently.'}
    
    RECENT DIALOGUE CONTEXT:
    ${recentMsgs}`;
  };

  useEffect(() => {
    setTime(new Date().toLocaleTimeString());
    const timer = setInterval(() => {
      setTime(new Date().toLocaleTimeString());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    if (agiScrollRef.current) {
      agiScrollRef.current.scrollTop = agiScrollRef.current.scrollHeight;
    }
  }, [agiMessages]);

  const handleAgiInit = async (mode: string) => {
    if (!mode) return;
    setIsAgiInitializing(true);
    
    const modeNames: Record<string, string> = {
      code: 'Код',
      text: 'Текст',
      psychology: 'Психология',
      game: 'Игра',
      image: 'Изображения'
    };
    
    const newSessionId = await createSession(`Модуль: ${modeNames[mode] || mode}`, `agi_${mode}`);
    if (newSessionId) {
      setCurrentAgiSessionId(newSessionId);
    }
    
    setTimeout(async () => {
      setIsAgiInitializing(false);
      setAgiSessionActive(true);
      let greeting = '';
      if (mode === 'code') greeting = 'Помощник по коду готов. Опишите задачу, скиньте код для рефакторинга или задайте вопрос по архитектуре.';
      if (mode === 'text') greeting = 'Редактор текста готов. Отправьте текст для улучшения, копирайтинга или смысловой упаковки.';
      if (mode === 'psychology') greeting = 'Психолог на связи. Расскажите, что вас беспокоит, или опишите ситуацию для анализа.';
      if (mode === 'game') greeting = 'Модуль GAME активирован. Режим управления реальностью запущен. Готов превратить твою жизнь в высокоэффективную игру. Какую сферу прокачиваем?';
      if (mode === 'image') greeting = 'Генератор изображений активирован. Опишите, что вы хотите увидеть, и я создам это для вас.';
      
      setAgiMessages([{ 
        id: Date.now().toString(),
        role: 'model', 
        content: greeting,
        timestamp: new Date().toISOString()
      }]);
      
      if (newSessionId) {
        await saveMessage('model', greeting, newSessionId);
      }
    }, 1500);
  };

  const handleAgiSend = async () => {
    if (!agiInput.trim() || isLoading) return;
    const userMsg = agiInput.trim();
    setAgiInput('');
    setAgiMessages(prev => [...prev, { 
      id: Date.now().toString(),
      role: 'user', 
      content: userMsg,
      timestamp: new Date().toISOString()
    }]);
    
    if (currentAgiSessionId) {
      await saveMessage('user', userMsg, currentAgiSessionId);
    }
    
    setIsLoading(true);

    try {
      if (selectedAgiMode === 'image') {
        const { generateImage } = await import('@/lib/gemini');
        const imageUrl = await generateImage(userMsg);
        
        const responseText = imageUrl ? 'Изображение сгенерировано.' : 'Не удалось сгенерировать изображение.';
        
        setAgiMessages(prev => [...prev, { 
          id: Date.now().toString(),
          role: 'model', 
          content: responseText,
          imageUrl: imageUrl || undefined,
          timestamp: new Date().toISOString()
        }]);
        
        if (currentAgiSessionId) {
          await saveMessage('model', responseText, currentAgiSessionId);
        }
        
        setIsLoading(false);
        return;
      }

      let systemPrompt = '';
      if (selectedAgiMode === 'code') systemPrompt = 'Ты — профессиональный Senior-разработчик. Твоя задача писать чистый, оптимизированный код, проводить рефакторинг и помогать с архитектурой. Отвечай кратко, по делу, без лишней воды.';
      if (selectedAgiMode === 'text') systemPrompt = 'Ты — профессиональный редактор и копирайтер. Твоя задача писать сильные, убедительные тексты, делать качественную редактуру и смысловую упаковку. Твой стиль: лаконичный, понятный, бьющий точно в цель.';
      if (selectedAgiMode === 'psychology') systemPrompt = 'Ты — профессиональный психолог и коуч. Твоя задача помогать пользователю с фокусом, мотивацией, анализировать когнитивные искажения и эмоциональные состояния. Отвечай эмпатично, вдумчиво и профессионально.';
      if (selectedAgiMode === 'game') systemPrompt = 'Ты AGI-модуль "GAME". Твоя задача — геймифицировать жизнь пользователя, делать ее максимально продуктивной. Относись к его жизни как к RPG-игре, где есть квесты, статы и уровни. Давай четкие, выполнимые задания (квесты) и советы по "прокачке" навыков. Стиль: мотивирующий, энергичный, как у наставника из киберпанк-игры.';

      const history = agiMessages.map(m => ({
        role: m.role as 'user' | 'model',
        parts: [{ text: m.content }]
      }));

      let stream: AsyncGenerator<any, void, unknown>;
      if (selectedAgiMode === 'game') {
        const { getMultiAgentGeminiResponseStream } = await import('@/lib/gemini');
        stream = await getMultiAgentGeminiResponseStream(userMsg, history, getHistoryContext());
      } else {
        const { getGeminiResponseStream } = await import('@/lib/gemini');
        stream = await getGeminiResponseStream(userMsg, history, undefined, systemPrompt);
      }
      
      let fullResponse = '';
      let isFirstChunk = true;

      for await (const chunk of stream) {
        if (isFirstChunk) {
          setIsLoading(false);
          isFirstChunk = false;
          setAgiMessages(prev => [...prev, { 
            id: Date.now().toString(),
            role: 'model', 
            content: '',
            timestamp: new Date().toISOString()
          }]);
        }
        if (chunk.text) {
          fullResponse += chunk.text;
          setAgiMessages(prev => {
            const newMsgs = [...prev];
            newMsgs[newMsgs.length - 1] = { 
              ...newMsgs[newMsgs.length - 1],
              role: 'model', 
              content: fullResponse 
            };
            return newMsgs;
          });
        }
      }
      
      if (fullResponse && currentAgiSessionId) {
        await saveMessage('model', fullResponse, currentAgiSessionId);

        // Auto-generate title logic
        const sessionMessages = dbMessages.filter(m => m.sessionId === currentAgiSessionId);
        if (sessionMessages.length === 0) {
          try {
            const { getGeminiResponse } = await import('@/lib/gemini');
            const titleResponse = await getGeminiResponse(`Сгенерируй короткое название (2-4 слова) для начала диалога: "${userMsg}"`, [], '', 'Ты генератор названий. Отвечай только названием, без кавычек.');
            if (titleResponse) {
              await updateSessionTitle(currentAgiSessionId, titleResponse.trim());
            }
          } catch (e) {
            console.error('Failed to generate title', e);
          }
        }

        // Generate and play speech (Web Speech API speaks directly, no audio URL needed)
        try {
          const { generateSpeech } = await import('@/lib/gemini');
          const textForSpeech = fullResponse.replace(/```json\s*[\s\S]*?\s*```/g, '').replace(/[*_~`#]/g, '').trim();
          if (textForSpeech) {
            await generateSpeech(textForSpeech);
          }
        } catch (e) {
          console.error("AGI Speech generation failed:", e);
        }
      }
      
      if (isFirstChunk) setIsLoading(false);
    } catch (error: any) {
      if (error.name === 'AbortError' || (error.message && (error.message.includes('aborted') || error.message.includes('abort')))) {
        console.log('AGI request aborted');
      } else if (error.message && error.message.includes('fetch')) {
        console.warn('AGI request network error: Failed to fetch');
        setAgiMessages(prev => [...prev.slice(0, -1), { ...prev[prev.length - 1], content: 'Ошибка сети. Проверьте подключение.' }]);
      } else {
        console.error("AGI Response Error:", error);
      }
      setIsLoading(false);
    }
  };

  const handleGodSend = async () => {
    if (!agiInput.trim() || isLoading) return;
    const userMsg = agiInput.trim();
    setAgiInput('');
    setAgiMessages(prev => [...prev, { 
      id: Date.now().toString(),
      role: 'user', 
      content: userMsg,
      timestamp: new Date().toISOString()
    }]);

    if (!currentAgiSessionId) {
       const newId = await createSession("Новый тест", "god");
       if (newId) setCurrentAgiSessionId(newId);
    }
    const finalSessionId = currentAgiSessionId;
    
    if (finalSessionId) {
      await saveMessage('user', userMsg, finalSessionId);
    }
    
    setIsLoading(true);

    try {
      const history = agiMessages.map(m => {
        // Strip the internal reasoning block to prevent hallucination loops
        let cleanText = m.content;
        const reasoningRegex = /> \*\*\[СИСТЕМНЫЙ АНАЛИЗ МУЛЬТИАГЕНТА\]\*\*[\s\S]*?> \*\*\[СИНТЕЗ ФИНАЛЬНОГО ОТВЕТА\.\.\.\]\*\*\n\n---\n\n/g;
        cleanText = cleanText.replace(reasoningRegex, '').trim();

        return {
          role: m.role as 'user' | 'model',
          parts: [{ text: cleanText }]
        };
      });

      const { getMultiAgentGeminiResponseStream } = await import('@/lib/gemini');
      // Pass showReasoning = true
      const stream = await getMultiAgentGeminiResponseStream(userMsg, history, getHistoryContext(), true);
      
      let fullResponse = '';
      let isFirstChunk = true;

      for await (const chunk of stream) {
        if (isFirstChunk) {
          setIsLoading(false);
          isFirstChunk = false;
          setAgiMessages(prev => [...prev, { 
            id: Date.now().toString(),
            role: 'model', 
            content: '',
            timestamp: new Date().toISOString()
          }]);
        }
        if (chunk.text) {
          fullResponse += chunk.text;
          setAgiMessages(prev => {
            const newMsgs = [...prev];
            newMsgs[newMsgs.length - 1] = { 
              ...newMsgs[newMsgs.length - 1],
              role: 'model', 
              content: fullResponse 
            };
            return newMsgs;
          });
        }
      }
      
      if (fullResponse && finalSessionId) {
        await saveMessage('model', fullResponse, finalSessionId);

        const sessionMessages = dbMessages.filter(m => m.sessionId === finalSessionId);
        if (sessionMessages.length === 0) {
          try {
            const { getGeminiResponse } = await import('@/lib/gemini');
            const titleResponse = await getGeminiResponse(`Сгенерируй короткое название (2-4 слова) для теста: "${userMsg}"`, [], '', 'Ты генератор названий.');
            if (titleResponse) {
              await updateSessionTitle(finalSessionId, titleResponse.trim());
            }
          } catch (e) {
            console.error('Failed to generate title', e);
          }
        }
      }
      
      if (isFirstChunk) setIsLoading(false);
    } catch (error: any) {
      console.error("GOD Response Error:", error);
      setIsLoading(false);
    }
  };

  const handleContinue = () => {
    // Enter the game silently — restore last session without sending AI greeting
    if (audioRef.current) {
      audioRef.current.src = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';
      audioRef.current.play().catch(() => {});
    }
    const lastSession = sessions.find(s => !s.mode || !s.mode.startsWith('agi_'));
    if (lastSession) {
      setCurrentSessionId(lastSession.id);
      setMessages(dbMessages.filter(m => m.sessionId === lastSession.id));
    }
    const lastMode = (lastSession?.mode as 'high' | 'normal' | 'low') || 'normal';
    setEnergyMode(['high','normal','low'].includes(lastMode) ? lastMode : 'normal');
    setIsStarted(true);
  };

  const handleStart = async (mode: 'high' | 'normal' | 'low') => {
    // Unlock audio context on user interaction
    if (audioRef.current) {
      audioRef.current.src = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA'; // Silent 1ms wav
      audioRef.current.play().catch(() => {});
    }

    setEnergyMode(mode);
    setIsLoading(true);
    let newSessionId: string | null = null;
    try {
      await launchGame();
      setIsStarted(true);
      
      const modeNames = { high: 'Высокая энергия', normal: 'Нормальный', low: 'Анти-Перегруз' };
      newSessionId = await createSession(`Сеанс: ${modeNames[mode]}`, mode);
      if (newSessionId) {
        setCurrentSessionId(newSessionId);
        setMessages([]); // Clear current messages for the new session
      }
      
      const activeTasks = tasks.filter(t => t.status !== 'completed' && t.status !== 'failed');
      
      if (activeTasks.length > 0) {
        const simpleTasks = activeTasks.filter(t => t.mgr === 'MGR-1').map(t => `- ${t.desc}`).join('\n');
        const mediumTasks = activeTasks.filter(t => t.mgr === 'MGR-2').map(t => `- ${t.desc}`).join('\n');
        const hardTasks = activeTasks.filter(t => t.mgr === 'MGR-3').map(t => `- ${t.desc}`).join('\n');
        
        let taskContext = '';
        if (simpleTasks) taskContext += `Простые (MGR-1):\n${simpleTasks}\n`;
        if (mediumTasks) taskContext += `Средние (MGR-2):\n${mediumTasks}\n`;
        if (hardTasks) taskContext += `Сложные (MGR-3):\n${hardTasks}\n`;

        initialMsg = `[СИСТЕМА: ПРОДОЛЖЕНИЕ СЕССИИ] Пользователь вернулся. Энергия: ${mode}.
Активные задачи:
${taskContext}
Дай краткий статус и спроси с чего начнём.`;
      } else {
        initialMsg = `[СИСТЕМА: НОВАЯ СЕССИЯ] Нет активных задач. Энергия: ${mode}.
Задай 3 вопроса по MGR:
1. Главная задача дня (MGR-3)?
2. Задачи фокуса (MGR-2)?
3. Мелкая логистика (MGR-1)?
После ответов — создай задачи в JSON.`;
      }
      
      // Start fresh history for the new session
      const history: any[] = [];
      
      let stream: AsyncGenerator<any, void, unknown>;
      if (systemModel === 'multiagent') {
        const { getMultiAgentGeminiResponseStream } = await import('@/lib/gemini');
        stream = await getMultiAgentGeminiResponseStream(initialMsg, history, getHistoryContext());
      } else {
        stream = await getGeminiResponseStream(initialMsg, history, getHistoryContext());
      }
      let fullResponse = '';
      
      let isFirstChunk = true;
      for await (const chunk of stream) {
        if (isFirstChunk) {
          setIsLoading(false);
          isFirstChunk = false;
          setMessages([{ role: 'model', content: '' }]);
        }
        if (chunk.text) {
          fullResponse += chunk.text;
          setMessages([{ role: 'model', content: fullResponse }]);
        }
      }
      
      if (isFirstChunk) setIsLoading(false);
      
      if (fullResponse) {
        await saveMessage('model', fullResponse, newSessionId || undefined);
        
        // Generate and play speech
        try {
          const { generateSpeech } = await import('@/lib/gemini');
          // Clean up response for speech (remove markdown, json blocks)
          const textForSpeech = fullResponse.replace(/```json\s*[\s\S]*?\s*```/g, '').replace(/[*_~`#]/g, '').trim();
          if (textForSpeech) {
            const audioDataUrl = await generateSpeech(textForSpeech);
            if (audioDataUrl && audioRef.current) {
              audioRef.current.src = audioDataUrl;
              audioRef.current.play().catch(e => console.error("Could not play audio automatically:", e));
            }
          }
        } catch (e) {
          console.error("Speech generation failed:", e);
        }

        const jsonMatch = fullResponse.match(/```json\s*([\s\S]*?)\s*```/);
        if (jsonMatch) {
          try {
            const data = JSON.parse(jsonMatch[1]);
            if (data.agent_insight) setAgentInsight(data.agent_insight);
          } catch (e) { console.error(e); }
        }
      }
    } catch (error: any) {
      if (newSessionId) {
        await deleteSession(newSessionId);
        setCurrentSessionId(null);
      }
      if (error.name === 'AbortError' || (error.message && (error.message.includes('aborted') || error.message.includes('abort')))) {
        console.log('Start game request aborted');
      } else if (error.message && error.message.includes('fetch')) {
        console.warn('Start game network error: Failed to fetch');
      } else {
        console.error("Start Game Error:", error);
      }
      setIsLoading(false);
    }
  };

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    // Unlock audio context on user interaction
    if (audioRef.current) {
      audioRef.current.src = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA'; // Silent 1ms wav
      audioRef.current.play().catch(() => {});
    }

    const userMsg = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    setIsLoading(true);

    let isNewSession = false;
    let activeSessionId = currentSessionId;

    try {
      // If current session is an AGI session, create a new game session for main chat
      if (activeSessionId) {
        const session = sessions.find(s => s.id === activeSessionId);
        if (session && session.mode?.startsWith('agi_')) {
          activeSessionId = null;
        }
      }
      
      if (!activeSessionId) {
        activeSessionId = await createSession('Новый сеанс', 'game');
        setCurrentSessionId(activeSessionId);
        isNewSession = true;
      }

      await saveMessage('user', userMsg, activeSessionId || undefined);
      
      const sessionMessages = dbMessages.filter(m => m.sessionId === activeSessionId);
      const history = sessionMessages.slice(-10).map(m => ({
        role: m.role as 'user' | 'model',
        parts: [{ text: m.content }]
      }));
      
      let stream: AsyncGenerator<any, void, unknown>;
      if (systemModel === 'multiagent') {
        const { getMultiAgentGeminiResponseStream } = await import('@/lib/gemini');
        stream = await getMultiAgentGeminiResponseStream(userMsg, history, getHistoryContext());
      } else {
        stream = await getGeminiResponseStream(userMsg, history, getHistoryContext());
      }
      let fullResponse = '';
      
      let isFirstChunk = true;
      for await (const chunk of stream) {
        if (isFirstChunk) {
          setIsLoading(false);
          isFirstChunk = false;
          setMessages(prev => [...prev, { role: 'model', content: '' }]);
        }
        if (chunk.text) {
          fullResponse += chunk.text;
          setMessages(prev => {
            const newMsgs = [...prev];
            newMsgs[newMsgs.length - 1] = { role: 'model', content: fullResponse };
            return newMsgs;
          });
        }
      }
      
      if (isFirstChunk) setIsLoading(false);
      
      if (fullResponse) {
        await saveMessage('model', fullResponse, activeSessionId || undefined);
        
        // Auto-generate title for new sessions
        if (activeSessionId && sessionMessages.length === 0) {
          try {
            const { getGeminiResponse } = await import('@/lib/gemini');
            const titleResponse = await getGeminiResponse(`Сгенерируй очень короткое название (2-4 слова) для этого диалога: "${userMsg}"`, [], '', 'Ты генератор названий. Отвечай только названием, без кавычек.');
            if (titleResponse) {
              await updateSessionTitle(activeSessionId, titleResponse.trim());
            }
          } catch (e) {
            console.error('Failed to generate title', e);
          }
        }

        // Generate and play speech
        try {
          const { generateSpeech } = await import('@/lib/gemini');
          const textForSpeech = fullResponse.replace(/```json\s*[\s\S]*?\s*```/g, '').replace(/[*_~`#]/g, '').trim();
          if (textForSpeech) {
            const audioDataUrl = await generateSpeech(textForSpeech);
            if (audioDataUrl && audioRef.current) {
              audioRef.current.src = audioDataUrl;
              audioRef.current.play().catch(e => console.error("Could not play audio automatically:", e));
            }
          }
        } catch (e) {
          console.error("Speech generation failed:", e);
        }

        const jsonMatch = fullResponse.match(/```json\s*([\s\S]*?)\s*```/);
        if (jsonMatch) {
          try {
            const data = JSON.parse(jsonMatch[1]);
            if (data.tasks) {
              await updateTasks(data.tasks);
            }
            if (data.delete_tasks && Array.isArray(data.delete_tasks)) {
              await deleteTasks(data.delete_tasks);
            }
            if (data.complete_tasks && Array.isArray(data.complete_tasks)) {
              for (const taskId of data.complete_tasks) {
                await handleCompleteTask(taskId);
              }
            }
            if (data.xp_gain) {
              await addXp(data.xp_gain);
            }
            if (data.agent_insight) {
              setAgentInsight(data.agent_insight);
            }
          } catch (e) {
            console.error("Failed to parse task JSON", e);
          }
        }
      }
    } catch (error: any) {
      if (isNewSession && activeSessionId) {
        await deleteSession(activeSessionId);
        setCurrentSessionId(null);
      }
      if (error.name === 'AbortError' || (error.message && (error.message.includes('aborted') || error.message.includes('abort')))) {
        console.log('Main chat request aborted');
        // Remove the empty model message if aborted early
        setMessages(prev => prev[prev.length - 1].content === '' ? prev.slice(0, -1) : prev);
      } else if (error.message && error.message.includes('fetch')) {
        console.warn('Main chat network error: Failed to fetch');
        setMessages(prev => {
          const newMsgs = [...prev];
          newMsgs[newMsgs.length - 1] = { role: 'model', content: "Сетевая ошибка. Проверь интернет и API ключ." };
          return newMsgs;
        });
      } else {
        console.error("Handle Send Error:", error);
        setMessages(prev => {
          const newMsgs = [...prev];
          newMsgs[newMsgs.length - 1] = { role: 'model', content: `Ошибка API: ${error.message || 'unknown'}. Проверь консоль браузера (F12).` };
          return newMsgs;
        });
      }
      setIsLoading(false);
    }
  };

  const renderContent = (content: string) => {
    let cleaned = content.replace(/```json\s*([\s\S]*?)\s*```/g, '');
    cleaned = cleaned.replace(/```json[\s\S]*$/, '');
    return cleaned.trim();
  };

  const renderedHuman = React.useMemo(() => {
    const dots = [];
    const spacing = 4.5; // Increased spacing for better performance (less dots)
    const maxRadius = 1.8; // Slightly larger dots to compensate for spacing

    const distToSegmentSq = (px: number, py: number, x1: number, y1: number, x2: number, y2: number) => {
      const l2 = (x2 - x1) ** 2 + (y2 - y1) ** 2;
      if (l2 === 0) return (px - x1) ** 2 + (py - y1) ** 2;
      let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
      t = Math.max(0, Math.min(1, t));
      return (px - (x1 + t * (x2 - x1))) ** 2 + (py - (y1 + t * (y2 - y1))) ** 2;
    };

    // Scaled down by 25% (0.75x multiplier from previous x2 scale)
    const skeleton = [
      // [x1, y1, x2, y2, radius, intensity]
      [150, 45, 150, 82, 18, 1.6],   // Head
      [150, 82, 150, 97, 12, 1.2],   // Neck
      [117, 105, 183, 105, 21, 1.4], // Shoulders
      [150, 105, 150, 172, 36, 1.8], // Chest/Upper Torso
      [150, 172, 150, 217, 30, 1.5], // Waist/Lower Torso
      
      [117, 105, 97, 172, 15, 1.3],  // L-Arm Upper
      [97, 172, 87, 232, 12, 1.2],   // L-Arm Lower
      [87, 232, 84, 243, 10, 1.1],   // L-Hand
      
      [183, 105, 203, 172, 15, 1.3], // R-Arm Upper
      [203, 172, 213, 232, 12, 1.2], // R-Arm Lower
      [213, 232, 216, 243, 10, 1.1], // R-Hand
      
      [132, 217, 120, 307, 21, 1.4], // L-Leg Upper
      [120, 307, 114, 397, 16, 1.2], // L-Leg Lower
      [114, 397, 117, 412, 10, 1.0], // L-Foot
      
      [168, 217, 180, 307, 21, 1.4], // R-Leg Upper
      [180, 307, 186, 397, 16, 1.2], // R-Leg Lower
      [186, 397, 183, 412, 10, 1.0], // R-Foot
    ];

    for (let x = 40; x <= 260; x += spacing) {
      for (let y = 20; y <= 450; y += spacing) {
        let maxDensity = 0;

        for (const [x1, y1, x2, y2, r, intensity] of skeleton) {
          const dSq = distToSegmentSq(x, y, x1, y1, x2, y2);
          const density = intensity * Math.exp(-dSq / (r * r * 0.7));
          if (density > maxDensity) maxDensity = density;
        }

        if (maxDensity > 0.15) {
          const visualDensity = Math.min(1.2, maxDensity);
          let radius = visualDensity * maxRadius;
          
          // Premium monochromatic look (white/gray dots for dark mode)
          let fill = "rgba(255, 255, 255, 0.85)"; 
          let opacity = Math.min(1, maxDensity * 0.9);

          dots.push(
            <circle
              key={`${x}-${y}`}
              cx={x}
              cy={y}
              r={radius}
              fill={fill}
              opacity={opacity}
            />
          );
        }
      }
    }

    return (
      <g className="infographic-human">
        {dots}
      </g>
    );
  }, []);

  if (!isLoaded) {
    return (
      <div className="min-h-screen bg-[#050505] flex items-center justify-center">
        <div className="text-[#00ff88] font-mono text-xs animate-pulse tracking-[0.5em] uppercase">
          Загрузка нейронных связей...
        </div>
      </div>
    );
  }

  return (
    <div className={`min-h-screen text-[#00ff88] font-mono selection:bg-[#00ff88]/30 px-2 py-2 md:p-6 flex flex-col items-center bg-[linear-gradient(to_right,#00ff8805_1px,transparent_1px),linear-gradient(to_bottom,#00ff8805_1px,transparent_1px)] bg-[size:40px_40px] relative ${auraFreq === 'off' ? 'bg-[#050505]' : 'bg-transparent'}`}>
      <AuraBackground frequency={auraFreq} />
      <div className="w-full max-w-[1600px] flex flex-col gap-3 md:gap-6 relative z-10">
        
        {/* Header Metrics */}
        {isStarted && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 sticky top-0 z-50 bg-[#050505]/80 backdrop-blur-md py-2 border-b border-[#00ff88]/10">
          <div className="border border-[#00ff88]/20 bg-black/40 p-3 rounded-lg flex flex-col gap-1 shadow-[0_0_15px_rgba(0,255,136,0.05)] relative overflow-hidden">
            <div className="text-[9px] uppercase tracking-widest text-[#00ff88]/50 flex items-center gap-2">
              <Zap size={10} /> Уровень XP
            </div>
            <div className="text-xl font-bold text-[#00ff88]">{xp}</div>
            <div className="absolute bottom-0 left-0 h-0.5 bg-[#00ff88]/10 w-full">
              <motion.div 
                className="h-full bg-[#00ff88]" 
                initial={{ width: 0 }}
                animate={{ width: `${(xp % 1000) / 10}%` }}
              />
            </div>
          </div>
          <div className={`border ${rank <= 5000 ? 'border-[#ffd700]/30 bg-[#ffd700]/5 shadow-[0_0_15px_rgba(255,215,0,0.1)]' : 'border-[#00aaff]/20 bg-black/40 shadow-[0_0_15px_rgba(0,170,255,0.05)]'} p-3 rounded-lg flex flex-col gap-1`}>
            <div className={`text-[9px] uppercase tracking-widest ${rank <= 5000 ? 'text-[#ffd700]/50' : 'text-[#00aaff]/50'} flex items-center gap-2`}>
              <Trophy size={10} /> Уровень в мире
            </div>
            <div className={`text-xl font-bold ${rank <= 5000 ? 'text-[#ffd700] drop-shadow-[0_0_8px_rgba(255,215,0,0.5)]' : 'text-[#00aaff]'}`}>#{rank}</div>
          </div>
          <div className="col-span-2 md:col-span-1 border border-[#00ff88]/30 bg-[#00ff88]/5 p-3 rounded-lg flex-col gap-1 shadow-[0_0_15px_rgba(0,255,136,0.1)] relative overflow-hidden flex">
            <div className="text-[9px] uppercase tracking-widest text-[#00ff88]/70 flex items-center gap-2">
              <Cpu size={10} /> Системный статус
            </div>
            <div className="mt-1">
              <select 
                value={systemModel}
                onChange={(e) => setSystemModel(e.target.value as 'gemini3' | 'multiagent')}
                className="w-full bg-black/50 border border-[#00ff88]/30 text-[#00ff88] text-[10px] font-black tracking-widest uppercase rounded px-2 py-1 outline-none appearance-none cursor-pointer"
              >
                <option value="gemini3">Gemini 3.1 (Текущая)</option>
                <option value="multiagent">GAME AI (Мультиагент)</option>
                <option value="openclaw" disabled>OpenClaw (Скоро)</option>
              </select>
            </div>
          </div>
          <div 
            onClick={() => setIsAuraPanelOpen(true)}
            className="hidden md:flex border border-[#ff00ff]/20 bg-black/40 p-3 rounded-lg flex-col gap-1 shadow-[0_0_15px_rgba(255,0,255,0.05)] cursor-pointer hover:bg-[#ff00ff]/10 hover:border-[#ff00ff]/50 transition-all group"
          >
            <div className="text-[9px] uppercase tracking-widest text-[#ff00ff]/50 flex items-center justify-between gap-2 group-hover:text-[#ff00ff]">
              <div className="flex items-center gap-2"><Zap size={10} /> Аура</div>
              <Activity size={10} className={auraFreq !== 'off' ? 'animate-pulse text-[#ff00ff]' : ''} />
            </div>
            <div className="text-[10px] font-bold text-[#ff00ff] flex items-center gap-2">
              Вибрации: {auraFreq === 'off' ? 'Выкл' : auraFreq}
            </div>
          </div>
          
          {/* User Section */}
          <div className="col-span-2 md:col-span-1 border border-white/10 bg-black/40 p-3 rounded-lg flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 overflow-hidden">
              <UserIcon size={16} className="text-[#00ff88]/50" />
              <div className="text-[9px] uppercase font-black truncate text-white/70">{user.displayName || 'Boss'}</div>
            </div>
          </div>
        </div>
        )}

        {isStarted && (
          <div className="flex justify-center gap-2 md:gap-8 mb-2 md:mb-4 border-b border-[#1a1a1a] pb-2 overflow-x-auto scrollbar-hide">
            <button 
              onClick={() => setCurrentTab('character')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all whitespace-nowrap ${
                currentTab === 'character' 
                  ? 'text-[#ff00ff] bg-[#ff00ff]/10 border border-[#ff00ff]/30 shadow-[0_0_15px_rgba(255,0,255,0.1)]' 
                  : 'text-white/40 hover:text-white/60'
              }`}
            >
              <UserIcon size={18} />
              <span className="text-[10px] uppercase tracking-[0.2em] font-black">ПЕРСОНАЖ</span>
            </button>
            <button 
              onClick={() => setCurrentTab('home')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all whitespace-nowrap ${
                currentTab === 'home' 
                  ? 'text-[#00ff88] bg-[#00ff88]/10 border border-[#00ff88]/30 shadow-[0_0_15px_rgba(0,255,136,0.1)]' 
                  : 'text-white/40 hover:text-white/60'
              }`}
            >
              <Home size={18} />
              <span className="text-[10px] uppercase tracking-[0.2em] font-black">ДОМ</span>
            </button>
            <button 
              onClick={() => setCurrentTab('stats')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all whitespace-nowrap ${
                currentTab === 'stats' 
                  ? 'text-[#00aaff] bg-[#00aaff]/10 border border-[#00aaff]/30 shadow-[0_0_15px_rgba(0,170,255,0.1)]' 
                  : 'text-white/40 hover:text-white/60'
              }`}
            >
              <BarChart3 size={18} />
              <span className="text-[10px] uppercase tracking-[0.2em] font-black">СТАТИСТИКА</span>
            </button>
            {(user?.email?.toLowerCase().includes('maghveu') || user?.email?.toLowerCase().includes('gem.1284a37')) && (
              <button 
              onClick={() => {
                setCurrentTab('god');
                // pre-select the first god session if none is selected
                const godSessions = sessions.filter(s => s.mode === 'god');
                if (!currentAgiSessionId && godSessions.length > 0) {
                  setCurrentAgiSessionId(godSessions[0].id);
                  const msgsForSession = dbMessages.filter(m => m.sessionId === godSessions[0].id);
                  setAgiMessages(msgsForSession as any[]);
                }
              }}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all whitespace-nowrap ${
                  currentTab === 'god' 
                    ? 'text-red-500 bg-red-500/10 border border-red-500/30 shadow-[0_0_15px_rgba(255,0,0,0.2)]' 
                    : 'text-white/40 hover:text-white/60'
                }`}
              >
                <Flame size={18} />
                <span className="text-[10px] uppercase tracking-[0.2em] font-black tracking-[0.3em]">GOD</span>
              </button>
            )}
          </div>
        )}

        {!isStarted ? (
          <div className="flex flex-col items-center justify-center gap-8 py-20">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-center space-y-2 mb-8"
            >
              <h1 className="text-4xl md:text-6xl font-black tracking-tighter text-white">СИСТЕМА ИНИЦИАЛИЗИРОВАНА</h1>
              <p className="text-[#00ff88]/40 text-sm uppercase tracking-[0.8em]">С ВОЗВРАЩЕНИЕМ, БОСС</p>
            </motion.div>
            
            {/* Task Recommendations from Memory */}
            {tasks.filter(t => t.status !== 'completed' && t.status !== 'failed').length > 0 && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="w-full max-w-4xl px-4 mb-4"
              >
                <div className="text-[10px] text-[#00aaff]/60 uppercase tracking-widest mb-3 text-center">
                  Рекомендации из памяти:
                </div>
                <div className="flex flex-wrap justify-center gap-3">
                  {tasks.filter(t => t.status !== 'completed' && t.status !== 'failed').slice(0, 3).map(task => (
                    <button
                      key={task.id}
                      onClick={() => {
                        // Select the task and start the system
                        setSelectedOrbitalTaskId(task.id);
                        setCurrentTab('character');
                        handleStart('normal'); // Default to normal energy if starting from task
                      }}
                      className="bg-black/40 border border-[#00aaff]/30 hover:border-[#00aaff] hover:bg-[#00aaff]/10 text-white/80 px-4 py-2 rounded-lg text-xs transition-all max-w-[250px] truncate"
                    >
                      {task.desc}
                    </button>
                  ))}
                </div>
              </motion.div>
            )}

            {/* Continue button - shown when there's existing session history */}
            {sessions.filter(s => !s.mode?.startsWith('agi_')).length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 }}
                className="w-full max-w-4xl px-4"
              >
                <button
                  onClick={handleContinue}
                  className="w-full flex items-center justify-center gap-3 p-4 rounded-xl border-2 border-[#00ff88]/50 bg-[#00ff88]/5 hover:bg-[#00ff88]/15 hover:border-[#00ff88] hover:scale-[1.02] transition-all group mb-2"
                >
                  <Play size={20} className="text-[#00ff88]" />
                  <span className="font-black text-[#00ff88] uppercase tracking-wider">Продолжить без приветствия</span>
                </button>
                <p className="text-center text-[10px] text-white/30 uppercase tracking-widest">— или выбери режим для нового старта —</p>
              </motion.div>
            )}

            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.3 }}
              className="grid grid-cols-1 md:grid-cols-3 gap-4 w-full max-w-4xl px-4"
            >
              <button 
                onClick={() => handleStart('high')}
                className="flex flex-col items-center gap-4 p-6 rounded-xl border-2 border-[#ff3366]/30 bg-[#ff3366]/5 hover:bg-[#ff3366]/10 hover:border-[#ff3366] hover:scale-105 transition-all group"
              >
                <div className="w-16 h-16 rounded-full bg-[#ff3366]/20 flex items-center justify-center group-hover:scale-110 transition-transform">
                  <Flame size={32} className="text-[#ff3366]" />
                </div>
                <div className="text-center">
                  <div className="font-black text-white uppercase tracking-wider mb-1">В потоке</div>
                  <div className="text-[10px] text-[#ff3366]/70 uppercase tracking-widest">Готов рвать и метать. Сложные задачи вперед.</div>
                </div>
              </button>

              <button 
                onClick={() => handleStart('normal')}
                className="flex flex-col items-center gap-4 p-6 rounded-xl border-2 border-[#00aaff]/30 bg-[#00aaff]/5 hover:bg-[#00aaff]/10 hover:border-[#00aaff] hover:scale-105 transition-all group"
              >
                <div className="w-16 h-16 rounded-full bg-[#00aaff]/20 flex items-center justify-center group-hover:scale-110 transition-transform">
                  <BatteryMedium size={32} className="text-[#00aaff]" />
                </div>
                <div className="text-center">
                  <div className="font-black text-white uppercase tracking-wider mb-1">Нормально</div>
                  <div className="text-[10px] text-[#00aaff]/70 uppercase tracking-widest">Рабочий режим. Сбалансированный план.</div>
                </div>
              </button>

              <button 
                onClick={() => handleStart('low')}
                className="flex flex-col items-center gap-4 p-6 rounded-xl border-2 border-[#00ff88]/30 bg-[#00ff88]/5 hover:bg-[#00ff88]/10 hover:border-[#00ff88] hover:scale-105 transition-all group"
              >
                <div className="w-16 h-16 rounded-full bg-[#00ff88]/20 flex items-center justify-center group-hover:scale-110 transition-transform">
                  <CloudFog size={32} className="text-[#00ff88]" />
                </div>
                <div className="text-center">
                  <div className="font-black text-white uppercase tracking-wider mb-1">Туман в голове</div>
                  <div className="text-[10px] text-[#00ff88]/70 uppercase tracking-widest">Режим анти-перегруз. Одна простая задача.</div>
                </div>
              </button>
            </motion.div>
            

          </div>
        ) : (
          <div className="flex flex-col gap-12 pb-20">
            {currentTab === 'stats' && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="grid grid-cols-1 lg:grid-cols-3 gap-8"
              >
                <div className="lg:col-span-2 border border-[#1a1a1a] bg-black/60 rounded-lg p-6 flex flex-col gap-4">
                  <div className="text-[10px] uppercase tracking-[0.4em] text-[#00ff88]/40 font-black border-b border-[#1a1a1a] pb-3 flex justify-between items-center">
                    График Ауры (XP Progress)
                    <span className="text-[9px] text-[#00ff88]/20">ПОСЛЕДНИЕ 14 ЦИКЛОВ</span>
                  </div>
                  <div className="h-[350px] w-full mt-4">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={dailyHistory.length > 0 ? dailyHistory : [{ date: 'None', xp: 0 }]}>
                        <defs>
                          <linearGradient id="colorXp" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#00ff88" stopOpacity={0.3}/>
                            <stop offset="95%" stopColor="#00ff88" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1a1a1a" vertical={false} />
                        <XAxis 
                          dataKey="date" 
                          stroke="#00ff88" 
                          fontSize={8} 
                          tickFormatter={(str) => {
                            const d = new Date(str);
                            return isNaN(d.getTime()) ? '' : `${d.getDate()}.${d.getMonth() + 1}`;
                          }}
                          axisLine={false}
                          tickLine={false}
                        />
                        <YAxis stroke="#00ff88" fontSize={8} axisLine={false} tickLine={false} />
                        <Tooltip 
                          contentStyle={{ backgroundColor: '#000', border: '1px solid #00ff88', fontSize: '10px' }}
                          itemStyle={{ color: '#00ff88' }}
                        />
                        <Area 
                          type="monotone" 
                          dataKey="xp" 
                          stroke="#00ff88" 
                          fillOpacity={1} 
                          fill="url(#colorXp)" 
                          strokeWidth={2}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="border border-[#ff00ff]/20 bg-black/60 rounded-lg p-6 flex flex-col gap-4">
                  <div className="text-[10px] uppercase tracking-[0.4em] text-[#ff00ff]/40 font-black border-b border-[#1a1a1a] pb-3 flex items-center gap-2">
                    <Zap size={12} /> Память Агента
                  </div>
                  <div className="flex flex-col gap-4">
                    <div className="p-3 bg-[#ff00ff]/5 border border-[#ff00ff]/20 rounded-lg">
                      <div className="text-[8px] uppercase text-[#ff00ff]/50 mb-1">Текущий статус</div>
                      <div className="text-xs text-white font-bold">
                        {xp > 500 ? "Стабильная когнитивная нагрузка" : "Инициализация нейросети"}
                      </div>
                    </div>
                    <div className="p-3 bg-[#00aaff]/5 border border-[#00aaff]/20 rounded-lg">
                      <div className="text-[8px] uppercase text-[#00aaff]/50 mb-1">Прогноз ранга</div>
                      <div className="text-xs text-white font-bold">
                        #{Math.max(1, rank - 5)} (ожидается через 24ч)
                      </div>
                    </div>
                    <div className="text-[10px] text-[#00ff88]/40 italic leading-relaxed mt-2">
                      &quot;{agentInsight}&quot;
                    </div>
                  </div>
                </div>

                <div className="lg:col-span-3 border border-[#1a1a1a] bg-black/60 rounded-lg p-6 flex flex-col gap-4">
                  <div className="text-[10px] uppercase tracking-[0.4em] text-[#00ff88]/40 font-black border-b border-[#1a1a1a] pb-3">
                    История квестов
                  </div>
                  <div className="flex flex-col gap-2 max-h-[300px] overflow-y-auto scrollbar-thin scrollbar-thumb-[#00ff88]/10 pr-2">
                    {tasks.filter(t => t.status === 'completed' || t.status === 'failed').length === 0 ? (
                      <div className="text-[10px] text-[#00ff88]/20 text-center py-4 italic uppercase tracking-widest">
                        ИСТОРИЯ ПУСТА
                      </div>
                    ) : (
                      tasks.filter(t => t.status === 'completed' || t.status === 'failed')
                        .sort((a, b) => new Date(b.completedAt || b.deadline || 0).getTime() - new Date(a.completedAt || a.deadline || 0).getTime())
                        .map(task => (
                        <div key={task.id} className={`flex justify-between items-center p-3 border rounded-lg ${task.status === 'completed' ? 'bg-[#00ff88]/5 border-[#00ff88]/10' : 'bg-red-500/5 border-red-500/10'}`}>
                          <div className="flex flex-col gap-1">
                            <span className={`text-sm font-bold ${task.status === 'completed' ? 'text-white' : 'text-red-500/80 line-through'}`}>{task.desc}</span>
                            <span className={`text-[9px] uppercase tracking-widest ${task.status === 'completed' ? 'text-[#00ff88]/50' : 'text-red-500/50'}`}>
                              {task.status === 'completed' ? (task.completedAt ? new Date(task.completedAt).toLocaleString() : 'Выполнено') : 'Провалено (Дедлайн)'}
                            </span>
                          </div>
                          <div className={`font-black text-sm ${task.status === 'completed' ? 'text-[#00ff88]' : 'text-red-500'}`}>
                            {task.status === 'completed' ? `+${task.xp} XP` : `0 XP`}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </motion.div>
            )}

            {currentTab === 'character' && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex flex-col md:flex-row gap-4 md:gap-8 items-center justify-center min-h-[300px] md:min-h-[600px] w-full relative"
              >
                {/* Agent Container */}
                <motion.div 
                  layout
                  className={`relative flex justify-center items-center transition-all duration-700 ease-in-out ${selectedOrbitalTaskId || isAgiPanelOpen ? 'w-full md:w-1/2' : 'w-full'} scale-[0.60] sm:scale-75 md:scale-100 mt-[-100px] sm:mt-[-80px] md:mt-[-40px]`}
                >
                  {/* Dynamic Background Image */}
                  {characterBg !== 'default' && (
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-0">
                      <div className="absolute w-[600px] h-[600px] rounded-full overflow-hidden opacity-40" style={{ maskImage: 'radial-gradient(circle, black 40%, transparent 70%)', WebkitMaskImage: 'radial-gradient(circle, black 40%, transparent 70%)' }}>
                        <Image 
                          src={characterBg} 
                          alt="Character Background" 
                          fill 
                          className="object-cover"
                          referrerPolicy="no-referrer"
                        />
                      </div>
                    </div>
                  )}

                  {/* Orbits Background & Tasks */}
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-0">
                    {/* MGR-1 Orbit (Inner) */}
                    <div className="absolute w-[320px] h-[320px] rounded-full border border-[#00ff88]/10 animate-[spin_60s_linear_infinite] transform-gpu will-change-transform">
                      {tasks.filter(t => t.status !== 'completed' && t.status !== 'failed' && t.mgr === 'MGR-1').map((task, i, arr) => {
                        const angle = (i / arr.length) * 360;
                        return (
                          <div key={task.id} className="absolute top-1/2 left-1/2" style={{ transform: `translate(-50%, -50%) rotate(${angle}deg) translateY(-160px)` }}>
                            <div className="animate-[spin_60s_linear_infinite_reverse] flex flex-col items-center justify-center">
                              <button onClick={() => setSelectedOrbitalTaskId(task.id)} className="w-6 h-6 rounded-full bg-[#00ff88]/20 border border-[#00ff88] flex items-center justify-center hover:scale-125 transition-all shadow-[0_0_15px_rgba(0,255,136,0.4)] group relative pointer-events-auto">
                                <div className="w-2 h-2 rounded-full bg-[#00ff88] animate-pulse" />
                                <div className="absolute top-full mt-2 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap bg-black/80 border border-[#00ff88]/30 px-2 py-1 rounded text-[10px] text-white pointer-events-none z-50 max-w-[150px] truncate">
                                  {task.desc}
                                </div>
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* MGR-2 Orbit (Middle) */}
                    <div className="absolute w-[440px] h-[440px] rounded-full border border-[#00aaff]/10 animate-[spin_90s_linear_infinite_reverse] transform-gpu will-change-transform">
                      {tasks.filter(t => t.status !== 'completed' && t.status !== 'failed' && t.mgr === 'MGR-2').map((task, i, arr) => {
                        const angle = (i / arr.length) * 360;
                        return (
                          <div key={task.id} className="absolute top-1/2 left-1/2" style={{ transform: `translate(-50%, -50%) rotate(${angle}deg) translateY(-220px)` }}>
                            <div className="animate-[spin_90s_linear_infinite] flex flex-col items-center justify-center">
                              <button onClick={() => setSelectedOrbitalTaskId(task.id)} className="w-8 h-8 rounded-full bg-[#00aaff]/20 border border-[#00aaff] flex items-center justify-center hover:scale-125 transition-all shadow-[0_0_20px_rgba(0,170,255,0.4)] group relative pointer-events-auto">
                                <div className="w-3 h-3 rounded-full bg-[#00aaff] animate-pulse" />
                                <div className="absolute top-full mt-2 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap bg-black/80 border border-[#00aaff]/30 px-2 py-1 rounded text-[10px] text-white pointer-events-none z-50 max-w-[150px] truncate">
                                  {task.desc}
                                </div>
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* MGR-3 Orbit (Outer) */}
                    <div className="absolute w-[560px] h-[560px] rounded-full border border-[#ff00ff]/10 animate-[spin_120s_linear_infinite] transform-gpu will-change-transform">
                      {tasks.filter(t => t.status !== 'completed' && t.status !== 'failed' && t.mgr === 'MGR-3').map((task, i, arr) => {
                        const angle = (i / arr.length) * 360;
                        return (
                          <div key={task.id} className="absolute top-1/2 left-1/2" style={{ transform: `translate(-50%, -50%) rotate(${angle}deg) translateY(-280px)` }}>
                            <div className="animate-[spin_120s_linear_infinite_reverse] flex flex-col items-center justify-center">
                              <button onClick={() => setSelectedOrbitalTaskId(task.id)} className="w-10 h-10 rounded-full bg-[#ff00ff]/20 border border-[#ff00ff] flex items-center justify-center hover:scale-125 transition-all shadow-[0_0_25px_rgba(255,0,255,0.4)] group relative pointer-events-auto">
                                <div className="w-4 h-4 rounded-full bg-[#ff00ff] animate-pulse" />
                                <div className="absolute top-full mt-2 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap bg-black/80 border border-[#ff00ff]/30 px-2 py-1 rounded text-[10px] text-white pointer-events-none z-50 max-w-[150px] truncate">
                                  {task.desc}
                                </div>
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* The Agent */}
                  <div className="relative z-10 w-[300px] h-[450px] drop-shadow-[0_0_15px_rgba(0,255,136,0.2)] flex items-center justify-center">
                    <svg width="100%" height="100%" viewBox="0 0 300 480" preserveAspectRatio="xMidYMid meet" className="opacity-90">
                      {renderedHuman}
                      {(() => {
                        const activeTasks = tasks.filter(t => t.status !== 'completed' && t.status !== 'failed');
                        if (activeTasks.length === 0) return null; // No task, no light
                        
                        let color = '#00ff88'; // Default Green (MGR-1)
                        const selectedTask = activeTasks.find(t => t.id === selectedOrbitalTaskId);
                        
                        if (selectedTask) {
                          if (selectedTask.mgr === 'MGR-3') color = '#ff00ff';
                          else if (selectedTask.mgr === 'MGR-2') color = '#00aaff';
                        } else {
                          const hasMgr3 = activeTasks.some(t => t.mgr === 'MGR-3');
                          const hasMgr2 = activeTasks.some(t => t.mgr === 'MGR-2');
                          if (hasMgr3) color = '#ff00ff';
                          else if (hasMgr2) color = '#00aaff';
                        }

                        return (
                          <circle cx="150" cy="57" r="6" fill={color} opacity="0.8" />
                        );
                      })()}
                    </svg>
                  </div>

                  {/* Orbital Nodes (Tasks) */}
                  <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full h-full z-20 pointer-events-none">
                    {(() => {
                      return ['MGR-1', 'MGR-2', 'MGR-3'].flatMap((mgrLevel, orbitIndex) => {
                        const radius = 160 + (orbitIndex * 60); // 160, 220, 280
                        const mgrTasks = tasks.filter(t => t.status !== 'completed' && t.status !== 'failed' && t.mgr === mgrLevel);
                        
                        return mgrTasks.map((task, i) => {
                          const total = mgrTasks.length;
                          const angle = (i / total) * 360;
                          const isSelected = selectedOrbitalTaskId === task.id;
                          
                          let colorClass = 'text-[#00ff88]';
                          let borderClass = 'border-[#00ff88]';
                          let bgSelectedClass = 'bg-[#00ff88]/20 shadow-[0_0_20px_rgba(0,255,136,0.5)]';
                          let bgHoverClass = 'border-[#00ff88]/30 hover:border-[#00ff88] hover:bg-[#00ff88]/10';

                          if (task.mgr === 'MGR-2') {
                            colorClass = 'text-[#00aaff]'; borderClass = 'border-[#00aaff]';
                            bgSelectedClass = 'bg-[#00aaff]/20 shadow-[0_0_20px_rgba(0,170,255,0.5)]';
                            bgHoverClass = 'border-[#00aaff]/30 hover:border-[#00aaff] hover:bg-[#00aaff]/10';
                          } else if (task.mgr === 'MGR-3') {
                            colorClass = 'text-[#ff00ff]'; borderClass = 'border-[#ff00ff]';
                            bgSelectedClass = 'bg-[#ff00ff]/20 shadow-[0_0_20px_rgba(255,0,255,0.5)]';
                            bgHoverClass = 'border-[#ff00ff]/30 hover:border-[#ff00ff] hover:bg-[#ff00ff]/10';
                          }

                          return (
                            <motion.div
                              key={task.id}
                              className="absolute top-1/2 left-1/2 pointer-events-auto transform-gpu will-change-transform"
                              initial={{ opacity: 0, scale: 0 }}
                              animate={{ 
                                opacity: 1, 
                                scale: isSelected ? 1.2 : 1,
                                rotate: angle,
                              }}
                              transition={{ duration: 0.5, delay: i * 0.1 }}
                              style={{ width: 0, height: 0 }}
                            >
                              <motion.div
                                className={`absolute -translate-x-1/2 -translate-y-1/2 cursor-pointer group ${isSelected ? 'z-50' : 'z-10'}`}
                                style={{ transform: `translateX(${radius}px) rotate(-${angle}deg)` }}
                                onClick={() => setSelectedOrbitalTaskId(isSelected ? null : task.id)}
                              >
                                {/* Node UI */}
                                <div className={`relative flex items-center justify-center w-10 h-10 rounded-full border-2 backdrop-blur-md transition-all duration-300 ${
                                  isSelected 
                                    ? borderClass + ' ' + bgSelectedClass
                                    : bgHoverClass + ' bg-black/60'
                                }`}>
                                  {task.mgr === 'MGR-3' ? <Flame size={16} className={`${isSelected ? colorClass : colorClass + '/50'}`} /> : 
                                   task.mgr === 'MGR-2' ? <BatteryMedium size={16} className={`${isSelected ? colorClass : colorClass + '/50'}`} /> : 
                                   <CloudFog size={16} className={`${isSelected ? colorClass : colorClass + '/50'}`} />}
                                  
                                  {/* Tooltip / Mini Preview (visible on hover if not selected) */}
                                  {!isSelected && (
                                    <div className={`absolute top-full mt-2 left-1/2 -translate-x-1/2 w-48 p-2 bg-black/90 border rounded text-[10px] text-white opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none ${borderClass.replace('border-', 'border-').concat('/30')}`}>
                                      <div className={`${colorClass} font-black mb-1 truncate`}>{task.desc}</div>
                                      <div className="text-white/50 truncate">MGR: {task.mgr} | XP: {task.xp}</div>
                                    </div>
                                  )}
                                </div>
                              </motion.div>
                            </motion.div>
                          );
                        });
                      });
                    })()}
                  </div>

                  {/* AGI Button */}
                  <div className="absolute bottom-[-40px] left-1/2 -translate-x-1/2 z-30">
                    <button
                      onClick={() => {
                        setIsAgiPanelOpen(!isAgiPanelOpen);
                        if (!isAgiPanelOpen && selectedOrbitalTaskId) {
                          setSelectedOrbitalTaskId(null);
                        }
                      }}
                      className="flex flex-col items-center gap-2 group"
                    >
                      <div className={`w-12 h-12 rounded-full border-2 flex items-center justify-center transition-all duration-300 ${isAgiPanelOpen ? 'border-[#ff00ff] bg-[#ff00ff]/20 shadow-[0_0_20px_rgba(255,0,255,0.4)]' : 'border-[#00aaff]/50 bg-black/60 hover:border-[#00aaff] hover:shadow-[0_0_15px_rgba(0,170,255,0.3)]'}`}>
                        <Cpu size={20} className={isAgiPanelOpen ? 'text-[#ff00ff]' : 'text-[#00aaff]'} />
                      </div>
                      <span className={`text-[10px] font-black tracking-[0.3em] uppercase ${isAgiPanelOpen ? 'text-[#ff00ff]' : 'text-[#00aaff]/70 group-hover:text-[#00aaff]'}`}>AGI</span>
                    </button>
                  </div>
                </motion.div>

                {/* AGI Adaptive Interface */}
                <AnimatePresence>
                  {isAgiPanelOpen && (
                    <motion.div
                      initial={{ opacity: 0, x: 50, width: 0 }}
                      animate={{ opacity: 1, x: 0, width: '100%' }}
                      exit={{ opacity: 0, x: 50, width: 0 }}
                      className="w-full md:w-[60%] flex flex-col gap-4 overflow-hidden h-[500px] md:h-[600px]"
                    >
                      <div className="border border-[#ff00ff]/30 bg-black/60 backdrop-blur-md p-6 rounded-xl shadow-[0_0_30px_rgba(255,0,255,0.1)] flex flex-col h-full overflow-hidden">
                        <div className="flex justify-between items-start mb-6 border-b border-[#ff00ff]/20 pb-4 shrink-0">
                          <div>
                            <div className="text-[10px] uppercase tracking-widest text-[#ff00ff]/50 mb-1 flex items-center gap-2">
                              <Cpu size={12} /> AGI Extension
                            </div>
                            <h3 className="text-xl font-black text-white">Адаптивный Интерфейс</h3>
                          </div>
                          <div className="flex items-center gap-2">
                            <button 
                              onClick={() => setIsAgiHistoryOpen(!isAgiHistoryOpen)}
                              className={`transition-colors p-2 rounded-lg ${isAgiHistoryOpen ? 'bg-[#ff00ff]/20 text-[#ff00ff]' : 'text-[#ff00ff]/50 hover:text-[#ff00ff] hover:bg-[#ff00ff]/10'}`}
                              title="История чатов"
                            >
                              <History size={20} />
                            </button>
                            <button 
                              onClick={() => setIsAgiPanelOpen(false)}
                              className="text-[#ff00ff]/50 hover:text-[#ff00ff] transition-colors p-2 rounded-lg hover:bg-[#ff00ff]/10"
                            >
                              <X size={20} />
                            </button>
                          </div>
                        </div>

                        {isAgiHistoryOpen ? (
                          <div className="flex-1 flex flex-col overflow-y-auto custom-scrollbar pr-2">
                            <div className="text-sm text-white/60 mb-4">История всех чатов</div>
                            <div className="flex flex-col gap-2">
                              {sessions.length === 0 ? (
                                <div className="text-[9px] text-white/20 uppercase tracking-widest text-center py-4">Нет истории</div>
                              ) : (
                                sessions.map(session => (
                                  <div
                                    key={session.id}
                                    className={`group relative text-left p-3 rounded-lg border text-[10px] transition-all ${(currentSessionId === session.id || currentAgiSessionId === session.id) ? 'bg-[#ff00ff]/10 border-[#ff00ff]/30 text-[#ff00ff]' : 'bg-black/40 border-[#1a1a1a] text-white/50 hover:border-[#ff00ff]/20 hover:text-white/80'}`}
                                  >
                                    <button
                                      className="w-full text-left"
                                      onClick={() => {
                                        if (session.mode && session.mode.startsWith('agi_')) {
                                          setCurrentAgiSessionId(session.id);
                                          setCurrentSessionId(null);
                                          const agiMode = session.mode.replace('agi_', '');
                                          setSelectedAgiMode(agiMode as any);
                                          setAgiSessionActive(true);
                                          setAgiMessages(dbMessages.filter(m => m.sessionId === session.id));
                                          setIsAgiHistoryOpen(false);
                                        } else {
                                          setCurrentSessionId(session.id);
                                          setCurrentAgiSessionId(null);
                                          setMessages(dbMessages.filter(m => m.sessionId === session.id));
                                          setCurrentTab('home');
                                          setIsAgiPanelOpen(false);
                                          setIsAgiHistoryOpen(false);
                                        }
                                      }}
                                    >
                                      <div className="font-bold truncate mb-1 pr-6">{session.title || 'Без названия'}</div>
                                      <div className="flex justify-between items-center text-[8px] opacity-50 uppercase">
                                        <span>{new Date(session.updatedAt?.seconds * 1000 || Date.now()).toLocaleDateString()}</span>
                                        {session.mode && session.mode !== 'game' && (
                                          <span className="bg-[#ff00ff]/20 text-[#ff00ff] px-1.5 py-0.5 rounded">
                                            {session.mode.startsWith('agi_') ? session.mode.replace('agi_', '') : session.mode}
                                          </span>
                                        )}
                                      </div>
                                    </button>
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setSessionToDelete(session.id);
                                      }}
                                      className="absolute top-2 right-2 p-1.5 text-white/20 hover:text-red-500 hover:bg-red-500/10 rounded opacity-0 group-hover:opacity-100 transition-all"
                                      title="Удалить сеанс"
                                    >
                                      <X size={12} />
                                    </button>
                                  </div>
                                ))
                              )}
                            </div>
                          </div>
                        ) : !agiSessionActive ? (
                          <div className="flex-1 flex flex-col overflow-y-auto custom-scrollbar pr-2">
                            <div className="flex flex-col gap-4 pb-4">
                              <p className="text-sm text-white/60 mb-4">
                                Выберите режим проекции для расширения возможностей агента. GAME — режим управления реальностью.
                              </p>

                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <button 
                                  onClick={() => {
                                    setSelectedAgiMode('code');
                                    handleAgiInit('code');
                                  }}
                                  className={`p-4 rounded-lg border text-left transition-all flex items-center gap-4 ${selectedAgiMode === 'code' ? 'border-[#ff00ff] bg-[#ff00ff]/10 shadow-[0_0_15px_rgba(255,0,255,0.2)]' : 'border-white/10 hover:border-[#ff00ff]/50 hover:bg-white/5'}`}
                                >
                                  <div className={`p-3 rounded-full ${selectedAgiMode === 'code' ? 'bg-[#ff00ff]/20 text-[#ff00ff]' : 'bg-white/5 text-white/50'}`}>
                                    <Code size={24} />
                                  </div>
                                  <div>
                                    <div className={`font-bold ${selectedAgiMode === 'code' ? 'text-[#ff00ff]' : 'text-white'}`}>Код</div>
                                    <div className="text-xs text-white/40 mt-1">Генерация, рефакторинг и анализ архитектуры.</div>
                                  </div>
                                </button>

                                <button 
                                  onClick={() => {
                                    setSelectedAgiMode('text');
                                    handleAgiInit('text');
                                  }}
                                  className={`p-4 rounded-lg border text-left transition-all flex items-center gap-4 ${selectedAgiMode === 'text' ? 'border-[#ff00ff] bg-[#ff00ff]/10 shadow-[0_0_15px_rgba(255,0,255,0.2)]' : 'border-white/10 hover:border-[#ff00ff]/50 hover:bg-white/5'}`}
                                >
                                  <div className={`p-3 rounded-full ${selectedAgiMode === 'text' ? 'bg-[#ff00ff]/20 text-[#ff00ff]' : 'bg-white/5 text-white/50'}`}>
                                    <FileText size={24} />
                                  </div>
                                  <div>
                                    <div className={`font-bold ${selectedAgiMode === 'text' ? 'text-[#ff00ff]' : 'text-white'}`}>Усиленный текст</div>
                                    <div className="text-xs text-white/40 mt-1">Копирайтинг, редактура и упаковка.</div>
                                  </div>
                                </button>

                                <button 
                                  onClick={() => {
                                    setSelectedAgiMode('psychology');
                                    handleAgiInit('psychology');
                                  }}
                                  className={`p-4 rounded-lg border text-left transition-all flex items-center gap-4 ${selectedAgiMode === 'psychology' ? 'border-[#ff00ff] bg-[#ff00ff]/10 shadow-[0_0_15px_rgba(255,0,255,0.2)]' : 'border-white/10 hover:border-[#ff00ff]/50 hover:bg-white/5'}`}
                                >
                                  <div className={`p-3 rounded-full ${selectedAgiMode === 'psychology' ? 'bg-[#ff00ff]/20 text-[#ff00ff]' : 'bg-white/5 text-white/50'}`}>
                                    <Brain size={24} />
                                  </div>
                                  <div>
                                    <div className={`font-bold ${selectedAgiMode === 'psychology' ? 'text-[#ff00ff]' : 'text-white'}`}>Психология</div>
                                    <div className="text-xs text-white/40 mt-1">Анализ состояния и когнитивные искажения.</div>
                                  </div>
                                </button>

                                <button 
                                  onClick={() => {
                                    setSelectedAgiMode('game');
                                    handleAgiInit('game');
                                  }}
                                  className={`p-4 rounded-lg border text-left transition-all flex items-center gap-4 ${selectedAgiMode === 'game' ? 'border-[#ff00ff] bg-[#ff00ff]/10 shadow-[0_0_15px_rgba(255,0,255,0.2)]' : 'border-white/10 hover:border-[#ff00ff]/50 hover:bg-white/5'}`}
                                >
                                  <div className={`p-3 rounded-full ${selectedAgiMode === 'game' ? 'bg-[#ff00ff]/20 text-[#ff00ff]' : 'bg-white/5 text-white/50'}`}>
                                    <Target size={24} />
                                  </div>
                                  <div>
                                    <div className={`font-bold ${selectedAgiMode === 'game' ? 'text-[#ff00ff]' : 'text-white'}`}>GAME</div>
                                    <div className="text-xs text-white/40 mt-1">Сделай свою жизнь продуктивной.</div>
                                  </div>
                                </button>

                                <button 
                                  onClick={() => {
                                    setSelectedAgiMode('background');
                                  }}
                                  className={`p-4 rounded-lg border text-left transition-all flex items-center gap-4 ${selectedAgiMode === 'background' ? 'border-[#ff00ff] bg-[#ff00ff]/10 shadow-[0_0_15px_rgba(255,0,255,0.2)]' : 'border-white/10 hover:border-[#ff00ff]/50 hover:bg-white/5'}`}
                                >
                                  <div className={`p-3 rounded-full ${selectedAgiMode === 'background' ? 'bg-[#ff00ff]/20 text-[#ff00ff]' : 'bg-white/5 text-white/50'}`}>
                                    <ImageIcon size={24} />
                                  </div>
                                  <div>
                                    <div className={`font-bold ${selectedAgiMode === 'background' ? 'text-[#ff00ff]' : 'text-white'}`}>Смена фона</div>
                                    <div className="text-xs text-white/40 mt-1">Визуальное окружение персонажа.</div>
                                  </div>
                                </button>

                                <button 
                                  onClick={() => {
                                    setSelectedAgiMode('image');
                                    handleAgiInit('image');
                                  }}
                                  className={`p-4 rounded-lg border text-left transition-all flex items-center gap-4 ${selectedAgiMode === 'image' ? 'border-[#ff00ff] bg-[#ff00ff]/10 shadow-[0_0_15px_rgba(255,0,255,0.2)]' : 'border-white/10 hover:border-[#ff00ff]/50 hover:bg-white/5'}`}
                                >
                                  <div className={`p-3 rounded-full ${selectedAgiMode === 'image' ? 'bg-[#ff00ff]/20 text-[#ff00ff]' : 'bg-white/5 text-white/50'}`}>
                                    <ImageIcon size={24} />
                                  </div>
                                  <div>
                                    <div className={`font-bold ${selectedAgiMode === 'image' ? 'text-[#ff00ff]' : 'text-white'}`}>Генерация фото</div>
                                    <div className="text-xs text-white/40 mt-1">Создание AI изображений.</div>
                                  </div>
                                </button>
                              </div>
                            </div>

                            {selectedAgiMode && selectedAgiMode !== 'background' && isAgiInitializing && (
                              <div className="mt-6 pt-6 border-t border-[#ff00ff]/20 flex justify-center">
                                <div className="text-[#ff00ff] flex items-center gap-2 text-sm uppercase tracking-widest font-bold">
                                  <Loader2 className="animate-spin" size={18} /> Инициализация...
                                </div>
                              </div>
                            )}

                            {selectedAgiMode === 'background' && (
                              <div className="mt-6 pt-6 border-t border-[#ff00ff]/20">
                                <div className="text-sm text-white/60 mb-4">Выберите фон персонажа:</div>
                                <div className="grid grid-cols-2 gap-3">
                                  {[
                                    { id: 'default', name: 'Нейро-пустота', url: 'default' },
                                    { id: 'cyberpunk', name: 'Киберпанк Сити', url: 'https://images.unsplash.com/photo-1515630278258-407f66498911?q=80&w=1000&auto=format&fit=crop' },
                                    { id: 'lab', name: 'Нейро-ядро', url: 'https://images.unsplash.com/photo-1518770660439-4636190af475?q=80&w=1000&auto=format&fit=crop' },
                                    { id: 'space', name: 'Орбитальная Станция', url: 'https://images.unsplash.com/photo-1446776811953-b23d57bd21aa?q=80&w=1000&auto=format&fit=crop' },
                                    { id: 'matrix', name: 'Цифровая Матрица', url: 'https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?q=80&w=1000&auto=format&fit=crop' },
                                    { id: 'synthwave', name: 'Синтвейв Закат', url: 'https://images.unsplash.com/photo-1557672172-298e090bd0f1?q=80&w=1000&auto=format&fit=crop' },
                                  ].map(bg => (
                                    <button
                                      key={bg.id}
                                      onClick={() => setCharacterBg(bg.url)}
                                      className={`p-2 rounded border text-xs text-left transition-all ${characterBg === bg.url ? 'border-[#ff00ff] bg-[#ff00ff]/20 text-white' : 'border-white/10 hover:border-[#ff00ff]/50 text-white/60'}`}
                                    >
                                      {bg.name}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="flex-1 flex flex-col h-full overflow-hidden">
                            <div ref={agiScrollRef} className="flex-1 overflow-y-auto pr-2 space-y-4 mb-4 custom-scrollbar">
                              {agiMessages.map((msg, i) => (
                                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                  <div className={`max-w-[85%] p-3 rounded-lg ${msg.role === 'user' ? 'bg-[#ff00ff]/20 border border-[#ff00ff]/30 text-white' : 'bg-black/40 border border-white/10 text-white/80'}`}>
                                    <div className="prose prose-invert prose-sm max-w-none">
                                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                                    </div>
                                    {msg.imageUrl && (
                                      <div className="mt-3 relative w-full aspect-square max-w-[300px] rounded-md overflow-hidden border border-white/10">
                                        <Image src={msg.imageUrl} alt="Generated AI" fill className="object-cover" />
                                      </div>
                                    )}
                                  </div>
                                </div>
                              ))}
                              {isLoading && (
                                <div className="flex justify-start">
                                  <div className="bg-black/40 border border-white/10 text-white/80 p-3 rounded-lg flex items-center gap-2">
                                    <Loader2 className="animate-spin" size={16} /> Обработка...
                                  </div>
                                </div>
                              )}
                            </div>
                            <div className="relative flex items-center gap-2">
                              <div className="relative flex-1">
                                <input 
                                  type="text"
                                  value={agiInput}
                                  onChange={(e) => setAgiInput(e.target.value)}
                                  onKeyDown={(e) => e.key === 'Enter' && handleAgiSend()}
                                  placeholder="Введите запрос модулю..."
                                  className="w-full bg-black/50 border border-[#ff00ff]/30 rounded-lg pl-4 pr-12 py-3 text-white focus:outline-none focus:border-[#ff00ff]"
                                />
                                <button 
                                  onClick={() => toggleVoiceInput('agi')}
                                  className={`absolute right-2 top-1/2 -translate-y-1/2 p-2 transition-colors ${
                                    isListening && voiceTargetRef.current === 'agi' ? 'text-red-500 animate-pulse' : 'text-[#ff00ff]/50 hover:text-[#ff00ff]'
                                  }`}
                                  title={isListening && voiceTargetRef.current === 'agi' ? "Остановить запись" : "Голосовой ввод"}
                                >
                                  {isListening && voiceTargetRef.current === 'agi' ? <Mic size={18} /> : <MicOff size={18} />}
                                </button>
                              </div>
                              <button 
                                id="agi-send-btn"
                                onClick={handleAgiSend}
                                disabled={isLoading || !agiInput.trim()}
                                className="p-3 bg-[#ff00ff]/10 text-[#ff00ff] rounded-lg border border-[#ff00ff]/30 hover:bg-[#ff00ff] hover:text-black hover:scale-105 active:scale-95 disabled:opacity-50 transition-all flex items-center justify-center flex-shrink-0 relative overflow-hidden"
                              >
                                <Send size={20} />
                              </button>
                            </div>
                            <button 
                              onClick={() => { 
                                setAgiSessionActive(false); 
                                setAgiMessages([]); 
                                setCurrentAgiSessionId(null);
                              }}
                              className="mt-4 text-xs text-white/40 hover:text-white/80 uppercase tracking-widest text-center w-full"
                            >
                              Завершить сеанс
                            </button>
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Task Details Panel (Adaptive Interface) */}
                <AnimatePresence>
                  {selectedOrbitalTaskId && !isAgiPanelOpen && (
                    <motion.div
                      initial={{ opacity: 0, x: 50, width: 0 }}
                      animate={{ opacity: 1, x: 0, width: '100%' }}
                      exit={{ opacity: 0, x: 50, width: 0 }}
                      className="w-full md:w-1/2 flex flex-col gap-4 overflow-hidden"
                    >
                      {(() => {
                        const selectedTask = tasks.find(t => t.id === selectedOrbitalTaskId);
                        if (!selectedTask) return null;
                        
                        return (
                          <div className="border border-[#00ff88]/30 bg-black/60 backdrop-blur-md p-6 rounded-xl shadow-[0_0_30px_rgba(0,255,136,0.1)] flex flex-col h-full min-h-[400px]">
                            <div className="flex justify-between items-start mb-6 border-b border-[#00ff88]/20 pb-4">
                              <div>
                                <div className="text-[10px] uppercase tracking-widest text-[#00ff88]/50 mb-1 flex items-center gap-2">
                                  <Activity size={12} /> Активный процесс Агента
                                </div>
                                <h3 className="text-xl font-black text-white">{selectedTask.desc}</h3>
                              </div>
                              <button 
                                onClick={() => setSelectedOrbitalTaskId(null)}
                                className="text-[#00ff88]/50 hover:text-[#00ff88] transition-colors p-2"
                              >
                                <X size={20} />
                              </button>
                            </div>

                            <div className="flex-1 flex flex-col gap-4">
                              <div className="flex gap-4 text-xs">
                                <div className="bg-[#00ff88]/10 border border-[#00ff88]/20 px-3 py-1.5 rounded text-[#00ff88]">
                                  Сложность: {selectedTask.mgr}
                                </div>
                                <div className="bg-[#00aaff]/10 border border-[#00aaff]/20 px-3 py-1.5 rounded text-[#00aaff]">
                                  Награда: +{selectedTask.xp} XP
                                </div>
                              </div>

                              <div className="flex-1 bg-black/40 border border-white/5 rounded-lg p-4 font-mono text-sm text-white/70 overflow-y-auto">
                                <div className="flex items-center gap-2 text-[#00ff88] mb-2 text-xs uppercase tracking-widest">
                                  <Terminal size={14} /> Лог процесса
                                </div>
                                <div className="space-y-2">
                                  <p className="opacity-50">&gt; Инициализация контекста задачи...</p>
                                  <p className="opacity-50">&gt; Сбор данных: OK</p>
                                  <p className="opacity-50">&gt; Ожидание действий пользователя...</p>
                                  {selectedTask.aiAgentResult && (
                                    <div className="mt-4 text-[#00aaff] border-l-2 border-[#00aaff]/50 pl-3">
                                      <div className="flex items-center justify-between mb-1">
                                        <p className="text-xs uppercase opacity-70">Результат работы Агента:</p>
                                        <button 
                                          onClick={() => setExpandedAiTask(expandedAiTask === selectedTask.id ? null : selectedTask.id)}
                                          className="text-[10px] uppercase font-black hover:text-white transition-colors flex items-center gap-1"
                                        >
                                          {expandedAiTask === selectedTask.id ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                                          {expandedAiTask === selectedTask.id ? 'Скрыть' : 'Показать'}
                                        </button>
                                      </div>
                                      <AnimatePresence>
                                        {expandedAiTask === selectedTask.id && (
                                          <motion.div
                                            initial={{ height: 0, opacity: 0 }}
                                            animate={{ height: 'auto', opacity: 1 }}
                                            exit={{ height: 0, opacity: 0 }}
                                            className="overflow-hidden"
                                          >
                                            <div className="mt-2 text-xs opacity-90 prose prose-invert prose-xs max-w-none prose-p:my-1 prose-headings:text-[#00aaff] prose-headings:text-[11px] prose-headings:uppercase prose-headings:font-black">
                                              <ReactMarkdown>{selectedTask.aiAgentResult}</ReactMarkdown>
                                            </div>
                                          </motion.div>
                                        )}
                                      </AnimatePresence>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>

                            <div className="mt-6 flex gap-3">
                              <button 
                                onClick={() => handleCompleteTask(selectedTask.id)}
                                className="flex-1 bg-[#00ff88] text-black py-3 rounded-lg font-black uppercase tracking-widest hover:bg-white transition-all shadow-[0_0_20px_rgba(0,255,136,0.2)] flex items-center justify-center gap-2"
                              >
                                <CheckCircle2 size={18} /> Подтвердить выполнение
                              </button>
                              <button 
                                onClick={() => executeTaskWithAi(selectedTask.id)}
                                className="px-4 bg-black border border-[#00aaff]/50 text-[#00aaff] rounded-lg hover:bg-[#00aaff]/10 transition-all flex items-center justify-center"
                                title="Поручить Агенту"
                              >
                                <Cpu size={20} />
                              </button>
                            </div>
                          </div>
                        );
                      })()}
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            )}

            {currentTab === 'home' && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex flex-col gap-12"
              >
                <div className="flex flex-col gap-4 w-full">
                  <div className="flex justify-between items-center border-b border-[#1a1a1a] pb-2">
                    <div className="text-[10px] uppercase tracking-[0.3em] text-[#00ff88]/40 font-black">
                      Адаптивный интерфейс
                    </div>
                    <button 
                      onClick={() => {
                        setCurrentSessionId(null);
                        setCurrentAgiSessionId(null);
                        setMessages([]);
                      }}
                      className="text-[9px] uppercase tracking-widest text-[#00ff88]/60 hover:text-[#00ff88] flex items-center gap-1"
                    >
                      <Plus size={10} /> Новый сеанс
                    </button>
                  </div>
                  
                  <div className="flex flex-col md:flex-row gap-4">
                    {/* Sessions Sidebar */}
                    <div className="w-full md:w-1/4 flex flex-col gap-2 max-h-[150px] md:max-h-[420px] overflow-y-auto scrollbar-thin scrollbar-thumb-[#00ff88]/10 pr-2">
                      {sessions.length === 0 ? (
                        <div className="text-[9px] text-white/20 uppercase tracking-widest text-center py-4">Нет истории</div>
                      ) : (
                        sessions.map(session => (
                          <div
                            key={session.id}
                            className={`group relative text-left p-3 rounded-lg border text-[10px] transition-all ${(currentSessionId === session.id || currentAgiSessionId === session.id) ? 'bg-[#00ff88]/10 border-[#00ff88]/30 text-[#00ff88]' : 'bg-black/40 border-[#1a1a1a] text-white/50 hover:border-[#00ff88]/20 hover:text-white/80'}`}
                          >
                            <button
                              className="w-full text-left"
                              onClick={() => {
                                if (session.mode && session.mode.startsWith('agi_')) {
                                  setCurrentAgiSessionId(session.id);
                                  setCurrentSessionId(null);
                                  const agiMode = session.mode.replace('agi_', '');
                                  setCurrentTab('character');
                                  setIsAgiPanelOpen(true);
                                  setSelectedAgiMode(agiMode as any);
                                  setAgiSessionActive(true);
                                  setAgiMessages(dbMessages.filter(m => m.sessionId === session.id));
                                } else {
                                  setCurrentSessionId(session.id);
                                  setCurrentAgiSessionId(null);
                                  setMessages(dbMessages.filter(m => m.sessionId === session.id));
                                }
                              }}
                            >
                              <div className="font-bold truncate mb-1 pr-6">{session.title || 'Без названия'}</div>
                              <div className="flex justify-between items-center text-[8px] opacity-50 uppercase">
                                <span>{new Date(session.updatedAt?.seconds * 1000 || Date.now()).toLocaleDateString()}</span>
                                {session.mode && session.mode !== 'game' && (
                                  <span className="bg-[#00ff88]/20 text-[#00ff88] px-1.5 py-0.5 rounded">
                                    {session.mode.startsWith('agi_') ? session.mode.replace('agi_', '') : session.mode}
                                  </span>
                                )}
                              </div>
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setSessionToDelete(session.id);
                              }}
                              className="absolute top-2 right-2 p-1.5 text-white/20 hover:text-red-500 hover:bg-red-500/10 rounded opacity-0 group-hover:opacity-100 transition-all"
                              title="Удалить сеанс"
                            >
                              <X size={12} />
                            </button>
                          </div>
                        ))
                      )}
                    </div>

                    {/* Chat Area */}
                    <div className="w-full md:w-3/4 flex flex-col gap-4">
                      <div 
                        ref={scrollRef}
                        className="h-[420px] border border-[#1a1a1a] bg-black/60 rounded-lg p-6 overflow-y-auto flex flex-col gap-6 scrollbar-thin scrollbar-thumb-[#00ff88]/10"
                      >
                        <AnimatePresence initial={false}>
                          {messages.map((msg, i) => (
                            <motion.div
                              key={i}
                              initial={{ opacity: 0, y: 10 }}
                              animate={{ opacity: 1, y: 0 }}
                              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                            >
                              <div className={`max-w-[70%] p-3 md:p-4 rounded-lg border ${
                                msg.role === 'user' 
                                  ? 'bg-[#00aaff]/5 border-[#00aaff]/20 text-[#00aaff] shadow-[0_0_10px_rgba(0,170,255,0.05)]' 
                                  : 'bg-[#00ff88]/5 border-[#00ff88]/20 text-[#00ff88] shadow-[0_0_10px_rgba(0,255,136,0.05)]'
                              }`}>
                                <div className="text-[9px] uppercase mb-2 opacity-40 flex items-center gap-1 font-black tracking-widest">
                                  {msg.role === 'user' ? ">> USER_INPUT" : ">> AGI_v0.2"}
                                </div>
                                <div className="prose prose-invert prose-sm max-w-none leading-relaxed">
                                  <ReactMarkdown>{renderContent(msg.content)}</ReactMarkdown>
                                </div>
                              </div>
                            </motion.div>
                          ))}
                        </AnimatePresence>
                        {isLoading && (
                          <div className="flex justify-start">
                            <div className="bg-[#00ff88]/10 border border-[#00ff88]/30 p-3 rounded-lg text-[#00ff88] text-[10px] font-black uppercase tracking-[0.2em] flex items-center gap-3 shadow-[0_0_10px_rgba(0,255,136,0.2)]">
                              <Loader2 size={14} className="animate-spin" />
                              [ AGI_v0.2_PROCESSING ]
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="flex gap-3 items-center">
                        <div className="relative flex-grow">
                          <Terminal className="absolute left-4 top-4 text-[#00ff88]/30" size={18} />
                          <textarea
                            rows={1}
                            value={input}
                            onChange={(e) => {
                              setInput(e.target.value);
                              e.target.style.height = 'auto';
                              e.target.style.height = `${e.target.scrollHeight}px`;
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                handleSend();
                                const target = e.target as HTMLTextAreaElement;
                                target.style.height = 'auto';
                              }
                            }}
                            placeholder={isListening ? "СЛУШАЮ..." : "ВВЕДИТЕ КОМАНДУ..."}
                            className={`w-full bg-black/80 border ${isListening ? 'border-[#ff3366]/50 shadow-[0_0_15px_rgba(255,51,102,0.2)]' : 'border-[#1a1a1a] focus:border-[#00ff88]/50'} text-[#00ff88] pl-12 pr-12 py-2.5 rounded-lg transition-all placeholder:text-[#00ff88]/10 text-base resize-none max-h-64 overflow-y-auto focus:outline-none`}
                          />
                          <button
                            onClick={toggleVoiceInput}
                            className={`absolute right-4 top-3 transition-colors ${isListening ? 'text-[#ff3366] animate-pulse' : 'text-[#00ff88]/30 hover:text-[#00ff88]'}`}
                            title="Голосовой ввод"
                          >
                            {isListening ? <Mic size={18} /> : <MicOff size={18} />}
                          </button>
                        </div>
                        <button
                          id="send-btn"
                          onClick={handleSend}
                          disabled={isLoading}
                          className="bg-[#00ff88] text-black px-4 md:px-8 h-[48px] rounded-lg font-black hover:bg-[#00aaff] transition-all flex items-center justify-center disabled:opacity-50 flex-shrink-0 shadow-[0_0_20px_rgba(0,255,136,0.2)]"
                        >
                          <Send size={20} />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col gap-4 w-full">
                  {energyMode === 'low' && (
                    <div className="border border-[#00ff88]/30 bg-[#00ff88]/5 rounded-lg p-6 flex flex-col gap-8 min-h-[350px] items-center justify-center relative overflow-hidden shadow-[0_0_30px_rgba(0,255,136,0.05)]">
                      <button 
                        onClick={() => { setEnergyMode('idle'); setIsStarted(false); }}
                        className="absolute top-4 right-4 text-[#00ff88]/40 hover:text-[#00ff88] transition-colors flex items-center gap-2 text-[10px] uppercase font-black tracking-widest z-20"
                      >
                        <X size={14} /> Выйти из режима
                      </button>
                      
                      <div className="text-center space-y-2 z-10">
                        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#00ff88]/20 border border-[#00ff88]/50 text-[#00ff88] text-[9px] uppercase font-black tracking-widest mb-4">
                          <Target size={12} /> Режим Анти-Перегруз
                        </div>
                        <h2 className="text-xl md:text-2xl font-black text-white uppercase tracking-widest">Не думай о списке.</h2>
                        <p className="text-[#00ff88]/70 text-xs uppercase tracking-widest">Просто сделай этот один шаг.</p>
                      </div>

                      {(() => {
                        const activeTasks = tasks.filter(t => t.status !== 'completed' && t.status !== 'failed');
                        if (activeTasks.length === 0) {
                          return (
                            <div className="text-[10px] text-[#00ff88]/40 text-center py-12 italic uppercase tracking-widest z-10">
                              НЕТ АКТИВНЫХ ОБЪЕКТОВ. ОТДЫХАЙ.
                            </div>
                          );
                        }
                        
                        const focusTask = [...activeTasks].sort((a, b) => a.mgr.localeCompare(b.mgr))[0];
                        
                        return (
                          <motion.div
                            initial={{ scale: 0.9, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            className="w-full max-w-xl border-2 border-[#00ff88] bg-black/80 p-6 md:p-8 rounded-xl shadow-[0_0_40px_rgba(0,255,136,0.2)] z-10 flex flex-col items-center gap-6 text-center"
                          >
                            <div className="text-[10px] uppercase tracking-widest text-[#00ff88]/50 font-black">
                              Текущая цель ({focusTask.mgr === 'MGR-3' ? 'Сложная' : focusTask.mgr === 'MGR-2' ? 'Средняя' : 'Простая'})
                            </div>
                            <div className="text-lg md:text-2xl text-white font-medium">
                              {focusTask.desc}
                            </div>
                            <div className="flex gap-4 w-full mt-4">
                              <button
                                onClick={() => handleCompleteTask(focusTask.id)}
                                className="flex-1 bg-[#00ff88] text-black py-4 rounded-lg font-black uppercase tracking-widest hover:bg-white transition-all shadow-[0_0_20px_rgba(0,255,136,0.3)] flex items-center justify-center gap-2"
                              >
                                <CheckCircle2 size={20} /> Выполнено (+{focusTask.xp} XP)
                              </button>
                            </div>
                          </motion.div>
                        );
                      })()}
                      
                      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(0,255,136,0.1)_0%,transparent_70%)] animate-pulse pointer-events-none" />
                    </div>
                  )}

                  {(energyMode === 'normal' || energyMode === 'high') && (
                  <div className="border border-[#1a1a1a] bg-black/60 rounded-lg p-6 flex flex-col gap-4 min-h-[350px]">
                    <div className="text-[10px] uppercase tracking-[0.4em] text-[#00ff88]/40 font-black border-b border-[#1a1a1a] pb-3 flex flex-col md:flex-row gap-4 justify-between items-start md:items-center">
                      <div className="flex items-center gap-3">
                        Твои квесты
                        <span className={`px-2 py-0.5 rounded text-[8px] ${energyMode === 'high' ? 'bg-[#ff3366]/20 text-[#ff3366] border border-[#ff3366]/30' : 'bg-[#00aaff]/20 text-[#00aaff] border border-[#00aaff]/30'}`}>
                          {energyMode === 'high' ? 'РЕЖИМ: В ПОТОКЕ' : 'РЕЖИМ: НОРМАЛЬНЫЙ'}
                        </span>
                      </div>
                      <div className="flex items-center gap-4">
                        <button 
                          onClick={() => { setEnergyMode('idle'); setIsStarted(false); }}
                          className="text-[9px] text-[#00ff88]/40 hover:text-[#00ff88] transition-colors flex items-center gap-1"
                        >
                          <X size={10} /> Сбросить режим
                        </button>
                        <span className="text-[9px] text-[#00ff88]/20">{tasks.filter(t => t.status !== 'completed' && t.status !== 'failed').length} АКТИВНЫХ ЦЕЛЕЙ</span>
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                      {(() => {
                        const activeTasks = tasks.filter(t => t.status !== 'completed' && t.status !== 'failed');
                        if (activeTasks.length === 0) {
                          return (
                            <div className="col-span-full text-[10px] text-[#00ff88]/20 text-center py-12 italic uppercase tracking-widest">
                              НЕТ АКТИВНЫХ ОБЪЕКТОВ. ИНИЦИИРУЙТЕ ДЕНЬ ДЛЯ НАЧАЛА.
                            </div>
                          );
                        }
                        
                        const sortedTasks = [...activeTasks].sort((a, b) => {
                          if (energyMode === 'high') {
                            return b.mgr.localeCompare(a.mgr);
                          } else {
                            return a.mgr.localeCompare(b.mgr);
                          }
                        });
                        
                        return sortedTasks.map(task => (
                          <motion.div
                            layout
                            key={task.id}
                            className={`group p-4 rounded-lg border-2 transition-all relative overflow-hidden ${
                              task.status === 'completed'
                                ? 'border-[#1a1a1a] bg-black/20 opacity-40'
                                : task.status === 'failed'
                                ? 'border-red-500/50 bg-red-500/5 opacity-60'
                                : task.status === 'active'
                                ? 'border-[#00ff88] bg-[#00ff88]/10 shadow-[0_0_20px_rgba(0,255,136,0.15)] scale-[1.02] z-10'
                                : 'border-[#1a1a1a] bg-black/40 hover:border-[#00ff88]/30 hover:bg-[#00ff88]/5'
                            }`}
                          >
                            {task.status === 'active' && (
                              <motion.div 
                                className="absolute top-0 left-0 h-full w-1 bg-[#00ff88]"
                                animate={{ opacity: [0.5, 1, 0.5] }}
                                transition={{ repeat: Infinity, duration: 2 }}
                              />
                            )}
                            <div className="flex justify-between items-start gap-3">
                              <div className="flex flex-col gap-2">
                                <div className={`text-base font-black tracking-tight ${
                                  task.status === 'completed' ? 'line-through' : 
                                  task.status === 'failed' ? 'text-red-500/50' : 'text-white'
                                }`}>
                                  {task.desc}
                                </div>
                                {task.aiAgentResult && (
                                  <div className="mt-2">
                                    <button 
                                      onClick={() => setExpandedAiTask(expandedAiTask === task.id ? null : task.id)}
                                      className="flex items-center gap-1 text-[8px] uppercase font-black text-[#00aaff] hover:text-white transition-colors"
                                    >
                                      {expandedAiTask === task.id ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                                      {expandedAiTask === task.id ? 'Скрыть результат AGI' : 'Показать результат AGI'}
                                    </button>
                                    <AnimatePresence>
                                      {expandedAiTask === task.id && (
                                        <motion.div
                                          initial={{ height: 0, opacity: 0 }}
                                          animate={{ height: 'auto', opacity: 1 }}
                                          exit={{ height: 0, opacity: 0 }}
                                          className="mt-2 p-3 bg-black/60 border border-[#00aaff]/20 rounded text-[10px] text-[#00aaff]/80 overflow-hidden"
                                        >
                                          <div className="prose prose-invert prose-xs max-w-none prose-p:my-1 prose-headings:text-[#00aaff] prose-headings:text-[11px] prose-headings:uppercase prose-headings:font-black">
                                            <ReactMarkdown>{task.aiAgentResult}</ReactMarkdown>
                                          </div>
                                        </motion.div>
                                      )}
                                    </AnimatePresence>
                                  </div>
                                )}
                                <div className="flex items-center gap-2">
                                  <span className={`text-[9px] px-1.5 py-0.5 rounded border font-black uppercase tracking-widest ${
                                    task.mgr === 'MGR-3' ? 'border-[#ff00ff]/40 text-[#ff00ff]' :
                                    task.mgr === 'MGR-2' ? 'border-[#00aaff]/40 text-[#00aaff]' :
                                    'border-[#00ff88]/40 text-[#00ff88]'
                                  }`}>
                                    {task.mgr === 'MGR-3' ? 'Сложные' : task.mgr === 'MGR-2' ? 'Средние' : 'Простые'}
                                  </span>
                                  {task.scheduledTime && (
                                    <span className="text-[9px] text-white/30 uppercase tracking-[0.1em] font-black">
                                      T-MINUS: {task.scheduledTime}
                                    </span>
                                  )}
                                  {task.deadline && (
                                    <span className={`text-[9px] uppercase tracking-[0.1em] font-black ${
                                      new Date(task.deadline) < new Date() ? 'text-red-500' : 'text-yellow-500/50'
                                    }`}>
                                      DEADLINE: {new Date(task.deadline).toLocaleString()}
                                    </span>
                                  )}
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                <button 
                                  onClick={() => executeTaskWithAi(task.id)}
                                  disabled={task.status === 'completed' || task.aiAgentStatus === 'running'}
                                  className={`p-1.5 rounded-full transition-all border-2 ${
                                    task.aiAgentStatus === 'running'
                                      ? 'text-[#00aaff] border-[#00aaff] animate-spin'
                                      : task.aiAgentStatus === 'completed'
                                      ? 'text-[#00ff88] border-[#00ff88] bg-[#00ff88]/10'
                                      : 'text-white/20 border-white/10 hover:text-[#00aaff] hover:border-[#00aaff]/40'
                                  }`}
                                  title="Запустить AGI Агента"
                                >
                                  {task.aiAgentStatus === 'running' ? <Loader2 size={20} /> : <Cpu size={20} />}
                                </button>
                                <button 
                                  onClick={() => setTaskActive(task.id)}
                                  disabled={task.status === 'completed' || task.status === 'active'}
                                  className={`p-1.5 rounded-full transition-all border-2 ${
                                    task.status === 'active' 
                                      ? 'text-[#00ff88] border-[#00ff88] bg-[#00ff88]/20' 
                                      : 'text-white/20 border-white/10 hover:text-[#00ff88] hover:border-[#00ff88]/40'
                                  }`}
                                  title="Активировать фокус"
                                >
                                  <Zap size={20} className={task.status === 'active' ? 'fill-[#00ff88]' : ''} />
                                </button>
                                <button 
                                  onClick={() => handleCompleteTask(task.id)}
                                  disabled={task.status === 'completed' || task.status === 'failed'}
                                  className={`p-1.5 rounded-full transition-all border-2 ${
                                    task.status === 'completed' 
                                      ? 'text-[#00ff88] border-[#00ff88]/20' 
                                      : task.status === 'failed'
                                      ? 'text-red-500/20 border-red-500/10'
                                      : 'text-white/20 border-white/10 hover:text-[#00ff88] hover:border-[#00ff88]/40 hover:bg-[#00ff88]/10'
                                  }`}
                                >
                                  {task.status === 'completed' ? <CheckCircle2 size={20} /> : 
                                   task.status === 'failed' ? <AlertTriangle size={20} /> : <Circle size={20} />}
                                </button>
                              </div>
                            </div>
                            {task.status === 'active' && (
                              <div className="mt-3 text-[9px] text-[#00ff88] font-black animate-pulse uppercase tracking-[0.2em]">
                                {" >> SECTOR_ACTIVE "}
                              </div>
                            )}
                          </motion.div>
                        ));
                      })()}
                    </div>

                    <AnimatePresence>
                      {showBonus && (
                        <motion.div 
                          initial={{ opacity: 0, scale: 0.95 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.95 }}
                          className="mt-12 p-8 border-2 border-[#00ff88] bg-[#00ff88]/10 rounded-lg text-center shadow-[0_0_50px_rgba(0,255,136,0.1)]"
                        >
                          <div className="text-xl font-black text-[#00ff88] uppercase tracking-[0.5em]">QUEST_COMPLETE</div>
                          <div className="text-sm text-white mt-2 opacity-60">+100 XP BONUS SYNCHRONIZED</div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                  )}
                </div>
              </motion.div>
            )}
            {currentTab === 'god' && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex flex-col gap-8 flex-1 relative"
              >
                <div className="absolute top-0 right-0 p-4 opacity-10 pointer-events-none">
                  <Flame size={120} className="text-red-500" />
                </div>
                
                <div className="mb-4">
                  <h1 className="text-3xl font-black text-red-500 uppercase tracking-tighter shadow-red-500/20 drop-shadow-md">
                    God Mode
                  </h1>
                  <p className="text-red-500/50 text-sm mt-1 uppercase tracking-widest font-bold">
                    Multi-Agent Testing Facility
                  </p>
                </div>

                <div className="flex flex-col md:flex-row gap-6 w-full h-[60vh] min-h-[500px]">
                  
                  {/* Sessions List (God Mode) */}
                  <div className="w-full md:w-1/4 max-h-[200px] md:max-h-full border border-red-500/20 bg-black/40 rounded-xl flex flex-col overflow-hidden">
                    <div className="p-4 border-b border-red-500/20 flex flex-col gap-2">
                       <button
                        onClick={async () => {
                           // Try to make a 'god' session
                           const newId = await createSession("Новый тест", "god");
                           if (newId) {
                             setCurrentAgiSessionId(newId);
                             setAgiMessages([]);
                           }
                        }}
                        className="w-full py-2 bg-red-500/10 text-red-500 text-xs uppercase font-black tracking-widest border border-red-500/30 rounded flex justify-center items-center gap-2 hover:bg-red-500/20 transition-all"
                      >
                         <Plus size={14} /> НОВЫЙ ТЕСТ
                       </button>
                    </div>
                    <div className="flex-1 overflow-y-auto custom-scrollbar p-2 flex flex-col gap-2">
                      {sessions.filter(s => s.mode === 'god').map(session => (
                        <button
                          key={session.id}
                          onClick={() => {
                            setCurrentAgiSessionId(session.id);
                            // Pre-fill messages from db
                            const msgsForSession = dbMessages.filter(m => m.sessionId === session.id);
                            setAgiMessages(msgsForSession as any[]);
                          }}
                          className={`w-full text-left p-3 rounded border text-xs transition-all relative group ${
                            currentAgiSessionId === session.id
                              ? 'border-red-500 bg-red-500/10 text-red-500'
                              : 'border-red-500/10 bg-transparent text-red-500/50 hover:bg-red-500/5 hover:border-red-500/30'
                          }`}
                        >
                          <div className="font-bold truncate pr-6">{session.title}</div>
                          <div className="text-[9px] opacity-50 mt-1">{new Date(session.updatedAt).toLocaleDateString()}</div>
                          <div
                            onClick={(e) => {
                              e.stopPropagation();
                              setSessionToDelete(session.id);
                            }}
                            className="absolute top-2 right-2 p-1 text-red-500/50 hover:text-red-500 hover:bg-red-500/10 rounded opacity-0 group-hover:opacity-100 transition-all font-black"
                            title="Удалить тест"
                          >
                            <X size={12} />
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Chat Area */}
                  <div className="w-full md:w-3/4 flex flex-col bg-black/60 border border-red-500/20 rounded-xl overflow-hidden relative shadow-[0_0_20px_rgba(255,0,0,0.05)]">
                    <div className="flex-1 overflow-y-auto p-4 custom-scrollbar flex flex-col gap-4" ref={agiScrollRef}>
                      {agiMessages.map((msg, i) => (
                        <div key={`god-msg-live-${i}`} className={`flex flex-col max-w-[85%] ${msg.role === 'user' ? 'self-end items-end' : 'self-start items-start'}`}>
                          <div className={`text-[10px] uppercase tracking-widest mb-1 opacity-50 font-black ${msg.role === 'user' ? 'text-white' : 'text-red-500'}`}>
                            {msg.role === 'user' ? 'DEVELOPER' : 'MULTI-AGENT'}
                          </div>
                          
                          <div className={`p-4 rounded-lg bg-black/80 font-mono text-sm shadow-xl relative group ${
                            msg.role === 'user' 
                              ? 'border border-[#ffffff]/20 text-[#ffffff]' 
                              : 'border border-red-500/30 text-red-100 min-w-full md:min-w-[40vw]'
                          }`}>
                            {msg.role === 'model' && (
                              <div className="prose prose-invert prose-red max-w-none prose-sm leading-relaxed whitespace-pre-wrap">
                                <ReactMarkdown>
                                  {renderContent(msg.content)}
                                </ReactMarkdown>
                                {isLoading && i === agiMessages.length - 1 && <span className="inline-block w-2 h-4 bg-red-500 animate-pulse ml-1 align-middle" />}
                              </div>
                            )}
                            {msg.role === 'user' && msg.content}
                          </div>
                        </div>
                      ))}
                      {/* Live streaming message handled in the same array now */}
                    </div>

                    <div className="p-4 border-t border-red-500/20 bg-black/80">
                      <div className="relative flex items-center justify-between opacity-30 text-[9px] uppercase tracking-widest text-red-500 mb-2 font-black">
                        <div>{isLoading ? 'ОБРАБОТКА МУЛЬТИАГЕНТНОГО ЗАПРОСА...' : 'ОЖИДАНИЕ ВВОДА...'}</div>
                        <button 
                          onClick={() => {
                             const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(agiMessages, null, 2));
                             const dlAnchorElem = document.createElement('a');
                             dlAnchorElem.setAttribute("href",     dataStr     );
                             dlAnchorElem.setAttribute("download", "god-mode-logs.json");
                             dlAnchorElem.click();
                          }}
                          className="hover:text-red-400 hover:opacity-100 transition-all flex items-center gap-1"
                        >
                          <FileText size={10} /> Скачать логи (JSON)
                        </button>
                      </div>
                      <div className="relative flex items-center gap-2">
                        <input 
                          type="text"
                          value={agiInput}
                          onChange={(e) => setAgiInput(e.target.value)}
                          onKeyDown={(e) => {
                             if (e.key === 'Enter' && !isLoading && agiInput.trim()) {
                                handleGodSend();
                             }
                          }}
                          placeholder=">>> Введите системный запрос для полного прогона..."
                          className="w-full bg-black/50 border border-red-500/30 rounded pl-4 pr-12 py-3 text-red-500 text-sm focus:outline-none focus:border-red-500 focus:shadow-[0_0_15px_rgba(255,0,0,0.2)] placeholder-red-500/30 font-black"
                        />
                        <button 
                          onClick={handleGodSend}
                          disabled={isLoading || !agiInput.trim()}
                          className="p-3 bg-red-500/10 text-red-500 rounded border border-red-500/30 hover:bg-red-500 hover:text-black disabled:opacity-50 transition-all font-black"
                        >
                          <Send size={18} />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

          </div>
        )}

        {/* Footer Info */}
        <div className="flex flex-wrap justify-between items-center text-[9px] md:text-[10px] text-[#00ff88]/30 uppercase tracking-[0.4em] font-black py-8 border-t border-[#1a1a1a] gap-4">
          <div>SYSTEM_ID: JITJT3X24DYSXF5GWT4YUT</div>
          <div className="text-[#ff00ff]/60 animate-pulse">GAME AI : ACTIVE</div>
          <div>REALITY_STABILITY: 98.4%</div>
          <div>{time || '00:00:00'}</div>
        </div>
      </div>
        {/* Session Deletion Modal */}
        <AnimatePresence>
          {sessionToDelete && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
            >
              <motion.div
                initial={{ scale: 0.9, y: 20 }}
                animate={{ scale: 1, y: 0 }}
                exit={{ scale: 0.9, y: 20 }}
                className="bg-[#050505] border border-red-500/30 rounded-xl p-6 max-w-sm w-full shadow-[0_0_30px_rgba(239,68,68,0.15)] flex flex-col gap-6"
              >
                <div className="flex flex-col gap-2 text-center">
                  <div className="mx-auto bg-red-500/10 p-3 rounded-full text-red-500 mb-2 w-fit">
                    <AlertTriangle size={24} />
                  </div>
                  <h3 className="text-lg font-black text-white uppercase tracking-widest">Удалить сеанс?</h3>
                  <p className="text-xs text-white/50">Это действие необратимо. Вся история сообщений в этом сеансе будет удалена.</p>
                </div>
                
                <div className="flex gap-3">
                  <button
                    onClick={() => setSessionToDelete(null)}
                    className="flex-1 py-3 rounded-lg border border-white/10 text-white/70 hover:bg-white/5 hover:text-white transition-all text-xs font-bold uppercase tracking-widest"
                  >
                    Отмена
                  </button>
                  <button
                    onClick={() => {
                      deleteSession(sessionToDelete);
                      if (currentSessionId === sessionToDelete) setCurrentSessionId(null);
                      if (currentAgiSessionId === sessionToDelete) setCurrentAgiSessionId(null);
                      setSessionToDelete(null);
                    }}
                    className="flex-1 py-3 rounded-lg bg-red-500/20 border border-red-500/50 text-red-500 hover:bg-red-500 hover:text-white transition-all text-xs font-bold uppercase tracking-widest"
                  >
                    Удалить
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
        
        {/* Aura Panel Modal */}
        <AnimatePresence>
          {isAuraPanelOpen && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
              onClick={() => setIsAuraPanelOpen(false)}
            >
              <div 
                className="bg-[#050505] border border-[#ff00ff]/30 shadow-[0_0_40px_rgba(255,0,255,0.15)] rounded-xl p-6 w-full max-w-md"
                onClick={e => e.stopPropagation()}
              >
                <div className="flex items-center justify-between xl mb-6">
                  <div className="flex items-center gap-3 text-[#ff00ff]">
                    <Zap size={24} className={auraFreq !== 'off' ? "animate-pulse" : ""} />
                    <h2 className="text-xl font-black uppercase tracking-[0.2em]">Сигнатура Ауры</h2>
                  </div>
                  <button onClick={() => setIsAuraPanelOpen(false)} className="text-[#ff00ff]/50 hover:text-[#ff00ff]">
                    <X size={24} />
                  </button>
                </div>
                
                <p className="text-xs text-white/50 mb-6 font-mono leading-relaxed">
                  Активируйте бинауральные ритмы для синхронизации мозговых волн. Система генерирует частоты в реальном времени, создавая идеальный фон для работы, медитации или сна.
                </p>

                <div className="flex flex-col gap-3">
                  {[
                    { id: 'off', label: 'ОТКЛЮЧИТЬ АУРУ', desc: 'Деактивация визуализаций и звука', color: 'text-white/50', border: 'border-white/10' },
                    { id: '432Hz', label: '432 Hz - ИСЦЕЛЕНИЕ', desc: 'Глубокое расслабление, Тета-волны, восстановление', color: 'text-[#00ff88]', border: 'border-[#00ff88]/30' },
                    { id: '528Hz', label: '528 Hz - ФОКУС', desc: 'Ремонт ДНК, ясный ум, Альфа-волны, концентрация', color: 'text-[#ff00ff]', border: 'border-[#ff00ff]/30' },
                    { id: '396Hz', label: '396 Hz - СВОБОДА', desc: 'Освобождение от страхов, заземление', color: 'text-[#00aaff]', border: 'border-[#00aaff]/30' },
                  ].map((freq) => (
                    <button
                      key={freq.id}
                      onClick={() => setAuraFreq(freq.id as AuraFrequency)}
                      className={`relative flex flex-col items-start p-4 rounded-lg border transition-all overflow-hidden ${
                        auraFreq === freq.id 
                          ? `bg-black/80 ${freq.border} shadow-[0_0_15px_rgba(255,255,255,0.05)] scale-[1.02]` 
                          : 'bg-black/40 border-white/5 hover:border-white/20'
                      }`}
                    >
                      {auraFreq === freq.id && freq.id !== 'off' && (
                        <motion.div 
                          layoutId="aura-active-bg"
                          className="absolute inset-0 bg-gradient-to-r from-transparent via-[#ff00ff]/5 to-transparent filter opacity-50"
                          animate={{ x: ['-100%', '200%'] }}
                          transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}
                        />
                      )}
                      <div className={`font-black uppercase tracking-widest text-sm relative z-10 ${auraFreq === freq.id ? freq.color : 'text-white/50'}`}>
                        {freq.label}
                      </div>
                      <div className="text-[10px] text-white/40 mt-1 relative z-10">{freq.desc}</div>
                    </button>
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
  );
}

export default function GameApp() {
  return (
    <FirestoreErrorBoundary>
      <GameContent />
    </FirestoreErrorBoundary>
  );
}
