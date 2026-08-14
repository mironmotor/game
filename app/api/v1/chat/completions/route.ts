import { NextResponse } from 'next/server';
import { apiError, authorize, billingHeaders, charge } from '@/lib/api-gate';
import { CHAT_RATES, DEFAULT_CHAT_MODEL, chatCost } from '@/lib/pricing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * MAX API — чат в формате OpenAI.
 *
 * Совместимость здесь не украшение, а способ не заставлять клиента ничего
 * переписывать: он меняет base_url и ключ, и его существующий код работает.
 * Поэтому и форма ответа, и форма ошибки повторяют openai — вплоть до полей
 * choices[].message и usage.
 *
 * Внутри запрос уходит в цепочку моделей ядра. Имена моделей наружу свои
 * (max-1, max-1-large): клиент покупает доступ к MAX, а не к конкретному
 * поставщику, и смена поставщика не должна ломать чужой код.
 */

const UPSTREAM = (process.env.GONKA_BASE_URL || 'https://proxy.gonkabroker.com/v1').replace(/\/+$/, '');
const UPSTREAM_KEY = process.env.GONKA_API_KEY || '';

const MODEL_MAP: Record<string, string> = {
  'max-1': process.env.GONKA_MODEL || 'MiniMaxAI/MiniMax-M2.7',
  'max-1-large': 'moonshotai/Kimi-K2.6',
};

interface ChatMessage {
  role: string;
  content: unknown;
}

export async function POST(request: Request) {
  const caller = await authorize(request);
  if (caller instanceof NextResponse) return caller;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return apiError('Тело запроса — не JSON', 400);
  }

  const messages = Array.isArray(body.messages) ? (body.messages as ChatMessage[]) : [];
  if (!messages.length) {
    return apiError('messages пуст', 400);
  }

  const requested = String(body.model || DEFAULT_CHAT_MODEL);
  if (!CHAT_RATES[requested]) {
    return apiError(
      `Неизвестная модель «${requested}». Доступны: ${Object.keys(CHAT_RATES).join(', ')}`,
      400,
      'model_not_found',
    );
  }
  if (!UPSTREAM_KEY) {
    return apiError('Ядро временно без модели — попробуй позже', 503, 'api_error');
  }

  // Потоковый режим не поддержан осознанно: цену вызова мы узнаём из usage в
  // конце ответа, а при стриме её пришлось бы считать самим и расходиться с
  // поставщиком в цифрах. Лучше честно отказать, чем ошибаться в деньгах.
  if (body.stream === true) {
    return apiError('stream пока не поддержан — запроси без него', 400);
  }

  const started = Date.now();
  let upstream: Response;
  try {
    upstream = await fetch(`${UPSTREAM}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${UPSTREAM_KEY}` },
      body: JSON.stringify({
        model: MODEL_MAP[requested],
        messages,
        max_tokens: Math.min(4000, Number(body.max_tokens) || 1000),
        temperature: typeof body.temperature === 'number' ? body.temperature : 0.6,
        ...(body.response_format ? { response_format: body.response_format } : {}),
      }),
      signal: AbortSignal.timeout(180_000),
    });
  } catch (error) {
    return apiError(`Ядро не ответило: ${error instanceof Error ? error.message : String(error)}`, 502, 'api_error');
  }

  if (!upstream.ok) {
    const detail = (await upstream.text()).slice(0, 300);
    return apiError(`Ядро вернуло ${upstream.status}: ${detail}`, 502, 'api_error');
  }

  const data = (await upstream.json()) as {
    choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  };

  const text = String(data.choices?.[0]?.message?.content || '');
  const tokensIn = Number(data.usage?.prompt_tokens || 0);
  const tokensOut = Number(data.usage?.completion_tokens || 0);
  const cost = chatCost(requested, tokensIn, tokensOut);
  const balance = await charge(caller, {
    endpoint: 'chat',
    cost,
    tokens_in: tokensIn,
    tokens_out: tokensOut,
    model: requested,
  });

  return NextResponse.json(
    {
      id: `maxcmpl-${Date.now().toString(36)}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: requested,
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: text },
          finish_reason: data.choices?.[0]?.finish_reason || 'stop',
        },
      ],
      usage: {
        prompt_tokens: tokensIn,
        completion_tokens: tokensOut,
        total_tokens: Number(data.usage?.total_tokens || tokensIn + tokensOut),
      },
      max: { cost, balance, currency: 'MIRCOIN', latency_ms: Date.now() - started },
    },
    { headers: billingHeaders(cost, balance) },
  );
}
