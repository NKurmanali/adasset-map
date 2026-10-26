import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { type DB, insert, dataDir } from './db';
import { TENANT, ROLES } from './domain';
import { passwordHash } from './security';
export const uid = (n: number) => `b0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const date = (days: number) => new Date(Date.now() + days * 86400000).toISOString();
export async function seed(db: DB) {
  if ((await db.query('SELECT id FROM tenants LIMIT 1')).rows.length) return;
  const demo = process.env.DEMO_SEED !== 'false' && process.env.AUTH_PROVIDER !== 'supabase';
  await db.transaction(async (tx) => {
    await insert(tx, 'tenants', {
      id: TENANT,
      name: 'AdAsset · Qala',
      timezone: 'Asia/Qyzylorda',
      settings: {
        demo,
        reminder_days: [30, 14, 7],
        districts: ['Алмалы', 'Бостандык', 'Медеу', 'Ауэзов'],
        email_configured: false,
      },
    });
    for (const role of ROLES) await insert(tx, 'roles', { id: role, name: role });
    if (!demo) return;
    if (!process.env.DEMO_PASSWORD)
      throw new Error('Set DEMO_PASSWORD in .env.local before first launch. See README.');
    const names = [
      'Администратор',
      'Алия Сейтова',
      'Данияр Омаров',
      'Айгерим Нурлан',
      'Ерлан Мусин',
      'Мадина Асанова',
      'Наблюдатель',
    ];
    for (let i = 0; i < ROLES.length; i++) {
      const r = ROLES[i];
      await insert(tx, 'profiles', {
        id: uid(i + 1),
        tenant_id: TENANT,
        email: `${r}@adasset.local`,
        name: names[i],
        roles: [r],
        password_hash: passwordHash(process.env.DEMO_PASSWORD),
        data: {
          initials: names[i]
            .split(' ')
            .map((x) => x[0])
            .join(''),
          demo: true,
        },
      });
      await tx.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [uid(i + 1), r]);
    }
    for (let i = 0; i < 4; i++)
      await insert(tx, 'organizations', {
        id: uid(20 + i),
        tenant_id: TENANT,
        name: [
          'Qala Media · Демо',
          'Алатау Outdoor · Демо',
          'City Vision · Демо',
          'AdAsset Service · Демо',
        ][i],
        data: { kind: i === 3 ? 'service' : 'owner', contact: 'Демонстрационная организация' },
      });
    for (let i = 0; i < 2; i++) {
      await insert(tx, 'teams', {
        id: uid(30 + i),
        tenant_id: TENANT,
        name: ['Бригада «Север»', 'Бригада «Юг»'][i],
        data: { area: i ? 'Бостандык / Медеу' : 'Алмалы / Ауэзов' },
      });
      await tx.query('INSERT INTO team_members(team_id,user_id) VALUES($1,$2)', [
        uid(30 + i),
        uid(5),
      ]);
    }
    const types = [
      'Билборд',
      'Ситиборд',
      'Пилон',
      'Рекламная тумба',
      'Фасадная конструкция',
      'Крышная конструкция',
      'LED-экран',
      'Другой тип',
    ];
    for (let i = 0; i < types.length; i++) {
      await insert(tx, 'asset_types', { id: uid(40 + i), tenant_id: TENANT, name: types[i] });
      await insert(tx, 'document_requirements', {
        id: uid(60 + i),
        tenant_id: TENANT,
        asset_type: types[i],
        document_type: 'Паспорт',
        data: { basis: 'Внутреннее демонстрационное правило компании' },
      });
    }
    for (let i = 0; i < 3; i++)
      await insert(tx, 'document_types', {
        id: uid(50 + i),
        tenant_id: TENANT,
        name: ['Паспорт', 'Разрешение', 'Договор обслуживания'][i],
      });
    await insert(tx, 'inspection_template_versions', {
      id: uid(70),
      tenant_id: TENANT,
      name: 'Плановый визуальный осмотр',
      version: 1,
    });
    const checklist = [
      'Основание и опоры',
      'Крепления',
      'Рекламные поверхности',
      'Подсветка и питание',
      'Доступ и загрязнение',
    ];
    for (let i = 0; i < checklist.length; i++)
      await insert(tx, 'inspection_template_items', {
        id: uid(71 + i),
        tenant_id: TENANT,
        template_id: uid(70),
        name: checklist[i],
        position: i,
      });
    const streets = [
      'проспект Абая',
      'улица Байтурсынова',
      'проспект Сейфуллина',
      'улица Толе би',
      'проспект Достык',
      'улица Жандосова',
      'улица Сатпаева',
      'проспект Назарбаева',
      'улица Розыбакиева',
      'улица Кабанбай батыра',
    ];
    const labels = [
      'Абая / Байтурсынова',
      'Парк первого президента',
      'Толе би / Ауэзова',
      'Достык / Сатпаева',
      'Сейфуллина / Курмангазы',
      'Орбита · въезд',
      'Центральный стадион',
      'Назарбаева · центр',
      'Розыбакиева · юг',
      'Кабанбай батыра',
    ];
    await fs.mkdir(path.join(dataDir(), 'files'), { recursive: true });
    for (let i = 0; i < 20; i++) {
      const asset = uid(100 + i);
      const kind = types[i % 7];
      await insert(tx, 'assets', {
        id: asset,
        tenant_id: TENANT,
        number: `ALM-${String(i + 1).padStart(4, '0')}`,
        name: labels[i % 10] + (i >= 10 ? ' · 02' : ''),
        type: kind,
        address: `${streets[i % 10]}, ${30 + i * 7}`,
        city: 'Алматы',
        district: ['Алмалы', 'Бостандык', 'Медеу', 'Ауэзов'][i % 4],
        latitude: 43.213 + (i % 5) * 0.014 + (i % 3) * 0.002,
        longitude: 76.873 + Math.floor(i / 5) * 0.026 + (i % 2) * 0.006,
        owner_id: uid(20 + (i % 3)),
        service_id: uid(23),
        responsible_id: uid(2),
        card_status: i === 18 ? 'pending' : 'approved',
        lifecycle: i === 19 ? 'dismantled' : 'operating',
        data: {
          demo: true,
          width: 6,
          height: 3,
          unit: 'м',
          installed_at: '2024-04-15',
          lighting: i % 3 !== 0,
          material: 'Сталь',
          access: 'Подъезд со стороны сервисной дороги',
          description:
            'Вымышленный объект. Координаты и сведения приведены только для демонстрации.',
          dismantled_at: i === 19 ? date(-20) : null,
        },
      });
      for (const side of ['A', 'B'])
        await insert(tx, 'asset_surfaces', {
          id: randomUUID(),
          tenant_id: TENANT,
          asset_id: asset,
          name: side,
          data: { width: 6, height: 3, unit: 'м' },
        });
      const aid = uid(200 + i),
        key = aid + '.svg';
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="600" viewBox="0 0 1000 600"><defs><linearGradient id="s" x2="0" y2="1"><stop stop-color="#d6e6ec"/><stop offset="1" stop-color="#f5f6ef"/></linearGradient><linearGradient id="b"><stop stop-color="#122e50"/><stop offset="1" stop-color="#316e8c"/></linearGradient></defs><rect width="1000" height="600" fill="url(#s)"/><path d="M0 380L200 240 350 340 540 210 800 360 1000 260V600H0" fill="#9db7af" opacity=".4"/><rect y="450" width="1000" height="150" fill="#b4bdb7"/><path d="M0 535H1000" stroke="#f3eee4" stroke-width="8" stroke-dasharray="100 65"/><rect x="490" y="220" width="29" height="274" fill="#58646a"/><rect x="207" y="118" width="590" height="286" rx="8" fill="#4b5a63"/><rect x="220" y="130" width="564" height="258" fill="url(#b)"/><circle cx="680" cy="220" r="106" fill="#75bed0" opacity=".2"/><text x="260" y="185" fill="#abd6e2" font-family="sans-serif" font-size="20">AD ASSET / DEMO ${String(i + 1).padStart(2, '0')}</text><text x="260" y="275" fill="white" font-family="sans-serif" font-size="54" font-weight="bold">Your city.</text><text x="260" y="333" fill="white" font-family="sans-serif" font-size="54" font-weight="bold">In perspective.</text><rect x="24" y="24" width="290" height="34" rx="17" fill="white" opacity=".85"/><text x="40" y="47" fill="#364452" font-family="sans-serif" font-size="16">DEMO ILLUSTRATION · ALM-${String(i + 1).padStart(4, '0')}</text></svg>`;
      await fs.writeFile(path.join(dataDir(), 'files', key), svg);
      await insert(tx, 'attachments', {
        id: aid,
        tenant_id: TENANT,
        asset_id: asset,
        uploaded_by: uid(2),
        name: `ALM-${i + 1}-demo.svg`,
        mime: 'image/svg+xml',
        size: Buffer.byteLength(svg),
        storage_key: key,
        data: { demo: true },
      });
      await insert(tx, 'asset_photos', {
        id: randomUUID(),
        tenant_id: TENANT,
        asset_id: asset,
        attachment_id: aid,
        data: { caption: 'Демонстрационная иллюстрация конструкции', stage: 'overview' },
      });
      const docid = uid(300 + i),
        fileid = uid(400 + i),
        docKey = fileid + '.txt';
      const text = `ДЕМОНСТРАЦИОННЫЙ ДОКУМЕНТ\nПаспорт объекта ALM-${String(i + 1).padStart(4, '0')}\nВымышленные сведения. Не является разрешением или юридическим документом.\nТип: ${kind}\nРазмеры: 6 × 3 м\nВладелец: демонстрационная организация\n`;
      await fs.writeFile(path.join(dataDir(), 'files', docKey), text);
      await insert(tx, 'attachments', {
        id: fileid,
        tenant_id: TENANT,
        asset_id: asset,
        uploaded_by: uid(2),
        name: `Паспорт-ALM-${i + 1}-DEMO.txt`,
        mime: 'text/plain',
        size: Buffer.byteLength(text),
        storage_key: docKey,
        data: { demo: true },
      });
      await insert(tx, 'asset_documents', {
        id: docid,
        tenant_id: TENANT,
        asset_id: asset,
        type: 'Паспорт',
        name: 'Паспорт конструкции · демо',
        number: `DEMO-${i + 1}`,
        attachment_id: fileid,
        expires_at:
          i % 6 === 0 ? date(-7) : i % 5 === 0 ? date(12) : i % 4 === 0 ? null : date(180),
        review_status: 'verified',
        data: {
          issuer: 'Демонстрационная организация',
          issued_at: date(-180),
          responsible_id: uid(2),
        },
      });
      if (i < 18) {
        const planid = uid(500 + i);
        await insert(tx, 'inspection_plans', {
          id: planid,
          tenant_id: TENANT,
          asset_id: asset,
          template_id: uid(70),
          assignee_id: uid(4),
          interval_days: 30,
          rule: 'completion',
          next_due: date(i % 4 === 0 ? -3 : 10 + i),
          active: true,
        });
        const iid = uid(600 + i);
        await insert(tx, 'inspections', {
          id: iid,
          tenant_id: TENANT,
          asset_id: asset,
          template_id: uid(70),
          assignee_id: uid(4),
          due_at: date(-25),
          status: 'completed',
          completed_at: date(-25),
          data: {
            note: 'Демонстрационный осмотр',
            geolocation_status: 'not_requested',
            photos: [aid],
          },
        });
        for (let k = 0; k < 5; k++)
          await insert(tx, 'inspection_results', {
            id: randomUUID(),
            tenant_id: TENANT,
            inspection_id: iid,
            item_id: uid(71 + k),
            result: 'ok',
          });
        if (i < 5)
          await insert(tx, 'inspections', {
            id: uid(650 + i),
            tenant_id: TENANT,
            asset_id: asset,
            plan_id: planid,
            template_id: uid(70),
            assignee_id: uid(4),
            due_at: date(i % 4 === 0 ? -3 : 10 + i),
            status: 'scheduled',
          });
      }
    }
    const defectNames = [
      'Повреждение крепления',
      'Не работает подсветка стороны B',
      'Коррозия опорного элемента',
      'Загрязнение поверхности',
      'Повреждён рекламный щит',
      'Ослаблен крепёж панели',
      'Следы вандализма',
    ];
    for (let i = 0; i < 7; i++) {
      const asset = uid(100 + (i === 1 ? 0 : i));
      const severity = i === 0 ? 'critical' : i === 3 || i === 6 ? 'minor' : 'repair';
      await insert(tx, 'defects', {
        id: uid(700 + i),
        tenant_id: TENANT,
        asset_id: asset,
        author_id: uid(4),
        description: defectNames[i],
        category: [
          'Крепления',
          'Подсветка',
          'Коррозия',
          'Загрязнение',
          'Поверхность',
          'Крепления',
          'Вандализм',
        ][i],
        severity,
        priority: severity,
        status:
          i === 0
            ? 'registered'
            : i === 3
              ? 'review'
              : i === 4
                ? 'verification'
                : i === 2
                  ? 'in_progress'
                  : 'confirmed',
        data: { demo: true },
        created_at: date(-5 - i),
      });
      await tx.query('INSERT INTO defect_attachments(defect_id,attachment_id) VALUES($1,$2)', [
        uid(700 + i),
        uid(200 + (i === 1 ? 0 : i)),
      ]);
    }
    for (let i = 0; i < 5; i++) {
      const aid = 100 + (i === 1 ? 0 : i);
      const wid = uid(800 + i);
      const status = ['assigned', 'accepted', 'in_progress', 'paused', 'review'][i];
      await insert(tx, 'work_orders', {
        id: wid,
        tenant_id: TENANT,
        asset_id: uid(aid),
        title: [
          'Проверить крепление щита',
          'Восстановить подсветку',
          'Обработать опорный элемент',
          'Очистить поверхность',
          'Заменить повреждённую панель',
        ][i],
        description: 'Выполнить работы и передать результат на независимую проверку.',
        type: 'repair',
        priority: i === 0 ? 'critical' : 'normal',
        assignee_id: uid(5),
        team_id: uid(30 + (i % 2)),
        due_at: date(i === 2 ? -2 : 2 + i),
        status,
        data: {
          demo: true,
          pause_reason: i === 3 ? 'Ожидается доступ к объекту' : null,
          next_step: i === 3 ? 'Согласовать время с ответственным' : null,
          report:
            i === 4
              ? {
                  text: 'Панель заменена. Требуется проверка.',
                  photos: [uid(204)],
                  before_photos: [uid(204)],
                  resolved_defects: [uid(704)],
                  submitted_by: uid(5),
                }
              : null,
        },
      });
      await tx.query('INSERT INTO work_order_defects(work_id,defect_id) VALUES($1,$2)', [
        wid,
        uid(700 + i),
      ]);
      if (i === 4)
        await insert(tx, 'work_materials', {
          id: randomUUID(),
          tenant_id: TENANT,
          work_id: wid,
          name: 'Панель',
          quantity: '1',
          unit: 'шт',
          cost: '45000.00',
        });
    }
    for (let i = 0; i < 3; i++)
      await insert(tx, 'notifications', {
        id: randomUUID(),
        tenant_id: TENANT,
        user_id: uid(1),
        event_key: `demo:${i}`,
        title: [
          'Критический дефект · ALM-0001',
          'Работа ожидает проверки · ALM-0005',
          'Просрочен осмотр · ALM-0009',
        ][i],
        data: { asset_id: uid(100 + i), kind: i === 0 ? 'critical' : 'reminder' },
      });
    await insert(tx, 'audit_logs', {
      id: randomUUID(),
      tenant_id: TENANT,
      actor_id: uid(1),
      action: 'demo.seed',
      data: { assets: 20, note: 'Все объекты и организации вымышлены' },
    });
  });
}
