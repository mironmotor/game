#!/usr/bin/env node
/**
 * Ночной обходчик mir.care на Claude Agent SDK.
 *
 *   node agent/night.mjs              # смотрит и докладывает, НИЧЕГО не меняет
 *   node agent/night.mjs --fix        # ещё и правит код в рабочей копии
 *   node agent/night.mjs --task "…"   # разовое задание вместо ночного обхода
 *   node agent/night.mjs --hands      # только намерения ядра; пусто — выходит молча
 *
 * Правило номер один: агент предупреждает ДО того, как что-то сделает. Старт,
 * каждая правка файла и итог уходят в Telegram (agent/notify.mjs). Если
 * предупредить не удалось — режим --fix не стартует вообще: молчаливый агент
 * с правом записи хуже, чем никакого агента.
 *
 * Чего он не может ни в каком режиме: ходить по ssh на дроплет, трогать
 * .env-файлы и живую память ядра, запускать деплой, коммитить и пушить.
 * Выкат остаётся ручным — deploy/mircare-push.sh запускает человек.
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve, sep } from 'node:path';
import { collect, asBriefing, quickFacts } from './collect.mjs';
import { warn, journal } from './notify.mjs';
import { intakeTasks, reportTask } from './hands.mjs';

const REPO = resolve(process.env.MAX_AGENT_REPO || `${homedir()}/game-ultra`);
const QUEUE = process.env.MAX_AGENT_QUEUE || `${homedir()}/.local/max17/agent-queue.jsonl`;
const REPORTS = `${REPO}/agent/reports`;

const args = process.argv.slice(2);
const FIX = args.includes('--fix');
// Режим руки: никакого обхода сайта и никакого вызова модели, пока ядру ничего
// не нужно. Это то, что позволяет держать цикл включённым постоянно.
const HANDS_ONLY = args.includes('--hands');
// Взятые заявки держим на виду у обработчика падений: упавший прогон обязан
// вернуть ядру честный провал, иначе заявка зависает «в работе» навечно.
let claimedTasks = [];
const taskFlag = args.indexOf('--task');
const ONE_OFF = taskFlag >= 0 ? args[taskFlag + 1] : null;

// ── Предохранители ───────────────────────────────────────────────────────────

const READ_ONLY_TOOLS = new Set(['Read', 'Grep', 'Glob', 'NotebookRead', 'TodoWrite', 'WebFetch', 'WebSearch']);
const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

// Белый список: разрешено только то, что читает. Чёрные списки здесь не
// работают — `bash -c "ss""h host"` и `python -c subprocess.run` обходят любой
// regex-запрет (агент сам нашёл эту дыру на первом же прогоне).
const ALLOWED_BASH = [
  /^ls\b/, /^cat\b/, /^head\b/, /^tail\b/, /^wc\b/, /^file\b/, /^stat\b/,
  /^grep\b/, /^rg\b/, /^find\b/, /^sed\s+-n\b/, /^awk\b/, /^sort\b/, /^uniq\b/, /^cut\b/,
  /^du\b/, /^df\b/, /^pwd$/, /^echo\b/, /^date\b/, /^which\b/, /^node\s+--check\b/,
  /^git\s+(status|log|diff|show|branch|blame|ls-files)\b/,
  /^npm\s+run\s+(lint|test|typecheck)\b/, /^npx\s+tsc\s+--noEmit\b/,
  /^python3?\s+-m\s+(py_compile|json\.tool)\b/,
];

// Второй слой поверх белого списка: даже разрешённая команда не должна
// дотягиваться до ключей, живой памяти и выката.
const FORBIDDEN_IN_BASH = [/\.env/, /mark17\/state/, /\bdeploy\//, /\bssh\b/, /\brsync\b/];

const insideRepo = (p) => {
  const abs = resolve(REPO, String(p ?? ''));
  return abs === REPO || abs.startsWith(REPO + sep);
};

const PROTECTED = [/\.env/, /mark17\/state/, /^deploy\//, /\.git\//];

// Контракт SDK: (toolName, input, {signal}) → {behavior:'allow', updatedInput} |
// {behavior:'deny', message}. В типах updatedInput помечен необязательным, но
// рантайм валидирует ответ схемой и без него роняет ЛЮБОЙ вызов инструмента с
// «Tool permission request failed: ZodError» — рука при этом слепа и нема, а
// причина не видна ниоткуда, кроме её собственного отчёта.
const allow = (input) => ({ behavior: 'allow', updatedInput: input ?? {} });

async function guard(name, input = {}) {
  if (READ_ONLY_TOOLS.has(name)) return allow(input);

  if (name === 'Bash') {
    const cmd = String(input.command ?? '').trim();
    // Составные команды разбираем по звеньям: цепочка безопасна ровно настолько,
    // насколько безопасно её худшее звено.
    const links = cmd.split(/&&|\|\||;|\|/).map((c) => c.trim()).filter(Boolean);
    const bad = links.find((link) => !ALLOWED_BASH.some((re) => re.test(link)));
    if (bad) {
      await journal(`ОТКАЗ Bash: ${cmd.slice(0, 200)} (звено вне белого списка: ${bad.slice(0, 60)})`);
      return { behavior: 'deny', message: `«${bad.slice(0, 60)}» не в списке читающих команд. Ночному агенту разрешено только смотреть.` };
    }
    const forbidden = FORBIDDEN_IN_BASH.find((re) => re.test(cmd));
    if (forbidden) {
      await journal(`ОТКАЗ Bash: ${cmd.slice(0, 200)} (защищённое: ${forbidden})`);
      return { behavior: 'deny', message: `Команда тянется к защищённому (${forbidden}): ключи, живая память и выкат — не для агента.` };
    }
    return allow(input);
  }

  if (WRITE_TOOLS.has(name)) {
    const path = String(input.file_path ?? input.path ?? '');
    if (!FIX) {
      return { behavior: 'deny', message: 'Обход идёт в режиме наблюдения. Опиши правку в отчёте — решение за человеком.' };
    }
    if (!insideRepo(path)) {
      return { behavior: 'deny', message: `Файл вне рабочей копии ${REPO} — туда нельзя.` };
    }
    const rel = resolve(path).slice(REPO.length + 1);
    const blocked = PROTECTED.find((re) => re.test(rel));
    if (blocked) {
      return { behavior: 'deny', message: `${rel} защищён (ключи, живая память, выкат) — правит человек.` };
    }
    // Предупреждаем ДО записи. Не удалось предупредить — не пишем.
    const told = await warn(`✏️ Правлю файл: ${rel}\n(ночной агент, режим --fix)`);
    if (!told) return { behavior: 'deny', message: 'Не смог предупредить хозяина — правку отменяю.' };
    return allow(input);
  }

  await journal(`ОТКАЗ ${name}: инструмент вне разрешённого набора`);
  return { behavior: 'deny', message: `Инструмент ${name} ночному агенту не выдан.` };
}

// ── Задание ──────────────────────────────────────────────────────────────────

async function takeQueue() {
  try {
    const raw = await readFile(QUEUE, 'utf8');
    const items = raw.split('\n').filter(Boolean).map((l) => {
      try { return JSON.parse(l); } catch { return { task: l }; }
    });
    if (items.length) await writeFile(QUEUE, '');   // забрали — очередь пуста
    return items.map((i) => i.task).filter(Boolean);
  } catch {
    return [];
  }
}

const RULES = `Ты ночной обходчик проекта mir.care (ядро MAX17 + Next.js).
Работаешь на маке, в рабочей копии ветки ultra. Сервер трогать запрещено —
никакого ssh, pm2, деплоя, коммитов. Живая память ядра и .env неприкосновенны.
Отчёт пиши по-русски, кратко и по делу: что сломано, чем это грозит, что
предлагаешь. Догадки помечай как догадки. Если всё тихо — так и скажи одной
строкой, не выдумывай проблем ради отчёта.`;

async function main() {
  await mkdir(REPORTS, { recursive: true });
  const mode = HANDS_ONLY
    ? 'рука ядра'
    : ONE_OFF
      ? 'разовое задание'
      : FIX
        ? 'обход с правками'
        : 'обход-наблюдение';

  // В режиме руки сначала смотрим, есть ли работа, и только потом шумим и тратим
  // токены: холостой тик должен стоить одну ssh-команду и ничего больше.
  const coreTasks = ONE_OFF ? [] : await intakeTasks();
  claimedTasks = coreTasks;
  if (HANDS_ONLY && coreTasks.length === 0) {
    await journal('рука: очередь ядра пуста — выхожу без вызова модели');
    return;
  }

  const started = await warn(`🌙 Агент MAX стартовал (${mode}).`);
  if (FIX && !started) {
    console.error('Не смог предупредить хозяина — режим --fix не запускаю.');
    process.exit(3);
  }

  const queued = ONE_OFF || HANDS_ONLY ? (ONE_OFF ? [ONE_OFF] : []) : await takeQueue();
  // Снимок сайта нужен обходу, а руке — нет: она отвечает на конкретный вопрос
  // ядра, а не осматривает всё хозяйство.
  const facts = ONE_OFF || HANDS_ONLY ? null : await collect();
  // Рука не ходит по ssh, но приборы читать может: снимок сервера подмешивается
  // в задание, иначе на вопрос «сколько у меня памяти» она честно отвечает «не знаю».
  const gauges = HANDS_ONLY && coreTasks.length ? await quickFacts() : '';

  const prompt = [
    ONE_OFF
      ? `Задание: ${ONE_OFF}`
      : HANDS_ONLY
        ? 'Ядро MAX попросило тебя о деле в реальности. Ответь коротко и по факту — это уйдёт прямо в его память.'
        : 'Ночной обход. Ниже — снятое состояние живого сайта.',
    queued.length && !ONE_OFF ? `\nЯдро оставило задачи:\n- ${queued.join('\n- ')}` : '',
    coreTasks.length
      ? `\nMAX просит посмотреть (это его собственные намерения, отвечай по существу):\n${coreTasks
          .map((t) => `- [${t.id}] ${t.task}${t.reason ? ` (зачем: ${t.reason})` : ''}`)
          .join('\n')}\nПо КАЖДОЙ такой заявке закончи ответ отдельной строкой вида «РУКА <id>: <что выяснил, одно предложение>» — это уходит прямо в память ядра.`
      : '',
    facts ? `\n${asBriefing(facts)}` : '',
    gauges ? `\n${gauges}` : '',
    '\nНайди, что действительно требует внимания. По каждой находке: признак,',
    'причина (если видна из кода), предложение. В конце — список из не более чем',
    'пяти пунктов, отсортированный по важности.',
  ].filter(Boolean).join('\n');

  let last = '';
  let summary = null;
  for await (const message of query({
    prompt,
    options: {
      cwd: REPO,
      // В plan-режиме агент только планирует и не выполняет — для заявки
      // «посмотри на кадр» это тупик: ходы уходят на размышления, а файл так и
      // не прочитан. Рука отвечает на вопросы ядра действием, поэтому здесь
      // обычный режим: писать ей всё равно нечем — сторож пропускает только
      // читающие инструменты.
      // Планирование вместо действия уместно ровно в одном случае: ночной
      // обход-наблюдение, где рука смотрит и докладывает. Заявка ядра и разовое
      // задание — это просьбы что-то СДЕЛАТЬ; в plan-режиме они сгорают в ходах,
      // так и не прочитав ни файла. Писать руке всё равно нечем: сторож
      // пропускает только читающие инструменты.
      permissionMode: FIX || HANDS_ONLY || ONE_OFF ? 'default' : 'plan',
      canUseTool: guard,
      maxTurns: Number(process.env.MAX_AGENT_MAX_TURNS || 40),
      // Ночной обход не должен обходиться дороже ужина: упрётся — вернёт
      // result с subtype error_max_budget_usd, и отчёт всё равно уйдёт.
      maxBudgetUsd: Number(process.env.MAX_AGENT_BUDGET_USD || 2),
      ...(process.env.MAX_AGENT_MODEL ? { model: process.env.MAX_AGENT_MODEL } : {}),
      systemPrompt: { type: 'preset', preset: 'claude_code', append: RULES },
      settingSources: ['project'],
    },
  })) {
    if (message.type === 'assistant') {
      const text = message.message?.content?.filter?.((b) => b.type === 'text')?.map((b) => b.text).join('\n');
      if (text) { last = text; console.log(text); }
    }
    if (message.type === 'result') {
      summary = message;
      if (message.subtype === 'success' && message.result) last = message.result;
    }
  }

  const cost = summary ? `ходов ${summary.num_turns}, $${(summary.total_cost_usd ?? 0).toFixed(3)}` : 'счётчик недоступен';
  const denials = (summary?.permission_denials ?? [])
    .map((d) => `- ${d.tool_name ?? d.toolName ?? 'инструмент'}: не дал`)
    .slice(0, 10)
    .join('\n');

  // Возвращаем ядру исход по каждому его намерению: без этого MAX не узнает,
  // чем закончилось то, что он попросил, и будет просить это снова.
  for (const task of coreTasks) {
    const line = last.split('\n').find((l) => l.includes(`РУКА ${task.id}`) || l.includes(task.id));
    const summary = (line || last.split('\n').filter(Boolean).slice(-1)[0] || 'рука отработала')
      .replace(/^РУКА\s+\S+:\s*/, '')
      .slice(0, 400);
    const sent = await reportTask(task.id, Boolean(line), summary, last.slice(0, 1500));
    await journal(`РУКА ${task.id}: ${sent ? 'исход отправлен ядру' : 'ядро не приняло исход'} — ${summary.slice(0, 120)}`);
    // Вычёркиваем сразу: всё, что ниже (запись отчёта, телеграм), может упасть,
    // и тогда catch отчитается провалом по уже закрытой заявке.
    if (sent) claimedTasks = claimedTasks.filter((t) => t.id !== task.id);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = `${REPORTS}/${stamp}.md`;
  await writeFile(
    file,
    `# Ночной обход ${stamp}\nРежим: ${mode} (${cost})\n\n${last}\n${denials ? `\n## Куда не пустили\n${denials}\n` : ''}`,
  );
  await warn(`🌙 Обход закончен (${mode}, ${cost}).\n\n${last.slice(0, 2500)}\n\nОтчёт: ${file}`);
}

main().catch(async (e) => {
  const reason = String(e).slice(0, 300);
  // Сначала развязываем ядро, потом жалуемся. Молчаливое падение с взятой
  // заявкой once стоило суток простоя: ядро ждало ответа, которого не будет.
  for (const task of claimedTasks) {
    try {
      await reportTask(task.id, false, `рука не справилась: ${reason}`, String(e).slice(0, 1500));
    } catch (reportError) {
      console.error('не удалось вернуть исход ядру:', reportError);
    }
  }
  await warn(`🌙 Ночной агент упал: ${reason}${claimedTasks.length ? `\nЗаявок возвращено ядру: ${claimedTasks.length}` : ''}`);
  console.error(e);
  process.exit(1);
});
