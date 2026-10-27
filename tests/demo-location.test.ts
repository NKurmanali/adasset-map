import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { type DB, createDB, migrate } from '../src/lib/db';
import { seed, uid } from '../src/lib/seed';
import { TENANT, type Row } from '../src/lib/domain';
import { COMPANY_NAME, CITY, DISTRICTS, DEMO_LOCATION_VERSION, demoLocation } from '../src/lib/location';
import { migrateLegacyDemoLocation } from '../src/lib/demo-location-migration';

function failQuery(db: DB, prefix: string): DB {
  return {
    query: async <T extends Row = Row>(sql: string, params?: any[]) => {
      if (sql.startsWith(prefix)) throw new Error('Simulated migration interruption');
      return db.query<T>(sql, params);
    },
    exec: (sql) => db.exec(sql),
    transaction: (fn) => db.transaction((tx) => fn(failQuery(tx, prefix))),
  };
}

test('Legacy demo migration preserves records and safely resumes interrupted geography and file phases', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'adasset-location-test-'));
  const environmentKeys = ['DATA_DIR', 'DEMO_PASSWORD', 'AUTH_PROVIDER', 'DEMO_SEED'];
  const previousEnvironment = Object.fromEntries(environmentKeys.map((key) => [key, process.env[key]]));
  process.env.DATA_DIR = directory;
  process.env.DEMO_PASSWORD = 'IsolatedLocationTest!42';
  process.env.AUTH_PROVIDER = 'local';
  process.env.DEMO_SEED = 'true';
  const db = await createDB('memory://');
  try {
    await migrate(db);
    await seed(db);
    const fresh = (await db.query('SELECT * FROM assets')).rows;
    assert.equal(fresh.length, 20);
    assert(fresh.every((asset) => asset.city === CITY && asset.number.startsWith('SHY-') && asset.latitude > 42.2 && asset.latitude < 42.5 && asset.longitude > 69.4 && asset.longitude < 69.8));
    const before = (await db.query('SELECT (SELECT count(*) FROM work_orders) AS works, (SELECT count(*) FROM inspections) AS inspections, (SELECT count(*) FROM defects) AS defects')).rows[0];
    const settings = { demo: true, districts: ['Алмалы', 'Бостандык', 'Медеу', 'Ауэзов'], reminder_days: [30, 14, 7] };
    await db.query('UPDATE tenants SET name=$1,settings=$2 WHERE id=$3', ['AdAsset · Qala', settings, TENANT]);
    const oldNames = ['Абая / Байтурсынова', 'Парк первого президента', 'Толе би / Ауэзова', 'Достык / Сатпаева'];
    const oldStreets = ['проспект Абая', 'улица Байтурсынова', 'проспект Сейфуллина', 'улица Толе би'];
    for (let i = 0; i < 4; i++) {
      await db.query('UPDATE assets SET number=$1,name=$2,address=$3,city=$4,district=$5,latitude=$6,longitude=$7 WHERE id=$8', [`ALM-${String(i + 1).padStart(4, '0')}`, oldNames[i], `${oldStreets[i]}, ${30 + i * 7}`, 'Алматы', settings.districts[i], 43.213 + (i % 5) * 0.014 + (i % 3) * 0.002, 76.873 + Math.floor(i / 5) * 0.026 + (i % 2) * 0.006, uid(100 + i)]);
    }
    await db.query('UPDATE assets SET latitude=43.5 WHERE id=$1', [uid(101)]);
    await db.query("UPDATE assets SET data=jsonb_set(data,'{demo}','false') WHERE id=$1", [uid(102)]);
    await db.query('UPDATE assets SET name=$1,address=$2 WHERE id=$3', ['Собственное название', 'Свой адрес', uid(103)]);
    const file = path.join(directory, 'files', `${uid(200)}.svg`);
    const oldImage = (await fs.readFile(file, 'utf8')).replaceAll('SHY-0001', 'ALM-0001');
    await fs.writeFile(file, oldImage);
    await db.query('UPDATE attachments SET name=$1,size=$2 WHERE id=$3', ['ALM-1-demo.svg', Buffer.byteLength(oldImage), uid(200)]);

    await assert.rejects(migrateLegacyDemoLocation(failQuery(db, 'INSERT INTO audit_logs')), /Simulated migration interruption/);
    assert.equal((await db.query('SELECT city FROM assets WHERE id=$1', [uid(100)])).rows[0].city, 'Алматы');
    assert.equal(await fs.readFile(file, 'utf8'), oldImage, 'A failed geography transaction must not change files');
    assert.equal((await db.query('SELECT count(*) AS count FROM asset_location_history')).rows[0].count, 0);

    await assert.rejects(migrateLegacyDemoLocation(failQuery(db, 'UPDATE attachments SET name=')), /Simulated migration interruption/);
    const interruptedTenant = (await db.query('SELECT settings FROM tenants WHERE id=$1', [TENANT])).rows[0];
    assert.equal(interruptedTenant.settings.demo_location_version, DEMO_LOCATION_VERSION);
    assert.equal(interruptedTenant.settings.demo_location_files_version, undefined);
    assert.equal((await db.query('SELECT city FROM assets WHERE id=$1', [uid(100)])).rows[0].city, CITY);
    assert((await fs.readFile(file, 'utf8')).includes('SHY-0001'));
    assert.equal((await db.query('SELECT name FROM attachments WHERE id=$1', [uid(200)])).rows[0].name, 'ALM-1-demo.svg');

    await seed(db);
    const moved = (await db.query('SELECT * FROM assets WHERE id=$1', [uid(100)])).rows[0];
    for (const [key, value] of Object.entries(demoLocation(0))) assert.equal(moved[key], value);
    assert.equal((await db.query('SELECT latitude,city FROM assets WHERE id=$1', [uid(101)])).rows[0].latitude, 43.5);
    assert.equal((await db.query('SELECT city FROM assets WHERE id=$1', [uid(102)])).rows[0].city, 'Алматы');
    const custom = (await db.query('SELECT * FROM assets WHERE id=$1', [uid(103)])).rows[0];
    assert.equal(custom.city, CITY);
    assert.equal(custom.name, 'Собственное название');
    assert.equal(custom.address, 'Свой адрес');
    const after = (await db.query('SELECT (SELECT count(*) FROM work_orders) AS works, (SELECT count(*) FROM inspections) AS inspections, (SELECT count(*) FROM defects) AS defects')).rows[0];
    assert.deepEqual(after, before);
    const tenant = (await db.query('SELECT * FROM tenants WHERE id=$1', [TENANT])).rows[0];
    assert.equal(tenant.name, COMPANY_NAME);
    assert.deepEqual(tenant.settings.districts, DISTRICTS);
    assert.equal(tenant.settings.demo_location_version, DEMO_LOCATION_VERSION);
    assert.equal(tenant.settings.demo_location_files_version, DEMO_LOCATION_VERSION);
    assert.deepEqual(tenant.settings.reminder_days, [30, 14, 7]);
    const updatedImage = await fs.readFile(file, 'utf8');
    assert(updatedImage.includes('SHY-0001'));
    assert(!updatedImage.includes('ALM-0001'));
    const attachment = (await db.query('SELECT name,size FROM attachments WHERE id=$1', [uid(200)])).rows[0];
    assert.equal(attachment.name, 'SHY-1-demo.svg');
    assert.equal(attachment.size, Buffer.byteLength(updatedImage));
    assert(!(await fs.readdir(path.join(directory, 'files'))).some((name) => name.endsWith('.tmp')));
    assert.equal((await db.query('SELECT count(*) AS count FROM asset_location_history')).rows[0].count, 2);
    await seed(db);
    assert.equal((await db.query('SELECT count(*) AS count FROM asset_location_history')).rows[0].count, 2);
    assert.equal((await db.query("SELECT count(*) AS count FROM audit_logs WHERE action='demo.location.shymkent'")).rows[0].count, 1);
  } finally {
    await db.close?.();
    await fs.rm(directory, { recursive: true, force: true });
    for (const [key, value] of Object.entries(previousEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
