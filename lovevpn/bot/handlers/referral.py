"""Love VPN — реферальная программа: ссылка, статистика, кнопка «поделиться»."""

from __future__ import annotations

from aiogram import F, Router
from aiogram.filters import Command
from aiogram.types import CallbackQuery, Message

from bot import keyboards, texts
from bot.config import ref_link
from bot.services import db

router = Router(name="referral")


def _screen(tg_id: int) -> tuple[str, object]:
    link = ref_link(tg_id)
    text = texts.referral_screen(link, db.referral_stats(tg_id))
    return text, keyboards.share_menu(link)


@router.callback_query(F.data == keyboards.CB_REF)
async def show_referral(query: CallbackQuery) -> None:
    if query.from_user is None or query.message is None:
        return
    text, markup = _screen(query.from_user.id)
    await query.message.edit_text(text, reply_markup=markup)
    await query.answer()


@router.message(Command("ref"))
async def cmd_referral(message: Message) -> None:
    if message.from_user is None:
        return
    text, markup = _screen(message.from_user.id)
    await message.answer(text, reply_markup=markup)
