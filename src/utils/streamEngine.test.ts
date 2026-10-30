import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateAdaptiveBitrate,
  classifyPlaybackDrift,
  computePersonalizedRecommendations,
  deduplicateAndMergeCatalog,
  estimateOfflineSizeMB,
  evaluateWatchPartySync,
  filterAndSearchCatalog,
  formatStorageQuota,
  generatePrivacyFingerprint,
  generateRoomCode,
  paginateCatalog,
  shouldAcceptSyncRevision,
} from './streamEngine';
import { createMediaProviderAdapter } from './mediaAdapter';
import { MediaItem, OfflineDownloadItem, WatchHistoryEntry } from '../types';

const mockCatalog: MediaItem[] = [
  {
    id: 'nx-1400940',
    tmdbId: 1400940,
    title: 'Clayface',
    mediaType: 'movie',
    platform: 'Unverified',
    releaseDate: 'Oct 19, 2026',
    year: '2026',
    rating: 7.5,
    durationMinutes: 124,
    genres: ['Sci-Fi', 'Thriller', 'Horror'],
    language: 'English',
    description: 'Matt Hagen seeks a cutting edge treatment in Gotham.',
    accentColor: '#d97706',
    secondaryColor: '#0f172a',
    director: 'Mike Flanagan',
    cast: ['Jack OConnell', 'Naomi Scott'],
    isTrending: true,
  },
  {
    id: 'nx-791523',
    tmdbId: 791523,
    title: 'Wildwood',
    mediaType: 'anime',
    platform: 'Unverified',
    releaseDate: 'Oct 19, 2026',
    year: '2026',
    rating: 8.6,
    durationMinutes: 108,
    genres: ['Animation', 'Fantasy', 'Adventure'],
    language: 'English',
    description: 'Prue and Curtis are drawn into an enchanted forest.',
    accentColor: '#059669',
    secondaryColor: '#064e3b',
    director: 'Travis Knight',
    cast: ['Peyton Elizabeth Lee', 'Jacob Tremblay'],
    coupleScore: 98,
  },
  {
    id: 'nx-969681',
    tmdbId: 969681,
    title: 'Spider-Man: Brand New Day',
    mediaType: 'movie',
    platform: 'Unverified',
    releaseDate: 'Jul 29, 2026',
    year: '2026',
    rating: 8.5,
    durationMinutes: 142,
    genres: ['Sci-Fi', 'Action', 'Adventure'],
    language: 'English',
    description: 'Peter Parker faces a shocking new threat in New York.',
    accentColor: '#e11d48',
    secondaryColor: '#1e1b4b',
    director: 'Destin Daniel Cretton',
    cast: ['Tom Holland', 'Zendaya'],
    isTrending: true,
  },
];

test('calculateAdaptiveBitrate selects 4K UHD on high bandwidth and respects Data Saver', () => {
  const highBw = calculateAdaptiveBitrate(35, 'auto', false);
  assert.equal(highBw.selectedQuality, '4K UHD');
  assert.equal(highBw.bitrateMbps, 18.4);

  const saver = calculateAdaptiveBitrate(35, 'auto', true);
  assert.equal(saver.selectedQuality, '480p Saver');
  assert.equal(saver.bitrateMbps, 1.1);

  const manualFhd = calculateAdaptiveBitrate(12, '1080p FHD', false);
  assert.equal(manualFhd.selectedQuality, '1080p FHD');
  assert.equal(manualFhd.bitrateMbps, 6.8);
});

test('computePersonalizedRecommendations boosts genres from user viewing history', () => {
  const history: WatchHistoryEntry[] = [
    {
      mediaId: 'nx-1400940',
      watchedAt: '2026-10-26T18:00:00Z',
      progressSeconds: 7000,
      durationSeconds: 7440,
      completed: true,
      genres: ['Sci-Fi', 'Action'],
      platform: 'Disney+',
    },
  ];

  const recs = computePersonalizedRecommendations(mockCatalog, history, ['nx-969681']);
  assert.equal(recs.length, 3);
  assert.equal(recs[0].item.id, 'nx-969681');
  assert.ok(recs[0].affinityScore >= 90);
  assert.ok(recs[0].reason.includes('Sci-Fi'));
});

test('evaluateWatchPartySync detects playback drift and play/pause changes accurately', () => {
  const serverState = {
    isPlaying: true,
    currentTimeSeconds: 120,
    playbackRate: 1,
    updatedAtMs: 1000,
  };

  // 3 seconds later, expected server time is 123s. Local is at 115s -> drift = 8s -> shouldSeek = true
  const drifted = evaluateWatchPartySync(serverState, {
    isPlaying: true,
    currentTimeSeconds: 115,
    nowMs: 4000,
  });
  assert.equal(drifted.shouldSeek, true);
  assert.equal(drifted.targetTimeSeconds, 123);
  assert.equal(drifted.shouldTogglePlay, false);

  // Within 0.5s drift -> shouldSeek = false
  const synced = evaluateWatchPartySync(serverState, {
    isPlaying: true,
    currentTimeSeconds: 122.6,
    nowMs: 4000,
  });
  assert.equal(synced.shouldSeek, false);
});

test('shouldAcceptSyncRevision and classifyPlaybackDrift handle revision ordering and drift tiers', () => {
  assert.equal(shouldAcceptSyncRevision(5, 6), true);
  assert.equal(shouldAcceptSyncRevision(5, 5), true);
  assert.equal(shouldAcceptSyncRevision(5, 4), false);

  assert.equal(classifyPlaybackDrift(0.2), 'in-sync');
  assert.equal(classifyPlaybackDrift(1.2), 'soft-adjust');
  assert.equal(classifyPlaybackDrift(3.5), 'hard-seek');
});

test('MediaProviderAdapter exposes only configured sources and honest sync flags', () => {
  const syncedAdapter = createMediaProviderAdapter({
    providerType: 'synced-studio',
    streamUrl: 'https://media.example.test/authorized.mp4',
    mediaType: 'movie',
    durationMinutes: 142,
  });
  assert.equal(syncedAdapter.supportsProgrammaticSync, true);
  assert.equal(syncedAdapter.syncLimitationNotice, null);
  assert.equal(syncedAdapter.getCapabilities().supportsProgrammaticSync, true);
  assert.equal(syncedAdapter.getCapabilities().requiresManualCoordination, false);
  syncedAdapter.seekTo(42);
  assert.equal(syncedAdapter.getCurrentTime(), 42);

  const externalAdapter = createMediaProviderAdapter({
    providerType: 'authorized-external',
    openOnProviderUrl: 'https://provider.example.test/watch/authorized-title',
    mediaType: 'tv',
    season: 1,
    episode: 4,
    durationMinutes: 52,
  });
  assert.equal(externalAdapter.supportsProgrammaticSync, false);
  assert.ok(externalAdapter.syncLimitationNotice?.includes('does not expose a synchronization API'));
  assert.equal(externalAdapter.getEmbedUrl(), '');
  assert.equal(externalAdapter.getOpenOnProviderUrl(), 'https://provider.example.test/watch/authorized-title');
  assert.equal(externalAdapter.getCapabilities().requiresManualCoordination, true);
});

test('generateRoomCode formats Couple and Group room codes properly', () => {
  const coupleCode = generateRoomCode('couple', '7788');
  assert.equal(coupleCode, 'LOVE-7788');

  const groupCode = generateRoomCode('group');
  assert.match(groupCode, /^CLUB-[A-Z0-9]{4}$/);
});

test('filterAndSearchCatalog filters by query, category, platform, rating, genre, year, and sortBy', () => {
  const sciFi = filterAndSearchCatalog(mockCatalog, 'Spider', 'all', 'All Platforms', 0);
  assert.equal(sciFi.length, 1);
  assert.equal(sciFi[0].title, 'Spider-Man: Brand New Day');

  const animeOnly = filterAndSearchCatalog(mockCatalog, '', 'anime', 'All Platforms', 8.0);
  assert.equal(animeOnly.length, 1);
  assert.equal(animeOnly[0].title, 'Wildwood');

  const byGenre = filterAndSearchCatalog(mockCatalog, '', 'all', 'All Platforms', 0, {
    genre: 'Horror',
  });
  assert.equal(byGenre.length, 1);
  assert.equal(byGenre[0].title, 'Clayface');

  const sortedByTitle = filterAndSearchCatalog(mockCatalog, '', 'all', 'All Platforms', 0, {
    sortBy: 'title',
  });
  assert.equal(sortedByTitle[0].title, 'Clayface');
  assert.equal(sortedByTitle[2].title, 'Wildwood');
});

test('deduplicateAndMergeCatalog and paginateCatalog prevent duplicates and paginate cleanly', () => {
  const duplicateEntry: MediaItem = {
    ...mockCatalog[0],
    posterUrl: 'https://image.tmdb.org/t/p/w500/clayface.jpg',
  };
  const merged = deduplicateAndMergeCatalog(mockCatalog, [duplicateEntry]);
  assert.equal(merged.length, 3);
  assert.equal(merged[0].posterUrl, 'https://image.tmdb.org/t/p/w500/clayface.jpg');

  const page1 = paginateCatalog(merged, 1, 2);
  assert.equal(page1.visibleItems.length, 2);
  assert.equal(page1.totalCount, 3);
  assert.equal(page1.hasMore, true);

  const page2 = paginateCatalog(merged, 2, 2);
  assert.equal(page2.visibleItems.length, 3);
  assert.equal(page2.hasMore, false);
});

test('catalog identity is preserved by Nxsha provider ID rather than TMDb player ID', () => {
  const first = { ...mockCatalog[0], id: 'nxsha-local-a', providerId: 'nxsha-native-a', tmdbId: 123 };
  const sameNxshaItem = { ...first, id: 'nxsha-local-b', tmdbId: 456 };
  const differentNxshaItem = { ...first, id: 'nxsha-local-c', providerId: 'nxsha-native-b' };
  const result = deduplicateAndMergeCatalog([first, sameNxshaItem, differentNxshaItem]);
  assert.equal(result.length, 2);
  assert.equal(result[0].providerId, 'nxsha-native-a');
  assert.equal(result[0].tmdbId, 123);
  assert.equal(result[1].providerId, 'nxsha-native-b');
});

test('formatStorageQuota and estimateOfflineSizeMB compute deterministic storage metrics', () => {
  const size1080 = estimateOfflineSizeMB(100, '1080p FHD');
  assert.equal(size1080, 1100);

  const downloads: OfflineDownloadItem[] = [
    {
      mediaId: 'nx-1400940',
      title: 'Clayface',
      mediaType: 'movie',
      quality: '1080p FHD',
      sizeMB: 1024,
      downloadedAt: '2026-10-26',
      streamUrl: 'https://example.com/v.mp4',
      blobAvailable: true,
      progress: 100,
      status: 'completed',
      accentColor: '#d97706',
      secondaryColor: '#0f172a',
      year: '2026',
      durationMinutes: 124,
    },
  ];
  const quota = formatStorageQuota(downloads, 4096);
  assert.equal(quota.usedMB, 1024);
  assert.equal(quota.availableMB, 3072);
  assert.equal(quota.percentUsed, 25);
  assert.equal(quota.completedCount, 1);
});

test('generatePrivacyFingerprint returns formatted E2EE key', () => {
  const fp = generatePrivacyFingerprint('user@nxsha.space', '4829');
  assert.match(fp, /^NX-[0-9A-F]{4}-[0-9A-F]{4}-E2EE$/);
});
