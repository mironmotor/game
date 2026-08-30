/**
 * Единая точка «дай статью на языке читателя».
 *
 * Порядок предпочтений один и тот же везде — на сервере при рендере,
 * в API и на клиенте при смене языка. Держим его в одном месте, чтобы
 * лента и страница статьи не разошлись в том, что показывают.
 */

import { languageName } from '@/lib/i18n/config';
import type { Article, LocalizedArticle } from './types';
import { findArticle, listArticles, pickHumanContent } from './registry';
import { cachedTranslation, translateArticle } from './translate';

/**
 * Последний рубеж — английский вариант.
 *
 * Важно, что здесь НЕ подставляется запрошенная локаль: текст-то английский.
 * Соврав в поле locale, мы сказали бы клиенту «вот твой тайский», и тот
 * перестал бы просить перевод, навсегда оставив читателя с чужим языком.
 * Честное 'en' — сигнал и для клиента, и для интерфейса.
 */
function fallback(article: Article): LocalizedArticle {
  const human = pickHumanContent(article, 'en') || pickHumanContent(article, article.originLocale);
  // Для языка оригинала pickHumanContent не может вернуть null: он есть в content по определению.
  return human as LocalizedArticle;
}

/**
 * @param allowModel false — вернуть только то, что готово (для ленты);
 *                   true — при необходимости перевести (для страницы статьи).
 */
export async function resolveArticle(
  article: Article,
  locale: string,
  allowModel: boolean,
): Promise<LocalizedArticle> {
  const human = pickHumanContent(article, locale);
  if (human) return human;

  const cached = await cachedTranslation(article, locale);
  if (cached) return cached;

  if (!allowModel) return fallback(article);

  try {
    const translated = await translateArticle(article, locale, languageName(locale, 'en'));
    if (translated) return translated;
  } catch (err) {
    console.error('[news/resolve] translation failed', err);
  }
  return fallback(article);
}

export async function resolveFeed(locale: string): Promise<LocalizedArticle[]> {
  return Promise.all(listArticles().map((article) => resolveArticle(article, locale, false)));
}

export async function resolveBySlug(
  slug: string,
  locale: string,
  allowModel = true,
): Promise<LocalizedArticle | null> {
  const article = findArticle(slug);
  if (!article) return null;
  return resolveArticle(article, locale, allowModel);
}
