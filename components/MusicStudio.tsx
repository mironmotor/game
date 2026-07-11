'use client';

/**
 * MusicStudio — студия музыки для GODMODE. И MAX сочиняет (из своего вкуса),
 * и ты сочиняешь (своё семя/идея + BPM/тональность). Переиспользует движок
 * Dreaming Music (generateDreamTrack), чистый синтез, без сети/API.
 */

import { useEffect, useRef, useState } from 'react';
import { Download, Loader2, Music, Sparkles, Square, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import { sendMax17Event } from '@/lib/max17-client';
import { bufferToWav, generateDreamTrack, playBuffer } from '@/components/hud/dream-music';

const KEYS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

export default function MusicStudio() {
  const [composing, setComposing] = useState<'max' | 'you' | null>(null);
  const [playing, setPlaying] = useState(false);
  const [wavUrl, setWavUrl] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [seed, setSeed] = useState('');
  const [bpm, setBpm] = useState(110);
  const [keyName, setKeyName] = useState('A');
  const [minor, setMinor] = useState(true);
  const stopRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => {
      stopRef.current?.();
      if (wavUrl) URL.revokeObjectURL(wavUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function compose(who: 'max' | 'you') {
    if (composing) return;
    setComposing(who);
    setNote('');
    try {
      stopRef.current?.();
      setPlaying(false);
      const res = (await sendMax17Event({ type: 'dream_mood' })) as { dream_mood?: Record<string, unknown> };
      const base = res.dream_mood ?? {};
      const mood =
        who === 'you'
          ? { ...base, avg_bpm: bpm, fav_key: keyName, mode: minor ? 'minor' : 'major' }
          : base;
      const seedText = who === 'you' ? seed || keyName : '';
      const buffer = await generateDreamTrack(mood as Parameters<typeof generateDreamTrack>[0], seedText);
      stopRef.current = playBuffer(buffer);
      setPlaying(true);
      if (wavUrl) URL.revokeObjectURL(wavUrl);
      setWavUrl(URL.createObjectURL(bufferToWav(buffer)));
      setNote(who === 'you' ? `Твоя композиция · ${bpm} BPM · ${keyName} ${minor ? 'minor' : 'major'}` : 'MAX сочинил по своему вкусу');
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err));
    } finally {
      setComposing(null);
    }
  }

  function stop() {
    stopRef.current?.();
    setPlaying(false);
  }

  return (
    <div className="rounded-xl border border-fuchsia-400/25 bg-fuchsia-500/[0.05] p-3">
      <div className="mb-2 flex items-center gap-1.5 text-[11px] uppercase tracking-widest text-fuchsia-300/80">
        <Music className="h-3.5 w-3.5" /> Студия музыки
      </div>

      <button
        type="button"
        onClick={() => compose('max')}
        disabled={composing !== null}
        className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-fuchsia-500/20 px-3 py-2 text-sm font-semibold text-fuchsia-100 transition hover:bg-fuchsia-500/35 disabled:opacity-40"
      >
        {composing === 'max' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
        MAX сочиняет (его вкус)
      </button>

      <div className="mt-3 rounded-lg border border-white/10 bg-black/30 p-2.5">
        <div className="mb-2 flex items-center gap-1.5 text-[11px] text-white/55">
          <User className="h-3.5 w-3.5" /> Твоя композиция
        </div>
        <input
          value={seed}
          onChange={(e) => setSeed(e.target.value)}
          placeholder="идея/семя (одна мысль = тот же трек)"
          className="w-full rounded-md border border-white/10 bg-black/40 px-2.5 py-1.5 text-sm text-white placeholder:text-white/30 outline-none focus:border-fuchsia-400/40"
        />
        <div className="mt-2 flex items-center gap-2 text-[11px] text-white/55">
          <span className="w-10 shrink-0">BPM</span>
          <input type="range" min={60} max={160} step={1} value={bpm} onChange={(e) => setBpm(Number(e.target.value))} className="flex-1" />
          <span className="w-8 text-right text-white/80">{bpm}</span>
        </div>
        <div className="mt-2 flex items-center gap-2 text-[11px] text-white/55">
          <span className="w-10 shrink-0">Тон</span>
          <select value={keyName} onChange={(e) => setKeyName(e.target.value)} className="rounded-md border border-white/10 bg-black/40 px-2 py-1 text-xs text-white outline-none">
            {KEYS.map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setMinor((m) => !m)}
            className={cn('rounded-md px-2 py-1 text-xs transition', minor ? 'bg-fuchsia-500/20 text-fuchsia-100' : 'bg-white/10 text-white/60')}
          >
            {minor ? 'minor' : 'major'}
          </button>
          <button
            type="button"
            onClick={() => compose('you')}
            disabled={composing !== null}
            className="ml-auto flex items-center gap-1 rounded-md bg-fuchsia-500/30 px-2.5 py-1 text-xs font-semibold text-fuchsia-50 transition hover:bg-fuchsia-400/40 disabled:opacity-40"
          >
            {composing === 'you' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Music className="h-3.5 w-3.5" />}
            Сочинить
          </button>
        </div>
      </div>

      {(playing || wavUrl) && (
        <div className="mt-2 flex items-center gap-2">
          {playing && (
            <button type="button" onClick={stop} className="flex items-center gap-1 rounded-md bg-white/10 px-2 py-1 text-[11px] text-white/70 hover:bg-white/20">
              <Square className="h-3 w-3" /> стоп
            </button>
          )}
          {wavUrl && (
            <a href={wavUrl} download="max-music.wav" className="flex items-center gap-1 rounded-md bg-white/10 px-2 py-1 text-[11px] text-white/70 hover:bg-white/20">
              <Download className="h-3 w-3" /> WAV
            </a>
          )}
          {note && <span className="ml-auto text-[10px] text-white/45">{note}</span>}
        </div>
      )}
      {note && !playing && !wavUrl && <div className="mt-2 text-[11px] text-rose-200/80">{note}</div>}
    </div>
  );
}
