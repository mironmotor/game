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

const COLD_TIMEOUT_MS = 45000;
// Warm requests are usually sub-second, but when the Gonka voice layer is on
// (GONKA_API_KEY set) a user_message also does a remote Qwen3 call (~2-6s, up to
// ~25s worst case), so the warm budget has to clear that, not just the graph.
const WARM_TIMEOUT_MS = 30000;

type Pending = {
  resolve: (value: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

let child: ChildProcessWithoutNullStreams | null = null;
let queue: Pending[] = [];
let stdoutBuffer = '';
// Flips true after the current child answers its first request, i.e. boot is done.
let warmedUp = false;

function teardown(error: Error): void {
  const dying = child;
  const pending = queue;
  child = null;
  queue = [];
  stdoutBuffer = '';
  warmedUp = false;
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
    stdoutBuffer += chunk;
    let newline = stdoutBuffer.indexOf('\n');
    while (newline >= 0) {
      const line = stdoutBuffer.slice(0, newline).trim();
      stdoutBuffer = stdoutBuffer.slice(newline + 1);
      newline = stdoutBuffer.indexOf('\n');
      if (!line) {
        continue;
      }
      const pending = queue.shift();
      if (!pending) {
        continue;
      }
      clearTimeout(pending.timer);
      try {
        const parsed = JSON.parse(line) as Record<string, unknown>;
        warmedUp = true; // a real response means boot is complete
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
    if (!child) {
      child = start();
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

export function sendToDaemon(event: unknown): Promise<Record<string, unknown>> {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    if (!child) {
      child = start();
    }
    const proc = child;

    // First request after a (re)spawn may still be booting -> generous budget;
    // once warm, every request is sub-second so a tight budget keeps the UI snappy.
    const timeoutMs = warmedUp ? WARM_TIMEOUT_MS : COLD_TIMEOUT_MS;
    const timer = setTimeout(() => {
      reject(new Error('Max17 daemon timeout'));
      teardown(new Error('Max17 daemon timeout'));
    }, timeoutMs);

    queue.push({ resolve, reject, timer });

    try {
      proc.stdin.write(`${JSON.stringify(event)}\n`);
    } catch (error) {
      clearTimeout(timer);
      queue.pop();
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
