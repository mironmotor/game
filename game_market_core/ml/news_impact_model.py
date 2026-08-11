"""News impact classifier (Stage 3 stub).

Goal: map a news event to (direction, magnitude, confidence) and an
event-to-market lag estimate, used by the News Shock Engine. Returns a
neutral, low-confidence estimate until trained.
"""

from __future__ import annotations


def estimate_impact(event: dict | None = None) -> dict:
    return {"direction": 0.0, "magnitude": 0.0, "confidence": 0.0, "lag_bars": 0}
