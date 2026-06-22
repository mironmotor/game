"""On-chain feature engine (Stage 4).

Turns on-chain series into point-in-time, z-scored signals aligned to any
timestamp via "last known value <= ts" (no look-ahead). Empty input ->
neutral state, so the system never blocks on missing on-chain data.

Signals:
  fees_z       : fee pressure vs its trailing mean (network stress)
  miner_z      : miner revenue vs trailing mean (selling-pressure proxy)
  activity_z   : tx / active-address activity vs trailing mean
"""

from __future__ import annotations

import bisect
import math


class OnchainContext:
    def __init__(self, series: dict | None = None, window: int = 90):
        self.window = window
        self._prepared: dict[str, dict] = {}
        for name, data in (series or {}).items():
            if not data:
                continue
            data = sorted(data, key=lambda x: x[0])
            ts = [p[0] for p in data]
            val = [p[1] for p in data]
            self._prepared[name] = {"ts": ts, "val": val}

    def _z_at(self, name: str, ts: int) -> float:
        prep = self._prepared.get(name)
        if not prep:
            return 0.0
        i = bisect.bisect_right(prep["ts"], ts) - 1
        if i < self.window:
            return 0.0
        window = prep["val"][i - self.window:i + 1]
        mean = sum(window) / len(window)
        var = sum((v - mean) ** 2 for v in window) / len(window)
        std = math.sqrt(var) or 1.0
        return max(-3.0, min(3.0, (prep["val"][i] - mean) / std))

    def at(self, ts: int) -> dict:
        return {
            "fees_z": self._z_at("fees_usd", ts),
            "miner_z": self._z_at("miner_rev", ts),
            "activity_z": self._z_at("n_tx", ts),
            "available": bool(self._prepared),
        }


def onchain_state(ts: int, data: dict | None = None) -> dict:
    return OnchainContext(data).at(ts)
