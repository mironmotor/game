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
  // Server mode (no output: 'export') so Route Handlers under app/api/**
  // (Max17 bridge, etc.) actually execute on Vercel instead of 404ing as
  // static files. Vercel auto-detects Next.js and runs it as a Node
  // serverless app; no vercel.json/firebase.json in this repo pin a static
  // build, so this doesn't require any deploy-config changes.
  basePath: '/game',
  assetPrefix: '/game',
  transpilePackages: ['motion'],
};

export default nextConfig;
