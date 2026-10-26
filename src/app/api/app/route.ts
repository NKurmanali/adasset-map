import { NextResponse } from 'next/server';
import { currentUser, checkOrigin } from '@/lib/security';
import { getState, command, scheduler } from '@/lib/service';
import { fail, privateHeaders } from '@/lib/http';
import { requireRole } from '@/lib/domain';
import { z } from 'zod';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    return NextResponse.json(await getState(await currentUser()), { headers: privateHeaders });
  } catch (e) {
    return fail(e);
  }
}
export async function POST(req: Request) {
  try {
    checkOrigin(req);
    const user = await currentUser();
    const { action, payload, key } = z
      .object({
        action: z.string().max(80),
        payload: z.record(z.string(), z.any()),
        key: z.string().min(8).max(100),
      })
      .parse(await req.json());
    if (action === 'scheduler.run') {
      requireRole(user, []);
      return NextResponse.json(await scheduler());
    }
    return NextResponse.json(await command(user, action, payload, key), {
      headers: privateHeaders,
    });
  } catch (e) {
    return fail(e);
  }
}
