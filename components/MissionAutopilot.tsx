'use client';

/**
 * MissionAutopilot — «Автопилот миссий». MAX сам разбирает открытые миссии:
 *   • что он МОЖЕТ сделать сам (ресерч/черновик/план/код) — делает и прикладывает
 *     результат, без лишних кнопок (это безопасно: он готовит ТЕКСТ, не трогает мир);
 *   • где нужен Мирон-ЧЕЛОВЕК (звонок, оплата, вход по паролю, решение, встреча) —
 *     шлёт тебе чёткий запрос «🙋 Нужен ты».
 *
 * ГРАНИЦА (осознанно): автопилот НЕ отправляет письма, не постит, не платит, не
 * кликает по твоему рабочему столу и не рулит машиной удалённо без твоего явного
 * подтверждения. Он готовит работу до кнопки «отправить» — жмёшь её ты. Это не
 * лишняя кнопка, это то, что не даёт агенту сделать необратимое по ошибке.
 *
 * Открыть: событие `autopilot:toggle` (команда /автопилот).
 */

import { useCallback, useEffect, useState } from 'react';
import { Bot, CheckCircle2, HandHelping, Loader2, PlayCircle, X } from 'lucide-react';
import { sendMax17Event } from '@/lib/max17-client';
import { recordOutcome } from '@/lib/outcome';

type Mission = { id: string; title: string; status: string };
type Triage = {
  title?: string;
  can_do?: boolean;
  kind?: string; // research | draft | plan | code | human
  done?: string; // что MAX подготовил
  needs_you?: string; // запрос к Мирону-человеку
};

export default function MissionAutopilot() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState<Triage[]>([]);
  const [note, setNote] = useState('');

  const run = useCallback(async () => {
    setBusy(true);
    setNote('');
    setItems([]);
    try {
      // 1) берём открытые миссии
      const snap = (await sendMax17Event({ type: 'missions', action: 'list' })) as { missions?: { missions?: Mission[] } };
      const openM = (snap.missions?.missions ?? []).filter((m) => m.status !== 'done').slice(0, 6);
      if (openM.length === 0) {
        setNote('Нет открытых миссий — сначала набери задач (например, через /деньги).');
        return;
      }
      // 2) MAX триажит и готовит, что может
      const list = openM.map((m, i) => `${i + 1}. ${m.title}`).join('\n');
      const resp = (await sendMax17Event({
        type: 'llm_raw',
        json: true,
        max_tokens: 1900,
        system:
          'Ты — Автопилот миссий MAX. Для каждой миссии реши: можешь ли ты сделать её САМ как ИИ (ресерч, черновик текста/письма, план, код) или нужен человек Мирон (звонок, оплата, вход по паролю, встреча, решение, отправка сообщения кому-то). ' +
          'Если можешь сам — СДЕЛАЙ прямо тут: дай готовый результат (черновик/план/ресерч/код), коротко и по делу. Ты готовишь только ТЕКСТ; ты не отправляешь, не постишь, не платишь и не трогаешь чужие данные — не выдумывай фактов/аккаунтов/ссылок. ' +
          'Если нужен человек — напиши чёткий короткий запрос Мирону, что именно от него нужно и почему только он. ' +
          'Верни СТРОГО JSON: {"items":[{"title":"кратко","can_do":true/false,"kind":"research|draft|plan|code|human","done":"готовый результат если can_do, иначе пусто","needs_you":"запрос Мирону если нужен человек, иначе пусто"}]}.',
        text: `Открытые миссии:\n${list}`,
      })) as { llm?: { text?: string }; llm_text?: string; answer?: { text?: string } };
      const raw = String(resp.llm_text || resp.llm?.text || resp.answer?.text || '');
      const js = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
      const parsed = JSON.parse(js) as { items?: Triage[] };
      const got = (parsed.items ?? []).filter((x) => x.title);
      if (got.length === 0) throw new Error('пусто');
      setItems(got);
      // Петля исхода: по каждой миссии MAX либо сделал сам, либо передал человеку —
      // и то и другое учит, какие задачи он реально закрывает.
      for (const x of got) {
        const did = Boolean(x.can_do && x.done && x.done.trim());
        void recordOutcome({
          goal: x.title ?? '',
          action: did ? `автопилот выполнил (${x.kind ?? 'шаг'})` : 'передано человеку',
          status: did ? 'success' : 'skipped',
          agent: 'autopilot',
        });
      }
      const humans = got.filter((x) => x.needs_you && x.needs_you.trim()).length;
      if (humans > 0) window.dispatchEvent(new CustomEvent('max:announce', { detail: { text: `По ${humans} задачам нужен ты — смотри запросы` } }));
    } catch (e) {
      setNote('Автопилот споткнулся: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    const onToggle = () => setOpen((v) => !v);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('autopilot:toggle', onToggle);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('autopilot:toggle', onToggle);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  useEffect(() => {
    if (open && items.length === 0 && !busy) void run();
  }, [open, items.length, busy, run]);

  if (!open) return null;

  const doneItems = items.filter((x) => x.can_do && x.done && x.done.trim());
  const needItems = items.filter((x) => x.needs_you && x.needs_you.trim());

  return (
    <div className="fixed inset-0 z-[63] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
      <div className="flex max-h-[92vh] w-[min(720px,100%)] flex-col overflow-hidden rounded-2xl border border-sky-400/30 bg-gradient-to-b from-[#04121e]/95 to-[#02090f]/95 shadow-[0_0_50px_rgba(56,189,248,0.15)]">
        <div className="flex items-center gap-2 border-b border-sky-400/15 px-4 py-3">
          <PlayCircle className="h-4 w-4 text-sky-300" />
          <span className="text-sm font-semibold tracking-[0.2em] text-sky-100">АВТОПИЛОТ МИССИЙ</span>
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-sky-200/60" />}
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent('runner:open'))}
            className="ml-auto flex items-center gap-1 rounded-lg border border-sky-400/30 bg-sky-500/15 px-2.5 py-1 text-[11px] font-semibold text-sky-100 hover:bg-sky-400/25"
          >
            ▶ Прогон по шагам
          </button>
          <button type="button" onClick={() => void run()} disabled={busy} className="rounded-lg border border-white/10 px-2.5 py-1 text-[11px] text-white/70 hover:bg-white/10 disabled:opacity-40">
            Прогнать заново
          </button>
          <button type="button" onClick={() => setOpen(false)} className="rounded-lg p-1 text-white/40 hover:bg-white/10 hover:text-white/80">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          <p className="text-[11px] leading-relaxed text-white/50">
            MAX сам разбирает твои миссии: что может — <b className="text-white/75">делает</b> (ресерч, черновик, план, код) и кладёт результат;
            где нужен ты как человек — <b className="text-amber-200/80">шлёт запрос</b>. Реальные действия в мире (отправка, оплата, рабочий стол)
            он не делает без твоего «да» — готовит до кнопки, жмёшь её ты.
          </p>

          {busy && items.length === 0 && (
            <div className="flex items-center gap-2 py-6 text-[12px] text-sky-200/70">
              <Loader2 className="h-4 w-4 animate-spin" /> MAX разбирает миссии и готовит, что может…
            </div>
          )}
          {note && <div className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-[11px] text-white/60">{note}</div>}

          {doneItems.length > 0 && (
            <div>
              <div className="mb-1.5 flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-emerald-300/70">
                <Bot className="h-3.5 w-3.5" /> MAX сделал сам ({doneItems.length})
              </div>
              <div className="space-y-2">
                {doneItems.map((x, i) => (
                  <div key={i} className="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.05] p-3">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                      <span className="text-[12px] font-semibold text-emerald-50">{x.title}</span>
                      {x.kind && <span className="ml-auto text-[9px] uppercase tracking-widest text-white/35">{x.kind}</span>}
                    </div>
                    <div className="mt-1.5 whitespace-pre-wrap rounded-lg bg-black/30 p-2 text-[11px] leading-snug text-white/85">{x.done}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {needItems.length > 0 && (
            <div>
              <div className="mb-1.5 flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-amber-300/70">
                <HandHelping className="h-3.5 w-3.5" /> Нужен ты, Мирон ({needItems.length})
              </div>
              <div className="space-y-2">
                {needItems.map((x, i) => (
                  <div key={i} className="rounded-xl border border-amber-400/25 bg-amber-400/[0.06] p-3">
                    <div className="text-[12px] font-semibold text-amber-100">🙋 {x.title}</div>
                    <div className="mt-1 whitespace-pre-wrap text-[11px] leading-snug text-white/85">{x.needs_you}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
