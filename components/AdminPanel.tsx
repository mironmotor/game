'use client';

/**
 * AdminPanel — дашборд владельца (только Мирон). Гейт серверный (/api/admin):
 * Google-аккаунт Мирона или админ-токен (пока OAuth не настроен). Показывает
 * здоровье системы, мозг, премиум-коды и статус туннеля до настоящего ядра;
 * кнопки — фиксы Доктора. Открыть: событие `admin:toggle` (команда /админ).
 */

import { useCallback, useEffect, useState } from 'react';
import { Coins, Crown, Loader2, RefreshCw, ShieldCheck, X, Zap } from 'lucide-react';
import { appBasePath } from '@/lib/base-path';

const TOKEN_KEY = 'mir_admin_token';

type AdminData = {
  ok: boolean;
  via?: string;
  email?: string | null;
  health?: Record<string, unknown> | null;
  graph?: Record<string, unknown> | null;
  premium?: { codes?: string[]; remote_core_configured?: boolean };
  server?: { uptime_sec?: number; node?: string; mem_mb?: number };
};

function readToken(): string {
  try {
    return (localStorage.getItem(TOKEN_KEY) || '').trim();
  } catch {
    return '';
  }
}

function num(v: unknown): string {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return '—';
  return n >= 1000 ? n.toLocaleString('ru-RU') : String(n);
}

export default function AdminPanel() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState(false);
  const [tokenInput, setTokenInput] = useState('');
  const [data, setData] = useState<AdminData | null>(null);
  const [note, setNote] = useState('');
  const [mcUsers, setMcUsers] = useState<{ email: string; name: string | null; balance: number }[] | null>(null);
  const [mcTo, setMcTo] = useState('');
  const [mcAmt, setMcAmt] = useState('');

  const load = useCallback(async () => {
    setBusy(true);
    setNote('');
    try {
      const res = await fetch(`${appBasePath}/api/admin`, {
        headers: readToken() ? { 'x-admin-token': readToken() } : {},
      });
      if (res.status === 401) {
        setDenied(true);
        setData(null);
        return;
      }
      setDenied(false);
      setData((await res.json()) as AdminData);
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const applyFix = useCallback(
    async (fix: string) => {
      setBusy(true);
      setNote('');
      try {
        const res = await fetch(`${appBasePath}/api/admin`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(readToken() ? { 'x-admin-token': readToken() } : {}) },
          body: JSON.stringify({ fix }),
        });
        setNote(res.ok ? `фикс «${fix}» выполнен` : `фикс «${fix}» не прошёл (${res.status})`);
      } catch (e) {
        setNote(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
        void load();
      }
    },
    [load],
  );

  const loadMircoin = useCallback(async () => {
    try {
      const res = await fetch(`${appBasePath}/api/mircoin?scope=users`, {
        headers: readToken() ? { 'x-admin-token': readToken() } : {},
      });
      if (res.ok) {
        const d = (await res.json()) as { users?: { email: string; name: string | null; balance: number }[] };
        setMcUsers(d.users ?? []);
      } else {
        setMcUsers([]);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const doTransfer = useCallback(async () => {
    const amt = Math.round(Number(mcAmt) || 0);
    if (!mcTo || amt <= 0) {
      setNote('укажи получателя и сумму');
      return;
    }
    setBusy(true);
    setNote('');
    try {
      const res = await fetch(`${appBasePath}/api/mircoin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(readToken() ? { 'x-admin-token': readToken() } : {}) },
        body: JSON.stringify({ action: 'transfer', to: mcTo, amount: amt }),
      });
      const d = (await res.json()) as { error?: string };
      setNote(res.ok ? `переведено ${amt.toLocaleString('ru-RU')} MIR → ${mcTo}` : `перевод не прошёл: ${d.error || res.status}`);
      if (res.ok) {
        setMcAmt('');
        void loadMircoin();
      }
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [mcTo, mcAmt, loadMircoin]);

  useEffect(() => {
    const onToggle = () => setOpen((v) => !v);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('admin:toggle', onToggle);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('admin:toggle', onToggle);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  useEffect(() => {
    if (open) {
      void load();
      void loadMircoin();
    }
  }, [open, load, loadMircoin]);

  if (!open) return null;

  const health = (data?.health ?? {}) as Record<string, unknown>;
  const maxSide = (health.max ?? {}) as Record<string, unknown>;
  const gameSide = (health.game ?? {}) as Record<string, unknown>;
  const cache = (maxSide.cache ?? {}) as Record<string, unknown>;
  const missions = (maxSide.missions ?? {}) as Record<string, unknown>;
  const graph = (data?.graph ?? {}) as Record<string, unknown>;

  return (
    <div className="fixed inset-0 z-[62] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
      <div className="w-[min(680px,100%)] max-h-[92vh] overflow-y-auto rounded-2xl border border-amber-400/30 bg-gradient-to-b from-[#1a1204]/95 to-[#0a0602]/95 p-4 shadow-[0_0_50px_rgba(251,191,36,0.15)]">
        <div className="mb-3 flex items-center gap-2">
          <Crown className="h-4 w-4 text-amber-300" />
          <span className="text-sm font-semibold tracking-[0.2em] text-amber-100">АДМИН · МИРОН</span>
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-200/60" />}
          {data?.via && (
            <span className="flex items-center gap-1 rounded-full border border-amber-400/25 px-2 py-0.5 text-[10px] uppercase tracking-widest text-amber-200/70">
              <ShieldCheck className="h-3 w-3" /> {data.via === 'google' ? data.email || 'google' : 'токен'}
            </span>
          )}
          <button type="button" onClick={() => setOpen(false)} className="ml-auto rounded-lg p-1 text-white/40 hover:bg-white/10 hover:text-white/80">
            <X className="h-4 w-4" />
          </button>
        </div>

        {denied ? (
          <div className="rounded-xl border border-amber-400/20 bg-amber-400/[0.05] p-4">
            <p className="text-sm text-amber-100">Доступ только для Мирона.</p>
            <p className="mt-1 text-[11px] leading-relaxed text-white/50">
              Войди через Google (аккаунт Мирона) — или введи админ-токен (задаётся как ADMIN_TOKEN в .env.local на сервере).
            </p>
            <div className="mt-2 flex items-center gap-1.5">
              <input
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                placeholder="админ-токен"
                type="password"
                className="min-w-0 flex-1 rounded border border-amber-400/20 bg-black/50 px-2 py-1.5 text-sm text-amber-100 placeholder:text-white/30 outline-none"
              />
              <button
                type="button"
                onClick={() => {
                  try {
                    localStorage.setItem(TOKEN_KEY, tokenInput.trim());
                  } catch {
                    /* ignore */
                  }
                  void load();
                }}
                className="shrink-0 rounded bg-amber-500/30 px-3 py-1.5 text-sm font-semibold text-amber-50 hover:bg-amber-400/40"
              >
                Войти
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                <div className="text-[10px] uppercase tracking-widest text-white/40">Здоровье</div>
                <div className="mt-1 text-xl font-bold text-emerald-300">{num(health.score)}%</div>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                <div className="text-[10px] uppercase tracking-widest text-white/40">Кэш hit-rate</div>
                <div className="mt-1 text-xl font-bold text-cyan-300">{num(Math.round(((cache.hit_rate as number) || 0) * 100))}%</div>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                <div className="text-[10px] uppercase tracking-widest text-white/40">Миссии</div>
                <div className="mt-1 text-xl font-bold text-fuchsia-300">
                  {num(missions.open)}<span className="text-sm text-white/40"> откр.</span>
                </div>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                <div className="text-[10px] uppercase tracking-widest text-white/40">Ошибки клиента</div>
                <div className="mt-1 text-xl font-bold text-rose-300">{num(gameSide.client_errors)}</div>
              </div>
            </div>

            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                <div className="text-[10px] uppercase tracking-widest text-white/40">Мозг MAX</div>
                <div className="mt-1 space-y-0.5 text-[12px] text-white/75">
                  {Object.entries(graph)
                    .filter(([, v]) => typeof v === 'number')
                    .slice(0, 6)
                    .map(([k, v]) => (
                      <div key={k} className="flex justify-between gap-2">
                        <span className="truncate text-white/45">{k}</span>
                        <span className="font-semibold">{num(v)}</span>
                      </div>
                    ))}
                  {Object.keys(graph).length === 0 && <span className="text-white/35">нет данных</span>}
                </div>
              </div>
              <div className="rounded-xl border border-amber-400/20 bg-amber-400/[0.04] p-3">
                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-amber-200/60">
                  <Zap className="h-3 w-3" /> Премиум
                </div>
                <div className="mt-1 space-y-0.5 text-[12px] text-white/75">
                  <div className="flex justify-between"><span className="text-white/45">кодов активно</span><span className="font-semibold">{data?.premium?.codes?.length ?? 0}</span></div>
                  <div className="flex justify-between">
                    <span className="text-white/45">туннель к локалке</span>
                    <span className={`font-semibold ${data?.premium?.remote_core_configured ? 'text-emerald-300' : 'text-white/40'}`}>
                      {data?.premium?.remote_core_configured ? 'настроен' : 'не задан'}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {(data?.premium?.codes ?? []).map((c) => (
                      <code key={c} className="rounded bg-black/40 px-1.5 py-0.5 text-[10px] text-amber-200/80">{c}</code>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-2 rounded-xl border border-yellow-400/20 bg-yellow-400/[0.04] p-3">
              <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-yellow-200/70">
                <Coins className="h-3 w-3" /> MIRCOIN · счета и переводы
              </div>
              <div className="mt-1.5 max-h-32 space-y-0.5 overflow-y-auto text-[12px]">
                {(mcUsers ?? []).map((u) => (
                  <div key={u.email} className="flex justify-between gap-2">
                    <span className="truncate text-white/55">{u.name || u.email}</span>
                    <span className="font-semibold text-yellow-200">{num(u.balance)}</span>
                  </div>
                ))}
                {mcUsers && mcUsers.length === 0 && <span className="text-white/35">пока нет счетов (появятся, когда люди войдут)</span>}
                {!mcUsers && <span className="text-white/35">загрузка…</span>}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <select
                  value={mcTo}
                  onChange={(e) => setMcTo(e.target.value)}
                  className="min-w-0 flex-1 rounded border border-white/15 bg-black/50 px-2 py-1.5 text-sm text-white outline-none"
                >
                  <option value="">— кому перевести —</option>
                  {(mcUsers ?? []).map((u) => (
                    <option key={u.email} value={u.email}>
                      {u.name || u.email} ({num(u.balance)})
                    </option>
                  ))}
                </select>
                <input
                  value={mcAmt}
                  onChange={(e) => setMcAmt(e.target.value.replace(/[^0-9]/g, ''))}
                  inputMode="numeric"
                  placeholder="сколько"
                  className="w-24 rounded border border-white/15 bg-black/50 px-2 py-1.5 text-sm text-white outline-none placeholder:text-white/30"
                />
                <button
                  type="button"
                  disabled={busy || !mcTo || !mcAmt}
                  onClick={() => void doTransfer()}
                  className="shrink-0 rounded bg-yellow-500/30 px-3 py-1.5 text-sm font-semibold text-yellow-50 hover:bg-yellow-400/40 disabled:opacity-40"
                >
                  Перевести
                </button>
              </div>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button type="button" disabled={busy} onClick={() => void load()} className="flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-sm text-white/80 hover:bg-white/20 disabled:opacity-40">
                <RefreshCw className="h-3.5 w-3.5" /> Обновить
              </button>
              <button type="button" disabled={busy} onClick={() => void applyFix('rewarm_daemon')} className="rounded-lg bg-cyan-500/20 px-3 py-1.5 text-sm text-cyan-100 hover:bg-cyan-400/30 disabled:opacity-40">
                Перезапустить демон
              </button>
              <button type="button" disabled={busy} onClick={() => void applyFix('clear_cache')} className="rounded-lg bg-fuchsia-500/20 px-3 py-1.5 text-sm text-fuchsia-100 hover:bg-fuchsia-400/30 disabled:opacity-40">
                Очистить кэш
              </button>
              {data?.server && (
                <span className="ml-auto text-[10px] text-white/35">
                  node {data.server.node} · RSS {num(data.server.mem_mb)}MB · up {num(Math.round((data.server.uptime_sec || 0) / 60))}м
                </span>
              )}
            </div>

            {note && <div className="mt-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] text-white/60">{note}</div>}
          </>
        )}
      </div>
    </div>
  );
}
