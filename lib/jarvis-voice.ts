/**
 * JARVIS-style Russian voice for MAX, via the browser SpeechSynthesis API.
 *
 * Not a clone of the film's actor (real person's voice — rights/ethics, and not
 * reproducible offline). It speaks in a calm, low, measured register and lets the
 * user pick whichever installed voice sounds most JARVIS-like on their machine
 * (the auto-pick prefers a Russian male voice like macOS "Yuri" / Windows "Pavel").
 */

const NAME_KEY = 'max_voice_name';
const PREFERRED_MALE = ['yuri', 'pavel', 'dmitri', 'aleksandr', 'artem'];

let cached: SpeechSynthesisVoice | null = null;

function available(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

function allVoices(): SpeechSynthesisVoice[] {
  return available() ? window.speechSynthesis.getVoices() : [];
}

function savedName(): string | null {
  try {
    return typeof window !== 'undefined' ? localStorage.getItem(NAME_KEY) : null;
  } catch {
    return null;
  }
}

function autoPick(): SpeechSynthesisVoice | null {
  const ru = allVoices().filter((v) => /^ru(-|_|$)/i.test(v.lang));
  if (!ru.length) return null;
  for (const name of PREFERRED_MALE) {
    const hit = ru.find((v) => v.name.toLowerCase().includes(name));
    if (hit) return hit;
  }
  return ru.find((v) => /google/i.test(v.name)) ?? ru[0];
}

function resolve(): SpeechSynthesisVoice | null {
  const name = savedName();
  if (name) {
    const v = allVoices().find((x) => x.name === name);
    if (v) return v;
  }
  return cached ?? autoPick();
}

/** Call once on the client so voices are warmed (they load async). */
export function initJarvis(): void {
  if (!available()) return;
  cached = resolve();
  window.speechSynthesis.onvoiceschanged = () => {
    cached = resolve();
  };
}

export function jarvisAvailable(): boolean {
  return available();
}

/** Russian voices first, then the rest — for the picker. */
export function listVoices(): { name: string; lang: string }[] {
  const v = allVoices();
  const ru = v.filter((x) => /^ru/i.test(x.lang));
  const rest = v.filter((x) => !/^ru/i.test(x.lang));
  return [...ru, ...rest].map((x) => ({ name: x.name, lang: x.lang }));
}

export function getVoiceName(): string {
  return savedName() ?? '';
}

export function setVoiceByName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    /* ignore */
  }
  cached = allVoices().find((v) => v.name === name) ?? null;
}

export function jarvisSpeak(text: string, hooks?: { onStart?: () => void; onEnd?: () => void }): void {
  if (!available()) return;
  const clean = text.trim();
  if (!clean) return;
  const synth = window.speechSynthesis;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(clean);
  u.lang = 'ru-RU';
  const voice = resolve();
  if (voice) {
    cached = voice;
    u.voice = voice;
  }
  u.pitch = 0.74; // deep, composed — JARVIS register
  u.rate = 0.95; // measured, unhurried
  u.volume = 1;
  // Notify the Iron-Man HUD so the arc-reactor glows gold while JARVIS speaks.
  const signal = (active: boolean) => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('max:speaking', { detail: { active } }));
    }
  };
  u.onstart = () => {
    signal(true);
    hooks?.onStart?.();
  };
  u.onend = () => {
    signal(false);
    hooks?.onEnd?.();
  };
  u.onerror = () => {
    signal(false);
    hooks?.onEnd?.();
  };
  synth.speak(u);
}

/** Speak a short JARVIS-flavored sample (optionally switching voice first). */
export function jarvisPreview(name?: string): void {
  if (name) setVoiceByName(name);
  jarvisSpeak('Системы в норме, сэр. Я Макс, к вашим услугам.');
}

export function jarvisStop(): void {
  if (available()) window.speechSynthesis.cancel();
}
