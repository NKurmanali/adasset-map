import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { type DB, dataDir, insert } from './db';
import { TENANT } from './domain';
import { COMPANY_NAME, DISTRICTS, DEMO_LOCATION_VERSION, demoLocation } from './location';

const id = (n: number) => `b0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const oldDistricts = ['Алмалы', 'Бостандык', 'Медеу', 'Ауэзов'];
const oldStreets = ['проспект Абая', 'улица Байтурсынова', 'проспект Сейфуллина', 'улица Толе би', 'проспект Достык', 'улица Жандосова', 'улица Сатпаева', 'проспект Назарбаева', 'улица Розыбакиева', 'улица Кабанбай батыра'];
const oldLabels = ['Абая / Байтурсынова', 'Парк первого президента', 'Толе би / Ауэзова', 'Достык / Сатпаева', 'Сейфуллина / Курмангазы', 'Орбита · въезд', 'Центральный стадион', 'Назарбаева · центр', 'Розыбакиева · юг', 'Кабанбай батыра'];

async function reconcileGeneratedDemoFiles(db: DB) {
  await db.transaction(async (tx) => {
    const tenant = (await tx.query('SELECT * FROM tenants WHERE id=$1 FOR UPDATE', [TENANT])).rows[0];
    if (!tenant || tenant.settings.demo !== true || tenant.settings.demo_location_version !== DEMO_LOCATION_VERSION || tenant.settings.demo_location_files_version === DEMO_LOCATION_VERSION) return;
    const audit = (await tx.query("SELECT data FROM audit_logs WHERE tenant_id=$1 AND action='demo.location.shymkent'", [TENANT])).rows;
    const migrated = new Set(audit.flatMap((row) => Array.isArray(row.data.migrated_asset_ids) ? row.data.migrated_asset_ids : []));
    for (let i = 0; i < 20; i++) {
      if (!migrated.has(id(100 + i))) continue;
      const asset = (await tx.query('SELECT * FROM assets WHERE id=$1 AND tenant_id=$2', [id(100 + i), TENANT])).rows[0];
      const next = demoLocation(i);
      if (!asset || asset.data.demo !== true || asset.city !== next.city || asset.number !== next.number) continue;
      const oldNumber = `ALM-${String(i + 1).padStart(4, '0')}`;
      for (const [offset, extension] of [[200, 'svg'], [400, 'txt']] as const) {
        const attachment = (await tx.query('SELECT * FROM attachments WHERE id=$1 AND asset_id=$2 AND tenant_id=$3', [id(offset + i), asset.id, TENANT])).rows[0];
        const expectedKey = `${id(offset + i)}.${extension}`;
        if (!attachment || attachment.data.demo !== true || attachment.storage_key !== expectedKey) continue;
        const filename = path.join(dataDir(), 'files', expectedKey);
        let content: string;
        try { content = await fs.readFile(filename, 'utf8'); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
        if (!content.includes('DEMO ILLUSTRATION') && !content.startsWith('ДЕМОНСТРАЦИОННЫЙ ДОКУМЕНТ')) continue;
        const updated = content.replaceAll(oldNumber, next.number);
        if (updated !== content) {
          const temporary = `${filename}.shymkent-${randomUUID()}.tmp`;
          try {
            const handle = await fs.open(temporary, 'wx');
            try { await handle.writeFile(updated); await handle.sync(); }
            finally { await handle.close(); }
            await fs.rename(temporary, filename);
          } finally {
            await fs.rm(temporary, { force: true });
          }
        }
        await tx.query('UPDATE attachments SET name=$1,size=$2 WHERE id=$3', [attachment.name.replace('ALM-', 'SHY-'), Buffer.byteLength(updated), attachment.id]);
      }
    }
    await tx.query('UPDATE tenants SET settings=$1 WHERE id=$2', [{ ...tenant.settings, demo_location_files_version: DEMO_LOCATION_VERSION }, TENANT]);
  });
}

export async function migrateLegacyDemoLocation(db: DB) {
  await db.transaction(async (tx) => {
    const tenant = (await tx.query('SELECT * FROM tenants WHERE id=$1 FOR UPDATE', [TENANT])).rows[0];
    if (!tenant || tenant.settings.demo !== true || tenant.settings.demo_location_version === DEMO_LOCATION_VERSION) return;
    const migrated: string[] = [];
    for (let i = 0; i < 20; i++) {
      const asset = (await tx.query('SELECT * FROM assets WHERE id=$1 AND tenant_id=$2', [id(100 + i), TENANT])).rows[0];
      if (!asset || asset.data.demo !== true || asset.city !== 'Алматы') continue;
      const oldLatitude = 43.213 + (i % 5) * 0.014 + (i % 3) * 0.002;
      const oldLongitude = 76.873 + Math.floor(i / 5) * 0.026 + (i % 2) * 0.006;
      // A location the user already moved must never be replaced by a demo migration.
      if (Math.abs(asset.latitude - oldLatitude) > 1e-9 || Math.abs(asset.longitude - oldLongitude) > 1e-9) continue;
      const next = demoLocation(i);
      const oldNumber = `ALM-${String(i + 1).padStart(4, '0')}`;
      const occupied = (await tx.query('SELECT id FROM assets WHERE tenant_id=$1 AND number=$2 AND id<>$3', [TENANT, next.number, asset.id])).rows.length > 0;
      const number = asset.number === oldNumber && !occupied ? next.number : asset.number;
      const name = asset.name === oldLabels[i % 10] + (i >= 10 ? ' · 02' : '') ? next.name : asset.name;
      const address = asset.address === `${oldStreets[i % 10]}, ${30 + i * 7}` ? next.address : asset.address;
      const district = asset.district === oldDistricts[i % 4] ? next.district : asset.district;
      await tx.query('UPDATE assets SET number=$1,name=$2,address=$3,city=$4,district=$5,latitude=$6,longitude=$7,version=version+1,updated_at=now() WHERE id=$8', [number, name, address, next.city, district, next.latitude, next.longitude, asset.id]);
      await insert(tx, 'asset_location_history', {
        id: randomUUID(), tenant_id: TENANT, asset_id: asset.id,
        data: { reason: 'Перенос демонстрационных объектов в Шымкент', previous: { city: asset.city, latitude: asset.latitude, longitude: asset.longitude, address: asset.address, number: asset.number }, current: { ...next, number, name, address, district } },
      });
      migrated.push(asset.id);
      if (number !== next.number) continue;
      await tx.query("UPDATE notifications SET title=replace(title,$1,$2) WHERE tenant_id=$3 AND event_key LIKE 'demo:%' AND title LIKE $4", [oldNumber, next.number, TENANT, `%${oldNumber}%`]);
    }
    const districts = JSON.stringify(tenant.settings.districts) === JSON.stringify(oldDistricts) ? DISTRICTS : tenant.settings.districts;
    await tx.query('UPDATE tenants SET name=$1,settings=$2 WHERE id=$3', [tenant.name === 'AdAsset · Qala' ? COMPANY_NAME : tenant.name, { ...tenant.settings, districts, demo_location_version: DEMO_LOCATION_VERSION }, TENANT]);
    await tx.query("UPDATE organizations SET name='Shymkent Reklama · Демо' WHERE id=$1 AND tenant_id=$2 AND name='Qala Media · Демо'", [id(20), TENANT]);
    await tx.query("UPDATE organizations SET name='Shymkent Outdoor · Демо' WHERE id=$1 AND tenant_id=$2 AND name='Алатау Outdoor · Демо'", [id(21), TENANT]);
    for (let i = 0; i < 2; i++) {
      const before = i ? 'Бостандык / Медеу' : 'Алмалы / Ауэзов';
      const after = i ? 'Аль-Фарабийский / Енбекшинский / Туранский' : 'Абайский / Каратауский';
      await tx.query("UPDATE teams SET data=jsonb_set(data,'{area}',to_jsonb($1::text)) WHERE id=$2 AND tenant_id=$3 AND data->>'area'=$4", [after, id(30 + i), TENANT, before]);
    }
    await insert(tx, 'audit_logs', { id: randomUUID(), tenant_id: TENANT, action: 'demo.location.shymkent', data: { migrated_asset_ids: migrated, note: 'Изменена только исходная география демонстрационных объектов. Осмотры, ремонты, файлы пользователей и их собственные координаты сохранены.' } });
  });
  // Geography is durable before touching generated files. A failed file phase
  // leaves its own marker unset, so startup can reconcile metadata and retry.
  await reconcileGeneratedDemoFiles(db);
}
