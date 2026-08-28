/**
 * Пульс ядра — простой и важное, снятые с боевого сервера.
 *
 * Зачем отдельный модуль: сторож в loop.mjs считает мусор в памяти, а это
 * другой вопрос — работает ли ядро вообще. Замер на стороне ядра стоит
 * миллисекунды и не тратит токенов, поэтому спрашивать можно часто.
 *
 * Показываем человеку через нативное уведомление macOS: журнал никто не
 * читает, а телеграм у нас до сих пор не настроен — именно поэтому падение
 * руки заметили только через сутки.
 */

import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { journal, notifyOS } from './notify.mjs';

const SERVER = process.env.MAX_AGENT_SERVER || 'root@167.99.8.198';
const SITE = process.env.MAX_AGENT_SITE || '/var/www/game';
// Что уже показывали — чтобы одно и то же не всплывало каждые полчаса.
const SEEN_FILE = process.env.MAX_PULSE_SEEN || `${homedir()}/.local/max17/pulse-seen.json`;

const PY = `
import json, sys
sys.path.insert(0, ".")
from mark17 import stagnation
print(json.dumps({
    "report": stagnation.report("mark17/state"),
    "important": stagnation.important_tacts("mark17/state", limit=3),
}, ensure_ascii=False))
`.trim();

function ssh(command) {
  return new Promise((resolve) => {
    execFile(
      'ssh',
      ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', SERVER, command],
      { timeout: 25000 },
      (err, stdout, stderr) => resolve({ ok: !err, out: String(stdout || '').trim(), err: String(stderr || '') }),
    );
  });
}

/** Снять пульс. Возвращает null, если ядро недоступно — это не ошибка, а факт. */
export async function corePulse() {
  const res = await ssh(`cd ${SITE} && python3 -c ${JSON.stringify(PY)}`);
  if (!res.ok || !res.out) return null;
  try {
    return JSON.parse(res.out.split('\n').filter(Boolean).at(-1));
  } catch {
    return null;
  }
}

async function readSeen() {
  try {
    return JSON.parse(await readFile(SEEN_FILE, 'utf8'));
  } catch {
    return { streakNotified: 0, lastImportantTs: 0 };
  }
}

async function writeSeen(state) {
  try {
    await writeFile(SEEN_FILE, JSON.stringify(state), 'utf8');
  } catch {
    // Нет доступа к файлу — переживём повтор уведомления, это дешевле молчания.
  }
}

/**
 * Проверить пульс и показать человеку то, что действительно стоит его внимания.
 *
 * Два повода нарушить тишину:
 *  1. Ядро встало — простой перешагнул порог. Повторяем не чаще, чем когда
 *     полоса заметно выросла: иначе застой на сутки превратится в 48 уведомлений.
 *  2. Ядро сделало что-то весомое — показываем ОДИН самый тяжёлый такт, а не
 *     всё подряд. Важное перестаёт быть важным, когда его много.
 */
export async function pulseWatch() {
  const pulse = await corePulse();
  if (!pulse) return { ok: false, reason: 'ядро недоступно' };

  const seen = await readSeen();
  const report = pulse.report || {};
  const streak = Number(report.idle_streak || 0);
  const events = [];

  if (report.stagnant) {
    // Порог растёт вместе с полосой: 3, 6, 12, 24… Так уведомление приходит
    // на каждом новом порядке застоя, а не каждые полчаса.
    const step = seen.streakNotified ? seen.streakNotified * 2 : 3;
    if (streak >= step) {
      const yieldPct = report.yield_24h == null ? '—' : `${Math.round(report.yield_24h * 100)}%`;
      await notifyOS(
        'MAX17 простаивает',
        `${streak} тактов подряд без следа в мире. КПД за сутки: ${yieldPct}`,
        { sound: true },
      );
      await journal(`пульс: ядро в застое ${streak} тактов, КПД суток ${yieldPct}`);
      seen.streakNotified = streak;
      events.push('stagnant');
    }
  } else if (seen.streakNotified) {
    // Вышло из застоя — сообщаем один раз и сбрасываем счётчик порогов.
    await notifyOS('MAX17 снова работает', `Простой прерван действием «${report.last_move_action || '—'}»`);
    await journal(`пульс: застой прерван (${report.last_move_action})`);
    seen.streakNotified = 0;
    events.push('recovered');
  }

  const top = (pulse.important || [])[0];
  if (top && Number(top.ts || 0) > Number(seen.lastImportantTs || 0)) {
    const delta = Object.entries(top.delta || {})
      .map(([k, v]) => `${k} +${v}`)
      .join(', ');
    await notifyOS('MAX17 сделал шаг', `${top.action}: ${delta}${top.reason ? ` — ${top.reason}` : ''}`);
    await journal(`пульс: важный такт ${top.action} (вес ${top.weight}) — ${delta}`);
    seen.lastImportantTs = Number(top.ts || 0);
    events.push('important');
  }

  await writeSeen(seen);
  return { ok: true, streak, stagnant: Boolean(report.stagnant), events };
}
