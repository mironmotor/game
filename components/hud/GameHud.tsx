'use client';

import type { ReactNode, KeyboardEvent } from 'react';
import {
  BookOpen,
  Briefcase,
  Camera,
  Globe,
  Image as ImageIcon,
  MapPin,
  Maximize2,
  Menu,
  Cpu,
  Ear,
  GitBranch,
  Mic,
  Monitor,
  Terminal,
  Play,
  Plus,
  RotateCcw,
  Star,
  Sun,
  Triangle,
  Users,
  Volume2,
} from 'lucide-react';
import { NeuralCore, type NeuralCoreStatus } from './NeuralCore';
import { HudWindow } from './HudWindow';
import {
  useWindowManager,
  WINDOW_META,
  WINDOW_ORDER,
  type WindowId,
} from './window-manager';
import { getBackground } from './backgrounds';
import type { Task } from '@/hooks/use-game-state';

export type HudNavId = 'inventory' | 'skills' | 'codex' | 'quests' | 'friends';

const AGI_TAGLINE =
  'Цифровой агент GAME. Управляй интерфейсом голосом или текстом: «закрой миссии», «открой карту», «смени фон», «сбрось окна». Двигай и меняй размер любого окна.';

export interface GameHudProps {
  rank: number;
  topPercent: string;
  time: string;
  date: string;
  temperature: number;
  missions: Task[];
  rewardXp: number;
  energy: number;
  focus: number;
  reputationLevel: number;
  balance: number;
  onlineCount: number;
  agiMessage: string;
  log: string[];
  promptText: string;
  input: string;
  isListening: boolean;
  isLoading: boolean;
  isCameraActive: boolean;
  isSpeechEnabled: boolean;
  isHandsFree: boolean;
  isCodeOpen: boolean;
  isDesktopOpen: boolean;
  isArchitectOpen: boolean;
  isModelsOpen: boolean;
  coreStatus: NeuralCoreStatus;
  activeNav: HudNavId;
  friendsBadge?: number;
  onInputChange: (value: string) => void;
  onSend: () => void;
  onToggleListen: () => void;
  onToggleCamera: () => void;
  onToggleSpeech: () => void;
  onToggleHandsFree: () => void;
  onToggleCode: () => void;
  onToggleDesktop: () => void;
  onToggleArchitect: () => void;
  onToggleModels: () => void;
  onNavChange: (id: HudNavId) => void;
  onMissionToggle: (taskId: string) => void;
  onKeyDown?: (e: KeyboardEvent) => void;
}

const NAV_ITEMS: { id: HudNavId; label: string; icon: ReactNode }[] = [
  { id: 'inventory', label: 'ИНВЕНТАРЬ', icon: <Briefcase size={20} /> },
  { id: 'skills', label: 'НАВЫКИ', icon: <Plus size={20} /> },
  { id: 'codex', label: 'КОДЕКС', icon: <Menu size={20} /> },
  { id: 'quests', label: 'КВЕСТЫ', icon: <BookOpen size={20} /> },
  { id: 'friends', label: 'ДРУЗЬЯ', icon: <Users size={20} /> },
];

const DEFAULT_MISSIONS = ['Завершить сценарий', 'Найти скрытые квесты', 'Прокачать репутацию'];

function WireframeGlobe() {
  return (
    <svg className="hud-globe" width="64" height="64" viewBox="0 0 72 72" fill="none" aria-hidden>
      <circle cx="36" cy="36" r="30" stroke="#a855f7" strokeWidth="0.8" opacity="0.8" />
      <ellipse cx="36" cy="36" rx="30" ry="12" stroke="#a855f7" strokeWidth="0.6" opacity="0.6" />
      <ellipse cx="36" cy="36" rx="12" ry="30" stroke="#a855f7" strokeWidth="0.6" opacity="0.6" />
      <path d="M6 36h60M36 6v60" stroke="#a855f7" strokeWidth="0.5" opacity="0.4" />
    </svg>
  );
}

function MinimapSvg() {
  return (
    <svg viewBox="0 0 120 120" className="opacity-90 w-full h-auto">
      <rect width="120" height="120" fill="rgba(10,8,30,0.6)" rx="4" />
      <path d="M20 80 Q40 40 60 50 T100 30" stroke="rgba(0,242,255,0.3)" strokeWidth="1" fill="none" />
      <path d="M15 90 L45 55 L75 70 L105 45" stroke="rgba(168,85,247,0.4)" strokeWidth="0.8" fill="none" />
      <circle cx="60" cy="58" r="3" fill="none" stroke="rgba(0,242,255,0.5)" />
      <polygon points="58,52 64,58 58,64 52,58" fill="#a855f7" />
    </svg>
  );
}

function AgiWaveform() {
  return (
    <div className="hud-wave" aria-hidden>
      {[1, 2, 3, 4, 5, 6, 7].map((i) => (
        <span key={i} />
      ))}
    </div>
  );
}

function SystemStatusIcon() {
  return (
    <svg width="36" height="36" viewBox="0 0 40 40" fill="none" aria-hidden>
      <circle cx="20" cy="20" r="16" stroke="#00f2ff" strokeWidth="1" opacity="0.5" />
      <circle cx="20" cy="20" r="10" stroke="#a855f7" strokeWidth="0.8" opacity="0.7" />
      <path d="M20 4v8M20 28v8M4 20h8M28 20h8" stroke="#00f2ff" strokeWidth="0.6" opacity="0.4" />
    </svg>
  );
}

function HudDock() {
  const wm = useWindowManager();
  const bg = getBackground(wm.background);

  return (
    <div className="hud-dock">
      <div className="hud-dock-windows">
        {WINDOW_ORDER.map((id: WindowId) => {
          const win = wm.windows[id];
          const open = win?.open;
          return (
            <button
              key={id}
              type="button"
              className={`hud-dock-chip ${open ? 'is-open' : ''}`}
              onClick={() => (open ? wm.closeWindow(id) : wm.openWindow(id))}
              title={open ? 'Скрыть окно' : 'Показать окно'}
            >
              {WINDOW_META[id].title}
            </button>
          );
        })}
      </div>
      <div className="hud-dock-tools">
        <button
          type="button"
          className="hud-dock-tool"
          onClick={() => wm.cycleBackground()}
          title="Сменить фон"
        >
          <ImageIcon size={13} />
          <span>{bg.label}</span>
        </button>
        <button type="button" className="hud-dock-tool" onClick={() => wm.showAll()} title="Показать все окна">
          <Maximize2 size={13} />
          <span>Всё</span>
        </button>
        <button type="button" className="hud-dock-tool" onClick={() => wm.resetLayout()} title="Сбросить расположение">
          <RotateCcw size={13} />
          <span>Сброс</span>
        </button>
      </div>
    </div>
  );
}

export function GameHud(props: GameHudProps) {
  const {
    rank,
    topPercent,
    time,
    date,
    temperature,
    missions,
    rewardXp,
    energy,
    focus,
    reputationLevel,
    balance,
    onlineCount,
    agiMessage,
    log,
    promptText,
    input,
    isListening,
    isLoading,
    isCameraActive,
    isSpeechEnabled,
    isHandsFree,
    isCodeOpen,
    isDesktopOpen,
    isArchitectOpen,
    isModelsOpen,
    coreStatus,
    activeNav,
    friendsBadge = 2,
    onInputChange,
    onSend,
    onToggleListen,
    onToggleCamera,
    onToggleSpeech,
    onToggleHandsFree,
    onToggleCode,
    onToggleDesktop,
    onToggleArchitect,
    onToggleModels,
    onNavChange,
    onMissionToggle,
    onKeyDown,
  } = props;

  const wm = useWindowManager();
  const bg = getBackground(wm.background);
  const displayMissions =
    missions.length > 0 ? missions.filter((t) => t.status !== 'completed').slice(0, 4) : null;
  const outputLines = log.length > 0 ? log : agiMessage ? [agiMessage] : [];

  return (
    <div className="hud-root hud-adaptive">
      <div className="hud-bg" style={{ background: bg.css }} />
      {bg.scrim ? <div className="hud-bg-scrim" style={{ opacity: bg.scrim }} /> : null}
      <div className="hud-scanlines" />

      {/* Fixed identity core — the GAME synaptic nucleus, always centred. */}
      <div className="hud-core-stage">
        <div className={`hud-core hud-core-${coreStatus}`}>
          <div className="hud-core-halo" />
          <NeuralCore status={coreStatus} />
        </div>
        <p className="hud-core-caption">{promptText}</p>
      </div>

      <HudDock />

      {/* ===================== WINDOWS ===================== */}
      <HudWindow id="rank" accent="purple">
        <div className="hud-window-pad relative">
          <div className="hud-label">WORLD RANK</div>
          <div className="hud-rank-number hud-mono mt-1">#{rank}</div>
          <div className="hud-label mt-1">TOP {topPercent}%</div>
          <div className="absolute right-3 top-3 opacity-80">
            <WireframeGlobe />
          </div>
        </div>
      </HudWindow>

      <HudWindow id="clock" accent="cyan">
        <div className="hud-window-pad">
          <div className="hud-time hud-mono">{time}</div>
          <div className="text-sm text-white/70 mt-1 hud-mono">{date}</div>
          <div className="flex items-center gap-2 mt-3">
            <Sun size={18} className="text-amber-300" />
            <span className="text-lg font-medium">{temperature}°C</span>
          </div>
          <div className="flex items-center justify-between mt-3 gap-2">
            <span className="hud-label">SUNSET</span>
            <span className="hud-label flex items-center gap-1">
              <MapPin size={10} />
              MIAMI BEACH
            </span>
          </div>
        </div>
      </HudWindow>

      <HudWindow id="missions" accent="purple">
        <div className="hud-window-pad">
          <div className="flex flex-col gap-2.5">
            {displayMissions
              ? displayMissions.map((task) => (
                  <label key={task.id} className="hud-mission-item">
                    <input
                      type="checkbox"
                      checked={task.status === 'completed'}
                      onChange={() => onMissionToggle(task.id)}
                    />
                    <span className={task.status === 'completed' ? 'line-through opacity-50' : ''}>
                      {task.desc}
                    </span>
                  </label>
                ))
              : DEFAULT_MISSIONS.map((text, i) => (
                  <label key={i} className="hud-mission-item">
                    <input type="checkbox" readOnly />
                    <span>{text}</span>
                  </label>
                ))}
          </div>
          <div className="hud-label mt-3 pt-3 border-t border-white/10">
            НАГРАДА: {rewardXp.toLocaleString('ru-RU')} XP
          </div>
        </div>
      </HudWindow>

      <HudWindow id="minimap" accent="cyan">
        <div className="hud-window-pad">
          <div className="flex items-center gap-1 mb-2">
            <Star size={10} className="text-[var(--hud-purple)]" fill="currentColor" />
            <span className="hud-label text-[8px]">MIAMI BEACH</span>
          </div>
          <MinimapSvg />
          <div className="flex items-center gap-2 mt-2 text-[10px] text-white/70">
            <span className="hud-online-dot" />
            <span>ONLINE: {onlineCount.toLocaleString('en-US')}</span>
          </div>
        </div>
      </HudWindow>

      <HudWindow id="status" accent="cyan">
        <div className="hud-window-pad flex items-center justify-between gap-3">
          <div>
            <div className="text-base font-semibold tracking-wide">JARVIS AGI</div>
            <div className="flex items-center gap-2 mt-2 text-xs">
              <span className="hud-online-dot" />
              <span style={{ color: 'var(--hud-online)' }}>ONLINE</span>
            </div>
          </div>
          <SystemStatusIcon />
        </div>
      </HudWindow>

      <HudWindow id="agi" accent="cyan">
        <div className="hud-window-pad flex flex-col h-full">
          <div className="flex items-center gap-2">
            <Globe size={12} className="text-[var(--hud-cyan)]" />
            <span className="hud-label">AGI EXTENSION</span>
          </div>
          <h2 className="text-lg font-bold tracking-wide mt-2">ВСТРЕЧАЙТЕ, GAME.</h2>
          <AgiWaveform />
          <p className="hud-agi-text flex-1">{AGI_TAGLINE}</p>
        </div>
      </HudWindow>

      <HudWindow id="player" accent="magenta">
        <div className="hud-window-pad">
          <div className="flex items-center gap-2 mb-3">
            <Triangle size={12} className="text-[var(--hud-cyan)] fill-current" />
            <span className="hud-label">СТАТУС ИГРОКА</span>
          </div>
          <div className="space-y-3">
            <div>
              <div className="flex justify-between text-[10px] mb-1">
                <span className="hud-label">ЭНЕРГИЯ</span>
                <span className="hud-mono text-[var(--hud-cyan)]">{energy}%</span>
              </div>
              <div className="hud-progress-track">
                <div className="hud-progress-fill" style={{ width: `${energy}%` }} />
              </div>
            </div>
            <div>
              <div className="flex justify-between text-[10px] mb-1">
                <span className="hud-label">ФОКУС</span>
                <span className="hud-mono text-[var(--hud-cyan)]">{focus}%</span>
              </div>
              <div className="hud-progress-track">
                <div className="hud-progress-fill" style={{ width: `${focus}%` }} />
              </div>
            </div>
            <div className="flex justify-between pt-2 text-sm">
              <div>
                <div className="hud-label text-[8px]">РЕПУТАЦИЯ</div>
                <div className="font-semibold mt-0.5">LVL {reputationLevel}</div>
              </div>
              <div className="text-right">
                <div className="hud-label text-[8px]">БАЛАНС</div>
                <div className="font-semibold mt-0.5 hud-mono">$ {balance.toLocaleString('en-US')}</div>
              </div>
            </div>
          </div>
        </div>
      </HudWindow>

      {/* Always-available output window. */}
      <HudWindow id="output" accent="cyan" bodyClassName="hud-window-body-scroll">
        <div className="hud-output">
          {outputLines.length === 0 ? (
            <p className="hud-output-empty">Max17 на связи. Жду команду или сообщение…</p>
          ) : (
            outputLines.map((line, i) => (
              <p key={`${i}-${line.slice(0, 12)}`} className={`hud-output-line ${i === 0 ? 'is-latest' : ''}`}>
                {line}
              </p>
            ))
          )}
        </div>
      </HudWindow>

      {/* Always-available chat window. */}
      <HudWindow id="chat" accent="purple">
        <div className="hud-window-pad">
          <div className="hud-input-bar">
            <button
              type="button"
              className={`hud-icon-btn ${isCameraActive ? 'active' : ''}`}
              onClick={onToggleCamera}
              aria-label={isCameraActive ? 'Отключить камеру' : 'Включить камеру'}
            >
              <Camera size={18} />
            </button>
            <button
              type="button"
              className={`hud-icon-btn ${isSpeechEnabled ? 'active' : ''}`}
              onClick={onToggleSpeech}
              aria-label={isSpeechEnabled ? 'Отключить голос Max17' : 'Включить голос Max17'}
            >
              <Volume2 size={18} />
            </button>
            <button
              type="button"
              className={`hud-icon-btn ${isCodeOpen ? 'active' : ''}`}
              onClick={onToggleCode}
              aria-label={isCodeOpen ? 'Закрыть код-режим' : 'Код-режим (Qwen3-агент)'}
              title="Код-режим: Qwen3-агент с файлами и командами"
            >
              <Terminal size={18} />
            </button>
            <button
              type="button"
              className={`hud-icon-btn ${isDesktopOpen ? 'active' : ''}`}
              onClick={onToggleDesktop}
              aria-label={isDesktopOpen ? 'Закрыть desktop-режим' : 'Управление рабочим столом (с подтверждением)'}
              title="Рабочий стол: Qwen3 управляет macOS с подтверждением"
            >
              <Monitor size={18} />
            </button>
            <button
              type="button"
              className={`hud-icon-btn ${isArchitectOpen ? 'active' : ''}`}
              onClick={onToggleArchitect}
              aria-label={isArchitectOpen ? 'Закрыть архитектора' : 'Архитектор: ИИ предлагает ветки развития'}
              title="Архитектор: ИИ предлагает новые ветки развития"
            >
              <GitBranch size={18} />
            </button>
            <button
              type="button"
              className={`hud-icon-btn ${isModelsOpen ? 'active' : ''}`}
              onClick={onToggleModels}
              aria-label={isModelsOpen ? 'Закрыть выбор модели' : 'Выбор модели ИИ'}
              title="Выбор модели ИИ (Ollama / Gemini / Groq)"
            >
              <Cpu size={18} />
            </button>
            <button
              type="button"
              className={`hud-icon-btn ${isHandsFree ? 'active' : ''}`}
              onClick={onToggleHandsFree}
              aria-label={isHandsFree ? 'Выключить hands-free (вейк-слово/хлопок)' : 'Включить hands-free: «Макс17, проснись» или хлопок'}
              title='Hands-free: «Макс17, проснись» или хлопок'
            >
              <Ear size={18} />
            </button>
            <button
              type="button"
              className={`hud-icon-btn ${isListening ? 'active' : ''}`}
              onClick={onToggleListen}
              aria-label={isListening ? 'Остановить запись' : 'Голосовой ввод'}
            >
              <Mic size={18} />
            </button>
            <input
              value={input}
              onChange={(e) => onInputChange(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Скажите запрос или команду…"
              disabled={isLoading}
            />
            <button
              type="button"
              className="hud-icon-btn"
              onClick={onSend}
              disabled={isLoading || !input.trim()}
              aria-label="Отправить"
            >
              <Play size={18} fill="currentColor" />
            </button>
          </div>
        </div>
      </HudWindow>

      <nav className="hud-nav">
        {NAV_ITEMS.map(({ id, label, icon }) => (
          <button
            key={id}
            type="button"
            className={`hud-nav-item ${activeNav === id ? 'active' : ''}`}
            onClick={() => onNavChange(id)}
          >
            {icon}
            <span className="hud-nav-label">{label}</span>
            {id === 'friends' && friendsBadge > 0 && <span className="hud-nav-badge">{friendsBadge}</span>}
          </button>
        ))}
      </nav>
    </div>
  );
}
