import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.TMDB_API_KEY = 'tests-only-tmdb-key';
const originalFetch = globalThis.fetch;
let fetchCount = 0;
globalThis.fetch = async () => {
  fetchCount += 1;
  return new Response(JSON.stringify({ page: 1, total_pages: 1, total_results: 0, results: [] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
const { fetchTmdbEndpoint } = await import('./catalogService.ts');

test('TMDB catalog responses are cached and concurrent-ready by endpoint and page', async () => {
  const first = await fetchTmdbEndpoint('/movie/popular', { page: 900_001 });
  const second = await fetchTmdbEndpoint('/movie/popular', { page: 900_001 });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(fetchCount, 1);
  assert.equal(second.durationMs, 0);
});

test.after(() => {
  globalThis.fetch = originalFetch;
  delete process.env.TMDB_API_KEY;
});
