"""Love VPN — точка входа бота.

Запуск:  python3 -m bot.main    (из каталога lovevpn/, с BOT_TOKEN в .env)
"""

from __future__ import annotations

import asyncio
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from aiogram import Bot, Dispatcher  # noqa: E402
from aiogram.client.default import DefaultBotProperties  # noqa: E402
from aiogram.enums import ParseMode  # noqa: E402
from aiogram.exceptions import TelegramNetworkError, TelegramUnauthorizedError  # noqa: E402
from aiogram.types import BotCommand  # noqa: E402

from bot.config import BOT_TOKEN, BRAND, CONFIGS_FILE, DB_PATH, admin_ids  # noqa: E402
from bot.handlers import routers  # noqa: E402
from bot.services import pool  # noqa: E402

logger = logging.getLogger("lovevpn")

COMMANDS = [
    BotCommand(command="start", description="Главное меню"),
    BotCommand(command="buy", description="Купить доступ"),
    BotCommand(command="status", description="Моя подписка"),
    BotCommand(command="ref", description="Пригласить друга"),
    BotCommand(command="help", description="Как подключиться"),
]


async def run() -> None:
    if not BOT_TOKEN:
        raise SystemExit(
            "BOT_TOKEN не задан.\n"
            "Создайте lovevpn/.env (см. .env.example) и положите туда токен от @BotFather.\n"
            "Токен — это пароль от бота: не публикуйте его и не коммитьте в git."
        )

    # Первичная загрузка пула: если рядом лежит configs.txt, подхватываем его.
    if CONFIGS_FILE.exists() and pool.total_count() == 0:
        result = pool.import_file(CONFIGS_FILE)
        logger.info("Импортировано конфигов из %s: %s", CONFIGS_FILE.name, result)

    bot = Bot(
        token=BOT_TOKEN,
        default=DefaultBotProperties(parse_mode=ParseMode.HTML),
    )
    dispatcher = Dispatcher()
    dispatcher.include_routers(*routers)

    # Первый же запрос проверяет токен и связь — понятные ошибки вместо трейсбека.
    try:
        me = await bot.get_me()
    except TelegramUnauthorizedError:
        await bot.session.close()
        raise SystemExit(
            "Telegram отклонил токен.\n"
            "Проверьте BOT_TOKEN в файле lovevpn/.env — он выглядит так: 1234567890:AAH-xxxxx\n"
            "Новый токен можно взять у @BotFather: ваш бот → Bot Settings → API Token."
        )
    except TelegramNetworkError as exc:
        await bot.session.close()
        raise SystemExit(
            f"Нет связи с Telegram: {exc}\n"
            "Проверьте интернет. Если сидите через VPN или прокси — попробуйте выключить их."
        )

    logger.info("%s запущен как @%s", BRAND, me.username)
    logger.info("База: %s", DB_PATH)
    logger.info("Свободных ключей: %s из %s", pool.free_count(), pool.total_count())
    if not admin_ids():
        logger.warning(
            "LOVEVPN_ADMIN_IDS не задан — админские команды недоступны никому. "
            "Узнать свой ID можно у @userinfobot."
        )

    await bot.set_my_commands(COMMANDS)
    # Снимаем возможный вебхук: long polling и вебхук одновременно не работают.
    await bot.delete_webhook(drop_pending_updates=True)
    try:
        await dispatcher.start_polling(bot)
    finally:
        await bot.session.close()


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)-8s %(name)s: %(message)s",
    )
    try:
        asyncio.run(run())
    except (KeyboardInterrupt, SystemExit) as exc:
        if isinstance(exc, SystemExit) and exc.code:
            raise
        logger.info("Остановлено")


if __name__ == "__main__":
    main()
