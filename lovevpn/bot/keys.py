"""Love VPN — выдача VPN-ключей из пула готовых конфигов.

Сейчас источник ключей — текстовый файл со ссылками (vless:// , ss:// , vmess:// ,
trojan://). Одна строка — один конфиг.

Если позже захочется выдавать ключи через панель (3x-ui / Marzban / Outline),
достаточно написать класс с теми же четырьмя методами — import_lines, issue,
release, counts — и подменить его в handlers: остальной код о происхождении
ключей ничего не знает.
"""

from __future__ import annotations

from pathlib import Path

from bot.db import Database, now_utc, to_iso

# Схемы, которые считаем валидным VPN-конфигом при импорте.
KNOWN_SCHEMES = ("vless://", "vmess://", "ss://", "ssconf://", "trojan://", "hy2://", "hysteria2://")


class KeyPool:
    def __init__(self, db: Database) -> None:
        self.db = db

    # ---------------------------------------------------------------- импорт

    def import_lines(self, lines: list[str]) -> dict[str, int]:
        """Загружает конфиги в пул.

        Возвращает {added, duplicates, skipped}. Дубликаты отсекаются
        на уровне UNIQUE(config), поэтому один и тот же файл можно
        импортировать повторно — новых записей не появится.
        """
        added = duplicates = skipped = 0
        with self.db._conn() as c:
            for raw in lines:
                config = raw.strip()
                if not config or config.startswith("#"):
                    continue
                if not config.lower().startswith(KNOWN_SCHEMES):
                    skipped += 1
                    continue
                cur = c.execute(
                    "INSERT OR IGNORE INTO vpn_keys (config, status) VALUES (?, 'free')",
                    (config,),
                )
                if cur.rowcount > 0:
                    added += 1
                else:
                    duplicates += 1
        return {"added": added, "duplicates": duplicates, "skipped": skipped}

    def import_file(self, path: Path) -> dict[str, int]:
        path = Path(path)
        if not path.exists():
            return {"added": 0, "duplicates": 0, "skipped": 0}
        text = path.read_text(encoding="utf-8", errors="replace")
        return self.import_lines(text.splitlines())

    # ---------------------------------------------------------------- выдача

    def current(self, tg_id: int) -> str | None:
        """Ключ, уже закреплённый за пользователем."""
        with self.db._conn() as c:
            row = c.execute(
                "SELECT config FROM vpn_keys WHERE assigned_to = ? AND status = 'assigned'",
                (tg_id,),
            ).fetchone()
        return row["config"] if row else None

    def issue(self, tg_id: int) -> str | None:
        """Выдаёт ключ пользователю.

        Если ключ уже закреплён — возвращает его же: при продлении подписки
        пользователю не нужно заново настраивать приложение. None означает,
        что свободных конфигов в пуле не осталось.
        """
        existing = self.current(tg_id)
        if existing:
            return existing
        with self.db._conn() as c:
            row = c.execute(
                "SELECT id, config FROM vpn_keys WHERE status = 'free' ORDER BY id LIMIT 1"
            ).fetchone()
            if not row:
                return None
            # Условие status = 'free' в UPDATE защищает от гонки, если два
            # обработчика одновременно выбрали одну и ту же строку.
            cur = c.execute(
                """
                UPDATE vpn_keys SET status = 'assigned', assigned_to = ?, assigned_at = ?
                WHERE id = ? AND status = 'free'
                """,
                (tg_id, to_iso(now_utc()), row["id"]),
            )
            if cur.rowcount == 0:
                return None
        return row["config"]

    def release(self, tg_id: int) -> int:
        """Возвращает ключи пользователя в пул. Отдаёт количество освобождённых."""
        with self.db._conn() as c:
            cur = c.execute(
                """
                UPDATE vpn_keys SET status = 'free', assigned_to = NULL, assigned_at = NULL
                WHERE assigned_to = ?
                """,
                (tg_id,),
            )
        return cur.rowcount

    # -------------------------------------------------------------- счётчики

    def free_count(self) -> int:
        with self.db._conn() as c:
            row = c.execute(
                "SELECT COUNT(*) AS n FROM vpn_keys WHERE status = 'free'"
            ).fetchone()
        return int(row["n"]) if row else 0

    def total_count(self) -> int:
        with self.db._conn() as c:
            row = c.execute("SELECT COUNT(*) AS n FROM vpn_keys").fetchone()
        return int(row["n"]) if row else 0
