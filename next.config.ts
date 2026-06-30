import type {NextConfig} from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
    remotePatterns: [
      { protocol: 'https', hostname: 'picsum.photos', port: '', pathname: '/**' },
      { protocol: 'https', hostname: 'lh3.googleusercontent.com', port: '', pathname: '/**' },
      { protocol: 'https', hostname: 'images.unsplash.com', port: '', pathname: '/**' },
    ],
  },
  output: 'export',
  basePath: '/game',
  assetPrefix: '/game',
  // Exposed to the client so raw fetch() calls (e.g. /api/max17) can prepend it,
  // since basePath is NOT auto-applied to fetch.
  env: { NEXT_PUBLIC_BASE_PATH: '/game' },
  transpilePackages: ['motion'],
};

export default nextConfig;
