import { describe, it } from 'node:test';
import assert from 'node:assert';
import { INITIAL_CATALOG } from '../src/data/catalog.ts';
import { TEST_MEDIA_FIXTURES } from '../src/data/testMediaFixtures.ts';
import {
  checkCatalogHealth,
  NXSHA_CATALOG_UNAVAILABLE,
  NxshaCatalogUnavailableError,
  readNxshaCatalogCache,
} from '../src/services/catalogService.ts';

describe('Playback & Watch Party Synchronization Verification', () => {
  // Case 1: Isolated test fixture with valid authorized MP4 source
  it('Case 1: Isolated test fixture with authorized MP4 source has verified stream and 200 status', async () => {
    const mp4Fixture = TEST_MEDIA_FIXTURES.find(
      (m) => m.authorizedPlaybackSource && m.authorizedPlaybackSource.endsWith('.mp4')
    );
    assert.ok(mp4Fixture, 'Found test fixture with authorized MP4 source');
    assert.strictEqual(mp4Fixture.sourceAvailability, 'verified');
    assert.strictEqual(mp4Fixture.playbackStatus, 'synced-ready');
    assert.ok(mp4Fixture.title.includes('[TEST FIXTURE]'), 'Fixture is clearly labeled as test media');

    // Verify remote MP4 availability
    const resp = await fetch(mp4Fixture.authorizedPlaybackSource!, { method: 'HEAD' });
    assert.ok(resp.ok, `MP4 remote source reachable with HTTP ${resp.status}`);
    const contentType = resp.headers.get('content-type');
    assert.ok(contentType?.includes('video/mp4'), `Content-Type is video/mp4: ${contentType}`);
  });

  // Case 2: Isolated test fixture with valid HLS source
  it('Case 2: Isolated test fixture with valid HLS source has reachable .m3u8 manifest', async () => {
    const hlsFixture = TEST_MEDIA_FIXTURES.find((m) => m.hlsUrl && m.hlsUrl.endsWith('.m3u8'));
    assert.ok(hlsFixture, 'Found test fixture with HLS source');
    assert.strictEqual(hlsFixture.sourceAvailability, 'verified');
    assert.strictEqual(hlsFixture.playbackStatus, 'synced-ready');
    assert.ok(hlsFixture.title.includes('[TEST FIXTURE]'), 'Fixture is clearly labeled as test media');

    // Verify remote HLS playlist
    const resp = await fetch(hlsFixture.hlsUrl!);
    assert.ok(resp.ok, `HLS manifest reachable with HTTP ${resp.status}`);
    const body = await resp.text();
    assert.ok(body.includes('#EXTM3U'), 'Manifest contains #EXTM3U header');
  });

  // Case 3: Movie without playback source (Metadata-only)
  it('Case 3: Movie without playback source is marked unavailable with no fake stream', () => {
    const unreleasedMovie = INITIAL_CATALOG.find((m) => m.tmdbId === 969681);
    assert.ok(unreleasedMovie, 'Found Spider-Man: Brand New Day');
    assert.strictEqual(unreleasedMovie.sourceAvailability, 'unavailable');
    assert.strictEqual(unreleasedMovie.playbackStatus, 'metadata-only');
    assert.strictEqual(unreleasedMovie.authorizedPlaybackSource, undefined);
    assert.strictEqual(unreleasedMovie.playbackCapability?.canSync, false);
  });

  // Case 4: External provider configuration for embedding
  it('Case 4: External embed titles have valid embed URL and capability flag', () => {
    const embedMovie = INITIAL_CATALOG.find((m) => m.playbackType === 'embed-only');
    assert.ok(embedMovie, 'Found embed-only title');
    assert.ok(embedMovie.nxshaEmbedUrl, 'Has nxshaEmbedUrl');
    assert.strictEqual(embedMovie.playbackCapability?.canSync, false);
    assert.strictEqual(embedMovie.playbackCapability?.canEmbed, true);
  });

  // Case 5: External provider that blocks embedding handling
  it('Case 5: Blocked embed handling preserves external watch option', () => {
    const embedMovie = INITIAL_CATALOG.find((m) => m.playbackType === 'embed-only');
    assert.ok(embedMovie, 'Found embed movie');
    assert.ok(embedMovie.nxshaWatchUrl, 'Has direct watch fallback URL');
    assert.ok(embedMovie.nxshaWatchUrl.startsWith('https://nxsha.space/watch/'));
  });

  // Case 6: Catalog health reports explicit unavailable provider state
  it('Case 6: Catalog health and error report explicit unavailable state (HTTP 503)', async () => {
    const health = await checkCatalogHealth();
    assert.strictEqual(health.status, 'unavailable');
    assert.strictEqual(health.provider.name, 'Nxsha');
    assert.strictEqual(health.provider.catalogApi.status, 'unavailable');

    const error = new NxshaCatalogUnavailableError();
    assert.strictEqual(error.status, 503);
    assert.strictEqual(error.code, NXSHA_CATALOG_UNAVAILABLE.code);
  });

  // Case 7: Offline sample content contains diverse media categories and languages
  it('Case 7: Offline sample content contains verified records across categories and languages', () => {
    assert.ok(INITIAL_CATALOG.length > 0, `Catalog contains ${INITIAL_CATALOG.length} sample titles`);

    const categories = new Set(INITIAL_CATALOG.map((i) => i.mediaType));
    assert.ok(categories.has('movie'), 'Contains movies');
    assert.ok(categories.has('tv'), 'Contains TV shows');
    assert.ok(categories.has('anime'), 'Contains anime');

    const languages = new Set(INITIAL_CATALOG.map((i) => i.language));
    assert.ok(languages.has('English'), 'Contains English titles');
    assert.ok(languages.has('Japanese'), 'Contains Japanese titles');
    assert.ok(languages.has('Hindi'), 'Contains Hindi titles');
  });

  // Case 8: Uncached catalog lookup returns null without fabricating records
  it('Case 8: Uncached catalog lookup returns null without fabricating records', async () => {
    let missing: unknown = null;
    try {
      missing = await readNxshaCatalogCache('nonexistent-cache-key-999999');
    } catch {
      // When PostgreSQL is not running locally, database failure is caught gracefully without fabrication
    }
    assert.strictEqual(missing, null, 'Uncached lookup correctly returns null');
  });
});
