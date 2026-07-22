'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

// Минимальная типизация Telegram WebApp SDK (то, что реально используем).
interface TgMainButton {
  text: string;
  show(): void;
  hide(): void;
  enable(): void;
  disable(): void;
  showProgress(leaveActive?: boolean): void;
  hideProgress(): void;
  setText(text: string): void;
  setParams(p: { text?: string; color?: string; text_color?: string; is_active?: boolean; is_visible?: boolean }): void;
  onClick(cb: () => void): void;
  offClick(cb: () => void): void;
}

interface TgHaptic {
  impactOccurred(style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft'): void;
  notificationOccurred(type: 'error' | 'success' | 'warning'): void;
  selectionChanged(): void;
}

interface TgUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export interface TgWebApp {
  ready(): void;
  expand(): void;
  close(): void;
  colorScheme: 'light' | 'dark';
  themeParams: Record<string, string>;
  viewportHeight: number;
  isExpanded: boolean;
  MainButton: TgMainButton;
  HapticFeedback?: TgHaptic;
  initDataUnsafe?: { user?: TgUser };
  setHeaderColor?(color: string): void;
  setBackgroundColor?(color: string): void;
  onEvent?(type: string, cb: () => void): void;
}

const SDK_URL = 'https://telegram.org/js/telegram-web-app.js';

export function useTelegram() {
  const [webApp, setWebApp] = useState<TgWebApp | null>(null);
  const [ready, setReady] = useState(false); // хук отработал (в Telegram или нет)
  const [inTelegram, setInTelegram] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const init = (wa: TgWebApp) => {
      if (cancelled) return;
      try {
        wa.ready();
        wa.expand();
        wa.setHeaderColor?.('#0a0818');
        wa.setBackgroundColor?.('#0a0818');
      } catch {
        /* вне Telegram методы могут кидать — не критично */
      }
      setWebApp(wa);
      setInTelegram(true);
      setReady(true);
    };

    const existing = (window as unknown as { Telegram?: { WebApp?: TgWebApp } }).Telegram?.WebApp;
    if (existing && existing.initDataUnsafe) {
      init(existing);
      return;
    }

    const script = document.createElement('script');
    script.src = SDK_URL;
    script.async = true;
    script.onload = () => {
      const wa = (window as unknown as { Telegram?: { WebApp?: TgWebApp } }).Telegram?.WebApp;
      // Реальный Telegram даёт initDataUnsafe с user; в обычном браузере — пусто.
      if (wa && wa.initDataUnsafe && Object.keys(wa.initDataUnsafe).length > 0) {
        init(wa);
      } else {
        setReady(true); // открыто вне Telegram — работаем как обычный сайт
      }
    };
    script.onerror = () => setReady(true);
    document.head.appendChild(script);

    return () => {
      cancelled = true;
    };
  }, []);

  const haptic = useCallback(
    (kind: 'light' | 'medium' | 'success' | 'error' = 'light') => {
      const h = webApp?.HapticFeedback;
      if (!h) return;
      try {
        if (kind === 'success') h.notificationOccurred('success');
        else if (kind === 'error') h.notificationOccurred('error');
        else h.impactOccurred(kind);
      } catch {
        /* no-op */
      }
    },
    [webApp],
  );

  const user = webApp?.initDataUnsafe?.user ?? null;

  return { webApp, ready, inTelegram, user, haptic };
}

// Управление нативной кнопкой Telegram (MainButton) с подпиской на клик.
export function useMainButton(
  webApp: TgWebApp | null,
  text: string,
  onClick: () => void,
  { visible = true, active = true, progress = false }: { visible?: boolean; active?: boolean; progress?: boolean } = {},
) {
  const cbRef = useRef(onClick);
  cbRef.current = onClick;

  useEffect(() => {
    const mb = webApp?.MainButton;
    if (!mb) return;
    const handler = () => cbRef.current();
    mb.setParams({ text, color: '#7a5cff', text_color: '#ffffff', is_visible: visible, is_active: active });
    if (progress) mb.showProgress(true);
    else mb.hideProgress();
    mb.onClick(handler);
    return () => {
      mb.offClick(handler);
    };
  }, [webApp, text, visible, active, progress]);
}
