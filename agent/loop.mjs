#!/usr/bin/env node
/**
 * Лёгкий цикл руки: агент всегда рядом, но молчит, пока ядру ничего не нужно.
 *
 * Холостой тик стоит ровно одну ssh-команду («сколько заявок в очереди») и ноль
 * токенов. Модель просыпается только когда MAX действительно о чём-то попросил —
 * поэтому цикл можно держать включённым постоянно, а не будить по расписанию.
 *
 *   node agent/loop.mjs            # тик раз в 90 секунд
 *   MAX_LOOP_INTERVAL_SEC=30 node agent/loop.mjs
 *
 * Предохранители на случай, если ядро войдёт в раж:
 *   - между прогонами модели выдерживается пауза (MAX_LOOP_COOLDOWN_SEC);
 *   - в сутки не больше MAX_LOOP_DAILY_RUNS прогонов;
 *   - параллельных прогонов не бывает: пока рука работает, тики только считают.
 */

import { spawn } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { queueStats } from './hands.mjs';
import { patrol } from './guard.mjs';
import { pulseWatch } from './pulse.mjs';
import { journal, warn } from './notify.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const INTERVAL_MS = Number(process.env.MAX_LOOP_INTERVAL_SEC || 90) * 1000;
const COOLDOWN_MS = Number(process.env.MAX_LOOP_COOLDOWN_SEC || 120) * 1000;
const DAILY_RUNS = Number(process.env.MAX_LOOP_DAILY_RUNS || 40);
// Обход сторожа — раз в полчаса при тике 90 с. Он считает, а не думает: один
// ssh и ноль токенов, поэтому может ходить часто и не стоить ничего.
const PATROL_EVERY_MS = Number(process.env.MAX_GUARD_EVERY_SEC || 1800) * 1000;

let running = false;
let lastRun = 0;
let runsToday = 0;
let dayStamp = new Date().toDateString();
let idleTicks = 0;
let lastPatrol = 0;
let stop = false;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function runHands() {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['night.mjs', '--hands'], {
      cwd: HERE,
      stdio: ['ignore', 'inherit', 'inherit'],
      env: process.env,
    });
    child.on('close', (code) => resolve(code ?? 0));
    child.on('error', () => resolve(-1));
  });
}

async function tick() {
  // Сторож ходит независимо от очереди: заявок может не быть неделями, а мусор
  // копится молча — именно так и вышло с 32 тысячами дубликатов.
  if (Date.now() - lastPatrol >= PATROL_EVERY_MS) {
    lastPatrol = Date.now();
    try {
      const report = await patrol();
      if (report.complaints?.length) {
        await journal(`сторож нашёл ${report.complaints.length} отклонений — ставлю заявку ядру`);
      }
    } catch (e) {
      await journal(`сторож споткнулся: ${String(e).slice(0, 160)}`);
    }
    // Пульс: простаивает ли ядро и сделало ли оно что-то весомое. Важное
    // всплывает уведомлением в самой системе — журнал никто не читает.
    try {
      await pulseWatch();
    } catch (e) {
      await journal(`пульс не снялся: ${String(e).slice(0, 160)}`);
    }
  }

  const today = new Date().toDateString();
  if (today !== dayStamp) {
    dayStamp = today;
    runsToday = 0;               // новые сутки — счётчик прогонов с нуля
  }

  const stats = await queueStats();
  if (stats.offline) {
    idleTicks += 1;
    if (idleTicks % 20 === 1) await journal('цикл: ядро недоступно (сервер или сеть) — жду');
    return;
  }
  if (!stats.pending) {
    idleTicks += 1;
    if (idleTicks % 40 === 1) await journal(`цикл: тихо, заявок нет (в работе ${stats.in_work ?? 0})`);
    return;
  }

  idleTicks = 0;
  const now = Date.now();
  if (now - lastRun < COOLDOWN_MS) return;          // ядро торопится — рука не бежит
  if (runsToday >= DAILY_RUNS) {
    if (runsToday === DAILY_RUNS) {
      runsToday += 1;                               // предупреждаем ровно один раз
      await warn(`✋ Рука встала на сутки: ${DAILY_RUNS} прогонов исчерпаны. Заявки ядра ждут.`);
    }
    return;
  }

  running = true;
  lastRun = now;
  runsToday += 1;
  await journal(`цикл: ядро просит (${stats.pending}) — бужу руку, прогон ${runsToday}/${DAILY_RUNS}`);
  const code = await runHands();
  await journal(`цикл: прогон завершён с кодом ${code}`);
  running = false;
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    stop = true;
    void journal(`цикл: получен ${signal}, останавливаюсь`);
  });
}

await journal(
  `цикл руки запущен: тик ${INTERVAL_MS / 1000} с, пауза между прогонами ${COOLDOWN_MS / 1000} с, ` +
  `лимит ${DAILY_RUNS}/сутки, обход сторожа каждые ${PATROL_EVERY_MS / 60000} мин`,
);
console.log(`Цикл руки MAX запущен. Тик ${INTERVAL_MS / 1000} с. Ctrl+C — остановить.`);

while (!stop) {
  if (!running) {
    try {
      await tick();
    } catch (e) {
      await journal(`цикл: тик упал — ${String(e).slice(0, 200)}`);
    }
  }
  await sleep(INTERVAL_MS);
}

await journal('цикл руки остановлен');
