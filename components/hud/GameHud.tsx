'use client';

import type { ReactNode, KeyboardEvent } from 'react';
import {
  BookOpen,
  Boxes,
  Briefcase,
  AudioLines,
  CalendarClock,
  Camera,
  Globe,
  Atom,
  HeartPulse,
  ShieldCheck,
  Infinity as InfinityIcon,
  Image as ImageIcon,
  MapPin,
  Maximize2,
  Menu,
  Cpu,
  Ear,
  GitBranch,
  Mic,
  Monitor,
  Paperclip,
  Terminal,
  Play,
  Plus,
  RotateCcw,
  Sparkles,
  Star,
  Sun,
  Triangle,
  Users,
  Volume2,
  Zap,
} from 'lucide-react';
import { NeuralCore, type NeuralCoreStatus } from './NeuralCore';
import { HudWindow } from './HudWindow';
import {
  useWindowManager,
  WINDOW_ORDER,
  type WindowId,
} from './window-manager';
import { getBackground } from './backgrounds';
import { HudGround } from './HudGround';
import { SolarSystem } from './SolarSystem';
import { UltraStar } from './UltraStar';
import type { Task } from '@/hooks/use-game-state';
import { useI18n } from '@/components/I18nProvider';
import type { MessageKey } from '@/lib/i18n/messages';

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
  isVoiceOpen: boolean;
  coreStatus: NeuralCoreStatus;
  activeNav: HudNavId;
  navBadges?: Partial<Record<HudNavId, number>>;
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
  onToggleVoice: () => void;
  onToggleAppearance?: () => void;
  onNavChange: (id: HudNavId) => void;
  onMissionToggle: (taskId: string) => void;
  /** Клик по демо-миссии новичка: завести её настоящей задачей и закрыть. */
  onDefaultMissionComplete: (label: string) => void;
  onKeyDown?: (e: KeyboardEvent) => void;
  /** Прикреплённый файл: Макс прочитает его вместе с сообщением. */
  onFilePick?: (file: File) => void;
  attachedName?: string;
  onAttachClear?: () => void;
}

const NAV_ITEMS: { id: HudNavId; labelKey: MessageKey; icon: ReactNode }[] = [
  { id: 'inventory', labelKey: 'nav.inventory', icon: <Briefcase size={20} /> },
  { id: 'skills', labelKey: 'nav.skills', icon: <Plus size={20} /> },
  { id: 'codex', labelKey: 'nav.codex', icon: <Menu size={20} /> },
  { id: 'quests', labelKey: 'nav.quests', icon: <BookOpen size={20} /> },
  { id: 'friends', labelKey: 'nav.friends', icon: <Users size={20} /> },
];

const DEFAULT_MISSIONS: MessageKey[] = [
  'mission.dailyFocus',
  'mission.systemCheck',
  'mission.learnSkill',
];

const WINDOW_TITLE_KEYS: Record<WindowId, MessageKey> = {
  rank: 'window.rank',
  clock: 'window.clock',
  missions: 'window.missions',
  minimap: 'window.map',
  status: 'window.system',
  agi: 'window.agi',
  player: 'window.player',
  output: 'window.output',
  chat: 'window.chat',
};

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

function HudDock({ onOpenAppearance }: { onOpenAppearance?: () => void }) {
  const wm = useWindowManager();
  const { t } = useI18n();

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
              title={open ? t('dock.hideWindow') : t('dock.showWindow')}
            >
              {t(WINDOW_TITLE_KEYS[id])}
            </button>
          );
        })}
      </div>
      <div className="hud-dock-tools">
        {/* Одна кнопка вместо двух. «Совет» открывал пустую панель и ждал
            вопроса, «Разгон» задавал его сам — на деле нужен был только второй
            шаг. Теперь кнопка сразу приносит разбор: что добить и что начать
            дальше, собранный из реально открытых задач. */}
        <button
          type="button"
          className="hud-dock-tool"
          onClick={() => window.dispatchEvent(new CustomEvent('angels:kickoff'))}
          title={t('dock.council')}
        >
          <Sparkles size={13} />
          <span>{t('dock.council')}</span>
        </button>
        <button
          type="button"
          className="hud-dock-tool"
          onClick={() => (onOpenAppearance ? onOpenAppearance() : wm.cycleBackground())}
          title={t('dock.appearance')}
        >
          <ImageIcon size={13} />
          <span>{t('dock.appearance')}</span>
        </button>
        <button
          type="button"
          className="hud-dock-tool"
          onClick={() => window.dispatchEvent(new CustomEvent('doctor:toggle'))}
          title={t('dock.doctor')}
        >
          <HeartPulse size={13} />
          <span>{t('dock.doctor')}</span>
        </button>
        <button
          type="button"
          className="hud-dock-tool"
          onClick={() => window.dispatchEvent(new CustomEvent('cyberlab:open'))}
          title="Cyber Lab: этичная безопасность, легальные лаборатории и bug bounty scope"
        >
          <ShieldCheck size={13} />
          <span>Cyber Lab</span>
        </button>
        <button
          type="button"
          className="hud-dock-tool"
          onClick={() => window.dispatchEvent(new CustomEvent('coreflow:open'))}
          title="Ядро MAX · Поток — живой 3D-аттрактор из синапсов ядра"
        >
          <Atom size={13} />
          <span>Ядро 3D</span>
        </button>
        <button
          type="button"
          className="hud-dock-tool"
          onClick={() => window.dispatchEvent(new CustomEvent('world:toggle'))}
          title="Мир 3D — земля меты под интерфейсом: ядро, концепты графа, миссии, MirCoin"
        >
          <Boxes size={13} />
          <span>Мир 3D</span>
        </button>
        <button
          type="button"
          className="hud-dock-tool"
          onClick={() => window.dispatchEvent(new CustomEvent('phase:toggle'))}
          title={t('dock.phase')}
        >
          <CalendarClock size={13} />
          <span>{t('dock.phase')}</span>
        </button>
        <button
          type="button"
          className="hud-dock-tool"
          onClick={() => window.dispatchEvent(new CustomEvent('reflection:toggle'))}
          title={t('dock.reflection')}
        >
          <InfinityIcon size={13} />
          <span>{t('dock.reflection')}</span>
        </button>
        <button
          type="button"
          className="hud-dock-tool"
          onClick={() => window.dispatchEvent(new CustomEvent('aura:toggle'))}
          title={t('dock.aura')}
        >
          <AudioLines size={13} />
          <span>{t('dock.aura')}</span>
        </button>
        <button type="button" className="hud-dock-tool" onClick={() => wm.showAll()} title={t('dock.all')}>
          <Maximize2 size={13} />
          <span>{t('dock.all')}</span>
        </button>
        <button type="button" className="hud-dock-tool" onClick={() => wm.resetLayout()} title={t('dock.reset')}>
          <RotateCcw size={13} />
          <span>{t('dock.reset')}</span>
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
    isVoiceOpen,
    coreStatus,
    activeNav,
    navBadges = {},
    onInputChange,
    onSend,
    onFilePick,
    attachedName,
    onAttachClear,
    onToggleListen,
    onToggleCamera,
    onToggleSpeech,
    onToggleHandsFree,
    onToggleCode,
    onToggleDesktop,
    onToggleArchitect,
    onToggleModels,
    onToggleVoice,
    onToggleAppearance,
    onNavChange,
    onMissionToggle,
    onDefaultMissionComplete,
    onKeyDown,
  } = props;

  const wm = useWindowManager();
  const bg = getBackground(wm.background);
  const { t, formatNumber } = useI18n();
  const displayMissions =
    missions.length > 0 ? missions.filter((t) => t.status !== 'completed').slice(0, 4) : null;
  const outputLines = log.length > 0 ? log : agiMessage ? [agiMessage] : [];

  return (
    <div className="hud-root hud-adaptive">
      <div className="hud-bg" style={{ background: bg.css }} />
      {bg.scrim ? <div className="hud-bg-scrim" style={{ opacity: bg.scrim }} /> : null}
      <SolarSystem className="hud-synapse-field" />
      <UltraStar />
      <HudGround
        coreStatus={coreStatus}
        missions={missions}
        balance={balance}
        isCameraActive={isCameraActive}
        onToggleCamera={onToggleCamera}
        onOpenMissions={() => wm.openWindow('missions')}
      />
      <div className="hud-scanlines" />

      {/* Fixed identity core — the GAME synaptic nucleus, always centred. */}
      <div className="hud-core-stage">
        <div className={`hud-core hud-core-${coreStatus}`}>
          <div className="hud-core-halo" />
          <NeuralCore status={coreStatus} />
        </div>
        <p className="hud-core-caption">{promptText}</p>
      </div>

      <HudDock onOpenAppearance={onToggleAppearance} />

      {/* ===================== WINDOWS ===================== */}
      <div className="hud-windows">
      <HudWindow id="rank" accent="purple">
        <div className="hud-window-pad relative">
          <div className="hud-label">{t('hud.worldRank')}</div>
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
            <span className="hud-label">{t('hud.sunset')}</span>
            <span className="hud-label flex items-center gap-1">
              <MapPin size={10} />
              {t('hud.location')}
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
              : DEFAULT_MISSIONS.map((key) => (
                  // Демо-миссии для новичка. Раньше чекбокс был readOnly — он
                  // физически не отмечался, и человек думал, что интерфейс сломан.
                  // Теперь клик заводит настоящую задачу и сразу её закрывает.
                  <label key={key} className="hud-mission-item">
                    <input
                      type="checkbox"
                      checked={false}
                      onChange={() => onDefaultMissionComplete(t(key))}
                    />
                    <span>{t(key)}</span>
                  </label>
                ))}
          </div>
          <div className="hud-label mt-3 pt-3 border-t border-white/10">
            {t('hud.reward')}: {formatNumber(rewardXp)} XP
          </div>
        </div>
      </HudWindow>

      <HudWindow id="minimap" accent="cyan">
        <div className="hud-window-pad">
          <div className="flex items-center gap-1 mb-2">
            <Star size={10} className="text-[var(--hud-purple)]" fill="currentColor" />
            <span className="hud-label text-[8px]">{t('hud.location')}</span>
          </div>
          <MinimapSvg />
          <div className="flex items-center gap-2 mt-2 text-[10px] text-white/70">
            <span className="hud-online-dot" />
            <span>{t('common.online')}: {formatNumber(onlineCount)}</span>
          </div>
        </div>
      </HudWindow>

      <HudWindow id="status" accent="cyan">
        <div className="hud-window-pad flex items-center justify-between gap-3">
          <div>
            <div className="text-base font-semibold tracking-wide">JARVIS AGI</div>
            <div className="flex items-center gap-2 mt-2 text-xs">
              <span className="hud-online-dot" />
              <span style={{ color: 'var(--hud-online)' }}>{t('common.online')}</span>
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
          <h2 className="text-lg font-bold tracking-wide mt-2">{t('hud.meetGame')}</h2>
          <AgiWaveform />
          <p className="hud-agi-text flex-1">{t('hud.tagline')}</p>
        </div>
      </HudWindow>

      <HudWindow id="player" accent="magenta">
        <div className="hud-window-pad">
          <div className="flex items-center gap-2 mb-3">
            <Triangle size={12} className="text-[var(--hud-cyan)] fill-current" />
            <span className="hud-label">{t('hud.playerStatus')}</span>
          </div>
          <div className="space-y-3">
            <div>
              <div className="flex justify-between text-[10px] mb-1">
                <span className="hud-label">{t('hud.energy')}</span>
                <span className="hud-mono text-[var(--hud-cyan)]">{energy}%</span>
              </div>
              <div className="hud-progress-track">
                <div className="hud-progress-fill" style={{ width: `${energy}%` }} />
              </div>
            </div>
            <div>
              <div className="flex justify-between text-[10px] mb-1">
                <span className="hud-label">{t('hud.focus')}</span>
                <span className="hud-mono text-[var(--hud-cyan)]">{focus}%</span>
              </div>
              <div className="hud-progress-track">
                <div className="hud-progress-fill" style={{ width: `${focus}%` }} />
              </div>
            </div>
            <div className="flex justify-between pt-2 text-sm">
              <div>
                <div className="hud-label text-[8px]">{t('hud.reputation')}</div>
                <div className="font-semibold mt-0.5">LVL {reputationLevel}</div>
              </div>
              <button
                type="button"
                onClick={() => window.dispatchEvent(new CustomEvent('mircoin:toggle'))}
                className="text-right transition hover:opacity-80"
                title={t('hud.wallet')}
              >
                <div className="hud-label text-[8px]">MIRCOIN</div>
                <div className="font-semibold mt-0.5 hud-mono">Ⓜ {formatNumber(balance)}</div>
              </button>
            </div>
          </div>
        </div>
      </HudWindow>

      {/* Always-available output window. */}
      <HudWindow id="output" accent="cyan" bodyClassName="hud-window-body-scroll">
        <div className="hud-output">
          {outputLines.length === 0 ? (
            <p className="hud-output-empty">{t('hud.outputReady')}</p>
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
          {attachedName && (
            <div className="hud-attach-chip">
              <Paperclip size={12} />
              <span className="truncate">{attachedName}</span>
              <button type="button" onClick={onAttachClear} aria-label="Убрать файл">×</button>
            </div>
          )}
          <div className="hud-input-bar">
            <label className="hud-icon-btn" title="Прикрепить файл — Макс его прочитает" aria-label="Прикрепить файл">
              <Paperclip size={18} />
              <input
                type="file"
                hidden
                accept=".txt,.md,.csv,.json,.log,.py,.ts,.tsx,.js,.html,.xml,.yml,.yaml,text/*,image/*,video/*"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f && onFilePick) onFilePick(f);
                  e.target.value = '';
                }}
              />
            </label>
            <button
              type="button"
              className={`hud-icon-btn ${isCameraActive ? 'active' : ''}`}
              onClick={onToggleCamera}
              aria-label={t('hud.camera')}
            >
              <Camera size={18} />
            </button>
            <button
              type="button"
              className={`hud-icon-btn ${isSpeechEnabled ? 'active' : ''}`}
              onClick={onToggleSpeech}
              aria-label={isSpeechEnabled ? t('hud.soundOff') : t('hud.soundOn')}
            >
              <Volume2 size={18} />
            </button>
            <button
              type="button"
              className={`hud-icon-btn ${isCodeOpen ? 'active' : ''}`}
              onClick={onToggleCode}
              aria-label={t('hud.terminal')}
              title={t('hud.terminal')}
            >
              <Terminal size={18} />
            </button>
            <button
              type="button"
              className={`hud-icon-btn ${isDesktopOpen ? 'active' : ''}`}
              onClick={onToggleDesktop}
              aria-label={t('hud.desktop')}
              title={t('hud.desktop')}
            >
              <Monitor size={18} />
            </button>
            <button
              type="button"
              className={`hud-icon-btn ${isArchitectOpen ? 'active' : ''}`}
              onClick={onToggleArchitect}
              aria-label={t('hud.architect')}
              title={t('hud.architect')}
            >
              <GitBranch size={18} />
            </button>
            <button
              type="button"
              className={`hud-icon-btn ${isModelsOpen ? 'active' : ''}`}
              onClick={onToggleModels}
              aria-label={t('hud.models')}
              title={t('hud.models')}
            >
              <Cpu size={18} />
            </button>
            <button
              type="button"
              className={`hud-icon-btn ${isVoiceOpen ? 'active' : ''}`}
              onClick={onToggleVoice}
              aria-label={isVoiceOpen ? 'Закрыть голос Макса' : 'Голос Макса: состояние по голосу'}
              title="Голос Макса: читает состояние по голосу (возбуждение / позитив / напряжение)"
            >
              <AudioLines size={18} />
            </button>
            <button
              type="button"
              className={`hud-icon-btn ${isHandsFree ? 'active' : ''}`}
              onClick={onToggleHandsFree}
              aria-label={isHandsFree ? t('hud.handsFreeOff') : t('hud.handsFreeOn')}
              title={t('hud.handsFreeTitle')}
            >
              <Ear size={18} />
            </button>
            <button
              type="button"
              className={`hud-icon-btn ${isListening ? 'active' : ''}`}
              onClick={onToggleListen}
              aria-label={isListening ? t('hud.stopRecording') : t('hud.voiceInput')}
            >
              <Mic size={18} />
            </button>
            <input
              value={input}
              onChange={(e) => onInputChange(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={t('hud.inputPlaceholder')}
              disabled={isLoading}
              dir="auto"
            />
            <button
              type="button"
              className="hud-icon-btn hud-send-btn"
              onClick={() => onSend()}
              disabled={isLoading || !input.trim()}
              aria-label={t('common.send')}
              title={t('hud.sendTitle')}
              data-testid="max17-send"
            >
              <Play size={18} fill="currentColor" />
            </button>
          </div>
        </div>
      </HudWindow>

      {/* Панели, показанные ядром: результат работы, а не пересказ о нём.
          Живут рядом со штатными окнами — двигаются, сворачиваются, закрываются. */}
      {Object.values(wm.panels).map((panel) => (
        <HudWindow key={panel.id} id={panel.id} title={panel.title} accent="cyan">
          <div className="hud-window-pad">
            {panel.kind === 'image' ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={panel.body} alt={panel.title} className="max-h-full w-full rounded object-contain" />
            ) : panel.kind === 'code' ? (
              <pre className="hud-mono overflow-auto whitespace-pre text-[11px] leading-relaxed text-cyan-50/90">
                {panel.body}
              </pre>
            ) : (
              <div className="overflow-auto whitespace-pre-wrap text-[12px] leading-relaxed text-white/85">
                {panel.body}
              </div>
            )}
          </div>
        </HudWindow>
      ))}
      </div>

      <nav className="hud-nav">
        {NAV_ITEMS.map(({ id, labelKey, icon }) => (
          <button
            key={id}
            type="button"
            className={`hud-nav-item ${activeNav === id ? 'active' : ''}`}
            onClick={() => onNavChange(id)}
          >
            {icon}
            <span className="hud-nav-label">{t(labelKey)}</span>
            {(navBadges[id] ?? 0) > 0 && <span className="hud-nav-badge">{navBadges[id]}</span>}
          </button>
        ))}
      </nav>
    </div>
  );
}
