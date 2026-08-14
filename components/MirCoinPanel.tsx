'use client';

/**
 * MirCoinPanel — кошелёк MIRCOIN: баланс, ступень игрока, тарифы и журнал.
 *
 * MIRCOIN — единица учёта внутри GAME, НЕ криптовалюта: не блокчейн, не токен,
 * обратно в деньги не меняется. Копится за действия и миссии, а тратится на
 * работу ядра — зрение, память, физику мира; те же способности продаются
 * снаружи по ключу (MAX API), и списываются они с этого же баланса.
 *
 * Формулировка здесь важнее оформления: панель раньше обещала «нельзя ни на
 * что обменять», а монеты теперь оплачивают реальную работу. Обещание должно
 * совпадать с тем, что происходит.
 *
 * Открыть: событие `mircoin:toggle` (клик по балансу в HUD или команда /коин).
 */

import { useEffect, useState } from 'react';
import { BookOpen, Coins, Info, X } from 'lucide-react';
import { useMirCoin } from '@/hooks/use-mircoin';
import { getApiPath } from '@/lib/max17-client';

interface Pricing {
  chat: Array<{ model: string; per_million_input: number; per_million_output: number }>;
  core: Array<{ endpoint: string; per_call: number }>;
}

/**
 * Ступени игрока по балансу.
 *
 * Порог — не про «богатство», а про то, что человеку доступно: на сотне монет
 * можно смотреть кадры, на тысяче — держать свой ключ к API. Названия ступеней
 * говорят именно об этом, а не о статусе ради статуса.
 */
const RANKS: Array<{ from: number; title: string; what: string }> = [
  { from: 100000, title: 'Архитектор', what: 'все способности ядра без оглядки на счёт' },
  { from: 10000, title: 'Создатель', what: 'зрение, сны и физика мира на потоке' },
  { from: 1000, title: 'Исследователь', what: 'хватит на свой ключ к MAX API' },
  { from: 100, title: 'Гость', what: 'можно смотреть кадры и говорить с ядром' },
  { from: 0, title: 'Наблюдатель', what: 'копи монеты за миссии — или возьми доступ' },
];

function rankOf(balance: number) {
  return RANKS.find((r) => balance >= r.from) || RANKS[RANKS.length - 1];
}

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
  const [docs, setDocs] = useState(false);
  const [pricing, setPricing] = useState<Pricing | null>(null);
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

  useEffect(() => {
    if (!docs || pricing) return;
    void fetch(getApiPath('/v1/models'))
      .then((r) => r.json())
      .then((d) => setPricing(d?.pricing ?? null))
      .catch(() => setPricing(null));
  }, [docs, pricing]);

  if (!open) return null;

  const rank = rankOf(balance);
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
          <div className="mt-2 inline-flex items-center gap-2 rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1">
            <span className="text-xs font-semibold tracking-wide text-amber-100">{rank.title}</span>
            <span className="text-[10px] text-amber-200/60">{rank.what}</span>
          </div>
        </div>

        <div className="mt-3 flex items-start gap-2 rounded-lg border border-white/10 bg-white/[0.03] p-2.5 text-[11px] text-white/50">
          <Info className="mt-0.5 h-3.5 w-3.5 flex-none text-sky-300/70" />
          <span>
            MIRCOIN — <b className="text-white/70">единица учёта внутри GAME</b>, не криптовалюта: не блокчейн, не токен, обратно в деньги не меняется.
            Копится за твои действия и миссии, а тратится на работу ядра — зрение, память, физику мира. У каждой монеты есть причина.
          </span>
        </div>

        <button
          type="button"
          onClick={() => setDocs((v) => !v)}
          className="mt-2 flex w-full items-center gap-2 rounded-lg border border-sky-400/25 bg-sky-400/[0.06] px-3 py-2 text-left text-xs text-sky-100 transition hover:bg-sky-400/[0.12]"
        >
          <BookOpen className="h-3.5 w-3.5 flex-none text-sky-300" />
          <span className="flex-1">На что тратится и сколько стоит</span>
          <span className="text-sky-300/60">{docs ? 'свернуть' : 'открыть'}</span>
        </button>

        {docs && (
          <div className="mt-2 space-y-2 rounded-lg border border-white/10 bg-white/[0.02] p-3 text-[11px] leading-relaxed text-white/60">
            <p>
              Ядро MAX умеет то, чего не умеет языковая модель: разбирать кадр математикой, узнавать увиденное,
              превращать его в состояние вселенной и видеть сны его цветами. Каждая такая работа стоит монет —
              столько, сколько она стоит на самом деле.
            </p>
            {!pricing && <p className="text-white/35">Загружаю тарифы…</p>}
            {pricing && (
              <>
                <div className="text-[10px] uppercase tracking-widest text-amber-300/60">Способности ядра · за вызов</div>
                {pricing.core.map((c) => (
                  <div key={c.endpoint} className="flex items-center gap-2">
                    <span className="font-mono text-white/70">{c.endpoint.replace('/v1/max/', '')}</span>
                    <span className="h-px flex-1 bg-white/10" />
                    <span className="font-mono text-amber-200">Ⓜ {c.per_call}</span>
                  </div>
                ))}
                <div className="pt-1 text-[10px] uppercase tracking-widest text-amber-300/60">Разговор · за миллион токенов</div>
                {pricing.chat.map((c) => (
                  <div key={c.model} className="flex items-center gap-2">
                    <span className="font-mono text-white/70">{c.model}</span>
                    <span className="h-px flex-1 bg-white/10" />
                    <span className="font-mono text-amber-200">Ⓜ {c.per_million_input} / {c.per_million_output}</span>
                  </div>
                ))}
              </>
            )}
            <p className="pt-1 text-white/45">
              Те же способности доступны снаружи по ключу — это <b className="text-white/70">MAX API</b>. Ключ выдаёт владелец,
              монеты списываются с того же баланса, а каждый вызов остаётся в журнале: видно, за что ушла каждая монета.
            </p>
          </div>
        )}

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
