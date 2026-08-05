'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { PLANS, DEFAULT_TIER, GODMODE } from '@/lib/subscription';
import './auth.css';
import './pricing.css';

export default function Pricing() {
  const { user, record } = useAuth();
  const currentTier = record?.tier ?? DEFAULT_TIER;
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function startCheckout() {
    setBusy(true);
    setMsg(null);
    try {
      const base = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
      const res = await fetch(`${base}/api/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid: user?.uid, email: user?.email, plan: 'pro' }),
      });
      const data = await res.json();
      if (data?.url) {
        window.location.href = data.url; // Stripe Checkout
        return;
      }
      setMsg(
        data?.message ||
          'Оплата ещё не подключена. Как только добавим Stripe-ключи — кнопка заработает.',
      );
    } catch {
      setMsg('Не удалось начать оплату. Попробуй позже.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pricing-wrap">
      <header className="pricing-head">
        <Link href="/" className="pricing-back">← GAME</Link>
        <h1 className="pricing-title">Тарифы</h1>
        <p className="pricing-sub">Открой полную мощь ядра Max.</p>
      </header>

      {/* Пока GODMODE включён, страница не имеет права продавать то, что уже
          отдано бесплатно — иначе она врёт пользователю. */}
      {GODMODE && (
        <div className="pricing-godmode">
          <b>GODMODE</b> — все режимы открыты всем. Автоплан, синапс-граф,
          эволюция и MAX VISION работают без подписки и без входа. Платить не нужно.
        </div>
      )}

      <div className="pricing-grid">
        {(['free', 'pro'] as const).map((id) => {
          const plan = PLANS[id];
          const isCurrent = currentTier === id;
          const isPro = id === 'pro';
          return (
            <div key={id} className={`pricing-card ${isPro ? 'pro' : ''}`}>
              {isPro && <div className="pricing-badge">Рекомендуем</div>}
              <div className="pricing-name">{plan.name}</div>
              <div className="pricing-price">{plan.priceLabel}</div>
              <p className="pricing-blurb">{plan.blurb}</p>
              <ul className="pricing-perks">
                {plan.perks.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
              {GODMODE ? (
                <div className="pricing-current">Открыто в GODMODE</div>
              ) : isCurrent ? (
                <div className="pricing-current">Твой текущий план</div>
              ) : isPro ? (
                <button className="pricing-cta" onClick={startCheckout} disabled={busy}>
                  {busy ? '…' : `Открыть Pro — ${plan.priceLabel}`}
                </button>
              ) : (
                <div className="pricing-current dim">Базовый</div>
              )}
            </div>
          );
        })}
      </div>

      {msg && <div className="pricing-msg">{msg}</div>}

      {!user && !GODMODE && (
        <p className="pricing-note">
          <Link href="/">Войди</Link>, чтобы оформить подписку.
        </p>
      )}
    </div>
  );
}
