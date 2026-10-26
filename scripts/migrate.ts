import nextEnv from '@next/env';
nextEnv.loadEnvConfig(process.cwd());
const { database } = await import('../src/lib/db');
const db = await database();
await db.close?.();
console.log('Migrations and initialization completed.');
process.exit(0);
