import { NextResponse } from 'next/server';
import { canonicalizeLocale } from '@/lib/i18n/config';
import {
  listElevenLabsVoices,
  listLocalVoices,
  parseVoiceReference,
  synthesizeElevenLabs,
  synthesizeLocal,
  type TtsAttemptResult,
  type TtsPersona,
  type TtsProviderId,
  type TtsSynthesisInput,
} from './providers';

export const runtime = 'nodejs';
export const maxDuration = 60;

const rateLimit = new Map<string, { count: number; resetAt: number }>();

function clamp(value: unknown, fallback: number, minimum: number, maximum: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, value))
    : fallback;
}

function isRateLimited(request: Request): boolean {
  const limit = clamp(Number(process.env.TTS_RATE_LIMIT_PER_MINUTE), 30, 1, 300);
  const key = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  const now = Date.now();
  const current = rateLimit.get(key);
  if (!current || current.resetAt <= now) {
    rateLimit.set(key, { count: 1, resetAt: now + 60_000 });
    return false;
  }
  current.count += 1;
  return current.count > limit;
}

export async function GET() {
  const [local, elevenLabs] = await Promise.all([listLocalVoices(), listElevenLabsVoices()]);
  const providers = [local, elevenLabs].map(({ voices: _voices, ...status }) => status);
  const voices = [...local.voices, ...elevenLabs.voices];
  const activeProvider = local.available ? 'max-local' : elevenLabs.available ? 'elevenlabs' : 'system';
  const status = local.available || elevenLabs.available ? 200 : 503;

  return NextResponse.json(
    {
      ...(status === 503 ? { error: local.configured || elevenLabs.configured ? 'providers_unavailable' : 'no_provider' } : {}),
      active_provider: activeProvider,
      providers,
      voices,
    },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function POST(request: Request) {
  if (isRateLimited(request)) {
    return NextResponse.json(
      { error: 'rate_limited', retry_after_seconds: 60 },
      { status: 429, headers: { 'Retry-After': '60', 'Cache-Control': 'no-store' } },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'bad_json' }, { status: 400 });
  }

  const text = String(body.text ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return NextResponse.json({ error: 'empty_text' }, { status: 400 });
  if (text.length > 2500) return NextResponse.json({ error: 'too_long' }, { status: 400 });

  const persona: TtsPersona = body.persona === 'friday' ? 'friday' : 'jarvis';
  const requestedVoice = parseVoiceReference(typeof body.voiceId === 'string' ? body.voiceId : undefined);
  const input: TtsSynthesisInput = {
    text,
    persona,
    language: canonicalizeLocale(body.language),
    emotion: typeof body.emotion === 'string' ? body.emotion.slice(0, 40) : undefined,
    stability: clamp(body.stability, persona === 'friday' ? 0.4 : 0.55, 0, 1),
    similarity: clamp(body.similarity, 0.8, 0, 1),
    style: clamp(body.style, persona === 'friday' ? 0.35 : 0.15, 0, 1),
    speed: clamp(body.speed, 0.96, 0.5, 2),
    stream: body.stream === true,
    signal: request.signal,
  };

  const order: TtsProviderId[] =
    requestedVoice.provider === 'elevenlabs'
      ? ['elevenlabs', 'max-local']
      : ['max-local', 'elevenlabs'];
  const attempts: Array<{ provider: TtsProviderId; error: string; status?: number }> = [];

  for (const provider of order) {
    let result: TtsAttemptResult;
    if (provider === 'max-local') {
      result = await synthesizeLocal({
        ...input,
        voiceId: requestedVoice.provider === 'max-local' ? requestedVoice.id : undefined,
      });
    } else {
      result = await synthesizeElevenLabs({
        ...input,
        voiceId: requestedVoice.provider === 'elevenlabs' ? requestedVoice.id : undefined,
      });
    }

    if (!result.ok) {
      attempts.push({ provider: result.provider, error: result.error, status: result.status });
      if (request.signal.aborted) return new Response(null, { status: 499 });
      continue;
    }

    const responseHeaders = new Headers({
      'Content-Type': result.contentType,
      'Cache-Control': 'no-store, no-transform',
      'X-TTS-Provider': result.provider,
      'X-TTS-Voice': result.voiceId,
    });
    // Сюда мы попадаем и когда предпочтённый провайдер упал, а озвучил резерв.
    // Раньше attempts в этом случае просто выбрасывались: наружу уходил 200 и
    // звук, и отличить «локальный голос работает» от «локальный молча умер, вы
    // слышите ElevenLabs» было нельзя — какой голос ни выбери, звучали одни и
    // те же два. Причину отказа отдаём заголовком, чтобы клиент мог её показать.
    if (attempts.length > 0) {
      responseHeaders.set(
        'X-TTS-Fallback',
        attempts.map((a) => `${a.provider}=${a.error}${a.status ? `(${a.status})` : ''}`).join(', '),
      );
    }
    if (result.stream) {
      responseHeaders.set('X-TTS-Stream', result.stream.format);
      responseHeaders.set('X-TTS-Sample-Rate', String(result.stream.sampleRate));
      responseHeaders.set('X-TTS-Channels', String(result.stream.channels));
      responseHeaders.set('X-Accel-Buffering', 'no');
    }
    return new NextResponse(result.body, {
      status: 200,
      headers: responseHeaders,
    });
  }

  return NextResponse.json({ error: 'tts_unavailable', attempts }, { status: 503 });
}
