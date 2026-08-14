import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { apiError, authorize, billingHeaders, charge } from '@/lib/api-gate';
import { CORE_PRICES, coreCost } from '@/lib/pricing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * MAX API — способности ядра, которых нет у языковых моделей.
 *
 * see       кадр разбирается математикой: палитра, свет, композиция, ритм
 *           через Фурье, геометрия схода перспективы, глубина по фактуре
 * world     тот же кадр как состояние вселенной: рождения и смерти пикселей
 *           идут в барионную асимметрию, обратно приходят законы мира
 * dream     параметры сна и ветки развития из увиденного
 * remember  запись в память с узнаванием: «это я уже видел, совпадение 0.99»
 *
 * Всё считается детерминированно, без нейросети — потому и работает на слабом
 * сервере, и потому ответ воспроизводим: одинаковый вход даёт одинаковый выход.
 */

const CORE_TIMEOUT_MS = 5 * 60_000;
const MAX_MEDIA_BYTES = 12 * 1024 * 1024;

const MEDIA_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'video/mp4': '.mp4',
};

/** Запустить ядро с событием и получить его ответ. */
function runCore(event: unknown): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const script = path.join(process.cwd(), 'mark17', 'json_cli.py');
    const child = spawn(process.env.PYTHON_BIN || 'python3', [script], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('ядро не ответило вовремя'));
    }, CORE_TIMEOUT_MS);

    child.stdout.on('data', (c) => (out += String(c)));
    child.stderr.on('data', (c) => (err += String(c)));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', () => {
      clearTimeout(timer);
      try {
        resolve(JSON.parse(out) as Record<string, unknown>);
      } catch {
        reject(new Error(err.slice(-300) || 'ядро вернуло не JSON'));
      }
    });
    child.stdin.write(JSON.stringify(event));
    child.stdin.end();
  });
}

/** Присланное изображение — во временный файл: ядро работает с путями, не с base64. */
function stageMedia(image: string, name?: string): { dir: string; file: string } {
  const m = image.match(/^data:([^;]+);base64,([\s\S]+)$/);
  const mime = (m ? m[1] : 'image/jpeg').toLowerCase();
  const buf = Buffer.from(m ? m[2] : image, 'base64');
  if (!buf.length) throw new Error('image пустой или не base64');
  if (buf.length > MAX_MEDIA_BYTES) {
    throw new Error(`Файл ${(buf.length / 1048576).toFixed(1)} МБ — больше лимита в 12 МБ`);
  }
  const ext = MEDIA_EXT[mime] || path.extname(String(name || '')).toLowerCase() || '.jpg';
  const dir = mkdtempSync(path.join(tmpdir(), 'max-api-'));
  const file = path.join(dir, `media${ext}`);
  writeFileSync(file, buf);
  return { dir, file };
}

export async function POST(request: Request, ctx: { params: Promise<{ capability: string }> }) {
  const { capability } = await ctx.params;
  if (!(capability in CORE_PRICES)) {
    return apiError(
      `Неизвестная способность «${capability}». Доступны: ${Object.keys(CORE_PRICES).join(', ')}`,
      404,
    );
  }

  const caller = await authorize(request);
  if (caller instanceof NextResponse) return caller;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return apiError('Тело запроса — не JSON', 400);
  }

  let staged: { dir: string; file: string } | null = null;
  try {
    let event: Record<string, unknown>;

    if (capability === 'see' || capability === 'world' || capability === 'dream') {
      const image = String(body.image || '').trim();
      if (!image) return apiError('Нужен image: data URL или base64', 400);
      try {
        staged = stageMedia(image, String(body.name || ''));
      } catch (error) {
        return apiError(error instanceof Error ? error.message : 'плохой image', 400);
      }
      event = {
        type: 'see',
        path: staged.file,
        eye: String(body.eye || 'auto'),
        depth: String(body.depth || 'auto'),
        ...(capability === 'dream' ? { branches: true } : {}),
      };
    } else {
      const text = String(body.text || body.note || '').trim();
      if (!text) return apiError('Нужен text — что запомнить или найти', 400);
      event = { type: 'memory_recall', text };
    }

    let result: Record<string, unknown>;
    try {
      result = await runCore(event);
    } catch (error) {
      return apiError(`Ядро не справилось: ${error instanceof Error ? error.message : String(error)}`, 502, 'api_error');
    }

    // Отдаём ровно то, за что заплатили: для каждой способности свой срез,
    // а не весь внутренний ответ ядра — он огромный и наполовину служебный.
    const vision = (result.vision || {}) as Record<string, unknown>;
    const payload: Record<string, unknown> = { capability };
    if (capability === 'see') {
      payload.text = (result.answer as { text?: string })?.text || '';
      payload.pixels = vision.pixels ?? {};
      payload.lenses = vision.lenses ?? {};
      payload.recognized = result.recognized ?? [];
      payload.seen_before = result.seen_before ?? null;
    } else if (capability === 'world') {
      payload.world = result.world ?? {};
      payload.environment = result.environment ?? {};
    } else if (capability === 'dream') {
      payload.branches = result.branches ?? {};
      payload.world = result.world ?? {};
      payload.text = (result.answer as { text?: string })?.text || '';
    } else {
      payload.memory = result.memory ?? {};
      payload.answer = (result.answer as { text?: string })?.text || '';
    }

    const cost = coreCost(capability);
    const balance = await charge(caller, { endpoint: capability, cost });
    payload.max = { cost, balance, currency: 'MIRCOIN' };
    return NextResponse.json(payload, { headers: billingHeaders(cost, balance) });
  } finally {
    if (staged) rmSync(staged.dir, { recursive: true, force: true });
  }
}
