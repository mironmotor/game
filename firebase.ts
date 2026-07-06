// Real Firebase — Auth + Firestore on the existing project (config in
// firebase-applet-config.json). The web apiKey is public by design (Google:
// it identifies the project; access is guarded by Auth + Firestore rules).
//
// Backward-compatible exports are kept so existing imports (GameApp.tsx) still
// resolve; they now point at the real SDK instead of the old localStorage stub.

import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult as fbGetRedirectResult,
  signOut,
  type Auth,
} from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyCQjaZGRQeRW5yUr7Rhrp5lmFyyiBD-Xgg',
  authDomain: 'ai-studio-applet-webapp-7dd58.firebaseapp.com',
  projectId: 'ai-studio-applet-webapp-7dd58',
  storageBucket: 'ai-studio-applet-webapp-7dd58.firebasestorage.app',
  messagingSenderId: '1042381363087',
  appId: '1:1042381363087:web:f01f36624f1db83575ddfa',
};

// Firestore database id from firebase-applet-config.json (named DB, not default).
const FIRESTORE_DB_ID = 'ai-studio-dcf78fd2-d064-4f32-a65f-e4dbd1128e38';

// Guard against SSR/static-export prerender: only touch the SDK in the browser.
const isBrowser = typeof window !== 'undefined';

let _app: FirebaseApp | null = null;
let _auth: Auth | null = null;
let _db: Firestore | null = null;

function app(): FirebaseApp {
  if (_app) return _app;
  _app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  return _app;
}

export function firebaseAuth(): Auth | null {
  if (!isBrowser) return null;
  if (!_auth) _auth = getAuth(app());
  return _auth;
}

export function firestore(): Firestore | null {
  if (!isBrowser) return null;
  if (!_db) _db = getFirestore(app(), FIRESTORE_DB_ID);
  return _db;
}

export const googleProvider = isBrowser ? new GoogleAuthProvider() : null;

// ── Convenience helpers (kept for backward compatibility) ────────────────────

export async function loginWithGoogle() {
  const auth = firebaseAuth();
  if (!auth || !googleProvider) return null;
  try {
    // Popup first (best UX); fall back to redirect where popups are blocked.
    return await signInWithPopup(auth, googleProvider);
  } catch {
    await signInWithRedirect(auth, googleProvider);
    return null;
  }
}

export async function logout() {
  const auth = firebaseAuth();
  if (!auth) return null;
  return signOut(auth);
}

export async function getRedirectResult() {
  const auth = firebaseAuth();
  if (!auth) return null;
  try {
    return await fbGetRedirectResult(auth);
  } catch {
    return null;
  }
}

// Legacy stub-era exports still imported in a few places.
export const auth = { get currentUser() { return firebaseAuth()?.currentUser ?? null; } };
export const db = null;

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: unknown;
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  console.error('Firestore error:', error, operationType, path);
}
