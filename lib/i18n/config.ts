export type TextDirection = 'ltr' | 'rtl';

export interface LanguageOption {
  code: string;
  nativeName: string;
  englishName: string;
}

export const DEFAULT_LOCALE = 'en';
export const LOCALE_COOKIE = 'game_locale';
export const LOCALE_STORAGE_KEY = 'game_locale_preference';

// The locale core accepts every valid BCP-47 tag. This list is the friendly
// picker, not a closed allow-list, and covers the languages most people will
// expect to find without having to type a locale manually.
export const WORLD_LANGUAGES: readonly LanguageOption[] = [
  { code: 'ar', nativeName: 'العربية', englishName: 'Arabic' },
  { code: 'bn', nativeName: 'বাংলা', englishName: 'Bengali' },
  { code: 'bg', nativeName: 'Български', englishName: 'Bulgarian' },
  { code: 'ca', nativeName: 'Català', englishName: 'Catalan' },
  { code: 'zh-Hans', nativeName: '简体中文', englishName: 'Chinese (Simplified)' },
  { code: 'zh-Hant', nativeName: '繁體中文', englishName: 'Chinese (Traditional)' },
  { code: 'hr', nativeName: 'Hrvatski', englishName: 'Croatian' },
  { code: 'cs', nativeName: 'Čeština', englishName: 'Czech' },
  { code: 'da', nativeName: 'Dansk', englishName: 'Danish' },
  { code: 'nl', nativeName: 'Nederlands', englishName: 'Dutch' },
  { code: 'en', nativeName: 'English', englishName: 'English' },
  { code: 'et', nativeName: 'Eesti', englishName: 'Estonian' },
  { code: 'fa', nativeName: 'فارسی', englishName: 'Persian' },
  { code: 'fi', nativeName: 'Suomi', englishName: 'Finnish' },
  { code: 'fr', nativeName: 'Français', englishName: 'French' },
  { code: 'de', nativeName: 'Deutsch', englishName: 'German' },
  { code: 'el', nativeName: 'Ελληνικά', englishName: 'Greek' },
  { code: 'he', nativeName: 'עברית', englishName: 'Hebrew' },
  { code: 'hi', nativeName: 'हिन्दी', englishName: 'Hindi' },
  { code: 'hu', nativeName: 'Magyar', englishName: 'Hungarian' },
  { code: 'id', nativeName: 'Bahasa Indonesia', englishName: 'Indonesian' },
  { code: 'it', nativeName: 'Italiano', englishName: 'Italian' },
  { code: 'ja', nativeName: '日本語', englishName: 'Japanese' },
  { code: 'ko', nativeName: '한국어', englishName: 'Korean' },
  { code: 'lv', nativeName: 'Latviešu', englishName: 'Latvian' },
  { code: 'lt', nativeName: 'Lietuvių', englishName: 'Lithuanian' },
  { code: 'ms', nativeName: 'Bahasa Melayu', englishName: 'Malay' },
  { code: 'no', nativeName: 'Norsk', englishName: 'Norwegian' },
  { code: 'pl', nativeName: 'Polski', englishName: 'Polish' },
  { code: 'pt', nativeName: 'Português', englishName: 'Portuguese' },
  { code: 'ro', nativeName: 'Română', englishName: 'Romanian' },
  { code: 'ru', nativeName: 'Русский', englishName: 'Russian' },
  { code: 'sr', nativeName: 'Српски', englishName: 'Serbian' },
  { code: 'sk', nativeName: 'Slovenčina', englishName: 'Slovak' },
  { code: 'sl', nativeName: 'Slovenščina', englishName: 'Slovenian' },
  { code: 'es', nativeName: 'Español', englishName: 'Spanish' },
  { code: 'sw', nativeName: 'Kiswahili', englishName: 'Swahili' },
  { code: 'sv', nativeName: 'Svenska', englishName: 'Swedish' },
  { code: 'th', nativeName: 'ไทย', englishName: 'Thai' },
  { code: 'tr', nativeName: 'Türkçe', englishName: 'Turkish' },
  { code: 'uk', nativeName: 'Українська', englishName: 'Ukrainian' },
  { code: 'ur', nativeName: 'اردو', englishName: 'Urdu' },
  { code: 'vi', nativeName: 'Tiếng Việt', englishName: 'Vietnamese' },
].sort((a, b) => a.englishName.localeCompare(b.englishName));

const RTL_LANGUAGES = new Set(['ar', 'dv', 'fa', 'he', 'ku', 'ps', 'ur', 'yi']);

export function canonicalizeLocale(value: unknown, fallback = DEFAULT_LOCALE): string {
  if (typeof value !== 'string') return fallback;
  const candidate = value.trim().replace(/_/g, '-').slice(0, 64);
  if (!candidate || !/^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*$/.test(candidate)) {
    return fallback;
  }
  try {
    return Intl.getCanonicalLocales(candidate)[0] || fallback;
  } catch {
    return fallback;
  }
}

export function baseLanguage(locale: string): string {
  return canonicalizeLocale(locale).split('-')[0].toLowerCase();
}

export function localeDirection(locale: string): TextDirection {
  return RTL_LANGUAGES.has(baseLanguage(locale)) ? 'rtl' : 'ltr';
}

export function parseAcceptLanguage(header: string | null | undefined): string[] {
  if (!header) return [];
  return header
    .split(',')
    .map((entry) => {
      const [tag, ...params] = entry.trim().split(';');
      const qParam = params.find((part) => part.trim().startsWith('q='));
      const quality = qParam ? Number(qParam.split('=')[1]) : 1;
      return { tag, quality: Number.isFinite(quality) ? quality : 0 };
    })
    .filter(({ tag, quality }) => tag !== '*' && quality > 0)
    .sort((a, b) => b.quality - a.quality)
    .map(({ tag }) => canonicalizeLocale(tag))
    .filter(Boolean);
}

export function languageName(locale: string, displayLocale = locale): string {
  const canonical = canonicalizeLocale(locale);
  try {
    return new Intl.DisplayNames([canonicalizeLocale(displayLocale)], { type: 'language' }).of(canonical) || canonical;
  } catch {
    return WORLD_LANGUAGES.find((item) => item.code === canonical)?.nativeName || canonical;
  }
}

const LATIN_LANGUAGE_WORDS: Record<string, readonly string[]> = {
  en: ['the', 'and', 'what', 'how', 'please', 'today', 'with', 'this', 'that', 'can'],
  es: ['el', 'la', 'que', 'como', 'por', 'para', 'con', 'hoy', 'una', 'puedes'],
  pt: ['o', 'a', 'que', 'como', 'por', 'para', 'com', 'hoje', 'uma', 'pode'],
  fr: ['le', 'la', 'que', 'comment', 'pour', 'avec', 'aujourd', 'une', 'vous', 'peux'],
  de: ['der', 'die', 'das', 'wie', 'und', 'für', 'mit', 'heute', 'eine', 'kann'],
  it: ['il', 'la', 'che', 'come', 'per', 'con', 'oggi', 'una', 'puoi', 'cosa'],
  tr: ['ve', 'bir', 'bu', 'nasıl', 'için', 'ile', 'bugün', 'ne', 'yap', 'lütfen'],
  id: ['dan', 'yang', 'apa', 'bagaimana', 'untuk', 'dengan', 'hari', 'bisa', 'tolong', 'ini'],
  pl: ['i', 'że', 'jak', 'dla', 'z', 'dzisiaj', 'co', 'możesz', 'proszę', 'ten'],
  nl: ['de', 'het', 'en', 'hoe', 'voor', 'met', 'vandaag', 'een', 'kan', 'wat'],
  vi: ['và', 'là', 'gì', 'như', 'cho', 'với', 'hôm', 'nay', 'có', 'thể'],
};

/**
 * Lightweight, private on-device language hinting. It intentionally returns the
 * fallback for short or ambiguous Latin text; MAX still performs semantic
 * language detection server-side.
 */
export function detectTextLocale(text: string, fallback = DEFAULT_LOCALE): string {
  const sample = text.trim().slice(0, 1000);
  if (sample.length < 2) return canonicalizeLocale(fallback);

  if (/[\u3040-\u30ff]/u.test(sample)) return 'ja';
  if (/[\uac00-\ud7af]/u.test(sample)) return 'ko';
  if (/[\u4e00-\u9fff]/u.test(sample)) return 'zh';
  if (/[\u0900-\u097f]/u.test(sample)) return 'hi';
  if (/[\u0980-\u09ff]/u.test(sample)) return 'bn';
  if (/[\u0e00-\u0e7f]/u.test(sample)) return 'th';
  if (/[\u0590-\u05ff]/u.test(sample)) return 'he';
  if (/[\u0600-\u06ff]/u.test(sample)) {
    if (/[پچژگ]/u.test(sample)) return 'fa';
    if (/[ٹڈڑںھہے]/u.test(sample)) return 'ur';
    return 'ar';
  }
  if (/[\u0400-\u04ff]/u.test(sample)) {
    if (/[іїєґ]/iu.test(sample)) return 'uk';
    return 'ru';
  }

  if (sample.length < 12) return canonicalizeLocale(fallback);
  if (/[ăâđêôơưạ-ỹ]/iu.test(sample)) return 'vi';
  if (/[ąćęłńśźż]/iu.test(sample)) return 'pl';
  if (/[ğışçöü]/iu.test(sample)) return 'tr';
  if (/[¿¡ñ]/iu.test(sample)) return 'es';
  if (/[ãõ]/iu.test(sample)) return 'pt';
  if (/[ßäöü]/iu.test(sample)) return 'de';
  if (/[àâæçéèêëîïôœùûÿ]/iu.test(sample)) return 'fr';

  const words = sample
    .toLocaleLowerCase()
    .replace(/[^\p{L}]+/gu, ' ')
    .trim()
    .split(/\s+/);
  let best = { locale: '', score: 0 };
  for (const [locale, markers] of Object.entries(LATIN_LANGUAGE_WORDS)) {
    const markerSet = new Set(markers);
    const score = words.reduce((total, word) => total + (markerSet.has(word) ? 1 : 0), 0);
    if (score > best.score) best = { locale, score };
  }
  return best.score >= 2 ? best.locale : canonicalizeLocale(fallback);
}
