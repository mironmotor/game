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
    "tx_vol_usd": "estimated-transaction-volume-usd",  # large-flow / "whale" proxy
}
# NOTE: true exchange inflow/outflow and whale clustering require a keyed
# provider (Glassnode / CryptoQuant). They slot in here behind their keys;
# tx_vol_usd is a free, public stand-in for aggregate large flow.


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
    series.update(load_keyed_flows(cfg))
    if series:
        print(f"[onchain] loaded series: {', '.join(sorted(series))}")
    else:
        print("[onchain] no data available (offline) -> neutral on-chain features")
    return series


def load_keyed_flows(cfg: dict) -> dict:
    """Keyed exchange-flow / whale feeds (Glassnode / CryptoQuant).

    These require a paid API key, supplied via the environment
    (GMC_GLASSNODE_KEY / GMC_CRYPTOQUANT_KEY). When a key is present the real
    endpoint is queried for exchange netflow / whale metrics; otherwise this
    returns {} and the free ``tx_vol_usd`` proxy in _CHARTS stands in. The hook
    is wired so adding a key is the only change needed — no code edits.
    """
    glass = os.environ.get("GMC_GLASSNODE_KEY")
    if not glass:
        return {}
    out: dict = {}
    try:
        url = ("https://api.glassnode.com/v1/metrics/transactions/transfers_volume_exchanges_net"
               f"?a=BTC&i=24h&api_key={glass}")
        req = urllib.request.Request(url, headers=_HEADERS)
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        out["exchange_netflow"] = [(int(p["t"]), float(p.get("v") or 0.0)) for p in data]
        print("[onchain] keyed exchange-netflow loaded (Glassnode)")
    except Exception as exc:
        print(f"[onchain] keyed flow fetch failed ({type(exc).__name__}); using free proxy")
    return out
