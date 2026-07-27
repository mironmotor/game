import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

// Reveal a project-relative path in macOS Finder. `open -R <file>` selects the
// file in Finder; a directory is opened directly. Locked to the project root so
// it can never reveal anything outside cwd. Gated by the shared token (like the
// other OS-touching routes) since it launches a local process.
export async function POST(request: Request) {
  const requiredToken = process.env.MAX17_API_TOKEN;
  if (requiredToken && request.headers.get('x-max17-token') !== requiredToken) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  let rel = '';
  try {
    const body = (await request.json()) as { path?: unknown };
    rel = String(body.path ?? '').trim();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!rel) {
    return NextResponse.json({ ok: false, error: 'Пустой путь' }, { status: 400 });
  }

  const root = process.cwd();
  const target = path.resolve(root, rel);
  if (target !== root && !target.startsWith(root + path.sep)) {
    return NextResponse.json({ ok: false, error: 'Путь вне каталога проекта' }, { status: 400 });
  }

  let isDir = false;
  try {
    isDir = (await stat(target)).isDirectory();
  } catch {
    return NextResponse.json({ ok: false, error: 'Путь не найден' }, { status: 404 });
  }

  try {
    await new Promise<void>((resolve, reject) => {
      // Directory -> open it; file -> reveal (-R) so Finder highlights it.
      const args = isDir ? [target] : ['-R', target];
      execFile('open', args, (err) => (err ? reject(err) : resolve()));
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }

  return NextResponse.json({ ok: true, target, isDir });
}
