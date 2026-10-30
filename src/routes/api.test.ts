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

test('Nxsha catalog feed and search return explicit unavailable states without TMDB or undocumented requests', async () => {
  await withApi(async (baseUrl) => {
    const feed = await fetch(`${baseUrl}/catalog/feed?section=trending`);
    assert.equal(feed.status, 503);
    const feedBody = await feed.json() as { code: string; provider: string; state: string; items: unknown[] };
    assert.equal(feedBody.code, 'NXSHA_CATALOG_API_ACCESS_REQUIRED');
    assert.equal(feedBody.provider, 'Nxsha');
    assert.equal(feedBody.state, 'unavailable');
    assert.deepEqual(feedBody.items, []);

    const search = await fetch(`${baseUrl}/catalog/search?q=example`);
    assert.equal(search.status, 503);
    const searchBody = await search.json() as { code: string; provider: string; state: string; items: unknown[] };
    assert.equal(searchBody.code, 'NXSHA_CATALOG_API_ACCESS_REQUIRED');
    assert.equal(searchBody.provider, 'Nxsha');
    assert.equal(searchBody.state, 'unavailable');
    assert.deepEqual(searchBody.items, []);

    const seasons = await fetch(`${baseUrl}/catalog/nxsha-provider-id/seasons`);
    assert.equal(seasons.status, 503);
    assert.equal((await seasons.json() as { code: string }).code, 'NXSHA_CATALOG_API_ACCESS_REQUIRED');
  });
});

test('catalog health discloses missing official catalog API access', async () => {
  await withApi(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/health/catalog`);
    assert.equal(response.status, 503);
    const body = await response.json() as { status: string; provider: { name: string; catalogApi: { documented: boolean } } };
    assert.equal(body.status, 'unavailable');
    assert.equal(body.provider.name, 'Nxsha');
    assert.equal(body.provider.catalogApi.documented, false);
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
