import { NextResponse } from 'next/server';
import { createMax } from '@/lib/agents';
import { Max17MemoryStore } from '@/lib/max17-memory-store';
import { max17Llm } from '@/lib/max17-llm';

export const runtime = 'nodejs';

/**
 * Example usage endpoint for the MAX + 7-agent system.
 *
 *   GET  /game/api/max          -> agent roster (which agents exist + enabled state)
 *   POST /game/api/max { text } -> runs the full pipeline, returns the unified synthesis
 *
 * Mirrors the conventions of the other agent routes (nodejs runtime, optional
 * token gate, NextResponse.json with ok/status).
 */

function isAuthorized(request: Request): boolean {
  const requiredToken = process.env.MAX17_API_TOKEN;
  if (!requiredToken) return true;
  return request.headers.get('x-max17-token') === requiredToken;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  const max = createMax();
  return NextResponse.json({ ok: true, agents: max.roster() }, { status: 200 });
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    body = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    body = {};
  }

  const text =
    typeof body.text === 'string' ? body.text : typeof body.input === 'string' ? body.input : '';
  if (!text.trim()) {
    return NextResponse.json({ ok: false, error: 'Field "text" (string) is required.' }, { status: 400 });
  }

  try {
    // Fast Max17-core memory: the Memory Agent recalls via the `memory_recall`
    // event (graph + vector only, no Gonka voice / no web), so the council stays
    // instant while grounded in real Max17 memory. Deep mode also wires the LLM so
    // MAX refines mission/answer/actions with the real model.
    // LLM is always wired so MAX can auto-escalate to deep on low confidence;
    // it only fires when needed (explicit deep, or confidence below threshold).
    const deep = body.deep === true;
    const max = createMax({
      services: { memory: new Max17MemoryStore(), llm: max17Llm },
    });
    const synthesis = await max.processUserInput(
      {
        text,
        locale: typeof body.locale === 'string' ? body.locale : undefined,
        metadata:
          body.metadata && typeof body.metadata === 'object'
            ? (body.metadata as Record<string, unknown>)
            : undefined,
      },
      {
        sessionId: typeof body.sessionId === 'string' ? body.sessionId : undefined,
        userId: typeof body.userId === 'string' ? body.userId : undefined,
      },
      { deep },
    );
    return NextResponse.json({ ok: true, ...synthesis }, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}
