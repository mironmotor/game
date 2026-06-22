"""Paper trader (Stage 3 stub).

Plan: drive the SAME meta controller + risk engine used in backtest against
a live (or replayed) feed, with simulated fills, a virtual portfolio, and a
trade journal. Paper trading is a mandatory gate between a validated
backtest and any live execution. Built on ``ReplayFeed`` first, then real
exchange websockets.
"""

from __future__ import annotations


def run_paper(*args, **kwargs):
    raise NotImplementedError("Real-time paper trading arrives in Stage 3.")
