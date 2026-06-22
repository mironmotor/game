"""On-chain feature engine (Stage 4 stub).

Planned: exchange inflow/outflow, whale movement, stablecoin mint/burn,
active addresses, network fees, miner selling pressure. Sources will be
public/free where possible (e.g. blockchain.com charts, mempool.space,
Glassnode/CryptoQuant free tiers). Neutral defaults until wired.
"""

from __future__ import annotations


def onchain_state(ts: int, data: dict | None = None) -> dict:
    return {
        "exchange_netflow": 0.0,
        "whale_activity": 0.0,
        "stablecoin_supply_change": 0.0,
        "miner_pressure": 0.0,
    }
