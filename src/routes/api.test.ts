import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import express from 'express';

process.env.NODE_ENV = 'test';
process.env.AUTH_TOKEN_SECRET = 'tests-only-secret-with-at-least-32-bytes';
delete process.env.DATABASE_URL;
delete process.env.POSTGRES_URL;
delete process.env.SQL_HOST;
delete process.env.SQL_DB_NAME;
delete process.env.SQL_USER;
delete process.env.SQL_PASSWORD;
const { createApiRouter } = await import('./api.ts');

async function withApi<T>(run: (baseUrl: string) => Promise<T>): Promise<T> {
  const app = express();
  app.use(express.json({ limit: '128kb' }));
  app.use('/api', createApiRouter());
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try {
    return await run(`http://127.0.0.1:${address.port}/api`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test('guest session endpoint returns a signed guest token and validates its body', async () => {
  await withApi(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/auth/guest-session`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ displayName: 'Movie Fan' }),
    });
    assert.equal(response.status, 201);
    const body = await response.json() as { data?: { token?: string; guestId?: string } };
    assert.ok(body.data?.token);
    assert.ok(body.data?.guestId?.startsWith('guest-'));

    const invalid = await fetch(`${baseUrl}/auth/guest-session`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ displayName: 42 }),
    });
    assert.equal(invalid.status, 400);
    assert.equal(typeof (await invalid.json() as { error?: unknown }).error, 'string');
  });
});

test('private user endpoints reject requests without Firebase authentication', async () => {
  await withApi(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/watchlist`);
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: 'Sign-in is required.' });
  });
});

test('catalog metadata without an authorized source reports unavailable playback', async () => {
  await withApi(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/media/availability/metadata-only-film`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      mediaId: 'metadata-only-film',
      available: false,
      status: 'metadata-only',
      message: 'No authorized playback source is configured for this title.',
    });
  });
});

test('health endpoint reports database degradation when PostgreSQL is not configured', async () => {
  await withApi(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/health`);
    assert.equal(response.status, 503);
    const body = await response.json() as { status: string; database: string; timestamp: string };
    assert.equal(body.status, 'degraded');
    assert.equal(body.database, 'unavailable');
    assert.ok(Number.isFinite(Date.parse(body.timestamp)));
  });
});
