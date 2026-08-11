"""Love VPN — проверка логики без Telegram.

Прогоняет весь путь пользователя на временной базе: регистрация по реферальной
ссылке, импорт конфигов, выдача ключа, пробный период, оплата, начисление
бонусов обоим и защита от повторного начисления.

Запуск:  python3 -m bot.smoke      (из каталога lovevpn/)
     или  python3 lovevpn/bot/smoke.py
"""

from __future__ import annotations

import sys
import tempfile
from pathlib import Path

# Чтобы файл запускался и напрямую, и как модуль.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from bot import texts  # noqa: E402
from bot.config import PLANS, REFERRAL_BONUS_DAYS, TRIAL_DAYS  # noqa: E402
from bot.db import Database, now_utc  # noqa: E402
from bot.keys import KeyPool  # noqa: E402

REFERRER = 1000
INVITED = 2000
LONER = 3000

checks = 0


def check(condition: bool, label: str) -> None:
    global checks
    checks += 1
    status = "ok  " if condition else "FAIL"
    print(f"  [{status}] {label}")
    if not condition:
        raise AssertionError(label)


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="lovevpn-smoke-") as tmp:
        db = Database(Path(tmp) / "lovevpn.db")
        pool = KeyPool(db)

        print("\n1. Регистрация и реферальные связи")
        check(db.create_user(REFERRER, "referrer"), "новый пользователь создан")
        check(not db.create_user(REFERRER, "referrer"), "повторный /start не дублирует запись")
        db.create_user(INVITED, "invited", referred_by=REFERRER)
        check(db.referrer_of(INVITED) == REFERRER, "приглашённый привязан к пригласившему")
        db.create_user(LONER, "loner", referred_by=LONER)
        check(db.referrer_of(LONER) is None, "самореферал отброшен")

        print("\n2. Импорт пула конфигов")
        raw = [
            "vless://uuid-1@example.com:443?type=tcp#love-1",
            "vless://uuid-2@example.com:443?type=tcp#love-2",
            "ss://YWVzOnBhc3M@example.com:8388#love-3",
            "",
            "# комментарий, не конфиг",
            "просто мусорная строка",
            "vless://uuid-1@example.com:443?type=tcp#love-1",  # дубликат
        ]
        result = pool.import_lines(raw)
        check(result["added"] == 3, f"добавлено 3 конфига (получено {result['added']})")
        check(result["duplicates"] == 1, "дубликат отсечён")
        check(result["skipped"] == 1, "мусорная строка пропущена")
        check(pool.import_lines(raw)["added"] == 0, "повторный импорт не плодит записи")
        check(pool.free_count() == 3, "все три ключа свободны")

        print("\n3. Пробный период")
        check(not db.is_active(INVITED), "до пробного периода подписки нет")
        expires = db.start_trial(INVITED, TRIAL_DAYS)
        check(expires is not None, f"пробный период выдан ({TRIAL_DAYS} дн.)")
        check(db.is_active(INVITED), "подписка стала активной")
        check(db.start_trial(INVITED, TRIAL_DAYS) is None, "второй раз пробный не выдаётся")

        print("\n4. Выдача ключа")
        key = pool.issue(INVITED)
        check(key is not None, "ключ выдан")
        check(pool.issue(INVITED) == key, "при повторном запросе тот же ключ")
        check(pool.free_count() == 2, "в пуле осталось 2 свободных")

        print("\n5. Оплата и реферальный бонус")
        plan = PLANS["m6"]
        before = db.days_left(REFERRER)
        db.record_payment(INVITED, plan.code, plan.price_stars, "XTR", "telegram_stars", "chg_1")
        paid_until = db.add_days(INVITED, plan.days, plan.code)
        check(db.payments_count(INVITED) == 1, "оплата записана")
        check(db.days_left(INVITED) >= plan.days, f"подписка продлена до {texts.fmt_date(paid_until)}")

        rewarded = db.reward_referral(INVITED, REFERRAL_BONUS_DAYS)
        check(rewarded == REFERRER, "бонус начислен пригласившему")
        check(
            db.days_left(REFERRER) >= before + REFERRAL_BONUS_DAYS - 1,
            f"пригласивший получил +{REFERRAL_BONUS_DAYS} дней",
        )
        check(
            db.reward_referral(INVITED, REFERRAL_BONUS_DAYS) is None,
            "повторное начисление за того же друга заблокировано",
        )
        check(db.reward_referral(LONER, REFERRAL_BONUS_DAYS) is None, "без пригласившего бонуса нет")

        stats = db.referral_stats(REFERRER)
        check(stats["invited"] == 1 and stats["rewarded"] == 1, "статистика рефералки сходится")

        print("\n6. Продление не съедает остаток")
        left_before = db.days_left(REFERRER)
        db.add_days(REFERRER, 30, "m1")
        check(
            db.days_left(REFERRER) >= left_before + 29,
            "дни прибавляются к текущему сроку, а не затирают его",
        )

        print("\n7. Напоминания и возврат ключа")
        db.add_days(LONER, 2, "m1")
        soon = [row["tg_id"] for row in db.expiring_soon(3)]
        check(LONER in soon, "подписка на исходе попала в список напоминаний")
        check(REFERRER not in soon, "долгая подписка в напоминания не попала")
        check(pool.release(INVITED) == 1, "ключ возвращён в пул")
        check(pool.free_count() == 3, "пул снова полный")

        print("\n8. Тексты собираются без ошибок")
        rendered = [
            texts.welcome("Тест", invited_by_friend=True),
            texts.plans_screen(),
            texts.payment_success(plan, paid_until),
            texts.key_message(key or ""),
            texts.referral_screen("https://t.me/lovemevpn_bot?start=ref_1000", stats),
            texts.subscription_status(active=True, expires=paid_until, days=180),
            texts.admin_stats(db.stats()),
            texts.HELP,
        ]
        check(all(isinstance(t, str) and t for t in rendered), "все экраны отрендерились")

        final = db.stats()
        print(f"\nИтог по базе: {final}")
        print(f"Проверок пройдено: {checks}")
        print("\nSMOKE OK\n")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except AssertionError as exc:
        print(f"\nSMOKE FAILED: {exc}\n")
        sys.exit(1)
