/**
 * Neural voice — кинематографичный голос MAX через ElevenLabs (серверный роут
 * /api/tts держит ключ у себя). Две персоны: JARVIS (мужской) и Пятница (женский).
 *
 * Если ключа нет / сеть упала / автоплей заблокирован — мягкий откат на системный
 * голос (Web Speech, lib/jarvis-voice). Так HUD всегда озвучивает, даже без ключа.
 * Событие `max:speaking` шлётся в обоих путях — arc-reactor/ядро светятся под речь.
 */

import { getApiPath } from '@/lib/max17-client';
import { jarvisSpeak, jarvisStop } from '@/lib/jarvis-voice';

export type Persona = 'jarvis' | 'friday';

const PKEY = 'max_persona';
const VK: Record<Persona, string> = { jarvis: 'max_voice_jarvis', friday: 'max_voice_friday' };

let currentAudio: HTMLAudioElement | null = null;
let currentController: AbortController | null = null; // отмена in-flight запроса

export function getPersona(): Persona {
  try {
    return (localStorage.getItem(PKEY) as Persona) || 'jarvis';
  } catch {
    return 'jarvis';
  }
}
export function setPersona(p: Persona): void {
  try {
    localStorage.setItem(PKEY, p);
  } catch {
    /* ignore */
  }
}
export function getVoiceId(p: Persona): string {
  try {
    return localStorage.getItem(VK[p]) || '';
  } catch {
    return '';
  }
}
export function setVoiceId(p: Persona, id: string): void {
  try {
    localStorage.setItem(VK[p], id);
  } catch {
    /* ignore */
  }
}

function signal(active: boolean): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('max:speaking', { detail: { active } }));
  }
}

export function stopNeural(): void {
  try {
    currentController?.abort(); // отменить незавершённый запрос к TTS (без параллели)
  } catch {
    /* ignore */
  }
  currentController = null;
  try {
    currentAudio?.pause();
  } catch {
    /* ignore */
  }
  currentAudio = null;
  jarvisStop();
}

/** Озвучить текст: сначала ElevenLabs, при любой осечке — системный голос. */
export async function speakNeural(text: string, hooks?: { onStart?: () => void; onEnd?: () => void }): Promise<void> {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return;
  const persona = getPersona();
  const voiceId = getVoiceId(persona);
  stopNeural();
  const controller = new AbortController();
  currentController = controller;
  try {
    const res = await fetch(getApiPath('tts'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: clean, persona, voiceId: voiceId || undefined }),
      signal: controller.signal,
    });
    const ct = res.headers.get('content-type') || '';
    if (!res.ok || !ct.includes('audio')) throw new Error(`tts_${res.status}`);
    const buf = await res.arrayBuffer();
    const url = URL.createObjectURL(new Blob([buf], { type: 'audio/mpeg' }));
    const audio = new Audio(url);
    currentAudio = audio;
    audio.onplay = () => {
      signal(true);
      hooks?.onStart?.();
    };
    const end = () => {
      signal(false);
      hooks?.onEnd?.();
      URL.revokeObjectURL(url);
      if (currentAudio === audio) currentAudio = null;
    };
    audio.onended = end;
    audio.onerror = end;
    await audio.play();
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') return; // заменён новой репликой — молчим
    jarvisSpeak(clean, hooks); // системный голос — деградированный, но рабочий
  } finally {
    if (currentController === controller) currentController = null;
  }
}

export interface NeuralVoice {
  voice_id: string;
  name: string;
  labels: Record<string, string>;
}

/** Список голосов аккаунта ElevenLabs для пикера. error:'no_key' если ключа нет. */
export async function listNeuralVoices(): Promise<{ ok: boolean; voices: NeuralVoice[]; error?: string }> {
  try {
    const res = await fetch(getApiPath('tts'), { method: 'GET' });
    if (res.status === 503) return { ok: false, voices: [], error: 'no_key' };
    if (!res.ok) return { ok: false, voices: [], error: `http_${res.status}` };
    const data = (await res.json()) as { voices?: NeuralVoice[] };
    return { ok: true, voices: data.voices ?? [] };
  } catch (e) {
    return { ok: false, voices: [], error: e instanceof Error ? e.message : 'fetch' };
  }
}
