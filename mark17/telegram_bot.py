#!/usr/bin/env python3
"""Telegram-бот GAME (@agi_game_bot) — знакомство и онбординг.

Задача: человек нажал /start и за минуту понял — что такое GAME, кто её делает
и КУДА ЖАТЬ, чтобы начать. Без зависимостей (stdlib + long polling), поэтому
спокойно живёт рядом с ядром под pm2.

Команды: /start /help /max <вопрос> /mir
"""
from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request

TOKEN = (os.environ.get("TELEGRAM_BOT_TOKEN") or "").strip().strip('"').strip("'")
API = f"https://api.telegram.org/bot{TOKEN}"
SITE = os.environ.get("GAME_PUBLIC_URL", "https://mir.care").rstrip("/")
# Ядро для команды /max — локальное приложение на этом же сервере.
CORE = os.environ.get("GAME_CORE_URL", "http://127.0.0.1:3000") + "/api/max17"

WELCOME = f"""<b>Привет! Это GAME — и MAX внутри неё.</b>

Коротко: <b>GAME</b> — это рабочее пространство, где рядом с тобой живёт <b>MAX</b> —
ИИ-спутник с памятью. Он помнит твои задачи и разговоры, отвечает голосом,
разбирает цели на шаги и часть из них делает сам.

<b>Чем он отличается от обычного чат-бота:</b>
• <b>Помнит тебя</b> — не начинает с чистого листа каждый раз
• <b>Учится на результате</b> — запоминает, что сработало, а что нет
• <b>Доводит до дела</b> — раскладывает цель на шаги и выполняет, что может сам
• <b>Границы честные</b> — отправить письмо, позвонить, заплатить он не станет
  без тебя: подготовит всё до кнопки, а жмёшь ты

<b>КУДА ЖАТЬ — по шагам:</b>
1️⃣ Открой <a href="{SITE}">{SITE.replace('https://','')}</a>
2️⃣ Нажми <b>«Войти»</b> справа сверху (через Google) — чтобы прогресс сохранялся
3️⃣ Внизу есть поле <b>«Что мне сделать сегодня?»</b> — просто напиши MAX своими словами
4️⃣ В нижней панели кнопки режимов:
   • <b>Совет</b> — разбор задачи по шагам
   • <b>Разгон</b> — план на день из твоих задач
   • <b>Cyber Lab</b> — обучение кибербезопасности (легально, с тьютором)
   • <b>Ядро 3D</b> — живая карта памяти MAX
   • <b>Доктор</b> — здоровье системы
5️⃣ Значок 🔊 включает <b>голос</b> — MAX начнёт говорить

<b>Кто это делает:</b> Мирон Бочаров (@mironmotor) — автор GAME и ядра MAX.
Проект вырос из идеи, что ИИ должен быть <i>своим</i>: помнить твою жизнь и быть
рядом, а не отвечать шаблонами.

Вопросы и связь — @mironmotor"""

HELP = f"""<b>Команды</b>
/start — знакомство и куда жать
/preza — полная презентация GAME
/max &lt;вопрос&gt; — спросить MAX прямо здесь
/mir — открыть GAME

Полностью MAX живёт на сайте: {SITE}
Там память, голос, агенты и режимы. В боте — только короткие ответы."""

# ── Презентация: приходит через PREZA_DELAY после /start (и по /preza) ────────
PREZA_DELAY = int(os.environ.get("GAME_PREZA_DELAY_SEC", "300"))  # 5 минут

PREZA_1 = f"""✦ ✦ ✦

<b>GAME — ЧТО ЭТО НА САМОМ ДЕЛЕ</b>

Обычный ИИ-чат забывает тебя, как только ты закрыл вкладку. Каждый раз — с нуля:
кто ты, чего хочешь, что уже пробовал.

<b>MAX устроен иначе.</b> У него есть память, которая растёт. Он помнит твои цели,
разговоры и — главное — <i>чем всё закончилось</i>. Сработало действие — он это
запомнил и усилил. Провалилось — тоже запомнил, и больше так не предложит.

Это не метафора. Внутри — граф связей: сотни тысяч узлов, где каждая связь
имеет вес и историю. Чем больше вы работаете вместе, тем точнее он понимает
именно тебя.

━━━━━━━━━━━━━━━━━━━━

<b>🧠 ЯДРО</b>
Собственное когнитивное ядро: память (эпизоды + смыслы), граф синапсов,
консолидация во сне, слой привязанности. Оно работает <b>локально</b> — твоя
жизнь не уезжает на чужие серверы.

<b>🗣 ГОЛОС</b>
MAX говорит. Живой нейро-голос, не робот. Включается значком 🔊 — и он начнёт
озвучивать ответы.

<b>👁 ЗРЕНИЕ</b>
Может смотреть через камеру и описывать, что видит.

━━━━━━━━━━━━━━━━━━━━

<b>ГЛАВНЫЙ ПРИНЦИП</b>

MAX <b>никогда не делает необратимое за твоей спиной.</b> Отправить письмо,
позвонить, заплатить, войти по паролю — только ты.

Он готовит всё <i>до кнопки</i>: находит, пишет, планирует, проверяет.
А кнопку жмёшь ты. Это не лишний шаг — это то, что не даёт агенту
натворить дел по ошибке.

<i>Дальше — все режимы и куда жать ↓</i>"""

PREZA_2 = f"""<b>РЕЖИМЫ — И ЧТО ОНИ ДЕЛАЮТ</b>

<b>💬 Чат с MAX</b>
Поле внизу экрана. Просто пиши своими словами — как живому. Он помнит контекст.

<b>✨ Совет</b>
Задача разбирается на конкретные шаги. Техническую — отдаёт настоящему
код-агенту, который пишет файлы в песочнице.

<b>⚡ Разгон</b>
План на день, собранный из твоих реальных задач, а не из шаблона.

<b>🚀 Автопилот · Прогон по шагам</b>
Даёшь цель — MAX раскладывает её на атомарные шаги и выполняет те, что может сам
(ресерч, черновики, планы, код). На шагах «нужен ты» — останавливается
и передаёт тебе готовое.

<b>🤖 Мультиагент</b>
Собирает бригаду под-агентов: каждый берёт свой кусок задачи, потом
синтезатор сводит всё в один результат.

<b>🛡 Cyber Lab</b>
Академия кибербезопасности — 7 модулей от основ сети до bug bounty.
С тьютором, который объясняет и <b>останавливает</b>, если вопрос уходит
за границу законного. Только свои системы и учебные лаборатории.

<b>⚛️ Ядро 3D · God Vision</b>
Живая карта памяти. Частицы текут по странному аттрактору — это буквально
хаос ядра. В режиме <b>God Vision</b> видно три слоя памяти сразу:
вся масса связей, структура и — золотом в центре — то, что MAX реально выучил.

<b>🌙 Сон 3D</b>
Что MAX видит во сне: концепты, которые связались за день.

<b>🩺 Доктор</b>
Здоровье системы + <b>само-улучшение</b>: MAX сам предлагает, что в себе
починить, а применяется только по твоему «Согласовать».

<b>🪙 MIRCOIN</b>
Внутренняя валюта за реальные действия. Не крипта — очки, честный журнал.

━━━━━━━━━━━━━━━━━━━━

<b>С ЧЕГО НАЧАТЬ — 3 ШАГА</b>

1️⃣ Открой <a href="{SITE}">{SITE.replace('https://','')}</a>
2️⃣ Нажми <b>«Войти»</b> (через Google) — чтобы прогресс и память сохранялись
3️⃣ Напиши MAX внизу: <i>«помоги выбрать главный шаг на сегодня»</i>

Дальше он поведёт сам.

━━━━━━━━━━━━━━━━━━━━

Сделал <b>Мирон Бочаров</b> — @mironmotor
Один человек, своё ядро, честные границы.

<i>Вопросы — пиши прямо сюда или ему в личку.</i>"""


# ── Отложенные отправки ──────────────────────────────────────────────────────
# Очередь лежит на диске: бот перезапускается при каждом деплое, и in-memory
# таймеры бы потерялись — человек так и не дождался бы презентации.
QUEUE_PATH = os.environ.get(
    "GAME_BOT_QUEUE", os.path.join(os.path.expanduser("~"), ".max17", "bot_queue.json")
)


def _queue_read() -> list[dict]:
    try:
        with open(QUEUE_PATH, encoding="utf-8") as fh:
            data = json.load(fh)
        return data if isinstance(data, list) else []
    except Exception:  # noqa: BLE001
        return []


def _queue_write(items: list[dict]) -> None:
    try:
        os.makedirs(os.path.dirname(QUEUE_PATH), exist_ok=True)
        with open(QUEUE_PATH, "w", encoding="utf-8") as fh:
            json.dump(items[-500:], fh)
    except Exception as exc:  # noqa: BLE001
        print(f"[game-bot] очередь не сохранилась: {exc}", flush=True)


def schedule(chat_id: int, kind: str, delay: int) -> None:
    """Поставить отправку в очередь. Повторно одному чату — не дублируем."""
    items = _queue_read()
    if any(i.get("chat_id") == chat_id and i.get("kind") == kind for i in items):
        return
    items.append({"chat_id": chat_id, "kind": kind, "due": time.time() + max(1, delay)})
    _queue_write(items)


def flush_due() -> None:
    """Отправить всё, чему подошло время. Вызывается из основного цикла."""
    items = _queue_read()
    if not items:
        return
    now = time.time()
    due = [i for i in items if float(i.get("due", 0)) <= now]
    if not due:
        return
    _queue_write([i for i in items if float(i.get("due", 0)) > now])
    for i in due:
        try:
            if i.get("kind") == "preza":
                send_preza(int(i["chat_id"]))
        except Exception as exc:  # noqa: BLE001
            print(f"[game-bot] отложенная отправка не прошла: {exc}", flush=True)


def api(method: str, payload: dict, timeout: int = 25) -> dict:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        f"{API}/{method}", data=data, headers={"Content-Type": "application/json"}
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8"))
    except Exception:  # noqa: BLE001 — сеть не должна ронять бота
        return {}


def send(chat_id: int, text: str, buttons: bool = False) -> None:
    payload = {
        "chat_id": chat_id,
        "text": text,
        "parse_mode": "HTML",
        "disable_web_page_preview": True,
    }
    if buttons:
        payload["reply_markup"] = {
            "inline_keyboard": [
                [{"text": "🚀 Открыть GAME", "url": SITE}],
                [{"text": "💬 Написать Мирону", "url": "https://t.me/mironmotor"}],
            ]
        }
    api("sendMessage", payload)


def send_preza(chat_id: int) -> None:
    """Презентация двумя частями — цельный текст не влезает в лимит Telegram."""
    send(chat_id, PREZA_1)
    time.sleep(1.2)  # чтобы части пришли по порядку и читались как разворот
    send(chat_id, PREZA_2, buttons=True)


def ask_max(question: str) -> str:
    """Короткий ответ MAX через ядро сайта. Мягко падает, если ядро занято."""
    body = json.dumps(
        {
            "type": "llm_raw",
            "system": "Ты MAX из GAME. Отвечай по-русски, тепло и коротко (2-4 фразы), без списков.",
            "text": question[:1000],
            "max_tokens": 300,
        }
    ).encode("utf-8")
    req = urllib.request.Request(CORE, data=body, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            d = json.loads(r.read().decode("utf-8"))
        return (d.get("llm_text") or (d.get("llm") or {}).get("text") or "").strip()
    except Exception:  # noqa: BLE001
        return ""


def handle(msg: dict) -> None:
    chat_id = (msg.get("chat") or {}).get("id")
    text = str(msg.get("text") or "").strip()
    if not chat_id or not text:
        return
    low = text.lower()

    if low.startswith("/start"):
        send(chat_id, WELCOME, buttons=True)
        # Через 5 минут — полная презентация: короткое знакомство сразу,
        # подробности когда человек уже потыкал сайт.
        schedule(chat_id, "preza", PREZA_DELAY)
    elif low.startswith("/preza") or low.startswith("/презентация"):
        send_preza(chat_id)
    elif low.startswith("/help"):
        send(chat_id, HELP)
    elif low.startswith("/mir"):
        send(chat_id, f"Заходи: {SITE}", buttons=True)
    elif low.startswith("/max"):
        q = text[4:].strip()
        if not q:
            send(chat_id, "Напиши вопрос после команды: <code>/max с чего начать день?</code>")
            return
        api("sendChatAction", {"chat_id": chat_id, "action": "typing"})
        answer = ask_max(q)
        send(chat_id, answer or "MAX сейчас занят — попробуй через минуту или заходи на сайт.")
    else:
        # Обычное сообщение — тоже к MAX, чтобы бот не молчал.
        api("sendChatAction", {"chat_id": chat_id, "action": "typing"})
        answer = ask_max(text)
        send(chat_id, answer or f"Я тебя услышал. Полностью MAX живёт тут: {SITE}")


def main() -> None:
    if not TOKEN:
        raise SystemExit("TELEGRAM_BOT_TOKEN не задан")
    print(f"[game-bot] запущен, сайт={SITE}", flush=True)
    api("deleteWebhook", {"drop_pending_updates": False})
    offset = 0
    while True:
        flush_due()  # отправить всё, чему подошёл срок (презентации)
        res = api("getUpdates", {"offset": offset, "timeout": 30}, timeout=40)
        for upd in res.get("result", []) or []:
            offset = max(offset, int(upd.get("update_id", 0)) + 1)
            msg = upd.get("message") or upd.get("edited_message")
            if msg:
                try:
                    handle(msg)
                except Exception as exc:  # noqa: BLE001
                    print(f"[game-bot] ошибка обработки: {exc}", flush=True)
        if not res:
            time.sleep(3)  # сеть моргнула — не долбим API


if __name__ == "__main__":
    main()
