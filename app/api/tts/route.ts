import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

// ElevenLabs neural TTS. Key stays server-side (xi-api-key never reaches client).
// POST { text, persona?, voiceId?, stability?, similarity?, style?, speed? } -> audio/mpeg.
// GET -> { voices: [{ voice_id, name, labels }] } for the GODMODE picker.
// No key configured -> 503 { error: 'no_key' } so the client falls back to Web Speech.

const API = 'https://api.elevenlabs.io/v1';
const DEFAULT_JARVIS = 'pNInz6obpgDQGcFmaJgB'; // Adam — deep male
const DEFAULT_FRIDAY = 'EXAVITQu4vr4xnSDxMaL'; // Bella — female

function key(): string | null {
  return process.env.ELEVENLABS_API_KEY?.trim() || null;
}

function resolveVoice(persona: string, voiceId?: string): string {
  if (voiceId) return voiceId;
  if (persona === 'friday') return process.env.ELEVENLABS_VOICE_FRIDAY?.trim() || DEFAULT_FRIDAY;
  return process.env.ELEVENLABS_VOICE_JARVIS?.trim() || DEFAULT_JARVIS;
}

export async function GET() {
  const k = key();
  if (!k) return NextResponse.json({ error: 'no_key' }, { status: 503 });
  try {
    const res = await fetch(`${API}/voices`, { headers: { 'xi-api-key': k } });
    if (!res.ok) {
      return NextResponse.json({ error: 'elevenlabs', status: res.status, detail: await res.text() }, { status: 502 });
    }
    const data = (await res.json()) as { voices?: Array<{ voice_id: string; name: string; labels?: Record<string, string> }> };
    const voices = (data.voices ?? []).map((v) => ({ voice_id: v.voice_id, name: v.name, labels: v.labels ?? {} }));
    return NextResponse.json({ voices });
  } catch (e) {
    return NextResponse.json({ error: 'fetch_failed', detail: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}

export async function POST(request: Request) {
  const k = key();
  if (!k) return NextResponse.json({ error: 'no_key' }, { status: 503 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'bad_json' }, { status: 400 });
  }

  const text = String(body.text ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return NextResponse.json({ error: 'empty_text' }, { status: 400 });
  if (text.length > 2500) return NextResponse.json({ error: 'too_long' }, { status: 400 });

  const persona = body.persona === 'friday' ? 'friday' : 'jarvis';
  const voiceId = resolveVoice(persona, typeof body.voiceId === 'string' ? body.voiceId : undefined);
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

  // JARVIS: ровный, собранный (выше stability). Пятница: живее (выше style).
  const voice_settings = {
    stability: num(body.stability, persona === 'friday' ? 0.4 : 0.55),
    similarity_boost: num(body.similarity, 0.8),
    style: num(body.style, persona === 'friday' ? 0.35 : 0.15),
    use_speaker_boost: true,
    speed: num(body.speed, 0.96),
  };

  const callEleven = () =>
    fetch(`${API}/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'xi-api-key': k, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2', voice_settings }),
    });

  try {
    let res = await callEleven();
    // Free tier limits concurrent requests -> 429. One short retry smooths bursts.
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, 700));
      res = await callEleven();
    }
    if (!res.ok) {
      return NextResponse.json({ error: 'elevenlabs', status: res.status, detail: await res.text() }, { status: 502 });
    }
    const audio = await res.arrayBuffer();
    return new NextResponse(audio, {
      status: 200,
      headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' },
    });
  } catch (e) {
    return NextResponse.json({ error: 'fetch_failed', detail: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
