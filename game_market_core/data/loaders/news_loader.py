"""News / world-event loader.

STATUS: interface stub for Stage 3. Emits a normalized event schema so the
News Shock Engine and news features can be developed against a stable shape.

Planned real sources (legal, documented APIs only):
* GDELT 2.0 (global events, tone) — free
* RSS: central banks, major exchanges, regulators
* Economic calendars (e.g. public ICS feeds)
* Social sentiment ONLY via an authorized API with terms allowing it.

Normalized event schema:
    {ts, source, headline, entities: [...], topic, sentiment: -1..1,
     severity: 0..1, novelty: 0..1}
"""

from __future__ import annotations


def load_news(cfg: dict) -> list[dict]:
    """Return a list of normalized news events. Empty for Stage 1."""
    return []
