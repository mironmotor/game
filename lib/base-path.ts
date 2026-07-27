const DEFAULT_BASE_PATH = '/game';

export function normalizeBasePath(value: string | undefined): string {
  const basePath = value ?? DEFAULT_BASE_PATH;
  if (!basePath || basePath === '/') return '';

  const withLeadingSlash = basePath.startsWith('/') ? basePath : `/${basePath}`;
  return withLeadingSlash.replace(/\/$/, '');
}

export const appBasePath = normalizeBasePath(process.env.NEXT_PUBLIC_BASE_PATH);
export const authBasePath = `${appBasePath}/api/auth`;
