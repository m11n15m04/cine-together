import test from 'node:test';
import assert from 'node:assert/strict';
import { TEST_MEDIA_FIXTURES } from '../src/data/testMediaFixtures.ts';
import { createTmdbCatalogService } from '../src/services/catalogService.ts';
import { createMediaProviderAdapter } from '../src/utils/mediaAdapter.ts';

test('sample playback records are visibly labeled as isolated test fixtures', () => {
  assert.ok(TEST_MEDIA_FIXTURES.length > 0);
  assert.ok(TEST_MEDIA_FIXTURES.every((item) => item.title.startsWith('[TEST FIXTURE]')));
  assert.ok(TEST_MEDIA_FIXTURES.every((item) => item.playbackStatus === 'synced-ready'));
});

test('TMDB metadata remains playback-unavailable without a configured source', async () => {
  const service = createTmdbCatalogService({
    token: () => 'test-token',
    fetchImpl: async () => new Response(JSON.stringify({
      page: 1,
      total_pages: 1,
      total_results: 1,
      results: [{ id: 969681, title: 'Example Title', release_date: '2026-01-01', vote_average: 7.1 }],
    }), { headers: { 'content-type': 'application/json' } }),
    cache: { async get() { return null; }, async put() {} },
  });
  const result = await service.popularMovies();
  const item = result.items[0]!;
  assert.equal(item.id, 'tmdb:movie:969681');
  assert.equal(item.playbackStatus, 'metadata-only');
  assert.equal(item.sourceAvailability, 'unavailable');
  assert.equal(item.streamUrl, undefined);
  assert.equal(item.nxshaEmbedUrl, undefined);
  assert.equal(item.nxshaWatchUrl, undefined);
});

test('metadata-only player adapter exposes no synthetic playback URL or duration', () => {
  const adapter = createMediaProviderAdapter({
    providerType: 'metadata-only',
    streamUrl: '',
    mediaType: 'movie',
    tmdbId: 969681,
  });
  assert.equal(adapter.getEmbedUrl(), '');
  assert.equal(adapter.getOpenOnProviderUrl(), '');
  assert.equal(adapter.getDuration(), 0);
  assert.equal(adapter.getCapabilities().canEmbedInFrame, false);
});
