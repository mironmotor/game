'use client';

import { useEffect } from 'react';

// Регистрирует service worker (PWA). BasePath учитывается для статик-экспорта.
export default function RegisterSW() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const base = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
    navigator.serviceWorker.register(`${base}/sw.js`).catch(() => {
      /* оффлайн-кэш опционален — молча пропускаем (например, в dev) */
    });
  }, []);
  return null;
}
