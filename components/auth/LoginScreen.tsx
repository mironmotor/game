'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import './auth.css';

export default function LoginScreen() {
  const { signInGoogle, signInEmail, signUpEmail, signInGuest, error, configured } = useAuth();
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === 'in') await signInEmail(email.trim(), password);
      else await signUpEmail(email.trim(), password, name.trim() || undefined);
    } catch {
      /* error surfaced via context */
    } finally {
      setBusy(false);
    }
  }

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    try { await fn(); } catch { /* shown via context */ } finally { setBusy(false); }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-logo">△∞</div>
        <h1 className="auth-title">GAME</h1>
        <p className="auth-sub">
          {mode === 'in' ? 'Вход в систему' : 'Создать аккаунт'}
        </p>

        {!configured && (
          <div className="auth-warn">
            Firebase Auth ещё не включён в консоли проекта. Включи способы входа
            в Authentication → Sign-in method (Email/Password, Google, Anonymous).
          </div>
        )}

        <button
          className="auth-btn auth-google"
          onClick={() => run(signInGoogle)}
          disabled={busy}
          type="button"
        >
          <span className="auth-g">G</span> Войти через Google
        </button>

        <div className="auth-or"><span>или</span></div>

        <form onSubmit={submit} className="auth-form">
          {mode === 'up' && (
            <input
              className="auth-input"
              placeholder="Имя (необязательно)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={busy}
            />
          )}
          <input
            className="auth-input"
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            disabled={busy}
          />
          <input
            className="auth-input"
            type="password"
            placeholder="Пароль"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            disabled={busy}
          />
          <button className="auth-btn auth-primary" type="submit" disabled={busy}>
            {busy ? '…' : mode === 'in' ? 'Войти' : 'Зарегистрироваться'}
          </button>
        </form>

        {error && <div className="auth-error">{error}</div>}

        <button
          className="auth-switch"
          type="button"
          onClick={() => setMode(mode === 'in' ? 'up' : 'in')}
          disabled={busy}
        >
          {mode === 'in' ? 'Нет аккаунта? Создать' : 'Уже есть аккаунт? Войти'}
        </button>

        <button
          className="auth-guest"
          type="button"
          onClick={() => run(signInGuest)}
          disabled={busy}
        >
          Зайти как гость
        </button>
      </div>
    </div>
  );
}
