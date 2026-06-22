"""News feature engine (Stage 3 stub).

Planned outputs per timestamp: sentiment score, event severity, novelty,
topic cluster, entity flags (BTC/ETH/Fed/SEC/Binance/ETF/war/hack/inflation/
rates), and event-to-market lag. Returns a neutral state until the news
loader is wired so the News Shock Engine can fail safe (no trade on unknown).
"""

from __future__ import annotations


def news_state(ts: int, events: list[dict] | None = None) -> dict:
    return {
        "sentiment": 0.0,        # -1 .. +1
        "severity": 0.0,         # 0 .. 1
        "novelty": 0.0,          # 0 .. 1
        "entities": [],
        "chaos": False,          # True when too noisy/uncertain to trade
    }
