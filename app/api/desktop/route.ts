import { spawn } from 'node:child_process';
import path from 'node:path';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

// Desktop mode (macOS, Tier 1, confirm-before-act). Spawns mark17/desktop_agent.py
// for ONE step (propose or execute) per request, so the HUD drives the approve
// loop. The backend only runs a tool in "execute" mode on the user-approved
// action — never in "propose" mode.
function runDesktopAgent(payload: unknown): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(process.cwd(), 'mark17', 'desktop_agent.py');
    const child = spawn(process.env.PYTHON_BIN || 'python3', [scriptPath], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('Desktop agent timeout'));
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
      const lines = stdout.trim().split('\n').filter(Boolean);
      if (lines.length === 0) {
        reject(new Error(stderr || `desktop_agent exited with code ${code}`));
        return;
      }
      // Python may print a stray warning to stdout before/after the JSON payload;
      // taking the last line blindly then surfaced as "Malformed JSON 500" in the
      // console. Scan from the last line backward for the first valid JSON object.
      let payload: Record<string, unknown> | null = null;
      for (let i = lines.length - 1; i >= 0; i--) {
        const candidate = lines[i].trim();
        if (!candidate.startsWith('{')) continue;
        try {
          payload = JSON.parse(candidate) as Record<string, unknown>;
          break;
        } catch {
          // keep scanning older lines
        }
      }
      if (!payload) {
        reject(new Error(`Invalid desktop_agent JSON response: ${stderr || stdout.slice(0, 200)}`));
        return;
      }
      resolve(payload);
    });

    child.stdin.end(JSON.stringify(payload));
  });
}

export async function POST(request: Request) {
  // Dangerous route (controls the desktop): require the shared token when set.
  const requiredToken = process.env.MAX17_API_TOKEN;
  if (requiredToken && request.headers.get('x-max17-token') !== requiredToken) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return NextResponse.json({ ok: false, error: 'Request body must be a JSON object' }, { status: 400 });
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  try {
    const result = await runDesktopAgent(body);
    return NextResponse.json(result, { status: result.ok === false ? 502 : 200 });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}
