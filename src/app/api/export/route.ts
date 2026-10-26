import { currentUser } from '@/lib/security';
import { getState } from '@/lib/service';
import { csvCell, requireRole, openDefect, terminalWork, sumMoney } from '@/lib/domain';
import { fail } from '@/lib/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(req: Request) {
  try {
    const user = await currentUser();
    requireRole(user, ['manager', 'dispatcher', 'leader', 'observer']);
    const state = await getState(user);
    const report = new URL(req.url).searchParams.get('type') || 'assets';
    let data: unknown[][] = [];
    if (report === 'assets')
      data = [
        [
          'Номер',
          'Название',
          'Город',
          'Район',
          'Тип',
          'Техническое состояние',
          'Осмотр',
          'Документы',
          'Широта',
          'Долгота',
        ],
        ...state.assets.map((a: any) => [
          a.number,
          a.name,
          a.city,
          a.district,
          a.type,
          a.technical_state,
          a.inspection_state,
          a.document_state,
          a.latitude,
          a.longitude,
        ]),
      ];
    else if (report === 'defects')
      data = [
        [
          'Объект',
          'Категория',
          'Описание',
          'Серьёзность',
          'Статус',
          'Регистрация UTC',
          'Закрытие UTC',
          'Часы до подтверждённого закрытия',
        ],
        ...state.defects.map((d: any) => [
          state.assets.find((a: any) => a.id === d.asset_id)?.number,
          d.category,
          d.description,
          d.severity,
          d.status,
          d.created_at,
          d.closed_at || '',
          d.closed_at
            ? ((Date.parse(d.closed_at) - Date.parse(d.created_at)) / 3600000).toFixed(1)
            : 'Открыт',
        ]),
      ];
    else if (report === 'works')
      data = [
        ['Объект', 'Работа', 'Статус', 'Срок UTC', 'Исполнитель', 'Фактические расходы KZT'],
        ...state.work_orders.map((w: any) => [
          state.assets.find((a: any) => a.id === w.asset_id)?.number,
          w.title,
          w.status,
          w.due_at,
          state.profiles.find((u: any) => u.id === w.assignee_id)?.name,
          sumMoney(
            state.work_materials.filter((m: any) => m.work_id === w.id).map((m: any) => m.cost),
          ),
        ]),
      ];
    else
      data = [
        ['Показатель', 'Значение'],
        [
          'Активные объекты',
          state.assets.filter(
            (a: any) => a.card_status === 'approved' && a.lifecycle !== 'dismantled',
          ).length,
        ],
        ['Открытые дефекты', state.defects.filter(openDefect).length],
        ['Открытые задания', state.work_orders.filter((w: any) => !terminalWork(w)).length],
      ];
    return new Response('\ufeff' + data.map((r) => r.map(csvCell).join(';')).join('\r\n'), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="adasset-${report}.csv"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (e) {
    return fail(e);
  }
}
