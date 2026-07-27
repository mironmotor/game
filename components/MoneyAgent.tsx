'use client';

/**
 * MoneyAgent — «MAX · Заработок». Честный агент-стратег: по реальным навыкам и
 * ресурсам Мирона находит РЕАЛЬНЫЕ способы заработать в реальном мире, разбивает
 * на конкретные первые шаги и ставит их в доску миссий. MAX — стратег и трекер;
 * работу делает Мирон. Никаких «агенты сами печатают деньги», схем, крипто-обещаний
 * и автоматического пассивного дохода — только то, что реально приносит первые деньги.
 * Открыть: событие `money:toggle` (команда /деньги).
 */

import { useCallback, useEffect, useState } from 'react';
import { Banknote, Clock, Flame, Loader2, Plus, Sparkles, Target, X } from 'lucide-react';
import { sendMax17Event } from '@/lib/max17-client';

type Opp = {
  title?: string;
  why?: string;
  days?: string; // срок до первых денег
  money?: string; // реалистичная первая сумма
  effort?: number; // 1..3
  steps?: string[];
};

const DEFAULT_SKILLS =
  'Умею: строить веб-приложения (Next.js, React, Python), собрал GAME/MAX (ИИ-платформа), настраиваю серверы/деплой, работаю с ИИ. Есть Mac. Время: несколько часов в день.';

export default function MoneyAgent() {
  const [open, setOpen] = useState(false);
  const [skills, setSkills] = useState(DEFAULT_SKILLS);
  const [busy, setBusy] = useState(false);
  const [opps, setOpps] = useState<Opp[]>([]);
  const [note, setNote] = useState('');
  const [added, setAdded] = useState<Record<number, boolean>>({});
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});

  const find = useCallback(async () => {
    setBusy(true);
    setNote('');
    setOpps([]);
    setAdded({});
    try {
      const resp = (await sendMax17Event({
        type: 'llm_raw',
        json: true,
        max_tokens: 1500,
        system:
          'Ты — MAX, честный агент-стратег по заработку для Мирона. Твоя задача — найти РЕАЛЬНЫЕ способы, которыми ОН заработает в реальном мире под свои навыки. ' +
          'ЖЁСТКИЕ ПРАВИЛА: только легальное и реальное; честные сроки и суммы (НЕ обещай «миллионы за неделю»); первые небольшие быстрые деньги важнее больших и далёких; ' +
          'НИКАКИХ схем, крипто-обещаний, ставок, «пассивного дохода на автопилоте» и «агенты сами зарабатывают» — этого не существует. ' +
          'Мирон делает работу сам, ты — стратег и трекер. Опирайся на его реальные навыки (он умеет строить веб/ИИ-продукты). ' +
          'Верни СТРОГО JSON и НИЧЕГО кроме него: {"opportunities":[{"title":"кратко","why":"1 фраза почему подходит","days":"срок до первых денег","money":"реалистичная первая сумма","effort":1,"steps":["короткий шаг1","короткий шаг2","короткий шаг3"]}]}. Ровно 3 варианта, ранжируй по скорости первых денег. Каждое поле — коротко.',
        text: `Навыки и ресурсы Мирона:\n${skills.trim()}\n\nНайди реальные пути заработка.`,
      })) as { llm?: { text?: string }; llm_text?: string; answer?: { text?: string } };
      const raw = String(resp.llm_text || resp.llm?.text || resp.answer?.text || '');
      const jsonStr = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
      const parsed = JSON.parse(jsonStr) as { opportunities?: Opp[] };
      const list = (parsed.opportunities ?? []).filter((o) => o.title);
      if (list.length === 0) throw new Error('пусто');
      setOpps(list);
    } catch {
      setNote('MAX не смог собрать план — попробуй ещё раз или уточни навыки выше.');
    } finally {
      setBusy(false);
    }
  }, [skills]);

  const toMissions = useCallback(async (o: Opp, idx: number) => {
    const steps = (o.steps ?? []).filter(Boolean);
    if (steps.length === 0) return;
    let ok = 0;
    for (const s of steps) {
      try {
        const r = (await sendMax17Event({ type: 'missions', action: 'add', title: `💰 ${o.title}: ${s}` })) as { missions?: unknown };
        if (r.missions) ok += 1;
      } catch {
        /* следующий шаг всё равно пробуем */
      }
    }
    if (ok > 0) {
      setAdded((a) => ({ ...a, [idx]: true }));
      setNote(`✓ Добавлено ${ok} ${ok === 1 ? 'шаг' : ok < 5 ? 'шага' : 'шагов'} в доску миссий — открываю.`);
      window.dispatchEvent(new CustomEvent('missions:refresh')); // открыть+обновить доску миссий
      window.dispatchEvent(new CustomEvent('max:announce', { detail: { text: `Взял в работу: ${o.title}` } }));
    } else {
      setNote('Не удалось добавить в миссии — попробуй ещё раз.');
    }
  }, []);

  useEffect(() => {
    const onToggle = () => setOpen((v) => !v);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('money:toggle', onToggle);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('money:toggle', onToggle);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[62] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
      <div className="flex max-h-[92vh] w-[min(680px,100%)] flex-col overflow-hidden rounded-2xl border border-emerald-400/30 bg-gradient-to-b from-[#04180f]/95 to-[#02100a]/95 shadow-[0_0_50px_rgba(16,185,129,0.15)]">
        <div className="flex items-center gap-2 border-b border-emerald-400/15 px-4 py-3">
          <Banknote className="h-4 w-4 text-emerald-300" />
          <span className="text-sm font-semibold tracking-[0.2em] text-emerald-100">MAX · ЗАРАБОТОК</span>
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-200/60" />}
          <button type="button" onClick={() => setOpen(false)} className="ml-auto rounded-lg p-1 text-white/40 hover:bg-white/10 hover:text-white/80">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          <p className="text-[11px] leading-relaxed text-white/50">
            MAX — твой стратег по заработку. Он находит <b className="text-white/75">реальные</b> пути под твои навыки и ставит первые шаги в миссии.
            Работу делаешь ты — MAX ведёт и держит фокус. Без схем и «денег на автопилоте».
          </p>

          <label className="block text-[11px] text-white/55">
            Твои навыки, ресурсы, сколько времени в день:
            <textarea
              value={skills}
              onChange={(e) => setSkills(e.target.value)}
              rows={3}
              className="mt-1 w-full resize-none rounded-lg border border-white/10 bg-black/40 p-2 text-[12px] text-white/85 outline-none focus:border-emerald-400/40"
            />
          </label>

          <button
            type="button"
            onClick={() => void find()}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-lg bg-emerald-500/25 px-3.5 py-2 text-sm font-semibold text-emerald-50 hover:bg-emerald-400/35 disabled:opacity-40"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {busy ? 'MAX ищет пути…' : 'Найти пути заработка'}
          </button>

          {note && <div className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-[11px] text-white/60">{note}</div>}

          {opps.map((o, i) => (
            <div key={i} className="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.04] p-3">
              <div className="flex items-start gap-2">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-[11px] font-bold text-emerald-200">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-semibold text-emerald-50">{o.title}</div>
                  {o.why && <div className="mt-0.5 text-[11px] leading-snug text-white/60">{o.why}</div>}
                  <div className="mt-1.5 flex flex-wrap gap-2 text-[10px]">
                    {o.money && (
                      <span className="flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-emerald-200">
                        <Banknote className="h-3 w-3" /> {o.money}
                      </span>
                    )}
                    {o.days && (
                      <span className="flex items-center gap-1 rounded-full bg-white/[0.06] px-2 py-0.5 text-white/60">
                        <Clock className="h-3 w-3" /> {o.days}
                      </span>
                    )}
                    {typeof o.effort === 'number' && (
                      <span className="flex items-center gap-1 rounded-full bg-white/[0.06] px-2 py-0.5 text-amber-200/80">
                        <Flame className="h-3 w-3" /> усилие {'●'.repeat(Math.max(1, Math.min(3, o.effort)))}
                      </span>
                    )}
                  </div>

                  {(o.steps?.length ?? 0) > 0 && (
                    <div className="mt-2">
                      <button
                        type="button"
                        onClick={() => setExpanded((e) => ({ ...e, [i]: !e[i] }))}
                        className="flex items-center gap-1 text-[11px] text-emerald-300/80 hover:text-emerald-200"
                      >
                        <Target className="h-3 w-3" /> {expanded[i] ? 'Скрыть шаги' : `Первые шаги (${o.steps!.length})`}
                      </button>
                      {expanded[i] && (
                        <ol className="mt-1 space-y-1 pl-1">
                          {o.steps!.map((s, k) => (
                            <li key={k} className="flex gap-2 text-[11px] text-white/75">
                              <span className="text-emerald-400/70">{k + 1}.</span> {s}
                            </li>
                          ))}
                        </ol>
                      )}
                      <button
                        type="button"
                        onClick={() => void toMissions(o, i)}
                        disabled={added[i]}
                        className="mt-2 flex items-center gap-1.5 rounded-lg bg-emerald-500/20 px-2.5 py-1 text-[11px] font-semibold text-emerald-100 hover:bg-emerald-400/30 disabled:opacity-50"
                      >
                        <Plus className="h-3 w-3" /> {added[i] ? 'В миссиях ✓' : 'Взять в работу (в миссии)'}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}

          {opps.length === 0 && !busy && !note && (
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 text-center text-[11px] text-white/40">
              Опиши навыки выше и нажми «Найти пути» — MAX подберёт реальные варианты и разложит на шаги.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
