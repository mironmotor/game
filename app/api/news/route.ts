/**
 * Новости на языке читателя.
 *
 *   GET /api/news             — лента; отдаётся мгновенно, модель не зовётся
 *   GET /api/news?slug=<...>  — статья; при необходимости переводится на лету
 *
 * Язык берётся из ?lang, затем из куки локали, затем из Accept-Language —
 * тот же порядок, что у остального сайта, чтобы раздел не спорил с HUD.
 */

import { NextResponse } from 'next/server';
import { canonicalizeLocale, LOCALE_COOKIE, parseAcceptLanguage } from '@/lib/i18n/config';
import { resolveBySlug, resolveFeed } from '@/lib/news/resolve';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function requestLocale(request: Request): string {
  const url = new URL(request.url);
  const fromQuery = url.searchParams.get('lang');
  if (fromQuery) return canonicalizeLocale(fromQuery);

  const cookie = request.headers
    .get('cookie')
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${LOCALE_COOKIE}=`));
  if (cookie) return canonicalizeLocale(decodeURIComponent(cookie.split('=')[1] || ''));

  return canonicalizeLocale(parseAcceptLanguage(request.headers.get('accept-language'))[0]);
}

export async function GET(request: Request) {
  const locale = requestLocale(request);
  const slug = new URL(request.url).searchParams.get('slug');

  try {
    if (slug) {
      const article = await resolveBySlug(slug, locale);
      if (!article) {
        return NextResponse.json({ error: 'not found' }, { status: 404 });
      }
      return NextResponse.json({ locale, article });
    }

    return NextResponse.json({ locale, articles: await resolveFeed(locale) });
  } catch (err) {
    console.error('[api/news] failed', err);
    return NextResponse.json({ error: 'news unavailable' }, { status: 500 });
  }
}
