'use client';
import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { Check, Save, MapPin, Plus, Trash2, Loader2 } from 'lucide-react';
import type { Row } from '@/lib/domain';
import { Dialog, PhotoPicker, Upload, useT, Badge } from './ui';
import { labels } from '@/lib/i18n';
import { CITY, MAP_CENTER } from '@/lib/location';
const MapView = dynamic(() => import('./map'), { ssr: false });
export type Run = (action: string, payload: Row) => Promise<Row>;
const options = (items: Row[], key = 'name') =>
  items.map((i) => (
    <option key={i.id} value={i.id}>
      {i[key]}
    </option>
  ));
export function AssetEditor({
  state,
  asset,
  run,
  onClose,
}: {
  state: Row;
  asset?: Row;
  run: Run;
  onClose: () => void;
}) {
  const t = useT();
  const [form, setForm] = useState<Row>(
    asset || {
      number: '',
      name: '',
      city: CITY,
      district: state.tenant.settings.districts[0],
      type: state.asset_types[0]?.name,
      latitude: MAP_CENTER[0],
      longitude: MAP_CENTER[1],
      owner_id: state.organizations.find((o: Row) => o.kind === 'owner')?.id,
      service_id: state.organizations.find((o: Row) => o.kind === 'service')?.id,
      responsible_id:
        state.profiles.find((u: Row) => u.roles.includes('manager'))?.id || state.user.id,
      width: 6,
      height: 3,
      unit: 'м',
      lighting: false,
    },
  );
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const set = (k: string, v: any) => setForm({ ...form, [k]: v });
  const field = (k: string, label: string, type = 'text', required = true) => (
    <label key={k}>
      <span>
        {t(label)}
        {required ? ' *' : ''}
      </span>
      <input
        type={type}
        required={required}
        value={form[k] ?? ''}
        step={type === 'number' ? 'any' : undefined}
        onChange={(e) => set(k, type === 'number' ? e.target.valueAsNumber : e.target.value)}
      />
    </label>
  );
  return (
    <Dialog title={t(asset ? 'Редактировать' : 'Добавить объект')} onClose={onClose} wide>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          try {
            await run(asset ? 'asset.edit' : 'asset.create', form);
            onClose();
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="modal-body asset-editor">
          <div>
            <div className="form-grid">
              {field('number', 'Номер')}
              {field('name', 'Название')}
              <label>
                <span>{t('Тип')} *</span>
                <select value={form.type} onChange={(e) => set('type', e.target.value)}>
                  {state.asset_types.map((x: Row) => (
                    <option key={x.id}>{x.name}</option>
                  ))}
                </select>
              </label>
              {field('address', 'Адрес')}
              {field('city', 'Город')}
              <label>
                <span>{t('Район')} *</span>
                <select value={form.district} onChange={(e) => set('district', e.target.value)}>
                  {state.tenant.settings.districts.map((x: string) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>{t('Владелец')} *</span>
                <select
                  required
                  value={form.owner_id}
                  onChange={(e) => set('owner_id', e.target.value)}
                >
                  {options(state.organizations)}
                </select>
              </label>
              <label>
                <span>{t('Обслуживающая организация')} *</span>
                <select
                  required
                  value={form.service_id}
                  onChange={(e) => set('service_id', e.target.value)}
                >
                  {options(state.organizations)}
                </select>
              </label>
              <label>
                <span>{t('Ответственный')} *</span>
                <select
                  required
                  value={form.responsible_id}
                  onChange={(e) => set('responsible_id', e.target.value)}
                >
                  {options(state.profiles.filter((u: Row) => u.active))}
                </select>
              </label>
              {field('installed_at', 'Дата установки', 'date', false)}
              {field('width', 'Ширина', 'number', false)}
              {field('height', 'Высота', 'number', false)}
              <label>
                <span>{t('Единицы')}</span>
                <select value={form.unit} onChange={(e) => set('unit', e.target.value)}>
                  <option>м</option>
                  <option>см</option>
                </select>
              </label>
              {field('material', 'Материал', 'text', false)}
              {field('access', 'Доступ к объекту', 'text', false)}
              <label className="check-field">
                <input
                  type="checkbox"
                  checked={!!form.lighting}
                  onChange={(e) => set('lighting', e.target.checked)}
                />
                {t('Есть подсветка')}
              </label>
              <label className="span-2">
                <span>{t('Описание')}</span>
                <textarea
                  value={form.description || ''}
                  onChange={(e) => set('description', e.target.value)}
                />
              </label>
            </div>
          </div>
          <div>
            <h4>
              <MapPin size={16} /> {t('Выберите точку на карте')}
            </h4>
            <MapView
              assets={[]}
              compact
              t={t}
              onPick={
                asset
                  ? undefined
                  : (lat, lng) =>
                      setForm({
                        ...form,
                        latitude: Number(lat.toFixed(6)),
                        longitude: Number(lng.toFixed(6)),
                      })
              }
            />
            <div className="form-grid coordinate-fields">
              {field('latitude', 'Широта', 'number')}
              {field('longitude', 'Долгота', 'number')}
            </div>
            <div className="note">
              {t('Неизвестно')} → {t('Осмотр')} → {t('Техническое состояние')}
            </div>
          </div>
          {error && <div className="error-box span-2">{error}</div>}
        </div>
        <div className="modal-foot">
          <button type="button" className="button secondary" onClick={onClose}>
            {t('Отмена')}
          </button>
          <button className="button" disabled={busy}>
            {busy ? <Loader2 className="spin" size={16} /> : <Check size={16} />} {t('Сохранить')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
export function InspectionEditor({
  state,
  inspection,
  run,
  onClose,
}: {
  state: Row;
  inspection: Row;
  run: Run;
  onClose: () => void;
}) {
  const t = useT();
  const key = `adasset:draft:${state.user.id}:inspection:${inspection.id}`;
  const items = state.inspection_template_items
    .filter((i: Row) => i.template_id === inspection.template_id)
    .sort((a: Row, b: Row) => a.position - b.position);
  const initial = {
    id: inspection.id,
    version: inspection.version,
    results: items.map((i: Row) => ({
      item_id: i.id,
      result: '',
      note: '',
      severity: 'repair',
      photos: [],
    })),
    photos: [],
    note: '',
    geolocation_status: 'not_requested',
  };
  const [form, setForm] = useState<Row>(initial),
    [status, setStatus] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const raw = localStorage.getItem(key);
    if (raw) {
      try {
        setForm(JSON.parse(raw).payload);
        setStatus('Сохранено локально');
      } catch {}
    }
  }, [key]);
  const change = (index: number, values: Row) =>
    setForm({
      ...form,
      results: form.results.map((r: Row, k: number) => (k === index ? { ...r, ...values } : r)),
    });
  const save = (s = 'Сохранено локально') => {
    localStorage.setItem(key, JSON.stringify({ payload: form, status: s }));
    setStatus(s);
  };
  const geolocate = () => {
    if (!navigator.geolocation) {
      setForm({ ...form, geolocation_status: 'unavailable' });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) =>
        setForm({
          ...form,
          geolocation_status: 'provided',
          coordinates: {
            latitude: p.coords.latitude,
            longitude: p.coords.longitude,
            accuracy: p.coords.accuracy,
          },
        }),
      (e) => setForm({ ...form, geolocation_status: e.code === 1 ? 'denied' : 'unavailable' }),
      { timeout: 10000 },
    );
  };
  return (
    <Dialog
      title={
        t('Осмотр') + ' · ' + state.assets.find((a: Row) => a.id === inspection.asset_id)?.number
      }
      onClose={onClose}
      wide
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          save('Ожидает отправки');
          try {
            await run('inspection.complete', form);
            localStorage.removeItem(key);
            onClose();
          } catch (err) {
            setError((err as Error).message);
            save('Ошибка синхронизации');
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="modal-body">
          <div className="note">
            {t('Не удалось проверить')} ≠ {t('Соответствует')}.{' '}
            {t('Фото не является доказательством посещения.')}
          </div>
          {items.map((item: Row, index: number) => {
            const r = form.results[index] || {};
            return (
              <section className="checklist-item" key={item.id}>
                <div className="checklist-heading">
                  <span className="step-number">{index + 1}</span>
                  <strong>{item.name}</strong>
                  <select
                    required
                    value={r.result}
                    onChange={(e) => change(index, { result: e.target.value })}
                  >
                    <option value="">—</option>
                    {['ok', 'issue', 'unverified', 'na'].map((x) => (
                      <option value={x} key={x}>
                        {t(labels[x])}
                      </option>
                    ))}
                  </select>
                </div>
                {['issue', 'unverified'].includes(r.result) && (
                  <div className="checklist-details">
                    <label>
                      <span>{t('Описание')} *</span>
                      <textarea
                        required
                        minLength={3}
                        value={r.note}
                        onChange={(e) => change(index, { note: e.target.value })}
                      />
                    </label>
                    {r.result === 'issue' && (
                      <>
                        <div className="form-grid">
                          <label>
                            <span>{t('Серьёзность')}</span>
                            <select
                              value={r.severity}
                              onChange={(e) => change(index, { severity: e.target.value })}
                            >
                              {['minor', 'repair', 'critical'].map((x) => (
                                <option key={x} value={x}>
                                  {t(labels[x])}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label>
                            <span>{t('Поверхность')}</span>
                            <select
                              value={r.surface_id || ''}
                              onChange={(e) => change(index, { surface_id: e.target.value })}
                            >
                              <option value="">—</option>
                              {options(
                                state.asset_surfaces.filter(
                                  (s: Row) => s.asset_id === inspection.asset_id,
                                ),
                              )}
                            </select>
                          </label>
                        </div>
                        <PhotoPicker
                          state={state}
                          assetId={inspection.asset_id}
                          selected={r.photos || []}
                          onChange={(photos) => change(index, { photos })}
                          label="Фотографии дефекта"
                        />
                      </>
                    )}
                  </div>
                )}
              </section>
            );
          })}
          <label>
            <span>{t('Комментарий')}</span>
            <textarea
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
            />
          </label>
          <PhotoPicker
            state={state}
            assetId={inspection.asset_id}
            selected={form.photos}
            onChange={(photos) => setForm({ ...form, photos })}
            label="Фотографии"
          />
          <div className="inline-actions">
            <button type="button" className="button secondary" onClick={geolocate}>
              <MapPin size={16} />
              {t('Зафиксировать геопозицию')}
            </button>
            <small>
              {
                (
                  {
                    not_requested: 'Не запрашивалась',
                    denied: 'Доступ отклонён',
                    unavailable: 'Недоступна',
                    provided: 'Получена (не доказательство посещения)',
                  } as Row
                )[form.geolocation_status]
              }
            </small>
          </div>
          {status && <div className="note">{t(status)}</div>}
          {error && (
            <div className="error-box" role="alert">
              {error}
            </div>
          )}
        </div>
        <div className="modal-foot">
          <button type="button" className="button secondary" onClick={() => save()}>
            <Save size={16} />
            {t('Сохранить на устройстве')}
          </button>
          <button className="button" disabled={busy}>
            {busy ? <Loader2 className="spin" size={16} /> : <Check size={16} />}{' '}
            {t('Завершить осмотр')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
export function DefectEditor({
  state,
  assetId,
  run,
  onClose,
}: {
  state: Row;
  assetId: string;
  run: Run;
  onClose: () => void;
}) {
  const t = useT();
  const [form, setForm] = useState<Row>({
      asset_id: assetId,
      category: 'Поверхность',
      severity: 'repair',
      description: '',
      photos: [],
      surface_id: '',
    }),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <Dialog title={t('Сообщить о проблеме')} onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          try {
            await run('defect.create', form);
            onClose();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="modal-body">
          <div className="form-grid">
            <label>
              <span>{t('Категория')}</span>
              <select
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
              >
                {[
                  'Поверхность',
                  'Подсветка',
                  'Крепления',
                  'Коррозия',
                  'Основание',
                  'Загрязнение',
                  'Вандализм',
                  'Другое',
                ].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </label>
            <label>
              <span>{t('Серьёзность')}</span>
              <select
                value={form.severity}
                onChange={(e) => setForm({ ...form, severity: e.target.value })}
              >
                {['minor', 'repair', 'critical'].map((x) => (
                  <option key={x} value={x}>
                    {t(labels[x])}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>{t('Поверхность')}</span>
              <select
                value={form.surface_id}
                onChange={(e) => setForm({ ...form, surface_id: e.target.value })}
              >
                <option value="">—</option>
                {options(state.asset_surfaces.filter((s: Row) => s.asset_id === assetId))}
              </select>
            </label>
            <label className="span-2">
              <span>{t('Описание')} *</span>
              <textarea
                required
                minLength={3}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </label>
          </div>
          <PhotoPicker
            state={state}
            assetId={assetId}
            selected={form.photos}
            onChange={(photos) => setForm({ ...form, photos })}
            label="Фотографии дефекта"
          />
          {error && <div className="error-box">{error}</div>}
        </div>
        <div className="modal-foot">
          <button className="button" disabled={busy}>
            {t('Создать')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
export function WorkEditor({
  state,
  work,
  review = false,
  run,
  onClose,
}: {
  state: Row;
  work: Row;
  review?: boolean;
  run: Run;
  onClose: () => void;
}) {
  const t = useT(),
    key = `adasset:draft:${state.user.id}:work:${work.id}`;
  const linked = state.work_order_defects
    .filter((l: Row) => l.work_id === work.id)
    .map((l: Row) => state.defects.find((d: Row) => d.id === l.defect_id));
  const [form, setForm] = useState<Row>({
    id: work.id,
    version: work.version,
    text: work.report?.text || '',
    photos: work.report?.photos || [],
    before_photos: work.report?.before_photos || [],
    resolved_defects: work.report?.resolved_defects || [],
    materials: state.work_materials.filter((m: Row) => m.work_id === work.id),
    outcome: 'accepted',
    note: '',
  });
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [status, setStatus] = useState('');
  useEffect(() => {
    if (review) return;
    const raw = localStorage.getItem(key);
    if (raw) {
      try {
        setForm(JSON.parse(raw).payload);
        setStatus('Сохранено локально');
      } catch {}
    }
  }, [key, review]);
  const save = (s = 'Сохранено локально') => {
    localStorage.setItem(key, JSON.stringify({ payload: form, status: s }));
    setStatus(s);
  };
  return (
    <Dialog
      title={t(review ? 'Проверить результат' : 'Отчёт о выполнении') + ' · ' + work.title}
      onClose={onClose}
      wide
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          if (!review) save('Ожидает отправки');
          try {
            await run(review ? 'work.review' : 'work.report', form);
            localStorage.removeItem(key);
            onClose();
          } catch (err) {
            setError((err as Error).message);
            if (!review) save('Ошибка синхронизации');
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="modal-body">
          {review ? (
            <>
              <div className="review-report">
                <p>{work.report?.text}</p>
                <div className="gallery">
                  {work.report?.photos?.map((id: string) => (
                    <a key={id} href={`/api/files/${id}`} target="_blank">
                      <img src={`/api/files/${id}`} alt={t('Фотографии после')} />
                    </a>
                  ))}
                </div>
                <small>
                  {state.profiles.find((u: Row) => u.id === work.report?.submitted_by)?.name}
                </small>
              </div>
              <label>
                <span>{t('Статус')}</span>
                <select
                  value={form.outcome}
                  onChange={(e) => setForm({ ...form, outcome: e.target.value })}
                >
                  <option value="accepted">{t('Принять работу')}</option>
                  <option value="returned">{t('Вернуть на доработку')}</option>
                </select>
              </label>
              <label>
                <span>{t('Комментарий')} *</span>
                <textarea
                  required
                  minLength={5}
                  value={form.note}
                  onChange={(e) => setForm({ ...form, note: e.target.value })}
                />
              </label>
            </>
          ) : (
            <>
              <label>
                <span>{t('Описание')} *</span>
                <textarea
                  required
                  minLength={10}
                  rows={4}
                  value={form.text}
                  onChange={(e) => setForm({ ...form, text: e.target.value })}
                />
              </label>
              <div className="form-grid">
                <PhotoPicker
                  state={state}
                  assetId={work.asset_id}
                  selected={form.before_photos}
                  onChange={(before_photos) => setForm({ ...form, before_photos })}
                  label="Фотографии до"
                />
                <PhotoPicker
                  state={state}
                  assetId={work.asset_id}
                  selected={form.photos}
                  onChange={(photos) => setForm({ ...form, photos })}
                  label="Фотографии после"
                />
              </div>
            </>
          )}
          <section className="form-section">
            <h4>{t(review ? 'Подтверждённо устранены' : 'Устранённые дефекты')}</h4>
            {linked.map((d: Row) => (
              <label key={d.id} className="check-field">
                <input
                  type="checkbox"
                  disabled={review && !work.report?.resolved_defects.includes(d.id)}
                  checked={form.resolved_defects.includes(d.id)}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      resolved_defects: e.target.checked
                        ? [...form.resolved_defects, d.id]
                        : form.resolved_defects.filter((x: string) => x !== d.id),
                    })
                  }
                />
                <span>{d.description}</span>
                <Badge value={d.status} />
              </label>
            ))}
          </section>
          <section className="form-section">
            <h4>{t('Материалы и расходы')}</h4>
            {form.materials.map((m: Row, i: number) => (
              <div key={i} className="material-row">
                {[
                  ['name', 'Наименование'],
                  ['quantity', 'Количество'],
                  ['unit', 'Единицы'],
                  ['cost', 'Стоимость, ₸'],
                ].map(([k, l]) => (
                  <label key={k}>
                    <small>{t(l)}</small>
                    <input
                      required
                      readOnly={review}
                      type={['quantity', 'cost'].includes(k) ? 'number' : 'text'}
                      min="0"
                      step={k === 'cost' ? '0.01' : 'any'}
                      value={m[k]}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          materials: form.materials.map((x: Row, j: number) =>
                            j === i ? { ...x, [k]: e.target.value } : x,
                          ),
                        })
                      }
                    />
                  </label>
                ))}
                {!review && (
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={t('Отмена')}
                    onClick={() =>
                      setForm({
                        ...form,
                        materials: form.materials.filter((_: any, j: number) => j !== i),
                      })
                    }
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            ))}
            {!review && (
              <button
                type="button"
                className="button secondary small"
                onClick={() =>
                  setForm({
                    ...form,
                    materials: [
                      ...form.materials,
                      { name: '', quantity: '1', unit: 'шт', cost: '0.00' },
                    ],
                  })
                }
              >
                <Plus size={15} />
                {t('Добавить материал')}
              </button>
            )}
          </section>
          {status && <div className="note">{t(status)}</div>}
          {error && <div className="error-box">{error}</div>}
        </div>
        <div className="modal-foot">
          {!review && (
            <button type="button" className="button secondary" onClick={() => save()}>
              <Save size={16} />
              {t('Сохранить на устройстве')}
            </button>
          )}
          <button className="button" disabled={busy}>
            {busy ? <Loader2 className="spin" size={16} /> : <Check size={16} />}{' '}
            {t(review ? 'Подтвердить' : 'Передать на проверку')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
export function DocumentEditor({
  state,
  assetId,
  previous,
  run,
  onClose,
}: {
  state: Row;
  assetId: string;
  previous?: Row;
  run: Run;
  onClose: () => void;
}) {
  const t = useT();
  const [form, setForm] = useState<Row>({
      asset_id: assetId,
      name: previous?.name || '',
      type: previous?.type || state.document_types[0]?.name || 'Паспорт',
      number: '',
      issuer: '',
      issued_at: '',
      starts_at: '',
      expires_at: '',
      responsible_id: state.user.id,
      attachment_id: '',
      previous_id: previous?.id || '',
      reason: '',
      comment: '',
    }),
    [file, setFile] = useState<Row | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <Dialog title={t(previous ? 'Продлить документ' : 'Новый документ')} onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          try {
            await run('document.create', form);
            onClose();
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="modal-body">
          <div className="form-grid">
            {[
              ['name', 'Название'],
              ['number', 'Номер'],
              ['issuer', 'Выдан организацией'],
              ['issued_at', 'Дата выдачи'],
              ['starts_at', 'Начало действия'],
              ['expires_at', 'Окончание действия'],
            ].map(([k, l]) => (
              <label key={k}>
                <span>{t(l)}</span>
                <input
                  required={['name', 'number'].includes(k)}
                  type={k.endsWith('_at') ? 'date' : 'text'}
                  value={form[k]}
                  onChange={(e) => setForm({ ...form, [k]: e.target.value })}
                />
                {k === 'expires_at' && <small>{t('Без срока окончания — оставьте пустым')}</small>}
              </label>
            ))}
            <label>
              <span>{t('Тип')}</span>
              <select
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value })}
              >
                {state.document_types.map((d: Row) => (
                  <option key={d.id}>{d.name}</option>
                ))}
              </select>
            </label>
            <label>
              <span>{t('Ответственный')}</span>
              <select
                value={form.responsible_id}
                onChange={(e) => setForm({ ...form, responsible_id: e.target.value })}
              >
                {options(state.profiles)}
              </select>
            </label>
            {previous && (
              <label className="span-2">
                <span>{t('Причина')} *</span>
                <input
                  required
                  minLength={3}
                  value={form.reason}
                  onChange={(e) => setForm({ ...form, reason: e.target.value })}
                />
              </label>
            )}
            <label className="span-2">
              <span>{t('Комментарий')}</span>
              <textarea
                value={form.comment}
                onChange={(e) => setForm({ ...form, comment: e.target.value })}
              />
            </label>
          </div>
          <Upload
            assetId={assetId}
            onUploaded={(f) => {
              setFile(f);
              setForm({ ...form, attachment_id: f.id });
            }}
          />
          {file && (
            <div className="note">
              <Check size={16} />
              {file.name}
            </div>
          )}
          {error && <div className="error-box">{error}</div>}
        </div>
        <div className="modal-foot">
          <button className="button" disabled={busy || !form.attachment_id}>
            {t('Сохранить')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
