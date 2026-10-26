'use client';
import { useEffect, useMemo, useState, useCallback, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import {
  LayoutDashboard,
  Map as MapIcon,
  PanelsTopLeft,
  ClipboardCheck,
  TriangleAlert,
  Wrench,
  Files,
  Building2,
  Users,
  ChartNoAxesCombined,
  Bell,
  Settings,
  History,
  Search,
  Plus,
  ArrowUpRight,
  ArrowRight,
  ChevronDown,
  ChevronRight,
  SlidersHorizontal,
  Download,
  MapPin,
  CalendarDays,
  Clock,
  CheckCircle2,
  LogOut,
  Menu,
  X,
  RefreshCw,
  Loader2,
  ShieldCheck,
  QrCode,
  ScanLine,
  ExternalLink,
  FileText,
  MoreHorizontal,
  Layers,
  Radio,
  Activity,
  UploadCloud,
  Check,
  Printer,
} from 'lucide-react';
import { type Row, type Role, allowed, openDefect, terminalWork } from '@/lib/domain';
import { labels, translate, type Lang } from '@/lib/i18n';
import { Locale, Badge, Empty, Table, Dialog, FormDialog, Upload, type Field } from './ui';
import {
  AssetEditor,
  InspectionEditor,
  DefectEditor,
  WorkEditor,
  DocumentEditor,
  type Run,
} from './operations';
const MapView = dynamic(() => import('./map'), { ssr: false });
const nav = [
  ['overview', 'Обзор', LayoutDashboard],
  ['map', 'Карта', MapIcon],
  ['assets', 'Реестр объектов', PanelsTopLeft],
  ['inspections', 'Осмотры', ClipboardCheck],
  ['defects', 'Дефекты', TriangleAlert],
  ['works', 'Задания', Wrench],
  ['documents', 'Документы', Files],
  ['organizations', 'Организации', Building2],
  ['team', 'Команда', Users],
  ['reports', 'Отчёты', ChartNoAxesCombined],
  ['notifications', 'Уведомления', Bell],
  ['settings', 'Настройки', Settings],
  ['audit', 'Аудит', History],
] as const;
const select = (
  name: string,
  label: string,
  options: { value: string; label: string }[],
  value?: string,
  required = true,
): Field => ({ name, label, type: 'select', options, value, required });
const input = (name: string, label: string, value = '', type = 'text', required = true): Field => ({
  name,
  label,
  value,
  type,
  required,
});
const choices = (xs: string[]) => xs.map((value) => ({ value, label: labels[value] || value }));
function Logo({ small = false }: { small?: boolean }) {
  return (
    <div className={`brand ${small ? 'brand-small' : ''}`}>
      <span className="brand-icon">
        <MapPin size={23} />
        <i />
      </span>
      <strong>
        AdAsset<span>Map</span>
      </strong>
    </div>
  );
}
export default function Workspace() {
  const [lang, setLang] = useState<Lang>('ru'),
    [state, setState] = useState<Row | null>(null),
    [loading, setLoading] = useState(true),
    [authError, setAuthError] = useState('');
  const [page, setPage] = useState('overview'),
    [query, setQuery] = useState(''),
    [filters, setFilters] = useState<Row>({}),
    [assetId, setAssetId] = useState<string | null>(null),
    [assetTab, setAssetTab] = useState('Обзор'),
    [menu, setMenu] = useState(false),
    [modal, setModal] = useState<Row | null>(null),
    [toast, setToast] = useState(''),
    [onlyMine, setOnlyMine] = useState(false),
    [listStatus, setListStatus] = useState('');
  const t = useCallback((s: string) => translate(s, lang), [lang]);
  const load = useCallback(async () => {
    const response = await fetch('/api/app', { cache: 'no-store' });
    if (response.status === 401) {
      setState(null);
      return;
    }
    const body = await response.json();
    if (!response.ok) throw new Error(body.error);
    setState(body);
  }, []);
  useEffect(() => {
    setLang(localStorage.getItem('adasset:lang') === 'kk' ? 'kk' : 'ru');
    load()
      .catch((e) => setAuthError(e.message))
      .finally(() => setLoading(false));
    const id = new URLSearchParams(window.location.search).get('asset');
    if (id) setAssetId(id);
  }, [load]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 6000);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (!state) return;
    const timer = setInterval(() => load().catch(() => {}), 60000);
    return () => clearInterval(timer);
  }, [!!state, load]);
  const run: Run = async (action, payload) => {
    const fingerprint = JSON.stringify({ action, payload });
    const pendingKey = `adasset:pending:${state?.user.id}:${fingerprint}`;
    let key = localStorage.getItem(pendingKey);
    if (!key) {
      key = crypto.randomUUID();
      localStorage.setItem(pendingKey, key);
    }
    const response = await fetch('/api/app', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, payload, key }),
    });
    const data = await response.json();
    if (!response.ok) {
      if (response.status !== 500) localStorage.removeItem(pendingKey);
      throw new Error(data.error);
    }
    localStorage.removeItem(pendingKey);
    await load();
    if (action === 'asset.create') {
      setAssetId(data.id);
      setAssetTab('Обзор');
    }
    setToast(data.warning || t('Готово'));
    return data;
  };
  const attempt = async (action: string, payload: Row) => {
    try {
      await run(action, payload);
    } catch (e) {
      setToast((e as Error).message);
    }
  };
  const openAsset = (a: Row) => {
    setAssetId(a.id);
    setAssetTab('Обзор');
  };
  const changePage = (p: string) => {
    setPage(p);
    setQuery('');
    setListStatus('');
    setMenu(false);
  };
  const logout = async () => {
    const drafts = Object.keys(localStorage).filter((k) =>
      k.startsWith(`adasset:draft:${state?.user.id}:`),
    );
    if (drafts.length) {
      setModal({ kind: 'logout', drafts });
      return;
    }
    await doLogout();
  };
  const doLogout = async () => {
    const uid = state?.user.id;
    await fetch('/api/auth', { method: 'DELETE' });
    Object.keys(localStorage)
      .filter(
        (k) => k.startsWith(`adasset:draft:${uid}:`) || k.startsWith(`adasset:pending:${uid}:`),
      )
      .forEach((k) => localStorage.removeItem(k));
    setState(null);
    setModal(null);
  };
  const currency = (n: number | string) =>
    new Intl.NumberFormat(lang === 'kk' ? 'kk-KZ' : 'ru-KZ', { maximumFractionDigits: 2 }).format(
      Number(n),
    ) + ' ₸';
  const date = (v: unknown, withTime = false) =>
    v
      ? new Intl.DateTimeFormat(lang === 'kk' ? 'kk-KZ' : 'ru-RU', {
          day: '2-digit',
          month: lang === 'kk' ? '2-digit' : 'short',
          year: withTime ? 'numeric' : undefined,
          hour: withTime ? '2-digit' : undefined,
          minute: withTime ? '2-digit' : undefined,
          timeZone: state?.tenant.timezone || 'Asia/Qyzylorda',
        }).format(new Date(String(v)))
      : '—';
  const can = (...r: Role[]) => !!state && allowed(state.user, r);
  const userOptions =
    state?.profiles
      .filter((p: Row) => p.active)
      .map((p: Row) => ({ value: p.id, label: p.name })) || [];
  const assetOptions =
    state?.assets
      .filter((a: Row) => a.card_status === 'approved' && a.lifecycle !== 'dismantled')
      .map((a: Row) => ({ value: a.id, label: a.number + ' · ' + a.name })) || [];
  const rowOptions = (table: string, key = 'name') =>
    state?.[table].map((r: Row) => ({ value: r.id, label: r[key] })) || [];
  const assetById = (id: string) => state?.assets.find((a: Row) => a.id === id);
  const person = (id: string) => state?.profiles.find((u: Row) => u.id === id)?.name || '—';
  const organization = (id: string) =>
    state?.organizations.find((o: Row) => o.id === id)?.name || '—';
  const fmtStatus = (s: string) => t(labels[s] || s);
  const match = (r: Row) =>
    !query || JSON.stringify(r).toLocaleLowerCase().includes(query.toLocaleLowerCase());
  const active =
    state?.assets.filter(
      (a: Row) => a.card_status === 'approved' && a.lifecycle !== 'dismantled',
    ) || [];
  const filtered = useMemo(
    () =>
      state?.assets.filter((a: Row) => {
        if (!filters.archive && (a.lifecycle === 'dismantled' || a.card_status === 'archived'))
          return false;
        if (page === 'map' && a.card_status !== 'approved') return false;
        if (
          page === 'assets' &&
          !filters.drafts &&
          a.card_status !== 'approved' &&
          a.card_status !== 'archived'
        )
          return false;
        if (
          query &&
          ![a.name, a.number, a.address].some((s) => s.toLowerCase().includes(query.toLowerCase()))
        )
          return false;
        return (
          [
            'district',
            'type',
            'owner_id',
            'service_id',
            'city',
            'lifecycle',
            'technical_state',
          ].every((k) => !filters[k] || a[k] === filters[k]) &&
          (!filters.defects || a.active_defects > 0) &&
          (!filters.overdue || a.inspection_state === 'overdue') &&
          (!filters.documents || a.document_state !== 'valid')
        );
      }) || [],
    [state, filters, query, page],
  );
  const selectedAsset = state?.assets.find((a: Row) => a.id === assetId);
  const unread = state?.notifications.filter((n: Row) => !n.read_at).length || 0;
  const form = (title: string, action: string, fields: Field[], base: Row = {}) =>
    setModal({ kind: 'form', title, action, fields, base });
  const chooseAsset = (next: string) =>
    form('Объект', '__choose', [select('asset_id', 'Объект', assetOptions)], { next });
  const planInspection = (a?: Row) =>
    form(
      'Назначить осмотр',
      'inspection.create',
      [
        ...(!a ? [select('asset_id', 'Объект', assetOptions)] : []),
        select(
          'template_id',
          'Шаблон',
          rowOptions('inspection_template_versions'),
          state?.inspection_template_versions[0]?.id,
        ),
        select(
          'assignee_id',
          'Исполнитель',
          state?.profiles
            .filter((u: Row) => u.roles.includes('inspector'))
            .map((u: Row) => ({ value: u.id, label: u.name })) || [],
        ),
        input('due_at', 'Срок', new Date().toISOString().slice(0, 10), 'date'),
        input('reason', 'Причина', '', 'textarea', false),
      ],
      a ? { asset_id: a.id } : {},
    );
  const planRecurring = (a: Row) => {
    const old = state?.inspection_plans.find((p: Row) => p.asset_id === a.id);
    form(
      'План осмотров',
      'plan.save',
      [
        select(
          'template_id',
          'Шаблон',
          rowOptions('inspection_template_versions'),
          old?.template_id || state?.inspection_template_versions[0]?.id,
        ),
        select(
          'assignee_id',
          'Исполнитель',
          state?.profiles
            .filter((u: Row) => u.roles.includes('inspector'))
            .map((u: Row) => ({ value: u.id, label: u.name })) || [],
          old?.assignee_id,
        ),
        input('interval_days', 'Периодичность, дней', String(old?.interval_days || 30), 'number'),
        select(
          'rule',
          'Правило расчёта',
          [
            { value: 'completion', label: 'От завершения' },
            { value: 'fixed', label: 'Фиксированный график' },
          ],
          old?.rule || 'completion',
        ),
        input(
          'next_due',
          'Следующий осмотр',
          (old?.next_due || new Date().toISOString()).slice(0, 10),
          'date',
        ),
      ],
      { asset_id: a.id, id: old?.id },
    );
  };
  const createWork = (a?: Row, d?: Row) => {
    if (!a) {
      chooseAsset('work');
      return;
    }
    setModal({ kind: 'workCreate', asset: a, defect: d });
  };
  const reviewDocument = (d: Row) =>
    form(
      'Проверить документ',
      'document.review',
      [
        select('status', 'Статус', choices(['verified', 'returned']), 'verified'),
        input('reason', 'Причина', '', 'textarea', false),
      ],
      { id: d.id, version: d.version },
    );
  const triage = (d: Row) =>
    form(
      'Рассмотреть дефект',
      'defect.triage',
      [
        select(
          'status',
          'Статус',
          choices(['review', 'confirmed', 'rejected', 'duplicate']),
          'confirmed',
        ),
        select(
          'priority',
          'Приоритет',
          choices(['minor', 'repair', 'critical']),
          d.priority || d.severity,
        ),
        input('reason', 'Причина', '', 'textarea', false),
        select(
          'duplicate_id',
          'Оригинальный дефект',
          state?.defects
            .filter((x: Row) => x.asset_id === d.asset_id && x.id !== d.id && openDefect(x))
            .map((x: Row) => ({ value: x.id, label: x.description })) || [],
          undefined,
          false,
        ),
      ],
      { id: d.id, version: d.version },
    );
  const assetCell = (id: string) => (
    <button
      className="table-object"
      onClick={() => {
        const a = assetById(id);
        if (a) openAsset(a);
      }}
    >
      <strong>{assetById(id)?.number || '—'}</strong>
      <span>{assetById(id)?.name}</span>
    </button>
  );
  const pageHeader = (title: string, sub: string, action?: ReactNode) => (
    <div className="page-heading">
      <div>
        <div className="eyebrow">AD ASSET / {t('Рабочее пространство')}</div>
        <h1>{t(title)}</h1>
        <p>{t(sub)}</p>
      </div>
      {action && <div className="page-actions">{action}</div>}
    </div>
  );
  const addButton = (label: string, fn: () => void) => (
    <button className="button" onClick={fn}>
      <Plus size={17} />
      {t(label)}
    </button>
  );
  const exportButton = (type: string) => (
    <a className="button secondary" href={`/api/export?type=${type}`}>
      <Download size={16} />
      {t('Экспорт CSV')}
    </a>
  );
  const filterBar = (
    <div className="filterbar">
      <div className="input-search">
        <Search size={17} />
        <input
          aria-label={t('Поиск по номеру, названию, адресу')}
          placeholder={t('Поиск по номеру, названию, адресу')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {[
        ['district', 'Все районы', state?.tenant.settings.districts || []],
        [
          'technical_state',
          'Все состояния',
          ['healthy', 'remarks', 'repair', 'critical', 'unknown'],
        ],
        ['type', 'Все типы', state?.asset_types.map((a: Row) => a.name) || []],
      ].map(([key, label, opts]: any) => (
        <select
          key={key}
          aria-label={t(label)}
          value={filters[key] || ''}
          onChange={(e) => setFilters({ ...filters, [key]: e.target.value })}
        >
          <option value="">{t(label)}</option>
          {opts.map((s: string) => (
            <option key={s} value={s}>
              {fmtStatus(s)}
            </option>
          ))}
        </select>
      ))}
      <button
        className={`button secondary filter-toggle ${filters.extended ? 'active' : ''}`}
        aria-label={t('Применить')}
        onClick={() => setFilters({ ...filters, extended: !filters.extended })}
      >
        <SlidersHorizontal size={17} />
        <span>{lang === 'ru' ? 'Фильтры' : 'Сүзгілер'}</span>
      </button>
      {filters.extended && (
        <div className="expanded-filters">
          {[
            ['owner_id', 'Все владельцы'],
            ['service_id', 'Все подразделения'],
          ].map(([k, l]) => (
            <select
              key={k}
              value={filters[k] || ''}
              onChange={(e) => setFilters({ ...filters, [k]: e.target.value })}
            >
              <option value="">{t(l)}</option>
              {rowOptions('organizations').map((o: Row) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          ))}
          <select
            value={filters.city || ''}
            onChange={(e) => setFilters({ ...filters, city: e.target.value })}
          >
            <option value="">{t('Все города')}</option>
            {Array.from(new Set(state?.assets.map((a: Row) => a.city))).map((c) => (
              <option key={String(c)}>{String(c)}</option>
            ))}
          </select>
          <select
            value={filters.lifecycle || ''}
            onChange={(e) => setFilters({ ...filters, lifecycle: e.target.value })}
          >
            <option value="">{t('Все стадии')}</option>
            {choices(['planned', 'installed', 'operating', 'suspended', 'dismantled']).map((c) => (
              <option key={c.value} value={c.value}>
                {t(c.label)}
              </option>
            ))}
          </select>
          {[
            ['drafts', 'Показать черновики и карточки на проверке'],
            ['defects', 'С активными дефектами'],
            ['overdue', 'С просроченным осмотром'],
            ['documents', 'Проблемы с документами'],
            ['archive', 'Показать архив и демонтаж'],
          ].map(([k, l]) => (
            <label className="check-field" key={k}>
              <input
                type="checkbox"
                checked={!!filters[k]}
                onChange={(e) => setFilters({ ...filters, [k]: e.target.checked })}
              />
              {t(l)}
            </label>
          ))}
          <button className="text-button" onClick={() => setFilters({})}>
            {t('Очистить фильтры')}
          </button>
        </div>
      )}
    </div>
  );
  const assetTable = (data: Row[]) => (
    <Table headers={['Объект', 'Тип', 'Район', 'Состояние', 'Осмотры', 'Документы', '']}>
      {data.map((a) => (
        <tr key={a.id}>
          <td>{assetCell(a.id)}</td>
          <td>{a.type}</td>
          <td>{a.district}</td>
          <td>
            <Badge value={a.technical_state} />
          </td>
          <td>
            <Badge value={a.inspection_state} />
          </td>
          <td>
            <Badge value={a.document_state} />
          </td>
          <td>
            <button className="icon-button" aria-label={t('Открыть')} onClick={() => openAsset(a)}>
              <ArrowUpRight size={18} />
            </button>
          </td>
        </tr>
      ))}
    </Table>
  );
  const workTable = (data: Row[]) => (
    <Table headers={['Задания', 'Объект', 'Исполнитель', 'Срок', 'Статус', 'Действия']}>
      {data.map((w) => (
        <tr key={w.id}>
          <td>
            <button
              className="table-object"
              onClick={() => setModal({ kind: 'workDetail', work: w })}
            >
              <strong>{w.title}</strong>
              <span>{fmtStatus(w.type)}</span>
            </button>
          </td>
          <td>{assetCell(w.asset_id)}</td>
          <td>{person(w.assignee_id)}</td>
          <td
            className={!terminalWork(w) && Date.parse(w.due_at) < Date.now() ? 'overdue-text' : ''}
          >
            {date(w.due_at)}
          </td>
          <td>
            <Badge value={w.status} />
          </td>
          <td>{workActions(w)}</td>
        </tr>
      ))}
    </Table>
  );
  const workActions = (w: Row) => {
    const executor = (w.assignee_id === state?.user.id || can()) && can('technician', 'inspector');
    return (
      <div className="row-actions">
        {executor && w.status === 'assigned' && (
          <button
            className="text-button"
            onClick={() =>
              attempt('work.transition', { id: w.id, version: w.version, status: 'accepted' })
            }
          >
            {t('Принять задание')}
          </button>
        )}
        {executor && ['accepted', 'rework', 'paused'].includes(w.status) && (
          <button
            className="text-button"
            onClick={() =>
              attempt('work.transition', { id: w.id, version: w.version, status: 'in_progress' })
            }
          >
            {t(w.status === 'paused' ? 'Возобновить' : 'Начать работу')}
          </button>
        )}
        {executor && w.status === 'in_progress' && (
          <>
            <button
              className="text-button"
              onClick={() => setModal({ kind: 'workReport', work: w })}
            >
              {t('Отчёт о выполнении')}
            </button>
            <button
              className="text-button muted"
              onClick={() =>
                form(
                  'Приостановить',
                  'work.transition',
                  [input('reason', 'Причина', '', 'textarea'), input('next_step', 'Следующий шаг')],
                  { id: w.id, version: w.version, status: 'paused' },
                )
              }
            >
              {t('Приостановить')}
            </button>
          </>
        )}
        {can('manager', 'leader') &&
          w.status === 'review' &&
          w.assignee_id !== state?.user.id &&
          w.report?.submitted_by !== state?.user.id && (
            <button
              className="text-button"
              onClick={() => setModal({ kind: 'workReview', work: w })}
            >
              {t('Проверить результат')}
            </button>
          )}
        {can('dispatcher') && !terminalWork(w) && (
          <button
            className="icon-button muted"
            aria-label={t('Отменить задание')}
            onClick={() =>
              form(
                'Отменить задание',
                'work.transition',
                [input('reason', 'Причина', '', 'textarea')],
                { id: w.id, version: w.version, status: 'cancelled' },
              )
            }
          >
            <X size={14} />
          </button>
        )}
      </div>
    );
  };
  const defectTable = (data: Row[]) => (
    <Table headers={['Дефекты', 'Объект', 'Серьёзность', 'Статус', 'Действия']}>
      {data.map((d) => (
        <tr key={d.id}>
          <td>
            <button
              className="table-object"
              onClick={() => setModal({ kind: 'defectDetail', defect: d })}
            >
              <strong>{d.description}</strong>
              <span>
                {d.category} · {date(d.created_at)}
              </span>
            </button>
          </td>
          <td>{assetCell(d.asset_id)}</td>
          <td>
            <Badge value={d.priority || d.severity} />
          </td>
          <td>
            <Badge value={d.status === 'review' ? 'На рассмотрении' : d.status} />
          </td>
          <td>
            <div className="row-actions">
              {can('dispatcher') && openDefect(d) && (
                <>
                  <button className="text-button" onClick={() => triage(d)}>
                    {t('Рассмотреть дефект')}
                  </button>
                  <button
                    className="text-button"
                    onClick={() => createWork(assetById(d.asset_id), d)}
                  >
                    {t('Создать задание')}
                  </button>
                </>
              )}
            </div>
          </td>
        </tr>
      ))}
    </Table>
  );
  const inspectionTable = (data: Row[]) => (
    <Table headers={['Объект', 'Исполнитель', 'Срок', 'Статус', 'Действия']}>
      {data.map((i) => (
        <tr key={i.id}>
          <td>{assetCell(i.asset_id)}</td>
          <td>{person(i.assignee_id)}</td>
          <td
            className={
              i.status === 'scheduled' && Date.parse(i.due_at) < Date.now() ? 'overdue-text' : ''
            }
          >
            {date(i.due_at)}
          </td>
          <td>
            <Badge value={i.status} />
          </td>
          <td>
            {i.status === 'scheduled' &&
            can('inspector') &&
            (i.assignee_id === state?.user.id || can()) ? (
              <button
                className="text-button"
                onClick={() => setModal({ kind: 'inspection', inspection: i })}
              >
                {t('Начать осмотр')}
              </button>
            ) : (
              <button
                className="text-button"
                onClick={() => setModal({ kind: 'inspectionDetail', inspection: i })}
              >
                {t('Открыть')}
              </button>
            )}
          </td>
        </tr>
      ))}
    </Table>
  );
  const documentTable = (data: Row[]) => (
    <Table headers={['Документы', 'Объект', 'Срок', 'Статус', 'Действия']}>
      {data.map((d) => (
        <tr key={d.id}>
          <td>
            <a className="table-object" href={`/api/files/${d.attachment_id}`} target="_blank">
              <strong>
                <FileText size={15} />
                {d.name}
              </strong>
              <span>
                {d.number} · {d.type}
                {d.superseded_by ? ' · ' + t('Архив') : ''}
              </span>
            </a>
          </td>
          <td>{assetCell(d.asset_id)}</td>
          <td
            className={d.expires_at && Date.parse(d.expires_at) < Date.now() ? 'overdue-text' : ''}
          >
            {date(d.expires_at)}
          </td>
          <td>
            <Badge value={d.review_status} />
          </td>
          <td>
            <div className="row-actions">
              {can('manager') && !d.superseded_by && (
                <>
                  <button className="text-button" onClick={() => reviewDocument(d)}>
                    {t('Проверить документ')}
                  </button>
                  <button
                    className="text-button"
                    onClick={() => setModal({ kind: 'document', assetId: d.asset_id, previous: d })}
                  >
                    {t('Продлить документ')}
                  </button>
                </>
              )}
            </div>
          </td>
        </tr>
      ))}
    </Table>
  );
  const narrowList = (rows: Row[]) =>
    rows.filter(
      (r) =>
        match({ ...r, asset: assetById(r.asset_id), person: person(r.assignee_id) }) &&
        (!onlyMine || r.assignee_id === state?.user.id) &&
        (!listStatus || r.status === listStatus),
    );
  const listTools = (statuses: string[]) => (
    <div className="filterbar">
      <div className="input-search">
        <Search size={17} />
        <input
          placeholder={t('Найти объект')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <select value={listStatus} onChange={(e) => setListStatus(e.target.value)}>
        <option value="">{t('Все статусы')}</option>
        {choices(statuses).map((c) => (
          <option value={c.value} key={c.value}>
            {t(c.label)}
          </option>
        ))}
      </select>
      {['inspections', 'works', 'mine'].includes(page) && (
        <label className="check-field">
          <input
            type="checkbox"
            checked={onlyMine}
            onChange={(e) => setOnlyMine(e.target.checked)}
          />
          {t('Только мои')}
        </label>
      )}
    </div>
  );
  if (loading)
    return (
      <div className="boot">
        <Logo />
        <Loader2 size={26} className="spin" />
        <p>{t('Подключение…')}</p>
      </div>
    );
  if (!state)
    return (
      <Locale.Provider value={lang}>
        <div className="login-page">
          <div className="login-story">
            <Logo />
            <div className="login-copy">
              <span>AD ASSET MAP / 01</span>
              <h1>
                {lang === 'ru' ? (
                  <>
                    Город большой.
                    <br />
                    Всё — на карте.
                  </>
                ) : (
                  <>
                    Қала үлкен.
                    <br />
                    Барлығы картада.
                  </>
                )}
              </h1>
              <p>{t('Управляйте городской рекламной инфраструктурой.')}</p>
              <div className="login-network">
                <i />
                <i />
                <i />
                <i />
                <i />
                <MapPin size={50} />
                <span>43.2389° N / 76.8897° E</span>
              </div>
            </div>
            <small>Карта · Осмотры · Обслуживание</small>
          </div>
          <div className="login-panel">
            <button
              className="language login-lang"
              onClick={() => setLang(lang === 'ru' ? 'kk' : 'ru')}
            >
              {lang === 'ru' ? 'Қазақша' : 'Русский'}
            </button>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setAuthError('');
                const data = new FormData(e.currentTarget);
                try {
                  const r = await fetch('/api/auth', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(Object.fromEntries(data)),
                  });
                  const body = await r.json();
                  if (!r.ok) throw new Error(body.error);
                  await load();
                } catch (err) {
                  setAuthError((err as Error).message);
                }
              }}
            >
              <span className="login-symbol">
                <ShieldCheck size={27} />
              </span>
              <h2>{t('Вход в рабочее пространство')}</h2>
              <p>AdAsset · Qala</p>
              <label>
                <span>Email</span>
                <input
                  name="email"
                  type="email"
                  autoComplete="username"
                  defaultValue="admin@adasset.local"
                  required
                />
              </label>
              <label>
                <span>{t('Пароль')}</span>
                <input name="password" type="password" autoComplete="current-password" required />
              </label>
              {authError && (
                <div className="error-box" role="alert">
                  {authError}
                </div>
              )}
              <button className="button login-submit">
                {t('Войти')}
                <ArrowRight size={17} />
              </button>
              <small className="login-help">
                {lang === 'ru'
                  ? 'Локальные данные для входа — в файле .local-access.txt в папке проекта.'
                  : 'Жергілікті кіру деректері жоба қалтасындағы .local-access.txt файлында.'}
              </small>
            </form>
            <small className="login-footer">AdAsset Map · Operations platform</small>
          </div>
        </div>
      </Locale.Provider>
    );
  const body = () => {
    switch (page) {
      case 'overview':
        return (
          <>
            {pageHeader(
              'Все объекты под контролем',
              'Состояние сети, ближайшие работы и точки внимания.',
              <div className="today">
                <CalendarDays size={16} />
                {date(new Date().toISOString())}
              </div>,
            )}
            <div className="stats-grid">
              {[
                [
                  'Действующие объекты',
                  active.length,
                  PanelsTopLeft,
                  'blue',
                  () => {
                    changePage('assets');
                    setFilters({});
                  },
                  'Вся сеть',
                ],
                [
                  'Требуют внимания',
                  active.filter((a: Row) =>
                    ['critical', 'repair', 'remarks'].includes(a.technical_state),
                  ).length,
                  TriangleAlert,
                  'orange',
                  () => {
                    changePage('assets');
                    setFilters({ defects: true });
                  },
                  `${active.filter((a: Row) => a.technical_state === 'critical').length} · ${t('Критическое состояние')}`,
                ],
                [
                  'Просроченные осмотры',
                  active.filter((a: Row) => a.inspection_state === 'overdue').length,
                  ClipboardCheck,
                  'purple',
                  () => {
                    changePage('assets');
                    setFilters({ overdue: true });
                  },
                  'Осмотры',
                ],
                [
                  'Активные задания',
                  state.work_orders.filter((w: Row) => !terminalWork(w)).length,
                  Wrench,
                  'green',
                  () => changePage('works'),
                  `${state.work_orders.filter((w: Row) => w.status === 'review').length} · ${t('На проверку')}`,
                ],
              ].map(([label, value, Icon, color, fn, note]: any) => (
                <button className="stat-card" key={label} onClick={fn}>
                  <div className="stat-top">
                    <span>{t(label)}</span>
                    <i className={color}>
                      <Icon size={18} />
                    </i>
                  </div>
                  <strong>{String(value).padStart(2, '0')}</strong>
                  <div className="stat-bottom">
                    <span>{t(note)}</span>
                    <ArrowUpRight size={16} />
                  </div>
                </button>
              ))}
            </div>
            <div className="overview-grid">
              <section className="panel map-panel">
                <div className="panel-heading">
                  <div>
                    <h2>
                      {t('Карта конструкций')}
                      <span className="count">Алматы</span>
                    </h2>
                    <p>
                      {active.length} {t('Объекты').toLowerCase()} · {state.tenant.name}
                    </p>
                  </div>
                  <button className="text-button" onClick={() => changePage('map')}>
                    {t('Открыть карту')}
                    <ArrowUpRight size={16} />
                  </button>
                </div>
                <MapView assets={active} onSelect={openAsset} t={t} />
              </section>
              <section className="panel attention-panel">
                <div className="panel-heading">
                  <h2>{t('Требуют решения')}</h2>
                  <span className="count alert-count">
                    {state.defects.filter(openDefect).length}
                  </span>
                </div>
                {state.defects
                  .filter(openDefect)
                  .sort(
                    (a: Row, b: Row) =>
                      (a.severity === 'critical' ? -1 : 1) - (b.severity === 'critical' ? -1 : 1),
                  )
                  .slice(0, 3)
                  .map((d: Row) => (
                    <button
                      className="attention-item"
                      key={d.id}
                      onClick={() => {
                        openAsset(assetById(d.asset_id));
                        setAssetTab('Дефекты');
                      }}
                    >
                      <span className={`attention-icon ${d.severity}`}>
                        <TriangleAlert size={18} />
                      </span>
                      <div>
                        <span className="attention-meta">
                          {assetById(d.asset_id)?.number}
                          <Badge value={d.severity} />
                        </span>
                        <strong>{d.description}</strong>
                        <small>
                          <MapPin size={12} />
                          {assetById(d.asset_id)?.address}
                        </small>
                      </div>
                      <ChevronRight size={16} />
                    </button>
                  ))}
                <div className="document-callout">
                  <div>
                    <Files size={20} />
                    <strong>{t('Сроки документов')}</strong>
                  </div>
                  <p>
                    {active.filter((a: Row) => a.document_state !== 'valid').length} ·{' '}
                    {t('Требуют внимания')}
                  </p>
                  <button className="text-button" onClick={() => changePage('documents')}>
                    {t('Открыть')}
                    <ArrowRight size={14} />
                  </button>
                </div>
                <div className="network-summary">
                  <span>
                    <i className="pulse" />
                    {t('Состояние сети')}
                  </span>
                  <strong>
                    {Math.round(
                      (active.filter((a: Row) => a.technical_state === 'healthy').length /
                        Math.max(1, active.length)) *
                        100,
                    )}
                    %
                  </strong>
                  <div className="network-bar">
                    {['healthy', 'remarks', 'repair', 'critical', 'unknown'].map((s) => (
                      <i
                        key={s}
                        className={s}
                        style={{
                          flex: active.filter((a: Row) => a.technical_state === s).length || 0.01,
                        }}
                      />
                    ))}
                  </div>
                  <small>
                    {t('Исправно')} / {t('Действующие объекты')}
                  </small>
                </div>
              </section>
            </div>
            <section className="panel">
              <div className="panel-heading">
                <h2>
                  {t('Приоритетные работы')}
                  <span className="count">
                    {state.work_orders.filter((w: Row) => !terminalWork(w)).length}
                  </span>
                </h2>
                <button className="text-button" onClick={() => changePage('works')}>
                  {t('Все задания')}
                  <ArrowRight size={16} />
                </button>
              </div>
              {workTable(
                state.work_orders
                  .filter((w: Row) => !terminalWork(w))
                  .sort((a: Row, b: Row) => Date.parse(a.due_at) - Date.parse(b.due_at))
                  .slice(0, 5),
              )}
            </section>
          </>
        );
      case 'map':
        return (
          <>
            {pageHeader(
              'Карта конструкций',
              'Вся сеть',
              can('manager')
                ? addButton('Добавить объект', () => setModal({ kind: 'asset' }))
                : undefined,
            )}
            {filterBar}
            <div className="map-workspace">
              <aside className="map-list">
                <div className="map-list-head">
                  <strong>{t('Объекты')}</strong>
                  <span>{filtered.length}</span>
                </div>
                {filtered.length ? (
                  filtered.map((a: Row) => (
                    <button
                      key={a.id}
                      className={`map-list-item ${assetId === a.id ? 'selected' : ''}`}
                      onClick={() => openAsset(a)}
                    >
                      <div>
                        <strong>{a.number}</strong>
                        <Badge value={a.technical_state} />
                      </div>
                      <h3>{a.name}</h3>
                      <p>
                        <MapPin size={13} />
                        {a.address}
                      </p>
                      <small>
                        {a.type} · {a.district}
                      </small>
                    </button>
                  ))
                ) : (
                  <Empty />
                )}
              </aside>
              <MapView
                assets={filtered}
                onSelect={openAsset}
                selected={assetId || undefined}
                t={t}
              />
            </div>
          </>
        );
      case 'assets':
        return (
          <>
            {pageHeader(
              'Реестр объектов',
              'Объекты',
              <>
                {exportButton('assets')}
                {can('manager') && addButton('Добавить объект', () => setModal({ kind: 'asset' }))}
              </>,
            )}
            {filterBar}
            <section className="panel">
              {filtered.length ? assetTable(filtered) : <Empty />}
            </section>
          </>
        );
      case 'inspections':
        return (
          <>
            {pageHeader(
              'Осмотры',
              'План осмотров',
              can('manager', 'dispatcher')
                ? addButton('Назначить осмотр', () => planInspection())
                : undefined,
            )}
            {listTools(['scheduled', 'completed', 'cancelled'])}
            <section className="panel">
              {inspectionTable(
                narrowList(state.inspections).sort(
                  (a: Row, b: Row) => Date.parse(a.due_at) - Date.parse(b.due_at),
                ),
              )}
            </section>
          </>
        );
      case 'defects':
        return (
          <>
            {pageHeader(
              'Дефекты',
              'Открытые дефекты',
              can('manager', 'dispatcher', 'inspector', 'technician')
                ? addButton('Сообщить о проблеме', () => chooseAsset('defect'))
                : undefined,
            )}
            {listTools([
              'registered',
              'review',
              'confirmed',
              'in_progress',
              'verification',
              'closed',
              'rejected',
              'duplicate',
            ])}
            <section className="panel">{defectTable(narrowList(state.defects))}</section>
          </>
        );
      case 'works':
      case 'mine':
        return (
          <>
            {pageHeader(
              page === 'mine' ? 'Мои задания' : 'Задания',
              'Работы',
              <>
                {can('manager', 'dispatcher', 'leader', 'observer') && exportButton('works')}
                {can('dispatcher') && addButton('Создать задание', () => createWork())}
              </>,
            )}
            {listTools([
              'assigned',
              'accepted',
              'in_progress',
              'paused',
              'review',
              'completed',
              'rework',
              'cancelled',
            ])}
            <section className="panel">
              {workTable(
                narrowList(state.work_orders).filter(
                  (w: Row) => page !== 'mine' || w.assignee_id === state.user.id,
                ),
              )}
            </section>
            {page === 'mine' && (
              <section className="panel">
                <div className="panel-heading">
                  <h2>{t('Осмотры')}</h2>
                </div>
                {inspectionTable(
                  state.inspections.filter((i: Row) => i.assignee_id === state.user.id),
                )}
              </section>
            )}
          </>
        );
      case 'documents':
        return (
          <>
            {pageHeader(
              'Документы',
              'Сроки документов',
              can('manager')
                ? addButton('Новый документ', () => chooseAsset('document'))
                : undefined,
            )}
            {listTools([])}
            <section className="panel">
              {documentTable(state.asset_documents.filter(match))}
            </section>
            <div className="note">
              {lang === 'ru'
                ? 'Статусы документов отражают учёт компании и не являются юридическим заключением.'
                : 'Құжат мәртебесі компания есебін көрсетеді және заңды қорытынды емес.'}
            </div>
          </>
        );
      case 'organizations':
        return (
          <>
            {pageHeader(
              'Организации',
              'Владельцы и обслуживание',
              can('manager')
                ? addButton('Новая организация', () =>
                    form('Новая организация', 'organization.create', [
                      input('name', 'Название'),
                      select(
                        'kind',
                        'Тип',
                        [
                          { value: 'owner', label: 'Владелец' },
                          { value: 'service', label: 'Обслуживающая организация' },
                          { value: 'both', label: 'Владелец + обслуживание' },
                        ],
                        'owner',
                      ),
                      input('contact', 'Контакт', '', 'text', false),
                    ]),
                  )
                : undefined,
            )}
            <div className="organization-grid">
              {state.organizations.map((o: Row) => (
                <article className="panel organization-card" key={o.id}>
                  <span className="org-logo">
                    <Building2 size={26} />
                  </span>
                  <h2>{o.name}</h2>
                  <p>{o.contact}</p>
                  <div>
                    <strong>
                      {
                        state.assets.filter(
                          (a: Row) => a.owner_id === o.id || a.service_id === o.id,
                        ).length
                      }
                    </strong>
                    <span>{t('Объекты')}</span>
                  </div>
                  <button
                    className="text-button"
                    onClick={() => {
                      changePage('assets');
                      setFilters(o.kind === 'service' ? { service_id: o.id } : { owner_id: o.id });
                    }}
                  >
                    {t('Реестр объектов')}
                    <ArrowUpRight size={16} />
                  </button>
                </article>
              ))}
            </div>
          </>
        );
      case 'team':
        return (
          <>
            {pageHeader(
              'Команда',
              'Сотрудники',
              can()
                ? addButton('Новый сотрудник', () => setModal({ kind: 'profileCreate' }))
                : undefined,
            )}
            <section className="panel">
              <Table headers={['Имя', 'Роли', 'Статус', 'Действия']}>
                {state.profiles.map((p: Row) => (
                  <tr key={p.id}>
                    <td>
                      <div className="person-row">
                        <span className="avatar">
                          {p.name
                            .split(' ')
                            .map((x: string) => x[0])
                            .slice(0, 2)
                            .join('')}
                        </span>
                        <div>
                          <strong>{p.name}</strong>
                          <small>{p.email}</small>
                        </div>
                      </div>
                    </td>
                    <td>{p.roles.map((r: string) => fmtStatus(r)).join(', ')}</td>
                    <td>{p.active ? t('Активен') : '—'}</td>
                    <td>
                      {can() && (
                        <button
                          className="text-button"
                          onClick={() => setModal({ kind: 'profileEdit', profile: p })}
                        >
                          {t('Изменить доступ')}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </Table>
            </section>
            <div className="section-title">
              <h2>{t('Бригада')}</h2>
              {can() && addButton('Новая бригада', () => setModal({ kind: 'team' }))}
            </div>
            <div className="organization-grid">
              {state.teams.map((team: Row) => (
                <article className="panel organization-card" key={team.id}>
                  <Users size={25} />
                  <h2>{team.name}</h2>
                  <p>{team.area}</p>
                  {state.team_members
                    .filter((m: Row) => m.team_id === team.id)
                    .map((m: Row) => (
                      <span key={m.user_id}>{person(m.user_id)}</span>
                    ))}
                  {can() && (
                    <button
                      className="text-button"
                      onClick={() => setModal({ kind: 'team', team })}
                    >
                      {t('Редактировать')}
                    </button>
                  )}
                </article>
              ))}
            </div>
          </>
        );
      case 'reports':
        return <Reports state={state} t={t} currency={currency} exportButton={exportButton} />;
      case 'notifications':
        return (
          <>
            {pageHeader(
              'Уведомления',
              'Последние события',
              <button
                className="button secondary"
                onClick={() => attempt('notification.read', { all: true })}
              >
                <Check size={16} />
                {t('Отметить все прочитанными')}
              </button>,
            )}
            <section className="panel notification-list">
              {state.notifications.length ? (
                state.notifications.map((n: Row) => (
                  <button
                    className={n.read_at ? '' : 'unread'}
                    key={n.id}
                    onClick={() => {
                      attempt('notification.read', { id: n.id });
                      if (n.asset_id) openAsset(assetById(n.asset_id));
                    }}
                  >
                    <span className="notification-icon">
                      <Bell size={20} />
                    </span>
                    <div>
                      <strong>{n.title}</strong>
                      <small>{date(n.created_at, true)}</small>
                    </div>
                    {!n.read_at && <i />}
                    <ChevronRight size={18} />
                  </button>
                ))
              ) : (
                <Empty />
              )}
            </section>
          </>
        );
      case 'settings':
        return (
          <>
            {pageHeader('Настройки', 'Настройки компании')}
            <div className="settings-grid">
              <section className="panel settings-card">
                <h2>{state.tenant.name}</h2>
                <dl>
                  <dt>{t('Часовой пояс')}</dt>
                  <dd>{state.tenant.timezone}</dd>
                  <dt>{t('Напоминания, дней')}</dt>
                  <dd>{state.tenant.settings.reminder_days.join(', ')}</dd>
                  <dt>{t('Email не подключён')}</dt>
                  <dd>—</dd>
                </dl>
                {can() && (
                  <button
                    className="button"
                    onClick={() =>
                      form('Настройки компании', 'settings.save', [
                        input('name', 'Название оператора', state.tenant.name),
                        input('timezone', 'Часовой пояс', state.tenant.timezone),
                        input(
                          'reminder_days',
                          'Напоминания, дней',
                          state.tenant.settings.reminder_days.join(', '),
                        ),
                        input(
                          'districts',
                          'Районы через запятую',
                          state.tenant.settings.districts.join(', '),
                        ),
                      ])
                    }
                  >
                    {t('Редактировать')}
                  </button>
                )}
                <p className="note">
                  {lang === 'ru'
                    ? 'Напоминания проверяются сервером каждую минуту, пока приложение запущено.'
                    : 'Қолданба жұмыс істеп тұрғанда сервер еске салуларды минут сайын тексереді.'}
                </p>
                {can() && (
                  <button className="button secondary" onClick={() => attempt('scheduler.run', {})}>
                    <RefreshCw size={15} />
                    {t('Проверить напоминания')}
                  </button>
                )}
              </section>
              <section className="panel settings-card">
                <h2>{t('Справочники')}</h2>
                <div className="tags">
                  {state.asset_types.map((a: Row) => (
                    <span key={a.id}>{a.name}</span>
                  ))}
                </div>
                {can() && (
                  <div className="stack-actions">
                    {addButton('Добавить тип конструкции', () =>
                      form(
                        'Добавить тип конструкции',
                        'dictionary.create',
                        [input('name', 'Название')],
                        { table: 'asset_types' },
                      ),
                    )}
                    {addButton('Добавить тип документа', () =>
                      form(
                        'Добавить тип документа',
                        'dictionary.create',
                        [input('name', 'Название')],
                        { table: 'document_types' },
                      ),
                    )}
                  </div>
                )}
              </section>
              <section className="panel settings-card">
                <h2>{t('Обязательные документы')}</h2>
                {state.document_requirements.map((r: Row) => (
                  <p key={r.id}>
                    {r.asset_type} → {r.document_type}
                  </p>
                ))}
                {can() &&
                  addButton('Добавить требование', () =>
                    form('Добавить требование', 'requirement.create', [
                      select(
                        'asset_type',
                        'Тип',
                        state.asset_types.map((r: Row) => ({ value: r.name, label: r.name })),
                      ),
                      select(
                        'document_type',
                        'Документы',
                        state.document_types.map((r: Row) => ({ value: r.name, label: r.name })),
                      ),
                      input('basis', 'Основание', '', 'textarea'),
                    ]),
                  )}
              </section>
              <section className="panel settings-card">
                <h2>{t('Шаблон')}</h2>
                {state.inspection_template_versions.map((r: Row) => (
                  <div key={r.id}>
                    <strong>
                      {r.name} · v{r.version}
                    </strong>
                    <ol>
                      {state.inspection_template_items
                        .filter((i: Row) => i.template_id === r.id)
                        .map((i: Row) => (
                          <li key={i.id}>{i.name}</li>
                        ))}
                    </ol>
                  </div>
                ))}
                {can() &&
                  addButton('Новая версия чек-листа', () =>
                    form('Новая версия чек-листа', 'template.create', [
                      input('name', 'Название'),
                      input('items', 'Пункты, каждый с новой строки', '', 'textarea'),
                    ]),
                  )}
              </section>
            </div>
          </>
        );
      case 'audit':
        return (
          <>
            {pageHeader('Аудит', 'История')}
            <section className="panel">
              {can() ? (
                <Table headers={['Дата', 'Сотрудники', 'Действия', 'Описание']}>
                  {state.audit_logs.map((a: Row) => (
                    <tr key={a.id}>
                      <td>{date(a.created_at, true)}</td>
                      <td>{person(a.actor_id)}</td>
                      <td>
                        <code>{a.action}</code>
                      </td>
                      <td>
                        <small>
                          {JSON.stringify(a).includes('demo.seed')
                            ? 'Созданы демонстрационные данные'
                            : Object.entries(a)
                                .filter(
                                  ([k]) =>
                                    ![
                                      'id',
                                      'tenant_id',
                                      'actor_id',
                                      'action',
                                      'entity_id',
                                      'created_at',
                                      'data',
                                    ].includes(k),
                                )
                                .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
                                .join(' · ')}
                        </small>
                      </td>
                    </tr>
                  ))}
                </Table>
              ) : (
                <Empty text={lang === 'ru' ? 'Доступно администратору' : 'Әкімшіге қолжетімді'} />
              )}
            </section>
          </>
        );
      case 'profile':
        return (
          <>
            {pageHeader('Профиль', 'Рабочее пространство')}
            <section className="panel settings-card">
              <h2>{state.user.name}</h2>
              <p>{state.user.email}</p>
              <p>{state.user.roles.map(fmtStatus).join(', ')}</p>
              <button className="button secondary" onClick={logout}>
                <LogOut size={16} />
                {t('Выйти')}
              </button>
            </section>
          </>
        );
      default:
        return null;
    }
  };
  const assetBody = (a: Row) => {
    const related = (table: string) => state[table].filter((r: Row) => r.asset_id === a.id);
    switch (assetTab) {
      case 'Обзор':
        return (
          <>
            <div className="asset-state-grid">
              {[
                ['Техническое состояние', a.technical_state],
                ['Состояние карточки', a.card_status],
                ['Жизненный цикл', a.lifecycle],
                ['Актуальность осмотра', a.inspection_state],
                ['Состояние документов', a.document_state],
              ].map(([l, v]) => (
                <div key={l}>
                  <small>{t(l)}</small>
                  <Badge value={v} />
                </div>
              ))}
            </div>
            <dl className="asset-facts">
              {[
                ['Адрес', a.address],
                ['Город', a.city],
                ['Район', a.district],
                ['Тип', a.type],
                ['Владелец', organization(a.owner_id)],
                ['Обслуживающая организация', organization(a.service_id)],
                ['Ответственный', person(a.responsible_id)],
                ['Ширина', `${a.width || '—'} ${a.unit || 'м'}`],
                ['Высота', `${a.height || '—'} ${a.unit || 'м'}`],
                ['Материал', a.material || '—'],
                ['Доступ к объекту', a.access || '—'],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt>{t(k)}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
            <p className="muted">{a.description}</p>
            <div className="inline-actions">
              <a
                className="button secondary small"
                href={`https://www.google.com/maps/dir/?api=1&destination=${a.latitude},${a.longitude}`}
                target="_blank"
                rel="noreferrer"
              >
                <MapPin size={15} />
                {t('Построить маршрут')}
              </a>
              <button
                className="button secondary small"
                onClick={() => setModal({ kind: 'qr', asset: a })}
              >
                <QrCode size={15} />
                {t('QR-код объекта')}
              </button>
            </div>
            {can('manager') && (
              <div className="asset-admin-actions">
                <button
                  className="button secondary"
                  onClick={() => setModal({ kind: 'asset', asset: a })}
                >
                  {t('Редактировать')}
                </button>
                {['draft', 'returned'].includes(a.card_status) && (
                  <button
                    className="button"
                    onClick={() => attempt('asset.submit', { id: a.id, version: a.version })}
                  >
                    {t('Отправить на проверку')}
                  </button>
                )}
                {a.card_status === 'pending' && (
                  <button
                    className="button"
                    onClick={() =>
                      form(
                        'Проверить карточку',
                        'asset.review',
                        [
                          select('status', 'Статус', choices(['approved', 'returned']), 'approved'),
                          input('reason', 'Причина', '', 'textarea', false),
                        ],
                        { id: a.id, version: a.version },
                      )
                    }
                  >
                    {t('Проверить карточку')}
                  </button>
                )}
                <button
                  className="text-button"
                  onClick={() => setModal({ kind: 'lifecycle', asset: a })}
                >
                  {t('Изменить жизненный цикл')}
                </button>
                <button
                  className="text-button"
                  onClick={() =>
                    form(
                      'Перенести объект',
                      'asset.move',
                      [
                        input('latitude', 'Широта', String(a.latitude), 'number'),
                        input('longitude', 'Долгота', String(a.longitude), 'number'),
                        input('address', 'Адрес', a.address),
                        input('reason', 'Причина', '', 'textarea'),
                      ],
                      { id: a.id, version: a.version },
                    )
                  }
                >
                  {t('Перенести объект')}
                </button>
                {a.lifecycle === 'dismantled' && a.card_status !== 'archived' && (
                  <button
                    className="text-button"
                    onClick={() => attempt('asset.archive', { id: a.id, version: a.version })}
                  >
                    {t('Архивировать')}
                  </button>
                )}
              </div>
            )}
          </>
        );
      case 'Поверхности':
        return (
          <>
            {related('asset_surfaces').map((s: Row) => (
              <div className="surface-card" key={s.id}>
                <Layers size={26} />
                <div>
                  <h3>
                    {t('Поверхность')} {s.name}
                  </h3>
                  <p>
                    {s.description ||
                      `${s.width || a.width || '—'} × ${s.height || a.height || '—'} ${s.unit || a.unit || 'м'}`}
                  </p>
                </div>
              </div>
            ))}
            {can('manager') &&
              addButton('Добавить поверхность', () =>
                form(
                  'Добавить поверхность',
                  'surface.create',
                  [
                    input('name', 'Название'),
                    input('description', 'Описание', '', 'textarea', false),
                  ],
                  { asset_id: a.id },
                ),
              )}
          </>
        );
      case 'Фотографии':
        return (
          <>
            <div className="gallery">
              {related('asset_photos').map((p: Row) => (
                <figure key={p.id}>
                  <a href={`/api/files/${p.attachment_id}`} target="_blank">
                    <img src={`/api/files/${p.attachment_id}`} alt={p.caption || a.name} />
                  </a>
                  <figcaption>{p.caption || p.stage}</figcaption>
                </figure>
              ))}
            </div>
            {can('manager', 'inspector', 'technician') && (
              <Upload
                assetId={a.id}
                images
                onUploaded={(f) =>
                  attempt('photo.add', {
                    asset_id: a.id,
                    attachment_id: f.id,
                    caption: f.name,
                    stage: 'overview',
                  })
                }
              />
            )}
          </>
        );
      case 'Документы':
        return (
          <>
            {can('manager') &&
              addButton('Новый документ', () => setModal({ kind: 'document', assetId: a.id }))}
            {documentTable(related('asset_documents'))}
          </>
        );
      case 'Осмотры':
        return (
          <>
            {can('manager', 'dispatcher') && (
              <div className="inline-actions">
                {addButton('Назначить осмотр', () => planInspection(a))}
                <button className="button secondary" onClick={() => planRecurring(a)}>
                  {t('План осмотров')}
                </button>
              </div>
            )}
            {related('inspection_plans').map((p: Row) => (
              <div className="note" key={p.id}>
                <CalendarDays size={16} />
                {p.interval_days} д. · {date(p.next_due)} ·{' '}
                {t(p.rule === 'fixed' ? 'Фиксированный график' : 'От завершения')}
              </div>
            ))}
            {inspectionTable(related('inspections'))}
          </>
        );
      case 'Дефекты':
        return (
          <>
            {can('manager', 'dispatcher', 'inspector', 'technician') &&
              addButton('Сообщить о проблеме', () => setModal({ kind: 'defect', assetId: a.id }))}
            {defectTable(related('defects'))}
          </>
        );
      case 'Работы':
        return (
          <>
            {can('dispatcher') && addButton('Создать задание', () => createWork(a))}
            {workTable(related('work_orders'))}
          </>
        );
      case 'История':
        return (
          <div className="timeline">
            {related('status_history')
              .sort((x: Row, y: Row) => Date.parse(y.created_at) - Date.parse(x.created_at))
              .map((h: Row) => (
                <article key={h.id}>
                  <i />
                  <div>
                    <small>
                      {date(h.created_at, true)} · {person(h.actor_id)}
                    </small>
                    <strong>{h.action}</strong>
                    <p>
                      {Object.entries(h)
                        .filter(([k]) =>
                          [
                            'reason',
                            'text',
                            'note',
                            'status',
                            'from',
                            'to',
                            'description',
                            'outcome',
                          ].includes(k),
                        )
                        .map(([, v]) => String(v))
                        .join(' · ')}
                    </p>
                  </div>
                </article>
              ))}
            {!related('status_history').length && (
              <Empty
                text={
                  lang === 'ru'
                    ? 'История появится после первого изменения'
                    : 'Тарих алғашқы өзгерістен кейін пайда болады'
                }
              />
            )}
          </div>
        );
    }
  };
  return (
    <Locale.Provider value={lang}>
      <div className="app-shell">
        <aside className={`sidebar ${menu ? 'open' : ''}`}>
          <Logo />
          <button className="workspace-selector" onClick={() => changePage('settings')}>
            <span className="workspace-avatar">Q</span>
            <span>
              <strong>Qala Operations</strong>
              <small>{t('Рабочее пространство')}</small>
            </span>
            <ChevronDown size={15} />
          </button>
          <nav>
            {nav
              .filter(([id]) => id !== 'audit' || can())
              .map(([id, label, Icon], i) => (
                <div key={id}>
                  {[0, 3, 10].includes(i) && (
                    <div className="nav-section">
                      {t(i === 0 ? 'Рабочее пространство' : i === 3 ? 'Управление' : 'Система')}
                    </div>
                  )}
                  <button className={page === id ? 'active' : ''} onClick={() => changePage(id)}>
                    <Icon size={19} />
                    <span>{t(label)}</span>
                    {id === 'defects' && (
                      <b className="nav-count">{state.defects.filter(openDefect).length}</b>
                    )}
                    {id === 'notifications' && unread > 0 && <b className="nav-count">{unread}</b>}
                    {id === 'overview' && <i />}
                  </button>
                </div>
              ))}
          </nav>
          <div className="sidebar-bottom">
            {state.tenant.settings.demo && (
              <div className="demo-label">
                <span className="pulse" />
                {t('Демонстрационные данные')}
              </div>
            )}
            <button className="profile-button" onClick={() => changePage('profile')}>
              <span className="avatar">{state.user.name.slice(0, 2).toUpperCase()}</span>
              <span>
                <strong>{state.user.name}</strong>
                <small>{fmtStatus(state.user.roles[0])}</small>
              </span>
              <ChevronRight size={16} />
            </button>
          </div>
        </aside>
        {menu && <div className="sidebar-backdrop" onClick={() => setMenu(false)} />}
        <div className="main-shell">
          <header className="topbar">
            <button
              className="icon-button mobile-menu"
              aria-label="Menu"
              onClick={() => setMenu(!menu)}
            >
              <Menu size={22} />
            </button>
            <div className="breadcrumbs">
              <span>Qala Operations</span>
              <ChevronRight size={14} />
              <strong>{t(nav.find(([id]) => id === page)?.[1] || 'Мои задания')}</strong>
            </div>
            <div className="topbar-actions">
              <span className="system-online">
                <i className="pulse" />
                {lang === 'ru' ? 'Система активна' : 'Жүйе белсенді'}
              </span>
              <button
                className="language"
                onClick={() => {
                  const next = lang === 'ru' ? 'kk' : 'ru';
                  setLang(next);
                  localStorage.setItem('adasset:lang', next);
                  document.documentElement.lang = next;
                }}
              >
                {lang === 'ru' ? 'RU' : 'KZ'}
                <ChevronDown size={12} />
              </button>
              <button
                className="icon-button notification-button"
                aria-label={t('Уведомления')}
                onClick={() => changePage('notifications')}
              >
                <Bell size={20} />
                {unread > 0 && <i />}
              </button>
              <button
                className="avatar small-avatar"
                aria-label={t('Профиль')}
                onClick={() => changePage('profile')}
              >
                {state.user.name.slice(0, 2).toUpperCase()}
              </button>
            </div>
          </header>
          <main className={`main-content page-${page}`}>
            {body()}
            <footer className="main-footer">
              <span>
                AdAsset Map <i />{' '}
                {state.tenant.settings.demo
                  ? t('Все объекты и организации вымышлены.')
                  : state.tenant.name}
              </span>
              <span>© 2026 · Qala Operations</span>
            </footer>
          </main>
        </div>
        <nav className="mobile-nav">
          {[
            ['mine', 'Мои задания', ClipboardCheck],
            ['map', 'Карта', MapIcon],
            ['qr', 'Сканировать QR', ScanLine],
            ['defect', 'Сообщить о проблеме', Plus],
            ['profile', 'Профиль', Users],
          ].map(([id, l, I]: any) => (
            <button
              key={id}
              className={page === id ? 'active' : ''}
              onClick={() =>
                id === 'qr'
                  ? setModal({ kind: 'scan' })
                  : id === 'defect'
                    ? chooseAsset('defect')
                    : changePage(id)
              }
            >
              <I size={20} />
              <span>{t(l)}</span>
            </button>
          ))}
        </nav>
        {selectedAsset && (
          <div
            className="drawer-backdrop"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) setAssetId(null);
            }}
          >
            <aside className="asset-drawer" role="dialog" aria-label={selectedAsset.name}>
              <div className="drawer-head">
                <span className="eyebrow">
                  {selectedAsset.number} / {t('Объект')}
                </span>
                <button
                  className="icon-button"
                  aria-label={t('Закрыть')}
                  onClick={() => setAssetId(null)}
                >
                  <X size={22} />
                </button>
              </div>
              <div className="asset-cover">
                {state.asset_photos.find((p: Row) => p.asset_id === selectedAsset.id) && (
                  <img
                    src={`/api/files/${state.asset_photos.find((p: Row) => p.asset_id === selectedAsset.id).attachment_id}`}
                    alt={selectedAsset.name}
                  />
                )}
                {selectedAsset.demo && <span>{t('Демонстрационные данные')}</span>}
              </div>
              <div className="asset-title">
                <h2>{selectedAsset.name}</h2>
                <p>
                  <MapPin size={15} />
                  {selectedAsset.address} · {selectedAsset.city}
                </p>
              </div>
              <div className="asset-tabs">
                {[
                  'Обзор',
                  'Поверхности',
                  'Фотографии',
                  'Документы',
                  'Осмотры',
                  'Дефекты',
                  'Работы',
                  'История',
                ].map((tab) => (
                  <button
                    className={assetTab === tab ? 'active' : ''}
                    key={tab}
                    onClick={() => setAssetTab(tab)}
                  >
                    {t(tab)}
                  </button>
                ))}
              </div>
              <div className="asset-body">{assetBody(selectedAsset)}</div>
            </aside>
          </div>
        )}
        {modal && (
          <ModalRouter
            modal={modal}
            state={state}
            setModal={setModal}
            run={run}
            t={t}
            date={date}
            form={form}
            createWork={createWork}
            openAsset={openAsset}
            workActions={workActions}
            doLogout={doLogout}
          />
        )}
        {toast && (
          <div className="toast" role="status">
            <CheckCircle2 size={18} />
            <span>{toast}</span>
            <button aria-label={t('Закрыть')} onClick={() => setToast('')}>
              <X size={16} />
            </button>
          </div>
        )}
      </div>
    </Locale.Provider>
  );
}
function ModalRouter({
  modal: m,
  state,
  setModal,
  run,
  t,
  date,
  form,
  createWork,
  openAsset,
  workActions,
  doLogout,
}: any) {
  const close = useCallback(() => setModal(null), [setModal]);
  if (m.kind === 'asset')
    return <AssetEditor state={state} asset={m.asset} run={run} onClose={close} />;
  if (m.kind === 'inspection')
    return <InspectionEditor state={state} inspection={m.inspection} run={run} onClose={close} />;
  if (m.kind === 'defect')
    return <DefectEditor state={state} assetId={m.assetId} run={run} onClose={close} />;
  if (m.kind === 'document')
    return (
      <DocumentEditor
        state={state}
        assetId={m.assetId}
        previous={m.previous}
        run={run}
        onClose={close}
      />
    );
  if (['workReport', 'workReview'].includes(m.kind))
    return (
      <WorkEditor
        state={state}
        work={m.work}
        review={m.kind === 'workReview'}
        run={run}
        onClose={close}
      />
    );
  if (m.kind === 'workCreate')
    return (
      <WorkCreate state={state} asset={m.asset} defect={m.defect} run={run} onClose={close} t={t} />
    );
  if (['profileCreate', 'profileEdit', 'team'].includes(m.kind))
    return <PeopleEditor state={state} modal={m} run={run} onClose={close} t={t} />;
  if (m.kind === 'lifecycle')
    return <LifecycleEditor state={state} asset={m.asset} run={run} onClose={close} t={t} />;
  if (m.kind === 'form')
    return (
      <FormDialog
        title={m.title}
        fields={m.fields}
        onClose={close}
        submit={async (data: Row) => {
          if (m.action === '__choose') {
            const a = state.assets.find((x: Row) => x.id === data.asset_id);
            if (m.base.next === 'work') {
              createWork(a);
              return;
            }
            setModal({ kind: m.base.next, assetId: a.id });
            return;
          }
          if (m.action === 'settings.save') {
            data.reminder_days = String(data.reminder_days)
              .split(',')
              .map((s) => Number(s.trim()));
            data.districts = String(data.districts)
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean);
          }
          if (m.action === 'template.create')
            data.items = String(data.items)
              .split('\n')
              .map((s) => s.trim())
              .filter(Boolean);
          await run(m.action, { ...m.base, ...data });
          close();
        }}
      />
    );
  if (m.kind === 'qr') return <QRDialog asset={m.asset} state={state} onClose={close} t={t} />;
  if (m.kind === 'scan')
    return (
      <ScannerDialog
        onClose={close}
        t={t}
        onScan={(id: string) => {
          const a = state.assets.find((x: Row) => x.id === id);
          if (!a) throw new Error('Объект не найден или недоступен');
          openAsset(a);
          close();
        }}
      />
    );
  if (m.kind === 'logout')
    return (
      <Dialog title={t('Выйти')} onClose={close}>
        <div className="modal-body">
          <div className="error-box">
            {t('Сохранено локально')}: {m.drafts.length}. {t('Ожидает отправки')}.{' '}
            {state.user.roles && 'При выходе служебные черновики на этом устройстве будут удалены.'}
          </div>
        </div>
        <div className="modal-foot">
          <button className="button secondary" onClick={close}>
            {t('Отмена')}
          </button>
          <button className="button danger" onClick={doLogout}>
            {t('Выйти')}
          </button>
        </div>
      </Dialog>
    );
  if (m.kind === 'inspectionDetail') {
    const i = state.inspections.find((x: Row) => x.id === m.inspection.id) || m.inspection;
    return (
      <Dialog title={t('Осмотр')} onClose={close} wide>
        <div className="modal-body">
          <div className="detail-summary">
            <Badge value={i.status} />
            <span>{date(i.completed_at || i.due_at, true)}</span>
          </div>
          <Table headers={['Описание', 'Статус', 'Комментарий']}>
            {i.results.map((r: Row) => (
              <tr key={r.id}>
                <td>
                  {state.inspection_template_items.find((x: Row) => x.id === r.item_id)?.name}
                </td>
                <td>
                  <Badge value={r.result} />
                </td>
                <td>{r.note}</td>
              </tr>
            ))}
          </Table>
          <p>{i.note}</p>
          <div className="gallery">
            {i.photos?.map((id: string) => (
              <a key={id} href={`/api/files/${id}`} target="_blank">
                <img alt={t('Фотографии')} src={`/api/files/${id}`} />
              </a>
            ))}
          </div>
          <small>
            {i.geolocation_status || 'not_requested'} ·{' '}
            {t('Фото не является доказательством посещения.')}
          </small>
          {state.status_history
            .filter((h: Row) => h.entity_id === i.id && h.action === 'inspection.addendum')
            .map((h: Row) => (
              <div className="note" key={h.id}>
                {h.reason}: {h.text}
              </div>
            ))}
        </div>
        {i.status === 'completed' && allowed(state.user, ['manager', 'inspector']) && (
          <div className="modal-foot">
            <button
              className="button secondary"
              onClick={() =>
                form(
                  'Дополнение к осмотру',
                  'inspection.addendum',
                  [
                    input('reason', 'Причина', '', 'textarea'),
                    input('text', 'Текст дополнения', '', 'textarea'),
                  ],
                  { id: i.id },
                )
              }
            >
              {t('Дополнение к осмотру')}
            </button>
          </div>
        )}
      </Dialog>
    );
  }
  if (m.kind === 'defectDetail') {
    const d = state.defects.find((x: Row) => x.id === m.defect.id) || m.defect;
    return (
      <Dialog title={d.description} onClose={close}>
        <div className="modal-body">
          <div className="detail-summary">
            <Badge value={d.status} />
            <Badge value={d.priority || d.severity} />
          </div>
          <p>
            {d.category} · {date(d.created_at, true)}
          </p>
          <p>{d.triage_reason}</p>
          <div className="gallery">
            {state.defect_attachments
              .filter((a: Row) => a.defect_id === d.id)
              .map((a: Row) => (
                <a key={a.attachment_id} href={`/api/files/${a.attachment_id}`} target="_blank">
                  <img alt={d.description} src={`/api/files/${a.attachment_id}`} />
                </a>
              ))}
          </div>
        </div>
      </Dialog>
    );
  }
  if (m.kind === 'workDetail') {
    const w = state.work_orders.find((x: Row) => x.id === m.work.id) || m.work;
    return (
      <Dialog title={w.title} onClose={close} wide>
        <div className="modal-body">
          <div className="detail-summary">
            <Badge value={w.status} />
            <span>{date(w.due_at, true)}</span>
          </div>
          <p>{w.description}</p>
          <p>{w.required_materials}</p>
          {w.pause_reason && (
            <div className="note">
              {w.pause_reason} → {w.next_step}
            </div>
          )}
          {w.report && (
            <>
              <h4>{t('Отчёт о выполнении')}</h4>
              <p>{w.report.text}</p>
              <div className="gallery">
                {w.report.photos?.map((id: string) => (
                  <a key={id} href={`/api/files/${id}`} target="_blank">
                    <img alt={t('Фотографии после')} src={`/api/files/${id}`} />
                  </a>
                ))}
              </div>
            </>
          )}
          {state.work_reviews
            .filter((r: Row) => r.work_id === w.id)
            .map((r: Row) => (
              <div className="note" key={r.id}>
                {t(r.outcome === 'accepted' ? 'Принять работу' : 'Вернуть на доработку')}: {r.note}
              </div>
            ))}
          <h4>{t('История')}</h4>
          {state.work_logs
            .filter((r: Row) => r.work_id === w.id)
            .map((r: Row) => (
              <p key={r.id}>
                <small>{date(r.created_at, true)}</small> ·{' '}
                {r.status ? t(labels[r.status] || r.status) : r.report?.text}
              </p>
            ))}
        </div>
        <div className="modal-foot">{workActions(w)}</div>
      </Dialog>
    );
  }
  return null;
}
function WorkCreate({ state, asset, defect, run, onClose, t }: any) {
  const [selected, setSelected] = useState<string[]>(defect ? [defect.id] : []);
  const opts = (rs: Row[]) => rs.map((r) => ({ value: r.id, label: r.name }));
  return (
    <FormDialog
      title={'Создать задание'}
      onClose={onClose}
      fields={[
        input('title', 'Название', defect?.description || ''),
        input('description', 'Описание', '', 'textarea'),
        select(
          'type',
          'Тип',
          choices([
            'inspection',
            'repair',
            'cleaning',
            'lighting',
            'replacement',
            'dismantling',
            'other',
          ]),
          'repair',
        ),
        select(
          'priority',
          'Приоритет',
          choices(['low', 'normal', 'high', 'critical']),
          defect?.severity === 'critical' ? 'critical' : 'normal',
        ),
        select(
          'assignee_id',
          'Исполнитель',
          opts(
            state.profiles.filter(
              (u: Row) =>
                u.active && (u.roles.includes('technician') || u.roles.includes('inspector')),
            ),
          ),
        ),
        select('team_id', 'Бригада', opts(state.teams), undefined, false),
        input(
          'due_at',
          'Срок',
          new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10),
          'date',
        ),
        input('required_materials', 'Необходимые материалы', '', 'textarea', false),
        { name: 'require_before', label: 'Обязательны фото до', type: 'checkbox' },
      ]}
      submit={async (data) => {
        await run('work.create', { ...data, asset_id: asset.id, defect_ids: selected });
        onClose();
      }}
    >
      <section className="form-section">
        <h4>
          {asset.number} · {t('Дефекты')}
        </h4>
        {state.defects
          .filter((d: Row) => d.asset_id === asset.id && openDefect(d))
          .map((d: Row) => (
            <label className="check-field" key={d.id}>
              <input
                type="checkbox"
                checked={selected.includes(d.id)}
                onChange={(e) =>
                  setSelected(
                    e.target.checked ? [...selected, d.id] : selected.filter((x) => x !== d.id),
                  )
                }
              />
              <span>{d.description}</span>
              <Badge value={d.status} />
            </label>
          ))}
      </section>
    </FormDialog>
  );
}
function PeopleEditor({ state, modal: m, run, onClose, t }: any) {
  const [roles, setRoles] = useState<string[]>(m.profile?.roles || ['observer']);
  const [members, setMembers] = useState<string[]>(
    m.team
      ? state.team_members.filter((r: Row) => r.team_id === m.team.id).map((r: Row) => r.user_id)
      : [],
  );
  const isTeam = m.kind === 'team',
    edit = m.kind === 'profileEdit';
  const fields: Field[] = isTeam
    ? [
        input('name', 'Название', m.team?.name || ''),
        input('area', 'Район', m.team?.area || '', 'text', false),
      ]
    : edit
      ? [{ name: 'active', label: 'Активен', type: 'checkbox', value: m.profile.active }]
      : [
          input('name', 'Имя'),
          input('email', 'Email', '', 'email'),
          input('password', 'Пароль', '', 'password'),
        ];
  return (
    <FormDialog
      title={isTeam ? 'Бригада' : edit ? 'Изменить доступ' : 'Новый сотрудник'}
      fields={fields}
      onClose={onClose}
      submit={async (data) => {
        await run(isTeam ? 'team.save' : edit ? 'profile.update' : 'profile.create', {
          ...data,
          id: m.team?.id || m.profile?.id,
          ...(isTeam ? { members } : { roles }),
        });
        onClose();
      }}
    >
      <section className="form-section">
        <h4>{t(isTeam ? 'Сотрудники' : 'Роли')}</h4>
        {(isTeam
          ? state.profiles.map((p: Row) => ({ id: p.id, name: p.name }))
          : ['admin', 'manager', 'dispatcher', 'inspector', 'technician', 'leader', 'observer'].map(
              (id) => ({ id, name: labels[id] }),
            )
        ).map((r: Row) => (
          <label key={r.id} className="check-field">
            <input
              type="checkbox"
              checked={(isTeam ? members : roles).includes(r.id)}
              onChange={(e) => {
                const current = isTeam ? members : roles;
                const next = e.target.checked
                  ? [...current, r.id]
                  : current.filter((x) => x !== r.id);
                isTeam ? setMembers(next) : setRoles(next);
              }}
            />
            {t(r.name)}
          </label>
        ))}
      </section>
      {!isTeam && !edit && (
        <small>
          12+ {t('Пароль').toLowerCase()} · {state.integration.auth}
        </small>
      )}
    </FormDialog>
  );
}
function LifecycleEditor({ state, asset, run, onClose, t }: any) {
  const [photos, setPhotos] = useState<string[]>([]);
  return (
    <FormDialog
      title="Изменить жизненный цикл"
      fields={[
        select(
          'lifecycle',
          'Жизненный цикл',
          choices(['planned', 'installed', 'operating', 'suspended', 'dismantled']),
          asset.lifecycle,
        ),
        input('reason', 'Причина', '', 'textarea'),
        select(
          'work_id',
          'Демонтаж',
          state.work_orders
            .filter(
              (w: Row) =>
                w.asset_id === asset.id && w.type === 'dismantling' && w.status === 'completed',
            )
            .map((w: Row) => ({ value: w.id, label: w.title })),
          undefined,
          false,
        ),
      ]}
      onClose={onClose}
      submit={async (data) => {
        await run('asset.lifecycle', { ...data, id: asset.id, version: asset.version, photos });
        onClose();
      }}
    >
      <p className="note">
        {t('Демонтаж')} → {t('Выполнено')} + {t('Фотографии')}
      </p>
      <Upload assetId={asset.id} images onUploaded={(f) => setPhotos([...photos, f.id])} />
      {photos.length > 0 && (
        <span>
          {t('Загружено')}: {photos.length}
        </span>
      )}
    </FormDialog>
  );
}
function QRDialog({ asset, state, onClose, t }: any) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    import('qrcode')
      .then((q) =>
        q.toDataURL(`${location.origin}/?asset=${asset.id}`, {
          width: 360,
          margin: 2,
          errorCorrectionLevel: 'M',
        }),
      )
      .then(setSrc);
  }, [asset.id]);
  return (
    <Dialog title={t('QR-код объекта')} onClose={onClose}>
      <div className="modal-body qr-label">
        <div className="print-label">
          <Logo small />
          {src && <img src={src} alt={t('QR-код объекта')} />}
          <h2>{asset.number}</h2>
          <p>{state.tenant.name}</p>
          <small>{t('Вход в рабочее пространство')}</small>
        </div>
      </div>
      <div className="modal-foot">
        <a className="button secondary" download={`${asset.number}-qr.png`} href={src}>
          <Download size={16} />
          PNG
        </a>
        <button className="button" onClick={() => window.print()}>
          <Printer size={16} />
          {t('Печать этикетки')}
        </button>
      </div>
    </Dialog>
  );
}
function ScannerDialog({ onClose, onScan, t }: any) {
  const [error, setError] = useState(''),
    [manual, setManual] = useState(''),
    [running, setRunning] = useState(false);
  const [scanner, setScanner] = useState<any>(null);
  useEffect(
    () => () => {
      scanner?.stop().catch(() => {});
    },
    [scanner],
  );
  const decode = (text: string) => {
    try {
      const url = new URL(text, location.origin);
      const id = url.searchParams.get('asset') || text;
      onScan(id);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Dialog title={t('Сканировать QR')} onClose={onClose}>
      <div className="modal-body">
        <div id="adasset-qr-reader" />
        {!running && (
          <button
            className="button"
            onClick={async () => {
              try {
                const { Html5Qrcode } = await import('html5-qrcode');
                const s = new Html5Qrcode('adasset-qr-reader');
                setScanner(s);
                await s.start(
                  { facingMode: 'environment' },
                  { fps: 8, qrbox: 220 },
                  (text) => {
                    s.stop().catch(() => {});
                    decode(text);
                  },
                  () => {},
                );
                setRunning(true);
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            <ScanLine size={18} />
            {t('Сканировать QR')}
          </button>
        )}
        <label>
          <span>URL / ID</span>
          <input value={manual} onChange={(e) => setManual(e.target.value)} />
        </label>
        <button className="button secondary" onClick={() => decode(manual)}>
          {t('Открыть')}
        </button>
        {error && <div className="error-box">{error}</div>}
      </div>
    </Dialog>
  );
}
function Reports({ state, t, currency, exportButton }: any) {
  const active = state.assets.filter(
    (a: Row) => a.card_status === 'approved' && a.lifecycle !== 'dismantled',
  );
  const closed = state.defects.filter((d: Row) => d.closed_at && d.status === 'closed');
  const avg = closed.length
    ? closed.reduce(
        (sum: number, d: Row) =>
          sum + (Date.parse(d.closed_at) - Date.parse(d.created_at)) / 3600000,
        0,
      ) / closed.length
    : null;
  const costs =
    state.work_materials.reduce(
      (sum: number, m: Row) => sum + Math.round(Number(m.cost) * 100),
      0,
    ) / 100;
  const [group, setGroup] = useState('district');
  const names: Row = { district: 'По районам', owner_id: 'По владельцам', type: 'По типам' };
  const groups: Record<string, Row[]> = {};
  for (const a of active) {
    const label =
      group === 'owner_id'
        ? state.organizations.find((o: Row) => o.id === a.owner_id)?.name
        : a[group];
    (groups[label] ??= []).push(a);
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">AD ASSET / ANALYTICS</div>
          <h1>{t('Аналитика обслуживания')}</h1>
          <p>{t('Состояние сети')}</p>
        </div>
        <div className="page-actions">
          {exportButton('summary')}
          {exportButton('defects')}
        </div>
      </div>
      <div className="stats-grid report-stats">
        <div className="stat-card">
          <span>{t('Фактические расходы')}</span>
          <strong>{currency(costs)}</strong>
          <small>KZT · {t('Материалы и расходы')}</small>
        </div>
        <div className="stat-card">
          <span>{t('Среднее время устранения')}</span>
          <strong>{avg === null ? '—' : avg.toFixed(1) + ' ч'}</strong>
          <small>
            {closed.length} · {t('Закрыт')}
          </small>
        </div>
        <div className="stat-card">
          <span>{t('Открытые дефекты')}</span>
          <strong>{state.defects.filter(openDefect).length}</strong>
          <small>{t('Ожидает проверки')}</small>
        </div>
        <div className="stat-card">
          <span>{t('Активные задания')}</span>
          <strong>{state.work_orders.filter((w: Row) => !terminalWork(w)).length}</strong>
          <small>
            {
              state.work_orders.filter(
                (w: Row) => !terminalWork(w) && Date.parse(w.due_at) < Date.now(),
              ).length
            }{' '}
            · {t('Просрочен')}
          </small>
        </div>
      </div>
      <div className="reports-grid">
        <section className="panel report-card">
          <div className="panel-heading">
            <h2>{t(names[group])}</h2>
            <select value={group} onChange={(e) => setGroup(e.target.value)}>
              {Object.entries(names).map(([k, v]) => (
                <option value={k} key={k}>
                  {t(v)}
                </option>
              ))}
            </select>
          </div>
          <div className="bar-chart">
            {Object.entries(groups).map(([label, items]) => (
              <div className="bar-row" key={label}>
                <span>{label}</span>
                <div>
                  <i
                    style={{
                      width:
                        (items.length / Math.max(...Object.values(groups).map((a) => a.length))) *
                          100 +
                        '%',
                    }}
                  />
                </div>
                <strong>{items.length}</strong>
              </div>
            ))}
          </div>
        </section>
        <section className="panel report-card">
          <div className="panel-heading">
            <h2>{t('По категориям дефектов')}</h2>
          </div>
          <div className="bar-chart">
            {Array.from(new Set(state.defects.map((d: Row) => d.category))).map((category: any) => {
              const num = state.defects.filter((d: Row) => d.category === category).length;
              return (
                <div className="bar-row orange-bars" key={category}>
                  <span>{category}</span>
                  <div>
                    <i style={{ width: (num / Math.max(1, state.defects.length)) * 100 + '%' }} />
                  </div>
                  <strong>{num}</strong>
                </div>
              );
            })}
          </div>
        </section>
      </div>
      <section className="panel">
        <div className="panel-heading">
          <h2>{t('По исполнителям')}</h2>
          {exportButton('works')}
        </div>
        <Table
          headers={['Исполнитель', 'Задания', 'Выполнено', 'Просрочен', 'Фактические расходы']}
        >
          {state.profiles
            .filter((p: Row) => state.work_orders.some((w: Row) => w.assignee_id === p.id))
            .map((p: Row) => {
              const works = state.work_orders.filter((w: Row) => w.assignee_id === p.id);
              const ids = works.map((w: Row) => w.id);
              return (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td>{works.length}</td>
                  <td>{works.filter((w: Row) => w.status === 'completed').length}</td>
                  <td>
                    {
                      works.filter(
                        (w: Row) => !terminalWork(w) && Date.parse(w.due_at) < Date.now(),
                      ).length
                    }
                  </td>
                  <td>
                    {currency(
                      state.work_materials
                        .filter((m: Row) => ids.includes(m.work_id))
                        .reduce(
                          (sum: number, m: Row) => sum + Math.round(Number(m.cost) * 100),
                          0,
                        ) / 100,
                    )}
                  </td>
                </tr>
              );
            })}
        </Table>
      </section>
      <div className="note formula-note">
        {t('Формулы отчёта')}
        <br />
        {t('Действующие: подтверждённые карточки без демонтированных объектов.')}
        <br />
        {t(
          'Время устранения: от регистрации до подтверждённого закрытия. Открытые дефекты учитываются отдельно.',
        )}
        <br />
        {t(
          'Расходы: сумма введённых стоимостей строк материалов в тенге; количество повторно не умножается.',
        )}
        <br />
        {t('Просрочка: срок прошёл, а задание ещё не выполнено и не отменено.')}
      </div>
    </>
  );
}
