'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import AvatarCanvas from './AvatarCanvas';
import {
  AURAS,
  type AvatarConfig,
  DEFAULT_AVATAR,
  EYES,
  loadAvatar,
  palette,
  PRESETS,
  randomAvatar,
  saveAvatar,
  SHAPES,
  TEMPERS,
} from '@/lib/agent-avatar';

/**
 * Студия облика: слева — живой персонаж, справа — ползунки.
 *
 * Персонаж не декорация: кнопка «Сказать» отправляет реплику в ядро
 * (`/api/max17`, событие user_message) и на время ответа переводит аватар в
 * режим речи. Так видно, что настраиваешь именно агента, а не заставку.
 */

const CHIP = 'rounded-full border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider transition active:scale-95';

export default function AgentStudio() {
  const [config, setConfig] = useState<AvatarConfig>(DEFAULT_AVATAR);
  const [ready, setReady] = useState(false);
  const [saved, setSaved] = useState(false);
  const [say, setSay] = useState('');
  const [reply, setReply] = useState('');
  const [speaking, setSpeaking] = useState(false);
  const [busy, setBusy] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Читаем облик только после монтирования: localStorage на сервере нет, и
  // попытка учесть его в первом рендере даёт расхождение разметки.
  useEffect(() => {
    setConfig(loadAvatar());
    setReady(true);
  }, []);

  useEffect(() => () => {
    if (savedTimer.current) clearTimeout(savedTimer.current);
  }, []);

  const update = useCallback((patch: Partial<AvatarConfig>) => {
    setConfig((prev) => ({ ...prev, ...patch }));
    setSaved(false);
  }, []);

  const persist = useCallback((next: AvatarConfig) => {
    saveAvatar(next);
    setSaved(true);
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSaved(false), 1800);
  }, []);

  const talk = useCallback(async () => {
    const text = say.trim();
    if (!text || busy) return;
    setBusy(true);
    setSpeaking(true);
    setReply('');
    try {
      const base = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
      const res = await fetch(`${base}/api/max17`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'user_message', message: text, source: 'agent-studio' }),
      });
      const data = await res.json();
      setReply(
        String(data?.next_adaptation || data?.llm?.text || data?.memory?.hint || '')
          || 'Ядро молчит — мост не поднят. Облик всё равно сохранится.',
      );
    } catch {
      setReply('Ядро недоступно. Облик сохраняется локально и без него.');
    } finally {
      setBusy(false);
      // Речь гасим с задержкой, иначе пульсация обрывается ровно в тот момент,
      // когда появляется текст, и выглядит как сбой.
      setTimeout(() => setSpeaking(false), 900);
    }
  }, [say, busy]);

  const pal = palette(config);

  return (
    <main
      className="min-h-screen w-full text-white"
      style={{ background: `radial-gradient(ellipse at 50% 0%, ${pal.deep} 0%, #05030c 60%, #000 100%)` }}
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 lg:flex-row lg:py-10">
        {/* ── персонаж ─────────────────────────────────────────────────────── */}
        <section className="flex flex-1 flex-col items-center gap-4">
          <div className="flex w-full items-start justify-between">
            <div>
              <h1
                className="m-0 text-xl font-extrabold tracking-wide"
                style={{ background: `linear-gradient(90deg, ${pal.main}, ${pal.accent})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}
              >
                ОБЛИК АГЕНТА
              </h1>
              <p className="m-0 mt-1 text-[10px] font-bold uppercase tracking-[3px] opacity-50">
                персонаж · кастомизация · Max17
              </p>
            </div>
            <Link href="/modes" className={CHIP} style={{ color: pal.accent, borderColor: `${pal.accent}66`, background: `${pal.accent}1a` }}>
              △∞ Режимы
            </Link>
          </div>

          <div
            className="relative grid w-full place-items-center rounded-3xl border py-8"
            style={{ borderColor: `${pal.main}33`, background: 'rgba(255,255,255,0.02)' }}
          >
            {ready && (
              <AvatarCanvas
                config={config}
                size={320}
                speaking={speaking}
                listening={busy && !speaking}
              />
            )}
            <div className="mt-2 text-center">
              <div className="text-2xl font-black tracking-[6px]" style={{ color: pal.main }}>
                {config.name}
              </div>
              <div className="text-[10px] uppercase tracking-[3px] opacity-45">{config.temper}</div>
            </div>
          </div>

          {/* Проверка «живости»: реплика уходит в ядро, аватар говорит. */}
          <div className="w-full">
            <div className="flex gap-2">
              <input
                value={say}
                onChange={(e) => setSay(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && talk()}
                placeholder="Скажи что-нибудь агенту…"
                className="flex-1 rounded-full border bg-black/40 px-4 py-2.5 text-sm outline-none placeholder:opacity-40"
                style={{ borderColor: `${pal.main}44` }}
              />
              <button
                type="button"
                onClick={talk}
                disabled={busy || !say.trim()}
                className={`${CHIP} disabled:opacity-35`}
                style={{ color: pal.main, borderColor: `${pal.main}66`, background: `${pal.main}1a` }}
              >
                {busy ? '…' : 'Сказать'}
              </button>
            </div>
            {reply && (
              <p className="mt-3 rounded-2xl border px-4 py-3 text-sm leading-relaxed" style={{ borderColor: `${pal.accent}33`, background: `${pal.accent}0f` }}>
                {reply}
              </p>
            )}
          </div>
        </section>

        {/* ── настройки ────────────────────────────────────────────────────── */}
        <section className="flex-1 space-y-5">
          <Group title="Готовые обличья">
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => { setConfig(p.config); setSaved(false); }}
                  className={CHIP}
                  style={{ color: `hsl(${p.config.hue} 100% 65%)`, borderColor: `hsl(${p.config.hue} 100% 65% / 0.4)`, background: `hsl(${p.config.hue} 100% 65% / 0.1)` }}
                >
                  {p.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => { setConfig(randomAvatar()); setSaved(false); }}
                className={CHIP}
                style={{ color: '#fff', borderColor: 'rgba(255,255,255,0.3)', background: 'rgba(255,255,255,0.06)' }}
              >
                ⚄ Случайный
              </button>
            </div>
          </Group>

          <Group title="Имя">
            <input
              value={config.name}
              maxLength={16}
              onChange={(e) => update({ name: e.target.value.slice(0, 16) })}
              className="w-full rounded-xl border bg-black/40 px-4 py-2.5 text-sm font-bold uppercase tracking-[4px] outline-none"
              style={{ borderColor: `${pal.main}44`, color: pal.main }}
            />
          </Group>

          <Group title="Форма ядра">
            <Choice
              items={SHAPES.map((s) => ({ id: s.id, label: s.label, hint: s.hint }))}
              value={config.shape}
              onChange={(id) => update({ shape: id as AvatarConfig['shape'] })}
              pal={pal}
            />
          </Group>

          <Group title="Глаза">
            <Choice items={EYES} value={config.eyes} onChange={(id) => update({ eyes: id as AvatarConfig['eyes'] })} pal={pal} />
          </Group>

          <Group title="Аура">
            <Choice items={AURAS} value={config.aura} onChange={(id) => update({ aura: id as AvatarConfig['aura'] })} pal={pal} />
          </Group>

          <Group title="Характер">
            <Choice
              items={TEMPERS.map((t) => ({ id: t, label: t }))}
              value={config.temper}
              onChange={(id) => update({ temper: id as AvatarConfig['temper'] })}
              pal={pal}
            />
          </Group>

          <Group title="Цвет">
            <Slider label="Основной" value={config.hue} min={0} max={360} step={1} onChange={(v) => update({ hue: v })} track="linear-gradient(90deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)" />
            <Slider label="Акцент" value={config.accent} min={0} max={360} step={1} onChange={(v) => update({ accent: v })} track="linear-gradient(90deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)" />
          </Group>

          <Group title="Движение">
            <Slider label="Плотность" value={config.density} min={0} max={1} step={0.01} onChange={(v) => update({ density: v })} />
            <Slider label="Темп" value={config.tempo} min={0.2} max={2} step={0.01} onChange={(v) => update({ tempo: v })} />
            <Slider label="Хаос" value={config.chaos} min={0} max={1} step={0.01} onChange={(v) => update({ chaos: v })} />
          </Group>

          <div className="flex gap-2 pb-8">
            <button
              type="button"
              onClick={() => persist(config)}
              className={`${CHIP} flex-1 py-3`}
              style={{ color: pal.main, borderColor: `${pal.main}88`, background: `${pal.main}22` }}
            >
              {saved ? '✓ Сохранено' : 'Сохранить облик'}
            </button>
            <button
              type="button"
              onClick={() => { setConfig({ ...DEFAULT_AVATAR }); setSaved(false); }}
              className={CHIP}
              style={{ color: '#fff', borderColor: 'rgba(255,255,255,0.25)' }}
            >
              Сброс
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2.5">
      <div className="text-[10px] font-bold uppercase tracking-[3px] opacity-45">{title}</div>
      {children}
    </div>
  );
}

function Choice({
  items,
  value,
  onChange,
  pal,
}: {
  items: { id: string; label: string; hint?: string }[];
  value: string;
  onChange: (id: string) => void;
  pal: ReturnType<typeof palette>;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => {
        const on = item.id === value;
        return (
          <button
            key={item.id}
            type="button"
            title={item.hint}
            onClick={() => onChange(item.id)}
            className={CHIP}
            style={{
              color: on ? pal.main : 'rgba(255,255,255,0.65)',
              borderColor: on ? `${pal.main}88` : 'rgba(255,255,255,0.15)',
              background: on ? `${pal.main}1f` : 'transparent',
            }}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  track,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  track?: string;
}) {
  return (
    <label className="block">
      <div className="mb-1 flex justify-between text-[11px] opacity-60">
        <span>{label}</span>
        <span>{step < 1 ? value.toFixed(2) : Math.round(value)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full"
        style={{ background: track ?? 'rgba(255,255,255,0.18)' }}
      />
    </label>
  );
}
