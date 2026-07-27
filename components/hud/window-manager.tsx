'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  DEFAULT_BACKGROUND_ID,
  matchBackgroundId,
  nextBackgroundId,
} from './backgrounds';

export type WindowId =
  | 'rank'
  | 'clock'
  | 'missions'
  | 'minimap'
  | 'status'
  | 'agi'
  | 'player'
  | 'chat'
  | 'output';

export interface WindowMeta {
  id: WindowId;
  title: string;
  /** Whether this window may be permanently closed. Chat/output can be hidden
   * but are flagged so the UI always offers a quick way to bring them back. */
  essential?: boolean;
  minW: number;
  minH: number;
}

export const WINDOW_META: Record<WindowId, WindowMeta> = {
  rank: { id: 'rank', title: 'РАНГ В МИРЕ', minW: 180, minH: 96 },
  clock: { id: 'clock', title: 'ВРЕМЯ', minW: 180, minH: 120 },
  missions: { id: 'missions', title: 'МИССИИ', minW: 200, minH: 140 },
  minimap: { id: 'minimap', title: 'КАРТА', minW: 170, minH: 150 },
  status: { id: 'status', title: 'СТАТУС СИСТЕМЫ', minW: 200, minH: 96 },
  agi: { id: 'agi', title: 'AGI EXTENSION', minW: 220, minH: 140 },
  player: { id: 'player', title: 'СТАТУС ИГРОКА', minW: 220, minH: 160 },
  chat: { id: 'chat', title: 'ЧАТ С MAX17', essential: true, minW: 300, minH: 212 },
  output: { id: 'output', title: 'ВЫВОД MAX17', essential: true, minW: 280, minH: 130 },
};

export const WINDOW_ORDER: WindowId[] = [
  'rank',
  'clock',
  'missions',
  'minimap',
  'status',
  'agi',
  'player',
  'output',
  'chat',
];

export interface WindowState {
  id: WindowId;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  open: boolean;
  minimized: boolean;
}

type WindowMap = Record<WindowId, WindowState>;

const STORAGE_KEY = 'max17.hud.layout.v2';

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

/** Deterministic default layout derived from the current viewport so it scales
 * across laptop / phone / future AR canvas. */
function computeDefaultLayout(vw: number, vh: number): WindowMap {
  const pad = 16;
  const compact = vw <= 700;
  const leftW = clamp(Math.round(vw * 0.2), 200, 280);
  const rightW = clamp(Math.round(vw * 0.22), 230, 320);
  const chatW = clamp(Math.round(vw * 0.42), 320, 560);
  const outW = clamp(Math.round(vw * 0.32), 300, 440);

  const rightX = Math.max(pad, vw - rightW - pad);
  const outputX = Math.max(pad, vw - outW - pad);
  const place = (
    id: WindowId,
    x: number,
    y: number,
    w: number,
    h: number,
    z: number,
    open = true,
  ): WindowState => ({
    id,
    x: clamp(Math.round(x), 0, Math.max(0, vw - 80)),
    y: clamp(Math.round(y), 0, Math.max(0, vh - 60)),
    w: Math.round(w),
    h: Math.round(h),
    z,
    open,
    minimized: false,
  });

  return {
    rank: place('rank', pad, pad, leftW, 112, 1, !compact),
    clock: place('clock', pad, pad + 124, leftW, 150, 2, !compact),
    missions: place('missions', pad, pad + 286, leftW, 196, 3),
    minimap: place('minimap', pad, vh - 232, leftW, 180, 4, !compact),
    status: place('status', rightX, pad, rightW, 116, 5, !compact),
    agi: place('agi', rightX, pad + 128, rightW, 176, 6, !compact),
    player: place('player', rightX, pad + 316, rightW, 196, 7),
    output: place('output', outputX, vh - 304, outW, 200, 8),
    chat: place('chat', Math.round((vw - chatW) / 2), vh - 292, chatW, 216, 9),
  };
}

interface PersistShape {
  v: number;
  viewport?: 'compact' | 'desktop';
  background: string;
  windows: Partial<Record<WindowId, Partial<WindowState>>>;
}

function loadPersisted(): PersistShape | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistShape;
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

export interface WindowManager {
  hydrated: boolean;
  windows: WindowMap;
  background: string;
  openWindow: (id: WindowId) => void;
  closeWindow: (id: WindowId) => void;
  toggleWindow: (id: WindowId) => void;
  minimizeWindow: (id: WindowId, value?: boolean) => void;
  focusWindow: (id: WindowId) => void;
  moveWindow: (id: WindowId, x: number, y: number) => void;
  resizeWindow: (id: WindowId, w: number, h: number) => void;
  setBackground: (id: string) => void;
  cycleBackground: () => void;
  setBackgroundByName: (text: string) => boolean;
  showAll: () => void;
  closeAll: () => void;
  resetLayout: () => void;
}

const WindowManagerContext = createContext<WindowManager | null>(null);

export function WindowManagerProvider({ children }: { children: ReactNode }) {
  const [hydrated, setHydrated] = useState(false);
  const [windows, setWindows] = useState<WindowMap>(() =>
    computeDefaultLayout(1440, 900),
  );
  const [background, setBackgroundState] = useState<string>(DEFAULT_BACKGROUND_ID);
  const topZ = useRef(WINDOW_ORDER.length);

  // Hydrate from viewport + localStorage after mount (client-only) to avoid SSR
  // mismatch and to size the default layout against the real screen.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect --
       Hydrating the layout from the viewport size + localStorage is a legitimate
       external→React sync that can only happen after mount; gated by `hydrated`
       so nothing renders before this runs (no SSR mismatch). */
    const vw = window.innerWidth || 1440;
    const vh = window.innerHeight || 900;
    const defaults = computeDefaultLayout(vw, vh);
    const persisted = loadPersisted();
    const viewport = vw <= 700 ? 'compact' : 'desktop';
    const canRestoreLayout = persisted &&
      (persisted.viewport === viewport || (!persisted.viewport && viewport === 'desktop'));

    if (persisted) {
      if (typeof persisted.background === 'string') {
        setBackgroundState(persisted.background);
      }
    }

    if (canRestoreLayout) {
      const merged = { ...defaults };
      let maxZ = WINDOW_ORDER.length;
      for (const id of WINDOW_ORDER) {
        const saved = persisted.windows?.[id];
        if (saved) {
          const meta = WINDOW_META[id];
          merged[id] = {
            ...defaults[id],
            ...saved,
            id,
            w: Math.max(meta.minW, saved.w ?? defaults[id].w),
            h: Math.max(meta.minH, saved.h ?? defaults[id].h),
            // Keep windows on-screen even if the viewport shrank since last time.
            x: clamp(saved.x ?? defaults[id].x, 0, Math.max(0, vw - 80)),
            y: clamp(saved.y ?? defaults[id].y, 0, Math.max(0, vh - 60)),
          };
          maxZ = Math.max(maxZ, merged[id].z);
        }
      }
      topZ.current = maxZ;
      setWindows(merged);
    } else {
      setWindows(defaults);
    }
    setHydrated(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  // Debounced persistence.
  useEffect(() => {
    if (!hydrated) return;
    const timer = window.setTimeout(() => {
      try {
        const payload: PersistShape = {
          v: 2,
          viewport: window.innerWidth <= 700 ? 'compact' : 'desktop',
          background,
          windows: {},
        };
        for (const id of WINDOW_ORDER) {
          const w = windows[id];
          payload.windows[id] = {
            x: w.x,
            y: w.y,
            w: w.w,
            h: w.h,
            z: w.z,
            open: w.open,
            minimized: w.minimized,
          };
        }
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      } catch {
        /* storage unavailable — non-fatal */
      }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [windows, background, hydrated]);

  const patch = useCallback((id: WindowId, next: Partial<WindowState>) => {
    setWindows((prev) => ({ ...prev, [id]: { ...prev[id], ...next } }));
  }, []);

  const focusWindow = useCallback((id: WindowId) => {
    topZ.current += 1;
    const z = topZ.current;
    setWindows((prev) => ({ ...prev, [id]: { ...prev[id], z } }));
  }, []);

  const openWindow = useCallback((id: WindowId) => {
    topZ.current += 1;
    const z = topZ.current;
    setWindows((prev) => ({
      ...prev,
      [id]: { ...prev[id], open: true, minimized: false, z },
    }));
  }, []);

  const closeWindow = useCallback((id: WindowId) => {
    setWindows((prev) => ({ ...prev, [id]: { ...prev[id], open: false } }));
  }, []);

  const toggleWindow = useCallback((id: WindowId) => {
    setWindows((prev) => {
      const open = !prev[id].open;
      if (open) topZ.current += 1;
      return {
        ...prev,
        [id]: { ...prev[id], open, minimized: false, z: open ? topZ.current : prev[id].z },
      };
    });
  }, []);

  const minimizeWindow = useCallback((id: WindowId, value?: boolean) => {
    setWindows((prev) => ({
      ...prev,
      [id]: { ...prev[id], minimized: value ?? !prev[id].minimized },
    }));
  }, []);

  const moveWindow = useCallback(
    (id: WindowId, x: number, y: number) => patch(id, { x, y }),
    [patch],
  );

  const resizeWindow = useCallback(
    (id: WindowId, w: number, h: number) => {
      const meta = WINDOW_META[id];
      patch(id, { w: Math.max(meta.minW, w), h: Math.max(meta.minH, h) });
    },
    [patch],
  );

  const setBackground = useCallback((id: string) => setBackgroundState(id), []);
  const cycleBackground = useCallback(
    () => setBackgroundState((cur) => nextBackgroundId(cur)),
    [],
  );
  const setBackgroundByName = useCallback((text: string) => {
    const id = matchBackgroundId(text);
    if (id) {
      setBackgroundState(id);
      return true;
    }
    return false;
  }, []);

  const showAll = useCallback(() => {
    setWindows((prev) => {
      const next = { ...prev };
      for (const id of WINDOW_ORDER) {
        next[id] = { ...prev[id], open: true, minimized: false };
      }
      return next;
    });
  }, []);

  const closeAll = useCallback(() => {
    // Keep the essential chat/output windows so the user is never stranded.
    setWindows((prev) => {
      const next = { ...prev };
      for (const id of WINDOW_ORDER) {
        if (WINDOW_META[id].essential) continue;
        next[id] = { ...prev[id], open: false };
      }
      return next;
    });
  }, []);

  const resetLayout = useCallback(() => {
    const vw = window.innerWidth || 1440;
    const vh = window.innerHeight || 900;
    topZ.current = WINDOW_ORDER.length;
    setWindows(computeDefaultLayout(vw, vh));
    setBackgroundState(DEFAULT_BACKGROUND_ID);
  }, []);

  const value = useMemo<WindowManager>(
    () => ({
      hydrated,
      windows,
      background,
      openWindow,
      closeWindow,
      toggleWindow,
      minimizeWindow,
      focusWindow,
      moveWindow,
      resizeWindow,
      setBackground,
      cycleBackground,
      setBackgroundByName,
      showAll,
      closeAll,
      resetLayout,
    }),
    [
      hydrated,
      windows,
      background,
      openWindow,
      closeWindow,
      toggleWindow,
      minimizeWindow,
      focusWindow,
      moveWindow,
      resizeWindow,
      setBackground,
      cycleBackground,
      setBackgroundByName,
      showAll,
      closeAll,
      resetLayout,
    ],
  );

  return (
    <WindowManagerContext.Provider value={value}>
      {children}
    </WindowManagerContext.Provider>
  );
}

export function useWindowManager(): WindowManager {
  const ctx = useContext(WindowManagerContext);
  if (!ctx) {
    throw new Error('useWindowManager must be used within WindowManagerProvider');
  }
  return ctx;
}
