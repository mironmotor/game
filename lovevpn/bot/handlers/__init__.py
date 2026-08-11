"""Love VPN — роутеры обработчиков.

Порядок важен: admin идёт первым, но закрыт фильтром IsAdmin, поэтому для
обычных пользователей его сообщения проваливаются в следующие роутеры.
"""

from bot.handlers import account, admin, buy, referral, start

routers = (
    admin.router,
    start.router,
    buy.router,
    account.router,
    referral.router,
)

__all__ = ["routers"]
