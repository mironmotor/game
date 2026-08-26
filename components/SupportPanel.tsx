'use client';

/**
 * SupportPanel — «Поддержать». Вертикальная вкладка у правого края + панель с
 * реквизитами. GAME делается одним человеком и раздаётся бесплатно, поэтому
 * поддержка — добровольная и без всякого давления.
 *
 * ⚠️ АДРЕСА КРИПТЫ ЗАПОЛНЯЕТ ВЛАДЕЛЕЦ (см. SUPPORT_METHODS ниже). Пустые записи
 * просто не показываются — пока адрес не вписан, его в панели не будет.
 * Проверяй адрес символ в символ: ошибка в одном знаке = деньги ушли в никуда.
 *
 * Слои: вкладка 52 (уровень обвязки), панель 67 (выше HUD, ниже полноэкранных).
 */

import { useCallback, useEffect, useState } from 'react';
import { Check, Copy, Heart, X } from 'lucide-react';

type Method = {
  id: string;
  label: string;
  hint?: string;
  /** Адрес/реквизит. Пусто → пункт скрыт. */
  address: string;
  /** Memo/tag — БЕЗ него перевод на биржевой адрес теряется. */
  tag?: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// РЕКВИЗИТЫ. Пустые строки не отображаются.
// Форматы проверены (длина + структура сети, карта — по алгоритму Луна).
// ─────────────────────────────────────────────────────────────────────────────
const SUPPORT_METHODS: Method[] = [
  {
    id: 'usdt-trc20',
    label: 'USDT · TRC20',
    hint: 'сеть Tron — самая дешёвая комиссия',
    address: 'TFhTrmkobKkRVN69nGWfopMmKnawz9YJoW',
  },
  {
    id: 'usdt-ton',
    label: 'USDT · TON',
    hint: 'сеть TON — ОБЯЗАТЕЛЬНО укажи tag',
    address: 'EQBVXzBT4lcTA3S7gxrg4hnl5fnsDKj4oNEzNp09aQxkwj1f',
    tag: '2228062',
  },
  {
    id: 'usdt-erc20',
    label: 'USDT · ERC20',
    hint: 'сеть Ethereum',
    address: '0x92ac204889a8c31ac02c2bbf553c0cde0a9a6c8e',
  },
  {
    id: 'btc',
    label: 'Bitcoin',
    hint: 'сеть Bitcoin (bech32)',
    address: 'bc1qjkrzttzznt9u5ag6xweke2sdwtyss48pnurcqx',
  },
  {
    id: 'eth',
    label: 'Ethereum',
    hint: 'сеть Ethereum (ETH)',
    address: '0xbb031A5b10DFD3Ec3Be4D861427C64ca8fe0e8B6',
  },
  {
    id: 'gram-ton',
    label: 'GRAM · TON',
    hint: 'сеть TON',
    address: 'UQBAQmkD2UN1Y2gmDvwSB0NyEn97n-fs-XpZJiIDkRMjzhCd',
  },
  {
    id: 'card',
    label: 'Карта · МИР',
    hint: 'перевод по номеру карты',
    address: '2204240226683946',
  },
];

const INTRO =
  'GAME и ядро MAX делает один человек, и всё это раздаётся бесплатно. ' +
  'Если проект оказался тебе полезен — можешь поддержать. Это добровольно и ни на что не влияет: ' +
  'все функции остаются открытыми для всех.';

export default function SupportPanel() {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const methods = SUPPORT_METHODS.filter((m) => m.address.trim());

  const copyText = useCallback(async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value.trim());
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1800);
    } catch {
      /* буфер недоступен — человек скопирует вручную, реквизит виден целиком */
    }
  }, []);
  const copy = useCallback((m: Method) => void copyText(m.id, m.address), [copyText]);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    const onToggle = () => setOpen((v) => !v);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('support:open', onOpen);
    window.addEventListener('support:toggle', onToggle);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('support:open', onOpen);
      window.removeEventListener('support:toggle', onToggle);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  return (
    <>
      {/* вертикальная вкладка у правого края */}
      {/* На телефоне вкладку отодвигаем от края: у края её режет скругление
          экрана/безопасная зона, и она наезжает на окно чата. На телефоне
          привязка была к проценту высоты (top-38%) — а высота вьюпорта там
          меняется, когда адресная строка сворачивается, и кнопка уезжала.
          Теперь на мобильном это фиксированный отступ от низа, над нижней
          навигацией HUD; на десктопе — по центру у самого края. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Поддержать проект"
        style={{ right: 'env(safe-area-inset-right, 0px)' }}
        className="fixed bottom-[calc(env(safe-area-inset-bottom,0px)+188px)] z-[52] rounded-lg bg-gradient-to-b from-rose-600 to-rose-700 px-1 py-3.5 sm:px-1.5 text-white shadow-[0_0_24px_rgba(225,29,72,0.35)] transition hover:from-rose-500 hover:to-rose-600 sm:bottom-auto sm:top-1/2 sm:-translate-y-1/2 sm:rounded-l-lg sm:rounded-r-none sm:py-4 sm:[right:0px]"
      >
        <span
          className="flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.2em] sm:text-[10px] sm:tracking-[0.22em]"
          style={{ writingMode: 'vertical-rl' }}
        >
          <Heart className="h-3 w-3 rotate-90" />
          Поддержать
        </span>
      </button>

      {!open ? null : (
        <div className="fixed inset-0 z-[67] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <div className="max-h-[90vh] w-[min(560px,100%)] overflow-y-auto rounded-2xl border border-rose-400/25 bg-gradient-to-b from-[#180a10]/95 to-[#0a0508]/95 p-5 shadow-[0_0_50px_rgba(225,29,72,0.15)]">
            <div className="flex items-center gap-2">
              <Heart className="h-4 w-4 text-rose-300" />
              <span className="text-sm font-semibold tracking-[0.18em] text-rose-100">ПОДДЕРЖАТЬ GAME</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="ml-auto rounded-lg p-1 text-white/40 transition hover:bg-white/10 hover:text-white/80"
                aria-label="Закрыть"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <p className="mt-3 text-[13px] leading-relaxed text-white/70">{INTRO}</p>

            {methods.length === 0 ? (
              <div className="mt-4 rounded-xl border border-amber-400/25 bg-amber-400/[0.06] p-3 text-[12px] leading-relaxed text-amber-100/85">
                Реквизиты пока не добавлены. Владельцу: вписать адреса в
                <code className="mx-1 rounded bg-black/40 px-1.5 py-0.5 text-[11px]">components/SupportPanel.tsx</code>
                → <code className="rounded bg-black/40 px-1.5 py-0.5 text-[11px]">SUPPORT_METHODS</code>.
              </div>
            ) : (
              <div className="mt-4 space-y-2">
                {methods.map((m) => (
                  <div key={m.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                    <div className="flex items-baseline gap-2">
                      <span className="text-[12px] font-semibold text-white/90">{m.label}</span>
                      {m.hint && <span className="text-[10px] text-white/35">{m.hint}</span>}
                    </div>
                    <div className="mt-1.5 flex items-center gap-2">
                      <code className="min-w-0 flex-1 truncate rounded-lg bg-black/45 px-2.5 py-1.5 font-mono text-[11px] text-rose-100/90">
                        {m.address}
                      </code>
                      <button
                        type="button"
                        onClick={() => void copy(m)}
                        className="shrink-0 rounded-lg bg-rose-500/25 px-2.5 py-1.5 text-[11px] font-semibold text-rose-50 transition hover:bg-rose-500/40"
                      >
                        {copied === m.id ? (
                          <span className="flex items-center gap-1"><Check className="h-3 w-3" /> скопировано</span>
                        ) : (
                          <span className="flex items-center gap-1"><Copy className="h-3 w-3" /> копировать</span>
                        )}
                      </button>
                    </div>
                    {m.tag && (
                      // Без memo/tag перевод на биржевой адрес не зачисляется —
                      // поэтому он вынесен отдельно и подсвечен.
                      <div className="mt-2 flex items-center gap-2 rounded-lg border border-amber-400/35 bg-amber-400/[0.08] px-2.5 py-1.5">
                        <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-amber-200">
                          ⚠ tag / memo
                        </span>
                        <code className="min-w-0 flex-1 font-mono text-[12px] font-semibold text-amber-50">{m.tag}</code>
                        <button
                          type="button"
                          onClick={() => void copyText(`${m.id}-tag`, m.tag as string)}
                          className="shrink-0 rounded-md bg-amber-400/25 px-2 py-1 text-[10px] font-semibold text-amber-50 transition hover:bg-amber-400/40"
                        >
                          {copied === `${m.id}-tag` ? '✓' : 'копировать'}
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            <p className="mt-4 border-t border-white/10 pt-3 text-[10px] leading-relaxed text-white/35">
              Перед отправкой сверь адрес и сеть — перевод в криптовалюте необратим, ошибка в одном
              символе или не та сеть означают потерю средств. Поддержка добровольная, это не оплата
              услуг и не даёт дополнительных функций.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
