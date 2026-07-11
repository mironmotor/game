'use client';

/**
 * DubbingStudio — NOESIS-дубляж на ядре Max17. MAX оркеструет пайплайн:
 *   текст/скрипт + язык → MAX переводит (изохронно, под тайминг) → озвучивает
 *   (ElevenLabs multilingual) → готовый дубль (play + WAV/MP3).
 *
 * Это шаблон NOESIS-конвейера: вход → этапы под управлением MAX → аутпут.
 * Перевод — llm_raw (Gonka), голос — /api/tts. Всё на Max17 core.
 */

import { useEffect, useRef, useState } from 'react';
import { Download, Languages, Loader2, Mic, Play, Square } from 'lucide-react';
import { getApiPath, sendMax17Event } from '@/lib/max17-client';
import { getPersona } from '@/lib/neural-voice';

const LANGS: Array<[string, string]> = [
  ['en', 'English'],
  ['ru', 'Русский'],
  ['es', 'Español'],
  ['pt', 'Português'],
  ['fr', 'Français'],
  ['de', 'Deutsch'],
  ['it', 'Italiano'],
  ['hi', 'हिन्दी'],
  ['ar', 'العربية'],
  ['zh', '中文'],
  ['ja', '日本語'],
  ['ko', '한국어'],
  ['tr', 'Türkçe'],
  ['uk', 'Українська'],
  ['vi', 'Tiếng Việt'],
  ['bn', 'বাংলা'],
  ['id', 'Bahasa'],
  ['pl', 'Polski'],
];

export default function DubbingStudio() {
  const [src, setSrc] = useState('ru');
  const [tgt, setTgt] = useState('en');
  const [text, setText] = useState('');
  const [translated, setTranslated] = useState('');
  const [stage, setStage] = useState<'' | 'translate' | 'voice' | 'done' | 'err'>('');
  const [note, setNote] = useState('');
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  const langName = (c: string) => LANGS.find((l) => l[0] === c)?.[1] ?? c;

  // ASR front-stage — файл (аудио/видео) → текст силами ядра (Gemini), без локального Whisper.
  async function transcribe(file: File) {
    if (transcribing || stage === 'translate' || stage === 'voice') return;
    if (file.size > 18 * 1024 * 1024) {
      setStage('err');
      setNote('файл > 18 МБ — возьми клип покороче');
      return;
    }
    setTranscribing(true);
    setStage('');
    setNote(`MAX слушает «${file.name}»…`);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(getApiPath('asr'), { method: 'POST', body: fd });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; text?: string; detail?: string; error?: string };
      if (!res.ok || !data.ok) {
        throw new Error(data.detail || data.error || `ASR ${res.status}`);
      }
      const out = (data.text || '').trim();
      if (!out) throw new Error('речь не распознана');
      setText(out);
      setNote(`Распознано (${out.length} симв.) — проверь и жми «MAX дублирует»`);
    } catch (e) {
      setStage('err');
      setNote(e instanceof Error ? e.message : 'ошибка распознавания');
    } finally {
      setTranscribing(false);
    }
  }

  async function dub() {
    const source = text.trim();
    if (!source || stage === 'translate' || stage === 'voice') return;
    setStage('translate');
    setNote('MAX переводит (изохронно)…');
    setTranslated('');
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
      setAudioUrl(null);
    }
    try {
      // Этап 1 — перевод под тайминг (изохронность) силами ядра.
      const prompt =
        `Ты — NOESIS, движок дубляжа на ядре MAX. Переведи реплику с ${langName(src)} на ${langName(tgt)} для ОЗВУЧКИ.\n` +
        `Сохрани смысл и эмоцию, но подгони ДЛИНУ под оригинал (изохронность — чтобы дубль попадал в тайминг). ` +
        `Естественная разговорная речь. Верни ТОЛЬКО переведённый текст, без кавычек и пояснений.\n\nОригинал:\n${source}`;
      const tr = (await sendMax17Event({ type: 'llm_raw', text: prompt })) as { llm_text?: string };
      const out = (tr.llm_text || '').trim();
      if (!out) throw new Error('перевод пуст (LLM недоступен)');
      setTranslated(out);

      // Этап 2 — озвучка переведённого текста (ElevenLabs multilingual).
      setStage('voice');
      setNote('MAX озвучивает…');
      const res = await fetch(getApiPath('tts'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: out, persona: getPersona() }),
      });
      const ct = res.headers.get('content-type') || '';
      if (!res.ok || !ct.includes('audio')) {
        const detail = await res.text().catch(() => '');
        throw new Error(`озвучка недоступна (${res.status}) ${detail.slice(0, 60)}`);
      }
      const buf = await res.arrayBuffer();
      const url = URL.createObjectURL(new Blob([buf], { type: 'audio/mpeg' }));
      setAudioUrl(url);
      setStage('done');
      setNote(`Готов дубль ${langName(src)} → ${langName(tgt)}`);
      // авто-проигрыш
      setTimeout(() => {
        const a = audioRef.current;
        if (a) {
          a.play().then(() => setPlaying(true)).catch(() => {});
        }
      }, 50);
    } catch (e) {
      setStage('err');
      setNote(e instanceof Error ? e.message : 'ошибка дубляжа');
    }
  }

  function stop() {
    audioRef.current?.pause();
    setPlaying(false);
  }
  function play() {
    audioRef.current?.play().then(() => setPlaying(true)).catch(() => {});
  }

  const busy = stage === 'translate' || stage === 'voice';

  return (
    <div className="rounded-xl border border-emerald-400/25 bg-emerald-400/[0.04] p-3">
      <div className="mb-2 flex items-center gap-1.5 text-[11px] uppercase tracking-widest text-emerald-300/80">
        <Languages className="h-3.5 w-3.5" /> NOESIS · дубляж на ядре Max17
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Реплика / скрипт для дубляжа…"
        rows={3}
        className="w-full resize-none rounded-md border border-white/10 bg-black/40 px-2.5 py-1.5 text-sm text-white placeholder:text-white/30 outline-none focus:border-emerald-400/40"
      />

      <div className="mt-2 flex items-center gap-2 text-[11px] text-white/55">
        <select value={src} onChange={(e) => setSrc(e.target.value)} className="flex-1 rounded-md border border-white/10 bg-black/40 px-2 py-1 text-xs text-white outline-none">
          {LANGS.map(([c, n]) => (
            <option key={c} value={c}>{n}</option>
          ))}
        </select>
        <span className="text-emerald-300/70">→</span>
        <select value={tgt} onChange={(e) => setTgt(e.target.value)} className="flex-1 rounded-md border border-white/10 bg-black/40 px-2 py-1 text-xs text-white outline-none">
          {LANGS.map(([c, n]) => (
            <option key={c} value={c}>{n}</option>
          ))}
        </select>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept="audio/*,video/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void transcribe(f);
            e.target.value = '';
          }}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={transcribing || busy}
          className="flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-sm text-white/80 transition hover:bg-white/20 disabled:opacity-40"
          title="Аудио/видео файл → текст (распознавание ядром)"
        >
          {transcribing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mic className="h-4 w-4" />}
          Файл → текст
        </button>
        <button
          type="button"
          onClick={dub}
          disabled={busy || transcribing}
          className="flex items-center gap-1.5 rounded-lg bg-emerald-500/30 px-3 py-1.5 text-sm font-semibold text-emerald-50 transition hover:bg-emerald-400/40 disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Languages className="h-4 w-4" />}
          MAX дублирует
        </button>
        {audioUrl && !playing && (
          <button type="button" onClick={play} className="flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-sm text-white/80 transition hover:bg-white/20">
            <Play className="h-4 w-4" /> Играть
          </button>
        )}
        {audioUrl && playing && (
          <button type="button" onClick={stop} className="flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-sm text-white/80 transition hover:bg-white/20">
            <Square className="h-4 w-4" /> Стоп
          </button>
        )}
        {audioUrl && (
          <a href={audioUrl} download={`noesis-dub-${tgt}.mp3`} className="ml-auto flex items-center gap-1 rounded-lg bg-emerald-500/20 px-2.5 py-1.5 text-xs text-emerald-100 hover:bg-emerald-500/35">
            <Download className="h-3.5 w-3.5" /> скачать
          </a>
        )}
      </div>

      {translated && (
        <div className="mt-2 rounded-md border border-white/10 bg-black/30 p-2 text-sm text-white/85">
          <div className="mb-0.5 text-[10px] uppercase tracking-widest text-emerald-300/60">{langName(tgt)}</div>
          {translated}
        </div>
      )}
      {note && <div className={`mt-1.5 text-[11px] ${stage === 'err' ? 'text-rose-300/80' : 'text-emerald-200/80'}`}>{note}</div>}

      <audio ref={audioRef} src={audioUrl ?? undefined} onEnded={() => setPlaying(false)} className="hidden" />
    </div>
  );
}
