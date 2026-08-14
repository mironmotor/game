import { NextResponse } from 'next/server';
import { CHAT_RATES, priceList } from '@/lib/pricing';

export const runtime = 'nodejs';

/**
 * Список моделей и цен — открыто, без ключа.
 *
 * Формат «data: [{id, object: model}]» повторяет OpenAI: клиентские библиотеки
 * дёргают этот эндпоинт при подключении и падают, если не находят знакомой
 * формы. Цены лежат рядом отдельным полем — их спрашивают до покупки, а не
 * после, и прятать их за ключом значит терять клиента на первом шаге.
 */
export async function GET() {
  return NextResponse.json({
    object: 'list',
    data: Object.keys(CHAT_RATES).map((id) => ({
      id,
      object: 'model',
      owned_by: 'max17',
      created: 0,
    })),
    pricing: priceList(),
    docs: 'https://mir.care/api',
  });
}
