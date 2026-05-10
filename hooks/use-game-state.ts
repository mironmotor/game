'use client';

import { useState, useEffect, useCallback } from 'react';
import { auth, db, handleFirestoreError, OperationType } from '@/firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { 
  doc, 
  onSnapshot, 
  setDoc, 
  collection, 
  query, 
  where, 
  getDocs,
  writeBatch,
  serverTimestamp
} from 'firebase/firestore';

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

export function useGameState() {
  const [user, setUser] = useState<User | null>(null);
  const [state, setState] = useState<{
    xp: number;
    tasks: Task[];
    messages: Message[];
    sessions: ChatSession[];
    lastLaunch: string | null;
    dailyHistory: DailyXP[];
    isLoaded: boolean;
  }>({
    xp: 0,
    tasks: [],
    messages: [],
    sessions: [],
    lastLaunch: null,
    dailyHistory: [],
    isLoaded: false,
  });

  const loadFromLocal = useCallback(() => {
    if (typeof window !== 'undefined') {
      const savedXp = localStorage.getItem('game_xp');
      const savedTasks = localStorage.getItem('game_tasks');
      const savedLaunch = localStorage.getItem('game_last_launch');
      const savedHistory = localStorage.getItem('game_history');
      const savedMessages = localStorage.getItem('game_messages');
      const savedSessions = localStorage.getItem('game_sessions');

      setTimeout(() => {
        setState({
          xp: savedXp ? parseInt(savedXp) : 0,
          tasks: savedTasks ? JSON.parse(savedTasks) : [],
          messages: savedMessages ? JSON.parse(savedMessages) : [],
          sessions: savedSessions ? JSON.parse(savedSessions) : [],
          lastLaunch: savedLaunch || null,
          dailyHistory: savedHistory ? JSON.parse(savedHistory) : [],
          isLoaded: true,
        });
      }, 0);
    }
  }, []);

  // Auth listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (!u) {
        // If logged out, reset to local storage or defaults
        setState(prev => ({ ...prev, isLoaded: false }));
        loadFromLocal();
      }
    });
    return () => unsubscribe();
  }, [loadFromLocal]);

  // Firestore Sync
  useEffect(() => {
    if (!user) return;

    const userDocRef = doc(db, 'users', user.uid);
    const tasksColRef = collection(db, 'users', user.uid, 'tasks');
    const messagesColRef = collection(db, 'users', user.uid, 'messages');
    const sessionsColRef = collection(db, 'users', user.uid, 'sessions');

    const unsubUser = onSnapshot(userDocRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setState(prev => ({
          ...prev,
          xp: data.totalXp || 0,
          lastLaunch: data.lastLaunch || null,
          dailyHistory: data.dailyHistory || [],
          isLoaded: true
        }));
      } else {
        // Initialize user doc if it doesn't exist
        setDoc(userDocRef, {
          uid: user.uid,
          totalXp: 0,
          rank: 10000,
          dailyHistory: [],
          updatedAt: serverTimestamp()
        }).catch(e => handleFirestoreError(e, OperationType.CREATE, `users/${user.uid}`));
      }
    }, (e) => handleFirestoreError(e, OperationType.GET, `users/${user.uid}`));

    const unsubTasks = onSnapshot(tasksColRef, (querySnap) => {
      const tasksData: Task[] = [];
      querySnap.forEach((doc) => {
        tasksData.push(doc.data() as Task);
      });
      setState(prev => ({ ...prev, tasks: tasksData }));
    }, (e) => handleFirestoreError(e, OperationType.GET, `users/${user.uid}/tasks`));

    const unsubMessages = onSnapshot(messagesColRef, (querySnap) => {
      const msgs: Message[] = [];
      querySnap.forEach((doc) => {
        msgs.push(doc.data() as Message);
      });
      // Sort by timestamp
      msgs.sort((a, b) => (a.timestamp?.seconds || 0) - (b.timestamp?.seconds || 0));
      setState(prev => ({ ...prev, messages: msgs }));
    }, (e) => handleFirestoreError(e, OperationType.GET, `users/${user.uid}/messages`));

    const unsubSessions = onSnapshot(sessionsColRef, (querySnap) => {
      const sessionsData: ChatSession[] = [];
      querySnap.forEach((doc) => {
        sessionsData.push(doc.data() as ChatSession);
      });
      sessionsData.sort((a, b) => (b.updatedAt?.seconds || 0) - (a.updatedAt?.seconds || 0));
      setState(prev => ({ ...prev, sessions: sessionsData }));
    }, (e) => handleFirestoreError(e, OperationType.GET, `users/${user.uid}/sessions`));

    return () => {
      unsubUser();
      unsubTasks();
      unsubMessages();
      unsubSessions();
    };
  }, [user]);

  // Derived state for rank
  const rank = Math.max(1, Math.floor(10000 / (state.xp / 1000 + 1)));

  // Save to LocalStorage fallback
  useEffect(() => {
    if (!user && state.isLoaded && typeof window !== 'undefined') {
      localStorage.setItem('game_xp', state.xp.toString());
      localStorage.setItem('game_tasks', JSON.stringify(state.tasks));
      localStorage.setItem('game_history', JSON.stringify(state.dailyHistory));
      if (state.lastLaunch) localStorage.setItem('game_last_launch', state.lastLaunch);
    }
  }, [state.xp, state.tasks, state.lastLaunch, state.dailyHistory, state.isLoaded, user]);

  const syncUserToFirestore = async (updates: any) => {
    if (!user) return;
    try {
      await setDoc(doc(db, 'users', user.uid), {
        uid: user.uid,
        ...updates,
        updatedAt: serverTimestamp()
      }, { merge: true });
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, `users/${user.uid}`);
    }
  };

  const addXp = async (amount: number) => {
    const today = new Date().toDateString();
    const newXp = state.xp + amount;
    const newRank = Math.max(1, Math.floor(10000 / (newXp / 1000 + 1)));
    const existing = state.dailyHistory.find(h => h.date === today);
    let newHistory;
    if (existing) {
      newHistory = state.dailyHistory.map(h => h.date === today ? { ...h, xp: h.xp + amount } : h);
    } else {
      newHistory = [...state.dailyHistory, { date: today, xp: amount }].slice(-14);
    }

    if (user) {
      await syncUserToFirestore({ totalXp: newXp, dailyHistory: newHistory, rank: newRank });
    } else {
      setState(prev => ({ ...prev, xp: newXp, dailyHistory: newHistory }));
    }
  };
  
  const launchGame = async () => {
    const today = new Date().toDateString();
    if (state.lastLaunch !== today) {
      await addXp(10);
      if (user) {
        await syncUserToFirestore({ lastLaunch: today });
      } else {
        setState(prev => ({ ...prev, lastLaunch: today }));
      }
      return true;
    }
    return false;
  };

  const updateTasks = async (newTasks: Task[]) => {
    if (user) {
      const batch = writeBatch(db);
      newTasks.forEach(t => {
        const taskRef = doc(db, 'users', user.uid, 'tasks', t.id);
        batch.set(taskRef, { ...t, uid: user.uid, createdAt: serverTimestamp() }, { merge: true });
      });
      try {
        await batch.commit();
      } catch (e) {
        handleFirestoreError(e, OperationType.WRITE, `users/${user.uid}/tasks`);
      }
    } else {
      setState(prev => {
        const merged = [...prev.tasks];
        newTasks.forEach(newTask => {
          const index = merged.findIndex(t => t.id === newTask.id);
          if (index > -1) merged[index] = newTask;
          else merged.push(newTask);
        });
        return { ...prev, tasks: merged };
      });
    }
  };

  const setTaskActive = async (taskId: string) => {
    const updatedTasks = state.tasks.map(t => ({
      ...t,
      status: t.id === taskId ? 'active' : (t.status === 'active' ? 'pending' : t.status)
    })) as Task[];

    if (user) {
      const batch = writeBatch(db);
      updatedTasks.forEach(t => {
        const taskRef = doc(db, 'users', user.uid, 'tasks', t.id);
        batch.update(taskRef, { status: t.status });
      });
      try {
        await batch.commit();
      } catch (e) {
        handleFirestoreError(e, OperationType.UPDATE, `users/${user.uid}/tasks`);
      }
    } else {
      setState(prev => ({ ...prev, tasks: updatedTasks }));
    }
  };

  const deleteTasks = async (taskIds: string[]) => {
    if (user) {
      const batch = writeBatch(db);
      taskIds.forEach(id => {
        const taskRef = doc(db, 'users', user.uid, 'tasks', id);
        batch.delete(taskRef);
      });
      try {
        await batch.commit();
      } catch (e) {
        handleFirestoreError(e, OperationType.DELETE, `users/${user.uid}/tasks`);
      }
    } else {
      setState(prev => ({
        ...prev,
        tasks: prev.tasks.filter(t => !taskIds.includes(t.id))
      }));
    }
  };

  const completeTask = async (taskId: string) => {
    const task = state.tasks.find(t => t.id === taskId);
    if (task && task.status !== 'completed') {
      await addXp(task.xp);
      const completedAt = new Date().toISOString();
      
      const pendingTasks = state.tasks.filter(t => t.id !== taskId && (t.status === 'pending' || t.status === 'active'));
      const isAllCompleted = state.tasks.length > 0 && pendingTasks.length === 0;

      if (isAllCompleted) {
        await addXp(100);
      }

      if (user) {
        try {
          await setDoc(doc(db, 'users', user.uid, 'tasks', taskId), { status: 'completed', completedAt }, { merge: true });
        } catch (error) {
          handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}/tasks/${taskId}`);
        }
      } else {
        setState(prev => ({
          ...prev,
          tasks: prev.tasks.map(t => t.id === taskId ? { ...t, status: 'completed', completedAt } : t)
        }));
      }
      return isAllCompleted;
    }
    return false;
  };

  const executeTaskWithAi = async (taskId: string) => {
    const task = state.tasks.find(t => t.id === taskId);
    if (!task) return;

    // Set status to running
    const updateStatus = async (status: 'running' | 'completed' | 'failed', result?: string) => {
      if (user) {
        await setDoc(doc(db, 'users', user.uid, 'tasks', taskId), { 
          aiAgentStatus: status,
          ...(result ? { aiAgentResult: result } : {})
        }, { merge: true });
      } else {
        setState(prev => ({
          ...prev,
          tasks: prev.tasks.map(t => t.id === taskId ? { 
            ...t, 
            aiAgentStatus: status,
            ...(result ? { aiAgentResult: result } : {})
          } : t)
        }));
      }
    };

    await updateStatus('running');

    try {
      const { executeAiAgentTask } = await import('@/lib/gemini');
      const result = await executeAiAgentTask(task.desc, `User Rank: ${rank}, Total XP: ${state.xp}`);
      await updateStatus('completed', result);
      // Auto-complete task if it's informational
      if (result && result.includes('RESULT: [SUCCESS/COMPLETED]')) {
        await completeTask(taskId);
      }
    } catch (error: any) {
      if (error && (error.name === 'AbortError' || (error.message && error.message.toLowerCase().includes('abort')))) {
        console.log("AI Execution skipped: request aborted");
        await updateStatus('failed', "SYSTEM: Execution aborted.");
      } else {
        console.error("AI Execution failed", error);
        await updateStatus('failed', "SYSTEM ERROR: AI Agent failed to execute task.");
      }
    }
  };

  const createSession = async (title: string = 'Новый сеанс', mode: string = 'game') => {
    if (!user) return null;
    const id = Math.random().toString(36).substring(7);
    const sessionRef = doc(db, 'users', user.uid, 'sessions', id);
    try {
      await setDoc(sessionRef, {
        id,
        title,
        mode,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      return id;
    } catch (e) {
      handleFirestoreError(e, OperationType.CREATE, `users/${user.uid}/sessions/${id}`);
      return null;
    }
  };

  const updateSessionTitle = async (sessionId: string, title: string) => {
    if (!user) return;
    try {
      await setDoc(doc(db, 'users', user.uid, 'sessions', sessionId), { title, updatedAt: serverTimestamp() }, { merge: true });
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, `users/${user.uid}/sessions/${sessionId}`);
    }
  };

  const saveMessage = async (role: 'user' | 'model', content: string, sessionId?: string) => {
    if (!user) return;
    const id = Math.random().toString(36).substring(7);
    const msgRef = doc(db, 'users', user.uid, 'messages', id);
    try {
      await setDoc(msgRef, {
        id,
        role,
        content,
        sessionId: sessionId || null,
        timestamp: serverTimestamp()
      });
      if (sessionId) {
        await setDoc(doc(db, 'users', user.uid, 'sessions', sessionId), { updatedAt: serverTimestamp() }, { merge: true });
      }
    } catch (e) {
      handleFirestoreError(e, OperationType.CREATE, `users/${user.uid}/messages/${id}`);
    }
  };

  // Deadline check
  useEffect(() => {
    if (!state.isLoaded) return;
    const checkDeadlines = async () => {
      const now = new Date();
      const expiredTasks = state.tasks.filter(t => 
        t.status !== 'completed' && 
        t.status !== 'failed' && 
        t.deadline && 
        new Date(t.deadline) < now &&
        !t.failureHandled
      );

      if (expiredTasks.length > 0) {
        if (user) {
          const batch = writeBatch(db);
          expiredTasks.forEach(t => {
            const taskRef = doc(db, 'users', user.uid, 'tasks', t.id);
            batch.update(taskRef, { status: 'failed', failureHandled: true });
          });
          await batch.commit();
        } else {
          setState(prev => ({
            ...prev,
            tasks: prev.tasks.map(t => {
              const isExpired = expiredTasks.find(et => et.id === t.id);
              return isExpired ? { ...t, status: 'failed', failureHandled: true } : t;
            })
          }));
        }
      }
    };

    const interval = setInterval(checkDeadlines, 60000); // Check every minute
    checkDeadlines();
    return () => clearInterval(interval);
  }, [state.tasks, state.isLoaded, user]);

  const deleteSession = async (sessionId: string) => {
    if (!user) return;
    try {
      // Delete all messages in the session first
      const messagesQuery = query(
        collection(db, 'users', user.uid, 'messages'),
        where('sessionId', '==', sessionId)
      );
      const messagesSnapshot = await getDocs(messagesQuery);
      
      const batch = writeBatch(db);
      messagesSnapshot.docs.forEach(doc => {
        batch.delete(doc.ref);
      });
      
      // Delete the session document
      const sessionRef = doc(db, 'users', user.uid, 'sessions', sessionId);
      batch.delete(sessionRef);
      
      await batch.commit();
    } catch (e) {
      handleFirestoreError(e, OperationType.DELETE, `users/${user.uid}/sessions/${sessionId}`);
    }
  };

  return { 
    user,
    xp: state.xp, 
    tasks: state.tasks, 
    messages: state.messages,
    sessions: state.sessions,
    rank, 
    dailyHistory: state.dailyHistory, 
    addXp, 
    updateTasks, 
    completeTask, 
    launchGame, 
    setTaskActive, 
    saveMessage,
    createSession,
    updateSessionTitle,
    deleteSession,
    executeTaskWithAi,
    deleteTasks,
    isLoaded: state.isLoaded 
  };
}
