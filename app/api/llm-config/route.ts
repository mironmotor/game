import { spawn } from 'node:child_process';
import path from 'node:path';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

const IS_VERCEL = process.env.VERCEL === '1';
const DEFAULT_GONKA_MODEL = 'MiniMaxAI/MiniMax-M2.7';

const CLOUD_ROLES = [
  { id: 'chat', label: 'Чат' },
  { id: 'code', label: 'Код' },
  { id: 'architect', label: 'Архитектор' },
  { id: 'desktop', label: 'Desktop' },
  { id: 'bulk', label: 'Bulk ingest' },
  { id: 'ultra', label: 'Ультра-оркестратор' },
];

function cloudConfig(active = 'gonka-minimax') {
  const configuredGonkaModel = process.env.GONKA_MODEL?.trim();
  const gonkaModel =
    configuredGonkaModel === 'Qwen/Qwen3-235B-A22B-Instruct-2507-FP8'
      ? DEFAULT_GONKA_MODEL
      : configuredGonkaModel || DEFAULT_GONKA_MODEL;
  const presets = [
    {
      id: 'gonka-minimax',
      label: 'Gonka · MiniMax-M2.7 — облако Vercel',
      model: gonkaModel,
      local: false,
      available: Boolean(process.env.GONKA_API_KEY),
      active: active === 'gonka-qwen3',
    },
    {
      id: 'gemini',
      label: 'Gemini 2.5 Flash — облако Vercel',
      model: process.env.MAX17_ASR_MODEL || 'gemini-2.5-flash',
      local: false,
      available: Boolean(process.env.GEMINI_API_KEY),
      active: active === 'gemini',
    },
  ];
  const resolved = presets.find((p) => p.active && p.available)?.id || presets.find((p) => p.available)?.id || null;
  return {
    ok: true,
    active: resolved,
    env_model: gonkaModel,
    presets: presets.map((p) => ({ ...p, active: p.id === resolved })),
    roles: CLOUD_ROLES.map((role) => ({
      ...role,
      active: null,
      resolved,
      auto: true,
      model: presets.find((p) => p.id === resolved)?.model || gonkaModel,
    })),
  };
}

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
  if (IS_VERCEL) {
    return NextResponse.json(cloudConfig());
  }
  try {
    return NextResponse.json(await runLlmConfig({ action: 'list' }));
  } catch (error) {
    if (String(error).includes('ENOENT') || String(error).includes('spawn python')) {
      return NextResponse.json(cloudConfig());
    }
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
  if (IS_VERCEL) {
    return NextResponse.json(cloudConfig(id || 'gonka-minimax'));
  }
  try {
    return NextResponse.json(await runLlmConfig({ action: 'set', id, role }));
  } catch (error) {
    if (String(error).includes('ENOENT') || String(error).includes('spawn python')) {
      return NextResponse.json(cloudConfig(id || 'gonka-qwen3'));
    }
    return NextResponse.json({ ok: false, error: String(error), presets: [] }, { status: 502 });
  }
}
