import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { authUsers } from '@/lib/db/schema';
import { sql } from 'drizzle-orm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const db = getDb();
    const result = await db.select({ count: sql<number>`count(*)` }).from(authUsers);
    const count = result[0]?.count ?? 0;
    return NextResponse.json({ count, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error('[user-count] error', error);
    return NextResponse.json({ count: 366, timestamp: new Date().toISOString(), fallback: true });
  }
}
