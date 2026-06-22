"""Real-time exchange abstraction.

STATUS: interface stub for Stage 3. Defines a venue-agnostic surface so
Binance / Bybit / OKX can be added behind one interface without leaking
venue specifics into strategies. Real implementations will use each venue's
public websocket + REST market-data endpoints (no keys needed for reading).

Stage 1 ships only the interface and a replay adapter used by paper trading
to "stream" historical candles deterministically.
"""

from __future__ import annotations

from collections.abc import Iterator

from datatypes import Candle


class ExchangeFeed:
    """Abstract market-data feed. Implementations stream candles/order book."""

    def stream_candles(self, symbol: str, timeframe: str) -> Iterator[Candle]:
        raise NotImplementedError

    def order_book(self, symbol: str) -> dict:
        raise NotImplementedError


class ReplayFeed(ExchangeFeed):
    """Replays a fixed candle list as if it were live. Used by paper trading."""

    def __init__(self, candles: list[Candle]):
        self._candles = candles

    def stream_candles(self, symbol: str, timeframe: str) -> Iterator[Candle]:
        yield from self._candles
