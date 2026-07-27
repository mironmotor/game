"""Защита моста Max17 от флуда и перебора токена.

Три рубежа, потому что по-отдельности каждый дырявый:

1. Лимит на IP        — режет одиночного крикуна.
2. Глобальный лимит   — единственное, что реально спасает при распределённой
                        атаке (много разных IP): Мак не должен умирать, даже
                        если каждый IP «в рамках приличий».
3. Бан за неудачную авторизацию — чтобы токен нельзя было подобрать перебором.

Всё в памяти, без зависимостей: мост живёт одним процессом.
"""

from __future__ import annotations

import threading
import time
from collections import deque


class SlidingWindow:
    """Скользящее окно: не больше `limit` событий за `window` секунд на ключ."""

    def __init__(self, limit: int, window: float) -> None:
        self.limit = max(1, int(limit))
        self.window = max(0.1, float(window))
        self._hits: dict[str, deque[float]] = {}
        self._lock = threading.Lock()

    def check(self, key: str) -> tuple[bool, float]:
        """(разрешено, через сколько секунд можно повторить)."""
        now = time.monotonic()
        cutoff = now - self.window
        with self._lock:
            hits = self._hits.get(key)
            if hits is None:
                hits = deque()
                self._hits[key] = hits
            while hits and hits[0] <= cutoff:
                hits.popleft()
            if len(hits) >= self.limit:
                return False, max(0.0, hits[0] + self.window - now)
            hits.append(now)
            return True, 0.0

    def prune(self, max_keys: int = 4096) -> None:
        """Не даём словарю расти бесконечно при атаке с тысяч адресов."""
        now = time.monotonic()
        cutoff = now - self.window
        with self._lock:
            if len(self._hits) <= max_keys:
                return
            for key in [k for k, v in self._hits.items() if not v or v[-1] <= cutoff]:
                del self._hits[key]


class FailureBan:
    """Бан ключа на `ban_seconds` после `max_failures` неудач подряд."""

    def __init__(self, max_failures: int, ban_seconds: float) -> None:
        self.max_failures = max(1, int(max_failures))
        self.ban_seconds = max(1.0, float(ban_seconds))
        self._fails: dict[str, int] = {}
        self._banned_until: dict[str, float] = {}
        self._lock = threading.Lock()

    def banned_for(self, key: str) -> float:
        """Сколько секунд осталось сидеть (0 — не забанен)."""
        with self._lock:
            until = self._banned_until.get(key)
            if until is None:
                return 0.0
            left = until - time.monotonic()
            if left <= 0:
                self._banned_until.pop(key, None)
                self._fails.pop(key, None)
                return 0.0
            return left

    def record_failure(self, key: str) -> None:
        with self._lock:
            n = self._fails.get(key, 0) + 1
            self._fails[key] = n
            if n >= self.max_failures:
                self._banned_until[key] = time.monotonic() + self.ban_seconds

    def record_success(self, key: str) -> None:
        with self._lock:
            self._fails.pop(key, None)
            self._banned_until.pop(key, None)


class Guard:
    """Всё вместе: один вызов на запрос."""

    def __init__(
        self,
        per_ip_limit: int = 60,
        per_ip_window: float = 60.0,
        global_limit: int = 240,
        global_window: float = 60.0,
        max_auth_failures: int = 8,
        ban_seconds: float = 600.0,
    ) -> None:
        self.per_ip = SlidingWindow(per_ip_limit, per_ip_window)
        self.global_ = SlidingWindow(global_limit, global_window)
        self.ban = FailureBan(max_auth_failures, ban_seconds)

    def check(self, ip: str) -> tuple[bool, int, str]:
        """(пропустить, retry_after_сек, причина отказа)."""
        left = self.ban.banned_for(ip)
        if left > 0:
            return False, int(left) + 1, "too many failed auth attempts"

        ok, retry = self.per_ip.check(ip)
        if not ok:
            return False, int(retry) + 1, "rate limit (per ip)"

        ok, retry = self.global_.check("*")
        if not ok:
            # Глобальный предел — общая нагрузка на ядро, а не вина этого IP.
            return False, int(retry) + 1, "rate limit (bridge busy)"

        self.per_ip.prune()
        return True, 0, ""


def client_ip(headers, fallback: str) -> str:
    """Настоящий адрес клиента за cloudflared/прокси.

    Заголовкам верим только как подсказке — распределённую атаку с подменой
    заголовков ловит глобальный лимит, который на них не смотрит.
    """
    cf = headers.get("CF-Connecting-IP")
    if cf:
        return cf.strip()
    xff = headers.get("X-Forwarded-For")
    if xff:
        return xff.split(",")[0].strip()
    return fallback
