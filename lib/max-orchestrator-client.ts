/**
 * Browser/server client for the MAX orchestrator endpoint (POST /api/max).
 * Reuses the basePath-aware path helper from max17-client.ts.
 */

import type { MaxSynthesis } from './agents/types';
import { getApiPath } from './max17-client';

export interface MaxOrchestratorResponse extends MaxSynthesis {
  ok?: boolean;
  error?: string;
}

export interface MaxOrchestratorPayload {
  text: string;
  locale?: string;
  sessionId?: string;
  userId?: string;
  metadata?: Record<string, unknown>;
  /** Deep mode: refine mission/answer/actions via the real model (slower). */
  deep?: boolean;
}

function headers(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = process.env.NEXT_PUBLIC_MAX17_API_TOKEN;
  if (token) h['x-max17-token'] = token;
  return h;
}

/** Run the full MAX + 7-agent pipeline on a user input and get the unified result. */
export async function runMaxOrchestrator(
  payload: MaxOrchestratorPayload,
): Promise<MaxOrchestratorResponse> {
  const response = await fetch(getApiPath('max'), {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(payload),
  });
  const data = (await response.json()) as MaxOrchestratorResponse;
  if (!response.ok) {
    throw new Error(data.error || `MAX request failed with status ${response.status}`);
  }
  return data;
}
