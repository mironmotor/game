import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

// MAX's eyes for the game-companion mode. Prefers a LOCAL vision model (LM Studio,
// no limits) and falls back to Gemini only if no local VLM is up. Gonka's own
// models are text-only, so image understanding must come from one of these two.
// POST { image: base64|dataURL, prompt?, mime? } -> { ok, text, via }.

const GEMINI_MODEL = process.env.MAX17_VISION_MODEL?.trim() || 'gemini-2.5-flash';
const LOCAL_BASE = (process.env.MAX17_LOCAL_VISION_URL || 'http://127.0.0.1:1234/v1').replace(/\/+$/, '');

const DEFAULT_PROMPT =
  'Опиши ОДНОЙ короткой фразой, что происходит на этом кадре игры Cyberpunk 2077: ' +
  'где герой, что вокруг, экшен/диалог/меню. Только факты, по-русски, без оценок.';

function geminiKey(): string | null {
  return process.env.GEMINI_API_KEY?.trim() || null;
}

// Local VLM via LM Studio's OpenAI-compatible endpoint (image_url data URL).
// Returns null if LM Studio is down or has no model loaded — then we try Gemini.
async function tryLocalVision(prompt: string, dataUrl: string): Promise<string | null> {
  try {
    const mres = await fetch(`${LOCAL_BASE}/models`, { signal: AbortSignal.timeout(1200) });
    if (!mres.ok) return null;
    const models = ((await mres.json()) as { data?: Array<{ id?: string }> }).data ?? [];
    const ids = models.map((m) => String(m.id || '')).filter(Boolean);
    // Prefer a vision-capable model (won't accidentally hand an image to a text LLM).
    // gemma-?3 ловит и LM Studio 'gemma-3', и Ollama 'gemma3:4b'.
    const VLM = /gemma-?3|vl\b|vision|llava|minicpm|moondream|pixtral|internvl|qwen2\.?5?-vl/i;
    // Быстрые заточенные под зрение — вперёд (moondream/qwen-vl), иначе любой VLM.
    const FAST = /moondream|qwen2\.?5?-vl|llava|minicpm|pixtral/i;
    const model = ids.find((id) => FAST.test(id)) ?? ids.find((id) => VLM.test(id)) ?? ids[0];
    if (!model) return null;
    const res = await fetch(`${LOCAL_BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer lm-studio' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: dataUrl } }] },
        ],
        max_tokens: 120,
        temperature: 0.6,
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) return null;
    const d = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const text = String(d.choices?.[0]?.message?.content || '').trim();
    return text || null;
  } catch {
    return null;
  }
}

async function tryGemini(prompt: string, mime: string, base64: string): Promise<{ text?: string; error?: Record<string, unknown> }> {
  const k = geminiKey();
  if (!k) return { error: { error: 'no_key' } };
  const payload = {
    contents: [{ parts: [{ inline_data: { mime_type: mime, data: base64 } }, { text: prompt }] }],
    generationConfig: { temperature: 0.8, thinkingConfig: { thinkingBudget: 0 }, maxOutputTokens: 120 },
  };
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${k}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      return { error: { error: 'gemini', status: res.status, detail: (await res.text()).slice(0, 200) } };
    }
    const data = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const text = (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text || '').join('').trim();
    return { text };
  } catch (e) {
    return { error: { error: 'fetch_failed', detail: e instanceof Error ? e.message : String(e) } };
  }
}

export async function POST(request: Request) {
  let image = '';
  let prompt = DEFAULT_PROMPT;
  let mime = 'image/jpeg';
  try {
    const b = (await request.json()) as { image?: string; prompt?: string; mime?: string };
    image = String(b.image ?? '');
    if (b.prompt) prompt = String(b.prompt);
    if (b.mime) mime = String(b.mime);
  } catch {
    return NextResponse.json({ error: 'bad_body' }, { status: 400 });
  }
  const m = image.match(/^data:([^;]+);base64,([\s\S]*)$/);
  if (m) {
    mime = m[1];
    image = m[2];
  }
  if (!image) return NextResponse.json({ error: 'no_image' }, { status: 400 });
  const dataUrl = `data:${mime};base64,${image}`;

  // 1) local VLM first — sovereign, no limits. OFF by default: a 4B VLM on an
  // integrated GPU (MacBook Air) takes ~2 min per frame, unusable for live play.
  // Set MAX17_LOCAL_VISION=true on capable hardware (dGPU) to prefer local.
  if (process.env.MAX17_LOCAL_VISION === 'true') {
    const local = await tryLocalVision(prompt, dataUrl);
    if (local) return NextResponse.json({ ok: true, text: local, via: 'local' });
  }

  // 2) Gemini fallback.
  const g = await tryGemini(prompt, mime, image);
  if (g.text) return NextResponse.json({ ok: true, text: g.text, via: 'gemini' });

  return NextResponse.json({ ok: false, ...(g.error ?? { error: 'no_vision' }) }, { status: 502 });
}
