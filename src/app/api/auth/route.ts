import { NextResponse } from 'next/server';
import { login, logout, currentUser, checkOrigin } from '@/lib/security';
import { fail, privateHeaders } from '@/lib/http';
import { z } from 'zod';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    return NextResponse.json({ user: await currentUser() }, { headers: privateHeaders });
  } catch (e) {
    return fail(e);
  }
}
export async function POST(req: Request) {
  try {
    checkOrigin(req);
    const data = z
      .object({ email: z.email(), password: z.string().min(1).max(200) })
      .parse(await req.json());
    return NextResponse.json(
      { user: await login(data.email, data.password) },
      { headers: privateHeaders },
    );
  } catch (e) {
    return fail(e);
  }
}
export async function DELETE(req: Request) {
  try {
    checkOrigin(req);
    await logout();
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
