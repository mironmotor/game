'use client';

import { Languages } from 'lucide-react';
import { useI18n } from './I18nProvider';

export default function LanguageSwitcher() {
  const { locale, preference, languages, setLocale, t } = useI18n();

  return (
    <label
      className="fixed left-3 top-3 z-[52] flex max-w-[min(15rem,calc(100vw-1.5rem))] items-center gap-1.5 rounded-full border border-cyan-300/20 bg-[#080713]/90 px-2.5 py-1.5 text-cyan-50 shadow-[0_0_20px_rgba(0,242,255,0.08)] backdrop-blur-xl sm:left-4 sm:top-4"
      title={t('language.choose')}
    >
      <Languages className="h-3.5 w-3.5 shrink-0 text-cyan-300/80" aria-hidden />
      <span className="sr-only">{t('language.label')}</span>
      <select
        value={preference}
        onChange={(event) => setLocale(event.target.value)}
        className="min-w-0 max-w-[11.5rem] cursor-pointer appearance-none bg-transparent pr-1 text-[10px] font-semibold tracking-[0.08em] text-cyan-50 outline-none sm:text-[11px]"
        aria-label={t('language.choose')}
      >
        <option value="auto">{t('language.auto')} · {locale}</option>
        {languages.map((language) => (
          <option key={language.code} value={language.code} className="bg-[#0a0818] text-white">
            {language.nativeName} · {language.englishName}
          </option>
        ))}
      </select>
    </label>
  );
}
