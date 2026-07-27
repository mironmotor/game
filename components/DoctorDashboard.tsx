'use client';

/**
 * DoctorDashboard — «Доктор»: живой дашборд здоровья GAME + MAX.
 * Открыть: событие `doctor:toggle` (команда /доктор), Esc — закрыть.
 * Поллит /api/health (свип ядра mark17/doctor.py + живость демона), показывает
 * плитки GAME/MAX и список issue как квесты с кнопкой «Починить» (безопасный
 * авто-фикс). Те же проблемы ядро заводит квестами в доске /миссии (тег doctor:).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, Check, HeartPulse, Loader2, RefreshCw, Sparkles, Wrench, X } from 'lucide-react';
import { getApiPath } from '@/lib/max17-client';
import { recordOutcome } from '@/lib/outcome';

type Issue = {
  id: string;
  title: string;
  severity: 'critical' | 'high' | 'warn' | 'info';
  area: 'game' | 'max';
  detail?: string;
  fixable?: boolean;
  fix_action?: string;
};

// Предложение агента само-улучшения (применяется только по согласованию).
type Proposal = {
  id: string;
  title: string;
  problem: string;
  action: string;
  kind: 'operational' | 'code';
  fix_action?: string;
  code_instruction?: string;
  risk: 'low' | 'med' | 'high';
};

type Health = {
  ok: boolean;
  score: number;
  game: { client_errors: number; daemon: Record<string, unknown> };
  max: {
    cache: Record<string, unknown>;
    missions: Record<string, unknown>;
    cluster: Record<string, unknown>;
    state: Record<string, unknown>;
    llm: Record<string, unknown>;
  };
  issues: Issue[];
};

type Resp = {
  ok: boolean;
  daemon: { alive: boolean; warmedUp: boolean; queueDepth: number };
  health: Health | null;
  error?: string;
};

const SEV: Record<string, { ring: string; dot: string; label: string }> = {
  critical: { ring: 'border-rose-500/50 bg-rose-500/10', dot: 'bg-rose-400', label: 'text-rose-200' },
  high: { ring: 'border-orange-500/40 bg-orange-500/10', dot: 'bg-orange-400', label: 'text-orange-200' },
  warn: { ring: 'border-yellow-500/35 bg-yellow-500/[0.08]', dot: 'bg-yellow-300', label: 'text-yellow-100' },
  info: { ring: 'border-sky-500/30 bg-sky-500/[0.06]', dot: 'bg-sky-300', label: 'text-sky-100' },
};

function scoreColor(s: number): string {
  if (s >= 90) return 'text-emerald-300';
  if (s >= 70) return 'text-yellow-300';
  if (s >= 40) return 'text-orange-300';
  return 'text-rose-300';
}

function recentClientErrors(): string[] {
  if (typeof window === 'undefined') return [];
  const buf = (window as unknown as { __maxClientErrors?: string[] }).__maxClientErrors;
  return Array.isArray(buf) ? buf.slice(-10) : [];
}

export default function DoctorDashboard() {
  const [open, setOpen] = useState(false);
  const [resp, setResp] = useState<Resp | null>(null);
  const [busy, setBusy] = useState(false);
  const [fixing, setFixing] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [proposals, setProposals] = useState<Proposal[] | null>(null);
  const [diagnosing, setDiagnosing] = useState(false);
  const [applying, setApplying] = useState<string | null>(null);
  const [applied, setApplied] = useState<Record<string, string>>({});
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const call = useCallback(async (payload: Record<string, unknown>) => {
    const r = await fetch(getApiPath('health'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_errors: recentClientErrors(), ...payload }),
    });
    return (await r.json()) as Resp;
  }, []);

  const sweep = useCallback(async () => {
    setBusy(true);
    try {
      setResp(await call({}));
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [call]);

  const runFix = useCallback(
    async (issue: Issue) => {
      if (!issue.fix_action) return;
      setFixing(issue.id);
      setNote(null);
      try {
        const out = await call({ fix: issue.fix_action });
        setResp(out);
        setNote(out.ok ? `Починено: ${issue.title}` : `Не удалось: ${issue.title}`);
        // Петля исхода: сработал ли этот фикс на этой проблеме.
        void recordOutcome({
          goal: `здоровье системы: ${issue.title}`,
          action: `фикс ${issue.fix_action}`,
          ok: Boolean(out.ok),
          agent: 'doctor',
        });
      } catch (e) {
        setNote(e instanceof Error ? e.message : String(e));
      } finally {
        setFixing(null);
      }
    },
    [call],
  );

  // Агент само-улучшения: только ПРЕДЛАГАЕТ (diagnose).
  const diagnose = useCallback(async () => {
    setDiagnosing(true);
    setNote(null);
    try {
      const r = await fetch(getApiPath('self-heal'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'diagnose' }),
      });
      if (r.status === 401) {
        setNote('Само-улучшение — только для админа (войди через Google как Мирон).');
        setProposals([]);
        return;
      }
      const d = (await r.json()) as { proposals?: Proposal[] };
      setProposals(d.proposals ?? []);
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setDiagnosing(false);
    }
  }, []);

  // Применяем предложение ТОЛЬКО по нажатию «Согласовать».
  const applyProposal = useCallback(
    async (p: Proposal) => {
      setApplying(p.id);
      setNote(null);
      try {
        const r = await fetch(getApiPath('self-heal'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'apply', proposal: p }),
        });
        const d = (await r.json()) as { ok?: boolean; applied?: string; result?: { answer?: string; error?: string } };
        const msg =
          d.applied === 'code'
            ? `Агент проработал в песочнице: ${d.result?.answer ? String(d.result.answer).slice(0, 160) : d.result?.error || 'см. результат'}`
            : d.ok
              ? 'Операционный фикс применён ✓'
              : 'Фикс не прошёл';
        setApplied((m) => ({ ...m, [p.id]: msg }));
        // Петля исхода: согласованное улучшение — сработало или нет.
        void recordOutcome({
          goal: `улучшение системы: ${p.problem || p.title}`,
          action: p.title,
          ok: Boolean(d.ok),
          agent: 'self-heal',
        });
        if (d.applied === 'operational' && d.ok) void sweep();
      } catch (e) {
        setApplied((m) => ({ ...m, [p.id]: e instanceof Error ? e.message : String(e) }));
      } finally {
        setApplying(null);
      }
    },
    [sweep],
  );

  const rejectProposal = useCallback((id: string) => {
    setProposals((ps) => (ps ?? []).filter((p) => p.id !== id));
  }, []);

  useEffect(() => {
    const onToggle = () => setOpen((v) => !v);
    const onOpen = () => setOpen(true);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('doctor:toggle', onToggle);
    window.addEventListener('doctor:open', onOpen);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('doctor:toggle', onToggle);
      window.removeEventListener('doctor:open', onOpen);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  // Poll while open; stop when closed.
  useEffect(() => {
    if (!open) {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
      return;
    }
    void sweep();
    timerRef.current = setInterval(() => void sweep(), 15000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
    };
  }, [open, sweep]);

  if (!open) return null;

  const health = resp?.health ?? null;
  const issues = health?.issues ?? [];
  const score = health?.score ?? 0;
  const daemon = resp?.daemon;

  const gameOk = (health?.game.client_errors ?? 0) === 0 && (daemon?.alive ?? false);
  const maxOk = issues.filter((i) => i.area === 'max').length === 0;

  const Tile = ({ title, ok, lines }: { title: string; ok: boolean; lines: string[] }) => (
    <div className={`rounded-xl border p-3 ${ok ? 'border-emerald-400/25 bg-emerald-400/[0.05]' : 'border-rose-400/30 bg-rose-400/[0.06]'}`}>
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${ok ? 'bg-emerald-400' : 'bg-rose-400'}`} />
        <span className="text-sm font-semibold text-white/90">{title}</span>
        <span className={`ml-auto text-[11px] ${ok ? 'text-emerald-300/80' : 'text-rose-300/80'}`}>{ok ? 'здоров' : 'внимание'}</span>
      </div>
      <div className="mt-1.5 space-y-0.5">
        {lines.map((l, i) => (
          <div key={i} className="text-[11px] text-white/45">{l}</div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[61] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-[min(680px,100%)] max-h-[92vh] overflow-y-auto rounded-2xl border border-cyan-400/30 bg-[#060a14]/95 p-4 shadow-[0_0_40px_rgba(34,211,238,0.15)]">
        <div className="mb-3 flex items-center gap-2">
          <HeartPulse className="h-4 w-4 text-cyan-300" />
          <span className="text-sm font-semibold tracking-[0.2em] text-cyan-200">🩺 ДОКТОР · ЗДОРОВЬЕ СИСТЕМЫ</span>
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-cyan-300/60" />}
          <button
            type="button"
            onClick={() => void sweep()}
            disabled={busy}
            className="ml-auto flex items-center gap-1 rounded-lg bg-white/10 px-2 py-1 text-[11px] text-white/70 hover:bg-white/20 disabled:opacity-40"
          >
            <RefreshCw className="h-3 w-3" /> свип
          </button>
          <button type="button" onClick={() => setOpen(false)} className="rounded-lg p-1 text-white/40 hover:bg-white/10 hover:text-white/80">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mb-3 flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
          <Activity className={`h-5 w-5 ${scoreColor(score)}`} />
          <div>
            <div className="text-[11px] uppercase tracking-widest text-white/40">Здоровье системы</div>
            <div className={`text-2xl font-bold ${scoreColor(score)}`}>{score}%</div>
          </div>
          <div className="ml-auto text-right text-[11px] text-white/45">
            <div>демон: {daemon?.alive ? (daemon.warmedUp ? 'тёплый ✓' : 'холодный') : 'спит'}</div>
            <div>очередь: {daemon?.queueDepth ?? 0}</div>
          </div>
        </div>

        <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Tile
            title="GAME (мост/браузер)"
            ok={gameOk}
            lines={[
              `демон: ${daemon?.alive ? 'жив' : 'спит'}`,
              `ошибки браузера: ${health?.game.client_errors ?? 0}`,
            ]}
          />
          <Tile
            title="MAX (ядро)"
            ok={maxOk}
            lines={[
              `голос LLM: ${String(health?.max.llm?.active ?? '—')} ${health?.max.llm?.ok ? '✓' : ''}`,
              `кэш: ${String(health?.max.cache?.size ?? 0)}/${String(health?.max.cache?.max_size ?? 0)}`,
              `миссии: ${String(health?.max.missions?.open ?? 0)} в работе`,
            ]}
          />
        </div>

        <div className="mb-1.5 text-[11px] uppercase tracking-widest text-cyan-300/60">
          Квесты Доктора ({issues.length})
        </div>
        <div className="space-y-2">
          {issues.length === 0 && (
            <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.04] py-6 text-center text-sm text-emerald-200/70">
              Всё чисто. Система здорова. 🟢
            </div>
          )}
          {issues.map((it) => {
            const sev = SEV[it.severity] ?? SEV.info;
            return (
              <div key={it.id} className={`rounded-xl border p-3 ${sev.ring}`}>
                <div className="flex items-start gap-2">
                  <span className={`mt-1 h-2 w-2 rounded-full ${sev.dot}`} />
                  <div className="min-w-0 flex-1">
                    <div className={`text-sm font-semibold ${sev.label}`}>{it.title}</div>
                    <div className="text-[11px] text-white/40">
                      {it.area === 'game' ? 'GAME' : 'MAX'} · {it.severity}
                      {it.detail ? ` · ${it.detail}` : ''}
                    </div>
                  </div>
                  {it.fixable && it.fix_action && (
                    <button
                      type="button"
                      onClick={() => void runFix(it)}
                      disabled={fixing !== null}
                      className="flex items-center gap-1 rounded-lg bg-cyan-500/25 px-2.5 py-1 text-[11px] font-semibold text-cyan-100 hover:bg-cyan-500/40 disabled:opacity-40"
                    >
                      {fixing === it.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wrench className="h-3 w-3" />}
                      Починить
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-4 rounded-xl border border-violet-400/25 bg-violet-400/[0.05] p-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-3.5 w-3.5 text-violet-300" />
            <span className="text-[11px] uppercase tracking-widest text-violet-200/80">Само-улучшение · агент</span>
            <button
              type="button"
              onClick={() => void diagnose()}
              disabled={diagnosing}
              className="ml-auto flex items-center gap-1 rounded-lg bg-violet-500/25 px-2.5 py-1 text-[11px] font-semibold text-violet-100 hover:bg-violet-500/40 disabled:opacity-40"
            >
              {diagnosing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
              Предложить улучшения
            </button>
          </div>
          <p className="mt-1 text-[10px] leading-relaxed text-white/40">
            MAX анализирует здоровье и предлагает фиксы. Ничего не применяется без твоего «Согласовать».
            Кодовые правки прорабатываются в песочнице — выкат в живой GAME остаётся отдельным шагом.
          </p>
          {proposals && proposals.length === 0 && !diagnosing && (
            <div className="mt-2 text-[11px] text-white/40">Предложений нет — система в порядке. 🟢</div>
          )}
          <div className="mt-2 space-y-2">
            {(proposals ?? []).map((p) => (
              <div key={p.id} className="rounded-lg border border-white/10 bg-black/30 p-2.5">
                <div className="text-[13px] font-semibold text-white/90">{p.title}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px]">
                  <span className={`rounded px-1.5 py-0.5 ${p.kind === 'code' ? 'bg-amber-500/20 text-amber-200' : 'bg-cyan-500/20 text-cyan-200'}`}>
                    {p.kind === 'code' ? 'КОД · песочница' : 'ОПЕРАЦИОННЫЙ'}
                  </span>
                  <span className="text-white/40">риск: {p.risk}</span>
                </div>
                {p.problem && <div className="mt-1 text-[11px] text-white/55">{p.problem}</div>}
                {p.action && <div className="mt-0.5 text-[11px] text-white/70">→ {p.action}</div>}
                {applied[p.id] ? (
                  <div className="mt-2 rounded border border-emerald-400/20 bg-emerald-400/5 px-2 py-1 text-[11px] text-emerald-100">{applied[p.id]}</div>
                ) : (
                  <div className="mt-2 flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => void applyProposal(p)}
                      disabled={applying !== null}
                      className="flex items-center gap-1 rounded-lg bg-emerald-500/25 px-2.5 py-1 text-[11px] font-semibold text-emerald-100 hover:bg-emerald-500/40 disabled:opacity-40"
                    >
                      {applying === p.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                      Согласовать
                    </button>
                    <button
                      type="button"
                      onClick={() => rejectProposal(p.id)}
                      disabled={applying !== null}
                      className="flex items-center gap-1 rounded-lg bg-white/10 px-2.5 py-1 text-[11px] text-white/60 hover:bg-white/20 disabled:opacity-40"
                    >
                      <X className="h-3 w-3" /> Отклонить
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {note && <div className="mt-3 rounded-lg border border-cyan-400/20 bg-cyan-400/5 px-3 py-2 text-xs text-cyan-100">{note}</div>}

        <p className="mt-3 text-[10px] leading-relaxed text-white/30">
          Доктор поллит здоровье каждые 15с. Те же проблемы ядро само заводит квестами в доске «Миссии» (тег doctor)
          и авто-закрывает, когда фикс сработал. «Починить» — безопасный авто-фикс: перезапуск демона, чистка кэша,
          смена голоса LLM, пересев миссий.
        </p>
      </div>
    </div>
  );
}
