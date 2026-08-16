/**
 * Облик Макса — то, как агент выглядит, а не то, как он устроен.
 *
 * Конфиг лежит отдельно от рисования: одну и ту же настройку читают студия
 * (/agent), сон (/quantum) и HUD. Поэтому здесь только данные и правила их
 * проверки — ни одного обращения к canvas.
 *
 * Хранится в localStorage. Сервер про облик не знает: это личная настройка,
 * гонять её через сеть незачем, а без неё интерфейс должен работать — отсюда
 * defaults и терпимый к мусору `sanitize`.
 */

export type CoreShape = 'orb' | 'crystal' | 'ring' | 'swarm' | 'column';
export type EyeKind = 'single' | 'pair' | 'triad' | 'visor' | 'none';
export type AuraKind = 'calm' | 'pulse' | 'storm' | 'halo' | 'none';
export type Temper = 'спокойный' | 'острый' | 'тёплый' | 'хищный';

export interface AvatarConfig {
  name: string;
  shape: CoreShape;
  eyes: EyeKind;
  aura: AuraKind;
  /** Основной тон, 0..360 по кругу HSL. */
  hue: number;
  /** Второй тон для бликов и ауры. */
  accent: number;
  /** Плотность частиц вокруг ядра, 0..1. */
  density: number;
  /** Скорость жизни: дыхание, вращение, моргание. 0.2..2. */
  tempo: number;
  /** Насколько ядро разваливается на части. 0 — монолит, 1 — рой. */
  chaos: number;
  temper: Temper;
}

export const SHAPES: { id: CoreShape; label: string; hint: string }[] = [
  { id: 'orb', label: 'Сфера', hint: 'ядро из вложенных колец' },
  { id: 'crystal', label: 'Кристалл', hint: 'грани, жёсткий блик' },
  { id: 'ring', label: 'Кольцо', hint: 'тор, пустой центр' },
  { id: 'swarm', label: 'Рой', hint: 'облако точек без оболочки' },
  { id: 'column', label: 'Столп', hint: 'вертикальная спираль' },
];

export const EYES: { id: EyeKind; label: string }[] = [
  { id: 'single', label: 'Один глаз' },
  { id: 'pair', label: 'Пара' },
  { id: 'triad', label: 'Триада' },
  { id: 'visor', label: 'Визор' },
  { id: 'none', label: 'Без глаз' },
];

export const AURAS: { id: AuraKind; label: string }[] = [
  { id: 'calm', label: 'Ровная' },
  { id: 'pulse', label: 'Пульс' },
  { id: 'storm', label: 'Шторм' },
  { id: 'halo', label: 'Нимб' },
  { id: 'none', label: 'Нет' },
];

export const TEMPERS: Temper[] = ['спокойный', 'острый', 'тёплый', 'хищный'];

export const DEFAULT_AVATAR: AvatarConfig = {
  name: 'MAX',
  shape: 'orb',
  eyes: 'single',
  aura: 'calm',
  hue: 188,
  accent: 285,
  density: 0.55,
  tempo: 1,
  chaos: 0.25,
  temper: 'спокойный',
};

/** Готовые обличья — чтобы не крутить восемь ползунков ради первого впечатления. */
export const PRESETS: { id: string; label: string; config: AvatarConfig }[] = [
  {
    id: 'core',
    label: 'Ядро',
    config: { ...DEFAULT_AVATAR },
  },
  {
    id: 'nova',
    label: 'Новая',
    config: { name: 'NOVA', shape: 'crystal', eyes: 'triad', aura: 'halo', hue: 42, accent: 12, density: 0.7, tempo: 0.8, chaos: 0.15, temper: 'тёплый' },
  },
  {
    id: 'void',
    label: 'Пустота',
    config: { name: 'VOID', shape: 'ring', eyes: 'visor', aura: 'storm', hue: 268, accent: 320, density: 0.85, tempo: 1.4, chaos: 0.6, temper: 'хищный' },
  },
  {
    id: 'swarm',
    label: 'Рой',
    config: { name: 'HIVE', shape: 'swarm', eyes: 'none', aura: 'pulse', hue: 145, accent: 190, density: 1, tempo: 1.7, chaos: 0.9, temper: 'острый' },
  },
  {
    id: 'monolith',
    label: 'Столп',
    config: { name: 'STELA', shape: 'column', eyes: 'pair', aura: 'calm', hue: 205, accent: 245, density: 0.35, tempo: 0.6, chaos: 0.1, temper: 'спокойный' },
  },
];

const KEY = 'max17:avatar';

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

/**
 * Привести что угодно к рабочему конфигу.
 *
 * Терпимость здесь не лень: в localStorage может лежать конфиг от прошлой
 * версии, где не было половины полей. Падать из-за этого интерфейс не должен —
 * недостающее просто берётся из умолчаний.
 */
export function sanitize(raw: unknown): AvatarConfig {
  const d = DEFAULT_AVATAR;
  if (!raw || typeof raw !== 'object') return { ...d };
  const o = raw as Record<string, unknown>;
  const name = String(o.name ?? d.name).trim().slice(0, 16) || d.name;
  return {
    name,
    shape: pick(o.shape, SHAPES.map((s) => s.id), d.shape),
    eyes: pick(o.eyes, EYES.map((e) => e.id), d.eyes),
    aura: pick(o.aura, AURAS.map((a) => a.id), d.aura),
    hue: Math.round(clamp(o.hue, 0, 360, d.hue)) % 360,
    accent: Math.round(clamp(o.accent, 0, 360, d.accent)) % 360,
    density: clamp(o.density, 0, 1, d.density),
    tempo: clamp(o.tempo, 0.2, 2, d.tempo),
    chaos: clamp(o.chaos, 0, 1, d.chaos),
    temper: pick(o.temper, TEMPERS, d.temper),
  };
}

export function loadAvatar(): AvatarConfig {
  if (typeof window === 'undefined') return { ...DEFAULT_AVATAR };
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? sanitize(JSON.parse(raw)) : { ...DEFAULT_AVATAR };
  } catch {
    return { ...DEFAULT_AVATAR };
  }
}

export function saveAvatar(config: AvatarConfig): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(sanitize(config)));
    window.dispatchEvent(new CustomEvent('max17:avatar', { detail: config }));
  } catch {
    // Приватный режим или переполненное хранилище — облик просто не переживёт
    // перезагрузку. Ронять из-за этого страницу нельзя.
  }
}

/** Случайный облик — быстрый способ увидеть, на что вообще способны настройки. */
export function randomAvatar(): AvatarConfig {
  const r = () => Math.random();
  const names = ['MAX', 'ORB', 'NYX', 'ZERO', 'ECHO', 'IRIS', 'KORE', 'ATLAS'];
  return sanitize({
    name: names[Math.floor(r() * names.length)],
    shape: SHAPES[Math.floor(r() * SHAPES.length)].id,
    eyes: EYES[Math.floor(r() * EYES.length)].id,
    aura: AURAS[Math.floor(r() * AURAS.length)].id,
    hue: Math.floor(r() * 360),
    accent: Math.floor(r() * 360),
    density: 0.2 + r() * 0.8,
    tempo: 0.5 + r() * 1.2,
    chaos: r(),
    temper: TEMPERS[Math.floor(r() * TEMPERS.length)],
  });
}

/** Цвета облика одной строкой — чтобы страницы не пересчитывали HSL руками. */
export function palette(config: AvatarConfig) {
  const { hue, accent } = config;
  return {
    main: `hsl(${hue} 100% 62%)`,
    mainSoft: `hsl(${hue} 100% 62% / 0.18)`,
    mainGlow: `hsl(${hue} 100% 70% / 0.55)`,
    accent: `hsl(${accent} 100% 66%)`,
    accentSoft: `hsl(${accent} 100% 66% / 0.2)`,
    deep: `hsl(${hue} 60% 6%)`,
  };
}

/**
 * Темперамент влияет на движение, а не только на подпись под аватаром.
 * Иначе выбор был бы косметикой, а он должен быть заметен глазом.
 */
export function temperFactors(temper: Temper): { speed: number; jitter: number; sharpness: number } {
  switch (temper) {
    case 'острый':
      return { speed: 1.35, jitter: 1.6, sharpness: 1.5 };
    case 'тёплый':
      return { speed: 0.8, jitter: 0.6, sharpness: 0.7 };
    case 'хищный':
      return { speed: 1.15, jitter: 1.1, sharpness: 1.9 };
    default:
      return { speed: 1, jitter: 1, sharpness: 1 };
  }
}
