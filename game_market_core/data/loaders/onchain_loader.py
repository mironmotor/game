"""On-chain data loader (Stage 4) — blockchain.info charts (free, no key).

Pulls a small basket of network series and reduces each to (ts, value):
  * n-transactions       — network activity
  * transaction-fees-usd — fee pressure
  * miners-revenue       — miner income (selling-pressure proxy)
  * n-unique-addresses   — active addresses

Offline-safe: failures fall back to cache, then to an empty dict (on-chain
features degrade to neutral). Exchange-flow / whale feeds (Glassnode /
CryptoQuant) slot in here behind their own keys later.
"""

from __future__ import annotations

import csv
import json
import os
import urllib.request

_HEADERS = {"User-Agent": "game-market-core/0.4"}
_CHARTS = {
    "n_tx": "n-transactions",
    "fees_usd": "transaction-fees-usd",
    "miner_rev": "miners-revenue",
    "active_addr": "n-unique-addresses",
}


def _repo_root() -> str:
    return os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _fetch_chart(chart: str) -> list[tuple[int, float]]:
    url = f"https://api.blockchain.info/charts/{chart}?timespan=all&format=json&sampled=true"
    req = urllib.request.Request(url, headers=_HEADERS)
    with urllib.request.urlopen(req, timeout=15) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    return [(int(p["x"]), float(p["y"])) for p in data.get("values", [])]


def load_onchain(cfg: dict) -> dict:
    if not cfg.get("onchain", {}).get("enabled", False):
        return {}
    cache_dir = os.path.join(_repo_root(), "data", "storage")
    os.makedirs(cache_dir, exist_ok=True)
    series: dict = {}
    for name, chart in _CHARTS.items():
        cache = os.path.join(cache_dir, f"onchain_{name}.csv")
        try:
            data = _fetch_chart(chart)
            if data:
                with open(cache, "w", encoding="utf-8", newline="") as fh:
                    w = csv.writer(fh)
                    w.writerow(["ts", "value"])
                    w.writerows(data)
                series[name] = data
                continue
            raise RuntimeError("empty")
        except Exception:
            if os.path.exists(cache):
                with open(cache, "r", encoding="utf-8") as fh:
                    r = csv.DictReader(fh)
                    series[name] = [(int(x["ts"]), float(x["value"])) for x in r]
    if series:
        print(f"[onchain] loaded series: {', '.join(sorted(series))}")
    else:
        print("[onchain] no data available (offline) -> neutral on-chain features")
    return series
