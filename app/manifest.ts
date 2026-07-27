import type { MetadataRoute } from 'next';

/**
 * PWA-манифест mir.care. Даёт «установку» на домашний экран: своя иконка,
 * запуск в полный экран без браузерной обвязки — как обычное приложение.
 * Работает и на iPhone (Safari → Поделиться → «На экран Домой»), и на Android.
 *
 * Это же — фундамент для будущей сборки под App Store (иконки/имя/цвета).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'GAME — Reality Creator',
    short_name: 'GAME',
    description: 'GAME — живой HUD с ассистентом MAX: память, голос и агенты, которые ведут твой день.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#0a0818',
    theme_color: '#0a0818',
    lang: 'ru',
    categories: ['productivity', 'education', 'lifestyle'],
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
