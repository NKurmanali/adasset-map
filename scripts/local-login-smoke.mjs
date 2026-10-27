import assert from 'node:assert/strict';
import http from 'node:http';

const base = process.env.SMOKE_URL || 'http://127.0.0.1:3000';
const signIn = (headers = {}) => fetch(base + '/api/auth', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: base, ...headers },
  body: JSON.stringify({ mode: 'local' }),
});

assert.equal((await fetch(base + '/api/app')).status, 401);
assert.equal((await signIn({ Origin: 'https://untrusted.invalid' })).status, 403);
// Node's fetch normalizes Host; use a raw HTTP request to exercise this boundary.
const foreignHostStatus = await new Promise((resolve, reject) => {
  const request = http.request(base + '/api/auth', {
    method: 'POST',
    headers: { Host: 'untrusted.invalid', Origin: base, 'Content-Type': 'application/json' },
  }, (response) => {
    response.resume();
    response.on('end', () => resolve(response.statusCode));
  });
  request.on('error', reject);
  request.end(JSON.stringify({ mode: 'local' }));
});
assert.equal(foreignHostStatus, 403);

const response = await signIn();
assert.equal(response.status, 200);
const { user } = await response.json();
assert.equal(user.email, 'admin@adasset.local');
assert(user.roles.includes('admin'));
assert(!('password_hash' in user));
const setCookie = response.headers.get('set-cookie');
assert(setCookie?.includes('HttpOnly'));
assert(/SameSite=strict/i.test(setCookie));
const cookie = setCookie.split(';')[0];

try {
  const app = await fetch(base + '/api/app', { headers: { Cookie: cookie } });
  assert.equal(app.status, 200);
  const state = await app.json();
  assert.equal(state.user.id, user.id);
  assert(Array.isArray(state.assets));
  assert(!state.profiles.some((profile) => 'password_hash' in profile));
  const restored = await fetch(base + '/api/auth', { headers: { Cookie: cookie } });
  assert.equal(restored.status, 200);
  assert.equal((await restored.json()).user.id, user.id);
} finally {
  const logout = await fetch(base + '/api/auth', {
    method: 'DELETE',
    headers: { Cookie: cookie, Origin: base },
  });
  assert.equal(logout.status, 200);
}

assert.equal((await fetch(base + '/api/app', { headers: { Cookie: cookie } })).status, 401);
console.log('Passwordless smoke passed: local admin login, private data, restored session, logout, host and origin restrictions.');
