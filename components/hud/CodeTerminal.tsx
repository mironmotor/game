'use client';

/**
 * Терминал код-агента.
 *
 * Прежняя консоль была окном с одним полем ввода: напиши задачу — получи ответ.
 * Всё остальное (цель, модель, размер, видимость соседних окон) жило в чужих
 * меню или не существовало. Здесь наоборот: терминал — это место, откуда
 * управляют системой. Команды меняют режим, переключают модель, открывают и
 * прячут окна HUD, настраивают внешний вид; всё, что не команда, уходит агенту
 * как задача.
 *
 * Настройки переживают перезагрузку (localStorage), а каждое действие уходит
 * событием в ядро — MAX видит и то, что человек делает руками, а не только то,
 * что просит сделать словами.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X, Loader2, Minus, Maximize2, Minimize2 } from 'lucide-react';
import { sendCodeAgent, sendMax17Event, type CodeAgentResult } from '@/lib/max17-client';
import { appBasePath } from '@/lib/base-path';
import { useWindowManager, WINDOW_META, WINDOW_ORDER, type StaticWindowId } from './window-manager';

type LineKind = 'prompt' | 'out' | 'dim' | 'ok' | 'err' | 'warn' | 'step' | 'head';

interface Line {
  kind: LineKind;
  text: string;
}

type ThemeId = 'cyan' | 'amber' | 'green' | 'magenta' | 'mono';
type SizeId = 'sm' | 'md' | 'lg' | 'full';

interface Prefs {
  theme: ThemeId;
  font: number;
  opacity: number;
  size: SizeId;
}

const PREFS_KEY = 'max_terminal_prefs';

const DEFAULT_PREFS: Prefs = { theme: 'cyan', font: 12, opacity: 78, size: 'md' };

/** Палитры. Меняется только акцент — фон везде тёмный, как весь HUD. */
const THEMES: Record<ThemeId, { accent: string; border: string; glow: string; text: string }> = {
  cyan: { accent: '#5ef2ff', border: 'rgba(0,242,255,0.30)', glow: 'rgba(0,242,255,0.18)', text: '#c8f7ff' },
  amber: { accent: '#ffc04d', border: 'rgba(255,192,77,0.30)', glow: 'rgba(255,192,77,0.16)', text: '#ffe9c2' },
  green: { accent: '#5cff9d', border: 'rgba(92,255,157,0.28)', glow: 'rgba(92,255,157,0.15)', text: '#ccffe2' },
  magenta: { accent: '#ff6fd8', border: 'rgba(255,111,216,0.30)', glow: 'rgba(255,111,216,0.16)', text: '#ffd6f4' },
  mono: { accent: '#d6d6d6', border: 'rgba(255,255,255,0.20)', glow: 'rgba(255,255,255,0.08)', text: '#e6e6e6' },
};

const SIZES: Record<SizeId, { w: string; h: string }> = {
  sm: { w: 'min(380px, calc(100vw - 32px))', h: 'min(46vh, 340px)' },
  md: { w: 'min(560px, calc(100vw - 32px))', h: 'min(62vh, 520px)' },
  lg: { w: 'min(860px, calc(100vw - 32px))', h: 'min(78vh, 720px)' },
  full: { w: 'calc(100vw - 24px)', h: 'calc(100vh - 132px)' },
};

const ACTION_LABEL: Record<string, string> = {
  list_dir: 'ls',
  read_file: 'read',
  write_file: 'write',
  run_command: 'run',
  final: 'final',
  verify_reject: '↻fix',
};

const COMMANDS = [
  '/help', '/status', '/mode', '/model', '/models', '/steps',
  '/theme', '/font', '/opacity', '/size',
  '/open', '/close', '/windows', '/bg',
  '/revert', '/clear', '/history', '/exit',
] as const;

interface LlmPreset {
  id: string;
  label: string;
  model?: string;
  available?: boolean;
  active?: boolean;
}

function loadPrefs(): Prefs {
  if (typeof window === 'undefined') return DEFAULT_PREFS;
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<Prefs>;
    return {
      theme: parsed.theme && parsed.theme in THEMES ? parsed.theme : DEFAULT_PREFS.theme,
      font: Math.max(10, Math.min(20, Number(parsed.font) || DEFAULT_PREFS.font)),
      opacity: Math.max(30, Math.min(100, Number(parsed.opacity) || DEFAULT_PREFS.opacity)),
      size: parsed.size && parsed.size in SIZES ? parsed.size : DEFAULT_PREFS.size,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function CodeTerminal({
  onClose,
  initialTask,
  initialTarget,
}: {
  onClose: () => void;
  initialTask?: string;
  initialTarget?: 'sandbox' | 'project';
}) {
  const wm = useWindowManager();

  const [lines, setLines] = useState<Line[]>([
    { kind: 'head', text: 'MAX AGI · терминал' },
    { kind: 'dim', text: 'команды начинаются со слэша — /help. Всё остальное уходит агенту как задача.' },
  ]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState<'sandbox' | 'project'>(initialTarget ?? 'sandbox');
  const [maxSteps, setMaxSteps] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [presets, setPresets] = useState<LlmPreset[]>([]);
  const [lastRevert, setLastRevert] = useState<{ restore: Record<string, string | null>; target: string } | null>(null);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const cmdHistory = useRef<string[]>([]);
  const historyPos = useRef<number>(-1);
  const ranTask = useRef<string | null>(null);
  /** Пары «задача → ответ» для контекста агента. */
  const dialog = useRef<{ role: string; content: string }[]>([]);

  const theme = THEMES[prefs.theme];
  const size = SIZES[prefs.size];

  // Настройки читаются после гидратации: localStorage на сервере не существует,
  // а чтение прямо в useState разошлось бы с серверной разметкой.
  useEffect(() => setPrefs(loadPrefs()), []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      // Приватный режим — настройки просто не переживут вкладку.
    }
  }, [prefs]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [lines, busy]);

  const push = useCallback((...items: Line[]) => setLines((prev) => [...prev, ...items]), []);

  const loadPresets = useCallback(async (): Promise<LlmPreset[]> => {
    const res = await fetch(`${appBasePath}/api/llm-config`, { cache: 'no-store' });
    const data = (await res.json()) as { presets?: LlmPreset[] };
    const list = data.presets ?? [];
    setPresets(list);
    return list;
  }, []);

  useEffect(() => {
    void loadPresets().catch(() => undefined);
  }, [loadPresets]);

  // --- агент ---------------------------------------------------------------

  const runAgent = useCallback(
    async (task: string) => {
      setBusy(true);
      try {
        const result: CodeAgentResult = await sendCodeAgent({
          instruction: task,
          history: dialog.current.slice(-40),
          target,
          ...(maxSteps ? { max_steps: maxSteps } : {}),
        });

        if (result.lessons_used?.length) {
          push({ kind: 'dim', text: `🧠 вспомнил уроков: ${result.lessons_used.length}` });
          result.lessons_used.forEach((l) => push({ kind: 'dim', text: `   ${l.lesson}` }));
        }
        result.steps?.forEach((step) =>
          push({
            kind: 'step',
            text: `${(ACTION_LABEL[step.action] ?? step.action).padEnd(6)} ${
              step.command || step.path || ''
            }${step.observation ? ` — ${step.observation.split('\n')[0].slice(0, 100)}` : ''}`,
          }),
        );
        if (result.files_changed?.length) {
          push({ kind: 'warn', text: `изменены файлы: ${result.files_changed.join(', ')}` });
        }
        if (result.verify && (result.verify.fix_attempts ?? 0) > 0) {
          push({
            kind: result.verify.passed ? 'ok' : 'warn',
            text: `${result.verify.passed ? '✓ проверка пройдена' : '⚠ проверка не прошла'} · исправлений: ${result.verify.fix_attempts}`,
          });
        }
        if (result.answer) push({ kind: 'out', text: result.answer });
        if (result.error) push({ kind: 'err', text: result.error });
        if (result.model) push({ kind: 'dim', text: `модель: ${result.model}` });

        if (result.restore && Object.keys(result.restore).length > 0) {
          setLastRevert({ restore: result.restore, target: result.target || target });
          push({ kind: 'dim', text: 'откатить последний прогон: /revert' });
        }

        if (result.answer) {
          dialog.current.push({ role: 'user', content: task }, { role: 'assistant', content: result.answer });
          void sendMax17Event({
            type: 'system_state',
            text: `[code] ${task} → ${result.answer}`.slice(0, 400),
            source: 'code_mode',
          }).catch(() => {});
        }
        void sendMax17Event({ type: 'agent_experience', agent: 'code', text: task, ok: Boolean(result.ok) }).catch(
          () => {},
        );
      } catch (error) {
        push({ kind: 'err', text: error instanceof Error ? error.message : String(error) });
      } finally {
        setBusy(false);
      }
    },
    [maxSteps, push, target],
  );

  const revert = useCallback(async () => {
    if (!lastRevert) {
      push({ kind: 'warn', text: 'откатывать нечего' });
      return;
    }
    setBusy(true);
    try {
      const r = await sendCodeAgent({
        mode: 'revert',
        restore: lastRevert.restore,
        target: lastRevert.target as 'sandbox' | 'project',
      });
      push({ kind: r.ok ? 'ok' : 'err', text: (r.reverted || []).join('; ') || r.error || 'откат выполнен' });
      setLastRevert(null);
    } catch (error) {
      push({ kind: 'err', text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  }, [lastRevert, push]);

  // --- команды -------------------------------------------------------------

  const windowIds = useMemo(() => WINDOW_ORDER.map((id) => id as StaticWindowId), []);

  const runCommand = useCallback(
    async (raw: string) => {
      const [cmd, ...rest] = raw.slice(1).trim().split(/\s+/);
      const arg = rest.join(' ').trim();

      switch (cmd) {
        case 'help':
          push(
            { kind: 'head', text: 'команды' },
            { kind: 'dim', text: '/status              что сейчас включено' },
            { kind: 'dim', text: '/mode sandbox|project  куда пишет агент' },
            { kind: 'dim', text: '/models              список моделей' },
            { kind: 'dim', text: '/model <id>          переключить модель' },
            { kind: 'dim', text: '/steps <n|auto>      потолок шагов агента' },
            { kind: 'dim', text: '/theme cyan|amber|green|magenta|mono' },
            { kind: 'dim', text: '/font <10-20>   /opacity <30-100>   /size sm|md|lg|full' },
            { kind: 'dim', text: '/windows             окна HUD и их состояние' },
            { kind: 'dim', text: '/open <окно|all>     показать окно' },
            { kind: 'dim', text: '/close <окно|all>    спрятать окно' },
            { kind: 'dim', text: '/bg [имя]            фон сцены (без имени — следующий)' },
            { kind: 'dim', text: '/revert  /clear  /history  /exit' },
            { kind: 'dim', text: 'всё, что не команда, уходит агенту как задача' },
          );
          return;

        case 'status': {
          const active = presets.find((p) => p.active);
          push(
            { kind: 'head', text: 'состояние' },
            { kind: 'dim', text: `цель:    ${target === 'project' ? 'ЖИВОЙ проект Game' : 'песочница code-workspace/'}` },
            { kind: 'dim', text: `модель:  ${active ? `${active.id} · ${active.model ?? ''}` : 'неизвестна'}` },
            { kind: 'dim', text: `шаги:    ${maxSteps ?? 'по умолчанию'}` },
            { kind: 'dim', text: `вид:     ${prefs.theme}, ${prefs.font}px, ${prefs.opacity}%, ${prefs.size}` },
            { kind: 'dim', text: `откат:   ${lastRevert ? 'доступен' : 'нечего откатывать'}` },
          );
          return;
        }

        case 'mode': {
          if (arg !== 'sandbox' && arg !== 'project') {
            push({ kind: 'warn', text: 'использование: /mode sandbox | /mode project' });
            return;
          }
          setTarget(arg);
          push({
            kind: arg === 'project' ? 'warn' : 'ok',
            text:
              arg === 'project'
                ? '⚠ цель: ЖИВОЙ проект Game — агент правит реальные файлы'
                : 'цель: песочница code-workspace/',
          });
          return;
        }

        case 'models': {
          const list = presets.length ? presets : await loadPresets();
          push({ kind: 'head', text: 'модели' });
          list.forEach((p) =>
            push({
              kind: p.active ? 'ok' : p.available ? 'dim' : 'err',
              text: `${p.active ? '▸' : ' '} ${p.id.padEnd(16)} ${p.available ? '' : '(нет ключа) '}${p.label}`,
            }),
          );
          return;
        }

        case 'model': {
          if (!arg) {
            push({ kind: 'warn', text: 'использование: /model <id> — список в /models' });
            return;
          }
          const res = await fetch(`${appBasePath}/api/llm-config`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: arg, role: 'code' }),
          });
          const data = (await res.json()) as { ok?: boolean; presets?: LlmPreset[]; error?: string };
          if (data.presets) setPresets(data.presets);
          if (data.ok === false) {
            push({ kind: 'err', text: data.error || 'не удалось переключить' });
            return;
          }

          // Ядро молча откатывается на доступную модель, если у запрошенной нет
          // ключа. Рапортовать об этом как об успехе — врать: человек попросил
          // Клода, получил bonsai и не узнал бы об этом, пока не удивился ответу.
          const now = data.presets?.find((p) => p.active);
          const wanted = data.presets?.find((p) => p.id === arg);
          if (now && now.id !== arg) {
            push(
              { kind: 'warn', text: `${arg} не подключён${wanted && !wanted.available ? ' (нет ключа)' : ''}` },
              { kind: 'dim', text: `роль «код» осталась на ${now.id} · ${now.model ?? ''}` },
            );
            if (arg.startsWith('claude')) {
              push({ kind: 'dim', text: 'нужен ANTHROPIC_API_KEY в .env.local, затем перезапуск' });
            }
            return;
          }
          push({ kind: 'ok', text: `модель роли «код»: ${now ? `${now.id} · ${now.model ?? ''}` : arg}` });
          return;
        }

        case 'steps': {
          if (arg === 'auto' || arg === '') {
            setMaxSteps(null);
            push({ kind: 'ok', text: 'шаги: по умолчанию (зависит от окна модели)' });
            return;
          }
          const n = Number(arg);
          if (!Number.isFinite(n) || n < 1) {
            push({ kind: 'warn', text: 'использование: /steps <число> | /steps auto' });
            return;
          }
          setMaxSteps(Math.floor(n));
          push({ kind: 'ok', text: `потолок шагов: ${Math.floor(n)}` });
          return;
        }

        case 'theme': {
          if (!(arg in THEMES)) {
            push({ kind: 'warn', text: `темы: ${Object.keys(THEMES).join(', ')}` });
            return;
          }
          setPrefs((p) => ({ ...p, theme: arg as ThemeId }));
          push({ kind: 'ok', text: `тема: ${arg}` });
          return;
        }

        case 'font': {
          const n = Number(arg);
          if (!Number.isFinite(n) || n < 10 || n > 20) {
            push({ kind: 'warn', text: 'использование: /font 10..20' });
            return;
          }
          setPrefs((p) => ({ ...p, font: Math.round(n) }));
          push({ kind: 'ok', text: `шрифт: ${Math.round(n)}px` });
          return;
        }

        case 'opacity': {
          const n = Number(arg);
          if (!Number.isFinite(n) || n < 30 || n > 100) {
            push({ kind: 'warn', text: 'использование: /opacity 30..100' });
            return;
          }
          setPrefs((p) => ({ ...p, opacity: Math.round(n) }));
          push({ kind: 'ok', text: `непрозрачность: ${Math.round(n)}%` });
          return;
        }

        case 'size': {
          if (!(arg in SIZES)) {
            push({ kind: 'warn', text: `размеры: ${Object.keys(SIZES).join(', ')}` });
            return;
          }
          setPrefs((p) => ({ ...p, size: arg as SizeId }));
          push({ kind: 'ok', text: `размер: ${arg}` });
          return;
        }

        case 'windows': {
          push({ kind: 'head', text: 'окна HUD' });
          windowIds.forEach((id) => {
            const state = wm.windows[id];
            const label = WINDOW_META[id]?.title ?? id;
            const status = !state?.open ? 'скрыто' : state.minimized ? 'свёрнуто' : 'открыто';
            push({ kind: state?.open ? 'dim' : 'err', text: `  ${id.padEnd(10)} ${status.padEnd(9)} ${label}` });
          });
          push({ kind: 'dim', text: 'плюс панели ядра: ' + (Object.keys(wm.panels).length || 'нет') });
          return;
        }

        case 'open':
        case 'close': {
          if (arg === 'all') {
            if (cmd === 'open') wm.showAll();
            else wm.closeAll();
            push({ kind: 'ok', text: cmd === 'open' ? 'показаны все окна' : 'скрыты все окна' });
            return;
          }
          if (!arg) {
            push({ kind: 'warn', text: `использование: /${cmd} <окно|all> — список в /windows` });
            return;
          }
          const known = windowIds.find((id) => id === arg);
          if (!known) {
            push({ kind: 'err', text: `нет такого окна: ${arg}` });
            return;
          }
          if (cmd === 'open') wm.openWindow(known);
          else wm.closeWindow(known);
          push({ kind: 'ok', text: `${arg}: ${cmd === 'open' ? 'открыто' : 'скрыто'}` });
          return;
        }

        case 'bg': {
          if (!arg) {
            wm.cycleBackground();
            push({ kind: 'ok', text: 'фон: следующий' });
            return;
          }
          push(
            wm.setBackgroundByName(arg)
              ? { kind: 'ok', text: `фон: ${arg}` }
              : { kind: 'err', text: `не нашёл фон «${arg}»` },
          );
          return;
        }

        case 'revert':
          await revert();
          return;

        case 'clear':
          setLines([{ kind: 'head', text: 'MAX AGI · терминал' }]);
          return;

        case 'history':
          push({ kind: 'head', text: 'история команд' });
          cmdHistory.current.slice(-30).forEach((h, i) => push({ kind: 'dim', text: `${String(i + 1).padStart(3)} ${h}` }));
          return;

        case 'exit':
          onClose();
          return;

        default:
          push({ kind: 'err', text: `неизвестная команда: /${cmd} — см. /help` });
      }
    },
    [lastRevert, loadPresets, maxSteps, onClose, prefs, presets, push, revert, target, windowIds, wm],
  );

  const submit = useCallback(
    async (raw?: string) => {
      const text = (raw ?? input).trim();
      if (!text || busy) return;
      setInput('');
      cmdHistory.current.push(text);
      historyPos.current = -1;
      push({ kind: 'prompt', text });

      if (text.startsWith('/')) {
        // Команды тоже уходят в ядро: MAX должен видеть, как человек ведёт
        // систему руками, а не только то, что просит сделать словами.
        void sendMax17Event({ type: 'system_state', text: `[terminal] ${text}`, source: 'code_mode' }).catch(() => {});
        try {
          await runCommand(text);
        } catch (error) {
          push({ kind: 'err', text: error instanceof Error ? error.message : String(error) });
        }
        return;
      }
      await runAgent(text);
    },
    [busy, input, push, runAgent, runCommand],
  );

  // Задача, переданная из чата оркестратором.
  useEffect(() => {
    const task = initialTask?.trim();
    if (task && ranTask.current !== task) {
      ranTask.current = task;
      push({ kind: 'prompt', text: task });
      void runAgent(task);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTask]);

  useEffect(() => {
    if (initialTarget) setTarget(initialTarget);
  }, [initialTarget]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void submit();
      return;
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const list = cmdHistory.current;
      if (list.length === 0) return;
      e.preventDefault();
      const next =
        e.key === 'ArrowUp'
          ? historyPos.current < 0
            ? list.length - 1
            : Math.max(0, historyPos.current - 1)
          : historyPos.current < 0
            ? -1
            : Math.min(list.length - 1, historyPos.current + 1);
      historyPos.current = next;
      setInput(next < 0 ? '' : list[next]);
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      const typed = input.trim();
      if (!typed.startsWith('/')) return;
      const matches = COMMANDS.filter((c) => c.startsWith(typed));
      if (matches.length === 1) setInput(`${matches[0]} `);
      else if (matches.length > 1) push({ kind: 'dim', text: matches.join('  ') });
    }
  };

  const lineColor = (kind: LineKind): string => {
    switch (kind) {
      case 'prompt':
        return theme.accent;
      case 'ok':
        return '#7dffb0';
      case 'err':
        return '#ff8a8a';
      case 'warn':
        return '#ffcf6b';
      case 'step':
        return 'rgba(255,255,255,0.45)';
      case 'dim':
        return 'rgba(255,255,255,0.5)';
      case 'head':
        return theme.accent;
      default:
        return theme.text;
    }
  };

  return (
    <div
      className="fixed bottom-[112px] right-4 z-20 flex flex-col overflow-hidden rounded-lg backdrop-blur-md"
      style={{
        width: size.w,
        height: collapsed ? 'auto' : size.h,
        border: `1px solid ${theme.border}`,
        background: `rgba(3, 6, 18, ${prefs.opacity / 100})`,
        boxShadow: `0 0 28px ${theme.glow}`,
        fontSize: `${prefs.font}px`,
      }}
      onClick={() => inputRef.current?.focus()}
    >
      <div
        className="flex items-center justify-between px-3 py-1.5"
        style={{ borderBottom: `1px solid ${theme.border}` }}
      >
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.2em]">
          <span className="max-agi-rainbow">MAX AGI</span>
          <span style={{ color: 'rgba(255,255,255,0.35)' }}>
            {target === 'project' ? '⚠ проект' : 'песочница'}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setPrefs((p) => ({ ...p, size: p.size === 'full' ? 'md' : 'full' }));
            }}
            className="hud-icon-btn"
            aria-label={prefs.size === 'full' ? 'Уменьшить терминал' : 'Развернуть терминал'}
          >
            {prefs.size === 'full' ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setCollapsed((v) => !v);
            }}
            className="hud-icon-btn"
            aria-label={collapsed ? 'Развернуть' : 'Свернуть в строку'}
          >
            <Minus size={14} />
          </button>
          <button type="button" onClick={onClose} className="hud-icon-btn" aria-label="Закрыть терминал">
            <X size={15} />
          </button>
        </div>
      </div>

      {!collapsed && (
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2 font-mono leading-[1.55]">
          {lines.map((line, i) => (
            <div
              key={i}
              style={{ color: lineColor(line.kind), whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
              className={line.kind === 'head' ? 'mt-1 uppercase tracking-[0.18em]' : undefined}
            >
              {line.kind === 'prompt' ? <span style={{ opacity: 0.5 }}>❯ </span> : null}
              {line.text}
            </div>
          ))}
          {busy && (
            <div className="mt-1 flex items-center gap-2" style={{ color: theme.text, opacity: 0.6 }}>
              <Loader2 size={12} className="animate-spin" /> агент работает…
            </div>
          )}
        </div>
      )}

      <div className="flex items-center gap-2 px-3 py-1.5" style={{ borderTop: `1px solid ${theme.border}` }}>
        <span className="font-mono" style={{ color: theme.accent, opacity: 0.75 }}>
          ❯
        </span>
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={busy}
          spellCheck={false}
          autoComplete="off"
          placeholder={busy ? 'агент работает…' : 'задача или /команда'}
          className="min-w-0 flex-1 bg-transparent font-mono outline-none"
          style={{ color: theme.text, fontSize: `${prefs.font}px` }}
        />
      </div>
    </div>
  );
}
