import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { cookies } from 'next/headers';
import { createClient } from '@supabase/supabase-js';
import { database, flatten } from './db';
import { AppError, assert, type Row } from './domain';
import { localPasswordlessAllowed } from './local-access';
export const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export function passwordHash(password: string) {
  const salt = randomBytes(16).toString('hex');
  return salt + ':' + scryptSync(password, salt, 64).toString('hex');
}
export function passwordMatches(password: string, encoded: string) {
  try {
    const [salt, key] = encoded.split(':');
    return timingSafeEqual(Buffer.from(key, 'hex'), scryptSync(password, salt, 64));
  } catch {
    return false;
  }
}
export function supabaseAdmin() {
  assert(
    process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY,
    'Supabase не настроен',
    503,
  );
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
export const safeProfile = (p: Row) => {
  const { password_hash, ...safe } = p;
  return safe;
};
export async function currentUser(): Promise<Row> {
  const token = (await cookies()).get('adasset_session')?.value;
  assert(token, 'Требуется вход', 401);
  const db = await database();
  const result = await db.query(
    'SELECT p.* FROM sessions s JOIN profiles p ON p.id=s.user_id WHERE s.id=$1 AND s.expires_at>now() AND p.active=true',
    [hash(token)],
  );
  assert(result.rows[0], 'Сессия истекла. Войдите снова.', 401);
  return safeProfile(flatten(result.rows[0]));
}
export async function login(email: string, password: string) {
  const db = await database();
  const key = hash(email.toLowerCase());
  const attempts = (
    await db.query('SELECT * FROM login_attempts WHERE key=$1 AND reset_at>now()', [key])
  ).rows[0];
  assert(!attempts || attempts.attempts < 10, 'Слишком много попыток. Подождите 15 минут.', 429);
  let user: Row | undefined;
  if (process.env.AUTH_PROVIDER === 'supabase') {
    assert(
      process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY,
      'Supabase Auth не настроен',
      503,
    );
    const auth = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const result = await auth.auth.signInWithPassword({ email, password });
    if (result.data.user && !result.error)
      user = (
        await db.query('SELECT * FROM profiles WHERE id=$1 AND active=true', [result.data.user.id])
      ).rows[0];
  } else {
    const candidate = (
      await db.query('SELECT * FROM profiles WHERE lower(email)=lower($1) AND active=true', [email])
    ).rows[0];
    if (candidate && passwordMatches(password, candidate.password_hash || '')) user = candidate;
    else passwordMatches(password, '0000000000000000:' + '00'.repeat(64));
  }
  if (!user) {
    await db.query(
      "INSERT INTO login_attempts(key,attempts,reset_at) VALUES($1,1,now()+interval '15 minutes') ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN login_attempts.reset_at<now() THEN 1 ELSE login_attempts.attempts+1 END, reset_at=CASE WHEN login_attempts.reset_at<now() THEN now()+interval '15 minutes' ELSE login_attempts.reset_at END",
      [key],
    );
    throw new AppError('Неверный email или пароль', 401);
  }
  await db.query('DELETE FROM login_attempts WHERE key=$1', [key]);
  return createSession(user);
}
export async function loginWithoutPassword(req: Request) {
  checkOrigin(req);
  assert(localPasswordlessAllowed(req.headers), 'Вход без пароля доступен только локально', 403);
  const db = await database();
  const user = (
    await db.query(
      "SELECT * FROM profiles WHERE email=$1 AND active=true AND data->>'demo'='true' AND 'admin'=ANY(roles)",
      ['admin@adasset.local'],
    )
  ).rows[0];
  assert(user, 'Локальный администратор недоступен', 403);
  return createSession(user);
}
async function createSession(user: Row) {
  const db = await database();
  const token = randomBytes(32).toString('hex');
  await db.query(
    "INSERT INTO sessions(id,user_id,expires_at) VALUES($1,$2,now()+interval '12 hours')",
    [hash(token), user.id],
  );
  (await cookies()).set('adasset_session', token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.APP_ORIGIN?.startsWith('https://') || false,
    path: '/',
    maxAge: 43200,
  });
  return safeProfile(user);
}
export async function logout() {
  const cookie = await cookies();
  const token = cookie.get('adasset_session')?.value;
  if (token) await (await database()).query('DELETE FROM sessions WHERE id=$1', [hash(token)]);
  cookie.delete('adasset_session');
}
export function checkOrigin(req: Request) {
  const origin = req.headers.get('origin');
  const url = new URL(req.url);
  const sameHost =
    origin &&
    new URL(origin).host === req.headers.get('host') &&
    new URL(origin).protocol === url.protocol;
  assert(
    !origin || sameHost || origin === url.origin || origin === process.env.APP_ORIGIN,
    'Недопустимый источник запроса',
    403,
  );
}
