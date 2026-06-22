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
    """Replays a fixed candle list as if it were live. Used by paper trading.

    Paper trading sources its candles THROUGH this feed, so swapping in a real
    websocket/REST feed (Stage 4) is the only change needed to go from replay
    to genuine real-time — the strategy/risk/matching path stays identical.
    """

    def __init__(self, candles: list[Candle]):
        self._candles = candles

    def stream_candles(self, symbol: str, timeframe: str) -> Iterator[Candle]:
        yield from self._candles


class RestPollFeed(ExchangeFeed):
    """Live feed via periodic REST polling (Stage 4 stub).

    Plan: poll the venue's klines endpoint each bar close and yield finalized
    candles. Implemented on top of ``data.loaders.exchange_rest`` so it reuses
    the same venue connectors. Websocket streaming follows.
    """

    def stream_candles(self, symbol: str, timeframe: str) -> Iterator[Candle]:
        raise NotImplementedError("Live REST/websocket feed arrives in Stage 4.")
