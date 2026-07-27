'use client';

/**
 * MirCoinPanel — кошелёк MirCoin: баланс + прозрачный журнал начислений.
 * MirCoin — ВНУТРИИГРОВАЯ валюта, НЕ криптовалюта: не блокчейн, не токен, нельзя
 * продать/обменять на настоящие деньги. Каждая монета имеет причину (журнал).
 * Открыть: событие `mircoin:toggle` (клик по балансу в HUD или команда /коин).
 */

import { useEffect, useState } from 'react';
import { Coins, Info, X } from 'lucide-react';
import { useMirCoin } from '@/hooks/use-mircoin';

function ago(ts: string): string {
  const d = Date.now() - new Date(ts).getTime();
  const m = Math.floor(d / 60000);
  if (m < 1) return 'только что';
  if (m < 60) return `${m} мин назад`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ч назад`;
  return `${Math.floor(h / 24)} дн назад`;
}

export default function MirCoinPanel() {
  const [open, setOpen] = useState(false);
  const { balance, ledger } = useMirCoin();

  useEffect(() => {
    const onToggle = () => setOpen((v) => !v);
    const onOpen = () => setOpen(true);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mircoin:toggle', onToggle);
    window.addEventListener('mircoin:open', onOpen);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mircoin:toggle', onToggle);
      window.removeEventListener('mircoin:open', onOpen);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  if (!open) return null;

  const earnedTotal = ledger.reduce((s, e) => s + (e.amount > 0 ? e.amount : 0), 0);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-[min(520px,100%)] max-h-[92vh] overflow-y-auto rounded-2xl border border-amber-400/30 bg-[#0f0a04]/95 p-4 shadow-[0_0_40px_rgba(217,160,23,0.18)]">
        <div className="mb-3 flex items-center gap-2">
          <Coins className="h-4 w-4 text-amber-300" />
          <span className="text-sm font-semibold tracking-[0.2em] text-amber-200">Ⓜ КОШЕЛЁК MIRCOIN</span>
          <button type="button" onClick={() => setOpen(false)} className="ml-auto rounded-lg p-1 text-white/40 hover:bg-white/10 hover:text-white/80">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="rounded-xl border border-amber-400/25 bg-gradient-to-b from-amber-500/15 to-transparent p-4 text-center">
          <div className="text-[11px] uppercase tracking-widest text-amber-300/70">Баланс</div>
          <div className="mt-1 text-4xl font-bold text-amber-100">Ⓜ {balance.toLocaleString('ru-RU').replace(/,/g, ' ')}</div>
          <div className="mt-1 text-[11px] text-white/45">заработано за всё время: Ⓜ {earnedTotal.toLocaleString('ru-RU').replace(/,/g, ' ')}</div>
        </div>

        <div className="mt-3 flex items-start gap-2 rounded-lg border border-white/10 bg-white/[0.03] p-2.5 text-[11px] text-white/50">
          <Info className="mt-0.5 h-3.5 w-3.5 flex-none text-sky-300/70" />
          <span>
            MirCoin — <b className="text-white/70">внутриигровая</b> валюта: копится за твои действия и миссии. Это <b className="text-white/70">не криптовалюта</b> —
            не блокчейн, не токен, нельзя продать или обменять на настоящие деньги. Просто честные очки с причиной у каждой монеты.
          </span>
        </div>

        <div className="mt-3 mb-1.5 text-[11px] uppercase tracking-widest text-amber-300/60">Журнал начислений ({ledger.length})</div>
        <div className="space-y-1.5">
          {ledger.length === 0 && (
            <div className="rounded-xl border border-white/10 bg-white/[0.02] py-6 text-center text-sm text-white/40">
              Пока пусто. Закрывай задачи и миссии — MirCoin начнёт капать с причиной.
            </div>
          )}
          {ledger.map((e) => (
            <div key={e.id} className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/[0.03] p-2.5">
              <span className={`font-mono text-sm font-bold ${e.amount >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                {e.amount >= 0 ? '+' : ''}
                {e.amount}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm text-white/80">{e.reason}</span>
              <span className="flex-none text-[10px] text-white/35">{ago(e.ts)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
