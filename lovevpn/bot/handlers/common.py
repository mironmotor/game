"""Love VPN — общие помощники обработчиков."""

from __future__ import annotations

from aiogram import Bot
from aiogram.types import InlineKeyboardMarkup

from bot import keyboards, texts
from bot.config import SUPPORT_CONTACT, TRIAL_DAYS
from bot.services import db, pool


def trial_available(tg_id: int) -> bool:
    if TRIAL_DAYS <= 0:
        return False
    user = db.get_user(tg_id)
    return bool(user and not user["trial_used"])


def menu_for(tg_id: int) -> InlineKeyboardMarkup:
    return keyboards.main_menu(show_trial=trial_available(tg_id))


async def send_key(bot: Bot, tg_id: int) -> bool:
    """Выдаёт и отправляет ключ. False — если свободных конфигов не осталось."""
    config = pool.issue(tg_id)
    if not config:
        await bot.send_message(
            tg_id, texts.NO_KEYS_LEFT + texts.support_line(SUPPORT_CONTACT)
        )
        return False
    await bot.send_message(
        tg_id, texts.key_message(config), reply_markup=keyboards.back_menu()
    )
    return True
