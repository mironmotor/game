/**
 * HUD themes — five visual personalities for Max.
 *
 * hud.css paints all chrome (windows, glows, bars, dock) through CSS variables
 * declared on `.hud-root`, so a theme is just a variable override set. We inject
 * it at runtime as a <style> tag appended to <head> (after the bundled CSS, so
 * it wins the cascade) and mirror the vars on <html> for floating panels that
 * live outside `.hud-root`. Persisted in localStorage — fully offline.
 */

export interface HudTheme {
  id: string;
  label: string;
  /** Three swatch colors shown in the picker: accent / secondary / hot. */
  swatch: [string, string, string];
  /** CSS variable overrides applied to .hud-root (and :root). */
  vars: Record<string, string>;
  /** Background preset that pairs well; applied on switch unless a dream is set. */
  background: string;
  /** Palette hues (deg) used by the dream-canvas generator. */
  dreamHues: number[];
}

export const HUD_THEMES: HudTheme[] = [
  {
    id: 'neon',
    label: 'Неон',
    swatch: ['#00f2ff', '#a855f7', '#d946ef'],
    vars: {}, // the hud.css defaults ARE the neon theme
    background: 'miami',
    dreamHues: [190, 270, 310],
  },
  {
    id: 'core',
    label: 'Пурпур ядра',
    swatch: ['#c084fc', '#a855f7', '#f472b6'],
    vars: {
      '--hud-cyan': '#c084fc',
      '--hud-purple': '#a855f7',
      '--hud-magenta': '#f472b6',
      '--hud-border': 'rgba(192, 132, 252, 0.26)',
      '--hud-bg': 'rgba(24, 12, 48, 0.8)',
      '--hud-glow-cyan': '0 0 24px rgba(192, 132, 252, 0.28)',
      '--hud-glow-purple': '0 0 28px rgba(232, 121, 249, 0.35)',
    },
    background: 'nebula',
    dreamHues: [265, 285, 320],
  },
  {
    id: 'amber',
    label: 'Янтарь',
    swatch: ['#ffb648', '#ff8a3d', '#ff5e62'],
    vars: {
      '--hud-cyan': '#ffb648',
      '--hud-purple': '#ff8a3d',
      '--hud-magenta': '#ff5e62',
      '--hud-border': 'rgba(255, 182, 72, 0.24)',
      '--hud-bg': 'rgba(34, 18, 6, 0.78)',
      '--hud-glow-cyan': '0 0 24px rgba(255, 182, 72, 0.24)',
      '--hud-glow-purple': '0 0 28px rgba(255, 94, 98, 0.3)',
    },
    background: 'sunset',
    dreamHues: [30, 18, 350],
  },
  {
    id: 'ghost',
    label: 'Призрак',
    swatch: ['#e2e8f0', '#94a3b8', '#cbd5e1'],
    vars: {
      '--hud-cyan': '#e2e8f0',
      '--hud-purple': '#94a3b8',
      '--hud-magenta': '#cbd5e1',
      '--hud-border': 'rgba(226, 232, 240, 0.2)',
      '--hud-bg': 'rgba(10, 12, 18, 0.82)',
      '--hud-glow-cyan': '0 0 22px rgba(226, 232, 240, 0.16)',
      '--hud-glow-purple': '0 0 26px rgba(148, 163, 184, 0.2)',
    },
    background: 'space',
    dreamHues: [220, 210, 240],
  },
  {
    id: 'matrix',
    label: 'Матрица',
    swatch: ['#22ff88', '#16a34a', '#a3e635'],
    vars: {
      '--hud-cyan': '#22ff88',
      '--hud-purple': '#16a34a',
      '--hud-magenta': '#a3e635',
      '--hud-border': 'rgba(34, 255, 136, 0.22)',
      '--hud-bg': 'rgba(4, 24, 12, 0.8)',
      '--hud-glow-cyan': '0 0 24px rgba(34, 255, 136, 0.24)',
      '--hud-glow-purple': '0 0 28px rgba(163, 230, 53, 0.28)',
    },
    background: 'space',
    dreamHues: [140, 110, 160],
  },
];

export const DEFAULT_THEME_ID = 'neon';
const THEME_KEY = 'max17_hud_theme';
const STYLE_TAG_ID = 'max17-theme-vars';

export function getTheme(id: string | undefined | null): HudTheme {
  return HUD_THEMES.find((t) => t.id === id) ?? HUD_THEMES[0];
}

export function loadThemeId(): string {
  try {
    return localStorage.getItem(THEME_KEY) || DEFAULT_THEME_ID;
  } catch {
    return DEFAULT_THEME_ID;
  }
}

/** Inject/replace the runtime override stylesheet and persist the choice. */
export function applyTheme(id: string): HudTheme {
  const theme = getTheme(id);
  if (typeof document !== 'undefined') {
    const lines = Object.entries(theme.vars)
      .map(([k, v]) => `${k}: ${v};`)
      .join(' ');
    let tag = document.getElementById(STYLE_TAG_ID) as HTMLStyleElement | null;
    if (!tag) {
      tag = document.createElement('style');
      tag.id = STYLE_TAG_ID;
      document.head.appendChild(tag);
    }
    // .hud-root for the dashboard chrome, :root for floating panels outside it.
    tag.textContent = lines ? `:root, .hud-root { ${lines} }` : '';
  }
  try {
    localStorage.setItem(THEME_KEY, theme.id);
  } catch {
    /* private mode */
  }
  return theme;
}

/** Restore the persisted theme on app mount. Returns the active theme. */
export function initTheme(): HudTheme {
  return applyTheme(loadThemeId());
}

/** Match free text (RU/EN) to a theme id, or null — for voice commands. */
export function matchThemeId(text: string): string | null {
  const t = text.toLowerCase();
  const aliases: Record<string, string[]> = {
    neon: ['неон', 'neon', 'циан', 'cyan', 'обычн', 'стандарт'],
    core: ['пурпур', 'фиолет', 'ядр', 'core', 'purple', 'violet'],
    amber: ['янтар', 'amber', 'оранж', 'тёпл', 'тепл', 'orange'],
    ghost: ['призрак', 'ghost', 'бел', 'сер', 'моно', 'white', 'mono'],
    matrix: ['матриц', 'matrix', 'зелён', 'зелен', 'green'],
  };
  for (const [id, words] of Object.entries(aliases)) {
    if (words.some((w) => t.includes(w))) return id;
  }
  return null;
}
