import { createReadStream, existsSync, statSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

/**
 * Отдача присланного кадра по идентификатору.
 *
 * Нужен для двух вещей: показать человеку то, на что MAX смотрел, и дать руке
 * (агенту на маке) возможность скачать кадр и посмотреть на него своими глазами —
 * локальная модель зрения занимает 5.6 ГБ из восьми и всё равно додумывает.
 *
 * Безопасность: параметр — ТОЛЬКО имя файла. Никаких путей: и «..», и слэш
 * отвергаются до обращения к диску, а итоговый путь дополнительно сверяется с
 * корнем загрузок. Роут открыт без авторизации, как и весь /api/max17, поэтому
 * имена файлов делаются неугадываемыми (время + случайный хвост).
 */

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
};

function uploadsRoot(): string {
  return process.env.MAX17_UPLOADS_ROOT || path.join(process.cwd(), 'mark17', 'state', 'uploads');
}

/** Ищет файл в дневных папках, начиная со свежих: кадров за день немного. */
function locate(name: string): string | null {
  const root = uploadsRoot();
  if (!existsSync(root)) return null;
  let days: string[] = [];
  try {
    days = readdirSync(root).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().reverse();
  } catch {
    return null;
  }
  for (const day of days.slice(0, 60)) {
    const candidate = path.join(root, day, name);
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const name = String(id || '');
  // Отсекаем любые попытки уйти из каталога ДО работы с диском.
  if (!name || name.includes('/') || name.includes('\\') || name.includes('..') || name.length > 128) {
    return NextResponse.json({ ok: false, error: 'bad id' }, { status: 400 });
  }

  const file = locate(name);
  if (!file || !path.resolve(file).startsWith(path.resolve(uploadsRoot()))) {
    return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 });
  }

  const ext = path.extname(file).toLowerCase();
  const stream = createReadStream(file);
  return new NextResponse(stream as unknown as ReadableStream, {
    headers: {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': String(statSync(file).size),
      'Cache-Control': 'private, max-age=3600',
    },
  });
}
