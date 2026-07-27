'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

export interface Task {
  id: string;
  uid?: string;
  desc: string;
  mgr: 'MGR-1' | 'MGR-2' | 'MGR-3';
  xp: number;
  status: 'pending' | 'active' | 'completed' | 'failed';
  aiAgentEnabled?: boolean;
  aiAgentStatus?: 'idle' | 'running' | 'completed' | 'failed';
  aiAgentResult?: string;
  aiAgentPlan?: string;
  scheduledTime?: string;
  deadline?: string;
  failureHandled?: boolean;
  createdAt?: any;
  completedAt?: string;
}

export interface ChatSession {
  id: string;
  title: string;
  mode: string;
  createdAt: any;
  updatedAt: any;
}

export interface Message {
  id: string;
  sessionId?: string;
  role: 'user' | 'model';
  content: string;
  timestamp: any;
  imageUrl?: string;
}

export interface DailyXP {
  date: string;
  xp: number;
}

const STORAGE_KEYS = {
  xp: 'game_xp',
  tasks: 'game_tasks',
  messages: 'game_messages',
  sessions: 'game_sessions',
  history: 'game_history',
  lastLaunch: 'game_last_launch',
};

function loadFromStorage<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveToStorage(key: string, value: any) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
    window.dispatchEvent(new CustomEvent('game:local-state-change'));
  } catch {}
}

export function useGameState() {
  const [isLoaded, setIsLoaded] = useState(false);
  const [xp, setXp] = useState(0);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [dailyHistory, setDailyHistory] = useState<DailyXP[]>([]);
  const [lastLaunch, setLastLaunch] = useState<string | null>(null);
  const [rank, setRank] = useState(9999);

  // Fake user object so components that check `user` still work
  const user = { uid: 'local', email: 'local@game', displayName: 'Boss' };

  useEffect(() => {
    setXp(loadFromStorage(STORAGE_KEYS.xp, 0));
    setTasks(loadFromStorage(STORAGE_KEYS.tasks, []));
    setMessages(loadFromStorage(STORAGE_KEYS.messages, []));
    setSessions(loadFromStorage(STORAGE_KEYS.sessions, []));
    setDailyHistory(loadFromStorage(STORAGE_KEYS.history, []));
    setLastLaunch(loadFromStorage(STORAGE_KEYS.lastLaunch, null));
    setIsLoaded(true);
  }, []);

  // Recompute rank from xp
  useEffect(() => {
    setRank(Math.max(1, 10000 - Math.floor(xp / 10)));
  }, [xp]);

  // Cross-instance and cloud sync. CloudStateSync also emits this event after
  // hydrating an authenticated user's server snapshot.
  useEffect(() => {
    const onSync = () => {
      setTasks(loadFromStorage<Task[]>(STORAGE_KEYS.tasks, []));
      setXp(loadFromStorage<number>(STORAGE_KEYS.xp, 0));
      setDailyHistory(loadFromStorage<DailyXP[]>(STORAGE_KEYS.history, []));
      setMessages(loadFromStorage<Message[]>(STORAGE_KEYS.messages, []));
      setSessions(loadFromStorage<ChatSession[]>(STORAGE_KEYS.sessions, []));
      setLastLaunch(loadFromStorage<string | null>(STORAGE_KEYS.lastLaunch, null));
    };
    window.addEventListener('game:tasks-sync', onSync);
    window.addEventListener('game:state-sync', onSync);
    return () => {
      window.removeEventListener('game:tasks-sync', onSync);
      window.removeEventListener('game:state-sync', onSync);
    };
  }, []);

  const launchGame = useCallback(async () => {
    const now = new Date().toISOString();
    setLastLaunch(now);
    saveToStorage(STORAGE_KEYS.lastLaunch, now);
  }, []);

  const addXp = useCallback(async (amount: number) => {
    setXp(prev => {
      const next = prev + amount;
      saveToStorage(STORAGE_KEYS.xp, next);
      // Update daily history
      const today = new Date().toISOString().slice(0, 10);
      setDailyHistory(hist => {
        const existing = hist.find(h => h.date === today);
        let next_hist: DailyXP[];
        if (existing) {
          next_hist = hist.map(h => h.date === today ? { ...h, xp: h.xp + amount } : h);
        } else {
          next_hist = [...hist, { date: today, xp: amount }];
        }
        saveToStorage(STORAGE_KEYS.history, next_hist);
        return next_hist;
      });
      return next;
    });
  }, []);

  const updateTasks = useCallback(async (newTasks: Task[]) => {
    setTasks(newTasks);
    saveToStorage(STORAGE_KEYS.tasks, newTasks);
  }, []);

  // Append tasks (used by the MAX orchestrator to "take work into the system").
  const addTasks = useCallback(async (newTasks: Task[]) => {
    setTasks(prev => {
      const updated = [...prev, ...newTasks];
      saveToStorage(STORAGE_KEYS.tasks, updated);
      return updated;
    });
  }, []);

  const completeTask = useCallback(async (taskId: string): Promise<boolean> => {
    let allDone = false;
    setTasks(prev => {
      const updated = prev.map(t => {
        if (t.id === taskId) {
          addXp(t.xp);
          return { ...t, status: 'completed' as const, completedAt: new Date().toISOString() };
        }
        return t;
      });
      const remaining = updated.filter(t => t.status !== 'completed' && t.status !== 'failed');
      allDone = remaining.length === 0;
      saveToStorage(STORAGE_KEYS.tasks, updated);
      return updated;
    });
    return allDone;
  }, [addXp]);

  const setTaskActive = useCallback(async (taskId: string) => {
    setTasks(prev => {
      const updated = prev.map(t => t.id === taskId ? { ...t, status: 'active' as const } : t);
      saveToStorage(STORAGE_KEYS.tasks, updated);
      return updated;
    });
  }, []);

  const deleteTasks = useCallback(async (taskIds: string[]) => {
    setTasks(prev => {
      const updated = prev.filter(t => !taskIds.includes(t.id));
      saveToStorage(STORAGE_KEYS.tasks, updated);
      return updated;
    });
  }, []);

  const saveMessage = useCallback(async (role: 'user' | 'model', content: string, sessionId?: string) => {
    const msg: Message = {
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      sessionId,
      role,
      content,
      timestamp: new Date().toISOString(),
    };
    setMessages(prev => {
      const updated = [...prev, msg];
      saveToStorage(STORAGE_KEYS.messages, updated);
      return updated;
    });
  }, []);

  const createSession = useCallback(async (title: string, mode: string): Promise<string> => {
    const id = `session_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const session: ChatSession = {
      id,
      title,
      mode,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setSessions(prev => {
      const updated = [session, ...prev];
      saveToStorage(STORAGE_KEYS.sessions, updated);
      return updated;
    });
    return id;
  }, []);

  const updateSessionTitle = useCallback(async (sessionId: string, title: string) => {
    setSessions(prev => {
      const updated = prev.map(s => s.id === sessionId ? { ...s, title, updatedAt: new Date().toISOString() } : s);
      saveToStorage(STORAGE_KEYS.sessions, updated);
      return updated;
    });
  }, []);

  const deleteSession = useCallback(async (sessionId: string) => {
    setSessions(prev => {
      const updated = prev.filter(s => s.id !== sessionId);
      saveToStorage(STORAGE_KEYS.sessions, updated);
      return updated;
    });
    setMessages(prev => {
      const updated = prev.filter(m => m.sessionId !== sessionId);
      saveToStorage(STORAGE_KEYS.messages, updated);
      return updated;
    });
  }, []);

  const executeTaskWithAi = useCallback(async (taskId: string, prompt?: string) => {
    // placeholder — handled in component
  }, []);

  return {
    user,
    xp,
    tasks,
    messages,
    sessions,
    rank,
    dailyHistory,
    lastLaunch,
    isLoaded,
    launchGame,
    addXp,
    updateTasks,
    addTasks,
    completeTask,
    setTaskActive,
    deleteTasks,
    saveMessage,
    createSession,
    updateSessionTitle,
    deleteSession,
    executeTaskWithAi,
  };
}
