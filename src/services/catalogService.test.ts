import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createTmdbCatalogService,
  TmdbCatalogError,
  tmdbCatalogCacheKey,
} from './catalogService.ts';

const jsonResponse = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

test('catalog cache keys are stable, provider scoped, and hide search text', () => {
  const first = tmdbCatalogCacheKey('/search/movie', { query: 'private title', page: 1 });
  const reordered = tmdbCatalogCacheKey('/search/movie', { page: 1, query: 'private title' });
  const differentQuery = tmdbCatalogCacheKey('/search/movie', { query: 'another title', page: 1 });
  const otherRoute = tmdbCatalogCacheKey('/search/tv', { query: 'private title', page: 1 });
  assert.equal(first, reordered);
  assert.notEqual(first, differentQuery);
  assert.notEqual(first, otherRoute);
  assert.doesNotMatch(first, /private title/i);
});

test('popular movies use the server bearer token and retain genuine TMDB metadata and image paths', async () => {
  let requestUrl = '';
  let authorization = '';
  let fetchCount = 0;
  const cacheRows = new Map<string, unknown>();
  const service = createTmdbCatalogService({
    token: () => 'server-secret',
    fetchImpl: async (input, init) => {
      fetchCount += 1;
      requestUrl = String(input);
      authorization = new Headers(init?.headers).get('authorization') || '';
      return jsonResponse({
        page: 1,
        total_pages: 1,
        total_results: 1,
        results: [{
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
        }],
      });
    },
    cache: {
      async get<T>(key: string) { return (cacheRows.get(key) as T | undefined) ?? null; },
      async put(key: string, value: unknown) { cacheRows.set(key, value); },
    },
  });

  const response = await service.popularMovies(1);
  const item = response.items[0];
  assert.equal(new URL(requestUrl).pathname, '/3/movie/popular');
  assert.equal(authorization, 'Bearer server-secret');
  assert.equal(item?.id, 'tmdb:movie:238');
  assert.equal(item?.tmdbId, 238);
  assert.equal(item?.title, 'The Godfather');
  assert.equal(item?.rating, 8.7);
  assert.equal(item?.posterUrl, 'https://image.tmdb.org/t/p/w500/r4gnMXoY1efvaolNDjn3nj4046S.jpg');
  assert.equal(item?.backdropUrl, 'https://image.tmdb.org/t/p/w1280/tmU7GeKVybMWFButWEGl2M4GeiP.jpg');
  assert.equal(item?.playbackStatus, 'metadata-only');
  assert.equal(item?.streamUrl, undefined);
  await service.popularMovies(1);
  assert.equal(fetchCount, 1);
});

test('trending, TV search, details, and season episode metadata use their TMDB v3 routes', async () => {
  const calls: string[] = [];
  const service = createTmdbCatalogService({
    token: () => 'token',
    fetchImpl: async (input) => {
      const url = new URL(String(input));
      calls.push(url.pathname + url.search);
      if (url.pathname.endsWith('/trending/movie/week')) return jsonResponse({ page: 1, total_pages: 1, total_results: 0, results: [] });
      if (url.pathname === '/3/search/tv') return jsonResponse({ page: 1, total_pages: 1, total_results: 1, results: [{
        id: 1396, name: 'Breaking Bad', first_air_date: '2008-01-20', genre_ids: [18, 80], vote_average: 8.9,
      }] });
      if (url.pathname === '/3/tv/1396') return jsonResponse({
        id: 1396, name: 'Breaking Bad', first_air_date: '2008-01-20', vote_average: 8.9,
        seasons: [{ season_number: 1, name: 'Season 1', episode_count: 7, air_date: '2008-01-20' }],
      });
      if (url.pathname === '/3/tv/1396/season/1') return jsonResponse({
        season_number: 1, name: 'Season 1', episode_count: 1,
        episodes: [{ id: 1, episode_number: 1, name: 'Pilot', overview: 'The series begins.', air_date: '2008-01-20' }],
      });
      return jsonResponse({ genres: [] });
    },
    cache: { async get() { return null; }, async put() {} },
  });

  await service.trendingMovies(1);
  const search = await service.searchTv('Breaking Bad', 1, 2008);
  assert.equal(search.items[0]?.title, 'Breaking Bad');
  const details = await service.tvDetails(1396);
  assert.equal(details.item.tmdbId, 1396);
  assert.equal(details.seasons[0]?.episodeCount, 7);
  const season = await service.tvSeason(1396, 1);
  assert.equal(season.episodes[0]?.title, 'Pilot');
  assert.match(calls[0], /\/3\/trending\/movie\/week/);
  assert.ok(calls.some((call) => call.startsWith('/3/search/tv?') && call.includes('first_air_date_year=2008')));
  assert.ok(calls.some((call) => call.startsWith('/3/tv/1396?') && call.includes('append_to_response=aggregate_credits')));
  assert.ok(calls.some((call) => call.startsWith('/3/tv/1396/season/1?')));
});

test('discover requests apply TMDB genre and release-year filters', async () => {
  let requestUrl = '';
  const service = createTmdbCatalogService({
    token: () => 'token',
    fetchImpl: async (input) => {
      requestUrl = String(input);
      return jsonResponse({ page: 1, total_pages: 0, total_results: 0, results: [] });
    },
    cache: { async get() { return null; }, async put() {} },
  });
  await service.discoverMovies(2, { genre: 28, year: 2024 });
  const url = new URL(requestUrl);
  assert.equal(url.pathname, '/3/discover/movie');
  assert.equal(url.searchParams.get('with_genres'), '28');
  assert.equal(url.searchParams.get('primary_release_year'), '2024');
  assert.equal(url.searchParams.get('page'), '2');
});

test('movie and TV catalog methods call each documented v3 endpoint with page parameters', async () => {
  const calls: string[] = [];
  const service = createTmdbCatalogService({
    token: () => 'token',
    fetchImpl: async (input) => {
      const url = new URL(String(input));
      calls.push(url.pathname + url.search);
      if (url.pathname.startsWith('/3/genre/')) return jsonResponse({ genres: [] });
      if (url.pathname === '/3/movie/238') return jsonResponse({ id: 238, title: 'Movie', release_date: '2024-01-01' });
      if (url.pathname === '/3/tv/1396') return jsonResponse({ id: 1396, name: 'Series', seasons: [] });
      if (url.pathname === '/3/tv/1396/season/1') return jsonResponse({ season_number: 1, name: 'Season 1', episodes: [] });
      return jsonResponse({ page: 2, total_pages: 4, total_results: 61, results: [] });
    },
    cache: { async get() { return null; }, async put() {} },
  });

  await service.popularMovies(2);
  await service.trendingMovies(2, 'day');
  await service.topRatedMovies(2);
  await service.nowPlayingMovies(2);
  await service.upcomingMovies(2);
  await service.searchMovies('Dune', 2);
  await service.movieDetails(238);
  await service.movieRecommendations(238, 2);
  await service.genres('movie');
  await service.popularTv(2);
  await service.trendingTv(2, 'week');
  await service.searchTv('Planet Earth', 2);
  await service.discoverTv(2, { genre: 99, year: 2024 });
  await service.genres('tv');
  await service.tvDetails(1396);
  await service.tvSeason(1396, 1);

  const paths = calls.map((call) => call.split('?')[0]);
  for (const path of [
    '/3/movie/popular', '/3/trending/movie/day', '/3/movie/top_rated', '/3/movie/now_playing', '/3/movie/upcoming',
    '/3/search/movie', '/3/movie/238', '/3/movie/238/recommendations', '/3/genre/movie/list',
    '/3/tv/popular', '/3/trending/tv/week', '/3/search/tv', '/3/discover/tv', '/3/genre/tv/list',
    '/3/tv/1396', '/3/tv/1396/season/1',
  ]) assert.ok(paths.includes(path), `missing TMDB path ${path}`);
  const pagedPaths = new Set([
    '/3/movie/popular', '/3/trending/movie/day', '/3/movie/top_rated', '/3/movie/now_playing', '/3/movie/upcoming',
    '/3/search/movie', '/3/movie/238/recommendations', '/3/tv/popular', '/3/trending/tv/week', '/3/search/tv', '/3/discover/tv',
  ]);
  assert.ok(calls.filter((call) => pagedPaths.has(call.split('?')[0])).every((call) => new URL('https://api.themoviedb.org' + call).searchParams.get('page') === '2'));
  assert.ok(calls.some((call) => call.includes('with_genres=99') && call.includes('first_air_date_year=2024')));
  assert.equal((await service.popularMovies(2)).page, 2);
});

test('missing token, 429, timeout, and invalid query errors are explicit', async () => {
  let fetchCount = 0;
  const noToken = createTmdbCatalogService({
    token: () => undefined,
    fetchImpl: async () => { fetchCount += 1; return jsonResponse({}); },
    cache: { async get() { return null; }, async put() {} },
  });
  await assert.rejects(noToken.popularMovies(), (error: unknown) =>
    error instanceof TmdbCatalogError && error.status === 503 && error.code === 'TMDB_TOKEN_REQUIRED');
  assert.equal(fetchCount, 0);

  const limited = createTmdbCatalogService({
    token: () => 'token',
    fetchImpl: async () => jsonResponse({}, 429, { 'retry-after': '12' }),
    cache: { async get() { return null; }, async put() {} },
  });
  await assert.rejects(limited.popularMovies(), (error: unknown) =>
    error instanceof TmdbCatalogError && error.status === 429 && error.retryAfterSeconds === 12);

  const timedOut = createTmdbCatalogService({
    token: () => 'token',
    timeoutMs: 500,
    fetchImpl: async (_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }),
    cache: { async get() { return null; }, async put() {} },
  });
  await assert.rejects(timedOut.popularMovies(), (error: unknown) =>
    error instanceof TmdbCatalogError && error.status === 504 && error.code === 'TMDB_TIMEOUT');

  await assert.rejects(limited.searchMovies('   '), (error: unknown) =>
    error instanceof TmdbCatalogError && error.status === 400 && error.code === 'TMDB_INVALID_QUERY');
});

test('malformed success payloads are errors rather than empty catalog results', async () => {
  const service = createTmdbCatalogService({
    token: () => 'token',
    fetchImpl: async () => jsonResponse({ status_message: 'unexpected payload' }),
    cache: { async get() { return null; }, async put() {} },
  });
  await assert.rejects(service.popularMovies(), (error: unknown) =>
    error instanceof TmdbCatalogError && error.status === 502 && error.code === 'TMDB_INVALID_RESPONSE');
});

test('expired PostgreSQL catalog cache rows are pruned at most hourly', async () => {
  let cleanupCount = 0;
  const service = createTmdbCatalogService({
    token: () => 'token',
    fetchImpl: async () => jsonResponse({ page: 1, total_pages: 0, total_results: 0, results: [] }),
    cache: {
      async get() { return null; },
      async put() {},
      async deleteExpired() { cleanupCount += 1; return 0; },
    },
  });
  await service.popularMovies();
  await service.popularTv();
  assert.equal(cleanupCount, 1);
});
