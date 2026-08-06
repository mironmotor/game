'use client';

import type { ReactNode } from 'react';
import { useAuth } from '@/lib/auth';
import { GODMODE } from '@/lib/subscription';
import LoginScreen from './LoginScreen';
import './auth.css';

// Wrap anything that requires a signed-in user. Shows a loader while auth
// resolves, the login screen when signed out, children when signed in.
//
// В GODMODE вход не требуется вообще: стена пропускает всех, даже если её
// снова навесят на страницу.
export default function AuthGate({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();

  if (GODMODE) return <>{children}</>;

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
