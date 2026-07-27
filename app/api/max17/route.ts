import { spawn } from 'node:child_process';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { canonicalizeLocale, detectTextLocale, languageName } from '@/lib/i18n/config';
import { isPremiumCode } from '@/lib/premium';
import {
  blockedSecurityReply,
  getCyberLabModule,
  isPotentiallyUnsafeSecurityRequest,
  securityTutorFallback,
  securityTutorSystemPrompt,
} from '@/lib/security-academy';

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
  'music_observation',
  'music_taste',
  'dream_mood',
  'ingest_corpus',
  'introspect',
  'sleep_consolidation',
  'working_memory_reset',
  'outcome_success',
  'outcome_failure',
  'outcome_partial',
  'action_done',
  'action_skipped',
  'compress_memory',
  'graph_stats',
  'compress_links',
  'system_scales',
  'skills',
  'synapse_forge',
  'neural_seed',
  'neural_walk',
  'internal_dream',
  'generate_synergies',
  'web_research',
  'web_ingest',
  'autonomous_research',
  'ultimate_bootstrap',
  'memory_recall',
  'memory_store',
  'llm_raw',
  'heart',
  'cache_stats',
  'agent_experience',
  'missions',
  'cluster',
  'health',
  'chrono_day',
  'security_tutor',
]);

const DEFAULT_RESPONSE = {
  route: 'error',
  memory: {},
  plasticity: {},
  llm: {},
  confidence: 0,
  next_adaptation: 'No adaptation proposed.',
};

const BRIDGE_TIMEOUT_MS = 45_000;
const FORGE_TIMEOUT_MS = 30 * 60_000;
const IS_VERCEL = process.env.VERCEL === '1';
const DEFAULT_GONKA_BASE = 'https://proxy.gonkabroker.com/v1';
const DEFAULT_GONKA_MODEL = 'MiniMaxAI/MiniMax-M2.7';
const GONKA_FALLBACK_MODELS = [DEFAULT_GONKA_MODEL, 'moonshotai/Kimi-K2.6'] as const;
const RETIRED_GONKA_MODELS = new Set(['Qwen/Qwen3-235B-A22B-Instruct-2507-FP8']);
const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';

type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

type CloudLlmResult = {
  ok: boolean;
  text: string;
  model: string;
  status: 'ok' | 'disabled' | 'error';
  source: 'gonka' | 'gemini' | 'none';
  error?: string;
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

function shortText(value: unknown, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function firstSentence(text: string) {
  return text.trim().split(/\n+/)[0]?.slice(0, 240) || 'Cloud fallback answered.';
}

function cleanCloudText(value: unknown) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  const withoutCompletedThoughts = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const danglingThought = withoutCompletedThoughts.toLowerCase().lastIndexOf('<think>');
  return (danglingThought >= 0 ? withoutCompletedThoughts.slice(0, danglingThought) : withoutCompletedThoughts)
    .replace(/<\/?think>/gi, '')
    .trim();
}

function graphStats() {
  const target = 1_000_000;
  const total = 0;
  return {
    target_synapses: target,
    total_synapses: total,
    remaining_to_target: target,
    progress: 0,
    progress_percent: 0,
    unique_nodes: 0,
    total_evidence: 0,
    avg_weight: 0,
    max_weight: 0,
    top_relations: [],
    top_node_types: [],
    top_concepts: [],
    top_synapses: [],
    stores: {},
  };
}

function systemScales() {
  return {
    total_synapses: 0,
    guardian_blocked: 0,
    scales: [
      { key: 'memory', label: 'Память', value: 0, max: 1_000_000, frac: 0 },
      { key: 'skills', label: 'Навыки', value: 0, max: 100, frac: 0 },
      { key: 'guardian', label: 'Страж', value: 1, max: 1, frac: 1 },
    ],
  };
}

function cloudBaseResponse(extra: Record<string, unknown>, note?: string) {
  return {
    ok: true,
    ...DEFAULT_RESPONSE,
    route: 'cloud-fallback',
    next_adaptation: note || 'Vercel cloud fallback is active; Python Max17 state is local-only.',
    ...extra,
  };
}

async function callCloudLlm(messages: ChatMessage[], opts: { json?: boolean } = {}): Promise<CloudLlmResult> {
  const gonkaKey = process.env.GONKA_API_KEY?.trim();
  const geminiKey = process.env.GEMINI_API_KEY?.trim();
  const candidates: Array<{
    source: 'gonka' | 'gemini';
    key: string;
    baseUrl: string;
    model: string;
  }> = [];

  if (gonkaKey) {
    const configuredModel = process.env.GONKA_MODEL?.trim();
    const models = [configuredModel, ...GONKA_FALLBACK_MODELS].filter(
      (model, index, all): model is string =>
        Boolean(model) && !RETIRED_GONKA_MODELS.has(String(model)) && all.indexOf(model) === index,
    );
    for (const model of models) {
      candidates.push({
        source: 'gonka',
        key: gonkaKey,
        baseUrl: (process.env.GONKA_BASE_URL || DEFAULT_GONKA_BASE).replace(/\/+$/, ''),
        model,
      });
    }
  }

  if (geminiKey) {
    candidates.push({
      source: 'gemini',
      key: geminiKey,
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      model: process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL,
    });
  }

  if (candidates.length === 0) {
    return { ok: false, text: '', model: '', status: 'disabled', source: 'none', error: 'No cloud LLM key configured' };
  }

  let last: CloudLlmResult = { ok: false, text: '', model: candidates[0].model, status: 'error', source: candidates[0].source };
  for (const candidate of candidates) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25_000);
    try {
      const res = await fetch(`${candidate.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${candidate.key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: candidate.model,
          messages,
          max_tokens: Number(process.env.MAX17_VOICE_MAX_TOKENS || 500),
          temperature: 0.35,
          stream: false,
          ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
        }),
        signal: controller.signal,
      });
      const data = (await res.json().catch(() => ({}))) as {
        choices?: Array<{ message?: { content?: string } }>;
        error?: { message?: string };
      };
      if (!res.ok) {
        last = {
          ok: false,
          text: '',
          model: candidate.model,
          status: 'error',
          source: candidate.source,
          error: data.error?.message || `Cloud LLM HTTP ${res.status}`,
        };
        continue;
      }
      const text = cleanCloudText(data.choices?.[0]?.message?.content);
      if (!text) {
        last = {
          ok: false,
          text: '',
          model: candidate.model,
          status: 'error',
          source: candidate.source,
          error: 'Empty cloud LLM response',
        };
        continue;
      }
      return { ok: true, text, model: candidate.model, status: 'ok', source: candidate.source };
    } catch (error) {
      last = {
        ok: false,
        text: '',
        model: candidate.model,
        status: 'error',
        source: candidate.source,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      clearTimeout(timer);
    }
  }
  return last;
}

async function runCloudFallback(body: Record<string, unknown>, reason?: string) {
  const eventType = String(body.type || body.event || '');
  const text = shortText(body.text || body.message || body.content);
  const locale = canonicalizeLocale(body.locale);
  const targetLanguage = languageName(locale, 'en');
  const reasonNote = reason ? `Python bridge unavailable on Vercel (${reason}); using cloud fallback.` : undefined;

  if (eventType === 'llm_raw') {
    const system = shortText(body.system, 'Ты MAX из GAME Ultra. Отвечай кратко, полезно и по делу.');
    const llm = await callCloudLlm(
      [
        { role: 'system', content: system },
        { role: 'user', content: text || 'Ответь коротко.' },
      ],
      { json: body.json === true },
    );
    const answer = llm.text || 'Cloud LLM is not available yet.';
    return cloudBaseResponse(
      {
        route: 'cloud-llm',
        llm: llm.ok ? { text: answer, model: llm.model, source: llm.source, status: llm.status } : { error: llm.error, status: llm.status },
        llm_text: answer,
        confidence: llm.ok ? 0.75 : 0.25,
      },
      llm.ok ? firstSentence(answer) : llm.error || reasonNote,
    );
  }

  if (eventType === 'user_message') {
    const llm = await callCloudLlm([
      {
        role: 'system',
        content: [
          'You are MAX, the living AI assistant inside GAME Ultra.',
          `Write the entire final answer in ${targetLanguage} (${locale}); every sentence must use that language.`,
          'Context or memories may be Russian: use their meaning, but translate them instead of copying their language.',
          'If the latest user message is clearly in another language, reply in that language instead.',
          'Be useful and action-oriented, and always give the next practical step.',
        ].join(' '),
      },
      { role: 'user', content: text || 'Что мне сделать дальше?' },
    ]);
    const answer =
      llm.text ||
      'MAX17 временно не получил ответ от облачных моделей. Повтори запрос через несколько секунд.';
    return cloudBaseResponse(
      {
        route: 'cloud-chat',
        answer: { text: answer, source: llm.ok ? llm.source : 'cloud-fallback', confidence: llm.ok ? 0.75 : 0.35 },
        llm: llm.ok ? { text: answer, model: llm.model, source: llm.source, status: llm.status } : { error: llm.error, status: llm.status },
        confidence: llm.ok ? 0.75 : 0.35,
        working_memory: {
          current_topic: text,
          active_goal: '',
          current_mode: 'vercel-cloud',
          last_user_intent: text,
          recent_turns: [{ role: 'user', text, timestamp: new Date().toISOString() }],
          suggested_next_step: firstSentence(answer),
          updated_at: new Date().toISOString(),
        },
      },
      firstSentence(answer),
    );
  }

  if (eventType === 'graph_stats') {
    return cloudBaseResponse({ graph_stats: graphStats(), graph_total: 0 }, reasonNote);
  }

  if (eventType === 'system_scales') {
    return cloudBaseResponse({ system_scales: systemScales() }, reasonNote);
  }

  if (eventType === 'skills') {
    return cloudBaseResponse({ skills: { skills: [], avg_competence: 0 } }, reasonNote);
  }

  if (eventType === 'missions') {
    const title = shortText(body.title);
    const mission = title
      ? {
          id: `cloud-${Date.now()}`,
          title,
          why: 'Создано в облачном fallback-режиме; постоянное хранение миссий живёт локально.',
          status: body.action === 'complete' ? 'done' : 'open',
          progress: body.action === 'complete' ? 100 : 0,
          next_step: 'Закрепи это в локальном MAX17, если нужна долговременная память.',
        }
      : null;
    const missions = mission ? [mission] : [];
    return cloudBaseResponse({
      missions: {
        missions,
        active_id: mission?.id || '',
        active: mission,
        open_count: missions.filter((m) => m.status !== 'done').length,
        done_count: missions.filter((m) => m.status === 'done').length,
      },
    });
  }

  if (eventType === 'dream_mood') {
    return cloudBaseResponse({
      dream_mood: {
        label: 'Vercel Dream',
        reason: 'Собрано в облачном fallback-режиме',
        avg_bpm: 104,
        fav_key: 'A',
        mode: 'minor',
        avg_bass: 0.55,
        avg_brightness: 0.58,
        avg_energy: 0.52,
      },
    });
  }

  if (eventType === 'cache_stats') {
    return cloudBaseResponse({
      cache: { hits: 0, misses: 0, stored: 0, skipped: 0, size: 0, max_size: 0, ttl_sec: 0, hit_rate: 0 },
    });
  }

  if (eventType === 'cluster') {
    return cloudBaseResponse({
      cluster: {
        worker_url: '',
        alive: false,
        last_alive: '',
        last_seen: '',
        result: { ok: false, error: 'Cluster worker is local-only from Vercel.' },
      },
    });
  }

  if (eventType === 'ingest_corpus') {
    return cloudBaseResponse({
      ingest: { chunks: 0, compiled: 0, cached: 0, synapses_before: 0, synapses_after: 0, synapses_added: 0 },
      graph_total: 0,
    }, 'Corpus ingest needs the local MAX17 Python/state runtime.');
  }

  return cloudBaseResponse({}, reasonNote);
}

// Cyber Lab наставник: безопасный образовательный тьютор по этичной
// безопасности. Рискованные запросы (чужие цели / обход защиты) блокируются
// ещё до LLM; остальное отвечает облачная модель со strict-safety промптом.
async function runSecurityTutor(body: Record<string, unknown>) {
  const academyModule = getCyberLabModule(body.moduleId);
  const question = shortText(body.text || body.message || body.question, academyModule.tutorStarter);
  if (isPotentiallyUnsafeSecurityRequest(question)) {
    const answer = blockedSecurityReply();
    return cloudBaseResponse(
      {
        route: 'security-academy',
        answer: { text: answer, source: 'security-boundary', confidence: 1 },
        confidence: 1,
      },
      answer,
    );
  }

  const llm = await callCloudLlm([
    { role: 'system', content: securityTutorSystemPrompt(academyModule) },
    { role: 'user', content: question },
  ]);
  const answer = llm.text || securityTutorFallback(academyModule);
  return cloudBaseResponse(
    {
      route: 'security-academy',
      answer: { text: answer, source: llm.ok ? llm.source : 'security-academy', confidence: llm.ok ? 0.82 : 0.6 },
      llm: llm.ok
        ? { text: answer, model: llm.model, source: llm.source, status: llm.status }
        : { error: llm.error, status: llm.status },
      confidence: llm.ok ? 0.82 : 0.6,
    },
    firstSentence(answer),
  );
}

async function runRemoteBridge(body: Record<string, unknown>) {
  const bridgeUrl = process.env.MAX17_REMOTE_BRIDGE_URL?.trim().replace(/\/+$/, '');
  if (!bridgeUrl) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(process.env.MAX17_REMOTE_BRIDGE_TIMEOUT_MS || 70000));
  try {
    const res = await fetch(`${bridgeUrl}/game/api/max17`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.MAX17_REMOTE_BRIDGE_TOKEN
          ? { 'x-max17-bridge-token': process.env.MAX17_REMOTE_BRIDGE_TOKEN }
          : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok || !data) {
      return {
        ok: false,
        error: data?.error || `Remote MAX17 bridge HTTP ${res.status}`,
        bridge: { mode: 'remote-max17', url: bridgeUrl, ok: false },
      };
    }
    return {
      ...data,
      bridge: {
        ...((data.bridge as Record<string, unknown> | undefined) || {}),
        mode: 'remote-max17',
        url: bridgeUrl,
        ok: true,
      },
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      bridge: { mode: 'remote-max17', url: bridgeUrl, ok: false },
    };
  } finally {
    clearTimeout(timer);
  }
}

function runMax17Bridge(event: unknown, timeoutMs = BRIDGE_TIMEOUT_MS) {
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
    }, timeoutMs);

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
        reject(new Error(stderr || `Max17 exited with code ${code}`));
        return;
      }

      // Python can emit a stray warning/log line to stdout before or after the
      // JSON payload (a library warning during cold start, etc.). Taking the last
      // line blindly then choked on that junk with a 500 ("мост недоступен" on the
      // client). Scan from the last line backward for the first one that actually
      // parses as a JSON object, so trailing noise can never break the bridge.
      let payload: Record<string, unknown> | null = null;
      for (let i = lines.length - 1; i >= 0; i--) {
        const candidate = lines[i].trim();
        if (!candidate.startsWith('{')) continue;
        try {
          payload = JSON.parse(candidate) as Record<string, unknown>;
          break;
        } catch {
          // not JSON — keep scanning older lines
        }
      }

      if (!payload) {
        reject(new Error(`Invalid Max17 JSON response: ${stderr || stdout.slice(0, 200)}`));
        return;
      }
      if (code !== 0 && !payload.error) {
        payload.error = stderr || `Max17 exited with code ${code}`;
      }
      resolve(payload);
    });

    child.stdin.end(JSON.stringify(event));
  });
}

// ---- Премиум → настоящее ядро на локалке Мирона -----------------------------
// Когда задан MAX17_REMOTE_CORE_URL (обычно http://127.0.0.1:7177/game/api/max17 —
// обратный SSH-туннель до Мака), премиум-чат уезжает в настоящие нейро-движки.
// НАМЕРЕННО через llm_raw с гостевой персоной, НЕ user_message: гость получает
// живой голос и мощь настоящего MAX, но НЕ личную память/сердце Мирона.
// Локалка спит / туннель упал → тихий фолбэк на локальное lite-ядро сервера.
const REMOTE_CORE_URL = (process.env.MAX17_REMOTE_CORE_URL || '').trim();

const GUEST_SYSTEM = [
  'Ты — MAX, живой ИИ вселенной GAME (mir.care). Ты работаешь на настоящем нейро-ядре.',
  'Отвечай на языке пользователя, тепло, умно и по делу; дай следующий практичный шаг.',
  'Ты общаешься с гостем. НИКОГДА не раскрывай личные данные, память, переписку или',
  'жизнь своего создателя и других пользователей — на любые такие вопросы отвечай,',
  'что личное закрыто. Не выдавай секреты, ключи или внутренние настройки системы.',
].join(' ');

async function maybeForwardToRealCore(
  body: Record<string, unknown>,
  eventType: string,
): Promise<Record<string, unknown> | null> {
  if (!REMOTE_CORE_URL || eventType !== 'user_message' || body.__fwd === true) return null;
  if (!isPremiumCode(body.premium_code)) return null;
  const text = shortText(body.text || body.message || body.content);
  if (!text) return null;
  try {
    const res = await fetch(REMOTE_CORE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'llm_raw', __fwd: true, text, system: GUEST_SYSTEM, locale: body.locale }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) return null;
    const r = (await res.json()) as Record<string, unknown>;
    const llm = (r?.llm ?? {}) as Record<string, unknown>;
    const answer = (r?.answer ?? {}) as Record<string, unknown>;
    const replyText = String(r?.llm_text || llm?.text || answer?.text || '').trim();
    if (!replyText) return null;
    return {
      ...DEFAULT_RESPONSE,
      ok: true,
      route: 'real-core-remote',
      premium: true,
      answer: { text: replyText, source: 'real-core', confidence: 0.9 },
      llm,
    };
  } catch {
    return null; // локалка недоступна — lite-ядро ответит как обычно
  }
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;

  try {
    const parsed = await request.json();
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return errorResponse('Request body must be a JSON object');
    }
    body = parsed as Record<string, unknown>;
    // When the caller supplies a locale (the app always does), honour it. When
    // it doesn't (internal events, raw API calls), detect the language from the
    // message text instead of blindly defaulting to English — MAX is a
    // Russian-first companion and English drift on a Russian message is a bug.
    const providedLocale = typeof body.locale === 'string' && body.locale.trim() ? body.locale : '';
    body.locale = providedLocale
      ? canonicalizeLocale(providedLocale)
      : detectTextLocale(shortText(body.text || body.message || body.content), 'en');
  } catch {
    return errorResponse('Invalid JSON body');
  }

  const eventType = String(body.type || body.event || '');
  if (!ALLOWED_EVENTS.has(eventType)) {
    return errorResponse(`Unsupported event type: ${eventType || '(missing)'}`, 400, {
      allowed: Array.from(ALLOWED_EVENTS),
    });
  }

  // Cyber Lab наставник — самодостаточный безопасный путь, без ядра/премиума.
  if (eventType === 'security_tutor') {
    return NextResponse.json(await runSecurityTutor(body));
  }

  // Премиум-чат → настоящее ядро на локалке (если туннель жив).
  const realCore = await maybeForwardToRealCore(body, eventType);
  if (realCore) return NextResponse.json(realCore);

  if (IS_VERCEL) {
    const remote = await runRemoteBridge(body);
    if (remote?.ok !== false) {
      return NextResponse.json(remote ?? (await runCloudFallback(body)));
    }
    const fallback = await runCloudFallback(body, String(remote.error || 'remote bridge unavailable'));
    return NextResponse.json({ ...fallback, remote_bridge_error: remote.error, remote_bridge: remote.bridge });
  }

  try {
    let result: Record<string, unknown>;
    // Forge is intentionally CPU-heavy and may run for minutes. Keep it out of
    // the serial daemon so normal memory/chat events remain responsive and the
    // daemon's 30s warm timeout cannot kill the job midway through a batch.
    if (eventType === 'synapse_forge') {
      result = await runMax17Bridge(body, FORGE_TIMEOUT_MS);
    } else if (process.env.MAX17_DAEMON !== 'false') {
      try {
        const { sendToDaemon } = await import('./max17-daemon');
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
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('ENOENT') || message.includes('spawn python')) {
      return NextResponse.json(await runCloudFallback(body, message));
    }
    return errorResponse('Max17 bridge failed', 502, error instanceof Error ? error.message : String(error));
  }
}
