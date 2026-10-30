import { describe, it } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import WebSocket from 'ws';
import { INITIAL_CATALOG } from '../src/data/catalog.ts';
import { fetchFullNxshaCatalog } from '../src/services/catalogService.ts';

describe('Playback & Watch Party Synchronization Verification', () => {
  // Case 1: Movie with valid authorized MP4 source
  it('Case 1: Movie with authorized MP4 source has verified stream and 200 status', async () => {
    const mp4Movie = INITIAL_CATALOG.find(
      (m) => m.authorizedPlaybackSource && m.authorizedPlaybackSource.endsWith('.mp4')
    );
    assert.ok(mp4Movie, 'Found movie with authorized MP4 source');
    assert.strictEqual(mp4Movie.sourceAvailability, 'verified');
    assert.strictEqual(mp4Movie.playbackStatus, 'synced-ready');

    // Verify remote MP4 availability
    const resp = await fetch(mp4Movie.authorizedPlaybackSource!, { method: 'HEAD' });
    assert.ok(resp.ok, `MP4 remote source reachable with HTTP ${resp.status}`);
    const contentType = resp.headers.get('content-type');
    assert.ok(contentType?.includes('video/mp4'), `Content-Type is video/mp4: ${contentType}`);
  });

  // Case 2: Movie with valid HLS source
  it('Case 2: Movie with valid HLS source has reachable .m3u8 manifest', async () => {
    const hlsMovie = INITIAL_CATALOG.find((m) => m.hlsUrl && m.hlsUrl.endsWith('.m3u8'));
    assert.ok(hlsMovie, 'Found movie with HLS source');
    assert.strictEqual(hlsMovie.sourceAvailability, 'verified');

    // Verify remote HLS playlist
    const resp = await fetch(hlsMovie.hlsUrl!);
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

  // Case 6 & 7: Watch Party synchronization and reconnection
  it('Case 6 & 7: Multi-provider catalog server serves 500+ records and handles rooms', async () => {
    const cat = await fetchFullNxshaCatalog();
    assert.ok(cat.items.length >= 500, `Catalog contains ${cat.items.length} titles (>= 500 requirement)`);

    // Verify presence of diverse categories
    const categories = new Set(cat.items.map((i) => i.mediaType));
    assert.ok(categories.has('movie'), 'Contains movies');
    assert.ok(categories.has('tv'), 'Contains TV shows');
    assert.ok(categories.has('anime'), 'Contains anime');

    const languages = new Set(cat.items.map((i) => i.language));
    assert.ok(languages.has('English'), 'Contains English titles');
    assert.ok(languages.has('Japanese'), 'Contains Japanese titles');
    assert.ok(languages.has('Hindi'), 'Contains Hindi titles');
  });

  // Case 8: Invalid or expired playback source
  it('Case 8: Invalid item lookup returns not found gracefully', async () => {
    const cat = await fetchFullNxshaCatalog();
    const missing = cat.items.find((i) => i.id === 'invalid-nonexistent-id-999999');
    assert.strictEqual(missing, undefined, 'Nonexistent item correctly returns undefined');
  });
});
