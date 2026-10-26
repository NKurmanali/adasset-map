import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createDB, migrate, insert, type DB, flatten } from '../src/lib/db';
import { seed, uid, date } from '../src/lib/seed';
import { command, getState, scheduler } from '../src/lib/service';
import {
  technicalState,
  documentState,
  nextDue,
  csvCell,
  sumMoney,
  TENANT,
  openDefect,
  type Row,
} from '../src/lib/domain';
let db: DB;
let temp: string;
let admin: Row, manager: Row, inspector: Row, tech: Row, dispatcher: Row;
let asset: string, inspection: string, work: string, attachment: string, defects: Row[];
const cmd = (u: Row, action: string, p: Row, key = randomUUID()) => command(u, action, p, key, db);
const record = async (table: string, id: string) =>
  flatten((await db.query(`SELECT * FROM ${table} WHERE id=$1`, [id])).rows[0]);
before(async () => {
  temp = await fs.mkdtemp(path.join(os.tmpdir(), 'adasset-tests-'));
  process.env.DATA_DIR = temp;
  process.env.DEMO_PASSWORD = 'IsolatedTests!42password';
  process.env.AUTH_PROVIDER = 'local';
  process.env.DEMO_SEED = 'true';
  db = await createDB('memory://');
  await migrate(db);
  await seed(db);
  [admin, manager, dispatcher, inspector, tech] = await Promise.all(
    [1, 2, 3, 4, 5].map((i) => record('profiles', uid(i))),
  );
});
after(async () => {
  if ('close' in db) await (db as any).close();
  assert.equal(path.dirname(path.resolve(temp)), path.resolve(os.tmpdir()));
  assert(path.basename(temp).startsWith('adasset-tests-'));
  await fs.rm(temp, { recursive: true, force: true });
});
test('Domain: critical signals, unknown data, expiry separation and exact money', () => {
  assert.equal(technicalState([{ status: 'registered', severity: 'critical' }], []), 'critical');
  assert.equal(technicalState([], []), 'unknown');
  assert.equal(
    technicalState(
      [
        { status: 'registered', severity: 'repair' },
        { status: 'confirmed', severity: 'minor' },
      ],
      [],
    ),
    'unknown',
  );
  assert.equal(
    technicalState(
      [],
      [{ status: 'completed', completed_at: date(-1), results: [{ result: 'unverified' }] }],
    ),
    'unknown',
  );
  assert.equal(
    documentState([{ type: 'Паспорт', review_status: 'verified', expires_at: null }], ['Паспорт']),
    'valid',
  );
  assert.equal(
    documentState(
      [{ type: 'Паспорт', review_status: 'verified', expires_at: date(-2) }],
      ['Паспорт'],
    ),
    'expired',
  );
  assert.equal(sumMoney(['0.10', '0.20', '45000.00']), '45000.30');
  assert.equal(csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
  assert.equal(
    nextDue('2026-01-01T00:00:00Z', 30, 'fixed', '2026-03-03T00:00:00Z'),
    '2026-04-01T00:00:00.000Z',
  );
});
test('Seed: twenty assets, two independent defects, repeat seed preserves data', async () => {
  await seed(db);
  const s = await getState(admin, db);
  assert.equal(s.assets.length, 20);
  assert.equal(s.teams.length, 2);
  assert.equal(s.defects.filter((d: Row) => d.asset_id === uid(100)).length, 2);
  assert(s.assets.some((a: Row) => a.lifecycle === 'dismantled'));
  assert.equal(s.assets.find((a: Row) => a.id === uid(106)).technical_state, 'remarks');
});
test('Create → validate → approve: persisted unknown state, idempotency and optimistic locking', async () => {
  const p = {
    number: 'TEST-0001',
    name: 'Acceptance test asset',
    type: 'Билборд',
    address: 'Test street 1',
    city: 'Алматы',
    district: 'Алмалы',
    latitude: 43.25,
    longitude: 76.95,
    owner_id: uid(20),
    service_id: uid(23),
    responsible_id: manager.id,
  };
  const key = randomUUID();
  const [a, b] = await Promise.all([
    cmd(manager, 'asset.create', p, key),
    cmd(manager, 'asset.create', p, key),
  ]);
  assert.equal(a.id, b.id);
  asset = a.id;
  await assert.rejects(() => cmd(manager, 'asset.create', { ...p, name: 'Changed' }, key), /Ключ/);
  await assert.rejects(
    () => cmd(manager, 'asset.create', p),
    (e) => (e as any).code === '23505',
  );
  let row = await record('assets', asset);
  await cmd(manager, 'asset.submit', { id: asset, version: row.version });
  await assert.rejects(
    () => cmd(manager, 'asset.review', { id: asset, version: row.version, status: 'approved' }),
    /Данные изменены/,
  );
  row = await record('assets', asset);
  await cmd(manager, 'asset.review', { id: asset, version: row.version, status: 'approved' });
  const s = await getState(admin, db);
  assert.equal(s.assets.find((a: Row) => a.id === asset).technical_state, 'unknown');
  attachment = randomUUID();
  await insert(db, 'attachments', {
    id: attachment,
    tenant_id: TENANT,
    asset_id: asset,
    uploaded_by: inspector.id,
    name: 'test.jpg',
    mime: 'image/jpeg',
    size: 10,
    storage_key: attachment + '.jpg',
  });
});
test('RBAC: technician cannot change owner documents, observer cannot mutate', async () => {
  await assert.rejects(
    () => cmd(tech, 'document.create', { asset_id: asset }),
    /Недостаточно прав/,
  );
  const observer = await record('profiles', uid(7));
  await assert.rejects(
    () => cmd(observer, 'defect.create', { asset_id: asset }),
    /Недостаточно прав/,
  );
});
test('Inspection: atomic results and two defects; repeated completion never duplicates', async () => {
  const result = await cmd(manager, 'inspection.create', {
    asset_id: asset,
    template_id: uid(70),
    assignee_id: inspector.id,
    due_at: date(0),
  });
  inspection = result.id;
  const items = (
    await db.query(
      'SELECT id FROM inspection_template_items WHERE template_id=$1 ORDER BY position',
      [uid(70)],
    )
  ).rows;
  const p = {
    id: inspection,
    version: 1,
    results: items.map((r, i) => ({
      item_id: r.id,
      result: i < 2 ? 'issue' : 'ok',
      note: i < 2 ? 'Нарушено крепление' : '',
      severity: i === 0 ? 'critical' : 'repair',
      photos: i < 2 ? [attachment] : [],
    })),
    photos: [attachment],
    geolocation_status: 'denied',
  };
  const before = (await db.query('SELECT count(*) AS n FROM defects')).rows[0].n;
  await assert.rejects(
    () =>
      cmd(inspector, 'inspection.complete', {
        ...p,
        results: p.results.map((r, i) => (i === 1 ? { ...r, photos: [] } : r)),
      }),
    /фотографию/,
  );
  assert.equal((await db.query('SELECT count(*) AS n FROM defects')).rows[0].n, before);
  assert.equal((await record('inspections', inspection)).status, 'scheduled');
  const key = randomUUID();
  await cmd(inspector, 'inspection.complete', p, key);
  await cmd(inspector, 'inspection.complete', p, key);
  defects = (
    await db.query('SELECT * FROM defects WHERE inspection_id=$1 ORDER BY severity', [inspection])
  ).rows;
  assert.equal(defects.length, 2);
  assert.equal(
    (
      await db.query('SELECT count(*) AS n FROM inspection_results WHERE inspection_id=$1', [
        inspection,
      ])
    ).rows[0].n,
    5,
  );
  assert.equal(
    (await getState(admin, db)).assets.find((a: Row) => a.id === asset).technical_state,
    'critical',
  );
  await assert.rejects(() => cmd(inspector, 'inspection.complete', p), /Данные изменены/);
});
test('Repair: report does not close defects; reviewer cannot be executor; partial acceptance retains repair state', async () => {
  for (const d of defects)
    await cmd(dispatcher, 'defect.triage', {
      id: d.id,
      version: d.version,
      status: 'confirmed',
      priority: d.severity,
    });
  work = (
    await cmd(dispatcher, 'work.create', {
      asset_id: asset,
      title: 'Устранить два дефекта',
      description: 'Ремонт опор и креплений',
      type: 'repair',
      priority: 'critical',
      assignee_id: tech.id,
      due_at: date(3),
      defect_ids: defects.map((d) => d.id),
      require_before: true,
    })
  ).id;
  let w = await record('work_orders', work);
  await assert.rejects(
    () => cmd(tech, 'work.transition', { id: work, version: w.version, status: 'in_progress' }),
    /Недопустимый переход/,
  );
  await cmd(tech, 'work.transition', { id: work, version: w.version, status: 'accepted' });
  w = await record('work_orders', work);
  await cmd(tech, 'work.transition', { id: work, version: w.version, status: 'in_progress' });
  w = await record('work_orders', work);
  const critical = defects.find((d) => d.severity === 'critical')!;
  await cmd(tech, 'work.report', {
    id: work,
    version: w.version,
    text: 'Выполнена замена повреждённого крепления.',
    photos: [attachment],
    before_photos: [attachment],
    resolved_defects: [critical.id],
    materials: [{ name: 'Крепёж', quantity: 1, unit: 'компл', cost: '100.10' }],
  });
  assert.equal((await record('defects', critical.id)).status, 'verification');
  w = await record('work_orders', work);
  await assert.rejects(
    () =>
      cmd({ ...tech, roles: ['technician', 'manager'] }, 'work.review', {
        id: work,
        version: w.version,
        outcome: 'accepted',
        note: 'Проверено успешно',
        resolved_defects: [critical.id],
      }),
    /Исполнитель/,
  );
  await cmd(manager, 'work.review', {
    id: work,
    version: w.version,
    outcome: 'accepted',
    note: 'Крепление осмотрено, дефект устранён',
    resolved_defects: [critical.id],
  });
  assert.equal((await record('defects', critical.id)).status, 'closed');
  assert.equal(
    (await getState(admin, db)).assets.find((a: Row) => a.id === asset).technical_state,
    'repair',
  );
});
test('Final accepted repair gives healthy only after all defects closed; document expiry stays separate', async () => {
  const d = defects.find((d) => d.severity === 'repair')!;
  const id = (
    await cmd(dispatcher, 'work.create', {
      asset_id: asset,
      title: 'Завершить ремонт',
      description: 'Устранить второй дефект',
      type: 'repair',
      priority: 'normal',
      assignee_id: tech.id,
      due_at: date(2),
      defect_ids: [d.id],
    })
  ).id;
  for (const status of ['accepted', 'in_progress']) {
    const w = await record('work_orders', id);
    await cmd(tech, 'work.transition', { id, version: w.version, status });
  }
  let w = await record('work_orders', id);
  await cmd(tech, 'work.report', {
    id,
    version: w.version,
    text: 'Второй дефект устранён и проверен исполнителем',
    photos: [attachment],
    resolved_defects: [d.id],
  });
  w = await record('work_orders', id);
  await cmd(manager, 'work.review', {
    id,
    version: w.version,
    outcome: 'accepted',
    note: 'Выполнен осмотр результата',
    resolved_defects: [d.id],
  });
  assert.equal(
    (await getState(admin, db)).assets.find((a: Row) => a.id === asset).technical_state,
    'healthy',
  );
  await cmd(manager, 'document.create', {
    asset_id: asset,
    attachment_id: attachment,
    type: 'Паспорт',
    name: 'Тестовый документ',
    number: 'TEST-EXPIRED',
    expires_at: date(-1),
    responsible_id: manager.id,
  });
  const a = (await getState(admin, db)).assets.find((a: Row) => a.id === asset);
  assert.equal(a.document_state, 'expired');
  assert.equal(a.technical_state, 'healthy');
});
test('Cancellation preserves defects; new critical signals cannot be hidden by a concurrent review', async () => {
  const d = await cmd(inspector, 'defect.create', {
    asset_id: asset,
    description: 'Новый критический сигнал',
    category: 'Крепления',
    severity: 'critical',
    photos: [attachment],
  });
  const id = (
    await cmd(dispatcher, 'work.create', {
      asset_id: asset,
      title: 'Внеплановые работы',
      description: 'Проверить новый сигнал',
      type: 'repair',
      priority: 'critical',
      assignee_id: tech.id,
      due_at: date(1),
      defect_ids: [d.id],
    })
  ).id;
  await cmd(dispatcher, 'work.transition', {
    id,
    version: 1,
    status: 'cancelled',
    reason: 'Передано специализированной бригаде',
  });
  assert(openDefect(await record('defects', d.id)));
  assert.equal(
    (await getState(admin, db)).assets.find((a: Row) => a.id === asset).technical_state,
    'critical',
  );
});
test('Scheduler is idempotent; fixed and completion rules keep one outstanding inspection', async () => {
  await cmd(manager, 'plan.save', {
    asset_id: asset,
    template_id: uid(70),
    assignee_id: inspector.id,
    interval_days: 30,
    rule: 'completion',
    next_due: date(-1),
  });
  await scheduler(db);
  const count = (
    await db.query(
      "SELECT count(*) AS n FROM inspections WHERE asset_id=$1 AND status='scheduled'",
      [asset],
    )
  ).rows[0].n;
  await scheduler(db);
  assert.equal(
    (
      await db.query(
        "SELECT count(*) AS n FROM inspections WHERE asset_id=$1 AND status='scheduled'",
        [asset],
      )
    ).rows[0].n,
    count,
  );
  assert.equal(Number(count), 1);
  const n = (await db.query('SELECT count(*) AS n FROM notifications')).rows[0].n;
  await scheduler(db);
  assert.equal((await db.query('SELECT count(*) AS n FROM notifications')).rows[0].n, n);
});
test('Concurrent critical signal and acceptance: a new defect survives the repair transaction', async () => {
  const old = (
    await db.query(
      "SELECT * FROM defects WHERE asset_id=$1 AND status='registered' AND severity='critical' LIMIT 1",
      [asset],
    )
  ).rows[0];
  const id = (
    await cmd(dispatcher, 'work.create', {
      asset_id: asset,
      title: 'Проверка конкурентного ремонта',
      description: 'Устранить ранее зарегистрированную проблему',
      type: 'repair',
      priority: 'critical',
      assignee_id: tech.id,
      due_at: date(1),
      defect_ids: [old.id],
    })
  ).id;
  for (const status of ['accepted', 'in_progress']) {
    const w = await record('work_orders', id);
    await cmd(tech, 'work.transition', { id, version: w.version, status });
  }
  let w = await record('work_orders', id);
  await cmd(tech, 'work.report', {
    id,
    version: w.version,
    text: 'Ранее зарегистрированная проблема устранена',
    photos: [attachment],
    resolved_defects: [old.id],
  });
  w = await record('work_orders', id);
  const [, signal] = await Promise.all([
    cmd(manager, 'work.review', {
      id,
      version: w.version,
      outcome: 'accepted',
      note: 'Результат проверен другим сотрудником',
      resolved_defects: [old.id],
    }),
    cmd(inspector, 'defect.create', {
      asset_id: asset,
      description: 'Независимый новый критический сигнал',
      category: 'Основание',
      severity: 'critical',
      photos: [attachment],
    }),
  ]);
  assert.equal((await record('defects', old.id)).status, 'closed');
  assert.equal((await record('defects', signal.id)).status, 'registered');
  assert.equal(
    (await getState(admin, db)).assets.find((a: Row) => a.id === asset).technical_state,
    'critical',
  );
});
test('Dismantling retains records and disables all future periodic inspections', async () => {
  const id = (
    await cmd(dispatcher, 'work.create', {
      asset_id: asset,
      title: 'Демонтаж конструкции',
      description: 'Снять конструкцию и зафиксировать результат',
      type: 'dismantling',
      priority: 'normal',
      assignee_id: tech.id,
      due_at: date(1),
      defect_ids: [],
    })
  ).id;
  for (const status of ['accepted', 'in_progress']) {
    const w = await record('work_orders', id);
    await cmd(tech, 'work.transition', { id, version: w.version, status });
  }
  let w = await record('work_orders', id);
  await cmd(tech, 'work.report', {
    id,
    version: w.version,
    text: 'Конструкция демонтирована и вывезена',
    photos: [attachment],
    resolved_defects: [],
  });
  w = await record('work_orders', id);
  await cmd(manager, 'work.review', {
    id,
    version: w.version,
    outcome: 'accepted',
    note: 'Демонтаж проверен на месте',
    resolved_defects: [],
  });
  const a = await record('assets', asset);
  await cmd(manager, 'asset.lifecycle', {
    id: asset,
    version: a.version,
    lifecycle: 'dismantled',
    reason: 'Вывод из эксплуатации',
    work_id: id,
    photos: [attachment],
  });
  await scheduler(db);
  assert.equal((await record('assets', asset)).lifecycle, 'dismantled');
  assert.equal(
    (
      await db.query(
        "SELECT count(*) AS n FROM inspections WHERE asset_id=$1 AND status='scheduled'",
        [asset],
      )
    ).rows[0].n,
    0,
  );
  assert((await db.query('SELECT id FROM inspections WHERE asset_id=$1', [asset])).rows.length > 0);
});
