import {
  canonicalizeLocale,
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  LOCALE_STORAGE_KEY,
} from './config';

export type LocalePreference = 'auto' | string;

let activeLocale = DEFAULT_LOCALE;
let conversationLocale = DEFAULT_LOCALE;
let initialized = false;

export function setActiveLocale(locale: string): string {
  activeLocale = canonicalizeLocale(locale);
  conversationLocale = activeLocale;
  initialized = true;
  return activeLocale;
}

export function getActiveLocale(): string {
  if (typeof window === 'undefined') return activeLocale;
  return initialized ? activeLocale : detectClientLocale();
}

export function setConversationLocale(locale: string): string {
  conversationLocale = canonicalizeLocale(locale, activeLocale);
  return conversationLocale;
}

export function getConversationLocale(): string {
  return initialized ? conversationLocale : getActiveLocale();
}

export function getStoredLocalePreference(): LocalePreference {
  if (typeof window === 'undefined') return 'auto';
  try {
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    return stored && stored !== 'auto' ? canonicalizeLocale(stored) : 'auto';
  } catch {
    return 'auto';
  }
}

function telegramLocale(): string | null {
  if (typeof window === 'undefined') return null;
  const telegram = (
    window as unknown as {
      Telegram?: { WebApp?: { initDataUnsafe?: { user?: { language_code?: string } } } };
    }
  ).Telegram;
  return telegram?.WebApp?.initDataUnsafe?.user?.language_code || null;
}

export function detectClientLocale(ignoreStoredPreference = false): string {
  if (typeof window === 'undefined') return activeLocale;

  const urlLocale = new URLSearchParams(window.location.search).get('lang');
  if (urlLocale) return canonicalizeLocale(urlLocale);

  if (!ignoreStoredPreference) {
    const stored = getStoredLocalePreference();
    if (stored !== 'auto') return canonicalizeLocale(stored);
  }

  const candidates = [
    telegramLocale(),
    ...(Array.isArray(navigator.languages) ? navigator.languages : []),
    navigator.language,
  ];
  const detected = candidates.find((candidate): candidate is string => Boolean(candidate?.trim()));
  return canonicalizeLocale(detected, activeLocale || DEFAULT_LOCALE);
}

export function persistLocalePreference(preference: LocalePreference, resolvedLocale: string): void {
  if (typeof window === 'undefined') return;
  const locale = canonicalizeLocale(resolvedLocale);
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, preference === 'auto' ? 'auto' : locale);
  } catch {
    // Storage can be blocked in private or embedded browser contexts.
  }
  document.cookie = `${LOCALE_COOKIE}=${encodeURIComponent(locale)}; Path=/; Max-Age=31536000; SameSite=Lax`;
}
