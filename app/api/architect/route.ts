import { spawn } from 'node:child_process';
import path from 'node:path';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

// Architect mode: the internal AI proposes development branches (read-only).
// Spawns mark17/architect.py, same pattern as the other agents. Token-gated for
// consistency with the dangerous routes (it calls the LLM).
function runArchitect(payload: unknown): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(process.cwd(), 'mark17', 'architect.py');
    const child = spawn(process.env.PYTHON_BIN || 'python3', [scriptPath], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('Architect timeout'));
    }, 60000);

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
        reject(new Error(stderr || `architect exited with code ${code}`));
        return;
      }
      try {
        resolve(JSON.parse(line));
      } catch (error) {
        reject(new Error(`Invalid architect JSON response: ${String(error)}`));
      }
    });

    child.stdin.end(JSON.stringify(payload));
  });
}

export async function POST(request: Request) {
  const requiredToken = process.env.MAX17_API_TOKEN;
  if (requiredToken && request.headers.get('x-max17-token') !== requiredToken) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    body = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    body = {};
  }

  try {
    const result = await runArchitect(body);
    return NextResponse.json(result, { status: result.ok === false ? 502 : 200 });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error), branches: [] },
      { status: 502 },
    );
  }
}
