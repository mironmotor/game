import { NextResponse } from 'next/server';
import { isPremiumCode } from '@/lib/premium';

export const runtime = 'nodejs';

// Validates a premium access code against the server-only allow-list.
export async function POST(request: Request) {
  let code = '';
  try {
    const body = await request.json();
    code = typeof body?.code === 'string' ? body.code : '';
  } catch {
    /* fall through to invalid */
  }
  return NextResponse.json({ ok: isPremiumCode(code) });
}
