import { cookies, headers } from 'next/headers';
import { canonicalizeLocale, LOCALE_COOKIE, parseAcceptLanguage } from '@/lib/i18n/config';

/**
 * Локаль запроса при серверном рендере — тем же порядком, что в layout.tsx:
 * кука выбора языка, затем Accept-Language. Первый экран приходит уже на
 * нужном языке, а не мигает английским до гидратации.
 */
export async function serverLocale(): Promise<string> {
  const cookieStore = await cookies();
  const headerStore = await headers();
  const fromCookie = cookieStore.get(LOCALE_COOKIE)?.value;
  const fromHeader = parseAcceptLanguage(headerStore.get('accept-language'))[0];
  return canonicalizeLocale(fromCookie || fromHeader);
}
