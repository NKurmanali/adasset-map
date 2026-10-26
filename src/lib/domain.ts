export type Row = Record<string, any>;
export type Role =
  | 'admin'
  | 'manager'
  | 'dispatcher'
  | 'inspector'
  | 'technician'
  | 'leader'
  | 'observer';
export const ROLES: Role[] = [
  'admin',
  'manager',
  'dispatcher',
  'inspector',
  'technician',
  'leader',
  'observer',
];
export const TENANT = 'a0000000-0000-4000-8000-000000000001';
export const openDefect = (d: Row) => !['closed', 'rejected', 'duplicate'].includes(d.status);
export const terminalWork = (w: Row) => ['completed', 'cancelled'].includes(w.status);
export function technicalState(defects: Row[], inspections: Row[]): string {
  const active = defects.filter(openDefect);
  if (active.some((d) => d.severity === 'critical' || d.priority === 'critical')) return 'critical';
  if (active.some((d) => d.severity === 'repair' && !['registered', 'review'].includes(d.status)))
    return 'repair';
  if (active.length && active.every((d) => d.severity === 'minor')) return 'remarks';
  if (active.length) return 'unknown';
  const last = inspections
    .filter((i) => i.status === 'completed')
    .sort((a, b) => new Date(b.completed_at).getTime() - new Date(a.completed_at).getTime())[0];
  if (!last || !last.results?.length || last.results.some((r: Row) => r.result === 'unverified'))
    return 'unknown';
  const issues = last.results.filter((r: Row) => r.result === 'issue').length;
  if (issues > defects.filter((d) => d.inspection_id === last.id && d.status === 'closed').length)
    return 'unknown';
  return 'healthy';
}
export function inspectionState(
  asset: Row,
  plans: Row[],
  inspections: Row[],
  now = Date.now(),
): string {
  if (!inspections.some((i) => i.asset_id === asset.id && i.status === 'completed')) return 'never';
  const dates = plans
    .filter((p) => p.asset_id === asset.id && p.active)
    .map((p) => Date.parse(p.next_due));
  if (!dates.length) return 'current';
  const next = Math.min(...dates);
  return next < now ? 'overdue' : next - now < 7 * 86400000 ? 'soon' : 'current';
}
export function documentState(docs: Row[], required: string[], now = Date.now()): string {
  const current = docs.filter((d) => !d.superseded_by);
  if (current.some((d) => d.expires_at && Date.parse(d.expires_at) < now)) return 'expired';
  if (
    required.some((type) => !current.some((d) => d.type === type && d.review_status === 'verified'))
  )
    return 'missing';
  if (current.some((d) => d.expires_at && Date.parse(d.expires_at) - now < 30 * 86400000))
    return 'soon';
  if (current.some((d) => d.review_status !== 'verified')) return 'review';
  return 'valid';
}
export function nextDue(base: string, interval: number, rule: string, completed: string): string {
  let d = new Date(rule === 'fixed' ? base : completed);
  d.setUTCDate(d.getUTCDate() + interval);
  if (rule === 'fixed')
    while (d.getTime() <= Date.parse(completed)) d.setUTCDate(d.getUTCDate() + interval);
  return d.toISOString();
}
export function allowed(user: Row, roles: Role[]): boolean {
  return user.roles?.includes('admin') || roles.some((r) => user.roles?.includes(r));
}
export class AppError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export function assert(condition: unknown, message: string, status = 400): asserts condition {
  if (!condition) throw new AppError(message, status);
}
export function requireRole(user: Row, roles: Role[]) {
  assert(allowed(user, roles), 'Недостаточно прав / Құқықтар жеткіліксіз', 403);
}
export function csvCell(v: unknown) {
  let s = String(v ?? '');
  if (/^[=+@\-\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
}
export function sumMoney(values: (string | number)[]): string {
  const cents = values.reduce<bigint>((sum, value) => {
    const [whole, fraction = ''] = String(value).split('.');
    return sum + BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0').slice(0, 2));
  }, 0n);
  return `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;
}
