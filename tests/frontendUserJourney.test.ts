import { describe, it } from 'node:test';
import assert from 'node:assert';
import { INITIAL_CATALOG, ROOM_THEMES } from '../src/data/catalog.ts';
import { TEST_MEDIA_FIXTURES } from '../src/data/testMediaFixtures.ts';
import {
  generateRoomCode,
  filterAndSearchCatalog,
  calculateAdaptiveBitrate,
  estimateOfflineSizeMB,
  generatePrivacyFingerprint,
} from '../src/utils/streamEngine.ts';
import { RoomThemeId, SecurityPrivacySettings, UserProfile } from '../src/types.ts';

describe('CineTogether — Complete Frontend & User Journey Verification', () => {
  it('Journey 1: Catalog integrity & diverse media categories', () => {
    assert.ok(INITIAL_CATALOG.length >= 10, 'Initial catalog has rich sample titles');
    
    const movies = INITIAL_CATALOG.filter((i) => i.mediaType === 'movie');
    const tvShows = INITIAL_CATALOG.filter((i) => i.mediaType === 'tv');
    const anime = INITIAL_CATALOG.filter((i) => i.mediaType === 'anime');

    assert.ok(movies.length > 0, 'Contains movies');
    assert.ok(tvShows.length > 0, 'Contains TV shows');
    assert.ok(anime.length > 0, 'Contains anime');

    // Every item must have valid id, title, rating, platform, and year
    INITIAL_CATALOG.forEach((item) => {
      assert.ok(item.id, `Item ${item.title} has id`);
      assert.ok(item.title, `Item ${item.id} has title`);
      assert.ok(typeof item.rating === 'number' && item.rating >= 0 && item.rating <= 10, `Valid rating for ${item.title}`);
      assert.ok(item.platform, `Platform set for ${item.title}`);
      assert.ok(item.year, `Release year set for ${item.title}`);
    });
  });

  it('Journey 2: Honest streaming verification (No fake streams)', () => {
    // Isolated test fixtures provide genuine stream sources
    const verifiedFixture = TEST_MEDIA_FIXTURES.find((i) => i.sourceAvailability === 'verified');
    assert.ok(verifiedFixture, 'Verified test fixture exists');
    assert.ok(
      verifiedFixture.authorizedPlaybackSource || verifiedFixture.hlsUrl,
      'Verified test fixture provides genuine stream source'
    );
    assert.ok(verifiedFixture.title.includes('[TEST FIXTURE]'), 'Fixture clearly labeled');

    // Unreleased / metadata-only titles in production must NEVER claim active stream
    const metadataOnly = INITIAL_CATALOG.find((i) => i.playbackStatus === 'metadata-only');
    if (metadataOnly) {
      assert.strictEqual(metadataOnly.sourceAvailability, 'unavailable');
      assert.strictEqual(metadataOnly.authorizedPlaybackSource, undefined);
      assert.strictEqual(metadataOnly.playbackCapability?.canSync, false);
    }

    // External provider titles in production provide official watch links
    const externalWatch = INITIAL_CATALOG.find((i) => i.playbackStatus === 'external-watch');
    if (externalWatch) {
      assert.strictEqual(externalWatch.sourceAvailability, 'external-only');
      assert.ok(externalWatch.nxshaWatchUrl, 'Has official provider watch URL');
    }
  });

  it('Journey 3: Room Code Generation & Theme Options for Watch Parties', () => {
    const coupleCode = generateRoomCode('couple');
    assert.ok(coupleCode.startsWith('LOVE-'), `Couple code starts with LOVE-: ${coupleCode}`);
    assert.strictEqual(coupleCode.length, 9, 'Couple code length is 9 characters');

    const groupCode = generateRoomCode('group');
    assert.ok(groupCode.startsWith('CLUB-'), `Group code starts with CLUB-: ${groupCode}`);
    assert.strictEqual(groupCode.length, 9, 'Group code length is 9 characters');

    // Room themes verify
    const themeKeys: RoomThemeId[] = [
      'rose-nebula',
      'midnight-violet',
      'starlight-indigo',
      'velvet-crimson',
      'aurora-emerald',
    ];
    themeKeys.forEach((key) => {
      const theme = ROOM_THEMES[key];
      assert.ok(theme, `Theme ${key} exists`);
      assert.ok(theme.name, `Theme ${key} has name`);
      assert.ok(theme.accentHex.startsWith('#'), `Theme ${key} has valid accentHex`);
      assert.ok(theme.gradientClass, `Theme ${key} has gradient classes`);
    });
  });

  it('Journey 4: Search & Filtering pipeline with multiple criteria', () => {
    // 1. Text search
    const searchPenguin = filterAndSearchCatalog(INITIAL_CATALOG, 'Penguin', 'all', 'All Platforms');
    assert.ok(searchPenguin.length >= 1, 'Search for Penguin returns matching title');
    assert.ok(searchPenguin.some((i) => i.title.includes('Penguin')));

    // 2. Category filter
    const onlyAnime = filterAndSearchCatalog(INITIAL_CATALOG, '', 'anime', 'All Platforms');
    assert.ok(onlyAnime.length > 0, 'Found anime titles');
    assert.ok(onlyAnime.every((i) => i.mediaType === 'anime'), 'Only anime returned');

    // 3. Genre filter
    const romanceOnly = filterAndSearchCatalog(
      INITIAL_CATALOG,
      '',
      'all',
      'All Platforms',
      0,
      { genre: 'Romance' }
    );
    assert.ok(romanceOnly.length > 0, 'Found romance titles');
    assert.ok(romanceOnly.every((i) => i.genres.includes('Romance')), 'All results contain Romance genre');

    // 4. Sort by rating
    const sortedRating = filterAndSearchCatalog(
      INITIAL_CATALOG,
      '',
      'all',
      'All Platforms',
      0,
      { sortBy: 'rating' }
    );
    for (let i = 0; i < sortedRating.length - 1; i++) {
      assert.ok(
        sortedRating[i].rating >= sortedRating[i + 1].rating,
        'Sorted descending by rating'
      );
    }
  });

  it('Journey 5: User profile & Privacy fingerprinting contract', () => {
    const profile: UserProfile = {
      uid: 'usr-test-123',
      email: 'alex@cinetogether.app',
      displayName: 'Alex Rivera',
      preferredTheme: 'rose-nebula',
      isGuest: false,
    };
    assert.strictEqual(profile.displayName, 'Alex Rivera');
    assert.strictEqual(profile.preferredTheme, 'rose-nebula');

    const sec: SecurityPrivacySettings = {
      e2eHistoryEncryption: true,
      incognitoSession: false,
      drmWatermarkProtection: true,
      strictCoupleRoomPin: '7749',
      autoClearCacheHours: 24,
      dnsOverHttpsSource: true,
    };
    assert.strictEqual(sec.strictCoupleRoomPin, '7749');

    const fingerprint = generatePrivacyFingerprint(profile.email, sec.strictCoupleRoomPin);
    assert.ok(fingerprint.startsWith('NX-'), `Privacy fingerprint starts with NX-: ${fingerprint}`);
    assert.ok(fingerprint.endsWith('-E2EE'), `Privacy fingerprint ends with -E2EE: ${fingerprint}`);
    assert.strictEqual(fingerprint.length, 17, 'Fingerprint length is 17 characters');
  });

  it('Journey 6: Adaptive Bitrate calculation & offline storage estimation', () => {
    // 4K on high speed
    const highSpeed = calculateAdaptiveBitrate(35.0, 'auto', false);
    assert.strictEqual(highSpeed.selectedQuality, '4K UHD');

    // Data saver restricts to 480p Saver
    const dataSaver = calculateAdaptiveBitrate(50.0, 'auto', true);
    assert.strictEqual(dataSaver.selectedQuality, '480p Saver');

    // Offline size estimation
    const size4K = estimateOfflineSizeMB(120, '4K UHD');
    const sizeSaver = estimateOfflineSizeMB(120, '480p Saver');
    assert.ok(size4K > sizeSaver, '4K file size is larger than Saver file size');
    assert.strictEqual(size4K, 3360);
    assert.strictEqual(sizeSaver, 264);
  });
});
