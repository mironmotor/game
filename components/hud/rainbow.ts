/**
 * Переключатель радужного режима.
 *
 * Состояние живёт в атрибуте `data-rainbow` на <html> и в localStorage: вся
 * анимация — на стороне CSS, здесь только флаг. Поэтому включение стоит ровно
 * одну запись в DOM и не трогает рендер React.
 */

const STORAGE_KEY = 'max.rainbow';
const EVENT = 'rainbow:changed';

export function isRainbowOn(): boolean {
  if (typeof document === 'undefined') return false;
  return document.documentElement.dataset.rainbow === 'on';
}

export function setRainbow(on: boolean): void {
  if (typeof document === 'undefined') return;
  if (on) {
    document.documentElement.dataset.rainbow = 'on';
  } else {
    delete document.documentElement.dataset.rainbow;
  }
  try {
    localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off');
  } catch {
    // Приватный режим или запрет хранилища — режим просто не переживёт вкладку.
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { on } }));
}

export function toggleRainbow(): boolean {
  const next = !isRainbowOn();
  setRainbow(next);
  return next;
}

/** Восстановить выбор при загрузке. Вызывается один раз из HUD. */
export function initRainbow(): void {
  if (typeof document === 'undefined') return;
  try {
    if (localStorage.getItem(STORAGE_KEY) === 'on') setRainbow(true);
  } catch {
    // Нет доступа к хранилищу — стартуем в обычном режиме.
  }
}

export const RAINBOW_EVENT = EVENT;
