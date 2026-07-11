'use client';

/**
 * SageMode — голосовой спутник «Мудрец из особняка» (Уровень 1 для GTA IV).
 * Петля: микрофон → WAV → ASR (Gemini) → MAX в персоне sage (с памятью) →
 * живой голос (ElevenLabs). Мудрец помнит гостя между разговорами.
 *
 * Открыть: событие `sage:toggle` (или команда /мудрец), Esc — выйти. Пока закрыт —
 * рендерит null. Говорить: кнопка «Говорить» (нажал → говоришь → нажал → ответ).
 */

import { useEffect, useRef, useState } from 'react';
import { Mic, Square, X, Sparkles, Loader2 } from 'lucide-react';
import { getApiPath, sendMax17Event } from '@/lib/max17-client';
import { speakNeural } from '@/lib/neural-voice';
import { WavRecorder } from '@/lib/wav-recorder';

type Phase = 'idle' | 'recording' | 'transcribing' | 'thinking' | 'speaking';

export default function SageMode() {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [heard, setHeard] = useState('');
  const [reply, setReply] = useState('');
  const [note, setNote] = useState('');
  const recorderRef = useRef<WavRecorder | null>(null);

  useEffect(() => {
    const onToggle = () => setOpen((v) => !v);
    const onOpen = () => setOpen(true);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('sage:toggle', onToggle);
    window.addEventListener('sage:open', onOpen);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('sage:toggle', onToggle);
      window.removeEventListener('sage:open', onOpen);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  async function talk() {
    if (phase === 'transcribing' || phase === 'thinking' || phase === 'speaking') return;
    if (phase === 'idle') {
      try {
        recorderRef.current = new WavRecorder();
        await recorderRef.current.start();
        setHeard('');
        setReply('');
        setNote('Слушаю… говори, потом нажми ещё раз');
        setPhase('recording');
      } catch {
        setNote('Нет доступа к микрофону');
      }
      return;
    }
    // phase === 'recording' → остановить и обработать
    try {
      setPhase('transcribing');
      setNote('Мудрец вслушивается…');
      const blob = await recorderRef.current!.stop();
      const fd = new FormData();
      fd.append('file', new File([blob], 'sage.wav', { type: 'audio/wav' }));
      const res = await fetch(getApiPath('asr'), { method: 'POST', body: fd });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; text?: string };
      const said = (data.text || '').trim();
      if (!said) {
        setNote('Не расслышал — попробуй ещё');
        setPhase('idle');
        return;
      }
      setHeard(said);
      setPhase('thinking');
      setNote('Мудрец размышляет…');
      const r = (await sendMax17Event({
        type: 'user_message',
        message: said,
        persona: 'sage',
      })) as { answer?: { text?: string } };
      const answer = (r.answer?.text || '').trim();
      if (!answer) {
        setNote('Мудрец промолчал…');
        setPhase('idle');
        return;
      }
      setReply(answer);
      setPhase('speaking');
      setNote('');
      await speakNeural(answer, { onEnd: () => {} });
      setPhase('idle');
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'сбой беседы');
      setPhase('idle');
    }
  }

  if (!open) return null;

  const busy = phase === 'transcribing' || phase === 'thinking';
  const label =
    phase === 'recording' ? 'Готово' :
    phase === 'speaking' ? 'Говорит…' :
    busy ? '…' : 'Говорить';

  return (
    <div
      className="fixed inset-0 z-[58] flex items-center justify-center p-4"
      style={{ background: 'radial-gradient(circle at 50% 40%, rgba(40,28,10,0.55), rgba(8,5,2,0.92))' }}
    >
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-amber-100/70 transition hover:bg-white/20 hover:text-white"
        aria-label="Покинуть особняк"
      >
        <X className="h-5 w-5" />
      </button>

      <div className="w-[min(560px,100%)] text-center">
        <div className="mb-1 flex items-center justify-center gap-2 text-[11px] uppercase tracking-[0.4em] text-amber-300/70">
          <Sparkles className="h-3.5 w-3.5" /> Мудрец из особняка
        </div>
        <p className="mb-6 text-xs text-amber-100/40">Либерти-Сити · он помнит каждого, кто заходил</p>

        {reply && (
          <div className="mb-5 rounded-2xl border border-amber-400/25 bg-amber-400/[0.05] px-5 py-4 text-[15px] leading-relaxed text-amber-50/90">
            {reply}
          </div>
        )}
        {heard && (
          <p className="mb-5 text-sm text-amber-100/40">— ты: «{heard}»</p>
        )}

        <button
          type="button"
          onClick={talk}
          disabled={busy}
          className={`mx-auto flex h-24 w-24 items-center justify-center rounded-full border transition disabled:opacity-50 ${
            phase === 'recording'
              ? 'border-rose-400/60 bg-rose-500/20 text-rose-100 animate-pulse'
              : 'border-amber-400/40 bg-amber-500/15 text-amber-100 hover:bg-amber-500/25'
          }`}
        >
          {busy ? <Loader2 className="h-8 w-8 animate-spin" /> : phase === 'recording' ? <Square className="h-8 w-8" /> : <Mic className="h-9 w-9" />}
        </button>
        <p className="mt-3 text-sm text-amber-100/70">{label}</p>
        {note && <p className="mt-1 text-xs text-amber-100/40">{note}</p>}
      </div>
    </div>
  );
}
