import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { issueKey, listKeys, revokeKey } from '@/lib/api-keys';
import { earn, getAccount } from '@/lib/mircoin-store';
import { priceList } from '@/lib/pricing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Выпуск ключей MAX API — только для владельца.
 *
 * Продажа сейчас ручная: деньги берутся как удобно, а здесь выписывается ключ
 * и сразу кладётся на баланс оплаченное количество MIRCOIN. Это не костыль, а
 * осознанный старт — платёжный шлюз требует юрлица, верификации и ответов про
 * возвраты, и всё это имеет смысл заводить, когда клиенты уже есть.
 *
 * Защита та же, что у остальной админки: ADMIN_TOKEN или Google-аккаунт
 * владельца — второй способ проверки не заводим, чтобы не было двух дверей с
 * разными замками.
 */

function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS || 'mironbocharov48@gmail.com')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

async function checkAdmin(request: Request): Promise<boolean> {
  const token = (request.headers.get('x-admin-token') || '').trim();
  const wanted = (process.env.ADMIN_TOKEN || '').trim();
  if (wanted && token && token === wanted) return true;
  try {
    const session = await auth();
    const email = session?.user?.email?.toLowerCase() || '';
    return Boolean(email && adminEmails().includes(email));
  } catch {
    return false;
  }
}

export async function GET(request: Request) {
  if (!(await checkAdmin(request))) {
    return NextResponse.json({ error: 'not_admin' }, { status: 403 });
  }
  const url = new URL(request.url);
  const keys = await listKeys(url.searchParams.get('email') || undefined);
  // К каждому ключу — текущий баланс его владельца: без этого список ключей
  // не отвечает на главный вопрос «у кого ещё остались деньги».
  const withBalance = await Promise.all(
    keys.map(async (k) => ({ ...k, balance: (await getAccount(k.email))?.balance ?? 0 })),
  );
  return NextResponse.json({ ok: true, keys: withBalance, pricing: priceList() });
}

export async function POST(request: Request) {
  if (!(await checkAdmin(request))) {
    return NextResponse.json({ error: 'not_admin' }, { status: 403 });
  }
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'bad_json' }, { status: 400 });
  }

  const action = String(body.action || 'issue');

  if (action === 'revoke') {
    const id = String(body.id || '');
    const ok = await revokeKey(id);
    return NextResponse.json({ ok, id });
  }

  if (action === 'topup') {
    const email = String(body.email || '').trim().toLowerCase();
    const amount = Math.max(0, Math.round(Number(body.amount) || 0));
    if (!email || !amount) return NextResponse.json({ error: 'нужны email и amount' }, { status: 400 });
    const acc = await earn(email, amount, String(body.reason || 'оплата MAX API'));
    return NextResponse.json({ ok: true, email, balance: acc.balance });
  }

  const email = String(body.email || '').trim().toLowerCase();
  if (!email) return NextResponse.json({ error: 'нужен email покупателя' }, { status: 400 });

  const { key, entry } = await issueKey({
    email,
    name: String(body.name || ''),
    note: String(body.note || ''),
  });

  // Оплаченные MIRCOIN зачисляем сразу: ключ без баланса не работает, и
  // выдавать его отдельно от денег означало бы гарантированный вопрос
  // «почему не пускает» первым же сообщением.
  const amount = Math.max(0, Math.round(Number(body.mircoin) || 0));
  let balance = (await getAccount(email))?.balance ?? 0;
  if (amount > 0) {
    balance = (await earn(email, amount, 'оплата MAX API')).balance;
  }

  return NextResponse.json({
    ok: true,
    key, // показывается ОДИН раз — дальше в хранилище только его хэш
    entry,
    balance,
    hint: 'Передай ключ покупателю. Повторно его не увидеть — только выпустить новый.',
  });
}
