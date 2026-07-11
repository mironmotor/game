import type { AgentsConfig } from '@/lib/agents/types';

/**
 * MAX agent toggles. Flip any flag to false and MAX skips that agent during
 * routing (Guardian is also skipped from the final pass when disabled).
 *
 * This is the single user-facing knob; the rest of the system reads from here
 * via createMax().
 */
export const agentsConfig: AgentsConfig = {
  vision: true,
  voice: true,
  memory: true,
  strategy: true,
  product: true,
  growth: true,
  guardian: true,
};

export default agentsConfig;
