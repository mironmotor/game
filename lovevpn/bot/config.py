"""Love VPN — конфигурация бота. Всё настраиваемое собрано в этом файле."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent  # каталог lovevpn/

BRAND = "Love VPN"


def load_dotenv(path: Path | None = None) -> None:
    """Читает lovevpn/.env в os.environ — без внешних зависимостей.

    Переменные, уже заданные в окружении, имеют приоритет: так на сервере
    можно переопределить любое значение из .env, ничего не редактируя.
    """
    env_path = path or ROOT / ".env"
    if not env_path.exists():
        return
    for raw in env_path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


load_dotenv()


def _int_env(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, "").strip() or default)
    except ValueError:
        return default


@dataclass(frozen=True)
class Plan:
    code: str
    title: str
    days: int
    price_rub: int
    price_stars: int
    devices: int


# Цены в рублях взяты с лендинга. Суммы в звёздах задаются отдельно: курс
# звезды к рублю не фиксирован, поэтому перед запуском сверьтесь с актуальным
# и при необходимости переопределите через .env.
PLANS: dict[str, Plan] = {
    "m1": Plan(
        code="m1",
        title="1 месяц",
        days=30,
        price_rub=199,
        price_stars=_int_env("LOVEVPN_STARS_M1", 120),
        devices=3,
    ),
    "m6": Plan(
        code="m6",
        title="6 месяцев",
        days=180,
        price_rub=555,
        price_stars=_int_env("LOVEVPN_STARS_M6", 330),
        devices=5,
    ),
    "m12": Plan(
        code="m12",
        title="12 месяцев",
        days=365,
        price_rub=999,
        price_stars=_int_env("LOVEVPN_STARS_M12", 600),
        devices=10,
    ),
}

POPULAR_PLAN = "m6"

BOT_TOKEN = os.environ.get("BOT_TOKEN", "").strip()
BOT_USERNAME = os.environ.get("LOVEVPN_BOT_USERNAME", "lovemevpn_bot").lstrip("@")

DB_PATH = Path(os.environ.get("LOVEVPN_DB_PATH", "").strip() or ROOT / "state" / "lovevpn.db")
CONFIGS_FILE = Path(os.environ.get("LOVEVPN_CONFIGS_FILE", "").strip() or ROOT / "configs.txt")

TRIAL_DAYS = _int_env("LOVEVPN_TRIAL_DAYS", 3)
REFERRAL_BONUS_DAYS = _int_env("LOVEVPN_REFERRAL_BONUS_DAYS", 30)

# Предупреждать за столько дней до конца подписки (команда напоминаний).
EXPIRY_WARN_DAYS = _int_env("LOVEVPN_EXPIRY_WARN_DAYS", 3)

SUPPORT_CONTACT = os.environ.get("LOVEVPN_SUPPORT", "").strip()


def admin_ids() -> set[int]:
    """ID администраторов из LOVEVPN_ADMIN_IDS (через запятую)."""
    raw = os.environ.get("LOVEVPN_ADMIN_IDS", "")
    result: set[int] = set()
    for chunk in raw.replace(";", ",").split(","):
        chunk = chunk.strip()
        if chunk.lstrip("-").isdigit():
            result.add(int(chunk))
    return result


def is_admin(tg_id: int) -> bool:
    return tg_id in admin_ids()


def ref_link(tg_id: int) -> str:
    """Персональная реферальная ссылка пользователя."""
    return f"https://t.me/{BOT_USERNAME}?start=ref_{tg_id}"
