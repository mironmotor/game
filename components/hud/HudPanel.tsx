'use client';

import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

interface HudPanelProps {
  children: ReactNode;
  className?: string;
}

export function HudPanel({ children, className }: HudPanelProps) {
  return <div className={cn('hud-panel', className)}>{children}</div>;
}
