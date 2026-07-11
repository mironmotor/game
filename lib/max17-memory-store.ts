/**
 * Max17-backed MemoryStore (server only).
 *
 * Implements the agent MemoryStore boundary on top of the real Max17 core via
 * the persistent daemon (mark17/serve.py). One `user_message` event both recalls
 * relevant memories AND lets Max17 store/consolidate the turn — so saveMemory()
 * is a no-op writer (the turn is already persisted), and detectPatterns() reads
 * the consolidation from the same cached response (one daemon round-trip per run).
 *
 * Degrades gracefully: if the daemon is down, recall returns [] and MAX still
 * produces an answer (the Memory Agent just reports a fresh context).
 */

import { sendToDaemon } from '@/app/api/max17/max17-daemon';
import type { MemoryPattern, MemoryRecord, MemoryStore, OutcomeMemory } from '@/lib/agents/types';
import type { Max17Response } from '@/lib/max17-client';

/** Keep recall off the critical path: if Max17 (Gonka voice + web sense) is slow,
 *  the council answers without memories instead of blocking for ~17s. */
const RECALL_TIMEOUT_MS = 2500;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`recall timeout after ${ms}ms`)), ms)),
  ]);
}

/** Only these event types are the user's actual content; everything else
 *  (web_fact, environment_observation, ultra_decision, task_created, voice/system…)
 *  is telemetry/external junk and never surfaced as a "memory". */
const KEEP_TYPES = /^(memory_store|user_message|remember|outcome_(success|failure|partial))$/i;

/** Pure telemetry / external junk — drop entirely (not the user's memories). */
const HARD_DROP =
  /routed to llm|status skipped|routed_to|evaluated_as|expresses intent|self.?eval|^(remember|task[_ ](created|completed)|web[_ ](fact|ingest|research)|ultra[_ ]decision|neural|dream|music|introspect|system[_ ]state|environment|voice[_ ]observation|consolidat)\b/i;

/** Strip the event-type prefix so a stored goal reads as a plain human memory. */
function cleanMemoryText(t: string): string {
  return t
    .replace(/^(memory[_ ]store|user[_ ]message|outcome[_ ](success|failure|partial)|action[_ ](done|skipped))\s+/i, '')
    .replace(/^(success|failure|partial|skipped):\s*/i, '')
    .replace(/^action (helped|did not work|partially worked|was skipped):\s*/i, '')
    .replace(/\s*Next:.*$/i, '')
    .replace(/\s*→.*$/, '') // drop the "→ mission" tail
    .trim();
}

export class Max17MemoryStore implements MemoryStore {
  private last: Max17Response | null = null;

  constructor(private timeoutMs: number = RECALL_TIMEOUT_MS) {}

  async getRelevantMemories(query: string, limit = 5): Promise<MemoryRecord[]> {
    if (!query.trim()) return [];
    try {
      // `memory_recall` is the fast, network-free path: graph + vector recall only,
      // no Gonka voice and no web sense (which a `user_message` would also trigger).
      const res = (await withTimeout(
        sendToDaemon({ type: 'memory_recall', text: query }),
        this.timeoutMs,
      )) as unknown as Max17Response;
      this.last = res;
      const recalled = [...(res.memory?.recalled ?? []), ...(res.memory?.semantic ?? [])];
      const seen = new Set<string>();
      return recalled
        .map((m) => ({
          id: m.id != null ? String(m.id) : undefined,
          raw: (m.text || m.summary || m.reinforce || '').trim(),
          kind: (m.event_type as MemoryRecord['kind']) || 'event',
          score: m.score ?? m.importance,
        }))
        .filter((r) => KEEP_TYPES.test(String(r.kind ?? ''))) // only real user content
        .filter((r) => r.raw && !HARD_DROP.test(r.raw)) // drop telemetry text (self-eval etc.)
        .map((r) => ({ id: r.id, text: cleanMemoryText(r.raw), kind: r.kind, score: r.score }))
        .filter((r) => r.text.length > 2)
        .filter((r) => {
          // Substring dedupe: collapse "X" and "X X" / "X → mission" into one.
          const key = r.text.toLowerCase();
          for (const k of seen) {
            if (k.includes(key) || key.includes(k)) return false;
          }
          seen.add(key);
          return true;
        })
        .slice(0, limit);
    } catch (err) {
      console.error('[Max17MemoryStore] recall failed', err);
      return [];
    }
  }

  async saveMemory(record: MemoryRecord): Promise<MemoryRecord> {
    const saved: MemoryRecord = {
      ...record,
      id: record.id || `max17_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      createdAt: record.createdAt || new Date().toISOString(),
    };
    // Fire-and-forget: persist the turn into Max17 (memory_store = graph + vector,
    // no voice/web) so the council remembers past goals/decisions — without
    // blocking the response.
    const mission = typeof record.metadata?.['mission'] === 'string' ? (record.metadata['mission'] as string) : undefined;
    void this.persist(saved.text, mission);
    return saved;
  }

  private async persist(text: string, note?: string): Promise<void> {
    if (!text.trim()) return;
    try {
      await withTimeout(
        sendToDaemon({ type: 'memory_store', text, note: note ? `${text} → ${note}` : text }),
        this.timeoutMs,
      );
    } catch (err) {
      console.error('[Max17MemoryStore] store failed', err);
    }
  }

  /** Outcomes (success/failure) relevant to the last recall — closes the loop. */
  lastOutcomes(): OutcomeMemory[] {
    const raw = this.last?.outcomes ?? [];
    return raw
      .map((o) => ({ text: (o.text || '').trim(), status: o.status || 'unknown', score: o.score }))
      .filter((o) => o.text);
  }

  async detectPatterns(): Promise<MemoryPattern[]> {
    const patterns = this.last?.consolidation?.patterns ?? [];
    return patterns.map((p) => ({
      id: p.pattern_id,
      summary: p.summary || 'Паттерн',
      evidenceCount: p.evidence_count,
      strength: p.strength,
    }));
  }
}
