'use client';

/**
 * MirWallet — кошелёк MirCoin. Внутриигровая валюта GAME: НЕ криптовалюта,
 * НЕ блокчейн, нельзя продать/обменять на реальные деньги. Прозрачный журнал —
 * каждая монета имеет причину (задача, миссия). Открыть: `mircoin:toggle`
 * (команда /mircoin или /кошелёк), Esc — закрыть.
 */

import { useEffect, useState } from 'react';
import { Coins, ShieldAlert, X } from 'lucide-react';
import { useMirCoin } from '@/hooks/use-mircoin';

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'только что';
  if (m < 60) return `${m} мин назад`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ч назад`;
  return `${Math.floor(h / 24)} дн назад`;
}

export default function MirWallet() {
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

  return (
    <div className="fixed inset-0 z-[62] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-[min(520px,100%)] max-h-[92vh] overflow-y-auto rounded-2xl border border-amber-400/30 bg-[#0a0818]/95 p-4 shadow-[0_0_40px_rgba(217,180,60,0.15)]">
        <div className="mb-3 flex items-center gap-2">
          <Coins className="h-4 w-4 text-amber-300" />
          <span className="text-sm font-semibold tracking-[0.2em] text-amber-200">Ⓜ КОШЕЛЁК MIRCOIN</span>
          <button type="button" onClick={() => setOpen(false)} className="ml-auto rounded-lg p-1 text-white/40 hover:bg-white/10 hover:text-white/80">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mb-3 rounded-xl border border-amber-400/25 bg-amber-400/[0.06] p-4 text-center">
          <div className="text-[11px] uppercase tracking-widest text-amber-300/60">Баланс</div>
          <div className="mt-1 text-3xl font-bold text-amber-100">Ⓜ {balance.toLocaleString('ru-RU')}</div>
        </div>

        <div className="mb-3 flex items-start gap-2 rounded-lg border border-sky-400/20 bg-sky-400/[0.05] px-3 py-2 text-[11px] leading-relaxed text-sky-100/80">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 flex-none text-sky-300" />
          <span>
            MirCoin — игровая валюта GAME. Не крипта, не блокчейн, не имеет реальной денежной стоимости и не подлежит
            обмену. Начисляется прозрачно: за закрытые задачи и миссии — каждая монета в журнале ниже с причиной.
          </span>
        </div>

        <div className="mb-1.5 text-[11px] uppercase tracking-widest text-amber-300/60">Журнал начислений ({ledger.length})</div>
        <div className="space-y-1.5">
          {ledger.length === 0 && (
            <div className="rounded-xl border border-white/10 bg-white/[0.02] py-6 text-center text-sm text-white/40">
              Пока пусто. Закрой задачу или миссию — появится первая запись.
            </div>
          )}
          {ledger.map((e) => (
            <div key={e.id} className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
              <div className="min-w-0">
                <div className="truncate text-sm text-white/85">{e.reason}</div>
                <div className="text-[10px] text-white/35">{timeAgo(e.ts)}</div>
              </div>
              <div className={`flex-none text-sm font-semibold ${e.amount >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                {e.amount >= 0 ? '+' : ''}{e.amount}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
