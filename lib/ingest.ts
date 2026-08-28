// Клиент Инбокса Макса: поток + промпт-критерий → фильтр через ядро (/api/max17).

import { appBasePath } from './base-path';

export interface IngestEntry {
  text: string;
  score: number;
  reason: string;
}

export interface IngestResult {
  ok: boolean;
  interest: string;
  source: string;
  total: number;
  kept: IngestEntry[];
  dropped: IngestEntry[];
  kept_count: number;
  dropped_count: number;
}

export async function ingestViaMax(interest: string, stream: string): Promise<IngestResult | null> {
  try {
    const res = await fetch(`${appBasePath}/api/max17`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'ingest', interest, stream }),
    });
    const data = await res.json();
    const g = data?.ingest;
    if (!g?.ok) return null;
    return g as IngestResult;
  } catch {
    return null;
  }
}
