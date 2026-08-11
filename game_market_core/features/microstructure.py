"""Order-book microstructure features (Stage 7).

Turns a depth snapshot into the signals that matter for short-horizon
execution and the risk layer's spread filter:
  obi        : order-book imbalance in [-1, 1] (bid-heavy positive)
  spread_bps : top-of-book spread in basis points
  depth      : total visible size within the snapshot

Empty/None book -> neutral state, so offline the system never blocks.
"""

from __future__ import annotations


def order_book_imbalance(book: dict) -> float:
    bid = sum(q for _, q in book.get("bids", []))
    ask = sum(q for _, q in book.get("asks", []))
    tot = bid + ask
    return 0.0 if tot == 0 else (bid - ask) / tot


def spread_bps(book: dict) -> float:
    bids, asks = book.get("bids"), book.get("asks")
    if not bids or not asks:
        return 0.0
    best_bid, best_ask = bids[0][0], asks[0][0]
    mid = (best_bid + best_ask) / 2
    return 0.0 if mid <= 0 else (best_ask - best_bid) / mid * 10_000


def microstructure_state(book: dict | None) -> dict:
    if not book or not book.get("bids") or not book.get("asks"):
        return {"obi": 0.0, "spread_bps": 0.0, "depth": 0.0, "available": False}
    depth = sum(q for _, q in book["bids"]) + sum(q for _, q in book["asks"])
    return {"obi": order_book_imbalance(book), "spread_bps": spread_bps(book),
            "depth": depth, "available": True}
