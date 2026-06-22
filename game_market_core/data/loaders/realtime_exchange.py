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
    """Live feed via periodic REST polling (Stage 4).

    Polls the venue's klines endpoint and yields only FINALIZED candles (the
    most recent, still-forming bar is held back until it closes). Reuses the
    same venue connectors as the historical loader. ``max_polls`` bounds the
    loop so it is safe to demo; ``None`` polls indefinitely. Websocket
    streaming is the next upgrade behind the same interface.
    """

    def __init__(self, venue: str = "binance", poll_seconds: int = 60,
                 max_polls: int | None = None):
        self.venue = venue
        self.poll_seconds = poll_seconds
        self.max_polls = max_polls

    def stream_candles(self, symbol: str, timeframe: str) -> Iterator[Candle]:
        import time
        from data.loaders.exchange_rest import fetch_recent

        last_ts = 0
        polls = 0
        while self.max_polls is None or polls < self.max_polls:
            polls += 1
            candles = fetch_recent(self.venue, symbol, timeframe, limit=50)
            # Drop the last (still-forming) candle; emit newly closed ones.
            for c in candles[:-1]:
                if c.ts > last_ts:
                    last_ts = c.ts
                    yield c
            if self.max_polls is None or polls < self.max_polls:
                time.sleep(self.poll_seconds)

    def order_book(self, symbol: str) -> dict:
        raise NotImplementedError("Order book streaming arrives with websockets.")
