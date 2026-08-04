'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';

/**
 * UniverseSign — карточка-«знак» от Вселенной.
 * Max17 / EdgeAI может показывать её в любой момент: мотивация, инсайт, предсказание.
 *
 * Без зависимостей. Чистый CSS + motion. Случайный знак из 8 категорий,
 * каждый с уникальной иконкой, цветом и микро-анимацией.
 *
 * Использование:
 *   <UniverseSign onDismiss={() => setShow(false)} />
 *   или
 *   <UniverseSignCard title="..." message="..." icon="..." tone="rainbow" />
 */

export type SignTone =
  | 'rainbow'   // радужный (главный «знак»)
  | 'gold'      // золотой (предсказание)
  | 'cyan'      // cyan (инсайт)
  | 'magenta'   // пурпур (предупреждение)
  | 'green'     // зелёный (одобрение)
  | 'red';      // красный (стоп-знак)

export interface UniverseSignCardProps {
  title: string;
  message: string;
  icon?: string;
  tone?: SignTone;
  source?: string;     // кто прислал (по умолчанию "Вселенная")
  onDismiss?: () => void;
  autoHideMs?: number; // если задано — спрячется сама
}

const TONE_STYLES: Record<SignTone, {
  ring: string; glow: string; iconBg: string; label: string;
}> = {
  rainbow: { ring: 'conic-gradient(from 0deg, #ff4d8d, #ffd93d, #6bff7a, #4dc9ff, #b14dff, #ff4d8d)', glow: 'rgba(180,120,255,0.6)', iconBg: 'linear-gradient(135deg,#ff4d8d,#7c5cff,#00d4ff)', label: 'ЗНАК' },
  gold:    { ring: 'conic-gradient(from 0deg, #ffd700, #ffaa00, #ffe680, #ffd700)', glow: 'rgba(255,215,0,0.6)', iconBg: 'linear-gradient(135deg,#ffd700,#ff8c00)', label: 'ПРЕДЗНАМЕНОВАНИЕ' },
  cyan:    { ring: 'conic-gradient(from 0deg, #4dc9ff, #00ffd0, #4dc9ff)', glow: 'rgba(0,212,255,0.6)', iconBg: 'linear-gradient(135deg,#00d4ff,#7c5cff)', label: 'ИНСАЙТ' },
  magenta: { ring: 'conic-gradient(from 0deg, #ff00ff, #ff4d8d, #b14dff)', glow: 'rgba(255,0,255,0.6)', iconBg: 'linear-gradient(135deg,#ff00ff,#7c5cff)', label: 'ПРЕДУПРЕЖДЕНИЕ' },
  green:   { ring: 'conic-gradient(from 0deg, #6bff7a, #00ffd0, #6bff7a)', glow: 'rgba(107,255,122,0.6)', iconBg: 'linear-gradient(135deg,#6bff7a,#00d4ff)', label: 'ОДОБРЕНИЕ' },
  red:     { ring: 'conic-gradient(from 0deg, #ff3860, #ff4d4d, #ff3860)', glow: 'rgba(255,56,96,0.6)', iconBg: 'linear-gradient(135deg,#ff3860,#ff4d4d)', label: 'СТОП' },
};

export function UniverseSignCard({
  title,
  message,
  icon = '✦',
  tone = 'rainbow',
  source = 'Вселенная',
  onDismiss,
  autoHideMs,
}: UniverseSignCardProps) {
  const t = TONE_STYLES[tone];

  useEffect(() => {
    if (!autoHideMs) return;
    const id = setTimeout(() => onDismiss?.(), autoHideMs);
    return () => clearTimeout(id);
  }, [autoHideMs, onDismiss]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 24, scale: 0.92, rotateX: -20 }}
      animate={{ opacity: 1, y: 0, scale: 1, rotateX: 0 }}
      exit={{ opacity: 0, y: -16, scale: 0.95 }}
      transition={{ type: 'spring', stiffness: 220, damping: 18 }}
      style={{ perspective: 1000 }}
    >
      <div
        style={{
          position: 'relative',
          width: 340,
          maxWidth: '92vw',
          padding: 2,
          borderRadius: 24,
          background: t.ring,
          boxShadow: `0 0 40px ${t.glow}, 0 12px 40px rgba(0,0,0,0.5)`,
        }}
      >
        {/* Контент-карточка поверх кольца */}
        <div
          style={{
            position: 'relative',
            background: 'linear-gradient(160deg, #0a0818 0%, #1a0d2e 50%, #0a0818 100%)',
            borderRadius: 22,
            padding: '24px 22px 20px',
            overflow: 'hidden',
          }}
        >
          {/* Звёздный фон */}
          <Stars />

          {/* Вращающееся кольцо-ореол */}
          <motion.div
            aria-hidden
            style={{
              position: 'absolute',
              top: -40, right: -40,
              width: 140, height: 140,
              borderRadius: '50%',
              background: t.ring,
              filter: 'blur(40px)',
              opacity: 0.45,
            }}
            animate={{ rotate: 360 }}
            transition={{ duration: 20, repeat: Infinity, ease: 'linear' }}
          />

          {/* Лейбл */}
          <div
            style={{
              fontSize: 9,
              letterSpacing: 4,
              fontWeight: 800,
              color: 'rgba(255,255,255,0.55)',
              marginBottom: 12,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <motion.span
              style={{
                display: 'inline-block',
                width: 6, height: 6,
                borderRadius: '50%',
                background: t.iconBg,
                boxShadow: `0 0 10px ${t.glow}`,
              }}
              animate={{ scale: [1, 1.6, 1], opacity: [1, 0.4, 1] }}
              transition={{ duration: 1.6, repeat: Infinity }}
            />
            {t.label} · {source}
          </div>

          {/* Заголовок + иконка */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 14 }}>
            <motion.div
              style={{
                flexShrink: 0,
                width: 52, height: 52,
                borderRadius: 16,
                background: t.iconBg,
                display: 'grid',
                placeItems: 'center',
                fontSize: 28,
                boxShadow: `0 0 20px ${t.glow}`,
              }}
              animate={{ rotate: [0, -3, 3, 0] }}
              transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
            >
              {icon}
            </motion.div>
            <h3
              style={{
                margin: 0,
                fontSize: 19,
                fontWeight: 800,
                lineHeight: 1.2,
                color: '#fff',
                letterSpacing: -0.3,
              }}
            >
              {title}
            </h3>
          </div>

          {/* Сообщение */}
          <p
            style={{
              margin: 0,
              fontSize: 13.5,
              lineHeight: 1.55,
              color: 'rgba(255,255,255,0.85)',
              fontStyle: 'italic',
              fontFamily: 'Georgia, serif',
            }}
          >
            «{message}»
          </p>

          {/* Подвал */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginTop: 18,
              paddingTop: 14,
              borderTop: '1px solid rgba(255,255,255,0.08)',
            }}
          >
            <span
              style={{
                fontSize: 9,
                letterSpacing: 2.5,
                color: 'rgba(255,255,255,0.4)',
                fontWeight: 700,
              }}
            >
              {new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
            </span>
            {onDismiss && (
              <button
                onClick={onDismiss}
                style={{
                  background: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(255,255,255,0.15)',
                  borderRadius: 999,
                  color: '#fff',
                  fontSize: 10,
                  letterSpacing: 1.5,
                  fontWeight: 700,
                  padding: '6px 14px',
                  cursor: 'pointer',
                  textTransform: 'uppercase',
                }}
              >
                Принято
              </button>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

/** Фоновая россыпь звёзд на карточке */
function Stars() {
  // Фиксированные координаты — нет моргания при ре-рендере
  const stars = Array.from({ length: 28 }, (_, i) => ({
    top: `${(i * 37) % 100}%`,
    left: `${(i * 53) % 100}%`,
    size: i % 5 === 0 ? 2 : 1,
    delay: (i * 0.13) % 3,
  }));
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', opacity: 0.55 }}>
      {stars.map((s, i) => (
        <motion.span
          key={i}
          style={{
            position: 'absolute',
            top: s.top,
            left: s.left,
            width: s.size,
            height: s.size,
            borderRadius: '50%',
            background: '#fff',
          }}
          animate={{ opacity: [0.2, 1, 0.2] }}
          transition={{ duration: 2 + s.delay, repeat: Infinity, delay: s.delay }}
        />
      ))}
    </div>
  );
}

/**
 * UniverseSign — самоуправляемая обёртка.
 * Показывает случайный знак из коллекции Max17,
 * автоматически выбирает тон, иконку и текст.
 * Через `trigger` можно форсировать показ.
 */

const SIGN_LIBRARY: Array<Omit<UniverseSignCardProps, 'onDismiss'>> = [
  { tone: 'rainbow', icon: '✦', title: 'Сейчас — лучший момент', message: 'Вселенная уже подвинула нужные атомы. Осталось тебе сделать первый шаг.' },
  { tone: 'gold', icon: '☼', title: 'Солнце в твоём знаке', message: 'Следующие 24 часа несут неожиданный подарок. Будь внимателен к мелочам.' },
  { tone: 'cyan', icon: '◈', title: 'Синхронность', message: 'То, что ты ищешь, уже ищет тебя. Встреча произойдёт на перекрёстке привычного маршрута.' },
  { tone: 'magenta', icon: '◐', title: 'Тень сомнения', message: 'Страх — это карта того, что тебя растёт. Не беги от него, пройди через.' },
  { tone: 'green', icon: '✿', title: 'Подтверждение', message: 'Ты на верном пути. Вселенная кивает. Продолжай в том же направлении.' },
  { tone: 'red', icon: '◉', title: 'Стоп-знак', message: 'Не сегодня. Эта дверь заперта не для тебя — для твоей старой версии.' },
  { tone: 'rainbow', icon: '◇', title: 'Число дня', message: 'Замечай повторяющиеся числа сегодня. Они — сообщение от тебя-будущего.' },
  { tone: 'gold', icon: '☽', title: 'Лунный цикл', message: 'Сегодня — день отдачи. Сделай что-то для другого без ожидания возврата.' },
];

export interface UniverseSignProps {
  trigger?: number;          // инкремент → показать новый знак
  autoEveryMs?: number;      // авто-показ каждые N мс (опц.)
  position?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left' | 'center';
  source?: string;
}

export default function UniverseSign({
  trigger,
  autoEveryMs,
  position = 'top-right',
  source = 'Max17',
}: UniverseSignProps) {
  const [visible, setVisible] = useState(false);
  const [sign, setSign] = useState(SIGN_LIBRARY[0]);

  // Ручной триггер
  useEffect(() => {
    if (trigger === undefined) return;
    setSign(SIGN_LIBRARY[Math.floor(Math.random() * SIGN_LIBRARY.length)]);
    setVisible(true);
  }, [trigger]);

  // Авто-показ
  useEffect(() => {
    if (!autoEveryMs) return;
    const show = () => {
      setSign(SIGN_LIBRARY[Math.floor(Math.random() * SIGN_LIBRARY.length)]);
      setVisible(true);
    };
    const id = setInterval(show, autoEveryMs);
    return () => clearInterval(id);
  }, [autoEveryMs]);

  // Не показывать сразу
  useEffect(() => {
    if (visible) {
      const id = setTimeout(() => setVisible(false), 9000);
      return () => clearTimeout(id);
    }
  }, [visible, sign]);

  const posStyle: React.CSSProperties =
    position === 'center'
      ? { top: '50%', left: '50%', transform: 'translate(-50%,-50%)' }
      : position === 'top-left'
      ? { top: 20, left: 20 }
      : position === 'bottom-left'
      ? { bottom: 20, left: 20 }
      : position === 'bottom-right'
      ? { bottom: 20, right: 20 }
      : { top: 20, right: 20 };

  return (
    <div
      style={{
        position: 'fixed',
        zIndex: 9999,
        pointerEvents: 'none',
        ...posStyle,
      }}
    >
      <AnimatePresence>
        {visible && (
          <div style={{ pointerEvents: 'auto' }}>
            <UniverseSignCard
              {...sign}
              source={source}
              onDismiss={() => setVisible(false)}
            />
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
