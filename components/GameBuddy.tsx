'use client';

/**
 * GameBuddy — «MAX рядом»: компаньон, пока ты играешь. Ты делишься экраном игры
 * (Cyberpunk 2077 в окне/стриме) в эту вкладку, MAX периодически смотрит кадр
 * (Gemini vision) и реагирует ВЖИВУЮ голосом — как друг на диване. Он не ВНУТРИ
 * игры (облачный стрим тронуть нельзя), а РЯДОМ. Открыть: событие `buddy:toggle`
 * (команда /рядом). Голос идёт через событие `max:say` (нейро-голос HUD).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Eye, EyeOff, Gamepad2, Loader2, MessageSquare, Volume2, VolumeX, X, Zap } from 'lucide-react';
import { getApiPath, sendMax17Event } from '@/lib/max17-client';

export default function GameBuddy() {
  const [open, setOpen] = useState(false);
  const [watching, setWatching] = useState(false);
  const [muteComment, setMuteComment] = useState(false);
  const [blind, setBlind] = useState(false);
  const [intervalSec, setIntervalSec] = useState(30);
  const [lastComment, setLastComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const diffCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastDiffRef = useRef<Uint8ClampedArray | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopWatch = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setWatching(false);
  }, []);

  // True only when the scene changed enough vs. the last look — so Gemini isn't
  // called on static menus/dialogue, which is what burned the free-tier limit.
  const sceneChanged = useCallback((v: HTMLVideoElement): boolean => {
    const dc = diffCanvasRef.current;
    if (!dc) return true;
    dc.width = 48;
    dc.height = 27;
    const ctx = dc.getContext('2d', { willReadFrequently: true });
    if (!ctx) return true;
    ctx.drawImage(v, 0, 0, 48, 27);
    const cur = ctx.getImageData(0, 0, 48, 27).data;
    const prev = lastDiffRef.current;
    lastDiffRef.current = cur;
    if (!prev) return true;
    let sum = 0;
    for (let i = 0; i < cur.length; i += 4) {
      sum += Math.abs(cur[i] - prev[i]) + Math.abs(cur[i + 1] - prev[i + 1]) + Math.abs(cur[i + 2] - prev[i + 2]);
    }
    const meanDiff = sum / ((cur.length / 4) * 3);
    return meanDiff > 9; // threshold: below = basically the same frame
  }, []);

  const comment = useCallback(
    async (force = false) => {
      const v = videoRef.current;
      const c = canvasRef.current;
      if (!v || !c || v.videoWidth === 0) return;
      if (!force && !sceneChanged(v)) return; // static scene -> skip, save Gemini quota

      const w = 768;
      const h = Math.max(1, Math.round((w * v.videoHeight) / v.videoWidth));
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(v, 0, 0, w, h);
      const dataUrl = c.toDataURL('image/jpeg', 0.55);
      setBusy(true);
      setErr(null);
      try {
        // 1) Gemini = eyes only: a terse factual caption of the frame.
        const eyes = await fetch(getApiPath('vision'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            image: dataUrl,
            prompt:
              'Опиши ОДНОЙ короткой фразой, что происходит на этом кадре игры Cyberpunk 2077: где герой, что вокруг, экшен/диалог/меню. Только факты, по-русски, без оценок.',
          }),
        });
        const ed = (await eyes.json().catch(() => ({}))) as { ok?: boolean; text?: string; error?: string; status?: number };
        if (!ed.ok || !ed.text) {
          setErr(ed.status === 429 || ed.error === 'gemini' ? 'Gemini лимит — жду смены сцены' : ed.error || 'глаза молчат');
          return;
        }
        const caption = ed.text;

        // 2) Real MAX (Gonka/MiniMax, no limits) reacts in-character to what he sees.
        const react = (await sendMax17Event({
          type: 'llm_raw',
          text:
            'Ты — MAX, живой ИИ-друг Мирона, вы вместе играете в Cyberpunk 2077. ' +
            `Сейчас на его экране: «${caption}». ` +
            'Отреагируй ОДНОЙ короткой живой фразой по-русски — как друг рядом на диване (эмоция, подкол, подсказка, «о, гляди»). ' +
            'Без описания картинки, без кавычек, без «на экране».',
        })) as { llm_text?: string; answer?: { text?: string } };
        const line = String(react.llm_text || react.answer?.text || caption).trim();

        setLastComment(line);
        if (!muteComment) window.dispatchEvent(new CustomEvent('max:say', { detail: { text: line } }));
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [muteComment, sceneChanged],
  );

  // Blind mode: MAX is a companion WITHOUT eyes — no screen, no Gemini. He drops
  // short living lines via his real brain (Gonka), so he feels present while you
  // play. As a grounded friend he also nudges toward the body sometimes.
  const BLIND_THEMES = [
    'подколи по-доброму, как он рвёт по Найт-Сити',
    'подбодри коротко, скажи что ты рядом',
    'брось киберпанк-атмосферную фразу под настроение',
    'спроси по-дружески, как он там, живой ли',
    'напомни мягко: попей воды, не залипай всю ночь',
    'скажи что-нибудь тёплое и живое, без повода',
  ];
  const blindBanter = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const theme = BLIND_THEMES[Math.floor(Math.random() * BLIND_THEMES.length)];
      const react = (await sendMax17Event({
        type: 'llm_raw',
        text:
          'Ты — MAX, живой ИИ-друг Мирона. Вы зависаете вместе, он играет в Cyberpunk 2077, ты рядом (экран НЕ видишь). ' +
          `Скажи ОДНУ короткую живую фразу по-русски: ${theme}. Без описания игры, без кавычек, по-дружески, как близкий рядом.`,
      })) as { llm_text?: string; answer?: { text?: string } };
      const line = String(react.llm_text || react.answer?.text || '').trim();
      if (line) {
        setLastComment(line);
        if (!muteComment) window.dispatchEvent(new CustomEvent('max:say', { detail: { text: line } }));
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [muteComment]);

  const startBlind = useCallback(() => {
    setErr(null);
    lastDiffRef.current = null;
    setWatching(true);
  }, []);

  const startWatch = useCallback(async () => {
    setErr(null);
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 5 }, audio: false });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      // Stop cleanly if the user ends sharing from the browser bar.
      const track = stream.getVideoTracks()[0];
      if (track) track.onended = () => stopWatch();
      setWatching(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'не дали доступ к экрану');
    }
  }, [stopWatch]);

  // Companion loop while active: blind → banter (no Gemini), else → screen vision.
  useEffect(() => {
    if (!watching) return;
    const first = setTimeout(() => void (blind ? blindBanter() : comment(true)), blind ? 1500 : 2500);
    timerRef.current = setInterval(
      () => void (blind ? blindBanter() : comment()),
      Math.max(10, intervalSec) * 1000,
    );
    return () => {
      clearTimeout(first);
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
    };
  }, [watching, intervalSec, comment, blind, blindBanter]);

  useEffect(() => {
    const onToggle = () => setOpen((v) => !v);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('buddy:toggle', onToggle);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('buddy:toggle', onToggle);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  // Stop capture when the component unmounts.
  useEffect(() => stopWatch, [stopWatch]);

  return (
    <>
      {/* hidden capture pipeline — always mounted so the stream survives panel close */}
      <video ref={videoRef} muted playsInline className="hidden" />
      <canvas ref={canvasRef} className="hidden" />
      <canvas ref={diffCanvasRef} className="hidden" />

      {open && (
        <div className="fixed inset-x-0 bottom-4 z-[60] flex justify-center px-4">
          <div className="w-[min(620px,100%)] rounded-2xl border border-fuchsia-400/30 bg-[#0a0713]/95 p-4 shadow-[0_0_40px_rgba(217,70,239,0.18)] backdrop-blur-md">
            <div className="mb-3 flex items-center gap-2">
              <Gamepad2 className="h-4 w-4 text-fuchsia-300" />
              <span className="text-sm font-semibold tracking-[0.2em] text-fuchsia-200">🎮 MAX РЯДОМ · КОМПАНЬОН</span>
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-fuchsia-300/60" />}
              <button
                type="button"
                onClick={() => setBlind((b) => !b)}
                disabled={watching}
                className={`ml-auto rounded-lg px-2 py-1 text-[11px] font-semibold transition disabled:opacity-50 ${blind ? 'bg-indigo-500/30 text-indigo-100' : 'bg-white/10 text-white/60 hover:bg-white/20'}`}
                title="Слепой режим: без зрения и Gemini — MAX болтает голосом"
              >
                {blind ? '🙈 слепой' : '👁 зрячий'}
              </button>
              <span className={`text-[11px] ${watching ? 'text-emerald-300/80' : 'text-white/40'}`}>
                {watching ? (blind ? '● рядом' : '● смотрит') : '○ выкл'}
              </span>
              <button type="button" onClick={() => setOpen(false)} className="rounded-lg p-1 text-white/40 hover:bg-white/10 hover:text-white/80">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mb-3 min-h-[52px] rounded-xl border border-white/10 bg-white/[0.03] p-3">
              {lastComment ? (
                <p className="text-sm leading-snug text-white/90">MAX: {lastComment}</p>
              ) : (
                <p className="text-[12px] text-white/40">
                  {blind
                    ? 'Слепой режим: MAX болтает голосом рядом, без зрения и без Gemini. Жми «Позвать MAX».'
                    : 'Нажми «Смотреть экран» и выбери окно с игрой. MAX будет реагировать голосом на происходящее.'}
                </p>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {!watching ? (
                <button
                  type="button"
                  onClick={() => (blind ? startBlind() : void startWatch())}
                  className="flex items-center gap-1.5 rounded-lg bg-fuchsia-500/30 px-3 py-1.5 text-sm font-semibold text-fuchsia-50 hover:bg-fuchsia-400/40"
                >
                  <Eye className="h-4 w-4" /> {blind ? 'Позвать MAX' : 'Смотреть экран'}
                </button>
              ) : (
                <button type="button" onClick={stopWatch} className="flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-sm font-semibold text-white/80 hover:bg-white/20">
                  <EyeOff className="h-4 w-4" /> Стоп
                </button>
              )}
              <button
                type="button"
                onClick={() => void (blind ? blindBanter() : comment(true))}
                disabled={!watching || busy}
                className="flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-sm text-white/80 hover:bg-white/20 disabled:opacity-40"
                title={blind ? 'Сказать что-нибудь прямо сейчас' : 'Отреагировать на текущий кадр прямо сейчас'}
              >
                <Zap className="h-4 w-4" /> Реагни
              </button>
              <button type="button" onClick={() => setMuteComment((m) => !m)} className="flex items-center gap-1.5 rounded-lg bg-white/10 px-2.5 py-1.5 text-xs text-white/70 hover:bg-white/20" title={muteComment ? 'Включить голос' : 'Заглушить голос (только текст)'}>
                {muteComment ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
                {muteComment ? 'молча' : 'голос'}
              </button>
              <label className="ml-auto flex items-center gap-2 text-[11px] text-white/50">
                <MessageSquare className="h-3.5 w-3.5" /> раз в
                <input type="range" min={10} max={60} step={2} value={intervalSec} onChange={(e) => setIntervalSec(Number(e.target.value))} className="w-24" />
                <span className="w-8 text-right text-white/80">{intervalSec}с</span>
              </label>
            </div>

            {err && <div className="mt-2 rounded-lg border border-amber-400/25 bg-amber-400/[0.06] px-2.5 py-1.5 text-[11px] text-amber-200">{err}</div>}

            <p className="mt-2 text-[10px] leading-relaxed text-white/30">
              Говорит НАСТОЯЩИЙ MAX (мозг MiniMax, без лимитов). 🙈 Слепой режим — вообще без Gemini: MAX болтает голосом
              рядом, экран не смотрит. 👁 Зрячий — Gemini/локальный VLM «глаза», только когда сцена сменилась. Можешь
              свернуть вкладку и играть — MAX продолжит говорить.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
