import assert from 'node:assert/strict';
import { test } from 'node:test';
import request from 'supertest';
import { createApp, keyRejectionReason, readSupabaseConfig } from '../server/app.js';

const SUPABASE_URL = 'https://gglslcqrkurpxwkvjvek.supabase.co';

function jwt(payload: Record<string, unknown>): string {
  const encode = (value: Record<string, unknown>) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}.test-signature`;
}

const ANON_KEY = jwt({ role: 'anon', iss: 'supabase' });

test('health endpoint reports the server is up', async () => {
  const response = await request(createApp({})).get('/api/health').expect(200);
  assert.equal(response.body.status, 'ok');
  assert.equal(typeof response.body.uptimeSeconds, 'number');
});

test('config endpoint serves the Supabase URL and publishable key', async () => {
  const response = await request(
    createApp({ SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY: ANON_KEY }),
  )
    .get('/api/config')
    .expect(200);

  assert.deepEqual(response.body, {
    supabaseUrl: SUPABASE_URL,
    supabasePublishableKey: ANON_KEY,
  });
  assert.equal(response.headers['cache-control'], 'no-store');
});

test('config endpoint reports missing environment variables', async () => {
  const response = await request(createApp({})).get('/api/config').expect(503);

  assert.equal(response.body.error, 'Supabase is not configured.');
  assert.deepEqual(response.body.problems, [
    'SUPABASE_URL is not set.',
    'SUPABASE_PUBLISHABLE_KEY is not set.',
  ]);
});

test('config endpoint refuses a service_role token', async () => {
  const response = await request(
    createApp({ SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY: jwt({ role: 'service_role' }) }),
  )
    .get('/api/config')
    .expect(503);

  assert.match(response.body.problems.join(' '), /service-role/i);
  assert.equal(response.body.supabasePublishableKey, undefined);
});

test('config endpoint refuses a secret key prefix', async () => {
  const response = await request(
    createApp({ SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY: 'sb_secret_abc123' }),
  )
    .get('/api/config')
    .expect(503);

  assert.match(response.body.problems.join(' '), /secret key/i);
});

test('config endpoint rejects an invalid project URL', async () => {
  const response = await request(
    createApp({ SUPABASE_URL: 'not-a-url', SUPABASE_PUBLISHABLE_KEY: ANON_KEY }),
  )
    .get('/api/config')
    .expect(503);

  assert.match(response.body.problems.join(' '), /SUPABASE_URL is not a valid URL/);
});

test('config endpoint rejects remote Supabase URLs over plain HTTP', async () => {
  const response = await request(
    createApp({ SUPABASE_URL: 'http://supabase.example.com', SUPABASE_PUBLISHABLE_KEY: ANON_KEY }),
  )
    .get('/api/config')
    .expect(503);

  assert.match(response.body.problems.join(' '), /must use HTTPS/i);
});

test('config endpoint allows local HTTP for Supabase development', async () => {
  const response = await request(
    createApp({ SUPABASE_URL: 'http://127.0.0.1:54321', SUPABASE_PUBLISHABLE_KEY: ANON_KEY }),
  )
    .get('/api/config')
    .expect(200);

  assert.equal(response.body.supabaseUrl, 'http://127.0.0.1:54321');
});

test('config endpoint rejects credentials embedded in the Supabase URL', async () => {
  const response = await request(
    createApp({ SUPABASE_URL: 'https://user:password@supabase.example.com', SUPABASE_PUBLISHABLE_KEY: ANON_KEY }),
  )
    .get('/api/config')
    .expect(503);

  assert.match(response.body.problems.join(' '), /must not contain embedded credentials/i);
});

test('keyRejectionReason accepts publishable keys', () => {
  assert.equal(keyRejectionReason(ANON_KEY), null);
  assert.equal(keyRejectionReason('sb_publishable_abc123'), null);
  assert.notEqual(keyRejectionReason('sb_secret_abc123'), null);
  assert.notEqual(keyRejectionReason(jwt({ role: 'service_role' })), null);
  assert.notEqual(keyRejectionReason('   '), null);
});

test('config endpoint rejects a non-anon legacy JWT key', async () => {
  const response = await request(
    createApp({ SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY: jwt({ role: 'authenticated' }) }),
  )
    .get('/api/config')
    .expect(503);

  assert.match(response.body.problems.join(' '), /must have the anon role/i);
});

test('readSupabaseConfig trims surrounding whitespace', () => {
  const { config, problems } = readSupabaseConfig({
    SUPABASE_URL: ` ${SUPABASE_URL} `,
    SUPABASE_PUBLISHABLE_KEY: ` ${ANON_KEY} `,
  });
  assert.deepEqual(problems, []);
  assert.deepEqual(config, { supabaseUrl: SUPABASE_URL, supabasePublishableKey: ANON_KEY });
});

test('the demo JSON API is gone', async () => {
  const app = createApp({ SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY: ANON_KEY });

  for (const path of ['/api/members', '/api/alerts', '/api/overview']) {
    const response = await request(app).get(path).expect(404);
    assert.equal(response.body.error, 'Endpoint not found.');
  }
});
