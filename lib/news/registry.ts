/**
 * Реестр статей. Пока это статический список в коде — раздел молодой,
 * статьи пишутся руками, и лишняя база данных здесь была бы честным
 * оверинжинирингом. Когда MAX начнёт приносить материалы сам, реестр
 * заменится на чтение из state ядра, а контракт наружу не изменится.
 */

import type { Article, LocalizedArticle } from './types';
import { baliTwoOceansDrought } from './articles/bali-two-oceans-drought';

const ARTICLES: readonly Article[] = [baliTwoOceansDrought];

/** Свежие сверху. */
export function listArticles(): Article[] {
  return [...ARTICLES].sort(
    (a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt),
  );
}

export function findArticle(slug: string): Article | undefined {
  return ARTICLES.find((article) => article.slug === slug);
}

export function articleSlugs(): string[] {
  return ARTICLES.map((article) => article.slug);
}

function baseLocale(locale: string): string {
  return locale.trim().toLowerCase().replace(/_/g, '-').split('-')[0] || 'en';
}

/**
 * Лучший из уже вычитанных руками вариантов для запрошенного языка.
 * Возвращает null, если человеческого перевода нет — тогда выше по стеку
 * включается машинный перевод.
 */
export function pickHumanContent(
  article: Article,
  locale: string,
): LocalizedArticle | null {
  const base = baseLocale(locale);
  const content = article.content[base];
  if (!content) return null;

  return {
    ...content,
    slug: article.slug,
    publishedAt: article.publishedAt,
    updatedAt: article.updatedAt,
    author: article.author,
    locale: base,
    originLocale: article.originLocale,
    translation: base === article.originLocale ? 'origin' : 'human',
    sources: article.sources,
  };
}

/** Язык, с которого переводим: английский как самый надёжный мост для модели. */
export function bridgeContent(article: Article): {
  locale: string;
  content: Article['content'][string];
} {
  const bridge = article.content.en ? 'en' : article.originLocale;
  return { locale: bridge, content: article.content[bridge] };
}
