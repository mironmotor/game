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
 * Текст — только через словарь (lib/i18n/messages.ts, ключи support.*): панель
 * висит в корневом layout и открывается человеку на любом языке мира.
 */

import { useCallback, useEffect, useState } from 'react';
import { Check, Copy, Heart, X } from 'lucide-react';
import { useI18n } from '@/components/I18nProvider';
import type { MessageKey } from '@/lib/i18n/messages';

type Method = {
  id: string;
  /**
   * Название сети. Бренды («USDT · TRC20») одинаковы на всех языках и живут
   * прямо здесь; человеческие подписи вроде «Карта · МИР» берутся из словаря.
   */
  label: string;
  labelKey?: MessageKey;
  hintKey?: MessageKey;
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
    hintKey: 'support.hintTrc20',
    address: 'TFhTrmkobKkRVN69nGWfopMmKnawz9YJoW',
  },
  {
    id: 'usdt-ton',
    label: 'USDT · TON',
    hintKey: 'support.hintTon',
    address: 'EQBVXzBT4lcTA3S7gxrg4hnl5fnsDKj4oNEzNp09aQxkwj1f',
    tag: '2228062',
  },
  {
    id: 'usdt-erc20',
    label: 'USDT · ERC20',
    hintKey: 'support.hintErc20',
    address: '0x92ac204889a8c31ac02c2bbf553c0cde0a9a6c8e',
  },
  {
    id: 'btc',
    label: 'Bitcoin',
    hintKey: 'support.hintBtc',
    address: 'bc1qjkrzttzznt9u5ag6xweke2sdwtyss48pnurcqx',
  },
  {
    id: 'eth',
    label: 'Ethereum',
    hintKey: 'support.hintEth',
    address: '0xbb031A5b10DFD3Ec3Be4D861427C64ca8fe0e8B6',
  },
  {
    id: 'gram-ton',
    label: 'GRAM · TON',
    hintKey: 'support.hintTonPlain',
    address: 'UQBAQmkD2UN1Y2gmDvwSB0NyEn97n-fs-XpZJiIDkRMjzhCd',
  },
  {
    id: 'card',
    label: 'Карта · МИР',
    labelKey: 'support.cardLabel',
    hintKey: 'support.hintCard',
    address: '2204240226683946',
  },
];

export default function SupportPanel() {
  const { t } = useI18n();
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
      {/* Вертикальная вкладка у правого края. Вся геометрия — в классе
          .support-tab (app/globals.css): точка переключения обязана совпадать с
          телефонной раскладкой HUD (700px), а sm: у Tailwind срабатывает на
          640px. Инлайновый style с right убран не для красоты: он по правилам
          каскада выигрывал у sm:[right:0px], и десктопное правило было мёртвым
          (заметно на айфоне боком, где safe-area-inset-right = 44px). */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={t('support.tabTitle')}
        // Подпись дублируем в aria-label: на низком экране .support-tab-label
        // скрыт, и без него у кнопки не осталось бы имени.
        aria-label={t('support.tabTitle')}
        className="support-tab fixed z-[52] flex items-center justify-center rounded-lg bg-gradient-to-b from-rose-600 to-rose-700 px-1.5 py-3.5 text-white shadow-[0_0_24px_rgba(225,29,72,0.35)] transition hover:from-rose-500 hover:to-rose-600"
      >
        <span
          className="flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.2em]"
          style={{ writingMode: 'vertical-rl' }}
        >
          <Heart className="h-3 w-3 rotate-90" />
          <span className="support-tab-label">{t('support.tab')}</span>
        </span>
      </button>

      {!open ? null : (
        <div className="fixed inset-0 z-[67] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <div className="max-h-[90vh] w-[min(560px,100%)] overflow-y-auto rounded-2xl border border-rose-400/25 bg-gradient-to-b from-[#180a10]/95 to-[#0a0508]/95 p-5 shadow-[0_0_50px_rgba(225,29,72,0.15)]">
            <div className="flex items-center gap-2">
              <Heart className="h-4 w-4 text-rose-300" />
              <span className="text-sm font-semibold tracking-[0.18em] text-rose-100">{t('support.title')}</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="ml-auto rounded-lg p-1 text-white/40 transition hover:bg-white/10 hover:text-white/80"
                aria-label={t('common.close')}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <p className="mt-3 text-[13px] leading-relaxed text-white/70">{t('support.intro')}</p>

            {methods.length === 0 ? (
              // Имена файла и константы подставляем параметрами, а не разрезаем
              // фразу на куски: у переводчика должно оставаться целое предложение.
              <div className="mt-4 rounded-xl border border-amber-400/25 bg-amber-400/[0.06] p-3 text-[12px] leading-relaxed text-amber-100/85">
                {t('support.empty', {
                  file: 'components/SupportPanel.tsx',
                  list: 'SUPPORT_METHODS',
                })}
              </div>
            ) : (
              <div className="mt-4 space-y-2">
                {methods.map((m) => (
                  <div key={m.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                    <div className="flex items-baseline gap-2">
                      <span className="text-[12px] font-semibold text-white/90">
                        {m.labelKey ? t(m.labelKey) : m.label}
                      </span>
                      {m.hintKey && <span className="text-[10px] text-white/35">{t(m.hintKey)}</span>}
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
                          <span className="flex items-center gap-1"><Check className="h-3 w-3" /> {t('support.copied')}</span>
                        ) : (
                          <span className="flex items-center gap-1"><Copy className="h-3 w-3" /> {t('support.copy')}</span>
                        )}
                      </button>
                    </div>
                    {m.tag && (
                      // Без memo/tag перевод на биржевой адрес не зачисляется —
                      // поэтому он вынесен отдельно и подсвечен.
                      <div className="mt-2 flex items-center gap-2 rounded-lg border border-amber-400/35 bg-amber-400/[0.08] px-2.5 py-1.5">
                        <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-amber-200">
                          ⚠ {t('support.tagLabel')}
                        </span>
                        <code className="min-w-0 flex-1 font-mono text-[12px] font-semibold text-amber-50">{m.tag}</code>
                        <button
                          type="button"
                          onClick={() => void copyText(`${m.id}-tag`, m.tag as string)}
                          className="shrink-0 rounded-md bg-amber-400/25 px-2 py-1 text-[10px] font-semibold text-amber-50 transition hover:bg-amber-400/40"
                        >
                          {copied === `${m.id}-tag` ? '✓' : t('support.copy')}
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            <p className="mt-4 border-t border-white/10 pt-3 text-[10px] leading-relaxed text-white/35">
              {t('support.disclaimer')}
            </p>
          </div>
        </div>
      )}
    </>
  );
}
