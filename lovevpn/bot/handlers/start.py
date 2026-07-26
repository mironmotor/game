"""Love VPN — /start, главное меню, помощь."""

from __future__ import annotations

from aiogram import F, Router
from aiogram.filters import Command, CommandObject, CommandStart
from aiogram.types import CallbackQuery, Message

from bot import keyboards, texts
from bot.config import SUPPORT_CONTACT
from bot.handlers.common import menu_for
from bot.services import db

router = Router(name="start")


def parse_ref(args: str | None) -> int | None:
    """Разбирает аргумент deep link: ref_123456 или просто 123456."""
    if not args:
        return None
    raw = args.strip()
    if raw.startswith("ref_"):
        raw = raw[4:]
    return int(raw) if raw.isdigit() else None


@router.message(CommandStart())
async def cmd_start(message: Message, command: CommandObject) -> None:
    user = message.from_user
    if user is None:
        return
    referrer = parse_ref(command.args)
    created = db.create_user(user.id, user.username, referred_by=referrer)
    # Ссылка учитывается только при первом заходе: иначе existing-пользователь
    # мог бы «переприкрепиться» к другому пригласившему.
    invited_by_friend = created and db.referrer_of(user.id) is not None
    await message.answer(
        texts.welcome(user.first_name or "друг", invited_by_friend=invited_by_friend),
        reply_markup=menu_for(user.id),
    )


@router.callback_query(F.data == keyboards.CB_MENU)
async def show_menu(query: CallbackQuery) -> None:
    if query.from_user is None or query.message is None:
        return
    await query.message.edit_text(
        texts.welcome(query.from_user.first_name or "друг", invited_by_friend=False),
        reply_markup=menu_for(query.from_user.id),
    )
    await query.answer()


@router.callback_query(F.data == keyboards.CB_HELP)
async def show_help(query: CallbackQuery) -> None:
    if query.message is None:
        return
    await query.message.edit_text(
        texts.HELP + texts.support_line(SUPPORT_CONTACT),
        reply_markup=keyboards.back_menu(),
    )
    await query.answer()


@router.message(Command("help"))
async def cmd_help(message: Message) -> None:
    await message.answer(
        texts.HELP + texts.support_line(SUPPORT_CONTACT),
        reply_markup=keyboards.back_menu(),
    )
