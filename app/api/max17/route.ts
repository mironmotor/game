import { spawn } from 'node:child_process';
import path from 'node:path';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 60;

const ALLOWED_EVENTS = new Set([
  'user_message',
  'task_created',
  'task_completed',
  'deadline_failed',
  'terminal_error',
  'system_state',
  'sleep_consolidation',
  'voice_state',
  'world_state',
  'agent_tick',
  'agent_state',
  'auto_plan',
  'synapse_graph',
  'big_idea',
  'simulation',
  'ingest',
  'decode',
  'introspect',
  'physics',
  'web',
  'compress_similar',
  'act',
]);

const DEFAULT_RESPONSE = {
  route: 'error',
  memory: {},
  plasticity: {},
  llm: {},
  confidence: 0,
  next_adaptation: 'No adaptation proposed.',
};

function errorResponse(message: string, status = 400, details?: unknown) {
  return NextResponse.json(
    {
      ok: false,
      ...DEFAULT_RESPONSE,
      error: message,
      details,
    },
    { status },
  );
}

function runMax17Bridge(event: unknown) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const scriptPath = path.join(process.cwd(), 'mark17', 'json_cli.py');
    const args = [scriptPath];
    const stateDir = process.env.MAX17_STATE_DIR;

    if (stateDir) {
      args.push('--state-dir', stateDir);
    }

    if (process.env.MAX17_LLM_ENABLED !== 'true') {
      args.push('--no-llm');
    }

    const child = spawn(process.env.PYTHON_BIN || 'python3', args, {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('Max17 bridge timeout'));
    }, 15000);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    child.on('close', (code) => {
      clearTimeout(timeout);
      const line = stdout.trim().split('\n').filter(Boolean).at(-1);
      if (!line) {
        reject(new Error(stderr || `Max17 exited with code ${code}`));
        return;
      }

      try {
        const payload = JSON.parse(line);
        if (code !== 0 && !payload.error) {
          payload.error = stderr || `Max17 exited with code ${code}`;
        }
        resolve(payload);
      } catch (error) {
        reject(new Error(`Invalid Max17 JSON response: ${String(error)}`));
      }
    });

    child.stdin.end(JSON.stringify(event));
  });
}

// Временный тестовый фолбэк: если env моста не заданы, на Vercel берём адрес
// Мак-туннеля из bridge.fallback.json. Env всегда побеждает; в dev не участвует
// (там события идут через локальный python3).
import bridgeFallback from './bridge.fallback.json';

function fallbackBridge(): { url: string; token: string } {
  if (!process.env.VERCEL) return { url: '', token: '' };
  return {
    url: String(bridgeFallback.url || ''),
    token: String(bridgeFallback.token || ''),
  };
}

function remoteBridgeUrl() {
  return (process.env.MAX17_REMOTE_BRIDGE_URL || process.env.MAX17_BRIDGE_URL || fallbackBridge().url)
    .trim()
    .replace(/\/+$/, '');
}

/**
 * Откуда взялся адрес моста.
 *
 * Различать это важнее, чем кажется. «Мост не отвечает» и «мост не отвечает,
 * потому что адрес взят из запасного файла в репозитории, а env для этого
 * окружения никто не задавал» — разные сообщения: по первому непонятно, что
 * делать, а по второму понятно сразу. Именно на этом здесь уже спотыкались:
 * переменные ставились только в production, превью молча брало прошлый
 * туннель из файла и падало.
 */
function bridgeSource(): 'env' | 'fallback-file' | 'none' {
  if ((process.env.MAX17_REMOTE_BRIDGE_URL || process.env.MAX17_BRIDGE_URL || '').trim()) return 'env';
  if (fallbackBridge().url) return 'fallback-file';
  return 'none';
}

/** Что именно делать при такой поломке — одной фразой, без гадания. */
function bridgeHint(source: ReturnType<typeof bridgeSource>): string {
  const env = process.env.VERCEL_ENV || 'development';
  if (source === 'fallback-file') {
    return `MAX17_BRIDGE_URL не задан для окружения «${env}», поэтому адрес взят из запасного файла в репозитории — а там прошлый туннель, которого уже нет. Перезапусти mark17/run_bridge_mac.sh: он пропишет адрес и в production, и в preview. После этого превью нужно пересобрать — переменные подхватываются в момент сборки.`;
  }
  if (source === 'env') {
    return `Адрес взят из переменных окружения «${env}», но мост по нему не отвечает: туннель закрылся, Мак уснул или скрипт остановлен. Быстрые cloudflare-туннели живут только пока запущен скрипт, и при каждом запуске адрес новый.`;
  }
  return 'Адреса моста нет вообще. Локально события идут через python3, на Vercel нужен MAX17_BRIDGE_URL.';
}

// Диагностика моста: POST {type:"bridge_health"} — сконфигурирован ли удалённый
// мост и жив ли он. (GET нельзя: ломает output:export для GitHub Pages.)
async function bridgeHealth() {
  const base = remoteBridgeUrl();
  if (!base) {
    return NextResponse.json({
      ok: true,
      bridge: 'local-python',
      configured: false,
      hint: 'MAX17_BRIDGE_URL не задан — события пойдут через локальный python3 (работает в `npm run dev`; на Vercel задай MAX17_BRIDGE_URL + MAX17_BRIDGE_TOKEN в env и сделай Redeploy).',
    });
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(`${base}/health`, { signal: controller.signal });
    const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return NextResponse.json({
      ok: res.ok && payload.ok !== false,
      bridge: 'remote',
      configured: true,
      reachable: res.ok,
      source: bridgeSource(),
      environment: process.env.VERCEL_ENV || 'development',
      url_host: new URL(base).host,
      remote: payload,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        bridge: 'remote',
        configured: true,
        reachable: false,
        source: bridgeSource(),
        environment: process.env.VERCEL_ENV || 'development',
        url_host: (() => { try { return new URL(base).host; } catch { return base; } })(),
        error: error instanceof Error ? error.message : String(error),
        hint: bridgeHint(bridgeSource()),
      },
      { status: 502 },
    );
  } finally {
    clearTimeout(timeout);
  }
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;

  try {
    const parsed = await request.json();
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return errorResponse('Request body must be a JSON object');
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return errorResponse('Invalid JSON body');
  }

  const eventType = String(body.type || body.event || '');
  if (eventType === 'bridge_health') {
    return bridgeHealth();
  }
  if (!ALLOWED_EVENTS.has(eventType)) {
    return errorResponse(`Unsupported event type: ${eventType || '(missing)'}`, 400, {
      allowed: Array.from(ALLOWED_EVENTS),
    });
  }

  try {
    // On a hosted frontend (e.g. Vercel) there is no python3 to spawn, so proxy
    // the event to a remote Max17 bridge (mark17/server.py) when configured.
    // Locally (`npm run dev`), MAX17_BRIDGE_URL is unset and we spawn python3.
    const result = remoteBridgeUrl()
      ? await proxyToRemoteBridge(body)
      : await runMax17Bridge(body);
    const status = result.ok === false ? 502 : 200;
    return NextResponse.json(
      {
        ...DEFAULT_RESPONSE,
        ...result,
      },
      { status },
    );
  } catch (error) {
    // «Max17 bridge failed / fetch failed» само по себе не говорит ничего: по
    // нему нельзя отличить незаданный адрес от закрытого туннеля. Поэтому к
    // ошибке прикладывается источник адреса, окружение и что именно делать.
    const source = bridgeSource();
    return NextResponse.json(
      {
        ok: false,
        ...DEFAULT_RESPONSE,
        error: 'Max17 bridge failed',
        details: error instanceof Error ? error.message : String(error),
        source,
        environment: process.env.VERCEL_ENV || 'development',
        url_host: (() => { try { return new URL(remoteBridgeUrl()).host; } catch { return ''; } })(),
        hint: bridgeHint(source),
      },
      { status: 502 },
    );
  }
}

async function proxyToRemoteBridge(event: unknown): Promise<Record<string, unknown>> {
  const base = remoteBridgeUrl();
  const token = process.env.MAX17_REMOTE_BRIDGE_TOKEN || process.env.MAX17_BRIDGE_TOKEN || fallbackBridge().token || undefined;
  const bridgePath =
    process.env.MAX17_BRIDGE_PATH || (process.env.MAX17_REMOTE_BRIDGE_URL ? '/api/max17' : '/event');
  const controller = new AbortController();
  // Мост ждёт чуть дольше, чем ядро ждёт провайдера (MAX17_LLM_TIMEOUT_SEC,
  // по умолчанию 20 с), — чтобы обрыв случался на стороне ядра, с осмысленным
  // фолбэком, а не здесь голым таймаутом. Потолок оставлен прежним на случай
  // явно долгих операций вроде сна-консолидации.
  const timeoutMs = Math.min(
    Number(process.env.MAX17_REMOTE_BRIDGE_TIMEOUT_MS || process.env.MAX17_BRIDGE_TIMEOUT_MS || 28000),
    55000,
  );
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}${bridgePath.startsWith('/') ? bridgePath : `/${bridgePath}`}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}`, 'x-max17-bridge-token': token } : {}),
      },
      body: JSON.stringify(event),
      signal: controller.signal,
    });
    const payload = (await res.json()) as Record<string, unknown>;
    if (!res.ok && !payload.error) {
      payload.error = `Remote Max17 bridge returned ${res.status}`;
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}
