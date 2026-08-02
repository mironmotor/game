'use client';

import type { ReactNode } from 'react';
import { useAuth } from '@/lib/auth';
import LoginScreen from './LoginScreen';
import './auth.css';

// Вход больше не обязателен.
//
// Firebase Auth отказывает с auth/unauthorized-domain на любом домене, которого
// нет в белом списке консоли — а превью-адреса Vercel меняются на каждую ветку,
// и вносить их все туда невозможно. Раньше это наглухо запирало приложение:
// логин не проходил, а без логина не пускало.
//
// Поэтому неавторизованный посетитель просто проходит внутрь. Само приложение
// без пользователя работает — этот путь уже обкатан на /tg, который никогда не
// был обёрнут в AuthGate. Вход никуда не делся: он доступен там, где нужен, и
// возвращается целиком флагом NEXT_PUBLIC_REQUIRE_AUTH=1.
const REQUIRE_AUTH = process.env.NEXT_PUBLIC_REQUIRE_AUTH === '1';

export default function AuthGate({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();

  // Ждать разрешения авторизации есть смысл только когда она обязательна.
  if (loading && REQUIRE_AUTH) {
    return (
      <div className="auth-wrap">
        <div className="auth-loader">
          <span className="auth-logo">△∞</span>
          <div className="auth-spinner" />
        </div>
      </div>
    );
  }

  if (!user && REQUIRE_AUTH) return <LoginScreen />;

  return <>{children}</>;
}
