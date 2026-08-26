import type {Metadata, Viewport} from 'next';
import { Orbitron, Roboto_Mono } from 'next/font/google';
import './globals.css';
import AuthProvider from '@/components/AuthProvider';
import AuthButton from '@/components/AuthButton';
import CloudStateSync from '@/components/CloudStateSync';
import { I18nProvider } from '@/components/I18nProvider';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import YandexMetrika from '@/components/YandexMetrika';
import SupportPanel from '@/components/SupportPanel';
import { cookies, headers } from 'next/headers';
import {
  canonicalizeLocale,
  localeDirection,
  parseAcceptLanguage,
  LOCALE_COOKIE,
} from '@/lib/i18n/config';

const orbitron = Orbitron({
  subsets: ['latin'],
  variable: '--font-hud-display',
  weight: ['400', '500', '600', '700'],
});

const robotoMono = Roboto_Mono({
  subsets: ['latin'],
  variable: '--font-hud-mono',
  weight: ['300', '400', '500'],
});

export const metadata: Metadata = {
  title: 'GAME — Reality Creator',
  description: 'Adaptive game HUD with the multilingual MAX assistant',
  applicationName: 'GAME',
  // PWA: установка на домашний экран iPhone/Android как приложение.
  appleWebApp: {
    capable: true,
    title: 'GAME',
    statusBarStyle: 'black-translucent', // контент под статус-баром — тёмный HUD
  },
  icons: {
    icon: [
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  formatDetection: { telephone: false },
};

// Тема + безопасные зоны (чёлка/динамический остров) для полноэкранного режима.
export const viewport: Viewport = {
  themeColor: '#0a0818',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default async function RootLayout({children}: {children: React.ReactNode}) {
  const cookieStore = await cookies();
  const headerStore = await headers();
  const cookieLocale = cookieStore.get(LOCALE_COOKIE)?.value;
  const acceptedLocale = parseAcceptLanguage(headerStore.get('accept-language'))[0];
  const initialLocale = canonicalizeLocale(cookieLocale || acceptedLocale);

  return (
    <html
      lang={initialLocale}
      dir={localeDirection(initialLocale)}
      className={`${orbitron.variable} ${robotoMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: `
          // Fix for "Cannot set property fetch of #<Window> which has only a getter"
          (function() {
            try {
              var originalFetch = window.fetch;
              if (typeof originalFetch !== 'function') return;
              Object.defineProperty(window, 'fetch', {
                get: function() { return originalFetch; },
                set: function(v) { 
                  console.warn('Blocked attempt to overwrite fetch'); 
                  // Don't throw, just ignore
                },
                configurable: true,
                enumerable: true
              });
            } catch (e) {
              console.error('Failed to protect fetch:', e);
            }
          })();
        ` }} />
        {/* Legacy-тег для iOS < 16.4: Next отдаёт современный mobile-web-app-capable,
            но старые iPhone понимают только apple-версию. Без него установленное
            на «Домой» приложение открывается в Safari с адресной строкой. */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <YandexMetrika />
      </head>
      <body className="font-mono bg-[#0a0818] text-white antialiased" suppressHydrationWarning>
        <I18nProvider initialLocale={initialLocale}>
          <AuthProvider>
            <CloudStateSync />
            <LanguageSwitcher />
            <AuthButton />
            {children}
            <SupportPanel />
            {/* Ссылка на политику — требование модерации Яндекс.Директа: она
                должна быть доступна с сайта. Держим ненавязчиво, поверх HUD. */}
            <a
              href="/privacy"
              className="fixed bottom-1 left-1/2 z-[51] hidden -translate-x-1/2 whitespace-nowrap text-[9px] text-white/25 transition hover:text-white/60 sm:block"
            >
              Политика конфиденциальности
            </a>
          </AuthProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
