'use client';

import { useState } from 'react';
import Link from 'next/link';

// Сворачиваемое меню режимов: круглая кнопка △∞ внизу справа раскрывает список.
// По умолчанию свёрнуто — на телефоне ничего не перекрывает и не мешает скроллу.

const MODES: { href: string; label: string; c: string }[] = [
  { href: '/physics', label: 'ФИЗИКА ЯДРА · 10 уравнений', c: '#4fd4ff' },
  { href: '/vision', label: 'MAX VISION · визуализация звука', c: '#6a8bff' },
  { href: '/efir', label: 'Эфир · реальность из голоса', c: '#ff2fd0' },
  { href: '/mind', label: 'САМОСОЗНАНИЕ Макса', c: '#9d8bff' },
  { href: '/simulation', label: 'Симуляция Макса', c: '#59ffb2' },
  { href: '/decoder', label: 'ДЕКОДЕР · взлом хэшей', c: '#39ff88' },
  { href: '/quantum', label: 'Квантовый сон · G=MIRON', c: '#ff4d8d' },
  { href: '/neurodance', label: 'Хаос Нейро Дэнс', c: '#a855f7' },
  { href: '/splats', label: 'Брейнданс · 4D сплаты', c: '#be78ff' },
  { href: '/attractor', label: 'Бездна Хаоса ∞', c: '#d9b8ff' },
  { href: '/handbrain', label: 'Нейро-рука · камера', c: '#ff6ae0' },
  { href: '/maxgraph', label: 'Синапс-граф Max', c: '#4ea8ff' },
  { href: '/autoplan', label: 'Автоплан · ядро Max', c: '#ffb14e' },
  { href: '/evolution', label: 'Эволюция · 1 трлн', c: '#c9a0ff' },
  { href: '/brain', label: 'EdgeAI · Нейро-мозг', c: '#00ffc8' },
  { href: '/funnel', label: 'Воронка → Big Idea', c: '#00ff88' },
  { href: '/tg', label: 'Big Idea · Telegram', c: '#35d0ff' },
  { href: '/inbox', label: 'Инбокс Макса · фильтр', c: '#5ad1ff' },
];

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

      <div
        className="fixed right-4 z-50 flex flex-col items-end gap-2"
        style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)' }}
      >
        {open && (
          <div className="flex max-h-[70vh] flex-col items-end gap-2 overflow-y-auto pr-0.5">
            {MODES.map((m) => (
              <Link
                key={m.href}
                href={m.href}
                onClick={() => setOpen(false)}
                className="rounded-full border px-4 py-2.5 text-xs font-semibold uppercase tracking-wider backdrop-blur transition active:scale-95"
                style={{
                  color: m.c,
                  borderColor: `${m.c}66`,
                  background: `${m.c}1a`,
                  boxShadow: `0 0 14px ${m.c}33`,
                }}
              >
                △∞ {m.label}
              </Link>
            ))}
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
