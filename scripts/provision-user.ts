import nextEnv from '@next/env';
import { randomUUID } from 'node:crypto';
nextEnv.loadEnvConfig(process.cwd());
const { database, insert } = await import('../src/lib/db');
const { supabaseAdmin } = await import('../src/lib/security');
const { TENANT, ROLES } = await import('../src/lib/domain');
const [email, name, role = 'observer'] = process.argv.slice(2);
if (!email || !name || !ROLES.includes(role as any))
  throw new Error(
    'Usage: npx tsx scripts/provision-user.ts email "Full name" admin|manager|dispatcher|inspector|technician|leader|observer',
  );
if (process.env.AUTH_PROVIDER !== 'supabase' || !process.env.DATABASE_URL)
  throw new Error('Configure Supabase Auth and PostgreSQL before provisioning.');
const db = await database();
// Create an auth account separately in Supabase Dashboard (no email sent by this script).
const { data, error } = await supabaseAdmin().auth.admin.listUsers({ page: 1, perPage: 1000 });
if (error) throw error;
const auth = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
if (!auth)
  throw new Error(
    'Create this user in Supabase Auth dashboard first; use the next page manually if there are over 1000 users.',
  );
await db.transaction(async (tx) => {
  const exists = (await tx.query('SELECT id FROM profiles WHERE id=$1', [auth.id])).rows[0];
  if (exists) throw new Error('Profile already exists. Change access in the app.');
  await insert(tx, 'profiles', {
    id: auth.id,
    tenant_id: TENANT,
    email: email.toLowerCase(),
    name,
    roles: [role],
  });
  await tx.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [auth.id, role]);
  await insert(tx, 'audit_logs', {
    id: randomUUID(),
    tenant_id: TENANT,
    actor_id: auth.id,
    action: 'profile.provision',
    entity_id: auth.id,
    data: { role },
  });
});
console.log('Profile provisioned.');
await db.close?.();
process.exit(0);
