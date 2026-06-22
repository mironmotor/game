"""Macro / cross-asset history loader (1940 -> 2026).

STATUS: interface stub for Stage 2+. The intent of the long history is NOT
to backtest crypto strategies on 1940s equities, but to learn the *physics*
of markets that repeat across eras: panic, euphoria, liquidity expansion,
credit contraction, trend continuation, mean reversion, and black swans.
These become macro/regime features, not direct trading signals.

Planned real sources (all have free/public tiers):
* FRED (rates, inflation/CPI, recession indicator USREC) — api.stlouisfed.org
* Stooq / Yahoo Finance (S&P500, Dow, Nasdaq, Gold, Oil, DXY) daily history
* NBER recession dating; major-crisis date tables (curated CSV)

Until wired, ``load_macro`` returns an empty frame so downstream features
degrade gracefully (macro features default to neutral).
"""

from __future__ import annotations


def load_macro(cfg: dict) -> dict:
    """Return a dict of {series_name: list[(ts, value)]}. Empty for Stage 1."""
    return {}
