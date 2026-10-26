import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const base = process.env.SMOKE_URL || 'http://127.0.0.1:3000';
const env = await fs.readFile('.env.local', 'utf8');
const password = env.match(/^DEMO_PASSWORD=(.+)$/m)?.[1].trim();
assert(password, 'Local demo password not found');
async function login(email) {
  const r = await fetch(base + '/api/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: base },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(r.status, 200);
  return r.headers.get('set-cookie').split(';')[0];
}
const admin = await login('admin@adasset.local');
const technician = await login('technician@adasset.local');
const result = await fetch(base + '/api/app', { headers: { Cookie: admin } });
assert.equal(result.status, 200);
const state = await result.json();
assert.equal(state.assets.length, 20);
assert(!state.profiles.some((p) => 'password_hash' in p));
const anonymous = await fetch(base + '/api/files/' + state.attachments[0].id);
assert.equal(anonymous.status, 401);
const first = await fetch(base + '/api/files/' + state.attachments[0].id, {
  headers: { Cookie: admin },
  redirect: 'manual',
});
assert.equal(first.status, 307);
const location = first.headers.get('location');
const file = await fetch(new URL(location, base), { headers: { Cookie: admin } });
assert.equal(file.status, 200);
assert((await file.arrayBuffer()).byteLength > 0);
const forged = new URL(location, base);
forged.searchParams.set('signature', '0'.repeat(64));
assert.equal((await fetch(forged, { headers: { Cookie: admin } })).status, 403);
const blocked = await fetch(base + '/api/app', {
  method: 'POST',
  headers: { Cookie: technician, 'Content-Type': 'application/json', Origin: base },
  body: JSON.stringify({
    action: 'document.create',
    payload: { asset_id: state.assets[0].id },
    key: crypto.randomUUID(),
  }),
});
assert.equal(blocked.status, 403);
const csrf = await fetch(base + '/api/app', {
  method: 'POST',
  headers: {
    Cookie: admin,
    'Content-Type': 'application/json',
    Origin: 'https://untrusted.invalid',
  },
  body: JSON.stringify({
    action: 'notification.read',
    payload: { all: true },
    key: crypto.randomUUID(),
  }),
});
assert.equal(csrf.status, 403);
assert.equal(
  (await fetch(base + '/api/export?type=works', { headers: { Cookie: admin } })).status,
  200,
);
assert.equal(
  (await fetch(base + '/api/export?type=works', { headers: { Cookie: technician } })).status,
  403,
);
const form = new FormData();
form.set('asset_id', state.assets[0].id);
form.set('file', new Blob(['<script>alert(1)</script>'], { type: 'image/png' }), 'forged.png');
assert.equal(
  (
    await fetch(base + '/api/files', {
      method: 'POST',
      headers: { Cookie: admin, Origin: base },
      body: form,
    })
  ).status,
  400,
);
await fetch(base + '/api/auth', {
  method: 'DELETE',
  headers: { Cookie: technician, Origin: base },
});
assert.equal((await fetch(base + '/api/app', { headers: { Cookie: technician } })).status, 401);
console.log(
  'HTTP smoke passed: login, private files, signature rejection, RBAC, CSRF, CSV, MIME validation, session revocation.',
);
