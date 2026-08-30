import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import ArticleView from '@/components/news/ArticleView';
import { articleSlugs, findArticle, pickHumanContent } from '@/lib/news/registry';
import { resolveBySlug } from '@/lib/news/resolve';
import { serverLocale } from '@/lib/news/server-locale';

export const dynamic = 'force-dynamic';

export function generateStaticParams() {
  return articleSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const article = findArticle(slug);
  if (!article) return { title: 'Новости — mir.care' };

  // Для метаданных берём только человеческий текст: описание страницы не то
  // место, ради которого стоит будить модель на каждом обходе робота.
  const locale = await serverLocale();
  const content = pickHumanContent(article, locale) || pickHumanContent(article, 'en');

  return {
    title: `${content?.title ?? article.slug} — mir.care`,
    description: content?.dek,
    openGraph: {
      type: 'article',
      title: content?.title,
      description: content?.dek,
      publishedTime: article.publishedAt,
      authors: [article.author],
      tags: content?.tags,
    },
  };
}

export default async function ArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const locale = await serverLocale();
  // allowModel: false — сервер отдаёт то, что готово, и не ждёт перевода.
  // Иначе первый читатель на новом языке смотрит в пустой экран, пока модель
  // переводит всю статью. Перевод догоняет уже на клиенте, поверх текста,
  // который человек в это время читает.
  const article = await resolveBySlug(slug, locale, false);
  if (!article) notFound();

  return (
    <div className="min-h-screen bg-[#0a0818]">
      <ArticleView initial={article} />
    </div>
  );
}
