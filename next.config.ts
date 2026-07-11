import type {NextConfig} from 'next';

const staticExport = process.env.NEXT_OUTPUT === 'export';

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
  basePath: '/game',
  assetPrefix: '/game',
  transpilePackages: ['motion'],
  experimental: {
    webpackBuildWorker: false,
  },
};

export default nextConfig;
