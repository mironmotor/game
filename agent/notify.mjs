/**
 * Канал предупреждений агента → Telegram Мирону.
 *
 * Токен бота живёт ТОЛЬКО на дроплете (`.env.local`), поэтому отправку делает
 * сам дроплет: сюда уезжает текст по stdin, обратно — код ответа. Так ключ не
 * копируется на мак и не попадает в репозиторий.
 *
 * Если чат не задан (MAX_AGENT_TG_CHAT) или сеть молчит — не падаем: пишем в
 * журнал и в консоль. Агент, который не смог предупредить, обязан остановиться,
 * а не действовать молча, — за это отвечает вызывающий код.
 */

import { execFile } from 'node:child_process';
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { homedir } from 'node:os';

const SERVER = process.env.MIRCARE_HOST || 'root@167.99.8.198';
const CHAT = (process.env.MAX_AGENT_TG_CHAT || '').trim();
export const JOURNAL = process.env.MAX_AGENT_JOURNAL || `${homedir()}/.local/max17/agent-journal.log`;

async function journal(line) {
  await mkdir(dirname(JOURNAL), { recursive: true }).catch(() => {});
  await appendFile(JOURNAL, `${new Date().toISOString()} ${line}\n`).catch(() => {});
}

function ssh(args, stdin) {
  return new Promise((resolve) => {
    const child = execFile(
      'ssh',
      ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', SERVER, ...args],
      { timeout: 30_000 },
      (err, stdout, stderr) => resolve({ ok: !err, out: (stdout || '').trim(), err: (stderr || '').trim() }),
    );
    if (stdin !== undefined) {
      child.stdin.end(stdin);
    }
  });
}

/** Разово кладёт на дроплет отправлялку: текст со stdin, токен берётся там же. */
export async function installNotifier() {
  const script = [
    '#!/bin/bash',
    '# Ставится агентом (agent/notify.mjs). Текст сообщения читается со stdin,',
    '# токен берётся из .env.local сайта и никуда не уезжает.',
    'set -euo pipefail',
    'CHAT="$1"',
    'TOKEN="$(grep -m1 "^TELEGRAM_BOT_TOKEN=" /var/www/game/.env.local | cut -d= -f2- | tr -d "\\042\\047")',
    '[ -n "$TOKEN" ] || { echo "нет TELEGRAM_BOT_TOKEN"; exit 2; }',
    'TEXT="$(cat)"',
    'curl -s -o /dev/null -w "%{http_code}" -X POST \\',
    '  "https://api.telegram.org/bot$TOKEN/sendMessage" \\',
    '  --data-urlencode "chat_id=$CHAT" \\',
    '  --data-urlencode "text=$TEXT" \\',
    '  --data-urlencode "disable_web_page_preview=true"',
  ].join('\n');
  return ssh(['cat > /root/max-agent-notify.sh && chmod +x /root/max-agent-notify.sh && echo ok'], script);
}

/**
 * Предупредить хозяина. Возвращает true, только если сообщение реально ушло —
 * вызывающий код обязан считать false запретом на дальнейшие действия.
 */
export async function warn(text) {
  const body = String(text).slice(0, 3500);
  await journal(`WARN ${body.replace(/\n/g, ' ⏎ ')}`);
  console.log(`\n⚠️  ${body}\n`);
  if (!CHAT) {
    await journal('WARN не отправлен: MAX_AGENT_TG_CHAT не задан');
    return false;
  }
  const res = await ssh([`bash /root/max-agent-notify.sh ${CHAT}`], body);
  const sent = res.ok && res.out.endsWith('200');
  await journal(`WARN отправка: ${sent ? 'ok' : `сбой (${res.out || res.err})`}`);
  return sent;
}

export { journal };
