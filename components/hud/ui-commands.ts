// Deterministic, offline interpreter that turns a chat / voice phrase into a HUD
// window-management command. It runs entirely on the client so it stays fast and
// keeps the Max17 JSON contract untouched — the same phrase is still forwarded to
// the cognitive core for memory, but the UI reacts immediately.

import { getBackground, matchBackgroundId } from './backgrounds';
import type { WindowId } from './window-manager';

export type CameraDir = 'left' | 'right' | 'up' | 'down' | 'center';

export type UiCommand =
  | { kind: 'open'; target: WindowId }
  | { kind: 'close'; target: WindowId }
  | { kind: 'toggle'; target: WindowId }
  | { kind: 'minimize'; target: WindowId }
  | { kind: 'background'; value: string }
  | { kind: 'reset' }
  | { kind: 'showAll' }
  | { kind: 'closeAll' }
  | { kind: 'camera'; action: 'open' | 'close' | 'toggle' | 'move'; dir?: CameraDir };

export interface InterpretedCommand {
  command: UiCommand;
  reply: string;
}

const WINDOW_DISPLAY: Record<WindowId, string> = {
  rank: 'ранг',
  clock: 'часы',
  missions: 'миссии',
  minimap: 'карту',
  status: 'статус системы',
  agi: 'AGI-панель',
  player: 'статус игрока',
  chat: 'чат',
  output: 'вывод',
};

// Ordered longest-first within each window; the matcher prefers the longest hit
// so "статус игрока" resolves to the player window, not the system status.
const WINDOW_ALIASES: Array<[WindowId, string[]]> = [
  ['missions', ['миссии', 'миссий', 'миссия', 'задани', 'задач', 'квест', 'mission', 'quest', 'task']],
  ['minimap', ['миникарт', 'карт', 'map', 'minimap']],
  ['player', ['статус игрок', 'игрок', 'профил', 'репутаци', 'энерг', 'player', 'profile']],
  ['status', ['статус систем', 'систем', 'jarvis', 'джарвис', 'status', 'статус']],
  ['output', ['вывод', 'output', 'консол', 'console', 'лог', ' log', 'ответ max', 'ответы']],
  ['chat', ['чат', 'chat', 'общени', 'ввод', 'сообщени']],
  ['agi', ['agi', 'ассистент', 'экстен', 'extension']],
  ['rank', ['ранг', 'рейтинг', 'rank', 'место в мире']],
  ['clock', ['время', 'час', 'clock', 'time']],
];

// Split into word tokens across Latin + Cyrillic + digits.
function tokenize(text: string): string[] {
  return text.split(/[^a-zа-яё0-9]+/i).filter(Boolean);
}

// An alias matches only at a WORD START (so the stem "час" matches "часы"/"часов"
// but never the middle of "сейчас"/"участие"). Multi-word aliases fall back to a
// plain substring test.
function aliasHit(tokens: string[], text: string, alias: string): boolean {
  if (alias.includes(' ')) return text.includes(alias);
  return tokens.some((token) => token.startsWith(alias));
}

function matchWindow(text: string, tokens: string[]): WindowId | null {
  let best: { id: WindowId; len: number } | null = null;
  for (const [id, aliases] of WINDOW_ALIASES) {
    for (const alias of aliases) {
      if (aliasHit(tokens, text, alias) && (!best || alias.length > best.len)) {
        best = { id, len: alias.length };
      }
    }
  }
  return best?.id ?? null;
}

const RE_BACKGROUND = /(фон|background|обои|wallpaper)/;
const RE_BG_NEXT = /(след|друг|смен|помен|переключ|next|анот)/;
const RE_RESET = /(сбрось|сброс|reset|умолчан|defaul)/;
const RE_CLOSE = /(закро|закры|убери|убрать|спрячь|спрят|скрой|скры|очист|hide|close)/;
const RE_OPEN = /(откро|откры|покажи|показать|верни|вернуть|выведи|show|open)/;
const RE_MIN = /(сверн|свёрн|minimize|collapse)/;
const RE_ALL = /(\bвсе\b|всё|\ball\b|everything|весь экран|экран|всё на экран)/;
const RE_LAYOUT = /(окн|распол|интерфейс|layout|hud|фон|настро)/;
// Camera is a sensor panel, not a managed window, so it has its own verbs
// (включи/выключи feel natural for a camera) and move directions.
const CAMERA_ALIASES = ['камер', 'camera', 'webcam', 'вебкам'];
const RE_CAM_OPEN = /(включ|запусти|врубай|врубить|открой|откро|покажи|show|open)/;
const RE_CAM_CLOSE = /(выключ|выруб|останов|стоп|закро|закры|убери|скрой|hide|close|off)/;
const RE_MOVE = /(подвинь|передвин|перемест|сдвин|двин|двигай|move)/;

function cameraDir(text: string): CameraDir {
  if (/(влев|left)/.test(text)) return 'left';
  if (/(вправ|right)/.test(text)) return 'right';
  if (/(вверх|наверх|сверху|вверху|up|top)/.test(text)) return 'up';
  if (/(вниз|внизу|снизу|down|bottom)/.test(text)) return 'down';
  return 'center';
}

const CAMERA_DIR_RU: Record<CameraDir, string> = {
  left: 'влево',
  right: 'вправо',
  up: 'вверх',
  down: 'вниз',
  center: 'в центр',
};

// A genuine HUD command is a short, imperative phrase ("закрой карту", "смени
// фон"). Anything longer is treated as a normal message for the AI, so keywords
// inside a sentence are never hijacked into window control.
const COMMAND_WORD_LIMIT = 5;

/** Returns a command ONLY when the phrase is an explicit, terse HUD control
 *  instruction; otherwise null so the message flows to the cognitive core. */
export function interpretUiCommand(raw: string): InterpretedCommand | null {
  const t = raw.toLowerCase().trim();
  if (!t) return null;
  const tokens = tokenize(t);
  if (tokens.length === 0 || tokens.length > COMMAND_WORD_LIMIT) return null;

  const wantsClose = RE_CLOSE.test(t);
  const wantsOpen = RE_OPEN.test(t);
  const wantsMin = RE_MIN.test(t);
  const allWord = RE_ALL.test(t);

  // Background — only on explicit change intent (next / a known background id),
  // never because a sentence merely mentions the word "фон".
  if (RE_BACKGROUND.test(t)) {
    const wantsNext = RE_BG_NEXT.test(t);
    const bgId = matchBackgroundId(t);
    if (wantsNext || bgId) {
      const value = wantsNext ? 'next' : (bgId as string);
      const reply =
        value === 'next' ? 'Меняю фон HUD.' : `Ставлю фон «${getBackground(value).label}».`;
      return { command: { kind: 'background', value }, reply };
    }
  }

  // Reset — guard against "сбрось мне ссылку": require a layout-ish word or a
  // 1–2 word imperative.
  if (RE_RESET.test(t) && (tokens.length <= 2 || RE_LAYOUT.test(t))) {
    return { command: { kind: 'reset' }, reply: 'Сбрасываю расположение окон и фон.' };
  }

  if (allWord && wantsOpen) {
    return { command: { kind: 'showAll' }, reply: 'Открываю все окна.' };
  }
  if (allWord && wantsClose) {
    return {
      command: { kind: 'closeAll' },
      reply: 'Убираю лишние окна — чат и вывод оставляю.',
    };
  }

  // Camera control by voice ("включи камеру", "закрой камеру", "подвинь камеру влево").
  if (CAMERA_ALIASES.some((alias) => aliasHit(tokens, t, alias))) {
    if (RE_MOVE.test(t)) {
      const dir = cameraDir(t);
      return { command: { kind: 'camera', action: 'move', dir }, reply: `Двигаю камеру ${CAMERA_DIR_RU[dir]}.` };
    }
    if (RE_CAM_CLOSE.test(t)) {
      return { command: { kind: 'camera', action: 'close' }, reply: 'Выключаю камеру.' };
    }
    if (RE_CAM_OPEN.test(t)) {
      return { command: { kind: 'camera', action: 'open' }, reply: 'Включаю камеру.' };
    }
    if (tokens.length === 1) {
      return { command: { kind: 'camera', action: 'toggle' }, reply: 'Переключаю камеру.' };
    }
  }

  const target = matchWindow(t, tokens);
  if (target) {
    const name = WINDOW_DISPLAY[target];
    if (wantsClose) return { command: { kind: 'close', target }, reply: `Закрываю ${name}.` };
    if (wantsMin) return { command: { kind: 'minimize', target }, reply: `Сворачиваю ${name}.` };
    if (wantsOpen) return { command: { kind: 'open', target }, reply: `Открываю ${name}.` };
    // Bare window-name toggle fires ONLY when the whole input is just that name
    // (e.g. the user types exactly "часы") — never from a word inside a sentence.
    if (tokens.length === 1) {
      return { command: { kind: 'toggle', target }, reply: `Переключаю ${name}.` };
    }
  }

  return null;
}
