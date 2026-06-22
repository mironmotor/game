"""Real venue order client (Stage 5) — Binance signed REST.

Constructs HMAC-SHA256-signed order requests. It is intentionally only
reachable through ``ExecutionAdapter`` once EVERY safety gate has passed
(see execution_adapter.py): config opt-in, human acknowledgement, non-godmode
risk mode, API keys present, and venue_client_enabled. By itself this class
sends nothing unless ``place_order`` is called with real credentials.

Defaults to Binance SPOT TEST endpoint (``/api/v3/order/test``) which validates
an order WITHOUT executing it; flip ``test_only=False`` only after a deliberate
review. This keeps "going live" an explicit, auditable decision.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import time
import urllib.parse
import urllib.request

_BASE = "https://api.binance.com"


class BinanceOrderClient:
    def __init__(self, api_key: str, api_secret: str, test_only: bool = True):
        self.api_key = api_key
        self.api_secret = api_secret.encode()
        self.test_only = test_only

    def _signed_query(self, params: dict) -> str:
        params = {**params, "timestamp": int(time.time() * 1000), "recvWindow": 5000}
        query = urllib.parse.urlencode(params)
        sig = hmac.new(self.api_secret, query.encode(), hashlib.sha256).hexdigest()
        return f"{query}&signature={sig}"

    def place_order(self, symbol: str, side: str, quantity: float,
                    order_type: str = "MARKET", price: float | None = None) -> dict:
        params = {"symbol": symbol, "side": side.upper(), "type": order_type,
                  "quantity": quantity}
        if order_type == "LIMIT" and price is not None:
            params.update({"price": price, "timeInForce": "GTC"})
        body = self._signed_query(params).encode()
        path = "/api/v3/order/test" if self.test_only else "/api/v3/order"
        req = urllib.request.Request(_BASE + path, data=body, method="POST",
                                     headers={"X-MBX-APIKEY": self.api_key})
        with urllib.request.urlopen(req, timeout=15) as resp:
            raw = resp.read().decode("utf-8")
        return json.loads(raw) if raw.strip() else {"status": "test_ok"}
