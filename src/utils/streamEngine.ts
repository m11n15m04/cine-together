import {
  MediaItem,
  OfflineDownloadItem,
  PartyPlaybackState,
  QualityTier,
  RecommendationResult,
  WatchHistoryEntry,
} from '../types';

export interface AdaptiveBitrateDecision {
  selectedQuality: QualityTier;
  bitrateMbps: number;
  codec: string;
  resolutionLabel: string;
  bufferHealthSeconds: number;
  reason: string;
}

/**
 * Pure adaptive bitrate calculation based on measured network bandwidth,
 * user quality preference, and data saver mode.
 */
export function calculateAdaptiveBitrate(
  bandwidthMbps: number,
  manualQuality: QualityTier | 'auto',
  isDataSaver: boolean
): AdaptiveBitrateDecision {
  const safeBandwidth = Math.max(0.5, Number.isFinite(bandwidthMbps) ? bandwidthMbps : 10);

  if (isDataSaver) {
    return {
      selectedQuality: '480p Saver',
      bitrateMbps: 1.1,
      codec: 'AV1 Main 8-bit',
      resolutionLabel: '854×480 · 30fps',
      bufferHealthSeconds: Math.min(45, Math.round(safeBandwidth * 6)),
      reason: 'Data Saver active · Capped at 1.1 Mbps',
    };
  }

  if (manualQuality !== 'auto') {
    const manualSpecs: Record<QualityTier, { mbps: number; codec: string; res: string }> = {
      '4K UHD': { mbps: 18.4, codec: 'AV1 Main 10 HDR10+', res: '3840×2160 · 60fps' },
      '1080p FHD': { mbps: 6.8, codec: 'HEVC H.265 10-bit', res: '1920×1080 · 60fps' },
      '720p HD': { mbps: 3.2, codec: 'AVC H.264 High', res: '1280×720 · 30fps' },
      '480p Saver': { mbps: 1.1, codec: 'AV1 Main 8-bit', res: '854×480 · 30fps' },
    };
    const spec = manualSpecs[manualQuality];
    const ratio = safeBandwidth / spec.mbps;
    return {
      selectedQuality: manualQuality,
      bitrateMbps: spec.mbps,
      codec: spec.codec,
      resolutionLabel: spec.res,
      bufferHealthSeconds: Math.max(4, Math.min(40, Math.round(ratio * 14))),
      reason: `Locked to ${manualQuality} (${spec.mbps} Mbps)`,
    };
  }

  if (safeBandwidth >= 20) {
    return {
      selectedQuality: '4K UHD',
      bitrateMbps: 18.4,
      codec: 'AV1 Main 10 HDR10+',
      resolutionLabel: '3840×2160 · 60fps',
      bufferHealthSeconds: 32,
      reason: `Auto ABR · Optimal for ${safeBandwidth.toFixed(1)} Mbps link`,
    };
  }
  if (safeBandwidth >= 8) {
    return {
      selectedQuality: '1080p FHD',
      bitrateMbps: 6.8,
      codec: 'HEVC H.265 10-bit',
      resolutionLabel: '1920×1080 · 60fps',
      bufferHealthSeconds: 24,
      reason: `Auto ABR · Optimal for ${safeBandwidth.toFixed(1)} Mbps link`,
    };
  }
  if (safeBandwidth >= 3.5) {
    return {
      selectedQuality: '720p HD',
      bitrateMbps: 3.2,
      codec: 'AVC H.264 High',
      resolutionLabel: '1280×720 · 30fps',
      bufferHealthSeconds: 18,
      reason: `Auto ABR · Balanced for ${safeBandwidth.toFixed(1)} Mbps link`,
    };
  }
  return {
    selectedQuality: '480p Saver',
    bitrateMbps: 1.1,
    codec: 'AV1 Main 8-bit',
    resolutionLabel: '854×480 · 30fps',
    bufferHealthSeconds: 14,
    reason: `Auto ABR · Low-bandwidth protection (${safeBandwidth.toFixed(1)} Mbps)`,
  };
}

/**
 * Pure recommendation engine scoring catalog items against user watch history and likes.
 */
export function computePersonalizedRecommendations(
  catalog: MediaItem[],
  history: WatchHistoryEntry[],
  likedIds: string[]
): RecommendationResult[] {
  if (!catalog.length) return [];

  const genreWeights: Record<string, number> = {};
  const platformWeights: Record<string, number> = {};
  const watchedMediaIds = new Set<string>();

  for (const entry of history) {
    watchedMediaIds.add(entry.mediaId);
    const completionRatio =
      entry.durationSeconds > 0
        ? Math.min(1, entry.progressSeconds / entry.durationSeconds)
        : 0.5;
    const weightBoost = 1 + completionRatio * 2 + (entry.completed ? 1 : 0);

    for (const genre of entry.genres) {
      genreWeights[genre] = (genreWeights[genre] || 0) + weightBoost;
    }
    platformWeights[entry.platform] = (platformWeights[entry.platform] || 0) + weightBoost * 0.6;
  }

  for (const likedId of likedIds) {
    const likedItem = catalog.find((c) => c.id === likedId);
    if (likedItem) {
      for (const g of likedItem.genres) {
        genreWeights[g] = (genreWeights[g] || 0) + 3.5;
      }
    }
  }

  const topGenres = Object.entries(genreWeights)
    .sort((a, b) => b[1] - a[1])
    .map(([g]) => g);

  const scored: RecommendationResult[] = catalog.map((item, idx) => {
    let rawScore = item.rating * 6.8; // base ~48..64
    const matchedGenres: string[] = [];

    for (const g of item.genres) {
      if (genreWeights[g]) {
        rawScore += Math.min(11, genreWeights[g] * 2.8);
        if (!matchedGenres.includes(g)) {
          matchedGenres.push(g);
        }
      }
    }

    if (platformWeights[item.platform]) {
      rawScore += Math.min(5, platformWeights[item.platform] * 1.4);
    }

    if (likedIds.includes(item.id)) {
      rawScore += 5;
    }

    // Slightly deprioritize already completed items so new discoveries surface first
    const alreadyCompleted = history.some((h) => h.mediaId === item.id && h.completed);
    if (alreadyCompleted) {
      rawScore -= 9;
    }

    const affinityScore = Math.max(68, Math.min(99, Math.round(rawScore - (idx % 3))));

    let reason = `${affinityScore}% Match · Top rated in ${item.genres.slice(0, 2).join(' & ')}`;
    if (matchedGenres.length > 0) {
      reason = `${affinityScore}% Match · Because you watch ${matchedGenres.slice(0, 2).join(' & ')}`;
    } else if (topGenres.length > 0) {
      reason = `${affinityScore}% Match · Trending across ${item.platform}`;
    }

    return {
      item,
      affinityScore,
      reason,
    };
  });

  return scored.sort((a, b) => b.affinityScore - a.affinityScore);
}

export interface SyncReconciliation {
  shouldSeek: boolean;
  targetTimeSeconds: number;
  shouldTogglePlay: boolean;
  targetIsPlaying: boolean;
  driftSeconds: number;
}

/**
 * Evaluates whether a Watch Party or Couple Watch Party client needs to seek or toggle playback
 * to stay locked with the authoritative room state.
 */
export function evaluateWatchPartySync(
  authoritativeState: Pick<PartyPlaybackState, 'isPlaying' | 'currentTimeSeconds' | 'playbackRate' | 'updatedAtMs'>,
  localState: { isPlaying: boolean; currentTimeSeconds: number; nowMs: number },
  maxDriftSeconds = 2.0
): SyncReconciliation {
  const elapsedSeconds = authoritativeState.isPlaying
    ? Math.max(0, (localState.nowMs - authoritativeState.updatedAtMs) / 1000) *
      (authoritativeState.playbackRate || 1)
    : 0;

  const expectedServerTime = Math.max(0, authoritativeState.currentTimeSeconds + elapsedSeconds);
  const driftSeconds = Math.abs(expectedServerTime - localState.currentTimeSeconds);

  return {
    shouldSeek: driftSeconds > maxDriftSeconds,
    targetTimeSeconds: Number(expectedServerTime.toFixed(2)),
    shouldTogglePlay: authoritativeState.isPlaying !== localState.isPlaying,
    targetIsPlaying: authoritativeState.isPlaying,
    driftSeconds: Number(driftSeconds.toFixed(2)),
  };
}

export interface CatalogFilterOptions {
  genre?: string;
  year?: string;
  language?: string;
  sortBy?: 'popularity' | 'rating' | 'release' | 'title';
}

/**
 * Comprehensive multi-field catalog search, filtering, and sorting.
 */
export function filterAndSearchCatalog(
  catalog: MediaItem[],
  query: string,
  category: 'all' | 'movie' | 'tv' | 'anime',
  platform: string,
  minRating = 0,
  options: CatalogFilterOptions = {}
): MediaItem[] {
  const normalizedQuery = query.trim().toLowerCase();
  const {
    genre = 'All Genres',
    year = 'All Years',
    language = 'All Languages',
    sortBy = 'popularity',
  } = options;

  const filtered = catalog.filter((item) => {
    if (category !== 'all' && item.mediaType !== category) {
      return false;
    }
    if (platform !== 'All Platforms' && item.platform !== platform) {
      return false;
    }
    if (genre && genre !== 'All Genres' && !item.genres.includes(genre)) {
      return false;
    }
    if (year && year !== 'All Years' && item.year !== year) {
      return false;
    }
    if (language && language !== 'All Languages' && item.language !== language) {
      return false;
    }
    if (item.rating < minRating) {
      return false;
    }
    if (!normalizedQuery) {
      return true;
    }
    const haystack = [
      item.title,
      item.originalTitle || '',
      item.description,
      item.year,
      item.platform,
      item.director,
      item.sectionHeading || '',
      ...item.genres,
      ...item.cast,
    ]
      .join(' ')
      .toLowerCase();

    return haystack.includes(normalizedQuery);
  });

  if (sortBy === 'rating') {
    return [...filtered].sort((a, b) => b.rating - a.rating);
  }
  if (sortBy === 'release') {
    return [...filtered].sort((a, b) => Number(b.year || 0) - Number(a.year || 0) || b.rating - a.rating);
  }
  if (sortBy === 'title') {
    return [...filtered].sort((a, b) => a.title.localeCompare(b.title));
  }
  return filtered;
}

/**
 * Deduplicates by Nxsha's native provider ID when present, otherwise by the local item ID.
 */
export function deduplicateAndMergeCatalog(
  primaryItems: MediaItem[],
  secondaryItems: MediaItem[] = []
): MediaItem[] {
  const map = new Map<string, MediaItem>();
  for (const item of [...primaryItems, ...secondaryItems]) {
    if (!item || !item.title) continue;
    // TMDb/IMDb identifiers are only for Nxsha's documented player routes, never catalog identity.
    const key = `${item.mediaType}:${item.providerId ? `nxsha:${item.providerId}` : `local:${item.id}`}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, item);
    } else {
      map.set(key, {
        ...existing,
        posterUrl: existing.posterUrl || item.posterUrl,
        backdropUrl: existing.backdropUrl || item.backdropUrl,
        description:
          existing.description && existing.description.length >= (item.description?.length || 0)
            ? existing.description
            : item.description || existing.description,
        isTrending: existing.isTrending || item.isTrending,
        isPopularThisWeek: existing.isPopularThisWeek || item.isPopularThisWeek,
        isRecentlyAdded: existing.isRecentlyAdded || item.isRecentlyAdded,
        playbackStatus:
          existing.playbackStatus === 'synced-ready' || item.playbackStatus === 'synced-ready'
            ? 'synced-ready'
            : existing.playbackStatus || item.playbackStatus,
      });
    }
  }
  return Array.from(map.values());
}

/**
 * Slices a catalog array for progressive Load More pagination and returns metadata.
 */
export function paginateCatalog<T>(
  items: T[],
  page: number,
  pageSize: number
): {
  visibleItems: T[];
  totalCount: number;
  hasMore: boolean;
  currentPage: number;
} {
  const safePage = Math.max(1, Math.floor(page || 1));
  const safePageSize = Math.max(1, Math.floor(pageSize || 24));
  const endIndex = safePage * safePageSize;
  return {
    visibleItems: items.slice(0, endIndex),
    totalCount: items.length,
    hasMore: endIndex < items.length,
    currentPage: safePage,
  };
}


/**
 * Calculates offline storage footprint and quota metrics.
 */
export function formatStorageQuota(
  downloads: OfflineDownloadItem[],
  maxQuotaMB = 8192
): {
  usedMB: number;
  availableMB: number;
  percentUsed: number;
  completedCount: number;
} {
  const usedMB = downloads.reduce((acc, item) => {
    const progressFactor = item.status === 'completed' ? 1 : Math.max(0.1, item.progress / 100);
    return acc + item.sizeMB * progressFactor;
  }, 0);

  const roundedUsed = Math.round(usedMB);
  const availableMB = Math.max(0, maxQuotaMB - roundedUsed);
  const percentUsed = Math.min(100, Math.round((roundedUsed / maxQuotaMB) * 100));
  const completedCount = downloads.filter((d) => d.status === 'completed').length;

  return {
    usedMB: roundedUsed,
    availableMB,
    percentUsed,
    completedCount,
  };
}

/**
 * Estimates download size in MB based on duration and quality tier.
 */
export function estimateOfflineSizeMB(durationMinutes: number, quality: QualityTier): number {
  const minutes = Math.max(10, durationMinutes || 95);
  const mbPerMinute: Record<QualityTier, number> = {
    '4K UHD': 28,
    '1080p FHD': 11,
    '720p HD': 5.5,
    '480p Saver': 2.2,
  };
  return Math.round(minutes * mbPerMinute[quality]);
}

/**
 * Generates a deterministic SHA-like privacy fingerprint for E2E encrypted watch history & couple room security.
 */
export function generatePrivacyFingerprint(userId: string, pin: string): string {
  const seed = `${userId.trim() || 'nxsha-anon'}::${pin.trim() || '0000'}::AES256GCM`;
  let h1 = 0xdeadbeef ^ seed.length;
  let h2 = 0x41c6ce57 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    const ch = seed.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const hex1 = (h1 >>> 0).toString(16).padStart(8, '0');
  const hex2 = (h2 >>> 0).toString(16).padStart(8, '0');
  return `NX-${hex1.toUpperCase().slice(0, 4)}-${hex2.toUpperCase().slice(0, 4)}-E2EE`;
}

/**
 * Stale-event rejection: returns true only when an incoming server revision
 * is greater than or equal to the client's last applied revision.
 */
export function shouldAcceptSyncRevision(
  currentRevision: number,
  incomingRevision: number
): boolean {
  if (!Number.isFinite(incomingRevision)) return false;
  return incomingRevision >= currentRevision;
}

/**
 * Classifies playback drift into 'in-sync' (<= 0.4s), 'soft-adjust' (0.4s..2.0s),
 * or 'hard-seek' (> 2.0s) for smooth room playback reconciliation.
 */
export function classifyPlaybackDrift(
  driftSeconds: number
): 'in-sync' | 'soft-adjust' | 'hard-seek' {
  const abs = Math.abs(driftSeconds);
  if (abs <= 0.4) return 'in-sync';
  if (abs <= 2.0) return 'soft-adjust';
  return 'hard-seek';
}

/**
 * Generates a human-friendly room code for Couple Cinema or Group Cinema.
 */
export function generateRoomCode(mode: 'couple' | 'group', seedSuffix?: string): string {
  const prefix = mode === 'couple' ? 'LOVE' : 'CLUB';
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  if (seedSuffix && seedSuffix.trim().length >= 4) {
    return `${prefix}-${seedSuffix.trim().toUpperCase().slice(0, 4)}`;
  }
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `${prefix}-${code}`;
}

