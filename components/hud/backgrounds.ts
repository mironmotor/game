// Background presets for the adaptive HUD. Each preset is a pure CSS value so it
// works fully offline (no external services beyond the optional Unsplash image,
// which degrades gracefully to the gradient underneath). Designed to read well
// behind translucent windows — and, in the future, as a transparent layer on
// the GAME AR glasses where `space` (pure black) lets the real world show.

export interface HudBackground {
  id: string;
  label: string;
  /** Applied to the .hud-bg layer as `background`. */
  css: string;
  /** Extra dimming so windows stay readable; 0..1. */
  scrim?: number;
}

export const HUD_BACKGROUNDS: HudBackground[] = [
  {
    id: 'aurora',
    label: 'Аврора',
    css: 'radial-gradient(120% 120% at 20% 0%, #1e1b4b 0%, #0b1026 45%, #04060f 100%)',
    scrim: 0.32,
  },
  {
    id: 'nebula',
    label: 'Туманность',
    css: 'radial-gradient(90% 90% at 80% 10%, #3b0764 0%, #1e1b4b 40%, #060818 100%)',
    scrim: 0.3,
  },
  {
    id: 'cyber',
    label: 'Кибер',
    css: 'linear-gradient(135deg, #04111f 0%, #07203a 40%, #0a0a2a 100%)',
    scrim: 0.28,
  },
  {
    id: 'sunset',
    label: 'Закат',
    css: 'linear-gradient(160deg, #2a1140 0%, #6d1d4b 45%, #1a0a2a 100%)',
    scrim: 0.34,
  },
  {
    id: 'space',
    label: 'Космос (AR)',
    css: '#000000',
    scrim: 0,
  },
];

// Стартовый фон — туманность: он подложка под солнечную систему, а не
// самостоятельная картинка, и не спорит с планетами.
export const DEFAULT_BACKGROUND_ID = 'nebula';

/**
 * Непубличные пресеты. В списке «Облик» их нет и перебором кнопки они не
 * попадаются — их можно поставить только назвав по имени (в терминале `/bg
 * майами`, голосом или из панели вида). Так снимок с дайвером остаётся
 * доступным лично, но перестаёт быть первым, что видит незнакомый человек.
 */
export const PRIVATE_BACKGROUNDS: HudBackground[] = [
  {
    id: 'miami',
    label: 'Майами (лично)',
    css: "center / cover no-repeat url('https://images.unsplash.com/photo-1544551763-46a013bb70d5?w=1920&q=80'), linear-gradient(160deg, #0b0820, #140f2d)",
    scrim: 0.5,
  },
];

// «Сон» — a procedurally generated wallpaper (dream-canvas.ts) stored locally
// as a data-URL. Not in the preset list: it's dynamic, one slot, regenerated
// at will. Fully offline.
export const DREAM_BACKGROUND_ID = 'dream';
const DREAM_KEY = 'max17_dream_bg';

export function saveDreamBackground(dataUrl: string): boolean {
  try {
    localStorage.setItem(DREAM_KEY, dataUrl);
    return true;
  } catch {
    return false; // quota/private mode — caller falls back gracefully
  }
}

export function loadDreamBackground(): string | null {
  try {
    return localStorage.getItem(DREAM_KEY);
  } catch {
    return null;
  }
}

/**
 * «Своя» — картинка, которую человек поставил сам: ссылкой, файлом или из
 * поиска по свободному стоку. Как и «Сон», это один слот вне списка пресетов:
 * пресеты — часть продукта, а этот фон принадлежит конкретному человеку и
 * дальше его браузера не уходит.
 */
export const CUSTOM_BACKGROUND_ID = 'custom';
const CUSTOM_KEY = 'max17_custom_bg';

export interface CustomBackground {
  /** http(s)-ссылка или data-URL загруженного файла. */
  url: string;
  /** Кого благодарить за снимок — у свободных лицензий это обязательное условие. */
  credit?: string;
  /** Страница источника, чтобы ссылку можно было проверить. */
  source?: string;
}

export function saveCustomBackground(value: CustomBackground): boolean {
  try {
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(value));
    return true;
  } catch {
    return false; // переполненное хранилище или приватный режим
  }
}

export function loadCustomBackground(): CustomBackground | null {
  try {
    const raw = localStorage.getItem(CUSTOM_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CustomBackground;
    return typeof parsed?.url === 'string' && parsed.url ? parsed : null;
  } catch {
    return null;
  }
}

export function getBackground(id: string | undefined): HudBackground {
  if (id === CUSTOM_BACKGROUND_ID && typeof window !== 'undefined') {
    const custom = loadCustomBackground();
    if (custom) {
      // Строку с кавычкой, пробелом или обратным слэшем отбрасываем: она
      // разорвала бы `url('…')` и стала бы инъекцией стиля. Скобки безопасны
      // внутри кавычек и в именах файлов Викисклада встречаются постоянно.
      const safe = /["'\s\\]/.test(custom.url) ? '' : custom.url;
      if (safe) {
        return {
          id: CUSTOM_BACKGROUND_ID,
          label: 'Своя',
          css: `center / cover no-repeat url('${safe}'), #05030f`,
          scrim: 0.42,
        };
      }
    }
  }
  if (id === DREAM_BACKGROUND_ID && typeof window !== 'undefined') {
    const dataUrl = loadDreamBackground();
    if (dataUrl) {
      return {
        id: DREAM_BACKGROUND_ID,
        label: 'Сон',
        css: `center / cover no-repeat url('${dataUrl}'), #05030f`,
        scrim: 0.3,
      };
    }
  }
  return (
    HUD_BACKGROUNDS.find((b) => b.id === id) ??
    PRIVATE_BACKGROUNDS.find((b) => b.id === id) ??
    HUD_BACKGROUNDS[0]
  );
}

export function nextBackgroundId(currentId: string | undefined): string {
  const idx = HUD_BACKGROUNDS.findIndex((b) => b.id === currentId);
  const next = HUD_BACKGROUNDS[(idx + 1 + HUD_BACKGROUNDS.length) % HUD_BACKGROUNDS.length];
  return next.id;
}

/** Match a free-text background name (RU/EN) to a preset id, or null. */
export function matchBackgroundId(text: string): string | null {
  const t = text.toLowerCase();
  const aliases: Record<string, string[]> = {
    miami: ['майами', 'miami', 'город', 'city', 'пляж', 'beach'],
    aurora: ['аврор', 'aurora', 'сияни', 'фиолет', 'purple'],
    nebula: ['туманн', 'nebula', 'галакт', 'galaxy'],
    cyber: ['кибер', 'cyber', 'син', 'blue', 'неон', 'neon'],
    sunset: ['закат', 'sunset', 'розов', 'pink', 'тепл', 'warm'],
    space: ['космос', 'space', 'чёрн', 'черн', 'black', 'тёмн', 'темн', 'dark', 'ar', 'очки', 'glasses'],
    dream: ['сон', 'сны', 'dream', 'подсознан', 'полотно', 'образ'],
  };
  for (const [id, words] of Object.entries(aliases)) {
    if (words.some((w) => t.includes(w))) return id;
  }
  return null;
}
