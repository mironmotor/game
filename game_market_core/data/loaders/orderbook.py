"""Order-book snapshot loader (Stage 7).

Fetches a depth snapshot from the venue's public REST endpoint (no keys). Used
by the microstructure features and the live spread filter. Offline this 403s
and callers fall back to neutral microstructure, like every other live source.
Websocket depth diffs are the next upgrade behind the same shape.
"""

from __future__ import annotations

import json
import urllib.request

_HEADERS = {"User-Agent": "game-market-core/0.7"}


def fetch_order_book(venue: str, symbol: str, limit: int = 20) -> dict:
    if venue == "binance":
        url = f"https://api.binance.com/api/v3/depth?symbol={symbol}&limit={limit}"
    elif venue == "bybit":
        url = f"https://api.bybit.com/v5/market/orderbook?category=spot&symbol={symbol}&limit={limit}"
    else:
        raise ValueError(f"unknown venue '{venue}'")
    req = urllib.request.Request(url, headers=_HEADERS)
    with urllib.request.urlopen(req, timeout=12) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    if venue == "bybit":
        r = data.get("result", {})
        bids = [(float(p), float(q)) for p, q in r.get("b", [])]
        asks = [(float(p), float(q)) for p, q in r.get("a", [])]
    else:
        bids = [(float(p), float(q)) for p, q in data.get("bids", [])]
        asks = [(float(p), float(q)) for p, q in data.get("asks", [])]
    return {"bids": bids, "asks": asks}
