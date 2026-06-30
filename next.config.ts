import type {NextConfig} from 'next';

// On Vercel the app is served at the domain root and as a full Next.js app
// (serverless functions available). On GitHub Pages it is a static export living
// under the /game sub-path. Detect Vercel and switch accordingly.
const isVercel = !!process.env.VERCEL;
const basePath = isVercel ? '' : '/game';

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
  // Static export only for the GitHub Pages path; Vercel runs the app natively.
  ...(isVercel ? {} : { output: 'export' as const, basePath, assetPrefix: basePath }),
  // Exposed to the client so raw fetch() calls (e.g. /api/max17) can prepend it,
  // since basePath is NOT auto-applied to fetch.
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
  transpilePackages: ['motion'],
};

export default nextConfig;
