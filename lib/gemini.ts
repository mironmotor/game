import { GoogleGenAI } from "@google/genai";

const SYSTEM_INSTRUCTION = `
You are a game-like task management assistant. Help the user plan their day using the MGR framework.

MGR LEVELS:
- MGR-3: Major breakthrough tasks (50 XP) — hardest, most important
- MGR-2: Focus tasks (30 XP) — require concentration
- MGR-1: Simple logistics (10 XP) — quick routine tasks

TONE: Short, friendly, practical. 1-2 sentences max. No dramatic roleplay. No fake system messages. No error simulations. Just talk normally to the user in Russian. Call them "Босс".

HOW IT WORKS:

If there are NO active tasks (the message starts with "[СИСТЕМА: НОВАЯ СЕССИЯ]"):
Ask 3 questions ONE AT A TIME, waiting for each answer:
1. "Какая главная задача на сегодня, Босс? (MGR-3)"
2. After they answer: "Что ещё требует внимания или привычек? (MGR-2)"
3. After they answer: "Какая мелкая логистика осталась? (MGR-1)"
4. After ALL 3 answers — create a JSON block with all tasks

If there ARE active tasks (the message starts with "[СИСТЕМА: ПРОДОЛЖЕНИЕ СЕССИИ]"):
The active tasks are listed in the message. Briefly greet the user back, comment on their tasks, and ask what they want to work on. Do NOT ask the 3 MGR questions.

JSON RULES (ONLY when creating or updating tasks):
- Output a JSON block at the end of your message
- Wrap it in backtick-fenced json code block
- Include: id (unique string), desc, mgr (MGR-1/MGR-2/MGR-3), xp (10/30/50), status ("active"), scheduledTime ("HH:MM"), deadline (ISO 8601 date)
- Can also include: delete_tasks (array of ids), complete_tasks (array of ids), xp_gain (number), agent_insight (short string)

Example JSON:
\`\`\`json
{
  "tasks": [{"id": "task_1", "desc": "Write project plan", "mgr": "MGR-3", "xp": 50, "status": "active", "scheduledTime": "10:00", "deadline": "2026-05-11T18:00:00Z"}],
  "xp_gain": 50,
  "agent_insight": "День начинается с фокуса"
}
\`\`\`

IMPORTANT: Never output fake system errors, connection failures, or technical status messages. You are a helpful assistant, not a computer terminal.
`;
const AGENT_EXECUTION_INSTRUCTION = `
You are the "AGI Execution Module" of the Reality Creator system.
Your goal is to take a task description and "execute" it as if you were an autonomous agent.
You have access to Google Search. Use it to find up-to-date information, documentation, or data required to complete the task.

If the task is digital/informational (e.g., "write a script", "summarize", "create a plan", "research X"):
- Provide the ACTUAL result/content.
- Be thorough and professional.

If the task is physical or external (e.g., "go to the gym", "buy milk"):
- Provide a detailed "Tactical Execution Plan" (TEP).
- Break it down into micro-steps.
- Provide a "Mental Simulation" of the successful completion.

FORMAT:
Return your response in Markdown.
Start with a "STATUS: EXECUTING..." header.
End with a "RESULT: [SUCCESS/COMPLETED]" block.
`;

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_MODEL = "qwen/qwen-3.6-plus-preview";

// Convert Google-style history {role, parts: [{text}]} to OpenAI-style {role, content}
function convertHistoryToOpenAI(history: any[]): any[] {
  return history.map(msg => {
    if (msg.parts && Array.isArray(msg.parts)) {
      return { role: msg.role, content: msg.parts.map((p: any) => p.text || '').join('') };
    }
    return msg;
  });
}

function getApiKey(): string {
  return process.env.NEXT_PUBLIC_OPENROUTER_API_KEY || process.env.NEXT_PUBLIC_GEMINI_API_KEY || "";
}

export async function* getGeminiResponseStream(message: string, history: any[], userContext?: string, customSystemPrompt?: string) {
  const contextPart = userContext ? `\n\nUSER HISTORY CONTEXT:\n${userContext}` : "";
  const finalSystemInstruction = customSystemPrompt ? customSystemPrompt : (SYSTEM_INSTRUCTION + contextPart);

  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${getApiKey()}`,
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      messages: [
        { role: "system", content: finalSystemInstruction },
        ...convertHistoryToOpenAI(history),
        { role: "user", content: message }
      ],
      stream: true,
      temperature: 0.7,
    }),
  });

  if (!response.ok || !response.body) throw new Error(`OpenRouter API error: ${response.status}`);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed === 'data: [DONE]') continue;
      if (trimmed.startsWith('data: ')) {
        try {
          const parsed = JSON.parse(trimmed.slice(6));
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) yield { text: delta };
        } catch {}
      }
    }
  }
}

export async function getGeminiResponse(message: string, history: any[], userContext?: string) {
  const contextPart = userContext ? `\n\nUSER HISTORY CONTEXT:\n${userContext}` : "";

  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${getApiKey()}`,
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      messages: [
        { role: "system", content: SYSTEM_INSTRUCTION + contextPart },
        ...convertHistoryToOpenAI(history),
        { role: "user", content: message }
      ],
      temperature: 0.7,
    }),
  });

  const data = await response.json();
  return data.choices?.[0]?.message?.content || '';
}

export async function* getMultiAgentGeminiResponseStream(message: string, history: any[], userContext?: string, showReasoning: boolean = false) {
  const contextPart = userContext ? `\n\nUSER HISTORY CONTEXT:\n${userContext}` : "";

  const multiAgentPrompt = `Вы - система из 4-х специализированных ИИ-модулей, анализирующих запрос пользователя.
Выведите ТОЛЬКО валидный JSON массив объектов в следующем формате:
[
  { "name": "Гиппокамп (Модуль Памяти)", "text": "..." },
  { "name": "Префронтальная кора (Модуль Симуляции)", "text": "..." },
  { "name": "Амигдала (Модуль Критики и Рисков)", "text": "..." },
  { "name": "Модуль Креативности", "text": "..." }
]

Инструкции для каждого модуля:
1. "Гиппокамп (Модуль Памяти)": Извлечь релевантный опыт пользователя. Что работало или не работало ранее. СТРОГО 1-2 коротких предложения. Только факты. Никаких приветствий.
2. "Префронтальная кора (Модуль Симуляции)": Прогноз и следующие шаги. СТРОГО 1-2 коротких предложения. Без воды. Никаких приветствий.
3. "Амигдала (Модуль Критики и Рисков)": Жесткая критика, поиск рисков и логических дыр. СТРОГО 1-2 коротких предложения. Максимально прямолинейно. Никаких приветствий.
4. "Модуль Креативности": Смелый, нестандартный подход (латеральное мышление). СТРОГО 1-2 коротких предложения. Никаких приветствий.

${contextPart}`;

  // Experts call - non-streaming
  const expertsResponse = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${getApiKey()}`,
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      messages: [
        { role: "system", content: multiAgentPrompt },
        ...convertHistoryToOpenAI(history),
        { role: "user", content: message }
      ],
      temperature: 0.6,
    }),
  });

  let expertResponses: { name: string, text: string }[] = [];
  try {
    const expertsData = await expertsResponse.json();
    const rawText = expertsData.choices?.[0]?.message?.content?.trim() || "[]";
    const jsonStr = rawText.replace(/```json\n?|\n?```/g, '').trim();
    expertResponses = JSON.parse(jsonStr);
  } catch (e) {
    console.error("Failed to parse JSON from multi-agent", e);
    expertResponses = [
      { name: "Системный Сбой", text: "Модули не смогли синхронизировать данные (429 или ошибка парсинга)." }
    ];
  }

  // Format their outputs
  let expertOutputs = "EXPERT ANALYSES:\n\n";
  expertResponses.forEach((res) => {
    expertOutputs += `--- ${res.name} ---\n${res.text}\n\n`;
  });

  if (showReasoning && expertResponses.length > 0) {
    yield { text: `> **[СИСТЕМНЫЙ АНАЛИЗ МУЛЬТИАГЕНТА]**\n>\n` };
    for (let i = 0; i < expertResponses.length; i++) {
      yield { text: `> **${expertResponses[i].name}:**\n> ${expertResponses[i].text?.replace(/\n/g, '\n> ')}\n>\n` };
    }
    yield { text: `> **[СИНТЕЗ ФИНАЛЬНОГО ОТВЕТА...]**\n\n---\n\n` };
  }

  // Synthesizer instruction
  let synthesizerInstruction = `Ты финальный Синтезатор GAME AI. Перед тобой мнения отделов мозга. ВАЖНО: Не перечисляй и не повторяй их мысли по отдельности! Сделай короткий, мощный, единый вывод и прямой ответ на запрос разработчика. Тон: холодный, прагматичный, 'Minimalist & Direct'. Отвечай от лица 'Системы'. Никаких излишних заумных метафор и пустой воды. Только суть и действие.`;

  if (message.includes("START_GAME_COMMAND") || message.includes("SYSTEM_RESUME_COMMAND")) {
    synthesizerInstruction = `Ты финальный Синтезатор GAME AI. Система запускает новую сессию или возвращает пользователя в работу. 
Твоя задача — погрузить пользователя (Босса) в контекст игры перед стартом.
Используй аналитику отделов мозга, чтобы составить ОБЪЕМНОЕ, детализированное и атмосферное приветствие в стиле технологичного ИИ (как Джарвис/Пятница).
1. Опиши текущий статус, уровень энергии и разбей оставшиеся задачи по сложности.
2. Дай стратегические рекомендации по дальнейшим действиям.
3. В конце сообщения ВСЕГДА спроси: "Какова наша главная задача на сегодня (MGR-3)?".
Подавай эту информацию как единую мощную и иммерсивную сводку (можно использовать списки и абзацы). Ограничения на длину в этом сообщении НЕТ.`;
  }

  // Synthesizer call - streaming
  const synthResponse = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${getApiKey()}`,
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      messages: [
        { role: "system", content: synthesizerInstruction },
        ...convertHistoryToOpenAI(history),
        { role: "user", content: `User Message: "${message}"\n\n${expertOutputs}` }
      ],
      stream: true,
      temperature: 0.5,
    }),
  });

  if (!synthResponse.ok || !synthResponse.body) throw new Error(`OpenRouter API error (synthesizer): ${synthResponse.status}`);

  const reader = synthResponse.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed === 'data: [DONE]') continue;
      if (trimmed.startsWith('data: ')) {
        try {
          const parsed = JSON.parse(trimmed.slice(6));
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) yield { text: delta };
        } catch {}
      }
    }
  }
}

export async function executeAiAgentTask(taskDesc: string, context?: string) {
  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${getApiKey()}`,
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      messages: [
        { role: "system", content: AGENT_EXECUTION_INSTRUCTION },
        { role: "user", content: `TASK TO EXECUTE: ${taskDesc}\n\nCONTEXT:\n${context || "No additional context."}` }
      ],
      temperature: 0.4,
    }),
  });

  const data = await response.json();
  return data.choices?.[0]?.message?.content || '';
}

export async function generateImage(prompt: string): Promise<string | null> {
  // Try OpenRouter image generation first (black-forest-labs)
  try {
    const response = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${getApiKey()}`,
      },
      body: JSON.stringify({
        model: "black-forest-labs/flux-schnell",
        messages: [
          { role: "user", content: prompt }
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenRouter image API error: ${response.status}`);
    }

    const data = await response.json();
    // OpenRouter image models return base64 in the content or in a data array
    const content = data.choices?.[0]?.message?.content;
    if (content && content.startsWith('data:image')) {
      return content;
    }
    // Some models return a URL
    if (content && content.startsWith('http')) {
      return content;
    }

    // Fallback: check for data array in the response
    if (data.data && data.data[0]?.b64_json) {
      return `data:image/png;base64,${data.data[0].b64_json}`;
    }
    if (data.data && data.data[0]?.url) {
      return data.data[0].url;
    }

    return null;
  } catch (error) {
    console.error("OpenRouter image generation failed, falling back to Google:", error);
    // Fallback to Google Gemini image generation
    if (!process.env.NEXT_PUBLIC_GEMINI_API_KEY) {
      console.error("Gemini API key is also missing");
      throw error;
    }

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.NEXT_PUBLIC_GEMINI_API_KEY });
      const geminiResponse = await ai.models.generateContent({
        model: 'gemini-2.0-flash-preview-image-generation',
        contents: {
          parts: [{ text: prompt }],
        },
        config: {
          imageConfig: { aspectRatio: "1:1" },
        },
      });

      for (const part of geminiResponse.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData) {
          const base64EncodeString: string = part.inlineData.data;
          return `data:${part.inlineData.mimeType || 'image/png'};base64,${base64EncodeString}`;
        }
      }
      return null;
    } catch (geminiError) {
      console.error("Google image generation also failed:", geminiError);
      throw error;
    }
  }
}

// TTS disabled: Google API key replaced with OpenRouter (no TTS equivalent)
export async function generateSpeech(text: string): Promise<string | null> {
  // TTS disabled: OpenRouter doesn't support speech synthesis
  console.log('TTS skipped: OpenRouter has no TTS');
  return null;
}

function pcmBase64ToWavUrl(pcmBase64: string, sampleRate = 24000): string {
  let binaryString: string;
  if (typeof Buffer !== 'undefined') {
    binaryString = Buffer.from(pcmBase64, 'base64').toString('binary');
  } else {
    binaryString = atob(pcmBase64);
  }
  
  const pcmBytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    pcmBytes[i] = binaryString.charCodeAt(i);
  }
  
  const buffer = new ArrayBuffer(44 + pcmBytes.length);
  const view = new DataView(buffer);
  
  const writeString = (view: DataView, offset: number, string: string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };

  // RIFF chunk descriptor
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + pcmBytes.length, true);
  writeString(view, 8, 'WAVE');
  
  // FMT sub-chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); 
  view.setUint16(20, 1, true); 
  view.setUint16(22, 1, true); 
  view.setUint32(24, sampleRate, true); 
  view.setUint32(28, sampleRate * 2, true); 
  view.setUint16(32, 2, true); 
  view.setUint16(34, 16, true); 
  
  // Data sub-chunk
  writeString(view, 36, 'data');
  view.setUint32(40, pcmBytes.length, true);
  
  // Write PCM data
  for (let i = 0; i < pcmBytes.length; i++) {
    view.setUint8(44 + i, pcmBytes[i]);
  }
  
  let base64 = '';
  const bytes = new Uint8Array(buffer);
  
  if (typeof Buffer !== 'undefined') {
    base64 = Buffer.from(bytes).toString('base64');
  } else {
    // Fallback for browser
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      base64 += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunkSize)));
    }
    base64 = btoa(base64);
  }
  
  return `data:audio/wav;base64,${base64}`;
}
