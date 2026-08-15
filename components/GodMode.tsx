'use client';

/**
 * GODMODE — «Терминал бога». Вызывается командой «/godmode» в чате MAX
 * (HudApp шлёт событие `godmode:open`). Окно режимов: в каком разуме думает MAX.
 * Режим №1 — локальный Qwen3 (суверенно, офлайн). Расширяемо.
 */

import { useEffect, useRef, useState } from 'react';
import {
  Activity,
  BookOpen,
  Brain,
  Cloud,
  Cpu,
  FolderInput,
  Loader2,
  Map,
  Maximize2,
  MessageCircle,
  Moon,
  Network,
  RotateCcw,
  Rocket,
  Sparkles,
  Star,
  Terminal,
  WandSparkles,
  X,
  Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { getLlmConfig, setLlmModel, type LlmConfig, type LlmPreset } from '@/lib/max17-client';
import MusicStudio from '@/components/MusicStudio';
import Mode777 from '@/components/Mode777';
import DubbingStudio from '@/components/DubbingStudio';
import VoicePicker from '@/components/VoicePicker';
import JyotishPanel from '@/components/JyotishPanel';

type GodModeAction =
  | 'chat'
  | 'stars'
  | 'import'
  | 'map'
  | 'dream'
  | 'neural'
  | 'status'
  | 'evolution'
  | 'council'
  | 'kickoff'
  | 'sleep'
  | 'all'
  | 'reset';

type GodModeTile = {
  action: GodModeAction;
  label: string;
  detail: string;
  Icon: typeof Terminal;
};

const RIGHT_PANEL_MODES: GodModeTile[] = [
  { action: 'chat', label: 'Чат с MAX17', detail: 'главное окно связи', Icon: MessageCircle },
  { action: 'stars', label: 'Звезды', detail: '3D-ядро и орбиты', Icon: Star },
  { action: 'import', label: 'Импорт', detail: 'скормить корпус', Icon: FolderInput },
  { action: 'map', label: 'Карта', detail: 'мини-карта HUD', Icon: Map },
  { action: 'dream', label: 'Синтез снов', detail: 'фон и музыка сна', Icon: WandSparkles },
  { action: 'neural', label: 'Нейросинтез', detail: 'кузница синапсов', Icon: Network },
  { action: 'status', label: 'Статус игры', detail: 'игрок и система', Icon: Activity },
  { action: 'evolution', label: 'Эволюция', detail: 'автономный рост', Icon: Sparkles },
];

const QUICK_MODES: GodModeTile[] = [
  { action: 'council', label: 'Совет', detail: 'ангелы MAX', Icon: Sparkles },
  { action: 'kickoff', label: 'Разгон', detail: 'миссия дня', Icon: Rocket },
  { action: 'sleep', label: 'Сон', detail: 'консолидация', Icon: Moon },
  { action: 'all', label: 'Всё', detail: 'показать окна', Icon: Maximize2 },
  { action: 'reset', label: 'Сброс', detail: 'разложить HUD', Icon: RotateCcw },
];

export default function GodMode() {
  const [open, setOpen] = useState(false);
  const [config, setConfig] = useState<LlmConfig | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function refresh() {
    try {
      setConfig(await getLlmConfig());
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    const onOpen = () => {
      setOpen(true);
      setNote(null);
      void refresh();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('godmode:open', onOpen);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('godmode:open', onOpen);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  // Сообщаем фону (SolarSystem) о закрытии — камера отъезжает от Солнца.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !open) window.dispatchEvent(new CustomEvent('godmode:closed'));
    wasOpen.current = open;
  }, [open]);

  async function activate(p: LlmPreset) {
    if (busy || p.active) return;
    setBusy(p.id);
    setNote(null);
    try {
      const c = await setLlmModel(p.id);
      setConfig(c);
      setNote(`Разум переключён: ${p.label.split('—')[0].trim()}`);
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  function runMode(action: GodModeAction, label: string) {
    window.dispatchEvent(new CustomEvent('godmode:run', { detail: { action } }));
    setNote(`Режим запущен: ${label}`);
  }

  if (!open) return null;

  const presets = config?.presets ?? [];
  const local = presets.filter((p) => p.local);
  const cloud = presets.filter((p) => !p.local);
  const qwen3 = presets.find((p) => p.id === 'lmstudio-qwen3') ?? presets.find((p) => p.id === 'ollama-qwen3');
  const featuredId = qwen3?.id;

  const Card = ({ p, featured = false }: { p: LlmPreset; featured?: boolean }) => (
    <div
      className={cn(
        'rounded-xl border p-3 transition',
        p.active ? 'border-amber-400/60 bg-amber-400/10' : 'border-white/10 bg-white/[0.03]',
        featured && !p.active && 'border-amber-400/30',
      )}
    >
      <div className="flex items-center gap-2">
        {p.local ? <Cpu className="h-4 w-4 text-amber-300" /> : <Cloud className="h-4 w-4 text-sky-300" />}
        <span className="text-sm font-semibold text-white/90">{p.label.split('—')[0].trim()}</span>
        {p.active && <span className="ml-auto rounded-full bg-amber-400/25 px-2 py-0.5 text-[10px] font-semibold text-amber-100">активен</span>}
      </div>
      <p className="mt-1 text-[11px] leading-snug text-white/45">{p.label}</p>
      <div className="mt-2 flex items-center gap-2">
        <span className={cn('text-[10px]', p.available ? 'text-emerald-300/80' : 'text-rose-300/80')}>
          {p.available ? '● доступен' : '○ недоступен'}
        </span>
        {!p.available && p.id === 'ollama-qwen3' && (
          <span className="text-[10px] text-white/35">нужно: ollama pull qwen3</span>
        )}
        {!p.active && (
          <button
            type="button"
            onClick={() => activate(p)}
            disabled={busy !== null}
            className="ml-auto flex items-center gap-1 rounded-lg bg-amber-500/20 px-2.5 py-1 text-[11px] font-semibold text-amber-100 transition hover:bg-amber-500/35 disabled:opacity-40"
          >
            {busy === p.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
            Активировать
          </button>
        )}
      </div>
    </div>
  );

  const ModeTile = ({ tile }: { tile: GodModeTile }) => (
    <button
      type="button"
      onClick={() => runMode(tile.action, tile.label)}
      className="group flex min-h-[76px] items-start gap-2 rounded-xl border border-white/10 bg-white/[0.035] p-3 text-left transition hover:border-amber-300/45 hover:bg-amber-300/[0.08]"
      title={tile.detail}
    >
      <span className="mt-0.5 rounded-lg border border-amber-300/20 bg-amber-300/10 p-1.5 text-amber-200 transition group-hover:border-amber-200/50 group-hover:text-amber-100">
        <tile.Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-white/90">{tile.label}</span>
        <span className="mt-0.5 block text-[11px] leading-snug text-white/40">{tile.detail}</span>
      </span>
    </button>
  );

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-[min(960px,100%)] max-h-[92vh] overflow-y-auto rounded-2xl border border-amber-400/30 bg-[#0a0818]/95 shadow-[0_0_40px_rgba(186,117,23,0.18)]">
        <div className="flex items-center gap-2 border-b border-amber-400/20 px-4 py-3">
          <Terminal className="h-4 w-4 text-amber-300" />
          <span className="text-sm font-semibold tracking-[0.2em] text-amber-200">☉ СОЛНЦЕ-ИНТЕРФЕЙС · ЯДРО</span>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="ml-auto rounded-lg p-1 text-white/40 transition hover:bg-white/10 hover:text-white/80"
            aria-label="Закрыть"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-4">
          <p className="text-xs text-white/50">Ты влетел в Солнце — ядро системы. Здесь внутренние коды MAX: разум, локальные программы, голос и музыка.</p>

          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent('brain:toggle'))}
            className="flex w-full items-center gap-2 rounded-xl border border-cyan-400/30 bg-gradient-to-r from-cyan-500/15 to-violet-500/15 px-4 py-3 text-left transition hover:from-cyan-500/25 hover:to-violet-500/25"
          >
            <Brain className="h-5 w-5 text-cyan-300" />
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-white/90">🧠 Мозг MAX — живой граф памяти</span>
              <span className="block text-[11px] text-white/45">настоящие синапсы, нейроны и импульсы из ядра</span>
            </span>
          </button>

          <div>
            <div className="mb-1.5 flex items-center gap-2 text-[11px] uppercase tracking-widest text-cyan-300/70">
              <Zap className="h-3.5 w-3.5" /> Режимы правой плашки
            </div>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              {RIGHT_PANEL_MODES.map((tile) => <ModeTile key={tile.action} tile={tile} />)}
            </div>
          </div>

          <div>
            <div className="mb-1.5 text-[11px] uppercase tracking-widest text-violet-300/70">Быстрые команды</div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {QUICK_MODES.map((tile) => <ModeTile key={tile.action} tile={tile} />)}
            </div>
          </div>

          {!config && <div className="flex items-center gap-2 text-sm text-white/50"><Loader2 className="h-4 w-4 animate-spin" /> загрузка режимов…</div>}

          {qwen3 && (
            <div>
              <div className="mb-1.5 text-[11px] uppercase tracking-widest text-amber-300/70">Режим 1 · Локалка Qwen3</div>
              <Card p={qwen3} featured />
            </div>
          )}

          {local.filter((p) => p.id !== featuredId).length > 0 && (
            <div>
              <div className="mb-1.5 text-[11px] uppercase tracking-widest text-white/40">Локальные (офлайн)</div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {local.filter((p) => p.id !== featuredId).map((p) => <Card key={p.id} p={p} />)}
              </div>
            </div>
          )}

          {cloud.length > 0 && (
            <div>
              <div className="mb-1.5 text-[11px] uppercase tracking-widest text-white/40">Облако</div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {cloud.map((p) => <Card key={p.id} p={p} />)}
              </div>
            </div>
          )}

          <div>
            <div className="mb-1.5 text-[11px] uppercase tracking-widest text-amber-300/70">Джйотиш · ведическая карта</div>
            <JyotishPanel />
          </div>

          <div>
            <div className="mb-1.5 text-[11px] uppercase tracking-widest text-sky-300/70">Голос · JARVIS / Пятница</div>
            <VoicePicker />
          </div>

          <div>
            <div className="mb-1.5 text-[11px] uppercase tracking-widest text-emerald-300/70">Режим · Дубляж (NOESIS)</div>
            <DubbingStudio />
          </div>

          <div>
            <div className="mb-1.5 text-[11px] uppercase tracking-widest text-amber-300/70">Режим · 777</div>
            <Mode777 />
          </div>

          <div>
            <div className="mb-1.5 text-[11px] uppercase tracking-widest text-fuchsia-300/70">Режим · Музыка (быстрый)</div>
            <MusicStudio />
          </div>

          {note && <div className="rounded-lg border border-amber-400/20 bg-amber-400/5 px-3 py-2 text-xs text-amber-100">{note}</div>}

          <p className="text-[10px] leading-relaxed text-white/30">
            Переключение мгновенное (без перезапуска): выбор пишется в файл, который читает мост на каждом вызове.
            Если бэкенд недоступен — ядро автоматически идёт по лестнице резерва. Ведическая карта считается прямо в браузере.
          </p>
        </div>
      </div>
    </div>
  );
}
