'use client';

/**
 * JarvisHud — «Iron-Man» оверлей поверх HUD. Arc-reactor по центру, круговые
 * гейджи (реальные синапсы из graph_stats → дорога к 1M), угловые рамки и
 * скан-линии. Реагирует на события `max:thinking` (ядро думает) и
 * `max:speaking` (MAX говорит — подсветка золотом, как у Джарвиса).
 *
 * Включается командой «/jarvis» в чате MAX (HudApp шлёт `jarvis:toggle`).
 * Весь слой pointer-events-none — никогда не перехватывает клики.
 */

import { useEffect, useState } from 'react';
import { sendMax17Event } from '@/lib/max17-client';

const GOAL = 1_000_000; // дорога к одному миллиону синапсов

interface Scale {
  key: string;
  label: string;
  value: number;
  max: number;
  frac: number;
}

export default function JarvisHud() {
  const [on, setOn] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [synapses, setSynapses] = useState<number | null>(null);
  const [scales, setScales] = useState<Scale[]>([]);
  const [guardian, setGuardian] = useState(0);

  // «/jarvis» -> toggle (или detail.on для явного состояния).
  useEffect(() => {
    const onToggle = (e: Event) => {
      const d = (e as CustomEvent).detail as { on?: boolean } | undefined;
      setOn((v) => (typeof d?.on === 'boolean' ? d.on : !v));
    };
    window.addEventListener('jarvis:toggle', onToggle as EventListener);
    return () => window.removeEventListener('jarvis:toggle', onToggle as EventListener);
  }, []);

  // Реакция на «думает» / «говорит».
  useEffect(() => {
    const onThink = (e: Event) => setThinking(Boolean((e as CustomEvent).detail?.active));
    const onSpeak = (e: Event) => setSpeaking(Boolean((e as CustomEvent).detail?.active));
    window.addEventListener('max:thinking', onThink as EventListener);
    window.addEventListener('max:speaking', onSpeak as EventListener);
    return () => {
      window.removeEventListener('max:thinking', onThink as EventListener);
      window.removeEventListener('max:speaking', onSpeak as EventListener);
    };
  }, []);

  // Пока оверлей включён — тянем реальную статистику графа.
  useEffect(() => {
    if (!on) return;
    let alive = true;
    const pull = async () => {
      try {
        const r = (await sendMax17Event({ type: 'system_scales' })) as {
          system_scales?: { scales?: Scale[]; total_synapses?: number; guardian_blocked?: number };
        };
        if (alive) {
          setScales(r.system_scales?.scales ?? []);
          setSynapses(r.system_scales?.total_synapses ?? null);
          setGuardian(r.system_scales?.guardian_blocked ?? 0);
        }
      } catch {
        /* мост может быть холодным — не критично */
      }
    };
    void pull();
    const t = setInterval(pull, 15_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [on]);

  if (!on) return null;

  const road = scales.find((s) => s.key === 'road_1m');
  const frac = road ? road.frac : synapses == null ? 0 : Math.min(1, synapses / GOAL);
  const accent = speaking ? '#ffb020' : '#00f2ff'; // золото Джарвиса при речи
  const spinOuter = thinking ? '7s' : '26s';
  const spinTicks = thinking ? '9s' : '34s';
  const pulse = speaking ? '0.7s' : thinking ? '1.1s' : '2.6s';
  const intensity = speaking ? 1 : thinking ? 0.85 : 0.6;
  const status = speaking ? 'СВЯЗЬ · ГОЛОС' : thinking ? 'АНАЛИЗ…' : 'РЕЖИМ ОЖИДАНИЯ';

  // Гейдж-кольцо синапсов.
  const R = 112;
  const C = 2 * Math.PI * R;
  const dash = `${C * frac} ${C}`;

  return (
    <div
      className="pointer-events-none fixed inset-0 z-[15] select-none overflow-hidden"
      style={{ animation: 'jv-boot 700ms ease-out both' }}
      aria-hidden
    >
      <style>{`
        @keyframes jv-spin { to { transform: rotate(360deg); } }
        @keyframes jv-spin-rev { to { transform: rotate(-360deg); } }
        @keyframes jv-scan { 0% { transform: translateY(-12vh); } 100% { transform: translateY(112vh); } }
        @keyframes jv-corepulse { 0%,100% { opacity: .45; transform: scale(.92); } 50% { opacity: 1; transform: scale(1.06); } }
        @keyframes jv-boot { 0% { opacity: 0; filter: blur(6px); } 100% { opacity: 1; filter: blur(0); } }
        @keyframes jv-flick { 0%,100% { opacity: .85; } 47% { opacity: .55; } 50% { opacity: 1; } 53% { opacity: .6; } }
        .jv-spin { transform-box: fill-box; transform-origin: center; animation: jv-spin linear infinite; }
        .jv-spin-rev { transform-box: fill-box; transform-origin: center; animation: jv-spin-rev linear infinite; }
      `}</style>

      {/* Скан-линия сверху вниз */}
      <div
        className="absolute left-0 h-px w-full"
        style={{
          background: `linear-gradient(90deg, transparent, ${accent}55 20%, ${accent}aa 50%, ${accent}55 80%, transparent)`,
          boxShadow: `0 0 14px ${accent}66`,
          animation: 'jv-scan 6.5s linear infinite',
          opacity: 0.5,
        }}
      />

      {/* Центральный arc-reactor (рамка вокруг сцены, полая внутри) */}
      <svg
        viewBox="0 0 400 400"
        className="absolute left-1/2 top-1/2 h-[min(86vh,86vw)] w-[min(86vh,86vw)] -translate-x-1/2 -translate-y-1/2"
        style={{ opacity: intensity }}
      >
        <defs>
          <radialGradient id="jv-core" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={accent} stopOpacity="0.95" />
            <stop offset="55%" stopColor={accent} stopOpacity="0.35" />
            <stop offset="100%" stopColor={accent} stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Внешнее пунктирное кольцо */}
        <g className="jv-spin" style={{ animationDuration: spinOuter }}>
          <circle cx="200" cy="200" r="180" fill="none" stroke={accent} strokeOpacity="0.35" strokeWidth="1" strokeDasharray="2 10" />
          <circle cx="200" cy="200" r="172" fill="none" stroke={accent} strokeOpacity="0.2" strokeWidth="1" strokeDasharray="40 28" />
        </g>

        {/* Тиковое кольцо в обратную сторону */}
        <g className="jv-spin-rev" style={{ animationDuration: spinTicks }}>
          <circle cx="200" cy="200" r="156" fill="none" stroke={accent} strokeOpacity="0.3" strokeWidth="6" strokeDasharray="1.5 16" />
        </g>

        {/* Статичное тонкое кольцо */}
        <circle cx="200" cy="200" r="134" fill="none" stroke={accent} strokeOpacity="0.18" strokeWidth="1" />

        {/* Гейдж синапсов (дорога к 1M) */}
        <g transform="rotate(-90 200 200)">
          <circle cx="200" cy="200" r={R} fill="none" stroke={accent} strokeOpacity="0.12" strokeWidth="4" />
          <circle
            cx="200"
            cy="200"
            r={R}
            fill="none"
            stroke={accent}
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray={dash}
            style={{ filter: `drop-shadow(0 0 6px ${accent})`, transition: 'stroke-dasharray 1s ease' }}
          />
        </g>

        {/* Спицы arc-reactor */}
        {[0, 120, 240].map((a) => (
          <line
            key={a}
            x1="200"
            y1="200"
            x2={200 + 96 * Math.cos((a * Math.PI) / 180)}
            y2={200 + 96 * Math.sin((a * Math.PI) / 180)}
            stroke={accent}
            strokeOpacity="0.25"
            strokeWidth="2"
          />
        ))}

        {/* Ядро-реактор */}
        <circle cx="200" cy="200" r="60" fill="url(#jv-core)" style={{ transformBox: 'fill-box', transformOrigin: 'center', animation: `jv-corepulse ${pulse} ease-in-out infinite` }} />
        <circle cx="200" cy="200" r="30" fill="none" stroke={accent} strokeOpacity="0.7" strokeWidth="1.5" />
      </svg>

      {/* Статус под реактором */}
      <div
        className="absolute left-1/2 top-[calc(50%+min(43vh,43vw)+6px)] -translate-x-1/2 whitespace-nowrap text-center text-[10px] uppercase tracking-[0.4em]"
        style={{ color: accent, textShadow: `0 0 10px ${accent}88`, animation: speaking ? 'jv-flick 0.6s steps(2) infinite' : undefined }}
      >
        {status}
      </div>

      {/* Шкалы системы (живые, из ядра) — левый край */}
      {scales.length > 0 && (
        <div className="absolute left-4 top-1/2 flex w-44 -translate-y-1/2 flex-col gap-2.5" style={{ color: accent }}>
          <div className="text-[9px] uppercase tracking-[0.3em]" style={{ opacity: 0.7, textShadow: `0 0 8px ${accent}66` }}>
            ШКАЛЫ СИСТЕМЫ
          </div>
          {scales.map((s) => (
            <div key={s.key}>
              <div className="flex items-baseline justify-between text-[9px] uppercase tracking-[0.16em]">
                <span style={{ opacity: 0.85 }}>{s.label}</span>
                <span style={{ opacity: 0.55 }}>{Math.round(s.frac * 100)}%</span>
              </div>
              <div className="mt-0.5 h-1 w-full overflow-hidden rounded-sm" style={{ background: `${accent}22` }}>
                <div
                  style={{
                    width: `${Math.min(100, s.frac * 100)}%`,
                    height: '100%',
                    background: accent,
                    boxShadow: `0 0 8px ${accent}`,
                    transition: 'width 1s ease',
                  }}
                />
              </div>
              <div className="text-[8px] tracking-wider" style={{ opacity: 0.4 }}>
                {s.value.toLocaleString('ru-RU')} / {s.max.toLocaleString('ru-RU')}
              </div>
            </div>
          ))}
          <div
            className="mt-1 flex items-baseline justify-between border-t pt-1.5 text-[9px] uppercase tracking-[0.16em]"
            style={{ borderColor: `${accent}33`, color: '#7ef0c8' }}
            title="Ангел безопасности отклонил входящих знаний (война/политика/пороки)"
          >
            <span style={{ opacity: 0.85 }}>⊘ Ангел отклонил</span>
            <span style={{ opacity: 0.95 }}>{guardian.toLocaleString('ru-RU')}</span>
          </div>
        </div>
      )}

      {/* Угловые рамки + читаемые данные */}
      <Corner pos="top-4 left-4" h="border-l-2 border-t-2" accent={accent} label="MAX17 // ОНЛАЙН" sub="ARC REACTOR ACTIVE" />
      <Corner pos="top-4 right-4" h="border-r-2 border-t-2" accent={accent} label="СОВЕТ · 7 АГЕНТОВ" sub={status} align="right" />
      <Corner pos="bottom-4 left-4" h="border-l-2 border-b-2" accent={accent} label="ДОРОГА К 1M" sub={`${(frac * 100).toFixed(frac < 0.01 ? 3 : 1)}%`} />
      <Corner
        pos="bottom-4 right-4"
        h="border-r-2 border-b-2"
        accent={accent}
        label="СИНАПСЫ"
        sub={synapses == null ? '— / 1 000 000' : `${synapses.toLocaleString('ru-RU')} / 1 000 000`}
        align="right"
      />
    </div>
  );
}

function Corner({
  pos,
  h,
  accent,
  label,
  sub,
  align = 'left',
}: {
  pos: string;
  h: string;
  accent: string;
  label: string;
  sub: string;
  align?: 'left' | 'right';
}) {
  return (
    <div className={`absolute ${pos}`} style={{ color: accent }}>
      <div
        className={`h-7 w-7 ${h}`}
        style={{ borderColor: `${accent}99`, boxShadow: `0 0 12px ${accent}44` }}
      />
      <div
        className={`mt-1 ${align === 'right' ? 'text-right' : ''} text-[9px] uppercase leading-tight tracking-[0.25em]`}
        style={{ textShadow: `0 0 8px ${accent}66` }}
      >
        <div style={{ opacity: 0.9 }}>{label}</div>
        <div style={{ opacity: 0.55 }} className="tracking-[0.18em]">{sub}</div>
      </div>
    </div>
  );
}
