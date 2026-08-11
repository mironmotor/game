"""Live websocket candle feed (Stage 5) — minimal RFC 6455 client, stdlib only.

Implements just enough of the WebSocket protocol (client handshake + frame
decode + ping/pong) to subscribe to an exchange kline stream and yield
FINALIZED candles, behind the same ``ExchangeFeed`` interface as ReplayFeed /
RestPollFeed. No ``websockets`` dependency.

Bounded by ``max_messages`` so it is safe to demo. In a locked-down sandbox
the TLS connect fails cleanly and the caller falls back. Binance is wired;
other venues follow the same shape.
"""

from __future__ import annotations

import base64
import json
import os
import socket
import ssl
import struct
from collections.abc import Iterator

from datatypes import Candle
from data.loaders.realtime_exchange import ExchangeFeed

_BINANCE_TF = {"1m": "1m", "5m": "5m", "15m": "15m", "1h": "1h", "4h": "4h", "1d": "1d"}


class WebSocketFeed(ExchangeFeed):
    def __init__(self, venue: str = "binance", max_messages: int | None = None,
                 timeout: int = 20):
        if venue != "binance":
            raise ValueError("WebSocketFeed currently wires Binance only")
        self.venue = venue
        self.max_messages = max_messages
        self.timeout = timeout

    def _connect(self, host: str, path: str) -> ssl.SSLSocket:
        raw = socket.create_connection((host, 9443), timeout=self.timeout)
        sock = ssl.create_default_context().wrap_socket(raw, server_hostname=host)
        key = base64.b64encode(os.urandom(16)).decode()
        handshake = (
            f"GET {path} HTTP/1.1\r\nHost: {host}\r\nUpgrade: websocket\r\n"
            f"Connection: Upgrade\r\nSec-WebSocket-Key: {key}\r\n"
            f"Sec-WebSocket-Version: 13\r\n\r\n"
        )
        sock.sendall(handshake.encode())
        resp = b""
        while b"\r\n\r\n" not in resp:
            resp += sock.recv(1024)
        if b"101" not in resp.split(b"\r\n", 1)[0]:
            raise ConnectionError(f"websocket handshake failed: {resp[:80]!r}")
        return sock

    def _frames(self, sock: ssl.SSLSocket) -> Iterator[str]:
        buf = b""

        def need(n: int) -> bytes:
            nonlocal buf
            while len(buf) < n:
                chunk = sock.recv(4096)
                if not chunk:
                    raise ConnectionError("socket closed")
                buf += chunk
            out, buf = buf[:n], buf[n:]
            return out

        while True:
            b0, b1 = need(2)
            opcode = b0 & 0x0F
            length = b1 & 0x7F
            if length == 126:
                length = struct.unpack(">H", need(2))[0]
            elif length == 127:
                length = struct.unpack(">Q", need(8))[0]
            payload = need(length)
            if opcode == 0x8:           # close
                return
            if opcode == 0x9:           # ping -> pong (masked)
                mask = os.urandom(4)
                masked = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
                sock.sendall(b"\x8a" + bytes([0x80 | len(payload)]) + mask + masked)
                continue
            if opcode in (0x1, 0x2):
                yield payload.decode("utf-8", "replace")

    def stream_candles(self, symbol: str, timeframe: str) -> Iterator[Candle]:
        host = "stream.binance.com"
        path = f"/ws/{symbol.lower()}@kline_{_BINANCE_TF[timeframe]}"
        sock = self._connect(host, path)
        seen = 0
        try:
            for msg in self._frames(sock):
                k = json.loads(msg).get("k", {})
                if k.get("x"):          # candle closed
                    yield Candle(int(k["t"]) // 1000, float(k["o"]), float(k["h"]),
                                 float(k["l"]), float(k["c"]), float(k["v"]))
                    seen += 1
                    if self.max_messages is not None and seen >= self.max_messages:
                        return
        finally:
            sock.close()
