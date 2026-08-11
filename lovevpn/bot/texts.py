"""Love VPN — все тексты бота в одном месте.

Правки формулировок делаются здесь, а не в обработчиках. Разметка — HTML
(parse_mode=HTML), поэтому пользовательские данные вставляем через html_escape.
"""

from __future__ import annotations

from datetime import datetime
from html import escape as html_escape

from bot.config import BRAND, PLANS, POPULAR_PLAN, REFERRAL_BONUS_DAYS, TRIAL_DAYS, Plan

HEART = "❤️"

# ------------------------------------------------------------------ кнопки

BTN_BUY = f"{HEART} Купить доступ"
BTN_MY_KEY = "\U0001f511 Мой ключ"
BTN_TRIAL = "\U0001f381 Пробный период"
BTN_REFERRAL = "\U0001f465 Пригласить друга"
BTN_HELP = "❓ Как подключиться"
BTN_BACK = "⬅️ Назад"


def money(plan: Plan) -> str:
    return f"{plan.price_rub} ₽"


def plan_button(plan: Plan) -> str:
    mark = " ⭐" if plan.code == POPULAR_PLAN else ""
    return f"{plan.title} — {money(plan)}{mark}"


def fmt_date(moment: datetime) -> str:
    return moment.strftime("%d.%m.%Y")


# ------------------------------------------------------------------ экраны


def welcome(name: str, *, invited_by_friend: bool) -> str:
    greeting = f"Привет, {html_escape(name)}!"
    lines = [
        f"{HEART} <b>{BRAND}</b> — быстрый VPN без логов и ограничений скорости.",
        "",
        greeting,
        "",
        "• Подключение занимает меньше минуты",
        "• Работает на телефоне, ноутбуке и ТВ",
        "• Мы не храним историю и трафик",
    ]
    if invited_by_friend:
        lines += [
            "",
            f"{HEART} Вас пригласил друг: после первой оплаты вы оба получите "
            f"<b>+{REFERRAL_BONUS_DAYS} дней</b> в подарок.",
        ]
    if TRIAL_DAYS > 0:
        lines += ["", f"\U0001f381 Есть бесплатный пробный период — {TRIAL_DAYS} дня."]
    return "\n".join(lines)


def plans_screen() -> str:
    lines = [f"{HEART} <b>Тарифы {BRAND}</b>", ""]
    for plan in PLANS.values():
        per_month = round(plan.price_rub / (plan.days / 30))
        mark = " ⭐ <i>хит</i>" if plan.code == POPULAR_PLAN else ""
        lines.append(f"<b>{plan.title}</b> — {money(plan)}{mark}")
        lines.append(
            f"   ≈ {per_month} ₽ в месяц · до {plan.devices} устройств"
        )
    lines += [
        "",
        "Во всех тарифах: полная скорость, все серверы, ноль логов.",
        "Оплата проходит внутри Telegram ⭐",
    ]
    return "\n".join(lines)


def invoice_description(plan: Plan) -> str:
    return (
        f"Доступ к {BRAND} на {plan.days} дней. "
        f"Полная скорость, все серверы, до {plan.devices} устройств."
    )


def payment_success(plan: Plan, expires: datetime) -> str:
    return "\n".join(
        [
            f"{HEART} <b>Оплата получена, спасибо!</b>",
            "",
            f"Тариф: <b>{plan.title}</b>",
            f"Доступ активен до: <b>{fmt_date(expires)}</b>",
            "",
            "Ключ для подключения — ниже \U0001f447",
        ]
    )


def referral_rewarded(days: int) -> str:
    return (
        f"{HEART} Ваш друг оплатил подписку — вам начислено "
        f"<b>+{days} дней</b>. Спасибо, что делитесь {BRAND}!"
    )


def referral_bonus_for_invited(days: int) -> str:
    return f"{HEART} Бонус за приглашение: <b>+{days} дней</b> уже на вашем счету."


def subscription_status(*, active: bool, expires: datetime | None, days: int) -> str:
    if not active or expires is None:
        return "\n".join(
            [
                "⚠️ <b>Подписка не активна</b>",
                "",
                "Оформите доступ — и ключ придёт сразу после оплаты.",
            ]
        )
    return "\n".join(
        [
            f"✅ <b>Подписка активна</b>",
            "",
            f"Действует до: <b>{fmt_date(expires)}</b> (осталось {days} дн.)",
        ]
    )


def key_message(config: str) -> str:
    return "\n".join(
        [
            "\U0001f511 <b>Ваш ключ для подключения</b>",
            "",
            f"<code>{html_escape(config)}</code>",
            "",
            "Скопируйте его целиком и вставьте в приложение "
            "(инструкция — кнопка «Как подключиться»).",
        ]
    )


NO_KEYS_LEFT = (
    "⚠️ Свободные ключи закончились. Мы уже добавляем новые — "
    "напишите в поддержку, выдадим вручную в течение нескольких минут."
)

NEED_SUBSCRIPTION = (
    "⚠️ Ключ выдаётся при активной подписке.\n\n"
    "Оформите доступ или активируйте пробный период."
)


def trial_started(days: int, expires: datetime) -> str:
    return "\n".join(
        [
            f"\U0001f381 <b>Пробный период активирован: {days} дня</b>",
            "",
            f"Доступ активен до <b>{fmt_date(expires)}</b>.",
            "Ключ — ниже \U0001f447",
        ]
    )


TRIAL_ALREADY_USED = (
    "Пробный период уже использован на этом аккаунте. "
    "Оформите любой тариф — доступ включится сразу после оплаты."
)


def referral_screen(link: str, stats: dict[str, int]) -> str:
    return "\n".join(
        [
            f"{HEART} <b>Приведи друга — {REFERRAL_BONUS_DAYS} дней бесплатно. Обоим.</b>",
            "",
            "Отправьте другу свою ссылку. Как только он оплатит любой тариф, "
            f"<b>+{REFERRAL_BONUS_DAYS} дней</b> получите вы и <b>+{REFERRAL_BONUS_DAYS} дней</b> — он.",
            "Друзей можно приглашать сколько угодно.",
            "",
            "Ваша ссылка:",
            f"<code>{html_escape(link)}</code>",
            "",
            f"Приглашено: <b>{stats['invited']}</b> · "
            f"оплатили: <b>{stats['rewarded']}</b> · "
            f"получено дней: <b>{stats['bonus_days']}</b>",
        ]
    )


HELP = "\n".join(
    [
        "❓ <b>Как подключиться</b>",
        "",
        "<b>1.</b> Установите приложение:",
        "• iPhone / iPad — <b>Streisand</b> или <b>V2Box</b> (App Store)",
        "• Android — <b>v2rayNG</b> или <b>Hiddify</b> (Google Play)",
        "• Windows / Mac — <b>Hiddify</b> или <b>Nekoray</b>",
        "",
        "<b>2.</b> Скопируйте ключ из бота (кнопка «Мой ключ»).",
        "",
        "<b>3.</b> В приложении выберите «Добавить из буфера обмена» "
        "(Import from clipboard) — конфиг подхватится сам.",
        "",
        "<b>4.</b> Нажмите «Подключить». Готово ✅",
        "",
        "Если что-то не вышло — напишите в поддержку, поможем.",
    ]
)


def support_line(contact: str) -> str:
    return f"\n\nПоддержка: {html_escape(contact)}" if contact else ""


def expiry_reminder(days: int) -> str:
    return "\n".join(
        [
            f"⏰ Подписка {BRAND} заканчивается через <b>{days} дн.</b>",
            "",
            "Продлите доступ, чтобы не отключаться — ключ останется тем же.",
        ]
    )


# ------------------------------------------------------------------- админка


def admin_stats(data: dict[str, int]) -> str:
    return "\n".join(
        [
            "\U0001f4ca <b>Статистика</b>",
            "",
            f"Пользователей: <b>{data['users']}</b>",
            f"Активных подписок: <b>{data['active']}</b>",
            f"Оплат: <b>{data['payments']}</b>",
            f"Рефералов начислено: <b>{data['referrals']}</b>",
            "",
            f"Ключей свободно: <b>{data['keys_free']}</b>",
            f"Ключей выдано: <b>{data['keys_assigned']}</b>",
        ]
    )


def admin_import_result(result: dict[str, int], free: int) -> str:
    return "\n".join(
        [
            "\U0001f4e6 <b>Импорт конфигов</b>",
            "",
            f"Добавлено: <b>{result['added']}</b>",
            f"Уже было: {result['duplicates']}",
            f"Пропущено (не похоже на конфиг): {result['skipped']}",
            "",
            f"Свободных ключей в пуле: <b>{free}</b>",
        ]
    )


ADMIN_HELP = "\n".join(
    [
        "\U0001f6e0 <b>Команды администратора</b>",
        "",
        "/stats — статистика",
        "/grant &lt;tg_id&gt; &lt;дней&gt; — начислить дни вручную",
        "/revoke &lt;tg_id&gt; — вернуть ключ пользователя в пул",
        "/addkeys — пришлите .txt файлом со конфигами (по одному в строке)",
        "/remind — разослать напоминания тем, у кого подписка на исходе",
    ]
)

ADMIN_ONLY = "Команда доступна только администратору."
