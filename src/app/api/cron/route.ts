import { scheduler } from '@/lib/service';
import { fail } from '@/lib/http';
import { assert } from '@/lib/domain';
import { NextResponse } from 'next/server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(req: Request) {
  try {
    assert(
      process.env.CRON_SECRET &&
        req.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`,
      'Нет доступа',
      403,
    );
    return NextResponse.json(await scheduler());
  } catch (e) {
    return fail(e);
  }
}
