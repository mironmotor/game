"""Love VPN — оплата через Telegram Stars.

Stars выбраны потому, что не требуют юрлица, договора с платёжным провайдером и
работают внутри Telegram сразу. Чтобы добавить ЮKassa или крипту, достаточно
написать ещё одну функцию отправки инвойса и разобрать её payload в том же
обработчике successful_payment — остальная логика подписки не меняется.
"""

from __future__ import annotations

from aiogram import Bot
from aiogram.types import LabeledPrice

from bot import texts
from bot.config import BRAND, PLANS, Plan

CURRENCY = "XTR"  # внутренняя валюта Telegram Stars
PROVIDER = "telegram_stars"
PAYLOAD_PREFIX = "lovevpn"


def make_payload(plan: Plan) -> str:
    return f"{PAYLOAD_PREFIX}:{plan.code}"


def parse_payload(payload: str) -> Plan | None:
    """Достаёт тариф из payload инвойса. None — если payload чужой."""
    if not payload.startswith(f"{PAYLOAD_PREFIX}:"):
        return None
    return PLANS.get(payload.split(":", 1)[1])


async def send_stars_invoice(bot: Bot, chat_id: int, plan: Plan) -> None:
    await bot.send_invoice(
        chat_id=chat_id,
        title=f"{BRAND} — {plan.title}",
        description=texts.invoice_description(plan),
        payload=make_payload(plan),
        provider_token="",  # для Stars токен провайдера не нужен
        currency=CURRENCY,
        prices=[LabeledPrice(label=plan.title, amount=plan.price_stars)],
    )
