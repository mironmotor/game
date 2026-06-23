"""Crypto OHLCV loader.

Two sources:

* ``csv``      — read a real OHLCV export (ts,open,high,low,close,volume).
* ``synthetic``— generate a deterministic, regime-switching price series so
                 the whole pipeline is runnable and reproducible with zero
                 external dependencies or API keys.

The synthetic generator is intentionally NOT designed to be easy to trade.
It mixes trending and mean-reverting regimes, volatility clustering, and
occasional jump shocks ("black swans"). This is so that any edge the
backtest reports has to survive realistic structure, not a toy uptrend.
"""

from __future__ import annotations

import csv
import math
import os
import random

from datatypes import Candle

# Regime menu: (name, drift_per_bar, base_vol_per_bar, mean_reversion_strength)
_REGIMES = [
    ("bull_trend", 0.00045, 0.011, 0.0),
    ("bear_trend", -0.00045, 0.013, 0.0),
    ("euphoria", 0.0010, 0.020, 0.0),
    ("range", 0.0, 0.009, 0.04),       # mean reverts toward a local anchor
    ("crisis", -0.0012, 0.030, 0.0),   # fast, volatile drawdowns
]


def generate_synthetic(
    bars: int,
    seed: int = 17,
    start_price: float = 20000.0,
    bar_seconds: int = 3600,
) -> list[Candle]:
    rng = random.Random(seed)
    candles: list[Candle] = []

    price = start_price
    anchor = start_price          # used by mean-reverting "range" regimes
    vol = _REGIMES[0][2]
    regime = _REGIMES[0]
    bars_left_in_regime = 0
    ts = 1_230_768_000            # ~2009-01-01, BTC-era start

    for _ in range(bars):
        if bars_left_in_regime <= 0:
            regime = rng.choice(_REGIMES)
            bars_left_in_regime = rng.randint(120, 600)
            anchor = price
        bars_left_in_regime -= 1

        name, drift, base_vol, mr = regime

        # Volatility clustering: vol drifts toward the regime's base level.
        vol += 0.15 * (base_vol - vol) + rng.gauss(0, base_vol * 0.05)
        vol = max(0.002, vol)

        shock = rng.gauss(0, 1)
        ret = drift + vol * shock
        if mr > 0:
            ret += mr * (math.log(anchor) - math.log(price))

        # Rare jump shocks (both directions, fatter tails than Gaussian).
        if rng.random() < 0.002:
            ret += rng.choice([-1, 1]) * rng.uniform(0.04, 0.12)

        open_ = price
        close = max(1e-6, open_ * math.exp(ret))

        # Build a plausible high/low around the open->close move.
        wick = abs(close - open_) + open_ * vol * abs(rng.gauss(0, 0.8))
        high = max(open_, close) + wick * rng.uniform(0.1, 0.9)
        low = min(open_, close) - wick * rng.uniform(0.1, 0.9)
        low = max(1e-6, low)

        base_volume = 1000.0 * (1.0 + 4.0 * abs(shock)) * (1.0 + vol * 20)
        volume = base_volume * rng.uniform(0.7, 1.3)

        candles.append(Candle(ts, open_, high, low, close, volume))
        price = close
        ts += bar_seconds

    return candles


def load_csv(path: str) -> list[Candle]:
    candles: list[Candle] = []
    with open(path, "r", encoding="utf-8", newline="") as fh:
        reader = csv.DictReader(fh)
        for row in reader:
            candles.append(
                Candle(
                    ts=int(float(row["ts"])),
                    open=float(row["open"]),
                    high=float(row["high"]),
                    low=float(row["low"]),
                    close=float(row["close"]),
                    volume=float(row.get("volume", 0.0) or 0.0),
                )
            )
    return candles


def _repo_root() -> str:
    return os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _abs(path: str) -> str:
    return path if os.path.isabs(path) else os.path.join(_repo_root(), path)


def _load_exchange(cfg: dict) -> list[Candle]:
    """Fetch real OHLCV from an exchange, with a CSV cache and a safe
    fallback chain: live fetch -> cached file -> synthetic data.

    The fallback is what makes the system runnable in offline / locked-down
    environments while still using real data wherever the network allows.
    """
    from data.loaders.exchange_rest import fetch_ohlcv  # local import: optional path
    from data.storage.database import save_candles_csv

    d = cfg.get("data", {})
    venue = d.get("venue", "binance")
    symbol = d.get("symbol", "BTCUSDT")
    tf = d.get("timeframe", "1h")
    start_date = d.get("start_date", "2019-01-01")
    end_date = d.get("end_date") or None
    cache = _abs(d.get("cache_path", f"data/storage/{venue}_{symbol}_{tf}.csv"))

    try:
        candles = fetch_ohlcv(venue, symbol, tf, start_date, end_date)
        if candles:
            save_candles_csv(candles, cache)
            print(f"[data] fetched {len(candles)} candles from {venue} {symbol} {tf} "
                  f"and cached to {os.path.relpath(cache, _repo_root())}")
            return candles
        raise RuntimeError("empty response")
    except Exception as exc:  # network blocked, rate-limited, etc.
        if os.path.exists(cache):
            print(f"[data] live fetch failed ({type(exc).__name__}); using cache {cache}")
            return load_csv(cache)
        print(f"[data] live fetch failed ({type(exc).__name__}: {str(exc)[:80]}); "
              "no cache present -> FALLING BACK TO SYNTHETIC data.")
        return generate_synthetic(
            bars=int(d.get("bars", 26280)),
            seed=int(d.get("seed", 17)),
            start_price=float(d.get("start_price", 20000.0)),
        )


def load_crypto(cfg: dict) -> list[Candle]:
    data_cfg = cfg.get("data", {})
    source = data_cfg.get("source", "synthetic")
    if source == "csv":
        return load_csv(_abs(data_cfg.get("csv_path")))
    if source == "exchange":
        return _load_exchange(cfg)
    if source == "coinmetrics":
        from data.loaders.coinmetrics_loader import load_candles
        try:
            return load_candles(cfg)
        except Exception as exc:
            print(f"[data] coinmetrics unavailable ({type(exc).__name__}); "
                  "FALLING BACK TO SYNTHETIC.")
            return generate_synthetic(
                bars=int(data_cfg.get("bars", 26280)),
                seed=int(data_cfg.get("seed", 17)),
                start_price=float(data_cfg.get("start_price", 20000.0)),
            )
    return generate_synthetic(
        bars=int(data_cfg.get("bars", 26280)),
        seed=int(data_cfg.get("seed", 17)),
        start_price=float(data_cfg.get("start_price", 20000.0)),
    )
