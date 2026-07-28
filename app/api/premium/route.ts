import { NextResponse } from 'next/server';
import { validatePremiumCode } from '@/lib/premium';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Validates a premium access code: server-only env allow-list first, then the
// issued-code store. A successful check is recorded on the code (who, when) so
// the admin panel shows which buyers are actually active.
export async function POST(request: Request) {
  let code = '';
  let email = '';
  try {
    const body = await request.json();
    code = typeof body?.code === 'string' ? body.code : '';
    email = typeof body?.email === 'string' ? body.email : '';
  } catch {
    /* fall through to invalid */
  }
  return NextResponse.json({ ok: await validatePremiumCode(code, { email, redeem: true }) });
}
