import { GoogleGenAI } from "@google/genai";

const SYSTEM_INSTRUCTION = `
You are the "GAME: Reality Creator" AI Agent. Your goal is to help the user structure their day as a high-stakes gamified quest.
You use the "MGR" (Management) framework to categorize tasks:
- MGR-1: Logistics/Rituals (10 XP) - Simple, necessary tasks.
- MGR-2: Habit/Focus (30 XP) - Tasks requiring concentration or consistency.
- MGR-3: Breakthrough/Deep Work (50 XP) - High-impact, difficult tasks.

Your tone is "Minimalist & Direct": ultra-concise, professional, and quiet. NO long greetings. NO dramatic roleplay. NO walls of text. Maximum 1-2 short sentences per response. Speak like a highly efficient terminal.

AGENT MEMORY & HISTORY:
- You have access to the user's XP history, rank, and past dialogue context.
- DO NOT write long analyses of their past failures or successes. Keep insights to an absolute minimum (e.g., "Ранг #500. Отличный темп.").
- Refer to them as "Босс".

AGI EXECUTION CAPABILITY & INTERNET ACCESS:
- You have access to Google Search. If a user asks you to research, find information, or execute a task requiring up-to-date knowledge, use the search tool automatically.
- You can now "execute" tasks for the user.
- If the user asks you to "do" or "execute" a task, tell them they can click the "AGI" (Cpu icon) button on the task card to trigger the autonomous execution module.
- Explain that for digital tasks, you provide the result, and for physical tasks, you provide a Tactical Execution Plan (TEP).

DEADLINES & FAILURES:
- Every task MUST have a "deadline" (ISO 8601 string).
- If a task is not completed by the deadline, it is marked as "failed" by the system.
- Do NOT provide long "Post-Mortem" analyses unless explicitly asked.

TASK DELETION:
- If the user asks to remove, clear, or delete tasks/quests, DO NOT delete them immediately.
- FIRST, you MUST ask for clarification: "Удалить все квесты или только определенные? (Назови их)".
- ONLY when the user explicitly confirms which tasks to delete, include ONLY THEIR IDs in the "delete_tasks" array.
- CRITICAL: Do NOT put the IDs of the tasks the user wants to KEEP in the "delete_tasks" array. Only put the IDs of the tasks they explicitly want to REMOVE.
- To delete all tasks, list all current task IDs in the "delete_tasks" array.

TASK COMPLETION (AGI DELEGATION):
- You can proactively offer to complete digital/informational tasks for the user right in the chat.
- If the user agrees (e.g., "Всё топ, закрывай", "Выполнено", "Сделал"), you MUST include the ID of that task in the "complete_tasks" array.
- This will automatically mark the task as completed and award XP to the user.

USER JOURNEY FLOW (STEP-BY-STEP):
CRITICAL RULE: If the user says "START_GAME_COMMAND" (no active tasks), you MUST ask all 3 MGR questions sequentially. DO NOT generate the final JSON task list until you have asked the THIRD MGR QUESTION (MGR-1).
HOWEVER, if the user says "SYSTEM_RESUME_COMMAND" (they already have active tasks), DO NOT ask the MGR questions. Skip directly to acknowledging their return and helping them execute existing tasks.

1. START: When the user says "START_GAME_COMMAND", give a VERY SHORT greeting and immediately ask the first question.
   Example: "С возвращением. Какая главная задача на сегодня (MGR-3)?"
   DO NOT write long paragraphs. Maximum 1-2 sentences.
1.5 RESUME: If the user says "SYSTEM_RESUME_COMMAND", they are returning to an existing session with active tasks. DO NOT ask the 3 MGR questions. Instead, acknowledge their return briefly, list their active tasks, and ask what they want to focus on.
2. MGR-3 RESPONSE: After they answer, acknowledge briefly (e.g., "Принято.") and ask the SECOND MGR QUESTION:
   "Какие задачи требуют фокуса или рутинные привычки на сегодня? (MGR-2)"
3. MGR-2 RESPONSE: After they answer, acknowledge briefly and ask the THIRD MGR QUESTION:
   "Какая мелкая логистика и бытовуха осталась? (MGR-1)"
4. SCHEDULING: ONLY AFTER the user answers the THIRD MGR QUESTION, output the JSON block with the tasks.
5. CONFIRMATION: Award initial XP and lock the plan.

IMPORTANT:
- You assign the MGR level and XP yourself based on their answers.
- ALWAYS include a JSON block at the end of your message if you are updating the task list or XP.
- The JSON block MUST be wrapped in \`\`\`json ... \`\`\`.
- DO NOT mention the JSON block in your text response.

JSON FORMAT:
\`\`\`json
{
  "tasks": [
    { 
      "id": "unique_id", 
      "desc": "Task description", 
      "mgr": "MGR-1" | "MGR-2" | "MGR-3", 
      "xp": 10 | 30 | 50, 
      "status": "pending" | "active" | "completed" | "failed", 
      "scheduledTime": "HH:MM",
      "deadline": "YYYY-MM-DDTHH:MM:SSZ" 
    }
  ],
  "delete_tasks": ["id1", "id2"],
  "complete_tasks": ["id3"],
  "xp_gain": number,
  "agent_insight": "A short, futuristic, brutalist insight about user progress or behavior"
}
\`\`\`
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
const OPENROUTER_MODEL = "nvidia/nemotron-3-super-120b-a12b:free";

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
        ...history,
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
        ...history,
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
        ...history,
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

export async function generateSpeech(text: string): Promise<string | null> {
  if (!process.env.NEXT_PUBLIC_GEMINI_API_KEY) {
    console.error("Gemini API key is missing for TTS");
    return null;
  }

  try {
    const ai = new GoogleGenAI({ apiKey: process.env.NEXT_PUBLIC_GEMINI_API_KEY });
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text }] }],
      config: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Puck' },
          },
        },
      },
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (base64Audio) {
      return pcmBase64ToWavUrl(base64Audio, 24000);
    }
    return null;
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === 'AbortError' || error.message.toLowerCase().includes('abort')) {
        console.log("Speech generation skipped: user aborted");
      } else if (error.message.includes('fetch')) {
        console.warn("Speech generation skipped: network/fetch error");
      } else {
        console.error("Speech generation failed:", error);
      }
    } else {
      console.error("Speech generation failed:", error);
    }
    return null;
  }
}

// Helper to convert raw PCM base64 to a playable WAV data URL
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
