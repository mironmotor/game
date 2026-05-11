// Firebase stub — all data is stored in localStorage via use-game-state.ts
// This file exists to avoid breaking imports in components that still reference it

export const auth = { currentUser: null };
export const db = null;
export const googleProvider = null;

export const loginWithGoogle = async () => { return null; };
export const logout = async () => { return null; };
export const getRedirectResult = async () => { return null; };

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
  authInfo: any;
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  console.error('Storage error:', error, operationType, path);
}
