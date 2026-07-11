/**
 * Default adapters / stores for the agent system.
 *
 * Vision & Voice ship as honest *null* adapters: they report "not connected"
 * instead of inventing scene/voice data. The Memory store is a real (but
 * in-memory, non-persistent) implementation of the MemoryStore boundary, ready
 * to be swapped for the Max17 core or any database later.
 */

import { clamp01, tokenize } from './nlp';
import type {
  MemoryPattern,
  MemoryRecord,
  MemoryStore,
  VisionInputAdapter,
  VisionObservation,
  VoiceInputAdapter,
  VoiceObservation,
} from './types';

/** No camera wired yet — say so honestly. Replace with a face-detect.ts-backed adapter. */
export class NullVisionAdapter implements VisionInputAdapter {
  isAvailable(): boolean {
    return false;
  }

  async observe(): Promise<VisionObservation> {
    return { available: false, description: 'No vision input connected.' };
  }
}

/** No microphone wired yet — say so honestly. Replace with a voice-signature.ts-backed adapter. */
export class NullVoiceAdapter implements VoiceInputAdapter {
  isAvailable(): boolean {
    return false;
  }

  async observe(): Promise<VoiceObservation> {
    return { available: false, description: 'No voice input connected.' };
  }
}

/**
 * In-memory MemoryStore — a genuine implementation of the stub interface (not
 * fake data): it actually recalls by token overlap and detects repeating
 * motifs. State lives for the process lifetime only. Swap for a persistent
 * store (e.g. Max17 Hippocampus) by implementing the same MemoryStore contract.
 */
export class InMemoryMemoryStore implements MemoryStore {
  private records: MemoryRecord[];

  constructor(seed: MemoryRecord[] = []) {
    this.records = [...seed];
  }

  async getRelevantMemories(query: string, limit = 5): Promise<MemoryRecord[]> {
    const q = new Set(tokenize(query));
    if (q.size === 0) return [];
    return this.records
      .map((record) => {
        const overlap = tokenize(record.text).filter((t) => q.has(t)).length;
        return { record, score: overlap };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((x) => ({ ...x.record, score: x.score }));
  }

  async saveMemory(record: MemoryRecord): Promise<MemoryRecord> {
    const saved: MemoryRecord = {
      ...record,
      id: record.id || `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      createdAt: record.createdAt || new Date().toISOString(),
    };
    this.records.push(saved);
    return saved;
  }

  async detectPatterns(records: MemoryRecord[] = this.records): Promise<MemoryPattern[]> {
    const freq = new Map<string, number>();
    for (const record of records) {
      for (const token of tokenize(record.text)) {
        if (token.length > 3) freq.set(token, (freq.get(token) || 0) + 1);
      }
    }
    return Array.from(freq.entries())
      .filter(([, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([term, count]) => ({
        summary: `Повторяющийся мотив: «${term}»`,
        evidenceCount: count,
        strength: clamp01(count / 5),
      }));
  }

  /** Test/util escape hatch. */
  all(): MemoryRecord[] {
    return [...this.records];
  }
}
