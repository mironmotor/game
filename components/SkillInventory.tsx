'use client';

/**
 * SkillInventory — инвентарь навыков MAX (динамическая компетенция). Вызов:
 * «/навыки» в чате (HudApp шлёт `skills:toggle`). Каждый навык — реальный домен
 * деятельности: компетенция 0..1 растёт от успехов (self_eval + пластичность),
 * уровень из XP, медленно забывается без практики. Данные — событие `skills`.
 */

import { useEffect, useRef, useState } from 'react';
import { Loader2, Sparkles, X } from 'lucide-react';
import { sendMax17Event } from '@/lib/max17-client';

interface Skill {
  key: string;
  label: string;
  competence: number;
  level: number;
  xp: number;
  uses: number;
  successes: number;
}

function barColor(c: number): string {
  const h = Math.round(8 + c * 130); // красный(8)→зелёный(138)
  return `hsl(${h}, 85%, 55%)`;
}

export default function SkillInventory() {
  const [open, setOpen] = useState(false);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [avg, setAvg] = useState(0);
  const [loading, setLoading] = useState(false);
  const timer = useRef<number | null>(null);

  const pull = async () => {
    setLoading(true);
    try {
      const r = (await sendMax17Event({ type: 'skills' })) as {
        skills?: { skills?: Skill[]; avg_competence?: number };
      };
      setSkills(r.skills?.skills ?? []);
      setAvg(r.skills?.avg_competence ?? 0);
    } catch {
      /* мост может быть холодным */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const onToggle = () => setOpen((v) => !v);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('skills:toggle', onToggle);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('skills:toggle', onToggle);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  useEffect(() => {
    if (!open) {
      if (timer.current) window.clearInterval(timer.current);
      return;
    }
    void pull();
    timer.current = window.setInterval(() => void pull(), 10_000);
    return () => {
      if (timer.current) window.clearInterval(timer.current);
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed right-4 top-20 z-[55] w-[min(420px,calc(100vw-32px))] max-h-[78vh] overflow-y-auto rounded-2xl border border-violet-400/30 bg-[#0a0818]/95 shadow-[0_0_40px_rgba(168,85,247,0.18)] backdrop-blur-md">
      <div className="flex items-center gap-2 border-b border-violet-400/20 px-4 py-3">
        <Sparkles className="h-4 w-4 text-violet-300" />
        <span className="text-sm font-semibold tracking-[0.16em] text-violet-200">ИНВЕНТАРЬ НАВЫКОВ</span>
        <span className="ml-2 rounded-full bg-violet-400/15 px-2 py-0.5 text-[10px] text-violet-100/80">
          ср. {Math.round(avg * 100)}%
        </span>
        {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-white/40" />}
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="ml-auto rounded-lg p-1 text-white/40 transition hover:bg-white/10 hover:text-white/80"
          aria-label="Закрыть"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-2.5 p-4">
        {skills.length === 0 && !loading && (
          <p className="text-xs text-white/45">Навыки ещё не накоплены — поговори с MAX, дай задачу, запусти «/расти».</p>
        )}
        {skills.map((s) => (
          <div key={s.key} className="rounded-lg border border-white/8 bg-white/[0.03] p-2.5">
            <div className="mb-1 flex items-center gap-2">
              <span className="text-sm font-medium text-white/90">{s.label}</span>
              <span className="rounded-md bg-violet-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-violet-100">
                ур. {s.level}
              </span>
              <span className="ml-auto text-[10px] tabular-nums text-white/45">
                {Math.round(s.competence * 100)}%
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-black/40">
              <div
                className="h-full rounded-full transition-[width] duration-700"
                style={{
                  width: `${Math.max(3, Math.round(s.competence * 100))}%`,
                  background: barColor(s.competence),
                  boxShadow: `0 0 10px ${barColor(s.competence)}`,
                }}
              />
            </div>
            <div className="mt-1 flex gap-3 text-[10px] text-white/40">
              <span>XP {s.xp}</span>
              <span>исп. {s.uses}</span>
              <span>успех {s.successes}</span>
            </div>
          </div>
        ))}
      </div>

      <p className="px-4 pb-3 text-[10px] leading-relaxed text-white/30">
        Компетенция растёт от успешных действий и медленно гаснет без практики. Слабые знание-навыки MAX
        сам подтягивает в простое (автономный рост).
      </p>
    </div>
  );
}
