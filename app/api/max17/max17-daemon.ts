import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';

// Persistent client for mark17/serve.py. One long-lived python process per
// Node worker keeps numpy/modules imported and all SQLite stores open, instead
// of paying that cost on every request like the one-shot json_cli.py path.
//
// The python loop is strictly serial (one line in -> one line out), so requests
// are matched to responses FIFO via a queue. A single bad/slow request kills the
// daemon; the next request lazily respawns it.
//
// Cold start (Python + numpy import + opening the ~52MB synapse graph DB) costs
// several seconds and can spike under disk contention; once that boot finishes,
// every request is sub-second. So the very first request after a (re)spawn gets a
// generous COLD budget, and warm requests get a tight WARM budget. Pre-spawning
// the process at server startup (see warmUpDaemon + instrumentation.ts) means the
// boot happens before the user's first message, not on its critical path.

const COLD_TIMEOUT_MS = 120000;
// Warm requests are usually sub-second, but a user_message does a remote LLM call
// through a fallback ladder (MiniMax -> Qwen -> Gemini), each up to ~25s, so worst
// case is ~75s when a broker is degraded. The budget MUST clear that — otherwise a
// merely-slow message trips teardown and kills the daemon (= "мост не работает"),
// turning a slow reply into a hard outage + cold respawn on every message.
const WARM_TIMEOUT_MS = 90000;

type Pending = {
  resolve: (value: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

type DaemonRuntime = {
  child: ChildProcessWithoutNullStreams | null;
  queue: Pending[];
  stdoutBuffer: string;
  warmedUp: boolean;
};

// Next dev reloads route modules without necessarily terminating child
// processes. Keep the daemon runtime on globalThis so HMR reuses the same
// Python process instead of leaking another serve.py on every route reload.
const globalRuntime = globalThis as typeof globalThis & {
  __max17DaemonRuntime?: DaemonRuntime;
};
const runtime = globalRuntime.__max17DaemonRuntime ??= {
  child: null,
  queue: [],
  stdoutBuffer: '',
  warmedUp: false,
};

function teardown(error: Error): void {
  const dying = runtime.child;
  const pending = runtime.queue;
  runtime.child = null;
  runtime.queue = [];
  runtime.stdoutBuffer = '';
  runtime.warmedUp = false;
  for (const p of pending) {
    clearTimeout(p.timer);
    p.reject(error);
  }
  if (dying) {
    try {
      dying.kill('SIGTERM');
    } catch {
      // already gone
    }
  }
}

function start(): ChildProcessWithoutNullStreams {
  const scriptPath = path.join(process.cwd(), 'mark17', 'serve.py');
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

  const proc = spawn(process.env.PYTHON_BIN || 'python3', args, {
    cwd: process.cwd(),
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', (chunk: string) => {
    runtime.stdoutBuffer += chunk;
    let newline = runtime.stdoutBuffer.indexOf('\n');
    while (newline >= 0) {
      const line = runtime.stdoutBuffer.slice(0, newline).trim();
      runtime.stdoutBuffer = runtime.stdoutBuffer.slice(newline + 1);
      newline = runtime.stdoutBuffer.indexOf('\n');
      if (!line) {
        continue;
      }
      const pending = runtime.queue.shift();
      if (!pending) {
        continue;
      }
      clearTimeout(pending.timer);
      try {
        const parsed = JSON.parse(line) as Record<string, unknown>;
        runtime.warmedUp = true; // a real response means boot is complete
        pending.resolve(parsed);
      } catch (error) {
        pending.reject(new Error(`Invalid Max17 daemon response: ${String(error)}`));
        // A malformed line means request/response alignment is lost; restart.
        teardown(new Error('Max17 daemon desynchronized'));
        return;
      }
    }
  });

  proc.on('error', (error) => teardown(error instanceof Error ? error : new Error(String(error))));
  proc.on('close', (code) => teardown(new Error(`Max17 daemon exited (code ${code ?? 'null'})`)));

  return proc;
}

/**
 * Spawn the daemon ahead of time so the heavy Python/numpy import + ~52MB DB
 * open happens before the user's first message instead of on its critical path.
 * Fire-and-forget and never throws: if the spawn fails, the next sendToDaemon
 * retries and route.ts still has the one-shot fallback. Idempotent.
 */
export function warmUpDaemon(): void {
  try {
    if (!runtime.child) {
      runtime.child = start();
    }
  } catch {
    // Non-fatal: lazy spawn / one-shot fallback still cover the request path.
  }
}

// Warm up as soon as this module loads. It is only imported by the Node-runtime
// route handler, so the first request to /api/max17 triggers the spawn here —
// the boot then overlaps with the request instead of being paid serially. We do
// this at module scope (rather than in instrumentation.ts) so node:child_process
// never enters the Edge bundle graph. Guarded so `next build` doesn't spawn it.
if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.MAX17_DAEMON !== 'false') {
  warmUpDaemon();
}

/** Cheap synchronous snapshot of daemon liveness for the health dashboard. */
export function daemonStatus(): { alive: boolean; warmedUp: boolean; queueDepth: number } {
  return {
    alive: runtime.child !== null,
    warmedUp: runtime.warmedUp,
    queueDepth: runtime.queue.length,
  };
}

/**
 * Tear down any existing (possibly wedged/cold) daemon and spawn a fresh one, so
 * the next request is served by a clean warm process instead of a slow one-shot.
 * This is the "rewarm_daemon" auto-fix surfaced by the Doctor dashboard.
 */
export function rewarmDaemon(): { ok: boolean; respawned: boolean } {
  try {
    teardown(new Error('Max17 daemon rewarm requested'));
  } catch {
    // already gone
  }
  try {
    warmUpDaemon();
    return { ok: runtime.child !== null, respawned: true };
  } catch {
    return { ok: false, respawned: false };
  }
}

export function sendToDaemon(event: unknown): Promise<Record<string, unknown>> {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    if (!runtime.child) {
      runtime.child = start();
    }
    const proc = runtime.child;

    // First request after a (re)spawn may still be booting -> generous budget;
    // once warm, every request is sub-second so a tight budget keeps the UI snappy.
    const timeoutMs = runtime.warmedUp ? WARM_TIMEOUT_MS : COLD_TIMEOUT_MS;
    const timer = setTimeout(() => {
      reject(new Error('Max17 daemon timeout'));
      teardown(new Error('Max17 daemon timeout'));
    }, timeoutMs);

    runtime.queue.push({ resolve, reject, timer });

    try {
      proc.stdin.write(`${JSON.stringify(event)}\n`);
    } catch (error) {
      clearTimeout(timer);
      runtime.queue.pop();
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
