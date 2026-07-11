import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

// ASR (speech-to-text) front-stage of the NOESIS dubbing pipeline. Transcribes an
// uploaded audio/video file via Gemini (native multilingual audio understanding —
// no local Whisper/ffmpeg needed on this Mac). Key stays server-side.
// POST multipart/form-data { file } -> { ok, text }.
// No key configured -> 503 { error: 'no_key' }.

const MODEL = process.env.MAX17_ASR_MODEL?.trim() || 'gemini-2.5-flash';
const MAX_BYTES = 18 * 1024 * 1024; // inline_data must fit the ~20MB request budget

const PROMPT =
  'You are an automatic speech-recognition engine. Transcribe the spoken audio ' +
  'VERBATIM in its original language. Return ONLY the transcript text — no notes, ' +
  'no timestamps, no speaker labels, no translation, no quotes. If there is no ' +
  'speech, return an empty string.';

function key(): string | null {
  return process.env.GEMINI_API_KEY?.trim() || null;
}

// Browsers sometimes send a blank or generic type; fall back to the extension.
function resolveMime(file: File): string {
  if (file.type && file.type !== 'application/octet-stream') return file.type;
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const map: Record<string, string> = {
    mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav',
    ogg: 'audio/ogg', opus: 'audio/ogg', flac: 'audio/flac', aiff: 'audio/aiff', aif: 'audio/aiff',
    webm: 'video/webm', mp4: 'video/mp4', mov: 'video/quicktime', mpeg: 'video/mpeg',
  };
  return map[ext] || 'audio/mpeg';
}

export async function POST(request: Request) {
  const k = key();
  if (!k) return NextResponse.json({ error: 'no_key' }, { status: 503 });

  let file: File | null = null;
  try {
    const form = await request.formData();
    const f = form.get('file');
    if (f instanceof File) file = f;
  } catch {
    return NextResponse.json({ error: 'bad_form' }, { status: 400 });
  }
  if (!file) return NextResponse.json({ error: 'no_file' }, { status: 400 });
  if (file.size === 0) return NextResponse.json({ error: 'empty_file' }, { status: 400 });
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'too_large', detail: 'до 18 МБ (возьми клип покороче)' }, { status: 413 });
  }

  const base64 = Buffer.from(await file.arrayBuffer()).toString('base64');
  const mimeType = resolveMime(file);

  const payload = {
    contents: [
      {
        parts: [
          { inline_data: { mime_type: mimeType, data: base64 } },
          { text: PROMPT },
        ],
      },
    ],
    // Transcription needs no reasoning — kill thinking to save time/tokens.
    generationConfig: { temperature: 0, thinkingConfig: { thinkingBudget: 0 } },
  };

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${k}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) },
    );
    if (!res.ok) {
      return NextResponse.json({ error: 'gemini', status: res.status, detail: (await res.text()).slice(0, 300) }, { status: 502 });
    }
    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = (data.candidates?.[0]?.content?.parts ?? [])
      .map((p) => p.text || '')
      .join('')
      .trim();
    return NextResponse.json({ ok: true, text });
  } catch (e) {
    return NextResponse.json({ error: 'fetch_failed', detail: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
