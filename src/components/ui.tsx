'use client';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { X, UploadCloud, FileText, Loader2, ImagePlus, Check, SearchX } from 'lucide-react';
import { translate, labels, type Lang } from '@/lib/i18n';
import type { Row } from '@/lib/domain';
export const Locale = createContext<Lang>('ru');
export const useT = () => {
  const lang = useContext(Locale);
  return (s: string) => translate(s, lang);
};
export function Badge({ value }: { value: string }) {
  const t = useT();
  return (
    <span className={`badge badge-${value}`}>
      <i />
      {t(labels[value] || value)}
    </span>
  );
}
export function Empty({ text }: { text?: string }) {
  const t = useT();
  return (
    <div className="empty">
      <SearchX size={32} />
      <h3>{text || t('Ничего не найдено')}</h3>
      <p>{t('Измените фильтры или добавьте запись.')}</p>
    </div>
  );
}
export function Dialog({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    ref.current?.focus();
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab') {
        const focus = ref.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input:not(:disabled),select,textarea,a[href],[tabindex="0"]',
        );
        if (!focus?.length) return;
        const first = focus[0],
          last = focus[focus.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', handler);
    return () => {
      document.removeEventListener('keydown', handler);
      previous?.focus();
    };
  }, [onClose]);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`modal ${wide ? 'wide' : ''}`}
      >
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-button" aria-label={t('Закрыть')} onClick={onClose}>
            <X size={21} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
export type Field = {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
  options?: { value: string; label: string }[];
  value?: any;
  hint?: string;
  min?: number;
  step?: string;
};
export function FormDialog({
  title,
  fields,
  submit,
  onClose,
  children,
  initial = {},
  button = 'Сохранить',
}: {
  title: string;
  fields: Field[];
  submit: (data: Row) => Promise<void>;
  onClose: () => void;
  children?: ReactNode;
  initial?: Row;
  button?: string;
}) {
  const t = useT();
  const shape: Record<string, z.ZodType> = {};
  fields.forEach((f) => {
    shape[f.name] =
      f.type === 'checkbox'
        ? z.boolean().optional()
        : f.required
          ? z.string().min(1, t('Выбрано') + '?')
          : z.string().optional();
  });
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    setValue,
  } = useForm<Row>({
    resolver: zodResolver(z.object(shape)) as any,
    defaultValues: {
      ...Object.fromEntries(
        fields.map((f) => [f.name, f.value ?? (f.type === 'checkbox' ? false : '')]),
      ),
      ...initial,
    },
  });
  const [error, setError] = useState('');
  return (
    <Dialog title={t(title)} onClose={onClose}>
      <form
        onSubmit={handleSubmit(async (data) => {
          setError('');
          try {
            await submit(data);
          } catch (e) {
            setError((e as Error).message);
          }
        })}
      >
        <div className="modal-body">
          <div className="form-grid">
            {fields.map((f) => (
              <label
                key={f.name}
                className={
                  f.type === 'textarea'
                    ? 'span-2'
                    : f.type === 'checkbox'
                      ? 'check-field span-2'
                      : ''
                }
              >
                <span>
                  {t(f.label)}
                  {f.required && <em> *</em>}
                </span>
                {f.type === 'select' ? (
                  <select {...register(f.name)}>
                    <option value="">—</option>
                    {f.options?.map((o) => (
                      <option key={o.value} value={o.value}>
                        {t(o.label)}
                      </option>
                    ))}
                  </select>
                ) : f.type === 'textarea' ? (
                  <textarea rows={4} {...register(f.name)} />
                ) : (
                  <input
                    type={f.type || 'text'}
                    min={f.min}
                    step={f.step || (f.type === 'number' ? 'any' : undefined)}
                    {...register(f.name)}
                  />
                )}{' '}
                {f.hint && <small>{t(f.hint)}</small>}
                {errors[f.name] && (
                  <small className="error-text">{String(errors[f.name]?.message)}</small>
                )}
              </label>
            ))}
          </div>
          {children}
          {error && (
            <div className="error-box" role="alert">
              {error}
            </div>
          )}
        </div>
        <div className="modal-foot">
          <button type="button" className="button secondary" onClick={onClose}>
            {t('Отмена')}
          </button>
          <button type="submit" className="button" disabled={isSubmitting}>
            {isSubmitting ? <Loader2 className="spin" size={16} /> : <Check size={16} />}{' '}
            {t(isSubmitting ? 'Сохранение…' : button)}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
export function Upload({
  assetId,
  images = false,
  onUploaded,
}: {
  assetId: string;
  images?: boolean;
  onUploaded: (file: Row) => void;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <div>
      <label className={`upload ${busy ? 'busy' : ''}`}>
        <UploadCloud size={22} />
        <span>
          {t(busy ? 'Загрузка…' : 'Выбрать файл')}
          <small>{t('До 10 МБ: JPG, PNG, WebP, PDF, TXT')}</small>
        </span>
        <input
          type="file"
          disabled={busy}
          accept={images ? 'image/png,image/jpeg,image/webp' : '.png,.jpg,.jpeg,.webp,.pdf,.txt'}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setBusy(true);
            setError('');
            try {
              const form = new FormData();
              form.set('file', file);
              form.set('asset_id', assetId);
              const r = await fetch('/api/files', { method: 'POST', body: form });
              const body = await r.json();
              if (!r.ok) throw new Error(body.error);
              onUploaded(body);
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setBusy(false);
              e.target.value = '';
            }
          }}
        />
      </label>
      {error && <small className="error-text">{error}</small>}
    </div>
  );
}
export function PhotoPicker({
  assetId,
  state,
  selected,
  onChange,
  label,
}: {
  assetId: string;
  state: Row;
  selected: string[];
  onChange: (ids: string[]) => void;
  label: string;
}) {
  const t = useT();
  const [added, setAdded] = useState<Row[]>([]);
  const files = [
    ...(state.attachments || []).filter(
      (f: Row) => f.asset_id === assetId && f.mime.startsWith('image/'),
    ),
    ...added,
  ];
  return (
    <section className="form-section">
      <h4>{t(label)}</h4>
      <div className="photo-picker">
        {files.map((f: Row) => (
          <button
            type="button"
            key={f.id}
            title={f.name}
            className={selected.includes(f.id) ? 'chosen' : ''}
            onClick={() =>
              onChange(
                selected.includes(f.id) ? selected.filter((x) => x !== f.id) : [...selected, f.id],
              )
            }
          >
            <img src={`/api/files/${f.id}`} alt={f.name} />
            {selected.includes(f.id) && (
              <span>
                <Check size={14} />
              </span>
            )}
          </button>
        ))}
      </div>
      <Upload
        assetId={assetId}
        images
        onUploaded={(f) => {
          setAdded([...added, f]);
          onChange([...selected, f.id]);
        }}
      />
    </section>
  );
}
export function Table({ headers, children }: { headers: string[]; children: ReactNode }) {
  const t = useT();
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            {headers.map((h) => (
              <th key={h}>{t(h)}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
