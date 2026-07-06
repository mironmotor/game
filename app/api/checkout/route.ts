import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 30;

// Создаёт Stripe Checkout Session для подписки Pro.
// Работает на чистом fetch к Stripe REST API — без зависимости `stripe`.
// Пока ключей нет — отдаёт мягкое сообщение (кнопка на /pricing его покажет),
// приложение не падает.
//
// Нужные env на Vercel (задать в проекте, когда появится Stripe-аккаунт):
//   STRIPE_SECRET_KEY   = sk_live_... (или sk_test_... для теста)
//   STRIPE_PRICE_ID     = price_...   (цена подписки Pro в Stripe)
//   APP_URL             = https://<домен> (для success/cancel возвратов)

interface Body {
  uid?: string;
  email?: string;
  plan?: string;
}

function formEncode(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

export async function POST(req: Request) {
  const secret = process.env.STRIPE_SECRET_KEY || '';
  const priceId = process.env.STRIPE_PRICE_ID || '';
  const appUrl =
    process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || '';

  if (!secret || !priceId) {
    return NextResponse.json({
      ok: false,
      message:
        'Оплата ещё не подключена: не заданы STRIPE_SECRET_KEY / STRIPE_PRICE_ID. ' +
        'Как только добавим их в Vercel — эта кнопка откроет Stripe Checkout.',
    });
  }

  let body: Body = {};
  try {
    body = (await req.json()) as Body;
  } catch {
    /* пустое тело — ок */
  }

  const base = appUrl.replace(/\/$/, '') || 'https://example.com';
  const params: Record<string, string> = {
    mode: 'subscription',
    'line_items[0][price]': priceId,
    'line_items[0][quantity]': '1',
    success_url: `${base}/pricing?status=success`,
    cancel_url: `${base}/pricing?status=cancel`,
    // client_reference_id + metadata позволят вебхуку понять, кому включить Pro.
    ...(body.uid ? { client_reference_id: body.uid, 'metadata[uid]': body.uid } : {}),
    ...(body.email ? { customer_email: body.email } : {}),
    allow_promotion_codes: 'true',
  };

  try {
    const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secret}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formEncode(params),
    });
    const data = await res.json();
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, message: data?.error?.message || 'Stripe error' },
        { status: 400 },
      );
    }
    return NextResponse.json({ ok: true, url: data.url });
  } catch (e) {
    return NextResponse.json(
      { ok: false, message: (e as Error).message || 'checkout failed' },
      { status: 500 },
    );
  }
}
