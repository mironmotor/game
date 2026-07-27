/**
 * JARVIS-style system voice fallback for MAX, via SpeechSynthesis.
 *
 * Not a clone of the film's actor (real person's voice — rights/ethics, and not
 * reproducible offline). It speaks in a calm, low, measured register and lets the
 * user pick whichever installed voice sounds most JARVIS-like on their machine
 * (the auto-pick prefers a Russian male voice like macOS "Yuri" / Windows "Pavel").
 */

import { baseLanguage } from '@/lib/i18n/config';
import { getActiveLocale } from '@/lib/i18n/runtime';

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

function autoPick(locale = getActiveLocale()): SpeechSynthesisVoice | null {
  const base = baseLanguage(locale);
  const matching = allVoices().filter((voice) => baseLanguage(voice.lang) === base);
  if (!matching.length) return allVoices()[0] ?? null;
  if (base === 'ru') {
    for (const name of PREFERRED_MALE) {
      const hit = matching.find((voice) => voice.name.toLowerCase().includes(name));
      if (hit) return hit;
    }
  }
  return matching.find((voice) => /google|premium|enhanced/i.test(voice.name)) ?? matching[0];
}

function resolve(locale = getActiveLocale()): SpeechSynthesisVoice | null {
  const base = baseLanguage(locale);
  const name = savedName();
  if (name) {
    const voice = allVoices().find((candidate) => candidate.name === name);
    if (voice && baseLanguage(voice.lang) === base) return voice;
  }
  if (cached && baseLanguage(cached.lang) === base) {
    return cached;
  }
  return autoPick(locale);
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

/** Active-language voices first, then the rest — for the picker. */
export function listVoices(): { name: string; lang: string }[] {
  const voices = allVoices();
  const base = baseLanguage(getActiveLocale());
  const matching = voices.filter((voice) => baseLanguage(voice.lang) === base);
  const rest = voices.filter((voice) => baseLanguage(voice.lang) !== base);
  return [...matching, ...rest].map((voice) => ({ name: voice.name, lang: voice.lang }));
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
  cached = allVoices().find((voice) => voice.name === name) ?? null;
}

export function jarvisSpeak(text: string, hooks?: { onStart?: () => void; onEnd?: () => void }): void {
  if (!available()) return;
  const clean = text.trim();
  if (!clean) return;
  const locale = getActiveLocale();
  const synth = window.speechSynthesis;
  synth.cancel();
  const utterance = new SpeechSynthesisUtterance(clean);
  utterance.lang = locale;
  const voice = resolve(locale);
  if (voice) {
    cached = voice;
    utterance.voice = voice;
  }
  utterance.pitch = 0.74;
  utterance.rate = 0.95;
  utterance.volume = 1;
  const signal = (active: boolean) => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('max:speaking', { detail: { active } }));
    }
  };
  utterance.onstart = () => {
    signal(true);
    hooks?.onStart?.();
  };
  utterance.onend = () => {
    signal(false);
    hooks?.onEnd?.();
  };
  utterance.onerror = () => {
    signal(false);
    hooks?.onEnd?.();
  };
  synth.speak(utterance);
}

/** Speak a short neutral sample (optionally switching voice first). */
export function jarvisPreview(name?: string): void {
  if (name) setVoiceByName(name);
  const locale = baseLanguage(getActiveLocale());
  jarvisSpeak(locale === 'ru' ? 'Системы в норме. Я Макс, к вашим услугам.' : 'Systems online. MAX is ready.');
}

export function jarvisStop(): void {
  if (available()) window.speechSynthesis.cancel();
}
