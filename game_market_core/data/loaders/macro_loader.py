"""Macro / cross-asset loader (equities, gold, dollar) via Stooq.

Stooq exposes free daily history as CSV with no API key:
    https://stooq.com/q/d/l/?s=^spx&i=d  -> Date,Open,High,Low,Close,Volume

We pull a small basket and reduce each to (ts, close). These feed
``features.macro_features`` as REGIME CONTEXT for crypto (risk-on/off,
crisis), NOT as separately traded instruments — equities are less volatile
than crypto, so their value here is timing/context, not extra leverage.

Offline-safe: failures fall back to cache, then to an empty dict (macro
features degrade to neutral, never blocking the pipeline).
"""

from __future__ import annotations

import csv
import io
import os
import time
import urllib.request

_HEADERS = {"User-Agent": "game-market-core/0.2"}

# name -> Stooq symbol. Interdependent risk assets used as crypto context.
_BASKET = {
    "spx": "^spx",     # S&P 500
    "ndq": "^ndq",     # Nasdaq Composite
    "gold": "gc.f",    # Gold futures
    "dxy": "dx.f",     # US Dollar Index
}


def _repo_root() -> str:
    return os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _parse_stooq(text: str) -> list[tuple[int, float]]:
    out: list[tuple[int, float]] = []
    reader = csv.DictReader(io.StringIO(text))
    for row in reader:
        try:
            ts = int(time.mktime(time.strptime(row["Date"], "%Y-%m-%d")))
            out.append((ts, float(row["Close"])))
        except (KeyError, ValueError):
            continue
    return out


def _fetch_one(stooq_symbol: str) -> list[tuple[int, float]]:
    url = f"https://stooq.com/q/d/l/?s={stooq_symbol}&i=d"
    req = urllib.request.Request(url, headers=_HEADERS)
    with urllib.request.urlopen(req, timeout=15) as resp:
        return _parse_stooq(resp.read().decode("utf-8"))


def load_macro(cfg: dict) -> dict:
    """Return {series_name: [(ts, close), ...]}. Empty dict if unavailable."""
    if not cfg.get("macro", {}).get("enabled", False):
        return {}
    cache_dir = os.path.join(_repo_root(), "data", "storage")
    os.makedirs(cache_dir, exist_ok=True)

    series: dict = {}
    for name, sym in _BASKET.items():
        cache = os.path.join(cache_dir, f"macro_{name}.csv")
        try:
            data = _fetch_one(sym)
            if data:
                with open(cache, "w", encoding="utf-8", newline="") as fh:
                    w = csv.writer(fh)
                    w.writerow(["ts", "close"])
                    w.writerows(data)
                series[name] = data
                continue
            raise RuntimeError("empty")
        except Exception:
            if os.path.exists(cache):
                with open(cache, "r", encoding="utf-8") as fh:
                    r = csv.DictReader(fh)
                    series[name] = [(int(x["ts"]), float(x["close"])) for x in r]
    if series:
        print(f"[macro] loaded series: {', '.join(sorted(series))}")
    else:
        print("[macro] no macro data available (offline) -> neutral macro features")
    return series
