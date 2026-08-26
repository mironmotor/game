/**
 * Режим сцены — что именно рисуется за интерфейсом.
 *
 * Раньше выбора не было: `GameHud` складывал стопкой обои → солнечную систему →
 * землю мира → сканлайны, и всё это жило на экране одновременно. Два независимых
 * 3D-слоя с разными камерами накладывались друг на друга без общей глубины, из-за
 * чего Сатурн повисал между монолитами графа, а Луна выглядывала из-за башни ядра.
 * Красиво, но нечитаемо — и вдвое дороже по кадрам.
 *
 * Теперь слои выбираются режимом, а не копятся. Источник правды один, живёт вне
 * React (localStorage + событие), поэтому его одинаково видят и панель «Вид», и
 * кнопка «Мир 3D» в доке, и сами слои.
 */

export type SceneMode = 'all' | 'world' | 'sky' | 'quiet';

export interface SceneModeEntry {
  id: SceneMode;
  label: string;
  hint: string;
}

export const SCENE_MODES: SceneModeEntry[] = [
  { id: 'all', label: 'Всё', hint: 'Земля меты, небо уходит в глубину' },
  { id: 'world', label: 'Мир', hint: 'Только земля: ядро, концепты, миссии' },
  { id: 'sky', label: 'Небо', hint: 'Только солнечная система' },
  { id: 'quiet', label: 'Тихо', hint: 'Без 3D — обои и окна' },
];

const KEY = 'max17_scene_mode';
const EVENT = 'scene:mode';
const DEFAULT: SceneMode = 'all';

// Запасной путь для приватного режима, где localStorage бросает исключение.
let memory: SceneMode | null = null;

function isMode(value: unknown): value is SceneMode {
  return value === 'all' || value === 'world' || value === 'sky' || value === 'quiet';
}

export function getSceneMode(): SceneMode {
  if (memory !== null) return memory;
  if (typeof window === 'undefined') return DEFAULT;
  try {
    const stored = localStorage.getItem(KEY);
    // Наследство: до режимов землю выключали ключом max17_hud_world.
    if (!stored) return localStorage.getItem('max17_hud_world') === '0' ? 'sky' : DEFAULT;
    return isMode(stored) ? stored : DEFAULT;
  } catch {
    return DEFAULT;
  }
}

export function setSceneMode(mode: SceneMode): void {
  if (!isMode(mode)) return;
  memory = mode;
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    /* приватный режим — выбор живёт до конца вкладки */
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { mode } }));
}

export function subscribeSceneMode(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(EVENT, onChange);
  return () => window.removeEventListener(EVENT, onChange);
}

/** Небо и земля по режиму — единственное место, где это решается. */
export const hasGround = (mode: SceneMode): boolean => mode === 'all' || mode === 'world';
export const hasSky = (mode: SceneMode): boolean => mode === 'all' || mode === 'sky';
/** В общем кадре небо — задник: приглушается, чтобы не спорить с землёй. */
export const skyRecessed = (mode: SceneMode): boolean => mode === 'all';

/**
 * Кнопка «Мир 3D» в доке осталась как была — она просто убирает и возвращает
 * землю, переключая режим между «Всё» и «Небо» (или «Мир» ↔ «Тихо», если небо
 * уже выключено). Старый обработчик `world:toggle` заменять на новый UI не нужно.
 */
export function toggleGround(): void {
  const mode = getSceneMode();
  if (mode === 'all') setSceneMode('sky');
  else if (mode === 'sky') setSceneMode('all');
  else if (mode === 'world') setSceneMode('quiet');
  else setSceneMode('world');
}
