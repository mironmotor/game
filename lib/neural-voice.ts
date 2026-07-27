/**
 * Neural voice — кинематографичный голос MAX через серверный /api/tts.
 * Провайдеры: локальный MAX Voice, затем ElevenLabs, затем системный Web Speech.
 * Две персоны: JARVIS (мужской) и Пятница (женский).
 *
 * Если ключа нет / сеть упала / автоплей заблокирован — мягкий откат на системный
 * голос (Web Speech, lib/jarvis-voice). Так HUD всегда озвучивает, даже без ключа.
 * Событие `max:speaking` шлётся в обоих путях — arc-reactor/ядро светятся под речь.
 */

import { getApiPath } from '@/lib/max17-client';
import { jarvisSpeak, jarvisStop } from '@/lib/jarvis-voice';
import { getConversationLocale } from '@/lib/i18n/runtime';

export type Persona = 'jarvis' | 'friday';

const PKEY = 'max_persona';
const VK: Record<Persona, string> = { jarvis: 'max_voice_jarvis', friday: 'max_voice_friday' };

type VoiceHooks = { onStart?: () => void; onEnd?: () => void };

interface VoiceSession {
  controller: AbortController;
  hooks?: VoiceHooks;
  audio: HTMLAudioElement | null;
  objectUrl: string | null;
  reader: ReadableStreamDefaultReader<Uint8Array> | null;
  sources: Set<AudioBufferSourceNode>;
  gain: GainNode | null;
  started: boolean;
  finished: boolean;
}

let activeSession: VoiceSession | null = null;
let sharedAudioContext: AudioContext | null = null;

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
    const stored = localStorage.getItem(VK[p]) || '';
    if (stored && !stored.includes(':')) {
      const migrated = `elevenlabs:${stored}`;
      localStorage.setItem(VK[p], migrated);
      return migrated;
    }
    return stored;
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

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (sharedAudioContext && sharedAudioContext.state !== 'closed') return sharedAudioContext;
  const Context =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Context) return null;
  try {
    sharedAudioContext = new Context();
    return sharedAudioContext;
  } catch {
    return null;
  }
}

function canStreamPcm(): boolean {
  return typeof window !== 'undefined' && 'ReadableStream' in window && Boolean(getAudioContext());
}

/** Unlock Web Audio on the first real gesture, before a later network response arrives. */
export function primeNeuralAudio(): void {
  const context = getAudioContext();
  if (context?.state === 'suspended') {
    void context.resume().catch(() => {});
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', primeNeuralAudio, { passive: true });
  window.addEventListener('touchend', primeNeuralAudio, { passive: true });
  window.addEventListener('keydown', primeNeuralAudio);
}

function startSession(session: VoiceSession): void {
  if (session.started || session.finished || activeSession !== session) return;
  session.started = true;
  signal(true);
  session.hooks?.onStart?.();
}

function completeSession(session: VoiceSession, notifyEnd = true): void {
  if (session.finished) return;
  session.finished = true;
  const wasActive = activeSession === session;
  if (wasActive) activeSession = null;
  if (session.audio) {
    session.audio.onplay = null;
    session.audio.onended = null;
    session.audio.onerror = null;
  }
  if (session.objectUrl) URL.revokeObjectURL(session.objectUrl);
  session.objectUrl = null;
  session.gain?.disconnect();
  session.gain = null;
  if (wasActive && session.started) signal(false);
  if (notifyEnd) session.hooks?.onEnd?.();
}

function cancelSession(session: VoiceSession, notifyEnd = true): void {
  if (session.finished) return;
  try {
    session.controller.abort();
  } catch {
    /* ignore */
  }
  void session.reader?.cancel().catch(() => {});
  session.reader = null;
  if (session.audio) {
    session.audio.onplay = null;
    session.audio.onended = null;
    session.audio.onerror = null;
    session.audio.pause();
  }
  for (const source of session.sources) {
    source.onended = null;
    try {
      source.stop();
    } catch {
      /* already stopped */
    }
    source.disconnect();
  }
  session.sources.clear();
  completeSession(session, notifyEnd);
}

export function stopNeural(): void {
  if (activeSession) cancelSession(activeSession);
  jarvisStop();
}

async function playPcmStream(
  response: Response,
  session: VoiceSession,
  context: AudioContext,
  sampleRate: number,
): Promise<void> {
  if (!response.body) throw new Error('tts_stream_missing');
  const reader = response.body.getReader();
  session.reader = reader;
  const gain = context.createGain();
  gain.connect(context.destination);
  session.gain = gain;
  if (context.state === 'suspended') void context.resume().catch(() => {});

  let pending = new Uint8Array(0);
  let nextStart = context.currentTime + 0.06;
  let eof = false;
  let firstSettled = false;
  let resolveFirst!: () => void;
  let rejectFirst!: (error: unknown) => void;
  const firstAudio = new Promise<void>((resolve, reject) => {
    resolveFirst = resolve;
    rejectFirst = reject;
  });
  const minimumChunkBytes = Math.max(2, Math.floor(sampleRate * 2 * 0.06));

  const append = (chunk: Uint8Array) => {
    if (!pending.byteLength) {
      pending = chunk.slice();
      return;
    }
    const combined = new Uint8Array(pending.byteLength + chunk.byteLength);
    combined.set(pending);
    combined.set(chunk, pending.byteLength);
    pending = combined;
  };

  const schedulePending = (flush = false): boolean => {
    const usableBytes = pending.byteLength - (pending.byteLength % 2);
    if (usableBytes < (flush ? 2 : minimumChunkBytes)) return false;
    const bytes = pending.slice(0, usableBytes);
    pending = pending.slice(usableBytes);
    const frameCount = bytes.byteLength / 2;
    const samples = new Float32Array(frameCount);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let index = 0; index < frameCount; index += 1) {
      samples[index] = view.getInt16(index * 2, true) / 32768;
    }

    const buffer = context.createBuffer(1, frameCount, sampleRate);
    buffer.copyToChannel(samples, 0);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(gain);
    const startsAt = Math.max(nextStart, context.currentTime + 0.045);
    nextStart = startsAt + buffer.duration;
    session.sources.add(source);
    source.onended = () => {
      session.sources.delete(source);
      source.disconnect();
      if (eof && session.sources.size === 0) completeSession(session);
    };
    source.start(startsAt);
    startSession(session);
    if (!firstSettled) {
      firstSettled = true;
      resolveFirst();
    }
    return true;
  };

  const pump = async () => {
    try {
      while (!session.finished) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value?.byteLength) {
          append(value);
          schedulePending();
        }
      }
      if (session.finished && !firstSettled) {
        firstSettled = true;
        rejectFirst(new DOMException('Voice request cancelled', 'AbortError'));
      }
      if (!session.finished) schedulePending(true);
      eof = true;
      if (!session.started && !session.finished) throw new Error('tts_stream_empty');
      if (!session.finished && session.sources.size === 0) completeSession(session);
    } catch (error) {
      eof = true;
      if (!firstSettled) {
        firstSettled = true;
        rejectFirst(error);
      } else if (!session.finished && session.sources.size === 0) {
        completeSession(session);
      }
    } finally {
      if (session.reader === reader) session.reader = null;
      try {
        reader.releaseLock();
      } catch {
        /* cancelled reader */
      }
    }
  };

  void pump();
  await firstAudio;
}

/** Озвучить текст: MAX Voice → ElevenLabs → системный голос. */
export async function speakNeural(text: string, hooks?: VoiceHooks): Promise<void> {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return;
  const persona = getPersona();
  const voiceId = getVoiceId(persona);
  stopNeural();
  const controller = new AbortController();
  const context = canStreamPcm() ? getAudioContext() : null;
  if (context?.state === 'suspended') void context.resume().catch(() => {});
  const session: VoiceSession = {
    controller,
    hooks,
    audio: null,
    objectUrl: null,
    reader: null,
    sources: new Set(),
    gain: null,
    started: false,
    finished: false,
  };
  activeSession = session;
  try {
    const res = await fetch(getApiPath('tts'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: clean,
        persona,
        voiceId: voiceId || undefined,
        language: getConversationLocale(),
        stream: Boolean(context),
      }),
      signal: controller.signal,
    });
    const ct = res.headers.get('content-type') || '';
    if (!res.ok || !ct.includes('audio')) throw new Error(`tts_${res.status}`);
    const streamFormat = res.headers.get('x-tts-stream');
    if (streamFormat === 'pcm_s16le' && context && res.body) {
      const sampleRate = Number(res.headers.get('x-tts-sample-rate'));
      if (!Number.isInteger(sampleRate) || sampleRate < 8_000 || sampleRate > 96_000) {
        throw new Error('tts_stream_rate');
      }
      await playPcmStream(res, session, context, sampleRate);
      return;
    }

    const blob = await res.blob();
    if (session.finished || activeSession !== session) return;
    const url = URL.createObjectURL(blob.type ? blob : new Blob([blob], { type: ct }));
    const audio = new Audio(url);
    session.audio = audio;
    session.objectUrl = url;
    audio.onplay = () => startSession(session);
    audio.onended = () => completeSession(session);
    audio.onerror = () => completeSession(session);
    try {
      await audio.play();
    } catch (error) {
      throw error;
    }
  } catch (err) {
    if (controller.signal.aborted || session.finished || activeSession !== session) return;
    const started = session.started;
    cancelSession(session, started);
    if (started) return;
    jarvisSpeak(clean, hooks); // системный голос — деградированный, но рабочий
  }
}

export interface NeuralVoice {
  voice_id: string;
  name: string;
  labels: Record<string, string>;
  provider?: 'max-local' | 'elevenlabs';
}

export interface NeuralProvider {
  id: 'max-local' | 'elevenlabs';
  configured: boolean;
  available: boolean;
  model?: string;
  device?: string;
  error?: string;
}

/** Голоса и состояние локального/облачного провайдеров для пикера. */
export async function listNeuralVoices(): Promise<{
  ok: boolean;
  voices: NeuralVoice[];
  providers: NeuralProvider[];
  activeProvider?: 'max-local' | 'elevenlabs' | 'system';
  error?: string;
}> {
  try {
    const res = await fetch(getApiPath('tts'), { method: 'GET' });
    const data = (await res.json().catch(() => ({}))) as {
      voices?: NeuralVoice[];
      providers?: NeuralProvider[];
      active_provider?: 'max-local' | 'elevenlabs' | 'system';
      error?: string;
    };
    if (!res.ok) {
      return {
        ok: false,
        voices: data.voices ?? [],
        providers: data.providers ?? [],
        activeProvider: data.active_provider,
        error: data.error || `http_${res.status}`,
      };
    }
    return {
      ok: true,
      voices: data.voices ?? [],
      providers: data.providers ?? [],
      activeProvider: data.active_provider,
    };
  } catch (e) {
    return { ok: false, voices: [], providers: [], error: e instanceof Error ? e.message : 'fetch' };
  }
}
