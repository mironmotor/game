"""Love VPN — клавиатуры бота."""

from __future__ import annotations

from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup

from bot import texts
from bot.config import PLANS

CB_MENU = "menu"
CB_BUY = "buy"
CB_PLAN = "plan"  # plan:<code>
CB_KEY = "mykey"
CB_TRIAL = "trial"
CB_REF = "ref"
CB_HELP = "help"


def main_menu(*, show_trial: bool) -> InlineKeyboardMarkup:
    rows = [
        [InlineKeyboardButton(text=texts.BTN_BUY, callback_data=CB_BUY)],
        [InlineKeyboardButton(text=texts.BTN_MY_KEY, callback_data=CB_KEY)],
    ]
    if show_trial:
        rows.append([InlineKeyboardButton(text=texts.BTN_TRIAL, callback_data=CB_TRIAL)])
    rows += [
        [InlineKeyboardButton(text=texts.BTN_REFERRAL, callback_data=CB_REF)],
        [InlineKeyboardButton(text=texts.BTN_HELP, callback_data=CB_HELP)],
    ]
    return InlineKeyboardMarkup(inline_keyboard=rows)


def plans_menu() -> InlineKeyboardMarkup:
    rows = [
        [
            InlineKeyboardButton(
                text=texts.plan_button(plan), callback_data=f"{CB_PLAN}:{plan.code}"
            )
        ]
        for plan in PLANS.values()
    ]
    rows.append([InlineKeyboardButton(text=texts.BTN_BACK, callback_data=CB_MENU)])
    return InlineKeyboardMarkup(inline_keyboard=rows)


def back_menu() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[[InlineKeyboardButton(text=texts.BTN_BACK, callback_data=CB_MENU)]]
    )


def share_menu(link: str) -> InlineKeyboardMarkup:
    """Кнопка «поделиться» открывает выбор чата с готовым текстом."""
    share_text = f"Пользуюсь Love VPN — быстрый и без логов. Заходи по моей ссылке: {link}"
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(
                    text="\U0001f4e4 Отправить другу",
                    url=f"https://t.me/share/url?url={link}&text={share_text}",
                )
            ],
            [InlineKeyboardButton(text=texts.BTN_BACK, callback_data=CB_MENU)],
        ]
    )
