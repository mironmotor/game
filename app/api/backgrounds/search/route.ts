/**
 * Поиск фона по свободным фотостокам.
 *
 * Источник — Openverse (агрегатор Викимедиа и др.): он не требует ключа, отдаёт
 * только материалы под свободными лицензиями и знает автора каждого снимка.
 * Это важнее качества картинки: фон, поставленный из чужой галереи без
 * лицензии и подписи, — чужая работа на своём сайте.
 *
 * Если в окружении есть ключ Unsplash, он используется первым — качество там
 * выше, — но ключ не обязателен, и без него поиск работает.
 */

import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TIMEOUT_MS = 12_000;
const PAGE_SIZE = 12;

export interface BackgroundHit {
  id: string;
  /** Мелкое превью для сетки. */
  thumb: string;
  /** Полноразмерная картинка — она и станет фоном. */
  url: string;
  title: string;
  credit: string;
  license: string;
  source: string;
}

async function fetchOnce(url: string, headers: Record<string, string>): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'mir.care/1.0 (background picker)', ...headers },
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Openverse периодически моргает: тот же запрос, который только что вернул 240
 * снимков, отдаёт пустоту, а через секунду снова работает. Без повтора это
 * доходило до человека как «ничего не нашлось» — то есть враньём про его
 * запрос, а не про состояние чужого сервиса.
 */
async function fetchJson(url: string, headers: Record<string, string> = {}): Promise<unknown> {
  try {
    return await fetchOnce(url, headers);
  } catch (first) {
    await new Promise((resolve) => setTimeout(resolve, 400));
    try {
      return await fetchOnce(url, headers);
    } catch {
      throw first;
    }
  }
}

/**
 * Годится ли ссылка как фон.
 *
 * Https обязателен, а из символов запрещены только кавычки, пробелы и слэш —
 * то, что способно разорвать `url('…')` в css. Скобки разрешены намеренно:
 * у Викисклада они в именах файлов сплошь и рядом
 * («Andromeda_Galaxy_(with_h-alpha).jpg»), и запрет на них выбрасывал именно
 * те снимки, ради которых поиск и затевался.
 */
function usableUrl(value: unknown): value is string {
  return typeof value === 'string' && /^https:\/\/[^"'\s\\]+$/.test(value);
}

async function searchUnsplash(query: string, key: string): Promise<BackgroundHit[]> {
  const url =
    `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}` +
    `&per_page=${PAGE_SIZE}&orientation=landscape&content_filter=high`;
  const data = (await fetchJson(url, { Authorization: `Client-ID ${key}` })) as {
    results?: {
      id?: string;
      urls?: { regular?: string; small?: string };
      description?: string;
      alt_description?: string;
      user?: { name?: string };
      links?: { html?: string };
    }[];
  };
  return (data.results ?? [])
    .filter((item) => usableUrl(item.urls?.regular) && usableUrl(item.urls?.small))
    .map((item) => ({
      id: `unsplash:${item.id ?? item.urls!.regular}`,
      thumb: item.urls!.small!,
      url: item.urls!.regular!,
      title: (item.description || item.alt_description || 'Unsplash').slice(0, 90),
      credit: item.user?.name ? `${item.user.name} / Unsplash` : 'Unsplash',
      license: 'Unsplash License',
      source: item.links?.html || 'https://unsplash.com',
    }));
}

/**
 * Превью для снимка Викисклада.
 *
 * Собственный thumb-прокси Openverse (`api.openverse.org/v1/images/<id>/thumb/`)
 * стабильно отвечает 424, и сетка выходила из пустых квадратов с одними
 * подписями. Прямой путь `/commons/thumb/<a>/<ab>/<file>/<N>px-<file>` тоже не
 * годится: Викисклад держит не любую ширину, а лишь заранее нарезанные
 * ступени — 480px даёт 400, тогда как 500px у того же файла отдаётся.
 *
 * Поэтому берём официальный редирект `Special:FilePath?width=`: он сам
 * подбирает ближайший существующий размер и не требует угадывать ступень.
 */
function previewUrl(full: string, width = 480): string {
  const match = full.match(
    /^https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\/(?:thumb\/)?[0-9a-f]\/[0-9a-f]{2}\/([^/?]+)/,
  );
  if (!match) return full;
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${match[1]}?width=${width}`;
}

/**
 * Openverse ищет по английским подписям: «горы» находят ноль снимков, а
 * «mountains» — тысячи. Человеку, который пишет по-русски, поиск при этом
 * выглядел сломанным.
 *
 * Словарь покрывает то, что реально просят у фона, и срабатывает мгновенно.
 * Если слова в нём нет, запрос уходит как есть, а перевод подключается только
 * когда прямой поиск не дал ничего — за секунды платит лишь редкий случай.
 */
const RU_EN: Record<string, string> = {
  закат: 'sunset', рассвет: 'sunrise', горы: 'mountains', гора: 'mountain',
  море: 'sea', океан: 'ocean', волны: 'waves', пляж: 'beach', берег: 'coast',
  лес: 'forest', деревья: 'trees', река: 'river', озеро: 'lake', водопад: 'waterfall',
  небо: 'sky', облака: 'clouds', звёзды: 'stars', звезды: 'stars', ночь: 'night',
  космос: 'space', галактика: 'galaxy', туманность: 'nebula', планета: 'planet',
  луна: 'moon', солнце: 'sun', северное: 'aurora', сияние: 'aurora borealis',
  город: 'city', улица: 'street', ночной: 'night city', неон: 'neon',
  снег: 'snow', зима: 'winter', лёд: 'ice', лед: 'ice', туман: 'fog',
  пустыня: 'desert', песок: 'sand', дюны: 'dunes', вулкан: 'volcano',
  цветы: 'flowers', поле: 'field', трава: 'grass', дождь: 'rain', гроза: 'storm',
  огонь: 'fire', вода: 'water', камни: 'rocks', пещера: 'cave', остров: 'island',
  бали: 'bali', джунгли: 'jungle', природа: 'nature', абстракция: 'abstract',
};

function translateQuery(query: string): string {
  if (!/[а-яё]/i.test(query)) return query;
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const mapped = words.map((word) => RU_EN[word] ?? RU_EN[word.replace(/[ыи]$/, '')] ?? word);
  return mapped.join(' ');
}

/** Последняя попытка для русского запроса, которого нет в словаре. */
async function translateViaModel(query: string): Promise<string | null> {
  const key = process.env.GONKA_API_KEY;
  if (!key) return null;
  const base = (process.env.GONKA_BASE_URL || 'https://proxy.gonkabroker.com/v1').replace(/\/+$/, '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: process.env.GONKA_MODEL || 'deepseek-ai/DeepSeek-V4-Flash-0731',
        messages: [
          {
            role: 'system',
            content:
              'Translate the image search query into English. Answer with the translation only: ' +
              'two or three words, no punctuation, no explanation.',
          },
          { role: 'user', content: query },
        ],
        temperature: 0,
      }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = String(data.choices?.[0]?.message?.content ?? '')
      .replace(/["'.\n]/g, ' ')
      .trim()
      .slice(0, 60);
    return /^[a-z0-9 -]+$/i.test(text) && text ? text : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function searchOpenverse(query: string): Promise<BackgroundHit[]> {
  // Без category: у Openverse это поле почти всегда пустое, а с
  // `category=photograph` выдача становится хуже — на «galaxy» приходит
  // «Samsung Galaxy» вместо Андромеды.
  const url =
    `https://api.openverse.org/v1/images/?q=${encodeURIComponent(query)}` +
    `&page_size=${PAGE_SIZE}&size=large&aspect_ratio=wide&mature=false`;
  const data = (await fetchJson(url)) as {
    results?: {
      id?: string;
      url?: string;
      thumbnail?: string;
      title?: string;
      creator?: string;
      license?: string;
      license_version?: string;
      foreign_landing_url?: string;
    }[];
  };
  return (data.results ?? [])
    .filter((item) => usableUrl(item.url))
    .map((item) => ({
      id: `openverse:${item.id ?? item.url}`,
      thumb: previewUrl(item.url!),
      url: item.url!,
      title: (item.title || 'Без названия').slice(0, 90),
      credit: item.creator || 'неизвестный автор',
      license: [item.license?.toUpperCase(), item.license_version].filter(Boolean).join(' ') || 'свободная лицензия',
      source: item.foreign_landing_url || 'https://openverse.org',
    }));
}

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get('q')?.trim();
  if (!query) {
    return NextResponse.json({ ok: false, error: 'пустой запрос', results: [] }, { status: 400 });
  }

  const unsplashKey = process.env.UNSPLASH_ACCESS_KEY?.trim();
  const errors: string[] = [];

  const run = async (q: string): Promise<BackgroundHit[]> => {
    const attempts: { name: string; run: () => Promise<BackgroundHit[]> }[] = [];
    if (unsplashKey) attempts.push({ name: 'unsplash', run: () => searchUnsplash(q, unsplashKey) });
    attempts.push({ name: 'openverse', run: () => searchOpenverse(q) });

    for (const attempt of attempts) {
      try {
        const results = await attempt.run();
        if (results.length) return results;
        errors.push(`${attempt.name}(${q}): пусто`);
      } catch (err) {
        errors.push(`${attempt.name}(${q}): ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return [];
  };

  const translated = translateQuery(query);
  let results = await run(translated);

  if (!results.length && /[а-яё]/i.test(query) && translated === query) {
    const viaModel = await translateViaModel(query);
    if (viaModel) results = await run(viaModel);
  }

  if (results.length) {
    return NextResponse.json({ ok: true, source: unsplashKey ? 'unsplash' : 'openverse', results });
  }

  console.warn('[backgrounds/search] нечего показать —', errors.join('; '));
  return NextResponse.json({ ok: true, source: null, results: [], note: 'ничего не нашлось' });
}
