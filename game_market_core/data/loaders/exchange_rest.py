"""Historical OHLCV fetchers for top exchanges (stdlib only).

No third-party deps and no API keys: public market-data REST endpoints are
used via urllib. A venue-agnostic ``fetch_ohlcv`` returns a list[Candle].

NOTE: In a locked-down/offline environment these calls will fail (HTTP 403 /
network error). Callers (crypto_loader) catch that and fall back to cache or
synthetic data, so the pipeline always runs. On a network-enabled machine
these connectors pull real history.

Why these venues: Binance has the deepest liquidity and the cleanest free
klines history (primary); Bybit is the fallback. OKX/Coinbase slot into the
same interface later.
"""

from __future__ import annotations

import calendar
import json
import time
import urllib.request

from datatypes import Candle

_HEADERS = {"User-Agent": "game-market-core/0.2"}

# Our canonical timeframe -> per-venue interval token.
_BINANCE_TF = {"1m": "1m", "5m": "5m", "15m": "15m", "1h": "1h", "4h": "4h", "1d": "1d"}
_BYBIT_TF = {"1m": "1", "5m": "5", "15m": "15", "1h": "60", "4h": "240", "1d": "D"}
_TF_SECONDS = {"1m": 60, "5m": 300, "15m": 900, "1h": 3600, "4h": 14400, "1d": 86400}


def to_ms(date) -> int:
    """'YYYY-MM-DD' string or a date/datetime (UTC) -> epoch milliseconds.

    YAML parsers commonly auto-convert ``2019-01-01`` into a ``date`` object,
    so accept both forms.
    """
    if isinstance(date, str):
        struct = time.strptime(date, "%Y-%m-%d")
    elif hasattr(date, "timetuple"):
        struct = date.timetuple()
    else:
        raise TypeError(f"unsupported date type: {type(date)}")
    return calendar.timegm(struct) * 1000


def _get_json(url: str, timeout: int = 15):
    req = urllib.request.Request(url, headers=_HEADERS)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def fetch_binance(symbol: str, timeframe: str, start_ms: int, end_ms: int) -> list[Candle]:
    interval = _BINANCE_TF[timeframe]
    out: list[Candle] = []
    cursor = start_ms
    while cursor < end_ms:
        url = (
            "https://api.binance.com/api/v3/klines"
            f"?symbol={symbol}&interval={interval}&startTime={cursor}"
            f"&endTime={end_ms}&limit=1000"
        )
        rows = _get_json(url)
        if not rows:
            break
        for r in rows:
            out.append(Candle(
                ts=int(r[0]) // 1000, open=float(r[1]), high=float(r[2]),
                low=float(r[3]), close=float(r[4]), volume=float(r[5]),
            ))
        cursor = int(rows[-1][0]) + _TF_SECONDS[timeframe] * 1000
        if len(rows) < 1000:
            break
        time.sleep(0.25)  # be polite to the public endpoint
    return out


def fetch_bybit(symbol: str, timeframe: str, start_ms: int, end_ms: int) -> list[Candle]:
    interval = _BYBIT_TF[timeframe]
    step_ms = _TF_SECONDS[timeframe] * 1000
    out: list[Candle] = []
    cursor = start_ms
    while cursor < end_ms:
        url = (
            "https://api.bybit.com/v5/market/kline"
            f"?category=spot&symbol={symbol}&interval={interval}"
            f"&start={cursor}&end={end_ms}&limit=1000"
        )
        payload = _get_json(url)
        rows = (payload.get("result", {}) or {}).get("list", []) or []
        if not rows:
            break
        rows = sorted(rows, key=lambda r: int(r[0]))  # Bybit returns newest-first
        for r in rows:
            out.append(Candle(
                ts=int(r[0]) // 1000, open=float(r[1]), high=float(r[2]),
                low=float(r[3]), close=float(r[4]), volume=float(r[5]),
            ))
        cursor = int(rows[-1][0]) + step_ms
        if len(rows) < 1000:
            break
        time.sleep(0.25)
    return out


def fetch_recent(venue: str, symbol: str, timeframe: str, limit: int = 50) -> list[Candle]:
    """Most recent ``limit`` candles (for live polling). Ascending by time."""
    if venue == "binance":
        url = ("https://api.binance.com/api/v3/klines"
               f"?symbol={symbol}&interval={_BINANCE_TF[timeframe]}&limit={limit}")
        rows = _get_json(url)
        return [Candle(int(r[0]) // 1000, float(r[1]), float(r[2]), float(r[3]),
                       float(r[4]), float(r[5])) for r in rows]
    if venue == "bybit":
        url = ("https://api.bybit.com/v5/market/kline"
               f"?category=spot&symbol={symbol}&interval={_BYBIT_TF[timeframe]}&limit={limit}")
        rows = (_get_json(url).get("result", {}) or {}).get("list", []) or []
        rows = sorted(rows, key=lambda r: int(r[0]))
        return [Candle(int(r[0]) // 1000, float(r[1]), float(r[2]), float(r[3]),
                       float(r[4]), float(r[5])) for r in rows]
    raise ValueError(f"unknown venue '{venue}'")


_VENUES = {"binance": fetch_binance, "bybit": fetch_bybit}


def fetch_ohlcv(venue: str, symbol: str, timeframe: str,
                start_date: str, end_date: str | None = None) -> list[Candle]:
    if venue not in _VENUES:
        raise ValueError(f"unknown venue '{venue}'. Known: {sorted(_VENUES)}")
    if timeframe not in _TF_SECONDS:
        raise ValueError(f"unsupported timeframe '{timeframe}'")
    start_ms = to_ms(start_date)
    end_ms = to_ms(end_date) if end_date else int(time.time() * 1000)
    return _VENUES[venue](symbol, timeframe, start_ms, end_ms)
