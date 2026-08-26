'use client';

import { useRef, type PointerEvent, type ReactNode } from 'react';
import { Minus, X } from 'lucide-react';
import { useWindowManager, type WindowId } from './window-manager';
import { useI18n } from '@/components/I18nProvider';
import type { MessageKey } from '@/lib/i18n/messages';

type Accent = 'cyan' | 'purple' | 'magenta';

interface DragState {
  mode: 'move' | 'resize';
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  originW: number;
  originH: number;
}

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

export function HudWindow({
  id,
  accent = 'cyan',
  bodyClassName = '',
  title: ownTitle,
  children,
}: {
  id: WindowId;
  accent?: Accent;
  bodyClassName?: string;
  /** Заголовок панели, созданной ядром: у неё нет ключа в словаре переводов. */
  title?: string;
  children: ReactNode;
}) {
  const wm = useWindowManager();
  const win = wm.windows[id];
  const { t } = useI18n();
  const title = ownTitle ?? t(WINDOW_TITLE_KEYS[id as keyof typeof WINDOW_TITLE_KEYS]);
  const drag = useRef<DragState | null>(null);

  if (!wm.hydrated || !win || !win.open) return null;

  const clampToViewport = (x: number, y: number) => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    return {
      x: Math.min(Math.max(x, -win.w + 96), vw - 48),
      y: Math.min(Math.max(y, 0), vh - 40),
    };
  };

  const beginDrag = (mode: 'move' | 'resize') => (e: PointerEvent) => {
    if (window.matchMedia('(max-width: 700px)').matches) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    wm.focusWindow(id);
    drag.current = {
      mode,
      startX: e.clientX,
      startY: e.clientY,
      originX: win.x,
      originY: win.y,
      originW: win.w,
      originH: win.h,
    };
  };

  const onPointerMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (d.mode === 'move') {
      const { x, y } = clampToViewport(d.originX + dx, d.originY + dy);
      wm.moveWindow(id, x, y);
    } else {
      wm.resizeWindow(id, d.originW + dx, d.originH + dy);
    }
  };

  const endDrag = (e: PointerEvent) => {
    if (drag.current) {
      (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
      drag.current = null;
    }
  };

  return (
    <section
      className={`hud-window hud-window-${accent} ${win.minimized ? 'is-minimized' : ''}`}
      data-window-id={id}
      style={{ left: win.x, top: win.y, width: win.w, height: win.minimized ? undefined : win.h, zIndex: win.z }}
      onPointerDown={() => wm.focusWindow(id)}
      aria-label={title}
    >
      <header
        className="hud-window-bar"
        onPointerDown={beginDrag('move')}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={() => wm.minimizeWindow(id)}
      >
        <span className="hud-window-title">{title}</span>
        <div className="hud-window-actions">
          <button
            type="button"
            className="hud-window-btn"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => wm.minimizeWindow(id)}
            aria-label={win.minimized ? t('common.expand') : t('common.collapse')}
            title={win.minimized ? t('common.expand') : t('common.collapse')}
          >
            <Minus size={13} />
          </button>
          <button
            type="button"
            className="hud-window-btn hud-window-btn-close"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => wm.closeWindow(id)}
            aria-label={t('common.close')}
            title={t('common.close')}
          >
            <X size={13} />
          </button>
        </div>
      </header>

      {!win.minimized && (
        <div className={`hud-window-body ${bodyClassName}`}>{children}</div>
      )}

      {!win.minimized && (
        <span
          className="hud-window-resize"
          onPointerDown={beginDrag('resize')}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          aria-hidden
        />
      )}
    </section>
  );
}
