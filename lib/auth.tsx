'use client';

// Auth + user record. Fully client-side Firebase (works on static export and
// Vercel alike). On sign-in we ensure a Firestore users/{uid} document exists
// with a subscription tier — that document IS the user database + the source of
// truth for what a user is allowed to do.

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInAnonymously,
  updateProfile,
  type User,
} from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import {
  firebaseAuth,
  firestore,
  loginWithGoogle,
  logout as fbLogout,
  getRedirectResult,
} from '@/firebase';
import { DEFAULT_TIER, type Tier } from '@/lib/subscription';

export interface UserRecord {
  uid: string;
  email: string | null;
  displayName: string | null;
  tier: Tier;
  createdAt: unknown;
  // usage counters, reset by the billing period (kept simple for the MVP)
  usage: Record<string, number>;
}

interface AuthState {
  user: User | null;
  record: UserRecord | null;
  loading: boolean;
  configured: boolean; // false if Firebase Auth isn't reachable / not enabled
  error: string | null;
  signInGoogle: () => Promise<void>;
  signInEmail: (email: string, password: string) => Promise<void>;
  signUpEmail: (email: string, password: string, name?: string) => Promise<void>;
  signInGuest: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

async function ensureUserRecord(user: User): Promise<UserRecord | null> {
  const db = firestore();
  if (!db) return null;
  const ref = doc(db, 'users', user.uid);
  try {
    const snap = await getDoc(ref);
    if (snap.exists()) {
      return { uid: user.uid, ...(snap.data() as Omit<UserRecord, 'uid'>) };
    }
    const fresh: Omit<UserRecord, 'uid'> = {
      email: user.email,
      displayName: user.displayName,
      tier: DEFAULT_TIER,
      createdAt: serverTimestamp(),
      usage: {},
    };
    // create() — the user may only create their own doc with tier=free (rules).
    await setDoc(ref, fresh, { merge: true });
    return { uid: user.uid, ...fresh };
  } catch (e) {
    console.error('ensureUserRecord failed', e);
    // Auth worked but Firestore write was blocked — still return a local view so
    // the app is usable; the tier just defaults to free until rules/db are set.
    return {
      uid: user.uid,
      email: user.email,
      displayName: user.displayName,
      tier: DEFAULT_TIER,
      createdAt: null,
      usage: {},
    };
  }
}

function friendlyError(e: unknown): string {
  const code = (e as { code?: string })?.code ?? '';
  switch (code) {
    case 'auth/invalid-email': return 'Неверный email.';
    case 'auth/user-not-found': return 'Пользователь не найден — зарегистрируйся.';
    case 'auth/wrong-password':
    case 'auth/invalid-credential': return 'Неверный email или пароль.';
    case 'auth/email-already-in-use': return 'Этот email уже занят — войди.';
    case 'auth/weak-password': return 'Пароль слишком простой (минимум 6 символов).';
    case 'auth/popup-closed-by-user': return 'Окно входа закрыто.';
    case 'auth/operation-not-allowed':
      return 'Этот способ входа выключен в Firebase (включи его в консоли → Authentication).';
    case 'auth/configuration-not-found':
      return 'Firebase Auth ещё не включён в консоли проекта.';
    default:
      return (e as { message?: string })?.message || 'Не удалось войти.';
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [record, setRecord] = useState<UserRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [configured, setConfigured] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const auth = firebaseAuth();
    if (!auth) {
      setConfigured(false);
      setLoading(false);
      return;
    }
    // Resolve any pending redirect sign-in (mobile/popup-blocked path).
    getRedirectResult().catch(() => {});
    const unsub = onAuthStateChanged(
      auth,
      async (u) => {
        setUser(u);
        if (u) {
          const rec = await ensureUserRecord(u);
          setRecord(rec);
        } else {
          setRecord(null);
        }
        setLoading(false);
      },
      (e) => {
        console.error('auth state error', e);
        setConfigured(false);
        setLoading(false);
      },
    );
    return () => unsub();
  }, []);

  const wrap = (fn: () => Promise<unknown>) => async () => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(friendlyError(e));
      throw e;
    }
  };

  const value: AuthState = {
    user,
    record,
    loading,
    configured,
    error,
    signInGoogle: wrap(() => loginWithGoogle()),
    signInEmail: async (email, password) => {
      setError(null);
      const auth = firebaseAuth();
      if (!auth) throw new Error('no-auth');
      try {
        await signInWithEmailAndPassword(auth, email, password);
      } catch (e) {
        setError(friendlyError(e));
        throw e;
      }
    },
    signUpEmail: async (email, password, name) => {
      setError(null);
      const auth = firebaseAuth();
      if (!auth) throw new Error('no-auth');
      try {
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        if (name) await updateProfile(cred.user, { displayName: name });
      } catch (e) {
        setError(friendlyError(e));
        throw e;
      }
    },
    signInGuest: async () => {
      setError(null);
      const auth = firebaseAuth();
      if (!auth) throw new Error('no-auth');
      try {
        await signInAnonymously(auth);
      } catch (e) {
        setError(friendlyError(e));
        throw e;
      }
    },
    signOut: wrap(() => fbLogout()),
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}
