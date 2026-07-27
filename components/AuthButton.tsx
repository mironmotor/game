'use client';

/**
 * AuthButton — вход/выход через Google (NextAuth v5). Фикс в правом верхнем углу
 * HUD. Логин пока НЕОБЯЗАТЕЛЬНЫЙ: не залогинен — кнопка «Войти», залогинен —
 * аватар + имя + выйти. Auth.js хранит пользователя и Google account в Neon.
 */

import { useEffect, useState } from 'react';
import { useSession, signIn, signOut } from 'next-auth/react';
import { reachGoal } from '@/lib/metrika';
import { Cloud, CloudOff, LoaderCircle, LogIn, LogOut, Settings } from 'lucide-react';
import { getApiPath } from '@/lib/max17-client';
import { useI18n } from '@/components/I18nProvider';

type CloudStatus = 'idle' | 'loading' | 'synced' | 'saving' | 'offline' | 'error';

export default function AuthButton() {
  const { t } = useI18n();
  const { data: session, status } = useSession();
  const [googleReady, setGoogleReady] = useState<boolean | null>(null);
  const [cloudStatus, setCloudStatus] = useState<CloudStatus>('idle');

  useEffect(() => {
    fetch(getApiPath('auth-status'))
      .then((r) => r.json())
      .then((d) => setGoogleReady(Boolean(d.googleReady)))
      .catch(() => setGoogleReady(false));
  }, []);

  useEffect(() => {
    const onCloudStatus = (event: Event) => {
      setCloudStatus((event as CustomEvent<CloudStatus>).detail);
    };
    window.addEventListener('game:cloud-status', onCloudStatus);
    return () => window.removeEventListener('game:cloud-status', onCloudStatus);
  }, []);

  if (status === 'loading') return null;
  if (googleReady === null && !session?.user) return null;

  if (session?.user) {
    const cloudTitle = {
      idle: t('common.account'),
      loading: t('common.loading'),
      synced: t('common.cloudSync'),
      saving: t('common.cloudSync'),
      offline: t('common.localMode'),
      error: t('common.localMode'),
    }[cloudStatus];

    return (
      <div
        className="fixed right-4 top-4 z-[52] flex items-center gap-2 rounded-full border border-white/10 bg-[#0a0818]/85 px-2.5 py-1.5 backdrop-blur-md"
        title={cloudTitle}
      >
        {session.user.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={session.user.image} alt="" className="h-6 w-6 rounded-full" />
        ) : (
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/30 text-[11px] font-bold text-emerald-100">
            {(session.user.name || '?').slice(0, 1)}
          </span>
        )}
        <span className="min-w-0 leading-tight">
          <span className="block text-[8px] font-bold uppercase tracking-[0.16em] text-cyan-200/55">{t('common.account')}</span>
          <span className="block max-w-[120px] truncate text-[11px] text-white/85">{session.user.name || session.user.email}</span>
        </span>
        {cloudStatus === 'loading' || cloudStatus === 'saving' ? (
          <LoaderCircle className="h-3.5 w-3.5 animate-spin text-amber-300/80" />
        ) : cloudStatus === 'offline' || cloudStatus === 'error' ? (
          <CloudOff className="h-3.5 w-3.5 text-rose-300/80" />
        ) : (
          <Cloud className="h-3.5 w-3.5 text-emerald-300/80" />
        )}
        <button
          type="button"
          onClick={() => void signOut()}
          className="rounded-full p-1 text-white/40 transition hover:bg-white/10 hover:text-white/80"
          title={t('common.signOut')}
          aria-label={t('common.signOut')}
        >
          <LogOut className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  // Credentials not set yet → don't throw the raw "Server error"; explain instead.
  if (googleReady === false) {
    return (
      <div
        className="fixed right-4 top-4 z-[52] flex items-center gap-1.5 rounded-full border border-amber-400/30 bg-[#0a0818]/85 px-3 py-1.5 text-[12px] font-semibold text-amber-200/90 backdrop-blur-md"
        title={t('common.localMode')}
      >
        <Settings className="h-3.5 w-3.5" /> {t('common.account')}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        reachGoal('login_google'); // цель Метрики: конверсия «вход»
        void signIn('google');
      }}
      title={t('common.signIn')}
      className="fixed right-4 top-4 z-[52] flex items-center gap-1.5 rounded-full border border-cyan-400/30 bg-[#0a0818]/85 px-3 py-1.5 text-[12px] font-semibold text-cyan-100 backdrop-blur-md transition hover:bg-cyan-400/10"
    >
      <LogIn className="h-3.5 w-3.5" /> {t('common.signIn')}
    </button>
  );
}
