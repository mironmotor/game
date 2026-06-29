// Воронка — Big Idea Generator
// Multi-stage "funnel": pour raw inputs in at the top → narrow through sparks → one Big Idea at the bottom.
// Runs fully client-side against OpenRouter (same pattern as lib/gemini.ts), so it works on the static export.

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_MODEL = "google/gemini-2.0-flash-exp:free";

function getApiKey(): string {
  return process.env.NEXT_PUBLIC_OPENROUTER_API_KEY || process.env.NEXT_PUBLIC_GEMINI_API_KEY || "";
}

export interface FunnelSeed {
  domain: string;      // сфера / индустрия
  audience: string;    // для кого
  trend: string;       // тренд / технология
  twist: string;       // ограничение / неожиданный поворот
}

export interface BigIdea {
  name: string;        // звучное название продукта
  tagline: string;     // одна строка — суть big idea
  problem: string;     // какую боль решает
  solution: string;    // как решает
  whoFor: string;      // кому это нужно
  whyNow: string;      // почему именно сейчас
  magic: string;       // нечестное преимущество / wow-фактор
  firstStep: string;   // первый шаг / MVP за выходные
  boldness: number;    // дерзость 1-10
  scale: number;       // потенциал масштаба 1-10
}

function buildSeedLine(seed: FunnelSeed): string {
  const parts: string[] = [];
  if (seed.domain.trim()) parts.push(`Сфера: ${seed.domain.trim()}`);
  if (seed.audience.trim()) parts.push(`Аудитория: ${seed.audience.trim()}`);
  if (seed.trend.trim()) parts.push(`Тренд/технология: ${seed.trend.trim()}`);
  if (seed.twist.trim()) parts.push(`Поворот/ограничение: ${seed.twist.trim()}`);
  if (parts.length === 0) return "Полная свобода — придумай что-то по-настоящему дерзкое и неожиданное.";
  return parts.join("\n");
}

function stripFence(raw: string): string {
  return raw.replace(/```json\n?|```\n?|```/g, "").trim();
}

async function callOpenRouter(systemPrompt: string, userPrompt: string, temperature: number): Promise<string> {
  const key = getApiKey();
  if (!key) {
    throw new Error("Нет API-ключа. Задай NEXT_PUBLIC_OPENROUTER_API_KEY или NEXT_PUBLIC_GEMINI_API_KEY.");
  }
  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature,
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenRouter API error: ${response.status}`);
  }
  const data = await response.json();
  return data.choices?.[0]?.message?.content || "";
}

// СТАДИЯ 1 — широкое горло воронки: генерируем много сырых искр (фрагментов идеи).
export async function generateSparks(seed: FunnelSeed): Promise<string[]> {
  const system = `Ты — генератор сырых креативных «искр» для стартап-идей.
Твоя задача — на основе входных данных выдать МНОГО разрозненных, смелых, неочевидных фрагментов идей.
Это верх воронки: количество и разнообразие важнее качества. Латеральное мышление, неожиданные комбинации.
Выведи СТРОГО валидный JSON-массив из 8 строк на русском. Каждая строка — короткая искра (5-12 слов).
Без пояснений, без markdown, только JSON-массив.`;

  const user = `ВХОДНЫЕ ДАННЫЕ:\n${buildSeedLine(seed)}\n\nВыдай 8 искр.`;
  const raw = await callOpenRouter(system, user, 0.95);
  try {
    const parsed = JSON.parse(stripFence(raw));
    if (Array.isArray(parsed)) return parsed.map((s) => String(s)).filter(Boolean).slice(0, 8);
  } catch {
    // fallback: разбить по строкам
    return stripFence(raw)
      .split("\n")
      .map((l) => l.replace(/^[-*\d.\s]+/, "").trim())
      .filter(Boolean)
      .slice(0, 8);
  }
  return [];
}

// СТАДИЯ 2 — узкое горло воронки: синтезируем одну Big Idea из искр.
export async function synthesizeBigIdea(seed: FunnelSeed, sparks: string[]): Promise<BigIdea> {
  const system = `Ты — синтезатор Big Idea. Это дно воронки.
Из набора сырых искр и входных данных собери ОДНУ мощную, цельную, дерзкую big idea — такую, ради которой хочется бросить всё и делать.
Не перечисляй искры. Сделай качественный скачок: соедини лучшее в неожиданное целое.
Тон: ясно, энергично, по делу, на русском. Без воды и клише.
Выведи СТРОГО валидный JSON-объект (без markdown) с полями:
{
  "name": "звучное название продукта (1-3 слова)",
  "tagline": "одна строка — суть big idea",
  "problem": "какую реальную боль решает (1-2 предложения)",
  "solution": "как решает (1-2 предложения)",
  "whoFor": "кому это нужно в первую очередь",
  "whyNow": "почему именно сейчас момент (тренд/технология)",
  "magic": "нечестное преимущество или wow-фактор",
  "firstStep": "первый конкретный шаг — что собрать за выходные",
  "boldness": число 1-10 (насколько идея дерзкая),
  "scale": число 1-10 (потенциал масштаба)
}`;

  const user = `ВХОДНЫЕ ДАННЫЕ:\n${buildSeedLine(seed)}\n\nСЫРЫЕ ИСКРЫ:\n${sparks.map((s, i) => `${i + 1}. ${s}`).join("\n")}\n\nСобери одну Big Idea.`;
  const raw = await callOpenRouter(system, user, 0.8);
  const parsed = JSON.parse(stripFence(raw));
  return {
    name: String(parsed.name || "Без названия"),
    tagline: String(parsed.tagline || ""),
    problem: String(parsed.problem || ""),
    solution: String(parsed.solution || ""),
    whoFor: String(parsed.whoFor || ""),
    whyNow: String(parsed.whyNow || ""),
    magic: String(parsed.magic || ""),
    firstStep: String(parsed.firstStep || ""),
    boldness: Math.max(1, Math.min(10, Number(parsed.boldness) || 5)),
    scale: Math.max(1, Math.min(10, Number(parsed.scale) || 5)),
  };
}
