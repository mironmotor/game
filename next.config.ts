import type {NextConfig} from 'next';

// Vercel serves the full app at the domain root (real API routes). GitHub
// Pages serves a static export under the /game sub-path (no server). Every
// other invocation — `npm run dev`, a plain `npm run build` — should behave
// like the real app: root path, no static export.
//
// The GitHub Pages build opts in explicitly via GITHUB_PAGES_EXPORT. This
// used to be inferred from "VERCEL is unset", which also matched plain local
// `next dev`/`next build` — so `npm run dev` served everything under /game
// and 404'd on the exact http://localhost:3000 URL the README tells people
// to open. Only the Pages workflow sets this now; see
// .github/workflows/deploy.yml.
const isGithubPagesExport = !!process.env.GITHUB_PAGES_EXPORT;
const basePath = isGithubPagesExport ? '/game' : '';

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
  // Static export only for the GitHub Pages path; every other target runs
  // the app natively (dev server or Vercel's serverless build).
  ...(isGithubPagesExport ? { output: 'export' as const, basePath, assetPrefix: basePath } : {}),
  // Exposed to the client so raw fetch() calls (e.g. /api/max17) can prepend it,
  // since basePath is NOT auto-applied to fetch.
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
  transpilePackages: ['motion'],
};

export default nextConfig;
