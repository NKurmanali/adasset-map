import nextEnv from '@next/env';
nextEnv.loadEnvConfig(process.cwd());
// Uses the running app API so a second process never opens the embedded database.
if (!process.env.CRON_SECRET)
  throw new Error(
    'Set CRON_SECRET in .env.local. The in-process scheduler works without this optional script.',
  );
const response = await fetch(
  new URL('/api/cron', process.env.APP_ORIGIN || 'http://127.0.0.1:3000'),
  { method: 'POST', headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } },
);
if (!response.ok) throw new Error(`Scheduler returned ${response.status}`);
console.log(await response.json());
