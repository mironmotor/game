import { spawn } from 'node:child_process';
import path from 'node:path';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

// Runtime LLM model selector. GET lists presets + active role routes; POST
// {id, role?} switches either the global backend or one role override. The
// change is picked up live by gonka_bridge on the next call — no restart.
function runLlmConfig(payload: unknown): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(process.cwd(), 'mark17', 'llm_config.py');
    const child = spawn(process.env.PYTHON_BIN || 'python3', [scriptPath], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('llm-config timeout'));
    }, 15000);
    child.stdout.on('data', (c) => (stdout += c.toString()));
    child.stderr.on('data', (c) => (stderr += c.toString()));
    child.on('error', (e) => {
      clearTimeout(timeout);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      const line = stdout.trim().split('\n').filter(Boolean).at(-1);
      if (!line) {
        reject(new Error(stderr || `llm_config exited ${code}`));
        return;
      }
      try {
        resolve(JSON.parse(line));
      } catch (e) {
        reject(new Error(`Invalid llm_config JSON: ${String(e)}`));
      }
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

export async function GET() {
  try {
    return NextResponse.json(await runLlmConfig({ action: 'list' }));
  } catch (error) {
    return NextResponse.json({ ok: false, error: String(error), presets: [] }, { status: 502 });
  }
}

export async function POST(request: Request) {
  let id = '';
  let role = '';
  try {
    const body = await request.json();
    const payload = body as Record<string, unknown>;
    id = String(payload?.id || '');
    role = String(payload?.role || '');
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }
  try {
    return NextResponse.json(await runLlmConfig({ action: 'set', id, role }));
  } catch (error) {
    return NextResponse.json({ ok: false, error: String(error), presets: [] }, { status: 502 });
  }
}
