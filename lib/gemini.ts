import { GoogleGenAI, Type, Modality } from "@google/genai";

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

export async function* getMultiAgentGeminiResponseStream(message: string, history: any[], userContext?: string, showReasoning: boolean = false) {
  const ai = new GoogleGenAI({ apiKey: process.env.NEXT_PUBLIC_GEMINI_API_KEY! });
  
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

  // Make 1 single call to gemini-2.5-flash for the experts instead of 4
  const expertsRawResponse = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [
      ...history,
      { role: "user", parts: [{ text: message }] }
    ],
    config: {
      systemInstruction: multiAgentPrompt,
      responseMimeType: "application/json",
      temperature: 0.6,
    }
  });

  let expertResponses: { name: string, text: string }[] = [];
  try {
    const rawText = expertsRawResponse.text?.trim() || "[]";
    const jsonStr = rawText.replace(/```json\n?|\n?```/g, '').trim();
    expertResponses = JSON.parse(jsonStr);
  } catch (e) {
    console.error("Failed to parse JSON from multi-agent", e);
    // Fallback if parsing fails
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

  // Send to Synthesizer using gemini-2.5-pro or flash via stream
  const responseStream = await ai.models.generateContentStream({
    model: "gemini-2.5-pro",
    contents: [
      { role: "user", parts: [{ text: `User Message: "${message}"\n\n${expertOutputs}` }] }
    ],
    config: {
      systemInstruction: synthesizerInstruction,
      temperature: 0.5,
    }
  });

  for await (const chunk of responseStream) {
    yield chunk;
  }
}

export async function executeAiAgentTask(taskDesc: string, context?: string) {
  const ai = new GoogleGenAI({ apiKey: process.env.NEXT_PUBLIC_GEMINI_API_KEY! });
  
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [
      { role: "user", parts: [{ text: `TASK TO EXECUTE: ${taskDesc}\n\nCONTEXT:\n${context || "No additional context."}` }] }
    ],
    config: {
      systemInstruction: AGENT_EXECUTION_INSTRUCTION,
      temperature: 0.4,
      tools: [{ googleSearch: {} }],
    }
  });

  return response.text;
}

export async function getGeminiResponseStream(message: string, history: any[], userContext?: string, customSystemPrompt?: string) {
  const ai = new GoogleGenAI({ apiKey: process.env.NEXT_PUBLIC_GEMINI_API_KEY! });
  
  const contextPart = userContext ? `\n\nUSER HISTORY CONTEXT:\n${userContext}` : "";
  const finalSystemInstruction = customSystemPrompt ? customSystemPrompt : (SYSTEM_INSTRUCTION + contextPart);
  
  const responseStream = await ai.models.generateContentStream({
    model: "gemini-2.5-flash",
    contents: [
      ...history,
      { role: "user", parts: [{ text: message }] }
    ],
    config: {
      systemInstruction: finalSystemInstruction,
      temperature: 0.7,
      tools: [{ googleSearch: {} }],
    }
  });

  return responseStream;
}

export async function getGeminiResponse(message: string, history: any[], userContext?: string) {
  const ai = new GoogleGenAI({ apiKey: process.env.NEXT_PUBLIC_GEMINI_API_KEY! });
  
  const contextPart = userContext ? `\n\nUSER HISTORY CONTEXT:\n${userContext}` : "";
  
  const model = ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [
      ...history,
      { role: "user", parts: [{ text: message }] }
    ],
    config: {
      systemInstruction: SYSTEM_INSTRUCTION + contextPart,
      temperature: 0.7,
      tools: [{ googleSearch: {} }],
    }
  });

  const response = await model;
  return response.text;
}

export async function generateImage(prompt: string): Promise<string | null> {
  const ai = new GoogleGenAI({ apiKey: process.env.NEXT_PUBLIC_GEMINI_API_KEY! });
  
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash-preview-image-generation',
      contents: {
        parts: [
          {
            text: prompt,
          },
        ],
      },
      config: {
        imageConfig: {
          aspectRatio: "1:1",
        },
      },
    });

    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData) {
        const base64EncodeString: string = part.inlineData.data;
        return `data:${part.inlineData.mimeType || 'image/png'};base64,${base64EncodeString}`;
      }
    }
    return null;
  } catch (error) {
    if (error instanceof Error && (error.name === 'AbortError' || error.message.toLowerCase().includes('abort'))) {
      console.log("Image generation skipped: user aborted");
      return null;
    }
    console.error("Image generation failed:", error);
    throw error;
  }
}

export async function generateSpeech(text: string): Promise<string | null> {
  if (!process.env.NEXT_PUBLIC_GEMINI_API_KEY) {
    console.error("Gemini API key is missing");
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
            prebuiltVoiceConfig: { voiceName: 'Puck' }, // Puck is a good male voice
          },
        },
      },
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (base64Audio) {
      // Gemini returns raw PCM audio data. We must wrap it in a WAV header to play in <audio> tag.
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
