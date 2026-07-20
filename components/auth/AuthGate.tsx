'use client';

import type { ReactNode } from 'react';
import { useAuth } from '@/lib/auth';
import LoginScreen from './LoginScreen';
import './auth.css';

// Wrap anything that requires a signed-in user. Shows a loader while auth
// resolves, the login screen when signed out, children when signed in.
export default function AuthGate({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="auth-wrap">
        <div className="auth-loader">
          <span className="auth-logo">△∞</span>
          <div className="auth-spinner" />
        </div>
      </div>
    );
  }

  if (!user) return <LoginScreen />;

  return <>{children}</>;
}
