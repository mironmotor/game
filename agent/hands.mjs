/**
 * Руки MAX со стороны агента.
 *
 * Ядро на дроплете кладёт НАМЕРЕНИЯ в `mark17/state/hands_queue.jsonl`
 * (mark17/hands.py). Агент приходит за ними сам по ssh — так на маке не нужно
 * держать входящий порт, а связь работает ровно тогда, когда мак включён.
 *
 * Правило прежнее: заявка вида «look» (посмотреть и рассказать) выполняется
 * после предупреждения, заявка «do» (изменить что-то) — только с ведома
 * человека, поэтому агент её не исполняет, а докладывает и возвращает ядру
 * честный отказ. Ядро от этого не ломается: отказ для него — такой же исход.
 */

import { execFile } from 'node:child_process';
import { warn } from './notify.mjs';
import { writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SERVER = process.env.MIRCARE_HOST || 'root@167.99.8.198';
const REMOTE_CLI = '/root/hands_cli.py';

function ssh(command, stdin) {
  return new Promise((resolve) => {
    const child = execFile(
      'ssh',
      ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', SERVER, command],
      { timeout: 45_000, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => resolve({ ok: !err, out: (stdout || '').trim(), err: (stderr || '').trim() }),
    );
    if (stdin !== undefined) child.stdin.end(stdin);
  });
}

/** Разово кладёт мостик на дроплет. Возвращает результат установки. */
export async function installHandsCli(scriptText) {
  return ssh(`cat > ${REMOTE_CLI} && echo ok`, scriptText);
}

/** Забрать намерения ядра. Пустой массив — ядру сейчас ничего не нужно. */
export async function takeTasks(limit = 3) {
  const res = await ssh(`cd /var/www/game && python3 ${REMOTE_CLI} take ${limit}`);
  if (!res.ok) return [];
  try {
    const rows = JSON.parse(res.out);
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

/** Дешёвая сводка очереди: один ssh, никакой модели. На ней стоит весь цикл. */
export async function queueStats() {
  const res = await ssh(`cd /var/www/game && python3 ${REMOTE_CLI} stats`);
  if (!res.ok) return { pending: 0, offline: true };
  try {
    return { ...JSON.parse(res.out), offline: false };
  } catch {
    return { pending: 0, offline: true };
  }
}

/** Вернуть ядру исход. Без этого круг «намерение → действие → исход» не замкнётся. */
export async function reportTask(id, ok, summary, detail = '') {
  const safeSummary = String(summary).replace(/"/g, "'").slice(0, 500);
  const res = await ssh(
    `cd /var/www/game && python3 ${REMOTE_CLI} report ${JSON.stringify(id)} ${ok ? 1 : 0} ${JSON.stringify(safeSummary)}`,
    String(detail).slice(0, 2000),
  );
  return res.ok;
}

/**
 * Кадр, на который просят посмотреть, скачивается СЮДА, на мак.
 *
 * Иначе рука бессильна: файл лежит на дроплете, а ssh ей запрещён — и правильно,
 * иначе белый список команд не значил бы ничего. Поэтому картинку приносит не
 * агент, а этот код: он качает её по открытой ссылке и подставляет в задание
 * локальный путь, который агент может просто прочитать.
 */
async function fetchMedia(task) {
  const m = String(task || '').match(/https?:\/\/[^\s"']+\/api\/media\/([A-Za-z0-9._-]{4,128})/);
  if (!m) return null;
  const [url, name] = [m[0], m[1]];
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(45_000) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length || buf.length > 25_000_000) return null;
    const dir = join(tmpdir(), 'max17-seen');
    await mkdir(dir, { recursive: true });
    const file = join(dir, name);
    await writeFile(file, buf);
    return { file, url, bytes: buf.length };
  } catch {
    return null;  // не скачалось — рука просто ответит, что кадра не видела
  }
}

/**
 * Готовит намерения к работе: «look» уходит в задание агенту, «do» сразу
 * возвращается ядру как неисполненное — с объяснением, что нужно слово человека.
 */
export async function intakeTasks(limit = 3) {
  const tasks = await takeTasks(limit);
  const doable = [];
  for (const task of tasks) {
    if (task.kind === 'do') {
      await warn(`✋ MAX просит СДЕЛАТЬ: «${task.task}»\nПричина: ${task.reason || '—'}\n\nСам я изменения не вношу — скажи, если браться.`);
      await reportTask(task.id, false, 'нужно слово человека: заявка меняет мир, а не смотрит на него');
      continue;
    }
    await warn(`👁 MAX просит посмотреть: «${task.task}»\nПричина: ${task.reason || '—'}`);
    // Кадр приносим заранее и подменяем ссылку локальным путём — агенту остаётся
    // просто прочитать файл, а не выяснять, как достать его с чужой машины.
    const media = await fetchMedia(task.task);
    if (media) {
      task.task = `${task.task}\n\nКадр уже скачан сюда: ${media.file} (${Math.round(media.bytes / 1024)} КБ) — прочитай этот файл и опиши, что на нём.`;
      task.media = media.file;
    }
    doable.push(task);
  }
  return doable;
}
