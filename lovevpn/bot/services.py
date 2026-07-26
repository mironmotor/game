"""Love VPN — общие объекты бота (база и пул ключей).

Бот работает одним процессом, поэтому база и пул создаются один раз здесь,
а обработчики их просто импортируют.
"""

from __future__ import annotations

from bot.config import DB_PATH
from bot.db import Database
from bot.keys import KeyPool

db = Database(DB_PATH)
pool = KeyPool(db)
