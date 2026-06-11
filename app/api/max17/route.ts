import { spawn } from 'node:child_process';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { sendToDaemon } from './max17-daemon';

export const runtime = 'nodejs';

const ALLOWED_EVENTS = new Set([
  'user_message',
  'task_created',
  'task_completed',
  'deadline_failed',
  'terminal_error',
  'system_state',
  'environment_observation',
  'voice_observation',
  'compile_semantic',
  'meaning_tree',
  'ultra_think',
  'sleep_consolidation',
  'working_memory_reset',
  'outcome_success',
  'outcome_failure',
  'outcome_partial',
  'action_done',
  'action_skipped',
  'compress_memory',
  'graph_stats',
  'neural_seed',
  'neural_walk',
  'internal_dream',
  'generate_synergies',
  'web_research',
  'web_ingest',
  'autonomous_research',
  'ultimate_bootstrap',
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

    if (process.env.MAX17_WEB_ENABLED === 'true') {
      args.push('--web-enabled');
    }

    const child = spawn(process.env.PYTHON_BIN || 'python3', args, {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    // One-shot fallback pays a full cold start (Python + numpy import + ~52MB DB
    // open) every call, which can exceed 15s under disk contention, plus the
    // optional Gonka voice call on a user_message. Give it a generous budget so
    // the last-resort path can actually complete.
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('Max17 bridge timeout'));
    }, 45000);

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
    let result: Record<string, unknown>;
    if (process.env.MAX17_DAEMON !== 'false') {
      try {
        result = await sendToDaemon(body);
      } catch {
        // Daemon down/desynced: never hard-degrade, fall back to one-shot bridge.
        result = await runMax17Bridge(body);
      }
    } else {
      result = await runMax17Bridge(body);
    }
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
