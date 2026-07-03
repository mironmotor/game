'use client';

import type { ReactNode, KeyboardEvent } from 'react';
import {
  Briefcase,
  BookOpen,
  Globe,
  MapPin,
  Menu,
  Mic,
  Play,
  Plus,
  Star,
  Sun,
  Triangle,
  Users,
} from 'lucide-react';
import { HudPanel } from './HudPanel';
import CoreOrb from './CoreOrb';
import type { Task } from '@/hooks/use-game-state';

export type HudNavId = 'inventory' | 'skills' | 'codex' | 'quests' | 'friends';

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
  promptText: string;
  input: string;
  isListening: boolean;
  isLoading: boolean;
  activeNav: HudNavId;
  friendsBadge?: number;
  onInputChange: (value: string) => void;
  onSend: () => void;
  onToggleListen: () => void;
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

const DEFAULT_MISSIONS = [
  'Завершить сценарий',
  'Найти скрытые квесты',
  'Прокачать репутацию',
];

function WireframeGlobe() {
  return (
    <svg className="hud-globe" width="72" height="72" viewBox="0 0 72 72" fill="none" aria-hidden>
      <circle cx="36" cy="36" r="30" stroke="#a855f7" strokeWidth="0.8" opacity="0.8" />
      <ellipse cx="36" cy="36" rx="30" ry="12" stroke="#a855f7" strokeWidth="0.6" opacity="0.6" />
      <ellipse cx="36" cy="36" rx="12" ry="30" stroke="#a855f7" strokeWidth="0.6" opacity="0.6" />
      <path d="M6 36h60M36 6v60" stroke="#a855f7" strokeWidth="0.5" opacity="0.4" />
    </svg>
  );
}

function MinimapSvg() {
  return (
    <svg viewBox="0 0 120 120" className="opacity-90">
      <rect width="120" height="120" fill="rgba(10,8,30,0.6)" rx="4" />
      <path
        d="M20 80 Q40 40 60 50 T100 30"
        stroke="rgba(0,242,255,0.3)"
        strokeWidth="1"
        fill="none"
      />
      <path
        d="M15 90 L45 55 L75 70 L105 45"
        stroke="rgba(168,85,247,0.4)"
        strokeWidth="0.8"
        fill="none"
      />
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
    <svg width="40" height="40" viewBox="0 0 40 40" fill="none" aria-hidden>
      <circle cx="20" cy="20" r="16" stroke="#00f2ff" strokeWidth="1" opacity="0.5" />
      <circle cx="20" cy="20" r="10" stroke="#a855f7" strokeWidth="0.8" opacity="0.7" />
      <path d="M20 4v8M20 28v8M4 20h8M28 20h8" stroke="#00f2ff" strokeWidth="0.6" opacity="0.4" />
    </svg>
  );
}

export function GameHud({
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
  promptText,
  input,
  isListening,
  isLoading,
  activeNav,
  friendsBadge = 2,
  onInputChange,
  onSend,
  onToggleListen,
  onNavChange,
  onMissionToggle,
  onKeyDown,
}: GameHudProps) {
  const displayMissions =
    missions.length > 0
      ? missions.filter((t) => t.status !== 'completed').slice(0, 3)
      : null;

  return (
    <div className="hud-root">
      <div
        className="hud-bg"
        style={{
          backgroundImage:
            'url(https://images.unsplash.com/photo-1544551763-46a013bb70d5?w=1920&q=80)',
        }}
      />
      <div className="hud-scanlines" />

      <div className="hud-grid">
        <div className="hud-col-left">
          <HudPanel className="relative p-4 pr-16">
            <div className="hud-label">WORLD RANK</div>
            <div className="hud-rank-number hud-mono mt-1">#{rank}</div>
            <div className="hud-label mt-1">TOP {topPercent}%</div>
            <WireframeGlobe />
          </HudPanel>

          <HudPanel className="p-4">
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
          </HudPanel>

          <HudPanel className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <Star size={14} className="text-[var(--hud-purple)]" fill="currentColor" />
              <span className="hud-label hud-label-purple text-[11px] tracking-widest">
                МИССИИ
              </span>
            </div>
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
            <div className="hud-label mt-4 pt-3 border-t border-white/10">
              НАГРАДА: {rewardXp.toLocaleString('ru-RU')} XP
            </div>
          </HudPanel>
        </div>

        <div className="hud-col-right">
          <HudPanel className="p-4 flex items-center justify-between gap-3">
            <div>
              <div className="hud-label">SYSTEM STATUS</div>
              <div className="text-base font-semibold mt-1 tracking-wide">JARVIS AGI</div>
              <div className="flex items-center gap-2 mt-2 text-xs">
                <span className="hud-online-dot" />
                <span style={{ color: 'var(--hud-online)' }}>ONLINE</span>
              </div>
            </div>
            <SystemStatusIcon />
          </HudPanel>

          <HudPanel className="p-4 flex-1 min-h-[200px] flex flex-col">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <Globe size={12} className="text-[var(--hud-cyan)]" />
                <span className="hud-label">AGI EXTENSION</span>
              </div>
              <button type="button" className="text-white/30 text-lg leading-none" aria-label="Меню">
                ···
              </button>
            </div>
            <h2 className="text-lg font-bold tracking-wide mt-2">ВСТРЕЧАЙТЕ, GAME.</h2>
            <AgiWaveform />
            <p className="hud-agi-text flex-1">
              {agiMessage ||
                'Цифровой агент нового поколения, созданный помогать вам достигать целей и решать сложные задачи. GAME анализирует контекст, предлагает квесты и ведёт вас к результату.'}
            </p>
          </HudPanel>

          <HudPanel className="p-4">
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
                  <div className="font-semibold mt-0.5 hud-mono">
                    $ {balance.toLocaleString('en-US')}
                  </div>
                </div>
              </div>
            </div>
          </HudPanel>
        </div>

        <div className="hud-minimap-wrap">
          <HudPanel className="p-3">
            <div className="flex items-center gap-1 mb-2">
              <Star size={10} className="text-[var(--hud-purple)]" fill="currentColor" />
              <span className="hud-label text-[8px]">MIAMI BEACH</span>
            </div>
            <div className="hud-minimap">
              <MinimapSvg />
            </div>
            <div className="flex items-center gap-2 mt-2 text-[10px] text-white/70">
              <span className="hud-online-dot" />
              <span>ONLINE: {onlineCount.toLocaleString('en-US')}</span>
            </div>
          </HudPanel>
        </div>

        <div className="hud-col-center">
          <button
            type="button"
            className={`hud-orb ${isListening ? 'listening' : ''}`}
            onClick={onToggleListen}
            aria-label={isListening ? 'Выключить режим уха' : 'Голосовой вызов — режим уха'}
            aria-pressed={isListening}
          >
            <CoreOrb listening={isListening} />
            <span className="hud-orb-tri" />
            {isListening && (
              <>
                <span className="hud-orb-sonar" />
                <span className="hud-orb-sonar s2" />
                <span className="hud-orb-sonar s3" />
              </>
            )}
          </button>
          <p className="hud-prompt">{promptText}</p>
          <div className="hud-input-bar">
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
              placeholder="Скажите ваш запрос..."
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
              {id === 'friends' && friendsBadge > 0 && (
                <span className="hud-nav-badge">{friendsBadge}</span>
              )}
            </button>
          ))}
        </nav>
      </div>
    </div>
  );
}
