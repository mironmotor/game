/**
 * Minimal typed pub/sub used as the internal nervous system of MAX.
 *
 * Agents publish lifecycle events; MAX subscribes centrally to collect every
 * agent result in one place (`agent:completed` / `agent:error`). This is what
 * makes MAX a *subscriber* to all seven agents rather than a caller that has to
 * thread results around by hand.
 */

import type { AgentInput, AgentResult, AgentTask, MaxSynthesis } from './types';

export type AgentEventName =
  | 'agent:started'
  | 'agent:completed'
  | 'agent:error'
  | 'max:synthesis_started'
  | 'max:synthesis_completed';

/** Strongly-typed payload per event. */
export interface AgentEventMap {
  'agent:started': { task: AgentTask };
  'agent:completed': { result: AgentResult };
  'agent:error': { result: AgentResult };
  'max:synthesis_started': { runId: string; input: AgentInput; results: AgentResult[] };
  'max:synthesis_completed': { runId: string; synthesis: MaxSynthesis };
}

export type EventHandler<E extends AgentEventName> = (payload: AgentEventMap[E]) => void;

export class EventBus {
  // Internal storage is loosely typed; the public API (on/emit) stays strict.
  private handlers = new Map<AgentEventName, Set<(payload: any) => void>>();

  /** Subscribe. Returns an unsubscribe function. */
  on<E extends AgentEventName>(event: E, handler: EventHandler<E>): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as (payload: any) => void);
    return () => this.off(event, handler);
  }

  off<E extends AgentEventName>(event: E, handler: EventHandler<E>): void {
    this.handlers.get(event)?.delete(handler as (payload: any) => void);
  }

  /** Subscribe once; auto-unsubscribes after the first emit. */
  once<E extends AgentEventName>(event: E, handler: EventHandler<E>): () => void {
    const off = this.on(event, (payload) => {
      off();
      handler(payload);
    });
    return off;
  }

  emit<E extends AgentEventName>(event: E, payload: AgentEventMap[E]): void {
    const set = this.handlers.get(event);
    if (!set) return;
    // Snapshot so once()-style unsubscribes during dispatch are safe.
    for (const handler of Array.from(set)) {
      try {
        handler(payload);
      } catch (err) {
        // A misbehaving subscriber must never break the orchestration loop.
        console.error(`[EventBus] handler for "${event}" threw`, err);
      }
    }
  }

  clear(): void {
    this.handlers.clear();
  }
}
