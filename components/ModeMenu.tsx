'use client';

import { useState } from 'react';
import Link from 'next/link';
import { MODES } from '@/lib/modes-catalog';

// Сворачиваемое меню режимов: круглая кнопка △∞ внизу справа раскрывает список.
// По умолчанию свёрнуто — на телефоне ничего не перекрывает и не мешает скроллу.
//
// Список общий с витриной /modes (lib/modes-catalog): раньше он был выписан
// здесь копией, и новый режим появлялся либо в меню, либо на витрине.

export default function ModeMenu() {
  const [open, setOpen] = useState(false);

  return (
    <>
      {open && (
        <button
          type="button"
          aria-label="Закрыть меню режимов"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[2px]"
        />
      )}

      <div className="hud-mobile-floor fixed right-4 z-50 flex flex-col items-end gap-2">
        {open && (
          <div className="flex max-h-[70vh] flex-col items-end gap-2 overflow-y-auto pr-0.5">
            {/* Витрина первой: с неё видно и режимы, и команды ядра разом. */}
            <Link
              href="/modes"
              onClick={() => setOpen(false)}
              className="rounded-full border border-white/60 bg-white/15 px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-white backdrop-blur transition active:scale-95"
            >
              ▦ Все режимы
            </Link>
            {MODES.map((m) => (
              <Link
                key={m.href}
                href={m.href}
                onClick={() => setOpen(false)}
                className="rounded-full border px-4 py-2.5 text-xs font-semibold uppercase tracking-wider backdrop-blur transition active:scale-95"
                style={{
                  color: m.color,
                  borderColor: `${m.color}66`,
                  background: `${m.color}1a`,
                  boxShadow: `0 0 14px ${m.color}33`,
                }}
              >
                △∞ {m.label}
              </Link>
            ))}
            {/* На телефоне fixed-ссылка внизу экрана ложилась поверх навбара и
                была ненажимаемой; здесь она доступна и никому не мешает. */}
            <Link
              href="/privacy"
              onClick={() => setOpen(false)}
              className="rounded-full border border-white/15 px-4 py-2.5 text-[10px] font-medium uppercase tracking-wider text-white/45 backdrop-blur transition active:scale-95 sm:hidden"
            >
              Политика конфиденциальности
            </Link>
          </div>
        )}

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? 'Свернуть меню режимов' : 'Открыть меню режимов'}
          aria-expanded={open}
          className={`flex h-14 w-14 items-center justify-center rounded-full border text-lg backdrop-blur-md transition active:scale-95 ${
            open
              ? 'rotate-45 border-white/60 bg-white/15 text-white'
              : 'border-[#00f2ff]/50 bg-[#0a0818]/80 text-[#00f2ff] shadow-[0_0_24px_rgba(0,242,255,0.35)]'
          }`}
        >
          {open ? '✕' : '△∞'}
        </button>
      </div>
    </>
  );
}
