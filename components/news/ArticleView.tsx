'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useI18n } from '@/components/I18nProvider';
import { languageName } from '@/lib/i18n/config';
import { appBasePath } from '@/lib/base-path';
import type { LocalizedArticle } from '@/lib/news/types';
import ArticleBody from './ArticleBody';

/**
 * Статья, которая догоняет язык читателя.
 *
 * Сервер отдаёт вариант на локали запроса — этого достаточно для первого
 * экрана и для поисковых роботов. Но настоящий язык читателя может отличаться:
 * он мог выбрать его руками, и выбор лежит в localStorage, куда сервер не
 * заглядывает. Поэтому после гидратации компонент сверяет язык и, если тот
 * другой, просит перевод у ядра.
 */
export default function ArticleView({ initial }: { initial: LocalizedArticle }) {
  const { locale, t, formatDate } = useI18n();
  const [article, setArticle] = useState(initial);
  /** Языки, на которые перевести не вышло: второй раз не просим. */
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set<string>());

  const wanted = locale.split('-')[0];
  const shown = article.locale.split('-')[0];
  // Состояние «переводим» не хранится, а выводится: язык читателя ещё не
  // совпал с языком текста, и на этом языке мы пока не спотыкались. Отдельный
  // флаг здесь означал бы setState прямо в теле эффекта и лишний каскад
  // перерисовок — React об этом честно предупреждает.
  const translating = Boolean(wanted) && wanted !== shown && !failed.has(wanted);

  useEffect(() => {
    if (!translating) return;

    const controller = new AbortController();
    fetch(
      `${appBasePath}/api/news?slug=${encodeURIComponent(initial.slug)}&lang=${encodeURIComponent(wanted)}`,
      { signal: controller.signal },
    )
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data: { article?: LocalizedArticle }) => {
        if (!data.article) throw new Error('empty payload');
        // Ядро могло не справиться и вернуть английский запасной вариант —
        // тогда помечаем язык как несостоявшийся, чтобы не долбить его в цикле.
        if (data.article.locale.split('-')[0] !== wanted) {
          setFailed((prev) => new Set(prev).add(wanted));
        }
        setArticle(data.article);
      })
      .catch((err) => {
        if (err instanceof Error && err.name === 'AbortError') return;
        console.error('[news] translation request failed', err);
        setFailed((prev) => new Set(prev).add(wanted));
      });

    return () => controller.abort();
  }, [initial.slug, translating, wanted]);

  const published = new Date(article.publishedAt);
  const minutes = Math.max(1, Math.round(readingLength(article) / 900));

  return (
    <article className="mx-auto max-w-[720px] px-5 py-14 font-sans sm:py-20">
      <Link
        href="/news"
        className="font-mono text-[11px] uppercase tracking-[0.25em] text-cyan-300/60 transition hover:text-cyan-200"
      >
        ← {t('news.backToFeed')}
      </Link>

      <h1 className="mt-6 font-[family-name:var(--font-hud-display)] text-[28px] font-bold leading-[1.2] text-white sm:text-[38px]">
        {article.title}
      </h1>

      <p className="mt-4 text-[17px] leading-[1.6] text-white/60 sm:text-[18px]">{article.dek}</p>

      <div className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-white/10 pt-4 font-mono text-[12px] uppercase tracking-[0.08em] text-white/40">
        <span className="text-white/70">{article.author}</span>
        <span>· {t('news.correspondent')} mir.care</span>
        <span>· {formatDate(published)}</span>
        <span>· {t('news.readingTime', { minutes })}</span>
      </div>

      {article.translation === 'machine' ? (
        <p className="mt-4 rounded-lg border border-amber-400/20 bg-amber-400/[0.05] px-4 py-3 text-[12.5px] leading-relaxed text-amber-100/70">
          <b className="font-semibold text-amber-100/90">{t('news.machineTranslated')}.</b>{' '}
          {t('news.machineTranslatedNote', { language: languageName(article.originLocale, locale) })}
        </p>
      ) : null}

      {translating ? (
        <p className="mt-4 animate-pulse font-mono text-[12px] uppercase tracking-[0.2em] text-cyan-300/50">
          {t('news.translating')}
        </p>
      ) : null}

      <ArticleBody blocks={article.blocks} />

      <section className="mt-14 border-t border-white/10 pt-6">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.25em] text-cyan-300/60">
          {t('news.sources')}
        </h2>
        <ol className="mt-4 space-y-3">
          {article.sources.map((source) => (
            <li key={source.url} className="text-[13px] leading-relaxed text-white/50">
              <span className="text-white/70">{source.org}</span> —{' '}
              <a
                href={source.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-cyan-300/80 underline decoration-cyan-300/30 underline-offset-2 transition hover:text-cyan-200"
              >
                {source.title}
              </a>
            </li>
          ))}
        </ol>
      </section>
    </article>
  );
}

/** Грубая оценка объёма в символах — хватает, чтобы посчитать минуты чтения. */
function readingLength(article: LocalizedArticle): number {
  return article.blocks.reduce((total, block) => {
    switch (block.kind) {
      case 'p':
      case 'h2':
        return total + block.text.length;
      case 'list':
        return total + block.items.join(' ').length;
      case 'quote':
        return total + block.text.length;
      case 'stat':
        return total + block.label.length + (block.note?.length ?? 0);
      case 'note':
        return total + block.title.length + block.text.length;
      default:
        return total;
    }
  }, article.title.length + article.dek.length);
}
