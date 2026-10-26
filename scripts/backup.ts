import nextEnv from '@next/env';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
nextEnv.loadEnvConfig(process.cwd());
const target = path.resolve(
  'backups',
  new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-'),
);
await fs.mkdir(target, { recursive: true });
const data = path.resolve(process.env.DATA_DIR || '.data');
if (process.env.DATABASE_URL) {
  const parsed = new URL(process.env.DATABASE_URL);
  const result = spawnSync(
    'pg_dump',
    ['--format=custom', '--file', path.join(target, 'database.dump')],
    {
      env: {
        ...process.env,
        PGHOST: parsed.hostname,
        PGPORT: parsed.port || '5432',
        PGUSER: decodeURIComponent(parsed.username),
        PGPASSWORD: decodeURIComponent(parsed.password),
        PGDATABASE: parsed.pathname.slice(1),
      },
      stdio: ['ignore', 'inherit', 'pipe'],
    },
  );
  if (result.error || result.status !== 0)
    throw new Error(
      'pg_dump failed. Check that PostgreSQL client tools are installed and connection is available.',
    );
} else {
  // The launcher removes its PID file on stop; detect the owned process before a filesystem snapshot.
  try {
    const pid = Number(await fs.readFile(path.join(data, 'database.pid'), 'utf8'));
    process.kill(pid, 0);
    throw new Error(
      'Stop AdAsset Map with Stop-AdAsset.ps1 before taking a local database backup.',
    );
  } catch (e) {
    if (
      (e as NodeJS.ErrnoException).code !== 'ENOENT' &&
      (e as NodeJS.ErrnoException).code !== 'ESRCH'
    )
      throw e;
  }
  await fs.cp(path.join(data, 'postgres'), path.join(target, 'postgres'), {
    recursive: true,
    errorOnExist: true,
  });
}
if (process.env.STORAGE_PROVIDER !== 'supabase')
  await fs.cp(path.join(data, 'files'), path.join(target, 'files'), {
    recursive: true,
    errorOnExist: true,
  });
await fs.writeFile(
  path.join(target, 'manifest.json'),
  JSON.stringify(
    {
      created_at: new Date().toISOString(),
      database: process.env.DATABASE_URL ? 'postgresql' : 'pglite',
      storage: process.env.STORAGE_PROVIDER || 'local',
      note: 'Configuration secrets intentionally excluded. Keep .env.local in a separate protected backup.',
    },
    null,
    2,
  ),
);
console.log('Backup created: ' + target);
