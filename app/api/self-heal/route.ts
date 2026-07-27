import { NextResponse } from 'next/server';

import { auth } from '@/lib/auth';
import { appBasePath } from '@/lib/base-path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Само-улучшение MAX с ОБЯЗАТЕЛЬНЫМ согласованием: агент только ПРЕДЛАГАЕТ
// (diagnose), а применяет (apply) исключительно по явному запросу человека.
// Гейт — админ (Google-email Мирона из ADMIN_EMAILS или x-admin-token).

function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS || 'mironbocharov48@gmail.com')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

async function isAdmin(request: Request): Promise<boolean> {
  const token = (request.headers.get('x-admin-token') || '').trim();
  const wanted = (process.env.ADMIN_TOKEN || '').trim();
  if (wanted && token && token === wanted) return true;
  try {
    const session = await auth();
    const email = session?.user?.email?.toLowerCase();
    return Boolean(email && adminEmails().includes(email));
  } catch {
    return false;
  }
}

function base(_request: Request): string {
  // Внутренние вызовы (/api/health, /api/max17, /api/code) — на localhost:
  // за nginx origin запроса публичный, и self-fetch публичного URL падает.
  return `http://127.0.0.1:${process.env.PORT || '3000'}${appBasePath}`;
}

const OPERATIONAL_FIXES = new Set(['rewarm_daemon', 'clear_cache', 'reseed_missions', 'voice_fallback']);

type Proposal = {
  id: string;
  title: string;
  problem: string;
  action: string;
  kind: 'operational' | 'code';
  fix_action?: string;
  code_instruction?: string;
  risk: 'low' | 'med' | 'high';
};

const SYSTEM = [
  'Ты доктор само-улучшения GAME/MAX. По отчёту здоровья и ошибкам предложи 2-5',
  'КОНКРЕТНЫХ фиксов/улучшений. Для каждого верни объект:',
  '{title, problem, action, kind:"operational"|"code", fix_action?, code_instruction?, risk:"low"|"med"|"high"}.',
  'operational — только из набора: rewarm_daemon, clear_cache, reseed_missions, voice_fallback (клади в fix_action).',
  'code — точная безопасная инструкция для кодового агента (клади в code_instruction), маленький изолированный шаг.',
  'Предпочитай безопасные операционные фиксы для известных проблем. Не выдумывай проблем, которых нет в данных.',
  'Верни СТРОГО JSON: {"proposals":[...]}.',
].join('\n');

async function diagnose(request: Request): Promise<Proposal[]> {
  const b = base(request);
  // 1) свежий свип здоровья
  let health: unknown = null;
  try {
    const hr = await fetch(`${b}/api/health`, { cache: 'no-store', signal: AbortSignal.timeout(30_000) });
    health = (await hr.json()) as unknown;
  } catch {
    /* health недоступен — предложим базовое */
  }
  // 2) просим ядро (LLM) предложить фиксы
  let raw = '';
  try {
    const lr = await fetch(`${b}/api/max17`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'llm_raw',
        json: true,
        max_tokens: 1200,
        system: SYSTEM,
        text: `Отчёт здоровья:\n${JSON.stringify(health).slice(0, 4000)}`,
      }),
      signal: AbortSignal.timeout(90_000),
    });
    const d = (await lr.json()) as { llm_text?: string; llm?: { text?: string } };
    raw = d.llm_text || d.llm?.text || '';
  } catch {
    raw = '';
  }
  // 3) парсим и нормализуем
  const proposals: Proposal[] = [];
  try {
    const js = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
    const parsed = JSON.parse(js) as { proposals?: unknown[] };
    for (const [i, p] of (parsed.proposals ?? []).entries()) {
      if (!p || typeof p !== 'object') continue;
      const o = p as Record<string, unknown>;
      const kind = o.kind === 'code' ? 'code' : 'operational';
      const fixAction = String(o.fix_action || '').trim();
      // operational принимаем только из белого списка — иначе понижаем до code-идеи без применения
      const safeOp = kind === 'operational' && OPERATIONAL_FIXES.has(fixAction);
      proposals.push({
        id: `sh_${Date.now()}_${i}`,
        title: String(o.title || 'Улучшение').slice(0, 120),
        problem: String(o.problem || '').slice(0, 400),
        action: String(o.action || '').slice(0, 400),
        kind: kind === 'code' || !safeOp ? (kind === 'code' ? 'code' : 'operational') : 'operational',
        fix_action: safeOp ? fixAction : undefined,
        code_instruction: kind === 'code' ? String(o.code_instruction || o.action || '').slice(0, 600) : undefined,
        risk: (['low', 'med', 'high'] as const).includes(o.risk as 'low') ? (o.risk as 'low' | 'med' | 'high') : 'med',
      });
    }
  } catch {
    /* LLM вернул не-JSON — вернём пусто */
  }
  return proposals.slice(0, 5);
}

export async function GET(request: Request) {
  if (!(await isAdmin(request))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return NextResponse.json({ ok: true, proposals: await diagnose(request) });
}

export async function POST(request: Request) {
  if (!(await isAdmin(request))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const action = String(body.action || 'diagnose');
  const b = base(request);

  if (action === 'diagnose') {
    return NextResponse.json({ ok: true, proposals: await diagnose(request) });
  }

  // apply — ТОЛЬКО по явному согласованию человека (кнопка «Согласовать»).
  if (action === 'apply') {
    const p = (body.proposal || {}) as Partial<Proposal>;

    if (p.kind === 'operational' && p.fix_action && OPERATIONAL_FIXES.has(p.fix_action)) {
      const r = await fetch(`${b}/api/health`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fix: p.fix_action }),
        signal: AbortSignal.timeout(70_000),
      });
      const d = await r.json();
      return NextResponse.json({ ok: r.ok, applied: 'operational', fix_action: p.fix_action, result: d });
    }

    if (p.kind === 'code' && p.code_instruction) {
      // Кодовый агент работает в ИЗОЛИРОВАННОМ workspace (не трогает живой репо):
      // он прорабатывает фикс и показывает результат — выкат в прод остаётся
      // отдельным осознанным шагом.
      const token = (process.env.MAX17_API_TOKEN || '').trim();
      const r = await fetch(`${b}/api/code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { 'x-max17-token': token } : {}) },
        body: JSON.stringify({ instruction: p.code_instruction }),
        signal: AbortSignal.timeout(190_000),
      });
      const d = (await r.json()) as Record<string, unknown>;
      return NextResponse.json({ ok: r.ok, applied: 'code', sandbox: true, result: d });
    }

    return NextResponse.json({ error: 'bad_proposal' }, { status: 400 });
  }

  return NextResponse.json({ error: 'unknown_action' }, { status: 400 });
}
