import fs from 'node:fs/promises';
import { readFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Pool } from 'pg';
import type { Row } from './domain';
export interface DB {
  close?(): Promise<void>;
  query<T extends Row = Row>(sql: string, params?: any[]): Promise<{ rows: T[] }>;
  exec(sql: string): Promise<unknown>;
  transaction<T>(fn: (tx: DB) => Promise<T>): Promise<T>;
}
const globals = globalThis as typeof globalThis & { adassetDB?: Promise<DB> };
export const dataDir = () => path.resolve(process.env.DATA_DIR || '.data');
export async function createDB(location?: string): Promise<DB> {
  if (process.env.DATABASE_URL && !location) {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 8 });
    const adapter = (client: Pick<Pool, 'query'>): DB => ({
      close: () => pool.end(),
      query: async (s, p) => (await client.query(s, p)) as any,
      exec: async (s) => client.query(s),
      transaction: async (fn) => {
        const c = await pool.connect();
        try {
          await c.query('BEGIN');
          const result = await fn(adapter(c as any));
          await c.query('COMMIT');
          return result;
        } catch (e) {
          await c.query('ROLLBACK');
          throw e;
        } finally {
          c.release();
        }
      },
    });
    return adapter(pool);
  }
  const dir = location || path.join(dataDir(), 'postgres');
  if (dir !== 'memory://') {
    await fs.mkdir(dir, { recursive: true });
    const lock = path.join(path.dirname(dir), 'database.pid');
    try {
      const pid = Number(await fs.readFile(lock, 'utf8'));
      let alive = false;
      if (!Number.isInteger(pid) || pid <= 0) throw new Error('Invalid database lock file.');
      try { process.kill(pid, 0); alive = true; } catch {}
      if (alive) throw new Error('Embedded database is already open. Stop the other AdAsset Map process first.');
      await fs.unlink(lock);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
    const handle = await fs.open(lock, 'wx');
    await handle.writeFile(String(process.pid));
    await handle.close();
    process.once('exit', () => {
      try {
        if (readFileSync(lock, 'utf8') === String(process.pid)) unlinkSync(lock);
      } catch {}
    });
  }
  const pg = new PGlite(dir);
  await pg.waitReady;
  return pg as unknown as DB;
}
export async function migrate(db: DB) {
  await db.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
  );
  for (const file of (await fs.readdir(path.join(process.cwd(), 'migrations')))
    .filter((f) => /^\d+.*\.sql$/.test(f))
    .sort()) {
    if (
      (await db.query('SELECT version FROM schema_migrations WHERE version=$1', [file])).rows.length
    )
      continue;
    const sql = await fs.readFile(path.join(process.cwd(), 'migrations', file), 'utf8');
    await db.transaction(async (tx) => {
      await tx.exec(sql);
      await tx.query('INSERT INTO schema_migrations(version) VALUES($1)', [file]);
    });
  }
}
export async function database(): Promise<DB> {
  if (!globals.adassetDB)
    globals.adassetDB = (async () => {
      const db = await createDB();
      await migrate(db);
      const { seed } = await import('./seed');
      await seed(db);
      return db;
    })();
  return globals.adassetDB;
}
export const flatten = (r: Row): Row => ({ ...r.data, ...r, data: undefined });
export async function rows(db: DB, table: string, tenant: string) {
  return (await db.query(`SELECT * FROM ${table} WHERE tenant_id=$1`, [tenant])).rows.map(flatten);
}
export async function insert(db: DB, table: string, values: Row) {
  const keys = Object.keys(values);
  const vals = keys.map((k) => values[k]);
  return flatten(
    (
      await db.query(
        `INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map((_, i) => '$' + (i + 1)).join(',')}) RETURNING *`,
        vals,
      )
    ).rows[0],
  );
}
