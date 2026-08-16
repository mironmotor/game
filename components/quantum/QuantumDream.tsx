'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'motion/react';
import DreamSim3D from './DreamSim3D';
import AvatarCanvas from '@/components/agent/AvatarCanvas';
import { type SimDef, SIMS, mulberry32 } from '@/lib/dream-sims';
import { type AvatarConfig, DEFAULT_AVATAR, loadAvatar, palette } from '@/lib/agent-avatar';

/**
 * QuantumDream — «сон» Макса.
 *
 * Раньше кадры были нарисованными иллюстрациями идеи: синусоида, спираль,
 * россыпь точек. Теперь каждый кадр — работающая симуляция из `lib/dream-sims`:
 * Лоренц, гравитация, стая, интерференция, галактика, орбиталь. Ничего не
 * анимируется «под физику» — физика считается, а картинка её показывает.
 *
 * Резонанс G = MIRON остался: 5-мерный вектор состояния сна сравнивается с
 * зашитым вектором MIRON. Он управляет яркостью — то есть у числа есть
 * видимое следствие, а не только подпись.
 */

interface DreamFrame {
  id: number;
  def: SimDef;
  resonance: number;
  seed: number;
}

const MIRON = [0.93, 0.71, 0.42, 0.86, 0.55];

function makeFrame(seed: number, idx: number): DreamFrame {
  const r = mulberry32(seed);
  const def = SIMS[idx % SIMS.length];
  const v = Array.from({ length: 5 }, () => r() * 2 - 1);
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < 5; i++) {
    dot += v[i] * MIRON[i];
    na += v[i] * v[i];
    nb += MIRON[i] * MIRON[i];
  }
  const resonance = Math.max(0.15, Math.min(1, dot / (Math.sqrt(na) * Math.sqrt(nb))));
  return { id: seed, def, resonance, seed };
}

export default function QuantumDream() {
  const [frames] = useState<DreamFrame[]>(() =>
    SIMS.map((_, i) => makeFrame(1000 + i * 137, i)),
  );
  const [active, setActive] = useState(0);
  const [running, setRunning] = useState(true);
  const [auto, setAuto] = useState(true);
  const [avatar, setAvatar] = useState<AvatarConfig>(DEFAULT_AVATAR);
  const [mounted, setMounted] = useState(false);
  const touchX = useRef(0);

  useEffect(() => {
    setAvatar(loadAvatar());
    setMounted(true);
    const onAvatar = () => setAvatar(loadAvatar());
    window.addEventListener('max17:avatar', onAvatar);
    return () => window.removeEventListener('max17:avatar', onAvatar);
  }, []);

  // Автосмена — 18 секунд: симуляции успевают выйти на характерный режим.
  // Прежние 4 секунды показывали только переходный процесс.
  useEffect(() => {
    if (!auto || !running) return;
    const id = setInterval(() => setActive((a) => (a + 1) % frames.length), 18000);
    return () => clearInterval(id);
  }, [auto, running, frames.length]);

  const current = frames[active];
  const pal = useMemo(() => palette(avatar), [avatar]);
  const resonancePct = Math.round(current.resonance * 100);

  const go = (delta: number) => {
    setAuto(false);
    setActive((a) => (a + delta + frames.length) % frames.length);
  };

  return (
    <main
      className="fixed inset-0 flex flex-col overflow-hidden text-white"
      style={{ background: `radial-gradient(ellipse at center, ${pal.deep} 0%, #000 78%)`, fontFamily: 'system-ui, sans-serif' }}
      onTouchStart={(e) => { touchX.current = e.touches[0].clientX; }}
      onTouchEnd={(e) => {
        const dx = e.changedTouches[0].clientX - touchX.current;
        if (Math.abs(dx) > 60) go(dx < 0 ? 1 : -1);
      }}
    >
      {/* ── шапка ─────────────────────────────────────────────────────────── */}
      <header className="z-10 flex items-start justify-between px-5 pb-2 pt-5">
        <div>
          <h1
            className="m-0 text-[22px] font-extrabold tracking-wide"
            style={{ background: `linear-gradient(90deg, ${pal.main}, ${pal.accent})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}
          >
            КВАНТОВЫЙ СОН
          </h1>
          <p className="m-0 mt-1 text-[10px] font-bold uppercase tracking-[3px] opacity-50">
            6 симуляций · спит {avatar.name}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setRunning((v) => !v)}
            className="rounded-full border border-white/15 bg-white/5 px-3.5 py-1.5 text-[10px] font-bold uppercase tracking-[2px] active:scale-95"
          >
            {running ? '⏸ Пауза' : '▶ Сон'}
          </button>
          <Link
            href="/modes"
            className="rounded-full border px-3.5 py-1.5 text-[10px] font-bold uppercase tracking-[2px] active:scale-95"
            style={{ color: pal.accent, borderColor: `${pal.accent}55`, background: `${pal.accent}15` }}
          >
            △∞
          </Link>
        </div>
      </header>

      {/* ── сцена ─────────────────────────────────────────────────────────── */}
      <div className="relative grid flex-1 place-items-center">
        <DreamSim3D
          def={current.def}
          seed={current.seed}
          hue={avatar.hue}
          accentHue={avatar.accent}
          running={running}
          intensity={current.resonance}
          size={560}
        />

        <AnimatePresence mode="wait">
          <motion.div
            key={current.id}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            transition={{ duration: 0.5 }}
            className="pointer-events-none absolute inset-x-6 top-2 text-center"
          >
            <div className="mb-1.5 text-[11px] font-extrabold tracking-[4px] text-white/60">
              {current.def.title}
            </div>
            <div className="mx-auto max-w-[480px] font-serif text-[13px] italic text-white/85">
              «{current.def.caption}»
            </div>
          </motion.div>
        </AnimatePresence>

        {/* Спящий агент — тот самый облик, что настроен в /agent. */}
        {mounted && (
          <Link
            href="/agent"
            className="absolute bottom-3 left-3 opacity-70 transition hover:opacity-100"
            title="Настроить облик"
          >
            <AvatarCanvas config={avatar} size={84} listening />
          </Link>
        )}

        <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 text-center">
          <div
            className="font-serif text-[26px] font-extrabold tracking-wider"
            style={{ background: `linear-gradient(90deg,#ffd700, ${pal.main}, ${pal.accent})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}
          >
            G = MIRON
          </div>
          <div className="mt-0.5 text-[10px] font-bold tracking-[3px] opacity-50">
            РЕЗОНАНС · {resonancePct}%
          </div>
        </div>
      </div>

      {/* ── лента симуляций ───────────────────────────────────────────────── */}
      <div className="bg-gradient-to-t from-black/80 to-transparent px-4 pb-6 pt-3">
        <div className="mb-2.5 flex items-center justify-between">
          <span className="text-[9px] font-bold tracking-[3px] opacity-40">
            СНЫ · {frames.length} СИМУЛЯЦИИ
          </span>
          <button
            type="button"
            onClick={() => setAuto((v) => !v)}
            className="text-[9px] font-bold tracking-[2px] opacity-50 active:scale-95"
          >
            {auto ? 'АВТО ВКЛ' : 'АВТО ВЫКЛ'}
          </button>
        </div>
        <div className="flex gap-2.5 overflow-x-auto pb-1.5 [scrollbar-width:none]">
          {frames.map((f, i) => {
            const on = i === active;
            return (
              <motion.button
                key={f.id}
                type="button"
                whileTap={{ scale: 0.95 }}
                onClick={() => { setAuto(false); setActive(i); }}
                className="flex h-[92px] w-[104px] shrink-0 flex-col justify-between rounded-xl border p-2 text-left"
                style={{
                  borderColor: on ? `${pal.main}cc` : 'rgba(255,255,255,0.1)',
                  background: on ? `${pal.main}22` : 'rgba(255,255,255,0.04)',
                  boxShadow: on ? `0 0 20px ${pal.main}44` : 'none',
                }}
              >
                <span className="text-[8px] font-extrabold tracking-[1.5px] opacity-50">#{i + 1}</span>
                <span className={`text-[9px] font-bold leading-tight ${on ? 'text-white' : 'text-white/45'}`}>
                  {f.def.title}
                </span>
                <span className="text-right text-[8px] font-bold tracking-[1px] opacity-45">
                  {Math.round(f.resonance * 100)}%
                </span>
              </motion.button>
            );
          })}
        </div>
      </div>
    </main>
  );
}
