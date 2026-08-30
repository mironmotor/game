'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useI18n } from '@/components/I18nProvider';
import { appBasePath } from '@/lib/base-path';
import type { LocalizedArticle } from '@/lib/news/types';

/**
 * Лента материалов.
 *
 * В отличие от страницы статьи, лента никогда не ждёт модель: она показывает
 * то, что уже переведено, и подтягивает остальное фоном. Список заголовков,
 * который думает полминуты, — это не список заголовков.
 */
export default function NewsFeed({ initial }: { initial: LocalizedArticle[] }) {
  const { locale, t, formatDate } = useI18n();
  const [articles, setArticles] = useState(initial);

  useEffect(() => {
    const base = locale.split('-')[0];
    if (!base || articles.every((article) => article.locale.split('-')[0] === base)) return;

    const controller = new AbortController();
    fetch(`${appBasePath}/api/news?lang=${encodeURIComponent(base)}`, { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data: { articles?: LocalizedArticle[] }) => {
        if (data.articles?.length) setArticles(data.articles);
      })
      .catch((err) => {
        if (err instanceof Error && err.name === 'AbortError') return;
        console.error('[news] feed refresh failed', err);
      });

    return () => controller.abort();
  }, [articles, locale]);

  return (
    <main className="mx-auto max-w-[760px] px-5 py-14 font-sans sm:py-20">
      <header className="border-b border-white/10 pb-8">
        <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-cyan-300/60">mir.care</p>
        <h1 className="mt-2 font-[family-name:var(--font-hud-display)] text-[32px] font-bold text-white sm:text-[42px]">
          {t('news.section')}
        </h1>
        <p className="mt-3 max-w-[52ch] text-[15px] leading-relaxed text-white/50">{t('news.tagline')}</p>
      </header>

      {articles.length === 0 ? (
        <p className="mt-12 text-[15px] text-white/40">{t('news.empty')}</p>
      ) : (
        <ol className="mt-10 space-y-10">
          {articles.map((article) => (
            <li key={article.slug}>
              <Link href={`/news/${article.slug}`} className="group block">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] uppercase tracking-[0.16em] text-white/35">
                  <time dateTime={article.publishedAt}>{formatDate(new Date(article.publishedAt))}</time>
                  <span>· {article.author}</span>
                  {article.translation === 'machine' ? (
                    <span className="text-amber-200/50">· {t('news.machineTranslated')}</span>
                  ) : null}
                </div>

                <h2 className="mt-2 font-[family-name:var(--font-hud-display)] text-[22px] font-semibold leading-snug text-white transition group-hover:text-cyan-200 sm:text-[26px]">
                  {article.title}
                </h2>

                <p className="mt-2 text-[15px] leading-[1.65] text-white/55">{article.dek}</p>

                <div className="mt-3 flex flex-wrap gap-2">
                  {article.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full border border-white/10 px-2.5 py-0.5 font-mono text-[11px] text-white/40"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}
