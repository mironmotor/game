/**
 * Server-side LlmCaller backed by Max17's Gonka bridge (the `llm_raw` event —
 * a single prompt → text, no memory/web/synapses). Used to ground the MAX
 * agents in real model reasoning when deep mode is on.
 */

import { sendToDaemon } from '@/app/api/max17/max17-daemon';
import type { LlmCaller } from '@/lib/agents/types';

const LLM_TIMEOUT_MS = 30000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`llm timeout after ${ms}ms`)), ms)),
  ]);
}

export const max17Llm: LlmCaller = async (prompt, opts) => {
  try {
    const res = (await withTimeout(
      sendToDaemon({ type: 'llm_raw', text: prompt, system: opts?.system, json: opts?.json === true }),
      LLM_TIMEOUT_MS,
    )) as { llm_text?: string };
    return String(res?.llm_text ?? '');
  } catch (err) {
    console.error('[max17Llm] call failed', err);
    return '';
  }
};
