"""Love VPN — админские команды.

Весь роутер закрыт фильтром IsAdmin: для остальных пользователей эти команды
просто не существуют (сообщение проваливается в следующие роутеры), так что
список админских возможностей никому не подсказывается.
"""

from __future__ import annotations

import logging
from io import BytesIO

from aiogram import Bot, F, Router
from aiogram.filters import BaseFilter, Command, CommandObject
from aiogram.types import Message, TelegramObject

from bot import texts
from bot.config import CONFIGS_FILE, EXPIRY_WARN_DAYS, is_admin
from bot.db import from_iso, now_utc
from bot.services import db, pool

logger = logging.getLogger(__name__)


class IsAdmin(BaseFilter):
    async def __call__(self, event: TelegramObject) -> bool:
        user = getattr(event, "from_user", None)
        return user is not None and is_admin(user.id)


router = Router(name="admin")
router.message.filter(IsAdmin())


@router.message(Command("admin"))
async def cmd_admin(message: Message) -> None:
    await message.answer(texts.ADMIN_HELP)


@router.message(Command("stats"))
async def cmd_stats(message: Message) -> None:
    await message.answer(texts.admin_stats(db.stats()))


@router.message(Command("grant"))
async def cmd_grant(message: Message, command: CommandObject) -> None:
    parts = (command.args or "").split()
    if len(parts) != 2 or not parts[0].isdigit() or not parts[1].lstrip("-").isdigit():
        await message.answer("Формат: <code>/grant &lt;tg_id&gt; &lt;дней&gt;</code>")
        return
    tg_id, days = int(parts[0]), int(parts[1])
    db.create_user(tg_id)
    expires = db.add_days(tg_id, days, plan="manual")
    await message.answer(
        f"Начислено {days} дн. пользователю <code>{tg_id}</code>.\n"
        f"Подписка активна до <b>{texts.fmt_date(expires)}</b>."
    )


@router.message(Command("revoke"))
async def cmd_revoke(message: Message, command: CommandObject) -> None:
    raw = (command.args or "").strip()
    if not raw.isdigit():
        await message.answer("Формат: <code>/revoke &lt;tg_id&gt;</code>")
        return
    released = pool.release(int(raw))
    await message.answer(
        f"Возвращено ключей в пул: <b>{released}</b>. "
        f"Свободно сейчас: <b>{pool.free_count()}</b>."
    )


@router.message(Command("addkeys"))
async def cmd_addkeys(message: Message) -> None:
    await message.answer(
        "Пришлите <b>.txt файлом</b>: по одному конфигу в строке "
        "(<code>vless://…</code>, <code>ss://…</code>).\n\n"
        f"Свободных ключей сейчас: <b>{pool.free_count()}</b> "
        f"из <b>{pool.total_count()}</b>."
    )


@router.message(Command("importfile"))
async def cmd_importfile(message: Message) -> None:
    """Импорт из файла, лежащего рядом с ботом (для первой загрузки пула)."""
    if not CONFIGS_FILE.exists():
        await message.answer(f"Файл не найден: <code>{CONFIGS_FILE}</code>")
        return
    result = pool.import_file(CONFIGS_FILE)
    await message.answer(texts.admin_import_result(result, pool.free_count()))


@router.message(F.document)
async def import_document(message: Message, bot: Bot) -> None:
    document = message.document
    if document is None:
        return
    buffer = BytesIO()
    await bot.download(document, destination=buffer)
    text = buffer.getvalue().decode("utf-8", errors="replace")
    result = pool.import_lines(text.splitlines())
    await message.answer(texts.admin_import_result(result, pool.free_count()))


@router.message(Command("remind"))
async def cmd_remind(message: Message, bot: Bot) -> None:
    rows = db.expiring_soon(EXPIRY_WARN_DAYS)
    sent = failed = 0
    for row in rows:
        expires = from_iso(row["expires_at"])
        if expires is None:
            continue
        days = max(1, (expires - now_utc()).days)
        try:
            await bot.send_message(row["tg_id"], texts.expiry_reminder(days))
            sent += 1
        except Exception as exc:
            failed += 1
            logger.info("Напоминание не доставлено %s: %s", row["tg_id"], exc)
    await message.answer(
        f"Напоминания отправлены: <b>{sent}</b>. Не доставлено: {failed}."
    )
