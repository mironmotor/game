'use client';

/**
 * VoicePicker — выбор персоны и голоса MAX для GODMODE.
 * Персона: JARVIS (мужской) ⇄ Пятница (женский). Локальное ядро имеет
 * приоритет, ElevenLabs и системный голос остаются резервом.
 */

import { useEffect, useState } from 'react';
import { Loader2, Mic, Volume2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  getPersona,
  getVoiceId,
  listNeuralVoices,
  setPersona,
  setVoiceId,
  speakNeural,
  type NeuralVoice,
  type NeuralProvider,
  type Persona,
} from '@/lib/neural-voice';

const TEST_LINE: Record<Persona, string> = {
  jarvis: 'Системы в норме, сэр. Я на связи и готов к работе.',
  friday: 'Привет, босс. Пятница на связи. Поехали.',
};

export default function VoicePicker() {
  const [persona, setPersonaState] = useState<Persona>('jarvis');
  const [voiceId, setVoiceIdState] = useState('');
  const [voices, setVoices] = useState<NeuralVoice[]>([]);
  const [providers, setProviders] = useState<NeuralProvider[]>([]);
  const [status, setStatus] = useState<'loading' | 'ok' | 'system' | 'error'>('loading');
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    const p = getPersona();
    setPersonaState(p);
    setVoiceIdState(getVoiceId(p));
    void listNeuralVoices().then((r) => {
      setProviders(r.providers);
      setVoices(r.voices);
      if (r.ok) {
        setStatus('ok');
      } else {
        setStatus(r.activeProvider === 'system' || r.error === 'no_provider' ? 'system' : 'error');
      }
    });
  }, []);

  function choose(p: Persona) {
    setPersona(p);
    setPersonaState(p);
    setVoiceIdState(getVoiceId(p));
  }

  function onSelect(id: string) {
    setVoiceId(persona, id);
    setVoiceIdState(id);
  }

  async function test() {
    if (testing) return;
    setTesting(true);
    try {
      await speakNeural(TEST_LINE[persona]);
    } finally {
      setTimeout(() => setTesting(false), 600);
    }
  }

  const localVoices = voices.filter((voice) => voice.provider === 'max-local');
  const elevenLabsVoices = voices.filter((voice) => voice.provider !== 'max-local');
  const localProvider = providers.find((provider) => provider.id === 'max-local');
  const elevenLabsProvider = providers.find((provider) => provider.id === 'elevenlabs');

  return (
    <div className="rounded-xl border border-sky-400/25 bg-sky-400/[0.04] p-3">
      <div className="mb-2 flex items-center gap-1.5 text-[11px] uppercase tracking-widest text-sky-300/80">
        <Volume2 className="h-3.5 w-3.5" /> Голос · персона
      </div>

      <div className="grid grid-cols-2 gap-2">
        {(['jarvis', 'friday'] as Persona[]).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => choose(p)}
            className={cn(
              'rounded-lg border px-3 py-2 text-sm font-semibold transition',
              persona === p ? 'border-sky-400/60 bg-sky-400/15 text-sky-50' : 'border-white/10 bg-white/[0.03] text-white/60 hover:bg-white/10',
            )}
          >
            {p === 'jarvis' ? 'JARVIS · м' : 'Пятница · ж'}
          </button>
        ))}
      </div>

      {status === 'ok' && (
        <label className="mt-2 flex items-center gap-2 text-[11px] text-white/55">
          Голос
          <select
            value={voiceId}
            onChange={(e) => onSelect(e.target.value)}
            className="flex-1 rounded-md border border-white/10 bg-black/40 px-2 py-1 text-xs text-white outline-none"
          >
            <option value="">автоматически · MAX → облако</option>
            {localVoices.length > 0 && (
              <optgroup label="Локальное ядро MAX">
                {localVoices.map((v) => (
                  <option key={v.voice_id} value={v.voice_id}>
                    {v.name}
                    {v.labels?.gender ? ` · ${v.labels.gender}` : ''}
                  </option>
                ))}
              </optgroup>
            )}
            {elevenLabsVoices.length > 0 && (
              <optgroup label="ElevenLabs · резерв">
                {elevenLabsVoices.map((v) => (
                  <option key={v.voice_id} value={v.voice_id}>
                    {v.name}
                    {v.labels?.gender ? ` · ${v.labels.gender}` : ''}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </label>
      )}

      <div className="mt-2 flex flex-wrap gap-1.5 text-[9px] uppercase tracking-wider">
        <span
          className={cn(
            'rounded-full border px-2 py-0.5',
            localProvider?.available
              ? 'border-emerald-400/35 bg-emerald-400/10 text-emerald-200'
              : 'border-white/10 text-white/35',
          )}
        >
          MAX Voice · {localProvider?.available ? 'онлайн' : localProvider?.configured ? 'спит' : 'не настроен'}
        </span>
        <span
          className={cn(
            'rounded-full border px-2 py-0.5',
            elevenLabsProvider?.available
              ? 'border-sky-400/30 bg-sky-400/10 text-sky-200'
              : 'border-white/10 text-white/35',
          )}
        >
          ElevenLabs · {elevenLabsProvider?.available ? 'резерв готов' : 'недоступен'}
        </span>
      </div>

      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={test}
          disabled={testing}
          className="flex items-center gap-1.5 rounded-lg bg-sky-500/25 px-3 py-1.5 text-sm font-semibold text-sky-50 transition hover:bg-sky-400/35 disabled:opacity-40"
        >
          {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mic className="h-4 w-4" />}
          Тест голоса
        </button>
        {status === 'system' && (
          <span className="text-[10px] leading-tight text-amber-200/80">
            нейродвижки спят — сейчас работает системный голос.
          </span>
        )}
        {status === 'error' && <span className="text-[10px] text-rose-300/80">Голосовые ядра недоступны — играю системным.</span>}
        {status === 'loading' && <span className="text-[10px] text-white/40">загрузка голосов…</span>}
      </div>

      <p className="mt-1.5 text-[10px] leading-relaxed text-white/35">
        Персона меняет голос и приветствие. MAX сначала говорит локально, затем через облачный резерв.
      </p>
    </div>
  );
}
