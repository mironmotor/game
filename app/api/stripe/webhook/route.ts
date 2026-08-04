import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 30;
export const dynamic = 'force-dynamic';

// Stripe Webhook для проекта game.
// Работает на чистом fetch + Web Crypto — без зависимости `stripe`.
//
// Env на Vercel (должны быть заданы, иначе хэндлер отдаст 400):
//   STRIPE_WEBHOOK_SECRET  = whsec_...  (из Stripe Dashboard → Webhooks → Reveal)
//   STRIPE_SECRET_KEY      = sk_live_... (для проверки/отката подписки при необходимости)
//
// Ожидаемые события (включить в Stripe Dashboard → Webhooks → Events to send):
//   - checkout.session.completed   (разовая оплата / первая подписка)
//   - customer.subscription.created
//   - customer.subscription.updated
//   - customer.subscription.deleted
//
// URL для Stripe Dashboard:
//   https://<ваш-домен>.vercel.app/api/stripe/webhook

interface StripeSubscription {
  id: string;
  status: string;
  customer: string;
  current_period_end?: number;
  metadata?: Record<string, string>;
}

interface StripeSession {
  id: string;
  client_reference_id?: string;
  customer?: string;
  subscription?: string;
  mode?: string;
  payment_status?: string;
  metadata?: Record<string, string>;
}

type StripeEvent =
  | { type: 'checkout.session.completed'; data: { object: StripeSession } }
  | { type: 'customer.subscription.created'; data: { object: StripeSubscription } }
  | { type: 'customer.subscription.updated'; data: { object: StripeSubscription } }
  | { type: 'customer.subscription.deleted'; data: { object: StripeSubscription } }
  | { type: string; data: { object: Record<string, unknown> } };

// ── Stripe signature verification (по офиц. спеке) ──────────────────────────
// https://stripe.com/docs/webhooks#verify-official-libraries
// Заголовок:          t=<timestamp>,v1=<sig>
// Подписанная строка: <timestamp>.<payload>
// HMAC-SHA256 ключ:   STRIPE_WEBHOOK_SECRET
async function verifyStripeSignature(
  payload: string,
  header: string,
  secret: string,
): Promise<{ ok: true; event: StripeEvent } | { ok: false; reason: string }> {
  if (!header) return { ok: false, reason: 'missing signature header' };
  if (!secret) return { ok: false, reason: 'webhook secret not configured' };

  const parts = header.split(',').reduce<Record<string, string>>((acc, p) => {
    const [k, v] = p.split('=');
    if (k && v) acc[k.trim()] = v.trim();
    return acc;
  }, {});
  const t = parts['t'];
  const v1 = parts['v1'];
  if (!t || !v1) return { ok: false, reason: 'malformed signature header' };

  // Защита от replay-атак: отклоняем события старше 5 минут.
  const ageSec = Math.abs(Date.now() / 1000 - Number(t));
  if (!Number.isFinite(ageSec) || ageSec > 300) {
    return { ok: false, reason: 'timestamp out of tolerance' };
  }

  const signedPayload = `${t}.${payload}`;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(signedPayload));
  const expected = Array.from(new Uint8Array(sigBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  // Constant-time compare.
  if (expected.length !== v1.length) return { ok: false, reason: 'bad signature' };
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ v1.charCodeAt(i);
  }
  if (diff !== 0) return { ok: false, reason: 'bad signature' };

  try {
    const event = JSON.parse(payload) as StripeEvent;
    return { ok: true, event };
  } catch {
    return { ok: false, reason: 'invalid JSON payload' };
  }
}

export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET || '';
  const sigHeader = req.headers.get('stripe-signature') || '';

  // Stripe требует «сырое» тело для проверки подписи.
  const payload = await req.text();

  const result = await verifyStripeSignature(payload, sigHeader, secret);
  if (result.ok === false) {
    console.warn('[stripe-webhook] signature rejected:', result.reason);
    return NextResponse.json(
      { ok: false, reason: result.reason },
      { status: 400 },
    );
  }
  const event = result.event;
  const stamp = new Date().toISOString();

  // Сужаем типы по event.type до обработки — так TS видит, что в каждой ветке
  // у объекта есть нужные поля, и не ругается на "Property 'uid' does not exist on unknown".
  if (event.type === 'checkout.session.completed') {
    const s = event.data.object as StripeSession;
    const metaUid = s.metadata?.uid;
    const uid = s.client_reference_id || metaUid;
    console.log(
      JSON.stringify({
        at: stamp,
        kind: 'checkout.session.completed',
        sessionId: s.id,
        uid,
        customer: s.customer,
        subscriptionId: s.subscription,
        mode: s.mode,
        paymentStatus: s.payment_status,
      }),
    );
    // TODO: если s.subscription — пометить пользователя как Pro в Firestore
    //       (uid = s.client_reference_id или s.metadata.uid).
  } else if (
    event.type === 'customer.subscription.created' ||
    event.type === 'customer.subscription.updated' ||
    event.type === 'customer.subscription.deleted'
  ) {
    const sub = event.data.object as StripeSubscription;
    const uid = sub.metadata?.uid;
    console.log(
      JSON.stringify({
        at: stamp,
        kind: event.type,
        subscriptionId: sub.id,
        status: sub.status,
        customer: sub.customer,
        currentPeriodEnd: sub.current_period_end,
        uid,
      }),
    );
    // TODO: синхронизировать Pro-статус с sub.status в Firestore
    //       (active/trialing → Pro, canceled/unpaid → off).
  } else {
    console.log(
      JSON.stringify({ at: stamp, kind: 'ignored', type: event.type }),
    );
  }

  return NextResponse.json({ ok: true, received: event.type });
}

// Stripe иногда шлёт GET/HEAD для проверки доступности — отвечаем 200.
export async function GET() {
  return NextResponse.json({ ok: true, route: 'stripe-webhook' });
}
