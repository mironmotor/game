"""News feature engine (Stage 3).

Aggregates the normalized event stream into a point-in-time state for any
timestamp, using only events at or before that time (no look-ahead). Output
feeds the News Shock Engine and the risk layer's "news chaos" veto.

State at ts (over a trailing window):
  sentiment : severity-weighted mean sentiment   (-1..1)
  severity  : max event severity                  (0..1)
  novelty   : max event novelty                   (0..1)
  entities  : union of entities in the window
  count     : number of events in the window
  chaos     : True when too noisy/contradictory to trade safely
"""

from __future__ import annotations

import bisect


class NewsContext:
    def __init__(self, events: list[dict] | None = None, window_seconds: int = 21600,
                 chaos_min_events: int = 3, high_severity: float = 0.6):
        self.window = window_seconds
        self.chaos_min_events = chaos_min_events
        self.high_severity = high_severity
        self.events = sorted(events or [], key=lambda e: e["ts"])
        self._ts = [e["ts"] for e in self.events]

    def at(self, ts: int) -> dict:
        if not self.events:
            return {"sentiment": 0.0, "severity": 0.0, "novelty": 0.0,
                    "entities": [], "count": 0, "chaos": False}
        lo = bisect.bisect_left(self._ts, ts - self.window)
        hi = bisect.bisect_right(self._ts, ts)
        window = self.events[lo:hi]
        if not window:
            return {"sentiment": 0.0, "severity": 0.0, "novelty": 0.0,
                    "entities": [], "count": 0, "chaos": False}

        severity = max(e["severity"] for e in window)
        novelty = max(e["novelty"] for e in window)
        wsum = sum(e["severity"] for e in window)
        sentiment = (sum(e["sentiment"] * e["severity"] for e in window) / wsum
                     if wsum > 0 else sum(e["sentiment"] for e in window) / len(window))
        entities = sorted({en for e in window for en in e.get("entities", [])})

        strong = [e for e in window if e["severity"] >= self.high_severity]
        has_pos = any(e["sentiment"] > 0.3 for e in strong)
        has_neg = any(e["sentiment"] < -0.3 for e in strong)
        chaos = len(strong) >= self.chaos_min_events or (has_pos and has_neg)

        return {"sentiment": sentiment, "severity": severity, "novelty": novelty,
                "entities": entities, "count": len(window), "chaos": chaos}


def news_state(ts: int, events: list[dict] | None = None) -> dict:
    return NewsContext(events).at(ts)
