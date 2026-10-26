import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { type DB, database, flatten, insert, rows } from './db';
import {
  type Row,
  assert,
  requireRole,
  allowed,
  technicalState,
  inspectionState,
  documentState,
  nextDue,
  openDefect,
  terminalWork,
  ROLES,
} from './domain';
import { hash, passwordHash, safeProfile } from './security';
const str = (v: unknown, min = 1, max = 4000) => z.string().trim().min(min).max(max).parse(v);
const uuid = (v: unknown) => z.uuid().parse(v);
const iso = (v: unknown) => {
  const d = new Date(str(v));
  assert(!isNaN(d.getTime()), 'Неверная дата');
  return d.toISOString();
};
const ids = (v: unknown) =>
  z
    .array(z.uuid())
    .max(50)
    .parse(v ?? []);
const choice = (v: unknown, values: string[]) => {
  const s = str(v);
  assert(values.includes(s), 'Недопустимое значение');
  return s;
};
const json = (v: unknown) => JSON.stringify(v);
const TABLES = [
  'organizations',
  'profiles',
  'teams',
  'asset_types',
  'assets',
  'asset_surfaces',
  'asset_location_history',
  'asset_photos',
  'asset_responsibilities',
  'attachments',
  'document_types',
  'document_requirements',
  'asset_documents',
  'document_versions',
  'inspection_template_versions',
  'inspection_template_items',
  'inspection_plans',
  'inspections',
  'inspection_results',
  'defects',
  'work_orders',
  'work_order_assignments',
  'work_logs',
  'work_materials',
  'work_reviews',
  'notifications',
  'status_history',
] as const;
async function get(tx: DB, table: string, id: string, user: Row): Promise<Row> {
  const r = (
    await tx.query(`SELECT * FROM ${table} WHERE id=$1 AND tenant_id=$2`, [
      uuid(id),
      user.tenant_id,
    ])
  ).rows[0];
  assert(r, 'Запись не найдена', 404);
  return flatten(r);
}
const version = (r: Row, p: Row) =>
  assert(
    r.version === Number(p.version),
    'Данные изменены другим сотрудником. Обновите страницу и повторите изменения.',
    409,
  );
async function update(tx: DB, table: string, r: Row, values: Row) {
  const entries = Object.entries(values);
  await tx.query(
    `UPDATE ${table} SET ${entries.map(([k], i) => `${k}=$${i + 1}`).join(',')}${r.version ? ',version=version+1' : ''}${table === 'assets' ? ',updated_at=now()' : ''} WHERE id=$${entries.length + 1}`,
    [...entries.map(([, v]) => v), r.id],
  );
}
function optional(v: unknown, max = 4000) {
  return v == null ? '' : str(v, 0, max);
}
async function photos(tx: DB, user: Row, asset: string, v: unknown, required = false) {
  const result = ids(v);
  assert(!required || result.length > 0, 'Прикрепите фотографию');
  for (const id of result) {
    const f = await get(tx, 'attachments', id, user);
    assert(
      f.asset_id === asset && f.mime.startsWith('image/'),
      'Фотография должна принадлежать этому объекту',
    );
  }
  return result;
}
async function related(tx: DB, user: Row, table: string, id: string) {
  return get(tx, table, id, user);
}
async function notify(
  tx: DB,
  user: Row,
  event: string,
  title: string,
  data: Row,
  recipient?: string,
) {
  const people = recipient
    ? [{ id: recipient }]
    : (
        await tx.query(
          "SELECT id FROM profiles WHERE tenant_id=$1 AND active=true AND roles && ARRAY['admin','manager','dispatcher','leader']",
          [user.tenant_id],
        )
      ).rows;
  for (const p of people) {
    await tx.query(
      'INSERT INTO notifications(id,tenant_id,user_id,event_key,title,data) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(user_id,event_key) DO NOTHING',
      [randomUUID(), user.tenant_id, p.id, event, title, data],
    );
  }
}
async function log(
  tx: DB,
  user: Row,
  action: string,
  entity: string,
  asset: string | undefined,
  data: Row,
) {
  await insert(tx, 'audit_logs', {
    id: randomUUID(),
    tenant_id: user.tenant_id,
    actor_id: user.id,
    action,
    entity_id: entity,
    data,
  });
  if (asset)
    await insert(tx, 'status_history', {
      id: randomUUID(),
      tenant_id: user.tenant_id,
      actor_id: user.id,
      entity_type: action.split('.')[0],
      entity_id: entity,
      asset_id: asset,
      data: { action, ...data },
    });
}
async function addDefect(tx: DB, user: Row, p: Row, inspection?: string) {
  const a = await get(tx, 'assets', p.asset_id, user);
  assert(a.lifecycle !== 'dismantled', 'Объект демонтирован');
  if (p.surface_id) {
    const surface = await get(tx, 'asset_surfaces', p.surface_id, user);
    assert(surface.asset_id === a.id, 'Поверхность другого объекта');
  }
  const imageIds = await photos(tx, user, a.id, p.photos, true);
  const severity = choice(p.severity, ['minor', 'repair', 'critical']);
  if (a.manual_state) await update(tx, 'assets', a, { data: { ...a, manual_state: null } });
  const d = await insert(tx, 'defects', {
    id: randomUUID(),
    tenant_id: user.tenant_id,
    asset_id: a.id,
    surface_id: p.surface_id || null,
    inspection_id: inspection || null,
    author_id: user.id,
    description: str(p.description, 3),
    category: str(p.category),
    severity,
    data: { part: optional(p.part), preliminary: true },
  });
  for (const id of imageIds)
    await tx.query('INSERT INTO defect_attachments(defect_id,attachment_id) VALUES($1,$2)', [
      d.id,
      id,
    ]);
  if (severity === 'critical')
    await notify(tx, user, 'critical:' + d.id, `Критический дефект · ${a.number}`, {
      asset_id: a.id,
      defect_id: d.id,
      kind: 'critical',
    });
  await log(tx, user, 'defect.create', d.id, a.id, { description: d.description, severity });
  return d;
}
export async function getState(user: Row, db?: DB) {
  const tx = db || (await database());
  const result: Row = { user };
  for (const table of TABLES) {
    if (table === 'notifications')
      result[table] = (
        await tx.query(
          'SELECT * FROM notifications WHERE tenant_id=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT 200',
          [user.tenant_id, user.id],
        )
      ).rows.map(flatten);
    else if (table === 'profiles')
      result[table] = (await rows(tx, table, user.tenant_id)).map((p) => {
        const safe = safeProfile(p);
        if (!allowed(user, ['manager', 'dispatcher', 'leader'])) {
          delete safe.email;
          delete safe.contact;
        }
        return safe;
      });
    else result[table] = await rows(tx, table, user.tenant_id);
  }
  result.audit_logs = allowed(user, [])
    ? (
        await tx.query(
          'SELECT * FROM audit_logs WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 300',
          [user.tenant_id],
        )
      ).rows.map(flatten)
    : [];
  for (const table of ['work_order_defects', 'defect_attachments', 'team_members']) {
    const parent =
      table === 'work_order_defects'
        ? 'work_orders'
        : table === 'defect_attachments'
          ? 'defects'
          : 'teams';
    const key =
      table === 'work_order_defects'
        ? 'work_id'
        : table === 'defect_attachments'
          ? 'defect_id'
          : 'team_id';
    result[table] = (
      await tx.query(
        `SELECT r.* FROM ${table} r JOIN ${parent} p ON p.id=r.${key} WHERE p.tenant_id=$1`,
        [user.tenant_id],
      )
    ).rows;
  }
  result.inspections = result.inspections.map((i: Row) => ({
    ...i,
    results: result.inspection_results.filter((r: Row) => r.inspection_id === i.id),
  }));
  result.assets = result.assets.map((a: Row) => {
    const defs = result.defects.filter((d: Row) => d.asset_id === a.id);
    const ins = result.inspections.filter((i: Row) => i.asset_id === a.id);
    const state = technicalState(defs, ins);
    return {
      ...a,
      technical_state: state === 'critical' ? 'critical' : a.manual_state || state,
      inspection_state: inspectionState(a, result.inspection_plans, ins),
      document_state: documentState(
        result.asset_documents.filter((d: Row) => d.asset_id === a.id),
        result.document_requirements
          .filter((r: Row) => r.asset_type === a.type)
          .map((r: Row) => r.document_type),
      ),
      active_defects: defs.filter(openDefect).length,
    };
  });
  result.tenant = (await tx.query('SELECT * FROM tenants WHERE id=$1', [user.tenant_id])).rows[0];
  result.server_time = new Date().toISOString();
  result.integration = {
    auth: process.env.AUTH_PROVIDER || 'local',
    database: process.env.DATABASE_URL ? 'postgresql' : 'embedded-postgresql',
    storage: process.env.STORAGE_PROVIDER || 'local',
    email: false,
    geocoding: false,
  };
  return result;
}
export async function command(user: Row, action: string, p: Row, key: string, db?: DB) {
  const conn = db || (await database());
  assert(key && key.length <= 100, 'Требуется ключ идемпотентности');
  const fingerprint = hash(json({ action, p }));
  return conn.transaction(async (tx) => {
    await tx.query('SELECT id FROM tenants WHERE id=$1 FOR UPDATE', [user.tenant_id]);
    const previous = (
      await tx.query(
        'SELECT * FROM idempotency_keys WHERE tenant_id=$1 AND actor_id=$2 AND key=$3',
        [user.tenant_id, user.id, key],
      )
    ).rows[0];
    if (previous) {
      assert(
        previous.request_hash === fingerprint,
        'Ключ повторного запроса использован с другими данными',
        409,
      );
      return previous.response;
    }
    const result = await execute(tx, user, action, p);
    await insert(tx, 'idempotency_keys', {
      tenant_id: user.tenant_id,
      actor_id: user.id,
      key,
      request_hash: fingerprint,
      response: result,
    });
    return result;
  });
}
async function execute(tx: DB, user: Row, action: string, p: Row): Promise<Row> {
  const base = { id: randomUUID(), tenant_id: user.tenant_id };
  let entity = base.id;
  let asset: string | undefined;
  let info: Row = {};
  switch (action) {
    case 'asset.create':
    case 'asset.edit': {
      requireRole(user, ['manager']);
      const old = action === 'asset.edit' ? await get(tx, 'assets', p.id, user) : null;
      if (old) version(old, p);
      const a = z
        .object({
          number: z.string().trim().min(2).max(40),
          name: z.string().trim().min(3).max(200),
          type: z.string().min(1),
          address: z.string().trim().min(3).max(300),
          city: z.string().min(1),
          district: z.string().min(1),
          latitude: z.coerce.number().min(-90).max(90),
          longitude: z.coerce.number().min(-180).max(180),
          owner_id: z.uuid(),
          service_id: z.uuid(),
          responsible_id: z.uuid(),
        })
        .parse(p);
      await related(tx, user, 'organizations', a.owner_id);
      await related(tx, user, 'organizations', a.service_id);
      await related(tx, user, 'profiles', a.responsible_id);
      assert(
        (
          await tx.query('SELECT id FROM asset_types WHERE tenant_id=$1 AND name=$2', [
            user.tenant_id,
            a.type,
          ])
        ).rows.length,
        'Выберите существующий тип',
      );
      const extra = {
        width: p.width ? z.coerce.number().positive().parse(p.width) : null,
        height: p.height ? z.coerce.number().positive().parse(p.height) : null,
        unit: choice(p.unit || 'м', ['м', 'см']),
        lighting: !!p.lighting,
        material: optional(p.material),
        access: optional(p.access),
        description: optional(p.description),
        installed_at: p.installed_at || null,
      };
      if (old) {
        assert(
          old.lifecycle !== 'dismantled' && old.card_status !== 'archived',
          'Архивный объект недоступен для изменения',
        );
        assert(
          a.latitude === old.latitude && a.longitude === old.longitude,
          'Перенос выполняется отдельным действием с основанием',
        );
        entity = old.id;
        const { data, ...clean } = old;
        await update(tx, 'assets', old, { ...a, data: { ...clean, ...extra } });
      } else {
        await insert(tx, 'assets', { ...base, ...a, lifecycle: 'planned', data: extra });
        for (const name of ['A', 'B'])
          await insert(tx, 'asset_surfaces', {
            id: randomUUID(),
            tenant_id: user.tenant_id,
            asset_id: base.id,
            name,
          });
      }
      const near = (
        await tx.query(
          'SELECT number FROM assets WHERE tenant_id=$1 AND id<>$2 AND abs(latitude-$3)<0.0005 AND abs(longitude-$4)<0.0005',
          [user.tenant_id, entity, a.latitude, a.longitude],
        )
      ).rows;
      asset = entity;
      info = {
        number: a.number,
        warning: near.length ? 'Рядом есть объекты: ' + near.map((r) => r.number).join(', ') : null,
      };
      break;
    }
    case 'asset.submit':
    case 'asset.review':
    case 'asset.lifecycle':
    case 'asset.move':
    case 'asset.archive':
    case 'asset.manual': {
      requireRole(user, ['manager']);
      const a = await get(tx, 'assets', p.id, user);
      version(a, p);
      entity = asset = a.id;
      if (action === 'asset.submit') {
        assert(['draft', 'returned'].includes(a.card_status), 'Карточка уже отправлена');
        await update(tx, 'assets', a, { card_status: 'pending' });
        info = { status: 'pending' };
      }
      if (action === 'asset.review') {
        assert(a.card_status === 'pending', 'Карточка не ожидает проверки');
        const status = choice(p.status, ['approved', 'returned']);
        const reason = status === 'returned' ? str(p.reason, 3) : optional(p.reason);
        await update(tx, 'assets', a, {
          card_status: status,
          data: { ...a, review_reason: reason },
        });
        info = { status, reason };
      }
      if (action === 'asset.lifecycle') {
        const lifecycle = choice(p.lifecycle, [
          'planned',
          'installed',
          'operating',
          'suspended',
          'dismantled',
        ]);
        assert(
          a.lifecycle !== 'dismantled',
          'Демонтированный объект нельзя вернуть в эксплуатацию',
        );
        const reason = str(p.reason, 3);
        let more: Row = {};
        if (lifecycle === 'dismantled') {
          const files = await photos(tx, user, a.id, p.photos, true);
          const work = await get(tx, 'work_orders', p.work_id, user);
          assert(
            work.asset_id === a.id && work.type === 'dismantling' && work.status === 'completed',
            'Нужно подтверждённое задание на демонтаж',
          );
          const open = (
            await tx.query(
              "SELECT id FROM work_orders WHERE asset_id=$1 AND status NOT IN ('completed','cancelled')",
              [a.id],
            )
          ).rows;
          assert(!open.length, 'Сначала примите решение по открытым заданиям');
          await tx.query(
            "UPDATE inspections SET status='cancelled',version=version+1 WHERE asset_id=$1 AND status='scheduled'",
            [a.id],
          );
          await tx.query('UPDATE inspection_plans SET active=false WHERE asset_id=$1', [a.id]);
          more = {
            dismantled_at: iso(p.date || new Date().toISOString()),
            dismantled_by: user.id,
            dismantling_work: work.id,
            dismantling_photos: files,
          };
        }
        await update(tx, 'assets', a, {
          lifecycle,
          data: { ...a, ...more, lifecycle_reason: reason },
        });
        info = { from: a.lifecycle, to: lifecycle, reason };
      }
      if (action === 'asset.move') {
        assert(a.lifecycle !== 'dismantled', 'Объект демонтирован');
        const lat = z.coerce.number().min(-90).max(90).parse(p.latitude),
          lng = z.coerce.number().min(-180).max(180).parse(p.longitude);
        const reason = str(p.reason, 3);
        await insert(tx, 'asset_location_history', {
          ...base,
          asset_id: a.id,
          data: {
            from: [a.latitude, a.longitude],
            to: [lat, lng],
            reason,
            moved_at: iso(p.date || new Date().toISOString()),
            actor_id: user.id,
          },
        });
        await update(tx, 'assets', a, {
          latitude: lat,
          longitude: lng,
          address: str(p.address, 3),
        });
        info = { reason, latitude: lat, longitude: lng };
      }
      if (action === 'asset.archive') {
        assert(a.lifecycle === 'dismantled', 'Сначала подтвердите демонтаж');
        await update(tx, 'assets', a, { card_status: 'archived' });
        info = { status: 'archived' };
      }
      if (action === 'asset.manual') {
        const state = choice(p.state, ['unknown', 'remarks', 'repair']);
        const reason = str(p.reason, 5);
        const defs = (await tx.query('SELECT * FROM defects WHERE asset_id=$1', [a.id])).rows;
        assert(
          !defs.some(
            (d) => openDefect(d) && (d.severity === 'critical' || d.priority === 'critical'),
          ),
          'Критический сигнал нельзя скрыть',
        );
        await update(tx, 'assets', a, {
          data: { ...a, manual_state: state, manual_reason: reason },
        });
        info = { state, reason };
      }
      break;
    }
    case 'surface.create': {
      requireRole(user, ['manager']);
      const a = await get(tx, 'assets', p.asset_id, user);
      await insert(tx, 'asset_surfaces', {
        ...base,
        asset_id: a.id,
        name: str(p.name, 1, 50),
        data: { description: optional(p.description) },
      });
      asset = a.id;
      break;
    }
    case 'photo.add': {
      requireRole(user, ['manager', 'inspector', 'technician']);
      const a = await get(tx, 'assets', p.asset_id, user);
      const attachments = await photos(tx, user, a.id, [p.attachment_id], true);
      await insert(tx, 'asset_photos', {
        ...base,
        asset_id: a.id,
        attachment_id: attachments[0],
        data: {
          caption: optional(p.caption),
          stage: choice(p.stage || 'overview', ['overview', 'before', 'after']),
          surface_id: p.surface_id || null,
        },
      });
      asset = a.id;
      break;
    }
    case 'document.create': {
      requireRole(user, ['manager']);
      const a = await get(tx, 'assets', p.asset_id, user);
      const f = await get(tx, 'attachments', p.attachment_id, user);
      assert(f.asset_id === a.id, 'Файл другого объекта');
      await related(tx, user, 'profiles', p.responsible_id || user.id);
      const dates = {
        issued_at: p.issued_at ? iso(p.issued_at) : null,
        starts_at: p.starts_at ? iso(p.starts_at) : null,
      };
      const expires = p.expires_at ? iso(p.expires_at) : null;
      assert(!expires || !dates.starts_at || expires >= dates.starts_at, 'Окончание раньше начала');
      await insert(tx, 'asset_documents', {
        ...base,
        asset_id: a.id,
        type: str(p.type),
        name: str(p.name),
        number: str(p.number),
        attachment_id: f.id,
        expires_at: expires,
        data: {
          ...dates,
          issuer: optional(p.issuer),
          responsible_id: p.responsible_id || user.id,
          comment: optional(p.comment),
          previous_id: p.previous_id || null,
        },
      });
      if (p.previous_id) {
        const prev = await get(tx, 'asset_documents', p.previous_id, user);
        assert(
          prev.asset_id === a.id && !prev.superseded_by,
          'Документ уже заменён или принадлежит другому объекту',
        );
        await update(tx, 'asset_documents', prev, { data: { ...prev, superseded_by: base.id } });
        await insert(tx, 'document_versions', {
          id: randomUUID(),
          tenant_id: user.tenant_id,
          document_id: base.id,
          previous_id: prev.id,
          data: { reason: str(p.reason, 3) },
        });
      }
      asset = a.id;
      break;
    }
    case 'document.review': {
      requireRole(user, ['manager']);
      const d = await get(tx, 'asset_documents', p.id, user);
      version(d, p);
      const status = choice(p.status, ['verified', 'returned']);
      const reason = status === 'returned' ? str(p.reason, 3) : optional(p.reason);
      await update(tx, 'asset_documents', d, {
        review_status: status,
        data: {
          ...d,
          reviewed_by: user.id,
          reviewed_at: new Date().toISOString(),
          review_reason: reason,
        },
      });
      entity = d.id;
      asset = d.asset_id;
      info = { status, reason };
      break;
    }
    case 'plan.save': {
      requireRole(user, ['manager', 'dispatcher']);
      const a = await get(tx, 'assets', p.asset_id, user);
      assert(
        a.lifecycle !== 'dismantled' && a.card_status === 'approved',
        'Нужна подтверждённая действующая карточка',
      );
      await related(tx, user, 'inspection_template_versions', p.template_id);
      const inspector = await related(tx, user, 'profiles', p.assignee_id);
      assert(allowed(inspector, ['inspector']), 'Назначьте инспектора');
      const values = {
        asset_id: a.id,
        template_id: uuid(p.template_id),
        assignee_id: uuid(p.assignee_id),
        interval_days: z.coerce.number().int().min(1).max(3650).parse(p.interval_days),
        rule: choice(p.rule, ['completion', 'fixed']),
        next_due: iso(p.next_due),
        active: p.active !== false,
      };
      if (p.id) {
        const old = await get(tx, 'inspection_plans', p.id, user);
        entity = old.id;
        await update(tx, 'inspection_plans', old, values);
      } else await insert(tx, 'inspection_plans', { ...base, ...values });
      asset = a.id;
      break;
    }
    case 'inspection.create': {
      requireRole(user, ['manager', 'dispatcher']);
      const a = await get(tx, 'assets', p.asset_id, user);
      assert(
        a.card_status === 'approved' && a.lifecycle !== 'dismantled',
        'Объект недоступен для осмотра',
      );
      await related(tx, user, 'inspection_template_versions', p.template_id);
      const inspector = await related(tx, user, 'profiles', p.assignee_id);
      assert(allowed(inspector, ['inspector']), 'Назначьте инспектора');
      await insert(tx, 'inspections', {
        ...base,
        asset_id: a.id,
        template_id: uuid(p.template_id),
        assignee_id: uuid(p.assignee_id),
        due_at: iso(p.due_at),
        data: { reason: optional(p.reason) },
      });
      await notify(
        tx,
        user,
        'inspection:' + base.id,
        `Назначен осмотр · ${a.number}`,
        { asset_id: a.id },
        p.assignee_id,
      );
      asset = a.id;
      break;
    }
    case 'inspection.complete': {
      requireRole(user, ['inspector']);
      const i = await get(tx, 'inspections', p.id, user);
      version(i, p);
      assert(
        i.assignee_id === user.id || allowed(user, []),
        'Осмотр назначен другому сотруднику',
        403,
      );
      assert(i.status === 'scheduled', 'Осмотр уже завершён');
      const a = await get(tx, 'assets', i.asset_id, user);
      assert(a.lifecycle !== 'dismantled', 'Объект демонтирован');
      const items = (
        await tx.query(
          'SELECT * FROM inspection_template_items WHERE template_id=$1 ORDER BY position',
          [i.template_id],
        )
      ).rows;
      const results = z
        .array(
          z.object({
            item_id: z.uuid(),
            result: z.enum(['ok', 'issue', 'unverified', 'na']),
            note: z.string().max(4000).optional(),
            severity: z.enum(['minor', 'repair', 'critical']).optional(),
            photos: z.array(z.uuid()).optional(),
            surface_id: z.string().optional(),
          }),
        )
        .parse(p.results);
      assert(
        results.length === items.length &&
          new Set(results.map((r) => r.item_id)).size === items.length &&
          results.every((r) => items.some((i) => i.id === r.item_id)),
        'Заполните все пункты чек-листа',
      );
      for (const r of results) {
        if (r.result === 'issue') {
          await addDefect(
            tx,
            user,
            {
              asset_id: a.id,
              description: r.note,
              category: items.find((item) => item.id === r.item_id)!.name,
              severity: r.severity || 'repair',
              photos: r.photos,
              surface_id: r.surface_id || null,
            },
            i.id,
          );
        }
        if (r.result === 'unverified') str(r.note, 3);
        await insert(tx, 'inspection_results', {
          id: randomUUID(),
          tenant_id: user.tenant_id,
          inspection_id: i.id,
          item_id: r.item_id,
          result: r.result,
          data: { note: r.note || '', photos: r.photos || [] },
        });
      }
      const imageIds = await photos(tx, user, a.id, p.photos);
      const completed = new Date().toISOString();
      let geo: Row = {
        geolocation_status: choice(p.geolocation_status || 'not_requested', [
          'not_requested',
          'denied',
          'unavailable',
          'provided',
        ]),
      };
      if (geo.geolocation_status === 'provided')
        geo = {
          ...geo,
          coordinates: {
            latitude: z.number().min(-90).max(90).parse(p.coordinates?.latitude),
            longitude: z.number().min(-180).max(180).parse(p.coordinates?.longitude),
            accuracy: z.number().nonnegative().parse(p.coordinates?.accuracy),
          },
        };
      await update(tx, 'inspections', i, {
        status: 'completed',
        completed_at: completed,
        data: { ...i, note: optional(p.note), photos: imageIds, ...geo, completed_by: user.id },
      });
      await update(tx, 'assets', a, { data: { ...a, manual_state: null } });
      if (i.plan_id) {
        const plan = await get(tx, 'inspection_plans', i.plan_id, user);
        await update(tx, 'inspection_plans', plan, {
          next_due: nextDue(plan.next_due, plan.interval_days, plan.rule, completed),
        });
      }
      entity = i.id;
      asset = a.id;
      info = { status: 'completed' };
      break;
    }
    case 'inspection.addendum': {
      requireRole(user, ['inspector', 'manager']);
      const i = await get(tx, 'inspections', p.id, user);
      assert(i.status === 'completed', 'Дополнение доступно после завершения');
      assert(i.assignee_id === user.id || allowed(user, ['manager']), 'Нет доступа', 403);
      const reason = str(p.reason, 3),
        text = str(p.text, 3);
      entity = i.id;
      asset = i.asset_id;
      info = { reason, text, immutable_original: true };
      break;
    }
    case 'defect.create': {
      requireRole(user, ['manager', 'dispatcher', 'inspector', 'technician']);
      const d = await addDefect(tx, user, p);
      return { id: d.id, asset_id: d.asset_id };
    }
    case 'defect.triage': {
      requireRole(user, ['dispatcher']);
      const d = await get(tx, 'defects', p.id, user);
      version(d, p);
      assert(openDefect(d), 'Дефект уже закрыт');
      const status = choice(p.status, ['review', 'confirmed', 'rejected', 'duplicate']);
      const reason = ['rejected', 'duplicate'].includes(status)
        ? str(p.reason, 5)
        : optional(p.reason);
      if (status === 'duplicate') {
        const original = await get(tx, 'defects', p.duplicate_id, user);
        assert(
          original.id !== d.id && original.asset_id === d.asset_id && openDefect(original),
          'Укажите активный оригинальный дефект этого объекта',
        );
        assert(
          d.severity !== 'critical' || original.severity === 'critical',
          'Критический сигнал должен сохраняться в оригинале',
        );
      }
      const priority = choice(p.priority || d.severity, ['minor', 'repair', 'critical']);
      await update(tx, 'defects', d, {
        status,
        priority,
        data: {
          ...d,
          triage_reason: reason,
          triaged_by: user.id,
          duplicate_id: p.duplicate_id || null,
        },
      });
      entity = d.id;
      asset = d.asset_id;
      info = { status, priority, reason };
      break;
    }
    case 'work.create': {
      requireRole(user, ['dispatcher']);
      const a = await get(tx, 'assets', p.asset_id, user);
      assert(a.lifecycle !== 'dismantled', 'Объект демонтирован');
      const assignee = await related(tx, user, 'profiles', p.assignee_id);
      assert(
        assignee.active && allowed(assignee, ['technician', 'inspector']),
        'Назначьте активного исполнителя',
      );
      if (p.team_id) await related(tx, user, 'teams', p.team_id);
      const ds = ids(p.defect_ids);
      for (const id of ds) {
        const d = await get(tx, 'defects', id, user);
        assert(
          d.asset_id === a.id && openDefect(d),
          'Выбран недоступный дефект другого объекта или закрытый дефект',
        );
      }
      await insert(tx, 'work_orders', {
        ...base,
        asset_id: a.id,
        title: str(p.title, 3, 200),
        description: str(p.description, 3),
        type: choice(p.type, [
          'inspection',
          'repair',
          'cleaning',
          'lighting',
          'replacement',
          'dismantling',
          'other',
        ]),
        priority: choice(p.priority, ['low', 'normal', 'high', 'critical']),
        assignee_id: assignee.id,
        team_id: p.team_id || null,
        due_at: iso(p.due_at),
        data: {
          required_materials: optional(p.required_materials),
          require_before: !!p.require_before,
          planned_start: p.planned_start ? iso(p.planned_start) : null,
        },
      });
      for (const id of ds)
        await tx.query('INSERT INTO work_order_defects(work_id,defect_id) VALUES($1,$2)', [
          base.id,
          id,
        ]);
      await insert(tx, 'work_order_assignments', {
        id: randomUUID(),
        tenant_id: user.tenant_id,
        work_id: base.id,
        user_id: assignee.id,
      });
      await notify(
        tx,
        user,
        'work:' + base.id,
        `Назначено задание · ${a.number}`,
        { asset_id: a.id, work_id: base.id },
        assignee.id,
      );
      asset = a.id;
      break;
    }
    case 'work.transition': {
      const w = await get(tx, 'work_orders', p.id, user);
      version(w, p);
      const to = choice(p.status, ['accepted', 'in_progress', 'paused', 'cancelled']);
      if (to === 'cancelled') requireRole(user, ['dispatcher']);
      else {
        requireRole(user, ['technician', 'inspector']);
        assert(
          w.assignee_id === user.id || allowed(user, []),
          'Задание назначено другому сотруднику',
          403,
        );
      }
      const transitions: Row = {
        assigned: ['accepted', 'cancelled'],
        accepted: ['in_progress', 'cancelled'],
        in_progress: ['paused', 'cancelled'],
        paused: ['in_progress', 'cancelled'],
        rework: ['in_progress', 'cancelled'],
        review: ['cancelled'],
        draft: ['cancelled'],
      };
      assert(transitions[w.status]?.includes(to), 'Недопустимый переход статуса');
      const reason = ['paused', 'cancelled'].includes(to) ? str(p.reason, 3) : optional(p.reason);
      const next = to === 'paused' ? str(p.next_step, 3) : '';
      await update(tx, 'work_orders', w, {
        status: to,
        data: {
          ...w,
          pause_reason: reason,
          next_step: next,
          started_at:
            to === 'in_progress' ? w.started_at || new Date().toISOString() : w.started_at,
        },
      });
      if (to === 'in_progress')
        await tx.query(
          "UPDATE defects SET status='in_progress',version=version+1 WHERE id IN (SELECT defect_id FROM work_order_defects WHERE work_id=$1) AND status NOT IN ('closed','rejected','duplicate')",
          [w.id],
        );
      await insert(tx, 'work_logs', {
        ...base,
        work_id: w.id,
        author_id: user.id,
        data: { status: to, reason, next_step: next },
      });
      if (to === 'paused')
        await notify(
          tx,
          user,
          `paused:${w.id}:${w.version}`,
          `Работа приостановлена · ${w.title}`,
          { asset_id: w.asset_id, work_id: w.id },
        );
      entity = w.id;
      asset = w.asset_id;
      info = { from: w.status, to, reason };
      break;
    }
    case 'work.report': {
      requireRole(user, ['technician', 'inspector']);
      const w = await get(tx, 'work_orders', p.id, user);
      version(w, p);
      assert(w.assignee_id === user.id || allowed(user, []), 'Нет доступа к заданию', 403);
      assert(['in_progress', 'rework'].includes(w.status), 'Сначала начните работу');
      const after = await photos(tx, user, w.asset_id, p.photos, true),
        before = await photos(tx, user, w.asset_id, p.before_photos, !!w.require_before);
      const resolved = ids(p.resolved_defects);
      const links = (
        await tx.query('SELECT defect_id FROM work_order_defects WHERE work_id=$1', [w.id])
      ).rows;
      assert(
        resolved.every((id) => links.some((l) => l.defect_id === id)),
        'Дефект не связан с заданием',
      );
      const report = {
        text: str(p.text, 10),
        photos: after,
        before_photos: before,
        resolved_defects: resolved,
        submitted_by: user.id,
        submitted_at: new Date().toISOString(),
      };
      const materials = z
        .array(
          z.object({
            name: z.string().min(1),
            quantity: z.coerce.number().positive(),
            unit: z.string().min(1),
            cost: z.string().regex(/^\d{1,12}(\.\d{1,2})?$/),
          }),
        )
        .max(50)
        .parse(p.materials || []);
      await tx.query('DELETE FROM work_materials WHERE work_id=$1', [w.id]);
      for (const m of materials)
        await insert(tx, 'work_materials', {
          id: randomUUID(),
          tenant_id: user.tenant_id,
          work_id: w.id,
          ...m,
        });
      await update(tx, 'work_orders', w, { status: 'review', data: { ...w, report } });
      await insert(tx, 'work_logs', {
        ...base,
        work_id: w.id,
        author_id: user.id,
        data: { report, materials },
      });
      for (const id of resolved)
        await tx.query(
          "UPDATE defects SET status='verification',version=version+1 WHERE id=$1 AND status NOT IN ('closed','rejected','duplicate')",
          [id],
        );
      await notify(
        tx,
        user,
        `review:${w.id}:${w.version}`,
        `Работа ожидает проверки · ${w.title}`,
        { asset_id: w.asset_id, work_id: w.id },
      );
      entity = w.id;
      asset = w.asset_id;
      info = { status: 'review' };
      break;
    }
    case 'work.review': {
      requireRole(user, ['manager', 'leader']);
      const w = await get(tx, 'work_orders', p.id, user);
      version(w, p);
      assert(w.status === 'review', 'Работа не ожидает проверки');
      assert(
        w.assignee_id !== user.id && w.report?.submitted_by !== user.id,
        'Исполнитель не может подтверждать свою работу',
        403,
      );
      const outcome = choice(p.outcome, ['accepted', 'returned']);
      const note = str(p.note, 5);
      const resolved = ids(p.resolved_defects);
      assert(
        resolved.every((id) => w.report.resolved_defects.includes(id)),
        'Исполнитель не заявил этот дефект устранённым',
      );
      if (outcome === 'accepted')
        for (const id of resolved) {
          const d = await get(tx, 'defects', id, user);
          assert(d.asset_id === w.asset_id, 'Объект не совпадает');
          if (openDefect(d)) {
            await update(tx, 'defects', d, {
              status: 'closed',
              closed_at: new Date().toISOString(),
              data: { ...d, closed_by: user.id, review_work: w.id },
            });
            await tx.query(
              'UPDATE work_order_defects SET resolved=true WHERE work_id=$1 AND defect_id=$2',
              [w.id, id],
            );
            await log(tx, user, 'defect.close', id, w.asset_id, { work_id: w.id, note });
          }
        }
      await insert(tx, 'work_reviews', {
        ...base,
        work_id: w.id,
        reviewer_id: user.id,
        outcome,
        data: { note, resolved_defects: outcome === 'accepted' ? resolved : [] },
      });
      await update(tx, 'work_orders', w, {
        status: outcome === 'accepted' ? 'completed' : 'rework',
        completed_at: outcome === 'accepted' ? new Date().toISOString() : null,
      });
      const a = await get(tx, 'assets', w.asset_id, user);
      await update(tx, 'assets', a, { data: { ...a, manual_state: null } });
      await notify(
        tx,
        user,
        `reviewed:${w.id}:${w.version}`,
        `${outcome === 'accepted' ? 'Работа принята' : 'Возврат на доработку'} · ${w.title}`,
        { asset_id: w.asset_id, work_id: w.id },
        w.assignee_id,
      );
      entity = w.id;
      asset = w.asset_id;
      info = { outcome, note, resolved };
      break;
    }
    case 'notification.read': {
      if (p.all)
        await tx.query(
          'UPDATE notifications SET read_at=now() WHERE tenant_id=$1 AND user_id=$2 AND read_at IS NULL',
          [user.tenant_id, user.id],
        );
      else
        await tx.query('UPDATE notifications SET read_at=now() WHERE id=$1 AND user_id=$2', [
          uuid(p.id),
          user.id,
        ]);
      return { ok: true };
    }
    case 'organization.create': {
      requireRole(user, ['manager']);
      await insert(tx, 'organizations', {
        ...base,
        name: str(p.name, 2, 200),
        data: { kind: choice(p.kind, ['owner', 'service', 'both']), contact: optional(p.contact) },
      });
      break;
    }
    case 'team.save': {
      requireRole(user, []);
      const members = ids(p.members);
      for (const id of members) await related(tx, user, 'profiles', id);
      if (p.id) {
        const t = await get(tx, 'teams', p.id, user);
        entity = t.id;
        await update(tx, 'teams', t, { name: str(p.name, 2), data: { area: optional(p.area) } });
        await tx.query('DELETE FROM team_members WHERE team_id=$1', [t.id]);
      } else
        await insert(tx, 'teams', {
          ...base,
          name: str(p.name, 2),
          data: { area: optional(p.area) },
        });
      for (const id of members)
        await tx.query('INSERT INTO team_members(team_id,user_id) VALUES($1,$2)', [entity, id]);
      break;
    }
    case 'profile.create': {
      requireRole(user, []);
      assert(
        process.env.AUTH_PROVIDER !== 'supabase',
        'Создайте пользователя через Supabase Auth и scripts/provision-user.ts',
      );
      const roles = z.array(z.enum(ROLES)).min(1).parse(p.roles);
      const password = str(p.password, 12, 200);
      await insert(tx, 'profiles', {
        ...base,
        email: z.email().parse(p.email).toLowerCase(),
        name: str(p.name, 2),
        password_hash: passwordHash(password),
        roles,
      });
      for (const role of roles)
        await tx.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [base.id, role]);
      info = { roles };
      break;
    }
    case 'profile.update': {
      requireRole(user, []);
      const person = await get(tx, 'profiles', p.id, user);
      const roles = z.array(z.enum(ROLES)).min(1).parse(p.roles);
      assert(
        person.id !== user.id || (roles.includes('admin') && p.active !== false),
        'Нельзя лишить себя доступа администратора',
      );
      await update(tx, 'profiles', person, { roles, active: p.active !== false });
      await tx.query('DELETE FROM user_roles WHERE user_id=$1', [person.id]);
      for (const role of roles)
        await tx.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [person.id, role]);
      await tx.query('DELETE FROM sessions WHERE user_id=$1', [person.id]);
      entity = person.id;
      info = { roles, active: p.active !== false };
      break;
    }
    case 'settings.save': {
      requireRole(user, []);
      const timezone = str(p.timezone);
      try {
        new Intl.DateTimeFormat('ru', { timeZone: timezone });
      } catch {
        assert(false, 'Неизвестный часовой пояс');
      }
      const reminder_days = z
        .array(z.coerce.number().int().min(1).max(365))
        .min(1)
        .max(10)
        .parse(p.reminder_days);
      const districts = z.array(z.string().min(1)).min(1).parse(p.districts);
      await tx.query(
        'UPDATE tenants SET name=$1,timezone=$2,settings=settings || $3::jsonb WHERE id=$4',
        [str(p.name, 2), timezone, json({ reminder_days, districts }), user.tenant_id],
      );
      entity = user.tenant_id;
      break;
    }
    case 'dictionary.create': {
      requireRole(user, []);
      const table = choice(p.table, ['asset_types', 'document_types']);
      await insert(tx, table, { ...base, name: str(p.name, 2) });
      break;
    }
    case 'requirement.create': {
      requireRole(user, []);
      await insert(tx, 'document_requirements', {
        ...base,
        asset_type: str(p.asset_type),
        document_type: str(p.document_type),
        data: { basis: str(p.basis, 3) },
      });
      break;
    }
    case 'template.create': {
      requireRole(user, []);
      const name = str(p.name, 3),
        items = z.array(z.string().min(2).max(200)).min(1).max(40).parse(p.items);
      const n = (
        await tx.query(
          'SELECT COALESCE(MAX(version),0)+1 AS v FROM inspection_template_versions WHERE tenant_id=$1 AND name=$2',
          [user.tenant_id, name],
        )
      ).rows[0].v;
      await insert(tx, 'inspection_template_versions', { ...base, name, version: n });
      for (let k = 0; k < items.length; k++)
        await insert(tx, 'inspection_template_items', {
          id: randomUUID(),
          tenant_id: user.tenant_id,
          template_id: base.id,
          name: items[k],
          position: k,
        });
      break;
    }
    default:
      assert(false, 'Неизвестная операция', 404);
  }
  await log(tx, user, action, entity, asset, info);
  return { id: entity, asset_id: asset, ...info };
}
export async function scheduler(db?: DB) {
  const conn = db || (await database());
  return conn.transaction(async (tx) => {
    const tenants = (await tx.query('SELECT * FROM tenants FOR UPDATE')).rows;
    let created = 0;
    for (const t of tenants) {
      const system = (
        await tx.query(
          "SELECT id,tenant_id FROM profiles WHERE tenant_id=$1 AND active=true AND roles @> ARRAY['admin'] LIMIT 1",
          [t.id],
        )
      ).rows[0];
      if (!system) continue;
      const plans = (
        await tx.query(
          "SELECT p.*,a.number FROM inspection_plans p JOIN assets a ON a.id=p.asset_id WHERE p.tenant_id=$1 AND p.active=true AND a.lifecycle<>'dismantled' AND a.card_status='approved' AND p.next_due<=now()+interval '7 days'",
          [t.id],
        )
      ).rows;
      for (const p of plans) {
        const outstanding = (
          await tx.query("SELECT id FROM inspections WHERE plan_id=$1 AND status='scheduled'", [
            p.id,
          ])
        ).rows;
        if (outstanding.length) continue;
        const r = await tx.query(
          'INSERT INTO inspections(id,tenant_id,asset_id,plan_id,template_id,assignee_id,due_at) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(plan_id,due_at) DO NOTHING RETURNING id',
          [randomUUID(), t.id, p.asset_id, p.id, p.template_id, p.assignee_id, p.next_due],
        );
        if (r.rows.length) {
          created++;
          await notify(
            tx,
            system,
            'inspection:' + r.rows[0].id,
            `Назначен плановый осмотр · ${p.number}`,
            { asset_id: p.asset_id },
            p.assignee_id,
          );
        }
      }
      const docs = (
        await tx.query(
          "SELECT * FROM asset_documents WHERE tenant_id=$1 AND expires_at IS NOT NULL AND data->>'superseded_by' IS NULL",
          [t.id],
        )
      ).rows.map(flatten);
      for (const d of docs) {
        const days = Math.ceil((new Date(d.expires_at).getTime() - Date.now()) / 86400000);
        const thresholds = [...(t.settings.reminder_days || [30, 14, 7]), 0].sort((a, b) => a - b);
        const threshold = thresholds.find((n) => days <= n);
        if (threshold !== undefined)
          await notify(
            tx,
            system,
            `document:${d.id}:${new Date(d.expires_at).toISOString()}:${threshold}`,
            `${days <= 0 ? 'Документ истёк' : 'Заканчивается срок документа'} · ${d.number}`,
            { asset_id: d.asset_id, document_id: d.id },
            d.responsible_id,
          );
      }
      for (const [table, label] of [
        ['inspections', 'Осмотр'],
        ['work_orders', 'Задание'],
      ]) {
        const items = (
          await tx.query(
            `SELECT * FROM ${table} WHERE tenant_id=$1 AND due_at<now()+interval '2 days' AND status NOT IN ('completed','cancelled')`,
            [t.id],
          )
        ).rows;
        for (const item of items) {
          const overdue = new Date(item.due_at).getTime() < Date.now();
          await notify(
            tx,
            system,
            `${table}:${item.id}:${overdue ? 'overdue' : 'soon'}`,
            `${label}: ${overdue ? 'срок просрочен' : 'приближается срок'}`,
            { asset_id: item.asset_id },
            item.assignee_id,
          );
        }
      }
    }
    await tx.query('DELETE FROM sessions WHERE expires_at<now()');
    return { created };
  });
}
