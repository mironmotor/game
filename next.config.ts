import type {NextConfig} from 'next';

const staticExport = process.env.NEXT_OUTPUT === 'export';
const isVercel = Boolean(process.env.VERCEL);
// GAME_BASE_PATH развязывает пути от флага VERCEL: на mir.care (корень) задаётся
// GAME_BASE_PATH= (пусто) в .env.local сервера; локалка живёт на /game как раньше.
// Не задан ⇒ прежнее поведение (Vercel → корень, иначе /game).
const basePath =
  process.env.GAME_BASE_PATH !== undefined
    ? process.env.GAME_BASE_PATH.trim()
    : isVercel
      ? ''
      : '/game';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  images: {
    unoptimized: true,
    remotePatterns: [
      { protocol: 'https', hostname: 'picsum.photos', port: '', pathname: '/**' },
      { protocol: 'https', hostname: 'lh3.googleusercontent.com', port: '', pathname: '/**' },
      { protocol: 'https', hostname: 'images.unsplash.com', port: '', pathname: '/**' },
    ],
  },
  ...(staticExport ? { output: 'export' as const } : {}),
  ...(basePath ? { basePath, assetPrefix: basePath } : {}),
  env: { NEXT_PUBLIC_BASE_PATH: basePath || '/' },
  transpilePackages: ['motion'],
  experimental: {
    webpackBuildWorker: false,
  },
};

export default nextConfig;
