import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { database, dataDir } from '@/lib/db';
import { currentUser, supabaseAdmin } from '@/lib/security';
import { assert } from '@/lib/domain';
import { fail } from '@/lib/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const globals = globalThis as typeof globalThis & { adassetSigningKey?: Buffer };
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await currentUser();
    const { id } = await ctx.params;
    const file = (
      await (
        await database()
      ).query('SELECT * FROM attachments WHERE id=$1 AND tenant_id=$2', [id, user.tenant_id])
    ).rows[0];
    assert(file, 'Файл недоступен', 404);
    if (process.env.STORAGE_PROVIDER === 'supabase') {
      const { data, error } = await supabaseAdmin()
        .storage.from(process.env.SUPABASE_STORAGE_BUCKET || 'adasset-private')
        .createSignedUrl(`${user.tenant_id}/${file.storage_key}`, 60);
      assert(data && !error, 'Не удалось открыть файл', 502);
      return NextResponse.redirect(data.signedUrl);
    }
    globals.adassetSigningKey ??= randomBytes(32);
    const url = new URL(req.url);
    let expires = url.searchParams.get('expires'),
      sig = url.searchParams.get('signature');
    const sign = (exp: string) =>
      createHmac('sha256', globals.adassetSigningKey!)
        .update(`${id}:${user.id}:${exp}`)
        .digest('hex');
    if (!expires || !sig) {
      expires = String(Date.now() + 60000);
      url.searchParams.set('expires', expires);
      url.searchParams.set('signature', sign(expires));
      return new Response(null, {
        status: 307,
        headers: { Location: url.pathname + url.search, 'Cache-Control': 'private, no-store' },
      });
    }
    assert(
      Number(expires) > Date.now() &&
        Number(expires) < Date.now() + 61000 &&
        sig.length === 64 &&
        timingSafeEqual(Buffer.from(sig), Buffer.from(sign(expires))),
      'Ссылка истекла. Откройте файл снова.',
      403,
    );
    const bytes = await fs.readFile(path.join(dataDir(), 'files', file.storage_key));
    return new Response(bytes, {
      headers: {
        'Content-Type': file.mime,
        'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`,
        'Cache-Control': 'private, no-store',
        'Content-Security-Policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'",
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (e) {
    return fail(e);
  }
}
