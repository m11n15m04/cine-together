import { MediaItem } from '../types.ts';

/**
 * Isolated test media fixtures strictly for automated playback and drift sync verification.
 * NOT to be used as production catalog entries.
 */
export const TEST_MEDIA_FIXTURES: MediaItem[] = [
  {
    id: 'test-fixture-mp4',
    tmdbId: 999001,
    title: '[TEST FIXTURE] Ocean Waves CC0 MP4',
    mediaType: 'movie',
    platform: 'Test Fixture',
    releaseDate: '2026-01-01',
    year: '2026',
    rating: 8.0,
    durationMinutes: 47,
    genres: ['Documentary', 'Nature'],
    language: 'English',
    description:
      'Isolated test media fixture used exclusively for verifying HTML5 video player element, playback events, and adaptive bitrate selection.',
    authorizedPlaybackSource: 'https://vjs.zencdn.net/v/oceans.mp4',
    streamUrl: 'https://vjs.zencdn.net/v/oceans.mp4',
    playbackType: 'synced-studio',
    sourceAvailability: 'verified',
    playbackCapability: {
      canSync: true,
      canEmbed: true,
      requiresExternalWatch: false,
    },
    playbackStatus: 'synced-ready',
    accentColor: '#38bdf8',
    secondaryColor: '#0c4a6e',
    director: 'Open Source Test Media',
    cast: ['Sample Video'],
    nxshaWatchUrl: '',
    nxshaEmbedUrl: '',
  },
  {
    id: 'test-fixture-hls',
    tmdbId: 999002,
    title: '[TEST FIXTURE] Mux Sample Multi-Bitrate HLS',
    mediaType: 'tv',
    platform: 'Test Fixture',
    releaseDate: '2026-01-01',
    year: '2026',
    rating: 8.0,
    durationMinutes: 30,
    genres: ['Test'],
    language: 'English',
    description:
      'Isolated test media fixture used exclusively for verifying HLS manifest reachability, media adapter buffering, and watch party drift evaluation.',
    hlsUrl: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
    streamUrl: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
    playbackType: 'synced-studio',
    sourceAvailability: 'verified',
    playbackCapability: {
      canSync: true,
      canEmbed: true,
      requiresExternalWatch: false,
    },
    playbackStatus: 'synced-ready',
    accentColor: '#ec4899',
    secondaryColor: '#3b0764',
    director: 'Open Source Test Media',
    cast: ['Sample Stream'],
    nxshaWatchUrl: '',
    nxshaEmbedUrl: '',
  },
];
