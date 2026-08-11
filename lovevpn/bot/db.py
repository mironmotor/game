"""Love VPN — хранилище на SQLite.

Идиома та же, что в mark17/hippocampus.py: подключение через _conn() с
row_factory = sqlite3.Row и схема, создаваемая через CREATE TABLE IF NOT EXISTS.
Модуль намеренно не зависит от aiogram — его логику можно проверить без Telegram
(см. bot/smoke.py).
"""

from __future__ import annotations

import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def to_iso(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).isoformat(timespec="seconds")


def from_iso(raw: str | None) -> datetime | None:
    if not raw:
        return None
    try:
        parsed = datetime.fromisoformat(raw)
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


class Database:
    def __init__(self, db_path: Path) -> None:
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        with self._conn() as c:
            c.execute(
                """
                CREATE TABLE IF NOT EXISTS users (
                    tg_id INTEGER PRIMARY KEY,
                    username TEXT,
                    created_at TEXT NOT NULL,
                    referred_by INTEGER,
                    bonus_days INTEGER DEFAULT 0,
                    trial_used INTEGER DEFAULT 0
                )
                """
            )
            c.execute(
                """
                CREATE TABLE IF NOT EXISTS subscriptions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    tg_id INTEGER NOT NULL UNIQUE,
                    plan TEXT NOT NULL,
                    started_at TEXT NOT NULL,
                    expires_at TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'active',
                    updated_at TEXT NOT NULL
                )
                """
            )
            c.execute(
                """
                CREATE TABLE IF NOT EXISTS payments (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    tg_id INTEGER NOT NULL,
                    plan TEXT NOT NULL,
                    amount INTEGER NOT NULL,
                    currency TEXT NOT NULL,
                    provider TEXT NOT NULL,
                    charge_id TEXT,
                    status TEXT NOT NULL DEFAULT 'paid',
                    created_at TEXT NOT NULL
                )
                """
            )
            c.execute(
                """
                CREATE TABLE IF NOT EXISTS vpn_keys (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    config TEXT NOT NULL UNIQUE,
                    status TEXT NOT NULL DEFAULT 'free',
                    assigned_to INTEGER,
                    assigned_at TEXT
                )
                """
            )
            # UNIQUE(invited_id) — страховка от повторного начисления бонуса
            # за одного и того же приглашённого.
            c.execute(
                """
                CREATE TABLE IF NOT EXISTS referrals (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    referrer_id INTEGER NOT NULL,
                    invited_id INTEGER NOT NULL UNIQUE,
                    rewarded_at TEXT NOT NULL
                )
                """
            )
            c.execute("CREATE INDEX IF NOT EXISTS idx_keys_status ON vpn_keys(status)")
            c.execute("CREATE INDEX IF NOT EXISTS idx_keys_owner ON vpn_keys(assigned_to)")
            c.execute("CREATE INDEX IF NOT EXISTS idx_pay_user ON payments(tg_id)")
            c.execute("CREATE INDEX IF NOT EXISTS idx_ref_referrer ON referrals(referrer_id)")

    # ------------------------------------------------------------------ users

    def get_user(self, tg_id: int) -> sqlite3.Row | None:
        with self._conn() as c:
            return c.execute("SELECT * FROM users WHERE tg_id = ?", (tg_id,)).fetchone()

    def create_user(
        self, tg_id: int, username: str | None = None, referred_by: int | None = None
    ) -> bool:
        """Создаёт пользователя. Возвращает True, если он появился впервые.

        Самореферал отбрасывается здесь же — это единственное место, где
        referred_by вообще записывается, поэтому проверка не обходится.
        """
        if referred_by is not None and referred_by == tg_id:
            referred_by = None
        with self._conn() as c:
            cur = c.execute(
                """
                INSERT OR IGNORE INTO users (tg_id, username, created_at, referred_by)
                VALUES (?, ?, ?, ?)
                """,
                (tg_id, username, to_iso(now_utc()), referred_by),
            )
            created = cur.rowcount > 0
            if not created and username:
                c.execute("UPDATE users SET username = ? WHERE tg_id = ?", (username, tg_id))
        return created

    def referrer_of(self, tg_id: int) -> int | None:
        user = self.get_user(tg_id)
        return int(user["referred_by"]) if user and user["referred_by"] else None

    # ---------------------------------------------------------- subscriptions

    def expires_at(self, tg_id: int) -> datetime | None:
        with self._conn() as c:
            row = c.execute(
                "SELECT expires_at FROM subscriptions WHERE tg_id = ?", (tg_id,)
            ).fetchone()
        return from_iso(row["expires_at"]) if row else None

    def is_active(self, tg_id: int) -> bool:
        expiry = self.expires_at(tg_id)
        return bool(expiry and expiry > now_utc())

    def days_left(self, tg_id: int) -> int:
        expiry = self.expires_at(tg_id)
        if not expiry:
            return 0
        remaining = expiry - now_utc()
        return max(0, remaining.days + (1 if remaining.seconds else 0))

    def add_days(self, tg_id: int, days: int, plan: str = "bonus") -> datetime:
        """Продлевает подписку на days дней.

        Если подписка ещё активна — прибавляем к текущей дате окончания,
        если уже истекла — считаем от «сейчас», чтобы не дарить пропущенное время.
        """
        moment = now_utc()
        current = self.expires_at(tg_id)
        base = current if current and current > moment else moment
        new_expiry = base + timedelta(days=days)
        with self._conn() as c:
            c.execute(
                """
                INSERT INTO subscriptions (tg_id, plan, started_at, expires_at, status, updated_at)
                VALUES (?, ?, ?, ?, 'active', ?)
                ON CONFLICT(tg_id) DO UPDATE SET
                    plan = excluded.plan,
                    expires_at = excluded.expires_at,
                    status = 'active',
                    updated_at = excluded.updated_at
                """,
                (tg_id, plan, to_iso(moment), to_iso(new_expiry), to_iso(moment)),
            )
        return new_expiry

    def start_trial(self, tg_id: int, days: int) -> datetime | None:
        """Выдаёт пробный период один раз на аккаунт. None — если уже был."""
        user = self.get_user(tg_id)
        if not user:
            return None
        with self._conn() as c:
            cur = c.execute(
                "UPDATE users SET trial_used = 1 WHERE tg_id = ? AND trial_used = 0",
                (tg_id,),
            )
            if cur.rowcount == 0:
                return None
        return self.add_days(tg_id, days, plan="trial")

    # -------------------------------------------------------------- payments

    def record_payment(
        self,
        tg_id: int,
        plan: str,
        amount: int,
        currency: str,
        provider: str,
        charge_id: str | None = None,
    ) -> int:
        with self._conn() as c:
            cur = c.execute(
                """
                INSERT INTO payments (tg_id, plan, amount, currency, provider, charge_id, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (tg_id, plan, amount, currency, provider, charge_id, to_iso(now_utc())),
            )
        return int(cur.lastrowid or 0)

    def payments_count(self, tg_id: int) -> int:
        with self._conn() as c:
            row = c.execute(
                "SELECT COUNT(*) AS n FROM payments WHERE tg_id = ? AND status = 'paid'",
                (tg_id,),
            ).fetchone()
        return int(row["n"]) if row else 0

    # ------------------------------------------------------------- referrals

    def reward_referral(self, invited_id: int, bonus_days: int) -> int | None:
        """Начисляет бонус пригласившему и приглашённому.

        Возвращает ID пригласившего или None, если начислять нечего:
        нет пригласившего, либо за этого приглашённого уже награждали.
        Вставка в referrals с UNIQUE(invited_id) и служит защёлкой.
        """
        referrer_id = self.referrer_of(invited_id)
        if not referrer_id:
            return None
        with self._conn() as c:
            cur = c.execute(
                """
                INSERT OR IGNORE INTO referrals (referrer_id, invited_id, rewarded_at)
                VALUES (?, ?, ?)
                """,
                (referrer_id, invited_id, to_iso(now_utc())),
            )
            if cur.rowcount == 0:
                return None
            c.execute(
                "UPDATE users SET bonus_days = bonus_days + ? WHERE tg_id IN (?, ?)",
                (bonus_days, referrer_id, invited_id),
            )
        self.add_days(referrer_id, bonus_days, plan="referral")
        self.add_days(invited_id, bonus_days, plan="referral")
        return referrer_id

    def referral_stats(self, tg_id: int) -> dict[str, int]:
        with self._conn() as c:
            invited = c.execute(
                "SELECT COUNT(*) AS n FROM users WHERE referred_by = ?", (tg_id,)
            ).fetchone()
            rewarded = c.execute(
                "SELECT COUNT(*) AS n FROM referrals WHERE referrer_id = ?", (tg_id,)
            ).fetchone()
            user = c.execute(
                "SELECT bonus_days FROM users WHERE tg_id = ?", (tg_id,)
            ).fetchone()
        return {
            "invited": int(invited["n"]) if invited else 0,
            "rewarded": int(rewarded["n"]) if rewarded else 0,
            "bonus_days": int(user["bonus_days"]) if user else 0,
        }

    # ------------------------------------------------------------ статистика

    def stats(self) -> dict[str, Any]:
        with self._conn() as c:
            def one(sql: str, *args: Any) -> int:
                row = c.execute(sql, args).fetchone()
                return int(row["n"]) if row else 0

            return {
                "users": one("SELECT COUNT(*) AS n FROM users"),
                "active": one(
                    "SELECT COUNT(*) AS n FROM subscriptions WHERE expires_at > ?",
                    to_iso(now_utc()),
                ),
                "payments": one("SELECT COUNT(*) AS n FROM payments WHERE status = 'paid'"),
                "referrals": one("SELECT COUNT(*) AS n FROM referrals"),
                "keys_free": one("SELECT COUNT(*) AS n FROM vpn_keys WHERE status = 'free'"),
                "keys_assigned": one(
                    "SELECT COUNT(*) AS n FROM vpn_keys WHERE status = 'assigned'"
                ),
            }

    def expiring_soon(self, within_days: int) -> list[sqlite3.Row]:
        """Подписки, которые заканчиваются в ближайшие within_days дней."""
        moment = now_utc()
        with self._conn() as c:
            return list(
                c.execute(
                    """
                    SELECT tg_id, expires_at FROM subscriptions
                    WHERE expires_at > ? AND expires_at <= ?
                    ORDER BY expires_at
                    """,
                    (to_iso(moment), to_iso(moment + timedelta(days=within_days))),
                )
            )
