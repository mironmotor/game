"""CoinMetrics community-data loader (real BTC history via raw.githubusercontent).

Exchanges are often blocked by region/network, but the CoinMetrics community
dataset on GitHub is reachable and gives REAL daily BTC back to 2010 plus real
on-chain series (exchange flows, active addresses). We use it as a no-key
real-data source.

Caveat: it is DAILY CLOSE only (no intraday OHLC). We reconstruct candles as
open=prev close, high/low=max/min(open,close) — so there are no intraday wicks.
That means the wick-based False Breakout engine barely fires here; this data
mainly exercises the Trend engine + regime on real BTC. Honest about its limits.
"""

from __future__ import annotations

import calendar
import csv
import io
import os
import time
import urllib.request

from datatypes import Candle

_URL = "https://raw.githubusercontent.com/coinmetrics/data/master/csv/{asset}.csv"
_HEADERS = {"User-Agent": "game-market-core/0.9"}


def _repo_root() -> str:
    return os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _cache_path(asset: str) -> str:
    return os.path.join(_repo_root(), "data", "storage", f"coinmetrics_{asset}.csv")


def _rows(asset: str) -> list[dict]:
    """Return parsed rows, fetching + caching the raw CSV (offline-safe)."""
    cache = _cache_path(asset)
    text = None
    try:
        req = urllib.request.Request(_URL.format(asset=asset), headers=_HEADERS)
        text = urllib.request.urlopen(req, timeout=40).read().decode("utf-8")
        os.makedirs(os.path.dirname(cache), exist_ok=True)
        with open(cache, "w", encoding="utf-8") as fh:
            fh.write(text)
        print(f"[coinmetrics] fetched {asset}.csv and cached")
    except Exception as exc:
        if os.path.exists(cache):
            with open(cache, "r", encoding="utf-8") as fh:
                text = fh.read()
            print(f"[coinmetrics] live fetch failed ({type(exc).__name__}); using cache")
        else:
            raise
    return list(csv.DictReader(io.StringIO(text)))


def _ts(date_str: str) -> int:
    return calendar.timegm(time.strptime(date_str, "%Y-%m-%d"))


def _fnum(row: dict, key: str) -> float | None:
    v = row.get(key, "")
    if v in ("", None):
        return None
    try:
        return float(v)
    except ValueError:
        return None


def load_candles(cfg: dict) -> list[Candle]:
    asset = cfg.get("data", {}).get("cm_asset", "btc")
    rows = _rows(asset)
    candles: list[Candle] = []
    prev_close = None
    for r in rows:
        close = _fnum(r, "PriceUSD")
        if close is None or close <= 0:
            continue
        open_ = prev_close if prev_close is not None else close
        high = max(open_, close)
        low = min(open_, close)
        flow = (_fnum(r, "FlowInExUSD") or 0.0) + (_fnum(r, "FlowOutExUSD") or 0.0)
        volume = (flow / close) if (flow > 0 and close > 0) else 1.0
        candles.append(Candle(_ts(r["time"]), open_, high, low, close, volume))
        prev_close = close
    print(f"[coinmetrics] {asset.upper()}: {len(candles)} daily candles "
          f"({candles[0].close:.4f} -> {candles[-1].close:.2f} USD)")
    return candles


def load_onchain(cfg: dict) -> dict:
    """Real on-chain series from the same dataset: exchange netflow, active
    addresses, total fees — aligned to candle timestamps."""
    asset = cfg.get("data", {}).get("cm_asset", "btc")
    rows = _rows(asset)
    netflow, active, fees = [], [], []
    for r in rows:
        ts = _ts(r["time"])
        fin, fout = _fnum(r, "FlowInExUSD"), _fnum(r, "FlowOutExUSD")
        if fin is not None and fout is not None:
            netflow.append((ts, fin - fout))   # +inflow to exchanges = sell pressure
        adr = _fnum(r, "AdrActCnt")
        if adr is not None:
            active.append((ts, adr))
        fee = _fnum(r, "FeeTotNtv")
        if fee is not None:
            fees.append((ts, fee))
    out = {}
    if netflow:
        out["exchange_netflow"] = netflow
    if active:
        out["n_tx"] = active            # reuse the activity slot
    if fees:
        out["fees_usd"] = fees
    if out:
        print(f"[coinmetrics] on-chain series: {', '.join(sorted(out))}")
    return out
