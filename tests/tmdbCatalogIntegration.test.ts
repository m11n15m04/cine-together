import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { MediaItem } from '../src/types.ts';
import { MediaPoster } from '../src/components/MediaPoster.tsx';

process.env.NODE_ENV = 'test';
process.env.AUTH_TOKEN_SECRET = 'tmdb-integration-tests-only-secret-32-bytes';
delete process.env.DATABASE_URL;
delete process.env.POSTGRES_URL;
delete process.env.SQL_HOST;
delete process.env.SQL_DB_NAME;
delete process.env.SQL_USER;
delete process.env.SQL_PASSWORD;
delete process.env.TMDB_API_READ_ACCESS_TOKEN;

const { createApiRouter } = await import('../src/routes/api.ts');
const { createTmdbCatalogService } = await import('../src/services/catalogService.ts');

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

async function withApi<T>(run: (baseUrl: string) => Promise<T>, catalog: Parameters<typeof createApiRouter>[0]): Promise<T> {
  const { createServer } = await import('node:http');
  const express = (await import('express')).default;
  const app = express();
  app.use(express.json({ limit: '128kb' }));
  app.use('/api', createApiRouter(catalog));
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

function createMockCatalog(fetchImpl: typeof fetch) {
  return createTmdbCatalogService({
    token: () => 'mock-server-only-tmdb-token',
    fetchImpl,
    cache: {
      async get<T>() { return null as T | null; },
      async put() {},
    },
  });
}

test('homepage movie feeds use the TMDB contracts and preserve metadata-only IDs', async () => {
  const requests: Array<{ path: string; authorization: string | null }> = [];
  const movie = {
    id: 238,
    title: 'The Godfather',
    original_title: 'The Godfather',
    release_date: '1972-03-14',
    poster_path: '/r4gnMXoY1efvaolNDjn3nj4046S.jpg',
    backdrop_path: '/tmU7GeKVybMWFButWEGl2M4GeiP.jpg',
    vote_average: 8.7,
    genre_ids: [18, 80],
    original_language: 'en',
    overview: 'A crime family drama.',
  };
  const feedPaths = new Set([
    '/3/trending/movie/week',
    '/3/movie/popular',
    '/3/movie/top_rated',
    '/3/movie/upcoming',
  ]);
  const catalog = createMockCatalog(async (input, init) => {
    const url = new URL(String(input));
    requests.push({ path: url.pathname, authorization: new Headers(init?.headers).get('authorization') });
    assert.ok(feedPaths.has(url.pathname), `unexpected TMDB request ${url.pathname}`);
    return jsonResponse({ page: 1, total_pages: 1, total_results: 1, results: [movie] });
  });

  await withApi(async (baseUrl) => {
    const endpoints = [
      '/catalog/movies/trending?page=1&window=week',
      '/catalog/movies/popular?page=1',
      '/catalog/movies/top-rated?page=1',
      '/catalog/movies/upcoming?page=1',
    ];
    for (const endpoint of endpoints) {
      const response = await fetch(baseUrl + endpoint);
      assert.equal(response.status, 200);
      const body = await response.json() as { provider: string; items: MediaItem[] };
      assert.equal(body.provider, 'TMDB');
      assert.equal(body.items[0]?.id, 'tmdb:movie:238');
      assert.equal(body.items[0]?.providerId, '238');
      assert.equal(body.items[0]?.tmdbId, 238);
      assert.equal(body.items[0]?.title, 'The Godfather');
      assert.equal(body.items[0]?.rating, 8.7);
      assert.equal(body.items[0]?.playbackStatus, 'metadata-only');
      assert.equal(body.items[0]?.streamUrl, undefined);
      assert.equal(body.items[0]?.nxshaEmbedUrl, undefined);
      assert.equal(body.items[0]?.nxshaWatchUrl, undefined);
    }
  }, catalog);

  assert.deepEqual(requests.map((request) => request.path), [
    '/3/trending/movie/week',
    '/3/movie/popular',
    '/3/movie/top_rated',
    '/3/movie/upcoming',
  ]);
  assert.ok(requests.every((request) => request.authorization === 'Bearer mock-server-only-tmdb-token'));
});

test('TV season and episode responses preserve TMDB metadata without filling missing runtime', async () => {
  const requests: string[] = [];
  const catalog = createMockCatalog(async (input) => {
    const url = new URL(String(input));
    requests.push(url.pathname);
    if (url.pathname === '/3/tv/1396') {
      return jsonResponse({
        id: 1396,
        name: 'Breaking Bad',
        first_air_date: '2008-01-20',
        vote_average: 8.9,
        seasons: [{ season_number: 1, name: 'Season 1', episode_count: 1, air_date: '2008-01-20' }],
      });
    }
    if (url.pathname === '/3/tv/1396/season/1') {
      return jsonResponse({
        season_number: 1,
        name: 'Season 1',
        episode_count: 1,
        episodes: [{ id: 1, episode_number: 1, name: 'Pilot', overview: 'The series begins.', air_date: '2008-01-20' }],
      });
    }
    return jsonResponse({ status_message: 'Unexpected TMDB route' }, 404);
  });

  await withApi(async (baseUrl) => {
    const seasonsResponse = await fetch(baseUrl + '/catalog/tv/1396/seasons');
    assert.equal(seasonsResponse.status, 200);
    const seasonsBody = await seasonsResponse.json() as {
      item: MediaItem;
      seasons: Array<{ seasonNumber: number; episodeCount: number }>;
    };
    assert.equal(seasonsBody.item.id, 'tmdb:tv:1396');
    assert.equal(seasonsBody.item.providerId, '1396');
    assert.equal(seasonsBody.item.playbackStatus, 'metadata-only');
    assert.equal(seasonsBody.item.streamUrl, undefined);
    assert.deepEqual(seasonsBody.seasons.map(({ seasonNumber, episodeCount }) => ({ seasonNumber, episodeCount })), [
      { seasonNumber: 1, episodeCount: 1 },
    ]);

    const episodesResponse = await fetch(baseUrl + '/catalog/tv/1396/seasons/1/episodes');
    assert.equal(episodesResponse.status, 200);
    const episodesBody = await episodesResponse.json() as {
      provider: string;
      season: { seasonNumber: number; episodes: Array<{ title: string; durationMinutes?: number }> };
    };
    assert.equal(episodesBody.provider, 'TMDB');
    assert.equal(episodesBody.season.seasonNumber, 1);
    assert.equal(episodesBody.season.episodes[0]?.title, 'Pilot');
    assert.equal(episodesBody.season.episodes[0]?.durationMinutes, undefined);
  }, catalog);

  assert.deepEqual(requests, ['/3/tv/1396', '/3/tv/1396/season/1']);
});

test('artwork priority is eager only for explicitly prioritized views', () => {
  const item: MediaItem = {
    id: 'tmdb:movie:238',
    providerId: '238',
    tmdbId: 238,
    title: 'The Godfather',
    mediaType: 'movie',
    platform: 'Unverified',
    releaseDate: '1972-03-14',
    year: '1972',
    genres: [],
    language: 'en',
    description: '',
    posterUrl: 'https://image.tmdb.org/t/p/w500/r4gnMXoY1efvaolNDjn3nj4046S.jpg',
    backdropUrl: 'https://image.tmdb.org/t/p/w1280/tmU7GeKVybMWFButWEGl2M4GeiP.jpg',
    metadataProvider: 'TMDB',
    playbackStatus: 'metadata-only',
    accentColor: '#0f172a',
    secondaryColor: '#020617',
    director: '',
    cast: [],
  };
  const priorityMarkup = renderToStaticMarkup(createElement(MediaPoster, { item, variant: 'backdrop', priority: true }));
  const eagerMarkup = renderToStaticMarkup(createElement(MediaPoster, { item, variant: 'poster', eager: true }));
  const lazyMarkup = renderToStaticMarkup(createElement(MediaPoster, { item, variant: 'poster' }));

  assert.match(priorityMarkup, /loading="eager"/);
  assert.match(priorityMarkup, /fetchPriority="high"/);
  assert.match(eagerMarkup, /loading="eager"/);
  assert.match(eagerMarkup, /fetchPriority="auto"/);
  assert.match(lazyMarkup, /loading="lazy"/);
  assert.match(lazyMarkup, /fetchPriority="auto"/);
});
