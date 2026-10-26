import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { database, dataDir, insert } from '@/lib/db';
import { currentUser, checkOrigin, supabaseAdmin } from '@/lib/security';
import { assert, requireRole } from '@/lib/domain';
import { fail } from '@/lib/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(req: Request) {
  try {
    checkOrigin(req);
    const user = await currentUser();
    requireRole(user, ['manager', 'dispatcher', 'inspector', 'technician']);
    assert(
      Number(req.headers.get('content-length') || 0) <= 11 * 1024 * 1024,
      'Максимальный размер файла — 10 МБ',
      413,
    );
    const form = await req.formData();
    const file = form.get('file');
    const asset = String(form.get('asset_id') || '');
    assert(file instanceof File, 'Выберите файл');
    assert(
      file.size > 0 && file.size <= 10 * 1024 * 1024,
      'Максимальный размер файла — 10 МБ',
      413,
    );
    const db = await database();
    assert(
      (
        await db.query('SELECT id FROM assets WHERE id=$1 AND tenant_id=$2', [
          asset,
          user.tenant_id,
        ])
      ).rows[0],
      'Объект недоступен',
      404,
    );
    const bytes = Buffer.from(await file.arrayBuffer());
    let mime = '';
    let ext = '';
    if (bytes.subarray(0, 4).toString('hex') === '89504e47') {
      mime = 'image/png';
      ext = 'png';
    } else if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
      mime = 'image/jpeg';
      ext = 'jpg';
    } else if (
      bytes.subarray(0, 4).toString() === 'RIFF' &&
      bytes.subarray(8, 12).toString() === 'WEBP'
    ) {
      mime = 'image/webp';
      ext = 'webp';
    } else if (bytes.subarray(0, 5).toString() === '%PDF-') {
      mime = 'application/pdf';
      ext = 'pdf';
    } else if (file.type === 'text/plain' && !bytes.includes(0)) {
      mime = 'text/plain';
      ext = 'txt';
    }
    assert(mime, 'Разрешены JPEG, PNG, WebP, PDF и TXT');
    const id = randomUUID(),
      key = id + '.' + ext;
    if (process.env.STORAGE_PROVIDER === 'supabase') {
      const { error } = await supabaseAdmin()
        .storage.from(process.env.SUPABASE_STORAGE_BUCKET || 'adasset-private')
        .upload(`${user.tenant_id}/${key}`, bytes, { contentType: mime, upsert: false });
      assert(!error, 'Не удалось сохранить файл в Supabase', 502);
    } else {
      await fs.mkdir(path.join(dataDir(), 'files'), { recursive: true });
      await fs.writeFile(path.join(dataDir(), 'files', key), bytes, { flag: 'wx' });
    }
    const record = await insert(db, 'attachments', {
      id,
      tenant_id: user.tenant_id,
      asset_id: asset,
      uploaded_by: user.id,
      name: file.name.slice(0, 200),
      mime,
      size: file.size,
      storage_key: key,
    });
    return NextResponse.json(record);
  } catch (e) {
    return fail(e);
  }
}
