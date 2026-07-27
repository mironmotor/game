'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  canonicalizeLocale,
  detectTextLocale,
  localeDirection,
  WORLD_LANGUAGES,
  type TextDirection,
} from '@/lib/i18n/config';
import {
  detectClientLocale,
  getStoredLocalePreference,
  persistLocalePreference,
  setActiveLocale,
  setConversationLocale,
  type LocalePreference,
} from '@/lib/i18n/runtime';
import { getMessage, type MessageKey, type MessageParams } from '@/lib/i18n/messages';

interface I18nContextValue {
  locale: string;
  conversationLocale: string;
  direction: TextDirection;
  preference: LocalePreference;
  languages: typeof WORLD_LANGUAGES;
  setLocale: (locale: string | 'auto') => void;
  setAutomaticLocale: (locale: string) => void;
  adaptToText: (text: string) => string;
  t: (key: MessageKey, params?: MessageParams) => string;
  formatTime: (date: Date) => string;
  formatDate: (date: Date) => string;
  formatNumber: (value: number) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

function applyDocumentLocale(locale: string): void {
  const direction = localeDirection(locale);
  document.documentElement.lang = locale;
  document.documentElement.dir = direction;
  document.body.dataset.locale = locale;
  document.body.dataset.direction = direction;
}

export function I18nProvider({
  initialLocale,
  children,
}: {
  initialLocale: string;
  children: ReactNode;
}) {
  const serverLocale = canonicalizeLocale(initialLocale);
  const [locale, setLocaleState] = useState(serverLocale);
  const [conversationLocale, setConversationLocaleState] = useState(serverLocale);
  const [preference, setPreference] = useState<LocalePreference>('auto');

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const savedPreference = getStoredLocalePreference();
      const resolved = savedPreference === 'auto' ? detectClientLocale() : savedPreference;
      setPreference(savedPreference);
      setLocaleState(resolved);
      setActiveLocale(resolved);
      setConversationLocaleState(resolved);
      setConversationLocale(resolved);
      applyDocumentLocale(resolved);
      persistLocalePreference(savedPreference, resolved);
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const setLocale = useCallback((next: string | 'auto') => {
    const nextPreference: LocalePreference = next === 'auto' ? 'auto' : canonicalizeLocale(next);
    const resolved = nextPreference === 'auto' ? detectClientLocale(true) : nextPreference;
    setPreference(nextPreference);
    setLocaleState(resolved);
    setActiveLocale(resolved);
    setConversationLocaleState(resolved);
    setConversationLocale(resolved);
    applyDocumentLocale(resolved);
    persistLocalePreference(nextPreference, resolved);
    window.dispatchEvent(
      new CustomEvent('game:locale-change', {
        detail: { locale: resolved, preference: nextPreference },
      }),
    );
  }, []);

  const setAutomaticLocale = useCallback((next: string) => {
    const resolved = canonicalizeLocale(next);
    setPreference('auto');
    setLocaleState(resolved);
    setActiveLocale(resolved);
    setConversationLocaleState(resolved);
    setConversationLocale(resolved);
    applyDocumentLocale(resolved);
    persistLocalePreference('auto', resolved);
  }, []);

  const adaptToText = useCallback(
    (text: string) => {
      const detected = detectTextLocale(text, conversationLocale || locale);
      setConversationLocaleState(detected);
      setConversationLocale(detected);
      if (preference === 'auto' && detected !== locale) {
        setLocaleState(detected);
        setActiveLocale(detected);
        setConversationLocale(detected);
        applyDocumentLocale(detected);
        persistLocalePreference('auto', detected);
        window.dispatchEvent(
          new CustomEvent('game:locale-change', {
            detail: { locale: detected, preference: 'auto', source: 'conversation' },
          }),
        );
      }
      return detected;
    },
    [conversationLocale, locale, preference],
  );

  useEffect(() => {
    setActiveLocale(locale);
    applyDocumentLocale(locale);
  }, [locale]);

  const t = useCallback(
    (key: MessageKey, params?: MessageParams) => getMessage(locale, key, params),
    [locale],
  );

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      conversationLocale,
      direction: localeDirection(locale),
      preference,
      languages: WORLD_LANGUAGES,
      setLocale,
      setAutomaticLocale,
      adaptToText,
      t,
      formatTime: (date) =>
        new Intl.DateTimeFormat(locale, {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }).format(date),
      formatDate: (date) =>
        new Intl.DateTimeFormat(locale, {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
        }).format(date),
      formatNumber: (number) => new Intl.NumberFormat(locale).format(number),
    }),
    [adaptToText, conversationLocale, locale, preference, setAutomaticLocale, setLocale, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n must be used inside I18nProvider');
  return value;
}
