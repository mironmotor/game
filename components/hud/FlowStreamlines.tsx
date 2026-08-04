'use client';

import type { Max17Flow } from '@/lib/max17-client';

/**
 * Navier-Stokes readout for the HUD.
 *
 * `flow.stream` is the velocity profile across the pipe the core is currently
 * pushing thought through: a parabola while laminar, a flat-topped profile
 * with eddies once turbulent. Drawing it directly means the strip shows the
 * shape of the load, not just a number.
 */

const REGIME_STYLE = {
  laminar: { colour: 'rgba(0, 242, 255, 0.85)', glow: 'rgba(0, 242, 255, 0.35)', label: 'ЛАМИНАРНЫЙ' },
  transitional: { colour: 'rgba(255, 193, 84, 0.85)', glow: 'rgba(255, 193, 84, 0.35)', label: 'ПЕРЕХОДНЫЙ' },
  turbulent: { colour: 'rgba(255, 106, 136, 0.9)', glow: 'rgba(255, 106, 136, 0.4)', label: 'ТУРБУЛЕНТНЫЙ' },
} as const;

interface FlowStreamlinesProps {
  flow?: Max17Flow;
}

export function FlowStreamlines({ flow }: FlowStreamlinesProps) {
  const stream = flow?.stream;
  if (!flow || !stream || stream.length === 0) {
    return null;
  }

  const regime = flow.regime ?? 'laminar';
  const style = REGIME_STYLE[regime] ?? REGIME_STYLE.laminar;
  const peak = Math.max(...stream, 1e-6);

  return (
    <span className="inline-flex items-center gap-1.5 align-middle" title={flow.advice}>
      <span aria-hidden className="inline-flex h-[10px] items-end gap-[2px]">
        {stream.map((velocity, index) => (
          <span
            key={index}
            className="w-[2px] rounded-[1px]"
            style={{
              // Keep a sliver visible at the walls so the pipe still reads as a pipe.
              height: `${Math.max(12, (velocity / peak) * 100)}%`,
              background: style.colour,
              boxShadow: `0 0 4px ${style.glow}`,
            }}
          />
        ))}
      </span>
      <span style={{ color: style.colour }}>{style.label}</span>
      <span className="text-white/30">Re {Math.round(flow.reynolds ?? 0)}</span>
    </span>
  );
}
