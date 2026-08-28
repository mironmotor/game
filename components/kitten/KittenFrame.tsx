'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { appBasePath } from '@/lib/base-path';

/**
 * Рамка с игрой и честный ответ, когда игры на месте нет.
 *
 * Адрес собирается через appBasePath, потому что iframe — обычный HTML-тег:
 * basePath Next подставляет только в next/link и next/image, а сюда — нет.
 * Локально сайт живёт на /game, и «/meowgotchi/index.html» уводил в 404 —
 * в рамке вместо котёнка открывалась страница «не найдено».
 */
const GAME_URL = `${appBasePath}/meowgotchi/index.html`;

export default function KittenFrame() {
  const [missing, setMissing] = useState(false);

  // Файл игры лежит в public/, а не в сборке, и на сервере его может не быть.
  // Тогда рамка молча показывает чужую 404-страницу, и по ней не понять, что
  // случилось: режим «не открывается» и всё. Спрашиваем адрес отдельно, чтобы
  // сказать прямо. Запрос идёт параллельно загрузке рамки — рабочий случай он
  // не задерживает, а HEAD не тянет лишние четверть мегабайта.
  useEffect(() => {
    let alive = true;
    fetch(GAME_URL, { method: 'HEAD' })
      .then((r) => {
        if (alive && !r.ok) setMissing(true);
      })
      .catch(() => {
        if (alive) setMissing(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  if (missing) {
    return (
      <main className="fixed inset-0 flex flex-col items-center justify-center gap-4 bg-[#ffe7f3] px-6 text-center text-[#5b2740]">
        <div className="text-5xl">🐾</div>
        <h1 className="text-xl font-semibold">Котёнка здесь нет</h1>
        <p className="max-w-md text-sm leading-relaxed opacity-80">
          Игра не отвечает по адресу <code className="rounded bg-white/60 px-1">{GAME_URL}</code>.
          Она лежит одним файлом в <code className="rounded bg-white/60 px-1">public/meowgotchi/</code>{' '}
          и должна попасть на сервер вместе со сборкой — пока её там нет, режим открыть нечем.
        </p>
        <Link href="/modes" className="text-sm underline underline-offset-4">
          ← к остальным режимам
        </Link>
      </main>
    );
  }

  return (
    <iframe
      src={GAME_URL}
      title="Мяугочи"
      className="fixed inset-0 h-full w-full border-0 bg-[#ffe7f3]"
      // Скриптам игры сюда нужен доступ к своему localStorage — иначе котёнок
      // забывал бы имя и голод при каждом заходе.
      sandbox="allow-scripts allow-same-origin allow-popups allow-modals"
      allow="autoplay"
    />
  );
}
