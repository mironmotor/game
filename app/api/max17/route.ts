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
  'auto_plan',
  'synapse_graph',
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

function remoteBridgeUrl() {
  return (process.env.MAX17_REMOTE_BRIDGE_URL || process.env.MAX17_BRIDGE_URL || '').trim().replace(/\/+$/, '');
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
    return errorResponse('Max17 bridge failed', 502, error instanceof Error ? error.message : String(error));
  }
}

async function proxyToRemoteBridge(event: unknown): Promise<Record<string, unknown>> {
  const base = remoteBridgeUrl();
  const token = process.env.MAX17_REMOTE_BRIDGE_TOKEN || process.env.MAX17_BRIDGE_TOKEN;
  const bridgePath =
    process.env.MAX17_BRIDGE_PATH || (process.env.MAX17_REMOTE_BRIDGE_URL ? '/api/max17' : '/event');
  const controller = new AbortController();
  const timeoutMs = Math.min(
    Number(process.env.MAX17_REMOTE_BRIDGE_TIMEOUT_MS || process.env.MAX17_BRIDGE_TIMEOUT_MS || 55000),
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
