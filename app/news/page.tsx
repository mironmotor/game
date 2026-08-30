import type { Metadata } from 'next';
import NewsFeed from '@/components/news/NewsFeed';
import { resolveFeed } from '@/lib/news/resolve';
import { serverLocale } from '@/lib/news/server-locale';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Новости — mir.care',
  description: 'Проверяемые данные о том, что происходит с планетой. Материалы mir.care на языке читателя.',
};

export default async function NewsPage() {
  const locale = await serverLocale();
  const articles = await resolveFeed(locale);

  return (
    <div className="min-h-screen bg-[#0a0818]">
      <NewsFeed initial={articles} />
    </div>
  );
}
