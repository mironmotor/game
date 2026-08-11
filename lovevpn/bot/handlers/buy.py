"""Love VPN — покупка подписки: тарифы, инвойс Stars, зачисление оплаты."""

from __future__ import annotations

import logging

from aiogram import Bot, F, Router
from aiogram.filters import Command
from aiogram.types import CallbackQuery, Message, PreCheckoutQuery

from bot import keyboards, payments, texts
from bot.config import PLANS, REFERRAL_BONUS_DAYS
from bot.handlers.common import menu_for, send_key
from bot.services import db

logger = logging.getLogger(__name__)
router = Router(name="buy")


@router.callback_query(F.data == keyboards.CB_BUY)
async def show_plans(query: CallbackQuery) -> None:
    if query.message is None:
        return
    await query.message.edit_text(texts.plans_screen(), reply_markup=keyboards.plans_menu())
    await query.answer()


@router.message(Command("buy"))
async def cmd_buy(message: Message) -> None:
    await message.answer(texts.plans_screen(), reply_markup=keyboards.plans_menu())


@router.callback_query(F.data.startswith(f"{keyboards.CB_PLAN}:"))
async def pick_plan(query: CallbackQuery, bot: Bot) -> None:
    if query.data is None or query.from_user is None:
        return
    plan = PLANS.get(query.data.split(":", 1)[1])
    if plan is None:
        await query.answer("Тариф не найден", show_alert=True)
        return
    await query.answer()
    await payments.send_stars_invoice(bot, query.from_user.id, plan)


@router.pre_checkout_query()
async def confirm_checkout(query: PreCheckoutQuery) -> None:
    """Telegram ждёт ответ в течение 10 секунд, иначе платёж отменяется."""
    if payments.parse_payload(query.invoice_payload) is None:
        await query.answer(ok=False, error_message="Тариф не найден, начните заново.")
        return
    await query.answer(ok=True)


@router.message(F.successful_payment)
async def on_paid(message: Message, bot: Bot) -> None:
    payment = message.successful_payment
    user = message.from_user
    if payment is None or user is None:
        return

    plan = payments.parse_payload(payment.invoice_payload)
    if plan is None:
        logger.warning("Оплата с неизвестным payload: %s", payment.invoice_payload)
        await message.answer(
            "Оплата получена, но тариф не распознан. Напишите в поддержку — разберёмся."
        )
        return

    db.create_user(user.id, user.username)
    db.record_payment(
        user.id,
        plan.code,
        payment.total_amount,
        payment.currency,
        payments.PROVIDER,
        payment.telegram_payment_charge_id,
    )
    expires = db.add_days(user.id, plan.days, plan.code)
    first_payment = db.payments_count(user.id) == 1

    await message.answer(texts.payment_success(plan, expires))
    await send_key(bot, user.id)

    # Реферальный бонус — только за первую оплату приглашённого.
    if first_payment:
        referrer_id = db.reward_referral(user.id, REFERRAL_BONUS_DAYS)
        if referrer_id:
            await message.answer(texts.referral_bonus_for_invited(REFERRAL_BONUS_DAYS))
            try:
                await bot.send_message(
                    referrer_id, texts.referral_rewarded(REFERRAL_BONUS_DAYS)
                )
            except Exception as exc:  # пригласивший мог заблокировать бота
                logger.info("Не удалось уведомить пригласившего %s: %s", referrer_id, exc)

    await message.answer("Главное меню:", reply_markup=menu_for(user.id))
