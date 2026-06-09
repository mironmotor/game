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
    id: 'miami',
    label: 'Майами',
    css: "center / cover no-repeat url('https://images.unsplash.com/photo-1544551763-46a013bb70d5?w=1920&q=80'), linear-gradient(160deg, #0b0820, #140f2d)",
    scrim: 0.5,
  },
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

export const DEFAULT_BACKGROUND_ID = 'miami';

export function getBackground(id: string | undefined): HudBackground {
  return HUD_BACKGROUNDS.find((b) => b.id === id) ?? HUD_BACKGROUNDS[0];
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
  };
  for (const [id, words] of Object.entries(aliases)) {
    if (words.some((w) => t.includes(w))) return id;
  }
  return null;
}
