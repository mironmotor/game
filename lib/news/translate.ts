/**
 * Машинный перевод статей на любой язык читателя.
 *
 * Три решения, которые стоит объяснить, потому что они неочевидны.
 *
 * 1. Переводим не размётку, а плоский список строк. Статья сплющивается в
 *    массив («заголовок», «подводка», текст каждого блока, каждый пункт
 *    списка), модель возвращает массив той же длины, и он раскладывается
 *    обратно по своим местам. Модель физически не может сломать вёрстку,
 *    потому что вёрстки не видит.
 *
 * 2. Длина ответа проверяется строго. Не совпала — перевод отбрасывается
 *    целиком, читатель получает английский оригинал с честной пометкой.
 *    Половина переведённой статьи хуже, чем непереведённая.
 *
 * 3. Результат кладётся в файловый кэш рядом с mircoin.json — тем же
 *    паттерном, что api-keys.ts. Перевод на язык оплачивается один раз,
 *    а не на каждого читателя. Ключ включает хэш исходника: правка статьи
 *    сама сбрасывает все переводы, забыть об этом невозможно.
 */

import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { Article, ArticleBlock, ArticleContent, LocalizedArticle } from './types';
import { bridgeContent } from './registry';

const DATA_DIR =
  process.env.MIRCOIN_DATA_DIR?.trim() ||
  process.env.CYBERLAB_DATA_DIR?.trim() ||
  path.join(os.homedir(), '.max17');
const STORE = path.join(DATA_DIR, 'news-translations.json');

const TRANSLATE_TIMEOUT_MS = 90_000;
/** Выше этого числа строк статья режется на части: длинный JSON модели даётся хуже. */
const CHUNK_SIZE = 40;

type CacheEntry = { strings: string[]; at: string };
type Cache = Record<string, CacheEntry>;

let cache: Cache | null = null;
let writeChain: Promise<unknown> = Promise.resolve();
/** Один и тот же язык не переводится дважды параллельно. */
const inFlight = new Map<string, Promise<LocalizedArticle | null>>();

async function readCache(): Promise<Cache> {
  if (cache) return cache;
  try {
    const raw = await fs.readFile(STORE, 'utf8');
    const parsed = JSON.parse(raw) as Cache;
    cache = parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    cache = {};
  }
  return cache;
}

async function writeCache(key: string, entry: CacheEntry): Promise<void> {
  const store = await readCache();
  store[key] = entry;
  const next = writeChain.then(async () => {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(STORE, JSON.stringify(store, null, 2), 'utf8');
  });
  writeChain = next.catch(() => undefined);
  await next.catch((err) => console.error('[news/translate] cache write failed', err));
}

// --- сплющивание и сборка ------------------------------------------------

/** Собирает все переводимые строки статьи в плоский массив. Экспортируется для тестов. */
export function flatten(content: ArticleContent): string[] {
  const out: string[] = [content.title, content.dek, ...content.tags];
  for (const block of content.blocks) {
    switch (block.kind) {
      case 'p':
      case 'h2':
        out.push(block.text);
        break;
      case 'list':
        out.push(...block.items);
        break;
      case 'quote':
        out.push(block.text, block.attribution ?? '');
        break;
      case 'stat':
        out.push(block.value, block.label, block.note ?? '');
        break;
      case 'note':
        out.push(block.title, block.text);
        break;
    }
  }
  return out;
}

/** Обратная операция: раскладывает переведённые строки по исходной структуре. Экспортируется для тестов. */
export function rebuild(content: ArticleContent, strings: string[]): ArticleContent {
  let i = 0;
  const take = () => strings[i++];

  const title = take();
  const dek = take();
  const tags = content.tags.map(() => take());
  const blocks: ArticleBlock[] = content.blocks.map((block) => {
    switch (block.kind) {
      case 'p':
      case 'h2':
        return { ...block, text: take() };
      case 'list':
        return { ...block, items: block.items.map(() => take()) };
      case 'quote': {
        const text = take();
        const attribution = take();
        return { ...block, text, attribution: block.attribution ? attribution : undefined };
      }
      case 'stat': {
        const value = take();
        const label = take();
        const note = take();
        return { ...block, value, label, note: block.note ? note : undefined };
      }
      case 'note': {
        const noteTitle = take();
        return { ...block, title: noteTitle, text: take() };
      }
    }
  });

  return { title, dek, blocks, tags };
}

// --- вызов модели --------------------------------------------------------

const SYSTEM_PROMPT = [
  'You are a professional news translator for a journalism desk.',
  'You receive a JSON array of strings from a single news article and return a JSON array of translations.',
  'Rules, all mandatory:',
  '1. Return ONLY a JSON array of strings. No prose, no markdown fences, no commentary.',
  '2. The output array MUST have exactly the same number of elements as the input, in the same order.',
  '3. Translate an empty string as an empty string.',
  '4. Preserve all numbers, units, percentages and dates exactly. Adapt only the decimal separator and number formatting to the conventions of the target language.',
  '5. Keep proper nouns, agency acronyms (NOAA, BMKG, BRIN, BPBD, IOD, ENSO) and place names in the form a reader of the target language expects.',
  '6. Register: sober broadsheet journalism. Do not sensationalise, do not soften, do not add or remove facts.',
  '7. Never add explanations or translator notes.',
].join('\n');

/**
 * Ни ядра, ни брокера. Отдельный класс ошибки, потому что реакция на неё
 * другая: повторять попытку бессмысленно, и цикл обязан оборваться сразу.
 * Без этого запрос на непереводимый язык висел минуту, дважды дожидаясь
 * таймаута ядра, прежде чем отдать тот же английский текст.
 */
class NoBackendError extends Error {
  constructor() {
    super('no translation backend available');
    this.name = 'NoBackendError';
  }
}

async function callModel(prompt: string): Promise<string> {
  // Первый выбор — собственное ядро: оно уже настроено, и запрос не уходит
  // на сторону. Если демон не поднят (на дроплете это штатная ситуация),
  // идём напрямую в брокер.
  try {
    const { max17Llm } = await import('@/lib/max17-llm');
    const viaCore = await max17Llm(prompt, { system: SYSTEM_PROMPT, json: true });
    if (viaCore.trim()) return viaCore;
  } catch (err) {
    console.warn('[news/translate] core unavailable, falling back to broker', err);
  }

  const base = (process.env.GONKA_BASE_URL || 'https://proxy.gonkabroker.com/v1').replace(/\/+$/, '');
  const key = process.env.GONKA_API_KEY;
  if (!key) throw new NoBackendError();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TRANSLATE_TIMEOUT_MS);
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: process.env.GONKA_MODEL || 'deepseek-ai/DeepSeek-V4-Flash-0731',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
        temperature: 0.2,
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`broker responded ${res.status}`);
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return String(data.choices?.[0]?.message?.content ?? '');
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Достаёт массив строк из ответа модели.
 *
 * Наивная версия — от первой «[» до последней «]» — на живом брокере не
 * работает. DeepSeek через Gonka отвечает так:
 *
 *   ["Dua samudra","air"]  // Note: "Two oceans" = "Dua samudra"…
 *   ```json
 *   ["Dua samudra","air"]
 *   ```
 *
 * То есть массив, комментарий с ЕЩЁ ОДНОЙ парой скобок и повтор в ограде.
 * Срез между крайними скобками захватывает всё это разом и не разбирается.
 * Поэтому здесь честное сканирование: находим каждую «[», отсчитываем от неё
 * сбалансированную скобку (не считая тех, что внутри строковых литералов) и
 * пробуем разобрать. Побеждает первый кандидат нужной формы и длины.
 */
export function parseStrings(raw: string, expected: number): string[] | null {
  for (let start = raw.indexOf('['); start !== -1; start = raw.indexOf('[', start + 1)) {
    const end = matchingBracket(raw, start);
    if (end === -1) continue;

    try {
      const parsed = JSON.parse(raw.slice(start, end + 1)) as unknown;
      if (!Array.isArray(parsed) || parsed.length !== expected) continue;
      if (!parsed.every((item) => typeof item === 'string')) continue;
      return parsed as string[];
    } catch {
      // Не массив, а начало чего-то другого — пробуем следующую скобку.
    }
  }
  return null;
}

/** Индекс «]», закрывающей скобку в позиции open, или -1. Строки и экранирование учитываются. */
function matchingBracket(text: string, open: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = open; i < text.length; i += 1) {
    const char = text[i];

    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }

    if (char === '"') inString = true;
    else if (char === '[') depth += 1;
    else if (char === ']') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

async function translateStrings(
  strings: string[],
  targetLanguage: string,
  sourceLanguage: string,
): Promise<string[] | null> {
  const result: string[] = [];

  for (let offset = 0; offset < strings.length; offset += CHUNK_SIZE) {
    const chunk = strings.slice(offset, offset + CHUNK_SIZE);
    const prompt = [
      `Source language: ${sourceLanguage}. Target language: ${targetLanguage}.`,
      `Translate all ${chunk.length} strings. Return a JSON array of exactly ${chunk.length} strings.`,
      '',
      JSON.stringify(chunk, null, 0),
    ].join('\n');

    let translated: string[] | null = null;
    for (let attempt = 0; attempt < 2 && !translated; attempt += 1) {
      try {
        translated = parseStrings(await callModel(prompt), chunk.length);
      } catch (err) {
        // Переводить нечем — вторая попытка даст тот же результат, только
        // через минуту ожидания. Выходим сразу, читатель получит оригинал.
        if (err instanceof NoBackendError) {
          console.warn('[news/translate] no backend configured, serving the original');
          return null;
        }
        console.error('[news/translate] model call failed', err);
      }
    }
    if (!translated) return null;
    result.push(...translated);
  }

  return result;
}

// --- публичный вход ------------------------------------------------------

function cacheKey(article: Article, locale: string, source: string[]): string {
  const hash = createHash('sha256').update(JSON.stringify(source)).digest('hex').slice(0, 16);
  return `${article.slug}:${locale}:${hash}`;
}

/**
 * Возвращает статью на запрошенном языке, переводя её при необходимости.
 * null означает «перевести не удалось» — вызывающий обязан показать оригинал.
 */
export async function translateArticle(
  article: Article,
  locale: string,
  languageName: string,
): Promise<LocalizedArticle | null> {
  const bridge = bridgeContent(article);
  const source = flatten(bridge.content);
  const key = cacheKey(article, locale, source);

  const store = await readCache();
  const cached = store[key];
  if (cached?.strings?.length === source.length) {
    return assemble(article, bridge.content, cached.strings, locale);
  }

  const pending = inFlight.get(key);
  if (pending) return pending;

  const job = (async (): Promise<LocalizedArticle | null> => {
    const translated = await translateStrings(source, languageName, bridge.locale);
    if (!translated) return null;
    await writeCache(key, { strings: translated, at: new Date().toISOString() });
    return assemble(article, bridge.content, translated, locale);
  })().finally(() => inFlight.delete(key));

  inFlight.set(key, job);
  return job;
}

function assemble(
  article: Article,
  bridge: ArticleContent,
  strings: string[],
  locale: string,
): LocalizedArticle {
  return {
    ...rebuild(bridge, strings),
    slug: article.slug,
    publishedAt: article.publishedAt,
    updatedAt: article.updatedAt,
    author: article.author,
    locale,
    originLocale: article.originLocale,
    translation: 'machine',
    sources: article.sources,
  };
}

/**
 * Готовый перевод, если он уже лежит в кэше. Модель не вызывается.
 *
 * Нужно для ленты: список заголовков обязан открываться мгновенно, поэтому
 * лента показывает то, что переведено, и не ждёт того, что ещё нет.
 * Полный перевод запускается уже на странице самой статьи.
 */
export async function cachedTranslation(
  article: Article,
  locale: string,
): Promise<LocalizedArticle | null> {
  const bridge = bridgeContent(article);
  const source = flatten(bridge.content);
  const store = await readCache();
  const cached = store[cacheKey(article, locale, source)];
  if (cached?.strings?.length !== source.length) return null;
  return assemble(article, bridge.content, cached.strings, locale);
}
