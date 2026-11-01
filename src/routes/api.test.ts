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
delete process.env.TMDB_API_READ_ACCESS_TOKEN;
const { createApiRouter } = await import('./api.ts');
const { createTmdbCatalogService } = await import('../services/catalogService.ts');

async function withApi<T>(
  run: (baseUrl: string) => Promise<T>,
  catalog?: ReturnType<typeof createTmdbCatalogService>,
): Promise<T> {
  const app = express();
  app.use(express.json({ limit: '128kb' }));
  app.use('/api', createApiRouter(catalog));
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try {
    return await run('http://127.0.0.1:' + address.port + '/api');
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test('guest session endpoint returns a signed guest token and validates its body', async () => {
  await withApi(async (baseUrl) => {
    const response = await fetch(baseUrl + '/auth/guest-session', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ displayName: 'Movie Fan' }),
    });
    assert.equal(response.status, 201);
    const body = await response.json() as { data?: { token?: string; guestId?: string } };
    assert.ok(body.data?.token);
    assert.ok(body.data?.guestId?.startsWith('guest-'));

    const invalid = await fetch(baseUrl + '/auth/guest-session', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ displayName: 42 }),
    });
    assert.equal(invalid.status, 400);
    assert.equal(typeof (await invalid.json() as { error?: unknown }).error, 'string');
  });
});

test('private user endpoints reject requests without Firebase authentication', async () => {
  await withApi(async (baseUrl) => {
    const response = await fetch(baseUrl + '/watchlist');
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: 'Sign-in is required.' });
  });
});

test('catalog metadata without an authorized source reports unavailable playback', async () => {
  await withApi(async (baseUrl) => {
    const response = await fetch(baseUrl + '/media/availability/metadata-only-film');
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      mediaId: 'metadata-only-film',
      available: false,
      status: 'metadata-only',
      message: 'No authorized playback source is configured for this title.',
    });
  });
});

test('TMDB catalog returns explicit unavailable states when the server token is missing', async () => {
  await withApi(async (baseUrl) => {
    const feed = await fetch(baseUrl + '/catalog/feed?section=trending');
    assert.equal(feed.status, 503);
    const feedBody = await feed.json() as { code: string; provider: string; state: string; error: string };
    assert.equal(feedBody.code, 'TMDB_TOKEN_REQUIRED');
    assert.equal(feedBody.provider, 'TMDB');
    assert.equal(feedBody.state, 'unavailable');
    assert.match(feedBody.error, /TMDB_API_READ_ACCESS_TOKEN/);

    const search = await fetch(baseUrl + '/catalog/movies/search?q=example');
    assert.equal(search.status, 503);
    const searchBody = await search.json() as { code: string; provider: string; state: string };
    assert.equal(searchBody.code, 'TMDB_TOKEN_REQUIRED');
    assert.equal(searchBody.provider, 'TMDB');
    assert.equal(searchBody.state, 'unavailable');

    const health = await fetch(baseUrl + '/catalog/status');
    assert.equal(health.status, 503);
    assert.equal((await health.json() as { provider: string; configured: boolean }).provider, 'TMDB');
  });
});

test('TMDB movie search returns real metadata and keeps the token server-side', async () => {
  let authorization = '';
  const catalog = createTmdbCatalogService({
    token: () => 'server-only-token',
    fetchImpl: async (_input, init) => {
      authorization = new Headers(init?.headers).get('authorization') || '';
      return new Response(JSON.stringify({
        page: 1,
        total_pages: 1,
        total_results: 1,
        results: [{
          id: 238,
          title: 'The Godfather',
          release_date: '1972-03-14',
          vote_average: 8.7,
          poster_path: '/r4gnMXoY1efvaolNDjn3nj4046S.jpg',
          backdrop_path: '/tmU7GeKVybMWFButWEGl2M4GeiP.jpg',
          genre_ids: [18],
          original_language: 'en',
          overview: 'A provider supplied description.',
        }],
      }), { headers: { 'content-type': 'application/json' } });
    },
    cache: { async get() { return null; }, async put() {} },
  });
  await withApi(async (baseUrl) => {
    const response = await fetch(baseUrl + '/catalog/movies/search?q=Godfather');
    assert.equal(response.status, 200);
    const body = await response.json() as { provider: string; items: Array<Record<string, unknown>> };
    assert.equal(body.provider, 'TMDB');
    assert.equal(body.items[0]?.title, 'The Godfather');
    assert.equal(body.items[0]?.posterUrl, 'https://image.tmdb.org/t/p/w500/r4gnMXoY1efvaolNDjn3nj4046S.jpg');
    assert.equal(body.items[0]?.playbackStatus, 'metadata-only');
    assert.equal(body.items[0]?.streamUrl, undefined);
    assert.doesNotMatch(JSON.stringify(body), /server-only-token/);
  }, catalog);
  assert.equal(authorization, 'Bearer server-only-token');
});

test('catalog health reports TMDB metadata status and Nxsha playback separately', async () => {
  await withApi(async (baseUrl) => {
    const response = await fetch(baseUrl + '/health/catalog');
    assert.equal(response.status, 503);
    const body = await response.json() as { status: string; provider: string; playbackProvider: string; playbackIndependent: boolean };
    assert.equal(body.status, 'unavailable');
    assert.equal(body.provider, 'TMDB');
    assert.equal(body.playbackProvider, 'Nxsha');
    assert.equal(body.playbackIndependent, true);
  });
});

test('catalog health says token configured without claiming provider reachability', async () => {
  const catalog = createTmdbCatalogService({
    token: () => 'server-token',
    fetchImpl: async () => new Response('{}'),
    cache: { async get() { return null; }, async put() {} },
  });
  await withApi(async (baseUrl) => {
    const response = await fetch(baseUrl + '/catalog/status');
    assert.equal(response.status, 200);
    const body = await response.json() as { status: string; configured: boolean };
    assert.equal(body.status, 'configured');
    assert.equal(body.configured, true);
  }, catalog);
});

test('invalid TMDB catalog filters return 400 before contacting the provider', async () => {
  let requests = 0;
  const catalog = createTmdbCatalogService({
    token: () => 'server-token',
    fetchImpl: async () => { requests += 1; return new Response('{}'); },
    cache: { async get() { return null; }, async put() {} },
  });
  await withApi(async (baseUrl) => {
    const response = await fetch(baseUrl + '/catalog/movies/discover?genre=not-a-number&year=2024');
    assert.equal(response.status, 400);
    assert.equal(requests, 0);
  }, catalog);
});

test('movie, TV, genre, recommendation, season, and episode API routes reach their TMDB v3 endpoints', async () => {
  const providerPaths: string[] = [];
  const catalog = createTmdbCatalogService({
    token: () => 'server-token',
    fetchImpl: async (input) => {
      const url = new URL(String(input));
      providerPaths.push(url.pathname);
      if (url.pathname.startsWith('/3/genre/')) return new Response(JSON.stringify({ genres: [] }), { headers: { 'content-type': 'application/json' } });
      if (url.pathname === '/3/movie/238') return new Response(JSON.stringify({ id: 238, title: 'Test Movie', release_date: '2024-01-01' }), { headers: { 'content-type': 'application/json' } });
      if (url.pathname === '/3/tv/1396') return new Response(JSON.stringify({ id: 1396, name: 'Test Series', seasons: [] }), { headers: { 'content-type': 'application/json' } });
      if (url.pathname === '/3/tv/1396/season/1') return new Response(JSON.stringify({ season_number: 1, name: 'Season 1', episodes: [] }), { headers: { 'content-type': 'application/json' } });
      return new Response(JSON.stringify({ page: 1, total_pages: 0, total_results: 0, results: [] }), { headers: { 'content-type': 'application/json' } });
    },
    cache: { async get() { return null; }, async put() {} },
  });

  const paths = [
    '/catalog/movies/popular?page=2',
    '/catalog/movies/trending?window=day',
    '/catalog/movies/top-rated',
    '/catalog/movies/now-playing',
    '/catalog/movies/upcoming',
    '/catalog/movies/discover?genre=18&year=2024',
    '/catalog/movies/search?q=Test',
    '/catalog/movies/238',
    '/catalog/movies/238/recommendations',
    '/catalog/genres/movie',
    '/catalog/tv/popular',
    '/catalog/tv/trending?window=week',
    '/catalog/tv/search?q=Test',
    '/catalog/tv/discover?genre=18&year=2024',
    '/catalog/genres/tv',
    '/catalog/tv/1396',
    '/catalog/tv/1396/seasons',
    '/catalog/tv/1396/seasons/1',
    '/catalog/tv/1396/seasons/1/episodes',
  ];
  await withApi(async (baseUrl) => {
    for (const path of paths) {
      const response = await fetch(baseUrl + path);
      assert.equal(response.status, 200, `${path} should succeed`);
      const body = await response.json() as { provider?: string };
      assert.equal(body.provider, 'TMDB', `${path} should identify TMDB metadata`);
    }
  }, catalog);

  for (const path of [
    '/3/movie/popular', '/3/trending/movie/day', '/3/movie/top_rated', '/3/movie/now_playing', '/3/movie/upcoming',
    '/3/discover/movie', '/3/search/movie', '/3/movie/238', '/3/movie/238/recommendations', '/3/genre/movie/list',
    '/3/tv/popular', '/3/trending/tv/week', '/3/search/tv', '/3/discover/tv', '/3/genre/tv/list', '/3/tv/1396', '/3/tv/1396/season/1',
  ]) assert.ok(providerPaths.includes(path), `route should call ${path}`);
});

test('invalid trending windows are rejected rather than silently normalized', async () => {
  let requests = 0;
  const catalog = createTmdbCatalogService({
    token: () => 'server-token',
    fetchImpl: async () => { requests += 1; return new Response('{}'); },
    cache: { async get() { return null; }, async put() {} },
  });
  await withApi(async (baseUrl) => {
    for (const path of ['/catalog/movies/trending?window=month', '/catalog/tv/trending?window=month']) {
      const response = await fetch(baseUrl + path);
      assert.equal(response.status, 400);
    }
  }, catalog);
  assert.equal(requests, 0);
});

test('health endpoint reports database degradation when PostgreSQL is not configured', async () => {
  await withApi(async (baseUrl) => {
    const response = await fetch(baseUrl + '/health');
    assert.equal(response.status, 503);
    const body = await response.json() as { status: string; database: string; timestamp: string };
    assert.equal(body.status, 'degraded');
    assert.equal(body.database, 'unavailable');
    assert.ok(Number.isFinite(Date.parse(body.timestamp)));
  });
});
