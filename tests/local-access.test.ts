import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localPasswordlessAllowed } from '../src/lib/local-access';

test('Passwordless access is opt-in and restricted to the local demo', () => {
  const settings = {
    LOCAL_PASSWORDLESS_LOGIN: 'true',
    AUTH_PROVIDER: 'local',
    DEMO_SEED: 'true',
    DATABASE_URL: '',
    APP_ORIGIN: 'http://127.0.0.1:3000',
  };
  const previous = Object.fromEntries(Object.keys(settings).map((key) => [key, process.env[key]]));
  const allowed = (host: string) => localPasswordlessAllowed(new Headers({ host }));
  try {
    Object.assign(process.env, settings);
    for (const host of ['127.0.0.1:3000', 'localhost:3000', '[::1]:3000']) {
      assert.equal(allowed(host), true, host);
    }
    for (const host of ['', 'example.com', '192.168.1.5:3000', 'localhost.evil.com', 'localhost@evil.com']) {
      assert.equal(allowed(host), false, host);
    }
    for (const override of [
      { LOCAL_PASSWORDLESS_LOGIN: '' },
      { LOCAL_PASSWORDLESS_LOGIN: 'false' },
      { AUTH_PROVIDER: 'supabase' },
      { DEMO_SEED: 'false' },
      { DATABASE_URL: 'postgresql://localhost/app' },
      { APP_ORIGIN: 'https://example.com' },
      { APP_ORIGIN: 'invalid' },
    ]) {
      Object.assign(process.env, settings, override);
      assert.equal(allowed('localhost:3000'), false, JSON.stringify(override));
    }
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
