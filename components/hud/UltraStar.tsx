'use client';

/**
 * UltraStar — светило ультра-режима, живущее прямо в сцене с планетами.
 *
 * Кликом ядро получает внеочередной такт `ultra_think`: обычно он приходит раз
 * в минуту сам, но иногда человек хочет разбудить MAX прямо сейчас. Кнопка
 * лежит поверх орбит и намеренно не выглядит кнопкой — это объект сцены.
 *
 * Само действие исполняет HudApp: у него есть канал к ядру. Здесь только
 * событие, чтобы фон не тянул за собой сетевой слой.
 */

import { useEffect, useState } from 'react';
import { isRainbowOn, setRainbow } from './rainbow';

type Phase = 'idle' | 'thinking' | 'done';

export function UltraStar() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [note, setNote] = useState('');

  // Ответ приходит асинхронно: HudApp сообщает, чем кончился такт.
  useEffect(() => {
    const onResult = (e: Event) => {
      const detail = (e as CustomEvent<{ ok?: boolean; note?: string }>).detail || {};
      setPhase('done');
      setNote(String(detail.note || (detail.ok ? 'такт прошёл' : 'ядро не ответило')).slice(0, 90));
      const t = window.setTimeout(() => setPhase('idle'), 6000);
      return () => window.clearTimeout(t);
    };
    window.addEventListener('max:ultra-result', onResult as EventListener);
    return () => window.removeEventListener('max:ultra-result', onResult as EventListener);
  }, []);

  const wake = () => {
    if (phase === 'thinking') return;
    setPhase('thinking');
    setNote('');
    // Радуга — визуальный признак того, что ультра поднят. Если человек уже
    // включил её сам, не трогаем: это его выбор, а не наш индикатор.
    if (!isRainbowOn()) setRainbow(true);
    window.dispatchEvent(new CustomEvent('max:ultra'));
  };

  return (
    <button
      type="button"
      onClick={wake}
      className={`ultra-star ultra-star--${phase}`}
      aria-label="Разбудить MAX ULTRA"
      title="MAX ULTRA — внеочередной такт ядра"
    >
      <span className="ultra-star-orb" aria-hidden="true" />
      <span className="ultra-star-ring" aria-hidden="true" />
      <span className="ultra-star-label">
        <span className="ultra-star-name">MAX ULTRA</span>
        <span className="ultra-star-sub">
          {phase === 'thinking' ? 'ядро думает…' : phase === 'done' ? note : 'preAGI'}
        </span>
      </span>
    </button>
  );
}
