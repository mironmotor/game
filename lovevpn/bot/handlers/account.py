"""Love VPN — статус подписки, выдача ключа, пробный период."""

from __future__ import annotations

from aiogram import Bot, F, Router
from aiogram.filters import Command
from aiogram.types import CallbackQuery, Message

from bot import keyboards, texts
from bot.config import TRIAL_DAYS
from bot.handlers.common import menu_for, send_key
from bot.services import db

router = Router(name="account")


@router.callback_query(F.data == keyboards.CB_KEY)
async def my_key(query: CallbackQuery, bot: Bot) -> None:
    if query.from_user is None or query.message is None:
        return
    tg_id = query.from_user.id
    await query.answer()

    if not db.is_active(tg_id):
        await query.message.edit_text(
            texts.NEED_SUBSCRIPTION, reply_markup=keyboards.plans_menu()
        )
        return

    await query.message.edit_text(
        texts.subscription_status(
            active=True, expires=db.expires_at(tg_id), days=db.days_left(tg_id)
        ),
        reply_markup=keyboards.back_menu(),
    )
    await send_key(bot, tg_id)


@router.message(Command("status"))
async def cmd_status(message: Message) -> None:
    user = message.from_user
    if user is None:
        return
    await message.answer(
        texts.subscription_status(
            active=db.is_active(user.id),
            expires=db.expires_at(user.id),
            days=db.days_left(user.id),
        ),
        reply_markup=menu_for(user.id),
    )


@router.callback_query(F.data == keyboards.CB_TRIAL)
async def start_trial(query: CallbackQuery, bot: Bot) -> None:
    if query.from_user is None or query.message is None:
        return
    tg_id = query.from_user.id
    await query.answer()

    expires = db.start_trial(tg_id, TRIAL_DAYS)
    if expires is None:
        await query.message.edit_text(
            texts.TRIAL_ALREADY_USED, reply_markup=keyboards.plans_menu()
        )
        return

    await query.message.edit_text(
        texts.trial_started(TRIAL_DAYS, expires), reply_markup=keyboards.back_menu()
    )
    await send_key(bot, tg_id)
