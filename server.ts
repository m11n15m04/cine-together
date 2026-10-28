import 'dotenv/config';
import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, LiveServerMessage, Modality, ThinkingLevel, Type } from '@google/genai';
import { INITIAL_CATALOG } from './src/data/catalog.ts';
import {
  ChatMessage,
  MediaCategory,
  MediaItem,
  PartyPlaybackState,
  PlatformOrigin,
  RoomLifecycleState,
  RoomThemeId,
  TvEpisodeItem,
  TvSeasonDetail,
} from './src/types.ts';
import {
  createWatchRoomInDb,
  getUserWatchlistItems,
  getWatchRoomByCode,
  hashPassword,
  listActiveWatchRooms,
  recordChatMessageInDb,
  recordReactionInDb,
  recordRoomVoteInDb,
  recordWatchSessionInDb,
  seedCatalogAndDefaultRooms,
  toggleUserWatchlistItem,
  updatePlaybackStateInDb,
  updateProfilePreferences,
} from './src/db/repository.ts';
import { optionalAuth, AuthenticatedRequest } from './src/middleware/auth.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;

function getAiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

// Authoritative server-side Watch Party & Couple Watch Party rooms
const partyRooms = new Map<string, PartyPlaybackState>();
const roomPasswords = new Map<string, string>(); // roomId -> sha256 password hash

const seedRooms: PartyPlaybackState[] = [
  {
    roomId: 'LOVE-2026',
    roomCode: 'LOVE-2026',
    roomName: 'Kyoto Rain & Rose Nebula Date Night',
    mode: 'couple',
    mediaId: 'nx-204988',
    mediaType: 'tv',
    season: 1,
    episode: 1,
    isPlaying: false,
    currentTimeSeconds: 485,
    playbackRate: 1,
    revision: 1,
    updatedAtMs: Date.now(),
    hostId: 'partner-elena',
    collaborativeControls: true,
    isLocked: false,
    roomTheme: 'rose-nebula',
    lifecycleState: 'ready',
    members: [
      {
        id: 'partner-elena',
        name: 'Elena (Host)',
        avatarColor: '#f43f5e',
        role: 'host',
        isOnline: true,
        joinedAt: '21:30',
        mood: 'Cozy',
        micMuted: true,
        camEnabled: false,
      },
    ],
    messages: [
      {
        id: 'cmsg-1',
        senderId: 'partner-elena',
        senderName: 'Elena',
        text: 'Welcome to our Couple Cinema room! Grab headphones—Episode 1 rain scene starts at 08:05 ❤️',
        timestamp: '21:32',
        videoTimestampSeconds: 485,
        type: 'chat',
      },
    ],
    votes: [
      {
        id: 'vote-1',
        mediaId: 'nx-278',
        mediaTitle: 'Midnight over Montmartre',
        voterId: 'partner-elena',
        voterName: 'Elena',
      },
    ],
    couplePulseCount: 14,
    couplePartnerNote: 'Friday Date Night · Kyoto Temple Rain Scene at 08:05 ❤️',
  },
  {
    roomId: 'CLUB-4096',
    roomCode: 'CLUB-4096',
    roomName: 'Friday Sci-Fi & Spider-Verse Premiere Lounge',
    mode: 'group',
    mediaId: 'nx-969681',
    mediaType: 'movie',
    season: 1,
    episode: 1,
    isPlaying: false,
    currentTimeSeconds: 142,
    playbackRate: 1,
    revision: 1,
    updatedAtMs: Date.now(),
    hostId: 'host-marcus',
    collaborativeControls: false,
    isLocked: false,
    roomTheme: 'midnight-violet',
    lifecycleState: 'ready',
    members: [
      {
        id: 'host-marcus',
        name: 'Marcus Chen',
        avatarColor: '#8b5cf6',
        role: 'host',
        isOnline: true,
        joinedAt: '21:45',
        mood: 'Focused',
        micMuted: false,
        camEnabled: true,
      },
      {
        id: 'guest-aria',
        name: 'Aria Patel',
        avatarColor: '#ec4899',
        role: 'moderator',
        isOnline: true,
        joinedAt: '21:48',
        mood: 'Hyped',
        micMuted: true,
        camEnabled: false,
      },
      {
        id: 'guest-liam',
        name: 'Liam K.',
        avatarColor: '#38bdf8',
        role: 'member',
        isOnline: true,
        joinedAt: '21:51',
        mood: 'Watching',
        micMuted: true,
        camEnabled: false,
      },
    ],
    messages: [
      {
        id: 'msg-1',
        senderId: 'host-marcus',
        senderName: 'Marcus Chen',
        text: 'Welcome to the Group Cinema Lounge! Vote on our next movie in the queue tab.',
        timestamp: '21:46',
        videoTimestampSeconds: 120,
        type: 'chat',
      },
      {
        id: 'msg-2',
        senderId: 'guest-aria',
        senderName: 'Aria Patel',
        text: 'The opening New York skyline sequence looks incredible in Midnight Violet.',
        timestamp: '21:49',
        videoTimestampSeconds: 142,
        type: 'chat',
      },
    ],
    votes: [
      {
        id: 'vote-g1',
        mediaId: 'nx-1400940',
        mediaTitle: 'Clayface',
        voterId: 'host-marcus',
        voterName: 'Marcus Chen',
      },
      {
        id: 'vote-g2',
        mediaId: 'nx-331092',
        mediaTitle: 'Cyberpunk: Edgerunners — Chrome Requiem',
        voterId: 'guest-aria',
        voterName: 'Aria Patel',
      },
    ],
    couplePulseCount: 0,
    couplePartnerNote: '',
  },
];

for (const room of seedRooms) {
  partyRooms.set(room.roomId, room);
}
// Legacy room ID aliases
partyRooms.set('couple-kyoto-77', seedRooms[0]);
partyRooms.set('nxsha-cinema-1', seedRooms[1]);

// Track WebSocket clients per room
const roomSubscribers = new Map<string, Set<WebSocket>>();

function broadcastToRoom(roomId: string, payload: unknown) {
  const subs = roomSubscribers.get(roomId);
  if (!subs) return;
  const serialized = JSON.stringify(payload);
  for (const client of subs) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(serialized);
    }
  }
}

const GENRE_MAP: Record<number, string> = {
  28: 'Action',
  12: 'Adventure',
  16: 'Animation',
  35: 'Comedy',
  80: 'Crime',
  99: 'Documentary',
  18: 'Drama',
  10751: 'Family',
  14: 'Fantasy',
  36: 'History',
  27: 'Horror',
  10402: 'Music',
  9648: 'Mystery',
  10749: 'Romance',
  878: 'Sci-Fi',
  10770: 'TV Movie',
  53: 'Thriller',
  10752: 'War',
  37: 'Western',
  10759: 'Action & Adventure',
  10762: 'Kids',
  10765: 'Sci-Fi & Fantasy',
  10768: 'War & Politics',
};

const LANGUAGE_MAP: Record<string, string> = {
  en: 'English',
  ja: 'Japanese',
  ko: 'Korean',
  fr: 'French',
  es: 'Spanish',
  de: 'German',
  zh: 'Chinese',
  hi: 'Hindi',
  it: 'Italian',
  pt: 'Portuguese',
};

const PLATFORM_CYCLE: PlatformOrigin[] = [
  'Nxsha Originals',
  'Netflix',
  'Prime Video',
  'Disney+',
  'Max',
  'Crunchyroll',
];

const ACCENT_PALETTE = [
  { accent: '#8b5cf6', secondary: '#1e1b4b' },
  { accent: '#ec4899', secondary: '#3b0764' },
  { accent: '#6366f1', secondary: '#0f172a' },
  { accent: '#10b981', secondary: '#064e3b' },
  { accent: '#38bdf8', secondary: '#0c4a6e' },
  { accent: '#f43f5e', secondary: '#31102f' },
];

interface RawNxshaCard {
  id: number;
  mediaType?: string;
  title?: string;
  originalTitle?: string;
  date?: string;
  year?: string;
  rating?: string | number;
  posterUrl?: string;
  backdropUrl?: string;
  description?: string;
  genreIds?: number[];
  originalLanguage?: string;
}

interface RawNxshaHomeFeedResponse {
  sliderItems?: RawNxshaCard[];
  sections?: Array<{
    heading?: string;
    items?: RawNxshaCard[];
  }>;
}

interface CatalogCacheState {
  items: MediaItem[];
  byTab: Record<string, MediaItem[]>;
  sections: Array<{ heading: string; tabKey: string; count: number }>;
  updatedAt: number;
  liveConnected: boolean;
}

let catalogCache: CatalogCacheState | null = null;
let catalogFetchInFlight: Promise<CatalogCacheState> | null = null;
const CATALOG_CACHE_TTL_MS = 10 * 60 * 1000;

function normalizeNxshaCard(
  raw: RawNxshaCard,
  idx: number,
  tabKey: string,
  sectionHeading = 'Featured'
): MediaItem | null {
  if (!raw || !raw.id || !raw.title) return null;
  const tmdbId = Number(raw.id);
  if (!Number.isFinite(tmdbId) || tmdbId <= 0) return null;

  const isAnime =
    tabKey === 'anime' ||
    sectionHeading.toLowerCase().includes('anime') ||
    (Array.isArray(raw.genreIds) && raw.genreIds.includes(16) && raw.originalLanguage === 'ja');

  const mediaType: MediaCategory = isAnime
    ? 'anime'
    : raw.mediaType === 'tv' || tabKey === 'tv'
    ? 'tv'
    : 'movie';

  const palette = ACCENT_PALETTE[(tmdbId + idx) % ACCENT_PALETTE.length];
  const mappedGenres =
    Array.isArray(raw.genreIds) && raw.genreIds.length > 0
      ? Array.from(
          new Set(
            raw.genreIds
              .map((gid) => GENRE_MAP[gid])
              .filter((g): g is string => Boolean(g))
          )
        ).slice(0, 4)
      : mediaType === 'anime'
      ? ['Animation', 'Action', 'Fantasy']
      : mediaType === 'tv'
      ? ['Drama', 'Mystery']
      : ['Cinema', 'Drama'];

  if (mappedGenres.length === 0) {
    mappedGenres.push(mediaType === 'anime' ? 'Animation' : 'Drama');
  }

  const yearStr =
    raw.year && /^\d{4}$/.test(String(raw.year))
      ? String(raw.year)
      : raw.date && /^\d{4}/.test(String(raw.date))
      ? String(raw.date).slice(0, 4)
      : '2026';

  const parsedRating = Number(raw.rating);
  const rating =
    Number.isFinite(parsedRating) && parsedRating > 0
      ? Number(parsedRating.toFixed(1))
      : 7.6;

  const language =
    (raw.originalLanguage && LANGUAGE_MAP[raw.originalLanguage.toLowerCase()]) ||
    (mediaType === 'anime' ? 'Japanese' : 'English');

  const platform: PlatformOrigin =
    mediaType === 'anime'
      ? 'Crunchyroll'
      : PLATFORM_CYCLE[tmdbId % PLATFORM_CYCLE.length];

  const headingLower = sectionHeading.toLowerCase();
  const isTrending =
    headingLower.includes('trending') ||
    headingLower.includes('slider') ||
    idx < 14;
  const isPopularThisWeek =
    headingLower.includes('popular') ||
    headingLower.includes('top rated') ||
    headingLower.includes('binge') ||
    idx % 3 === 0;
  const isRecentlyAdded =
    headingLower.includes('new') ||
    headingLower.includes('airing') ||
    headingLower.includes('upcoming') ||
    yearStr === '2026' ||
    yearStr === '2025';

  const id = `nx-${tmdbId}`;
  const isCuratedStudio = INITIAL_CATALOG.some((c) => c.tmdbId === tmdbId);

  return {
    id,
    providerId: String(tmdbId),
    tmdbId,
    title: String(raw.title).trim(),
    originalTitle: raw.originalTitle ? String(raw.originalTitle).trim() : undefined,
    mediaType,
    platform,
    releaseDate: raw.date || yearStr,
    year: yearStr,
    rating,
    durationMinutes: mediaType === 'movie' ? 112 + (tmdbId % 38) : 46 + (tmdbId % 18),
    seasons: mediaType === 'movie' ? undefined : 1 + (tmdbId % 4),
    episodes: mediaType === 'movie' ? undefined : 8 + (tmdbId % 16),
    genres: mappedGenres,
    language,
    description:
      raw.description && String(raw.description).trim().length > 0
        ? String(raw.description).trim()
        : `${raw.title} (${yearStr}) — indexed from the Nxsha ${sectionHeading} catalog for synchronized Couple & Group Watch Parties.`,
    posterUrl: raw.posterUrl || undefined,
    backdropUrl: raw.backdropUrl || raw.posterUrl || undefined,
    sectionHeading,
    sourceProvider: 'nxsha.space',
    playbackStatus: isCuratedStudio ? 'synced-ready' : 'embed-only',
    nxshaWatchUrl:
      mediaType === 'movie'
        ? `https://nxsha.space/watch/movie/${tmdbId}`
        : `https://nxsha.space/watch/tv/${tmdbId}/1/1`,
    nxshaEmbedUrl:
      mediaType === 'movie'
        ? `https://nxsha.space/embed/movie/${tmdbId}`
        : `https://nxsha.space/embed/tv/${tmdbId}/1/1`,
    streamUrl: `/api/media/stream/${id}`,
    accentColor: palette.accent,
    secondaryColor: palette.secondary,
    director: sectionHeading ? `${sectionHeading} Selection` : 'Featured Director',
    cast: [
      mappedGenres[0] ? `${mappedGenres[0]} Ensemble` : 'Featured Cast',
      `${yearStr} Official Selection`,
    ],
    isTrending,
    isPopularThisWeek,
    isRecentlyAdded,
    isNewEpisode: mediaType !== 'movie' && isRecentlyAdded,
    coupleScore: Math.min(99, Math.max(78, Math.round(rating * 10 + (mappedGenres.includes('Romance') ? 8 : 3)))),
    groupNightScore: Math.min(99, Math.max(80, Math.round(rating * 10 + (mappedGenres.includes('Action') || mappedGenres.includes('Sci-Fi') ? 7 : 4)))),
  };
}

async function fetchSingleNxshaTab(tabKey: string): Promise<{
  tabKey: string;
  items: MediaItem[];
  sections: Array<{ heading: string; tabKey: string; count: number }>;
  ok: boolean;
}> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6500);
  try {
    const response = await fetch(
      `https://nxsha.space/api/home-feed?tabKey=${encodeURIComponent(tabKey)}`,
      {
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          'User-Agent': 'Mozilla/5.0 (compatible; CineTogetherCatalogEngine/2.0)',
        },
      }
    );
    clearTimeout(timeout);
    if (!response.ok) {
      return { tabKey, items: [], sections: [], ok: false };
    }
    const data = (await response.json()) as RawNxshaHomeFeedResponse;
    const collected: MediaItem[] = [];
    const sectionSummaries: Array<{ heading: string; tabKey: string; count: number }> = [];

    const sliderItems = Array.isArray(data.sliderItems) ? data.sliderItems : [];
    if (sliderItems.length > 0) {
      let count = 0;
      sliderItems.forEach((raw, idx) => {
        const normalized = normalizeNxshaCard(raw, idx, tabKey, `${tabKey.toUpperCase()} Spotlight`);
        if (normalized) {
          collected.push(normalized);
          count++;
        }
      });
      sectionSummaries.push({ heading: `${tabKey.toUpperCase()} Spotlight`, tabKey, count });
    }

    const sections = Array.isArray(data.sections) ? data.sections : [];
    for (const sec of sections) {
      const heading = String(sec?.heading || 'Catalog Row').trim();
      const rawItems = Array.isArray(sec?.items) ? sec.items : [];
      let count = 0;
      rawItems.forEach((raw, idx) => {
        const normalized = normalizeNxshaCard(raw, idx, tabKey, heading);
        if (normalized) {
          collected.push(normalized);
          count++;
        }
      });
      if (count > 0) {
        sectionSummaries.push({ heading, tabKey, count });
      }
    }

    return { tabKey, items: collected, sections: sectionSummaries, ok: collected.length > 0 };
  } catch {
    clearTimeout(timeout);
    return { tabKey, items: [], sections: [], ok: false };
  }
}

async function fetchFullNxshaCatalog(forceRefresh = false): Promise<CatalogCacheState> {
  if (
    !forceRefresh &&
    catalogCache &&
    Date.now() - catalogCache.updatedAt < CATALOG_CACHE_TTL_MS &&
    catalogCache.items.length > INITIAL_CATALOG.length
  ) {
    return catalogCache;
  }

  if (catalogFetchInFlight) {
    return catalogFetchInFlight;
  }

  catalogFetchInFlight = (async () => {
    const tabKeys = ['home', 'movie', 'tv', 'anime'];
    const results = await Promise.all(tabKeys.map((tk) => fetchSingleNxshaTab(tk)));

    const mergedMap = new Map<string, MediaItem>();
    const byTab: Record<string, MediaItem[]> = {
      home: [],
      movie: [],
      tv: [],
      anime: [],
    };
    const allSections: Array<{ heading: string; tabKey: string; count: number }> = [];
    let anyLiveOk = false;

    for (const res of results) {
      if (res.ok) anyLiveOk = true;
      allSections.push(...res.sections);
      const tabMap = new Map<string, MediaItem>();

      for (const item of res.items) {
        const key = `${item.mediaType === 'movie' ? 'movie' : 'tv'}:${item.tmdbId}`;
        if (!tabMap.has(key)) {
          tabMap.set(key, item);
        }
        const existing = mergedMap.get(key);
        if (!existing) {
          mergedMap.set(key, item);
        } else {
          mergedMap.set(key, {
            ...existing,
            mediaType: item.mediaType === 'anime' ? 'anime' : existing.mediaType,
            posterUrl: existing.posterUrl || item.posterUrl,
            backdropUrl: existing.backdropUrl || item.backdropUrl,
            description:
              existing.description.length >= item.description.length
                ? existing.description
                : item.description,
            isTrending: existing.isTrending || item.isTrending,
            isPopularThisWeek: existing.isPopularThisWeek || item.isPopularThisWeek,
            isRecentlyAdded: existing.isRecentlyAdded || item.isRecentlyAdded,
          });
        }
      }
      byTab[res.tabKey] = Array.from(tabMap.values());
    }

    // Ensure curated studio fallback titles are also present or enriched with live posters
    for (const studioItem of INITIAL_CATALOG) {
      const key = `${studioItem.mediaType === 'movie' ? 'movie' : 'tv'}:${studioItem.tmdbId}`;
      const existing = mergedMap.get(key);
      if (existing) {
        mergedMap.set(key, {
          ...existing,
          id: studioItem.id,
          streamUrl: studioItem.streamUrl,
          playbackStatus: 'synced-ready',
          coupleScore: studioItem.coupleScore || existing.coupleScore,
          groupNightScore: studioItem.groupNightScore || existing.groupNightScore,
        });
      } else {
        mergedMap.set(key, {
          ...studioItem,
          playbackStatus: 'synced-ready',
          sourceProvider: 'cinetogether-studio',
        });
      }
    }

    const finalItems = Array.from(mergedMap.values());
    const nextCache: CatalogCacheState = {
      items: finalItems,
      byTab,
      sections: allSections,
      updatedAt: Date.now(),
      liveConnected: anyLiveOk,
    };
    catalogCache = nextCache;
    catalogFetchInFlight = null;
    return nextCache;
  })();

  return catalogFetchInFlight;
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '5mb' }));

  const server = http.createServer(app);

  // Seed Cloud SQL catalog & default rooms asynchronously
  seedCatalogAndDefaultRooms().catch((err) => {
    console.error('Initial DB seed warning:', err);
  });

  // Pre-warm full Nxsha catalog on startup
  fetchFullNxshaCatalog().catch(() => {});

  // 1. Live nxsha.space full multi-section catalog discovery & pagination proxy
  app.get('/api/nxsha/feed', async (req, res) => {
    const tabKey = typeof req.query.tabKey === 'string' ? req.query.tabKey.toLowerCase() : 'all';
    const forceRefresh = req.query.refresh === 'true';
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const pageSize = Math.max(1, Math.min(1000, parseInt(String(req.query.pageSize || '500'), 10) || 500));

    try {
      const state = await fetchFullNxshaCatalog(forceRefresh);
      let pool = state.items;
      if (tabKey === 'movie' || tabKey === 'movies') {
        pool = state.items.filter((i) => i.mediaType === 'movie');
      } else if (tabKey === 'tv') {
        pool = state.items.filter((i) => i.mediaType === 'tv');
      } else if (tabKey === 'anime') {
        pool = state.items.filter((i) => i.mediaType === 'anime');
      }

      const startIdx = (page - 1) * pageSize;
      const pagedItems = pool.slice(startIdx, startIdx + pageSize);

      res.json({
        source: state.liveConnected
          ? `https://nxsha.space/api/home-feed (Full Multi-Section Index · ${state.items.length} Titles)`
          : 'Curated Demo & TMDB Metadata Snapshot',
        liveConnected: state.liveConnected,
        isDemoFallback: !state.liveConnected,
        totalCount: pool.length,
        totalCatalogSize: state.items.length,
        page,
        pageSize,
        hasMore: startIdx + pageSize < pool.length,
        sections: state.sections,
        items: pagedItems,
      });
    } catch {
      res.json({
        source: 'Curated Demo & TMDB Metadata Snapshot',
        liveConnected: false,
        isDemoFallback: true,
        totalCount: INITIAL_CATALOG.length,
        totalCatalogSize: INITIAL_CATALOG.length,
        page: 1,
        pageSize: INITIAL_CATALOG.length,
        hasMore: false,
        sections: [],
        items: INITIAL_CATALOG,
      });
    }
  });

  // 1B. Live Global Catalog Search via nxsha.space/api/search-suggestions + cached catalog
  app.get('/api/nxsha/search', async (req, res) => {
    const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (!query) {
      const state = await fetchFullNxshaCatalog();
      res.json({
        query: '',
        liveSearchUsed: state.liveConnected,
        totalResults: state.items.length,
        items: state.items.slice(0, 60),
      });
      return;
    }

    try {
      const state = await fetchFullNxshaCatalog();
      const qLower = query.toLowerCase();

      const localMatches = state.items.filter((item) => {
        const hay = `${item.title} ${item.originalTitle || ''} ${item.description} ${item.year} ${item.genres.join(' ')}`.toLowerCase();
        return hay.includes(qLower);
      });

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const liveItems: MediaItem[] = [];
      let liveSearchOk = false;

      try {
        const resp = await fetch(
          `https://nxsha.space/api/search-suggestions?q=${encodeURIComponent(query)}`,
          {
            signal: controller.signal,
            headers: {
              Accept: 'application/json',
              'User-Agent': 'Mozilla/5.0 (compatible; CineTogetherCatalogEngine/2.0)',
            },
          }
        );
        clearTimeout(timeout);
        if (resp.ok) {
          const data = (await resp.json()) as {
            items?: Array<{
              id: number;
              mediaType?: string;
              title?: string;
              year?: string;
              date?: string;
              rating?: string | number;
              posterUrl?: string;
              backdropUrl?: string;
              description?: string;
              genreIds?: number[];
            }>;
          };
          const suggestions = Array.isArray(data.items) ? data.items : [];
          liveSearchOk = true;
          suggestions.forEach((raw, idx) => {
            const normalized = normalizeNxshaCard(
              raw,
              idx,
              raw.mediaType === 'tv' ? 'tv' : 'movie',
              'Nxsha Live Search'
            );
            if (normalized) {
              liveItems.push(normalized);
            }
          });
        }
      } catch {
        clearTimeout(timeout);
      }

      // Merge live search hits with local catalog matches without duplicates
      const combinedMap = new Map<string, MediaItem>();
      for (const item of [...liveItems, ...localMatches]) {
        const key = `${item.mediaType === 'movie' ? 'movie' : 'tv'}:${item.tmdbId}`;
        const existing = combinedMap.get(key);
        if (!existing) {
          combinedMap.set(key, item);
          if (catalogCache && !catalogCache.items.some((i) => i.tmdbId === item.tmdbId)) {
            catalogCache.items.push(item);
          }
        } else {
          combinedMap.set(key, {
            ...existing,
            posterUrl: existing.posterUrl || item.posterUrl,
            backdropUrl: existing.backdropUrl || item.backdropUrl,
            description:
              existing.description.length >= item.description.length
                ? existing.description
                : item.description,
          });
        }
      }

      const finalResults = Array.from(combinedMap.values());
      res.json({
        query,
        liveSearchUsed: liveSearchOk,
        totalResults: finalResults.length,
        items: finalResults,
      });
    } catch {
      res.json({
        query,
        liveSearchUsed: false,
        totalResults: 0,
        items: [],
      });
    }
  });

  // 1C. Dynamic TV Series Seasons & Episodes Resolver
  app.get('/api/nxsha/tv/:tmdbId/seasons', async (req, res) => {
    const tmdbId = parseInt(String(req.params.tmdbId || '0'), 10) || 204988;
    const titleQuery = typeof req.query.title === 'string' ? req.query.title.trim() : '';

    // 1. If TMDB_API_KEY is configured, fetch official TMDB season/episode metadata
    const tmdbApiKey = process.env.TMDB_API_KEY;
    if (tmdbApiKey) {
      try {
        const showResp = await fetch(
          `https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${encodeURIComponent(tmdbApiKey)}`
        );
        if (showResp.ok) {
          const showData = (await showResp.json()) as {
            name?: string;
            seasons?: Array<{ season_number: number; name: string; episode_count: number; air_date?: string; poster_path?: string }>;
          };
          const validSeasons = (showData.seasons || []).filter((s) => s.season_number > 0).slice(0, 8);
          const seasonsDetail: TvSeasonDetail[] = [];

          for (const s of validSeasons) {
            const sResp = await fetch(
              `https://api.themoviedb.org/3/tv/${tmdbId}/season/${s.season_number}?api_key=${encodeURIComponent(tmdbApiKey)}`
            );
            if (sResp.ok) {
              const sData = (await sResp.json()) as {
                episodes?: Array<{
                  id: number;
                  episode_number: number;
                  name: string;
                  overview: string;
                  runtime?: number;
                  air_date?: string;
                  still_path?: string;
                }>;
              };
              const episodes: TvEpisodeItem[] = (sData.episodes || []).map((ep) => ({
                id: `tv-${tmdbId}-s${s.season_number}-e${ep.episode_number}`,
                seasonNumber: s.season_number,
                episodeNumber: ep.episode_number,
                title: ep.name || `Episode ${ep.episode_number}`,
                overview: ep.overview || `Season ${s.season_number}, Episode ${ep.episode_number} of ${showData.name || titleQuery}.`,
                durationMinutes: ep.runtime || 48,
                airDate: ep.air_date || '2026',
                stillUrl: ep.still_path ? `https://image.tmdb.org/t/p/w500${ep.still_path}` : undefined,
                nxshaEmbedUrl: `https://nxsha.space/embed/tv/${tmdbId}/${s.season_number}/${ep.episode_number}`,
                nxshaWatchUrl: `https://nxsha.space/watch/tv/${tmdbId}/${s.season_number}/${ep.episode_number}`,
              }));
              seasonsDetail.push({
                seasonNumber: s.season_number,
                name: s.name || `Season ${s.season_number}`,
                episodeCount: episodes.length,
                airDate: s.air_date,
                posterUrl: s.poster_path ? `https://image.tmdb.org/t/p/w500${s.poster_path}` : undefined,
                episodes,
              });
            }
          }

          if (seasonsDetail.length > 0) {
            res.json({
              tmdbId,
              source: 'TMDB Official Episode Metadata + Nxsha Embed Resolver',
              seasons: seasonsDetail,
            });
            return;
          }
        }
      } catch {
        // Fall through to TVMaze / deterministic episodic index
      }
    }

    // 2. Query public TVMaze Episode Index by title for real episode titles, air dates, and synopses
    const cachedItem = catalogCache?.items.find((i) => i.tmdbId === tmdbId);
    const lookupTitle = titleQuery || cachedItem?.title || '';

    if (lookupTitle) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 4500);
        const mazeResp = await fetch(
          `https://api.tvmaze.com/singlesearch/shows?q=${encodeURIComponent(lookupTitle)}&embed=episodes`,
          { signal: controller.signal }
        );
        clearTimeout(timeout);
        if (mazeResp.ok) {
          const mazeData = (await mazeResp.json()) as {
            name?: string;
            _embedded?: {
              episodes?: Array<{
                id: number;
                name?: string;
                season?: number;
                number?: number;
                airdate?: string;
                runtime?: number;
                image?: { medium?: string; original?: string };
                summary?: string;
              }>;
            };
          };
          const rawEpisodes = mazeData._embedded?.episodes || [];
          if (rawEpisodes.length > 0) {
            const seasonBuckets = new Map<number, TvEpisodeItem[]>();
            for (const ep of rawEpisodes) {
              const sNum = Math.max(1, Number(ep.season) || 1);
              const eNum = Math.max(1, Number(ep.number) || 1);
              if (sNum > 12) continue;
              const cleanSummary = ep.summary
                ? ep.summary.replace(/<[^>]+>/g, '').trim()
                : `Season ${sNum}, Episode ${eNum} of ${lookupTitle}.`;
              const epItem: TvEpisodeItem = {
                id: `tv-${tmdbId}-s${sNum}-e${eNum}`,
                seasonNumber: sNum,
                episodeNumber: eNum,
                title: ep.name || `Episode ${eNum}`,
                overview: cleanSummary,
                durationMinutes: Number(ep.runtime) || 48,
                airDate: ep.airdate || '2026',
                stillUrl: ep.image?.medium || ep.image?.original || cachedItem?.backdropUrl,
                nxshaEmbedUrl: `https://nxsha.space/embed/tv/${tmdbId}/${sNum}/${eNum}`,
                nxshaWatchUrl: `https://nxsha.space/watch/tv/${tmdbId}/${sNum}/${eNum}`,
              };
              if (!seasonBuckets.has(sNum)) {
                seasonBuckets.set(sNum, []);
              }
              seasonBuckets.get(sNum)!.push(epItem);
            }

            const seasonsDetail: TvSeasonDetail[] = Array.from(seasonBuckets.entries())
              .sort((a, b) => a[0] - b[0])
              .map(([seasonNumber, episodes]) => ({
                seasonNumber,
                name: `Season ${seasonNumber}`,
                episodeCount: episodes.length,
                airDate: episodes[0]?.airDate,
                posterUrl: cachedItem?.posterUrl,
                episodes,
              }));

            if (seasonsDetail.length > 0) {
              res.json({
                tmdbId,
                source: 'Live Episodic Metadata Index + Nxsha Embed Resolver',
                seasons: seasonsDetail,
              });
              return;
            }
          }
        }
      } catch {
        // Fallback below
      }
    }

    // 3. Structured multi-season fallback mapped to Nxsha /embed/tv/{id}/{season}/{episode}
    const seasonCount = Math.max(2, Math.min(5, cachedItem?.seasons || 2));
    const epPerSeason = Math.max(6, Math.min(12, cachedItem?.episodes || 8));
    const fallbackSeasons: TvSeasonDetail[] = [];

    for (let s = 1; s <= seasonCount; s++) {
      const episodes: TvEpisodeItem[] = [];
      for (let e = 1; e <= epPerSeason; e++) {
        episodes.push({
          id: `tv-${tmdbId}-s${s}-e${e}`,
          seasonNumber: s,
          episodeNumber: e,
          title: `Chapter ${e}: ${lookupTitle || 'Series'} (S${s}·E${e})`,
          overview:
            cachedItem?.description ||
            `Stream Season ${s}, Episode ${e} via Nxsha Embed (/embed/tv/${tmdbId}/${s}/${e}) or launch a synchronized Watch Party.`,
          durationMinutes: cachedItem?.durationMinutes || 48,
          airDate: cachedItem?.year || '2026',
          stillUrl: cachedItem?.backdropUrl || cachedItem?.posterUrl,
          nxshaEmbedUrl: `https://nxsha.space/embed/tv/${tmdbId}/${s}/${e}`,
          nxshaWatchUrl: `https://nxsha.space/watch/tv/${tmdbId}/${s}/${e}`,
        });
      }
      fallbackSeasons.push({
        seasonNumber: s,
        name: `Season ${s}`,
        episodeCount: episodes.length,
        airDate: cachedItem?.year || '2026',
        posterUrl: cachedItem?.posterUrl,
        episodes,
      });
    }

    res.json({
      tmdbId,
      source: 'Nxsha Episodic Stream Resolver (/embed/tv/{id}/{season}/{episode})',
      seasons: fallbackSeasons,
    });
  });

  // 2. Watch Party Rooms REST API (List & Create)
  app.get('/api/party/rooms', async (_req, res) => {
    try {
      const dbRooms = await listActiveWatchRooms().catch(() => []);
      const uniqueRooms = new Map<string, PartyPlaybackState>();
      for (const [key, room] of partyRooms.entries()) {
        if (key === 'couple-kyoto-77' || key === 'nxsha-cinema-1') continue;
        uniqueRooms.set(room.roomId, room);
      }
      res.json({
        rooms: Array.from(uniqueRooms.values()),
        dbRoomCount: dbRooms.length,
      });
    } catch (error) {
      console.error('Route Error in GET /api/party/rooms:', error);
      res.status(500).json({ error: 'Failed to list watch party rooms' });
    }
  });

  app.post('/api/party/rooms', optionalAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const {
        roomCode,
        mode,
        roomName,
        description,
        hostId,
        hostName,
        mediaId,
        mediaType,
        password,
        maxParticipants,
        collaborativeControls,
        roomTheme,
      } = req.body || {};

      const cleanMode = mode === 'couple' ? 'couple' : 'group';
      const cleanCode = String(
        roomCode || `${cleanMode === 'couple' ? 'LOVE' : 'CLUB'}-${Math.floor(1000 + Math.random() * 9000)}`
      )
        .trim()
        .toUpperCase();

      const resolvedHostId = req.user?.uid || String(hostId || `host-${Date.now()}`);
      const resolvedHostName = String(hostName || req.user?.name || 'Cinema Host');
      const resolvedMediaId = String(mediaId || (cleanMode === 'couple' ? 'nx-204988' : 'nx-969681'));
      const resolvedMediaType =
        mediaType === 'tv' || mediaType === 'anime' ? mediaType : 'movie';
      const resolvedTheme: RoomThemeId =
        roomTheme || (cleanMode === 'couple' ? 'rose-nebula' : 'midnight-violet');

      if (password && String(password).trim()) {
        const hashed = hashPassword(String(password));
        if (hashed) {
          roomPasswords.set(cleanCode, hashed);
        }
      }

      const newRoomState: PartyPlaybackState = {
        roomId: cleanCode,
        roomCode: cleanCode,
        roomName:
          String(roomName || '').trim() ||
          (cleanMode === 'couple'
            ? `${resolvedHostName}'s Couple Cinema`
            : `${resolvedHostName}'s Group Screening`),
        mode: cleanMode,
        mediaId: resolvedMediaId,
        mediaType: resolvedMediaType,
        season: 1,
        episode: 1,
        isPlaying: false,
        currentTimeSeconds: 0,
        playbackRate: 1,
        revision: 1,
        updatedAtMs: Date.now(),
        hostId: resolvedHostId,
        collaborativeControls:
          typeof collaborativeControls === 'boolean'
            ? collaborativeControls
            : cleanMode === 'couple',
        isLocked: false,
        roomTheme: resolvedTheme,
        lifecycleState: 'waiting',
        members: [
          {
            id: resolvedHostId,
            name: resolvedHostName,
            avatarColor: cleanMode === 'couple' ? '#f43f5e' : '#8b5cf6',
            role: 'host',
            isOnline: true,
            joinedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            mood: cleanMode === 'couple' ? 'Waiting for Partner' : 'Hosting',
            micMuted: true,
            camEnabled: false,
          },
        ],
        messages: [
          {
            id: `sys-${Date.now()}`,
            senderId: 'system',
            senderName: 'CineTogether',
            text:
              cleanMode === 'couple'
                ? `Private Couple Cinema created (${cleanCode}). Share the invite link with your partner!`
                : `Group Cinema room created (${cleanCode}). Up to ${maxParticipants || 12} friends can join.`,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            videoTimestampSeconds: 0,
            type: 'system',
          },
        ],
        votes: [],
        couplePulseCount: 0,
        couplePartnerNote:
          cleanMode === 'couple'
            ? description || 'Our private cinema for two · Different places, one screen.'
            : description || '',
      };

      partyRooms.set(cleanCode, newRoomState);

      await createWatchRoomInDb({
        roomCode: cleanCode,
        roomType: cleanMode,
        title: newRoomState.roomName,
        description: String(description || ''),
        hostUserId: resolvedHostId,
        hostDisplayName: resolvedHostName,
        currentMediaId: resolvedMediaId,
        currentMediaType: resolvedMediaType,
        password: password ? String(password) : undefined,
        maxParticipants: cleanMode === 'couple' ? 2 : Number(maxParticipants) || 12,
        collaborativeControls: newRoomState.collaborativeControls,
        roomTheme: resolvedTheme,
      }).catch((err) => {
        console.error('Non-fatal DB room persistence warning:', err);
      });

      res.status(201).json({
        room: newRoomState,
        hasPassword: roomPasswords.has(cleanCode),
      });
    } catch (error) {
      console.error('Route Error in POST /api/party/rooms:', error);
      res.status(500).json({ error: 'Failed to create watch party room' });
    }
  });

  app.post('/api/party/rooms/:roomCode/verify', async (req, res) => {
    try {
      const code = String(req.params.roomCode || '').trim().toUpperCase();
      const { password } = req.body || {};
      const memHash = roomPasswords.get(code);

      if (memHash) {
        const candidate = hashPassword(String(password || ''));
        if (candidate !== memHash) {
          res.status(403).json({ valid: false, error: 'Incorrect room password' });
          return;
        }
      } else {
        const dbRoom = await getWatchRoomByCode(code).catch(() => null);
        if (dbRoom?.passwordHash) {
          const candidate = hashPassword(String(password || ''));
          if (candidate !== dbRoom.passwordHash) {
            res.status(403).json({ valid: false, error: 'Incorrect room password' });
            return;
          }
        }
      }

      const memRoom = partyRooms.get(code);
      res.json({
        valid: true,
        roomCode: code,
        mode: memRoom?.mode || (code.startsWith('LOVE') ? 'couple' : 'group'),
      });
    } catch (error) {
      console.error('Route Error in POST /api/party/rooms/:roomCode/verify:', error);
      res.status(500).json({ valid: false, error: 'Failed to verify room code' });
    }
  });

  // 3. Watchlist Cloud SQL API
  app.get('/api/watchlist', optionalAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.user?.uid || String(req.query.userId || 'guest-default');
      const items = await getUserWatchlistItems(userId).catch(() => []);
      res.json({ items });
    } catch (error) {
      console.error('Route Error in GET /api/watchlist:', error);
      res.status(500).json({ error: 'Failed to fetch watchlist' });
    }
  });

  app.post('/api/watchlist/toggle', optionalAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.user?.uid || String(req.body?.userId || 'guest-default');
      const { mediaId, mediaTitle, mediaType, posterUrl, year, rating } = req.body || {};
      if (!mediaId || !mediaTitle) {
        res.status(400).json({ error: 'mediaId and mediaTitle are required' });
        return;
      }
      const result = await toggleUserWatchlistItem({
        userId,
        mediaId: String(mediaId),
        mediaTitle: String(mediaTitle),
        mediaType: String(mediaType || 'movie'),
        posterUrl: String(posterUrl || `/poster/${mediaId}`),
        year: String(year || '2026'),
        rating: Number(rating) || 8.5,
      });
      res.json(result);
    } catch (error) {
      console.error('Route Error in POST /api/watchlist/toggle:', error);
      res.status(500).json({ error: 'Failed to update watchlist' });
    }
  });

  // 4. User Profile Preferences & Watch Sessions API
  app.post('/api/profile/preferences', optionalAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const uid = req.user?.uid || String(req.body?.uid || 'guest-default');
      const email = req.user?.email || String(req.body?.email || 'guest@cinetogether.app');
      const displayName = String(req.body?.displayName || req.user?.name || 'Cinema Explorer');
      const preferredTheme = String(req.body?.preferredTheme || 'midnight-violet');

      const profile = await updateProfilePreferences({
        uid,
        email,
        displayName,
        preferredTheme,
      });
      res.json({ profile });
    } catch (error) {
      console.error('Route Error in POST /api/profile/preferences:', error);
      res.status(500).json({ error: 'Failed to save profile preferences' });
    }
  });

  app.post('/api/sessions/record', optionalAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.user?.uid || String(req.body?.userId || 'guest-default');
      const { mediaId, mediaTitle, mediaType, roomType, progressSeconds, durationSeconds } =
        req.body || {};
      const session = await recordWatchSessionInDb({
        userId,
        mediaId: String(mediaId || 'nx-204988'),
        mediaTitle: String(mediaTitle || 'Featured Title'),
        mediaType: String(mediaType || 'movie'),
        roomType: String(roomType || 'solo'),
        progressSeconds: Number(progressSeconds) || 0,
        durationSeconds: Number(durationSeconds) || 7200,
      });
      res.json({ session });
    } catch (error) {
      console.error('Route Error in POST /api/sessions/record:', error);
      res.status(500).json({ error: 'Failed to record watch session' });
    }
  });

  // 5. Gemini AI Companion & Curator Endpoints
  app.post('/api/gemini/analyze', async (req, res) => {
    const { title, description, genres, query, mode } = req.body || {};
    const promptText = `Analyze the film/series "${title || 'Velvet Echoes in Kyoto'}" (${(genres || []).join(', ')}).
Synopsis: ${description || ''}
User Query / Focus: ${query || 'Explain the deeper thematic architecture, visual motifs, and provide 3 Watch Party discussion questions.'}
Provide a clear, insightful breakdown with sections:
1. Thematic & Narrative Architecture
2. Cinematography & Acoustic Motifs
3. Watch Party & Couple Lounge Discussion Prompts`;

    const ai = getAiClient();
    if (ai) {
      try {
        const response = await ai.models.generateContent({
          model: 'gemini-3-flash-preview',
          contents: promptText,
          config: {
            thinkingConfig: {
              thinkingLevel: ThinkingLevel.HIGH,
            },
            systemInstruction:
              'You are the Chief Film Theorist and Cinema Architect for CineTogether. Deliver sharp, deeply reasoned film analysis formatted in clean paragraphs and bullet points.',
          },
        });

        if (response.text) {
          res.json({
            model: 'gemini-3-flash-preview',
            thinkingLevel: 'HIGH',
            analysis: response.text,
          });
          return;
        }
      } catch {
        // Fallback below
      }
    }

    const structuredAnalysis = [
      `01. Thematic & Narrative Architecture — ${title || 'Featured Title'}`,
      `At its core, ${title || 'this work'} interrogates human connection across distance and time. Drawing from ${(genres || ['Romance', 'Drama']).join(' and ')} traditions, the narrative structures each act around shared memory and emotional resonance.`,
      ``,
      `02. Cinematography & Acoustic Motifs`,
      `The visual grammar relies on atmospheric neon-and-shadow contrast paired with anamorphic shallow depth-of-field. Notice how ambient acoustic textures—rain on temple stone, low-frequency resonance, and isolated dialogue tracks—signal major emotional turning points.`,
      ``,
      `03. ${mode === 'couple' ? 'Couple Cinema Intimate' : 'Group Watch Party'} Discussion Prompts`,
      `• At what exact moment do the characters realize their fates are intertwined, and how would you have reacted?`,
      `• How does the director use lighting and cityscapes to mirror internal longing?`,
      `• Which unresolved motif in the final act sets up the strongest trajectory for the next episode?`,
    ].join('\n');

    res.json({
      model: 'CineTogether Film Curator',
      thinkingLevel: 'HIGH',
      analysis: structuredAnalysis,
    });
  });

  app.post('/api/gemini/recommend', async (req, res) => {
    const { historyTitles, mood, partyMode } = req.body || {};
    const ai = getAiClient();

    if (ai) {
      try {
        const response = await ai.models.generateContent({
          model: 'gemini-3-flash-preview',
          contents: `User recently watched: ${(historyTitles || ['Velvet Echoes in Kyoto', 'Spider-Man: Brand New Day']).join(', ')}.
Desired mood: ${mood || 'Atmospheric & Immersive'}.
Watch Mode: ${partyMode || 'Couple Watch Party'}.
Curate a 3-step viewing itinerary from the CineTogether catalog.`,
          config: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                itineraryTitle: { type: Type.STRING },
                curatorNote: { type: Type.STRING },
                picks: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      title: { type: Type.STRING },
                      reason: { type: Type.STRING },
                      optimalBitrate: { type: Type.STRING },
                    },
                  },
                },
              },
            },
          },
        });

        if (response.text) {
          res.json({
            model: 'gemini-3-flash-preview',
            data: JSON.parse(response.text.trim()),
          });
          return;
        }
      } catch {
        // Fallback below
      }
    }

    res.json({
      model: 'CineTogether Curator',
      data: {
        itineraryTitle: `${mood || 'Nocturnal Cinema'} — ${partyMode === 'couple' ? 'Couple Double-Feature' : 'Group Night Sequence'}`,
        curatorNote: `Curated from your enjoyment of ${(historyTitles || ['Velvet Echoes in Kyoto', 'Spider-Man: Brand New Day']).slice(0, 2).join(' & ')}.`,
        picks: [
          {
            title: 'Velvet Echoes in Kyoto',
            reason: 'Matches your 99% affinity for atmospheric acoustic storytelling and intimate pacing.',
            optimalBitrate: 'Synced Studio Stream · 4K HDR',
          },
          {
            title: 'Midnight over Montmartre',
            reason: 'Romantic Paris rooftop cinema with unforgettable soundtrack chemistry.',
            optimalBitrate: 'Synced Studio Stream · 1080p',
          },
          {
            title: 'Spider-Man: Brand New Day',
            reason: 'High-kinetic emotional stakes ideal for an energetic Group Movie Night.',
            optimalBitrate: 'Synced Studio Stream · 4K UHD',
          },
        ],
      },
    });
  });

  // 6. WebSocket Server for Watch Party (/ws/party) and Live Companion (/ws/live)
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url || '/', `http://${request.headers.host}`).pathname;
    if (pathname === '/ws/party' || pathname === '/ws/live') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request, pathname);
      });
    }
  });

  wss.on('connection', async (ws: WebSocket, _request: http.IncomingMessage, pathname: string) => {
    if (pathname === '/ws/party') {
      let currentRoomId = 'LOVE-2026';
      let currentMemberId = `user-${Math.random().toString(36).slice(2, 7)}`;

      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString());

          if (msg.type === 'room:join') {
            const rawRoomId = String(msg.roomId || 'LOVE-2026').trim();
            const roomId =
              rawRoomId === 'couple-kyoto-77' || rawRoomId === 'nxsha-cinema-1'
                ? rawRoomId
                : rawRoomId.toUpperCase();
            currentRoomId = roomId;
            currentMemberId = String(msg.memberId || currentMemberId);
            const memberName = String(msg.memberName || 'Cinema Guest');
            const mode = msg.mode === 'couple' || roomId.startsWith('LOVE') ? 'couple' : 'group';

            if (!partyRooms.has(roomId)) {
              partyRooms.set(roomId, {
                roomId,
                roomCode: roomId,
                roomName:
                  msg.roomName ||
                  (mode === 'couple' ? 'Private Couple Cinema' : 'Friends & Group Cinema'),
                mode,
                mediaId: msg.mediaId || (mode === 'couple' ? 'nx-204988' : 'nx-969681'),
                mediaType: msg.mediaType || 'movie',
                season: 1,
                episode: 1,
                isPlaying: false,
                currentTimeSeconds: 0,
                playbackRate: 1,
                revision: 1,
                updatedAtMs: Date.now(),
                hostId: currentMemberId,
                collaborativeControls: mode === 'couple',
                isLocked: false,
                roomTheme: mode === 'couple' ? 'rose-nebula' : 'midnight-violet',
                lifecycleState: 'waiting',
                members: [],
                messages: [],
                votes: [],
                couplePulseCount: 0,
                couplePartnerNote:
                  mode === 'couple' ? 'Different places. One screen. Shared moments. ❤️' : '',
              });
            }

            const room = partyRooms.get(roomId)!;

            // Check if room is locked and member is not already in room
            const existingMember = room.members.find((m) => m.id === currentMemberId);
            if (room.isLocked && !existingMember && room.hostId !== currentMemberId) {
              ws.send(
                JSON.stringify({
                  type: 'room:error',
                  error: 'This watch room has been locked by the host.',
                })
              );
              return;
            }

            if (!existingMember) {
              if (room.mode === 'couple' && room.members.length >= 2) {
                // Replace second partner slot in 2-seat Couple mode
                room.members[1] = {
                  id: currentMemberId,
                  name: memberName,
                  avatarColor: '#ec4899',
                  role: 'partner',
                  isOnline: true,
                  joinedAt: new Date().toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  }),
                  mood: 'In Sync ❤️',
                  micMuted: true,
                  camEnabled: false,
                };
              } else {
                const role =
                  room.members.length === 0
                    ? 'host'
                    : room.mode === 'couple'
                    ? 'partner'
                    : 'member';
                room.members.push({
                  id: currentMemberId,
                  name: memberName,
                  avatarColor:
                    role === 'host'
                      ? '#f43f5e'
                      : role === 'partner'
                      ? '#ec4899'
                      : '#8b5cf6',
                  role,
                  isOnline: true,
                  joinedAt: new Date().toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  }),
                  mood: room.mode === 'couple' ? 'In Sync ❤️' : 'Watching',
                  micMuted: true,
                  camEnabled: false,
                });
              }

              // Update Couple Room lifecycle state automatically when partner joins
              if (room.mode === 'couple') {
                if (room.members.length >= 2 && room.lifecycleState === 'waiting') {
                  room.lifecycleState = 'joined';
                } else if (room.members.length === 1) {
                  room.lifecycleState = 'waiting';
                }
              }
            } else {
              existingMember.isOnline = true;
              existingMember.name = memberName;
            }

            if (!roomSubscribers.has(roomId)) {
              roomSubscribers.set(roomId, new Set());
            }
            roomSubscribers.get(roomId)!.add(ws);

            broadcastToRoom(roomId, {
              type: 'room:state',
              room,
            });
            return;
          }

          const room = partyRooms.get(currentRoomId);
          if (!room) return;

          if (msg.type === 'playback:update') {
            // Check permission: host, moderator, partner in couple mode, or when collaborativeControls is enabled
            const senderMember = room.members.find((m) => m.id === currentMemberId);
            const canControl =
              room.mode === 'couple' ||
              room.collaborativeControls ||
              room.hostId === currentMemberId ||
              senderMember?.role === 'host' ||
              senderMember?.role === 'moderator';

            if (!canControl) {
              ws.send(
                JSON.stringify({
                  type: 'room:error',
                  error: 'Host-only playback control is active in this Group room.',
                })
              );
              return;
            }

            if (typeof msg.isPlaying === 'boolean') {
              room.isPlaying = msg.isPlaying;
              room.lifecycleState = msg.isPlaying ? 'playing' : 'paused';
            }
            if (typeof msg.currentTimeSeconds === 'number') {
              room.currentTimeSeconds = Math.max(0, msg.currentTimeSeconds);
            }
            if (typeof msg.playbackRate === 'number') {
              room.playbackRate = msg.playbackRate;
            }
            if (typeof msg.mediaId === 'string' && msg.mediaId !== room.mediaId) {
              room.mediaId = msg.mediaId;
              room.currentTimeSeconds = 0;
              room.lifecycleState = 'ready';
            }
            if (typeof msg.season === 'number') {
              room.season = Math.max(1, msg.season);
            }
            if (typeof msg.episode === 'number') {
              room.episode = Math.max(1, msg.episode);
            }

            room.revision = (room.revision || 1) + 1;
            room.updatedAtMs = Date.now();

            updatePlaybackStateInDb({
              roomCode: room.roomCode || currentRoomId,
              mediaId: room.mediaId,
              status: room.isPlaying ? 'playing' : 'paused',
              positionSeconds: room.currentTimeSeconds,
              playbackRate: room.playbackRate,
              hostId: room.hostId,
              revision: room.revision,
            }).catch(() => {});

            broadcastToRoom(currentRoomId, {
              type: 'room:state',
              room,
            });
            return;
          }

          if (msg.type === 'room:settings') {
            if (typeof msg.collaborativeControls === 'boolean') {
              room.collaborativeControls = msg.collaborativeControls;
            }
            if (typeof msg.isLocked === 'boolean') {
              room.isLocked = msg.isLocked;
            }
            if (typeof msg.roomTheme === 'string') {
              room.roomTheme = msg.roomTheme as RoomThemeId;
            }
            if (typeof msg.lifecycleState === 'string') {
              room.lifecycleState = msg.lifecycleState as RoomLifecycleState;
            }
            if (typeof msg.newHostId === 'string') {
              room.hostId = msg.newHostId;
              room.members.forEach((m) => {
                if (m.id === msg.newHostId) m.role = 'host';
                else if (m.role === 'host') m.role = room.mode === 'couple' ? 'partner' : 'member';
              });
            }
            room.revision = (room.revision || 1) + 1;
            room.updatedAtMs = Date.now();

            broadcastToRoom(currentRoomId, {
              type: 'room:state',
              room,
            });
            return;
          }

          if (msg.type === 'member:kick') {
            const targetId = String(msg.targetId || '');
            if (targetId && targetId !== room.hostId) {
              room.members = room.members.filter((m) => m.id !== targetId);
              broadcastToRoom(currentRoomId, {
                type: 'room:state',
                room,
              });
            }
            return;
          }

          if (msg.type === 'member:media-state') {
            const member = room.members.find((m) => m.id === currentMemberId);
            if (member) {
              if (typeof msg.micMuted === 'boolean') member.micMuted = msg.micMuted;
              if (typeof msg.camEnabled === 'boolean') member.camEnabled = msg.camEnabled;
              if (typeof msg.mood === 'string') member.mood = msg.mood;
              broadcastToRoom(currentRoomId, {
                type: 'room:state',
                room,
              });
            }
            return;
          }

          if (msg.type === 'webrtc:signal') {
            // Relay WebRTC signaling payload to other participants in the room
            broadcastToRoom(currentRoomId, {
              type: 'webrtc:signal',
              senderId: currentMemberId,
              targetId: msg.targetId,
              signalData: msg.signalData,
            });
            return;
          }

          if (msg.type === 'chat:send') {
            const chatMsg: ChatMessage = {
              id: msg.id || `m-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
              senderId: currentMemberId,
              senderName: String(msg.senderName || 'Guest'),
              text: String(msg.text || '').slice(0, 500),
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              videoTimestampSeconds:
                typeof msg.videoTimestampSeconds === 'number'
                  ? Math.round(msg.videoTimestampSeconds)
                  : Math.round(room.currentTimeSeconds),
              type: msg.messageType || 'chat',
            };

            if (!room.messages.some((m) => m.id === chatMsg.id)) {
              room.messages.push(chatMsg);
              if (room.messages.length > 100) room.messages.shift();
            }

            recordChatMessageInDb({
              roomCode: room.roomCode || currentRoomId,
              senderId: chatMsg.senderId,
              senderName: chatMsg.senderName,
              content: chatMsg.text,
              messageType: chatMsg.type,
              videoTimestampSeconds: chatMsg.videoTimestampSeconds,
            }).catch(() => {});

            broadcastToRoom(currentRoomId, {
              type: 'room:state',
              room,
            });
            return;
          }

          if (msg.type === 'reaction:send' || msg.type === 'couple:pulse') {
            const emoji = String(msg.emoji || '❤️');
            const senderName = String(msg.senderName || 'Partner');
            room.couplePulseCount += 1;

            if (msg.type === 'couple:pulse') {
              const pulseMsg: ChatMessage = {
                id: `pulse-${Date.now()}`,
                senderId: currentMemberId,
                senderName,
                text: `Sent a floating ${emoji} reaction (#${room.couplePulseCount})`,
                timestamp: new Date().toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                }),
                videoTimestampSeconds: Math.round(room.currentTimeSeconds),
                type: 'heartbeat',
              };
              room.messages.push(pulseMsg);
            }

            recordReactionInDb({
              roomCode: room.roomCode || currentRoomId,
              userId: currentMemberId,
              userName: senderName,
              emoji,
            }).catch(() => {});

            broadcastToRoom(currentRoomId, {
              type: 'room:reaction',
              reaction: {
                id: `react-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
                userId: currentMemberId,
                userName: senderName,
                emoji,
                xPercent: Math.floor(15 + Math.random() * 70),
                createdAt: Date.now(),
              },
              room,
            });
            return;
          }

          if (msg.type === 'vote:cast') {
            const mediaId = String(msg.mediaId || '');
            const mediaTitle = String(msg.mediaTitle || '');
            const voterName = String(msg.voterName || 'Member');
            if (!mediaId || !mediaTitle) return;

            const existingIdx = room.votes.findIndex(
              (v) => v.mediaId === mediaId && v.voterId === currentMemberId
            );
            if (existingIdx >= 0) {
              room.votes.splice(existingIdx, 1);
            } else {
              room.votes.push({
                id: `vote-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
                mediaId,
                mediaTitle,
                voterId: currentMemberId,
                voterName,
              });
              recordRoomVoteInDb({
                roomCode: room.roomCode || currentRoomId,
                mediaId,
                mediaTitle,
                voterId: currentMemberId,
                voterName,
              }).catch(() => {});
            }

            broadcastToRoom(currentRoomId, {
              type: 'room:state',
              room,
            });
            return;
          }

          if (msg.type === 'couple:note') {
            room.couplePartnerNote = String(msg.note || '').slice(0, 220);
            broadcastToRoom(currentRoomId, {
              type: 'room:state',
              room,
            });
          }
        } catch {
          // Ignore malformed WS frames
        }
      });

      ws.on('close', () => {
        const subs = roomSubscribers.get(currentRoomId);
        if (subs) {
          subs.delete(ws);
        }
      });
      return;
    }

    // Gemini Live API real-time voice session (/ws/live)
    if (pathname === '/ws/live') {
      const ai = getAiClient();
      if (!ai) {
        ws.send(
          JSON.stringify({
            type: 'live:status',
            connected: true,
            mode: 'fallback',
            transcript:
              'CineTogether Voice Companion active. Ask for Couple Night or Group Movie Night recommendations anytime.',
          })
        );
        ws.on('message', (raw) => {
          try {
            const payload = JSON.parse(raw.toString());
            if (payload.textPrompt) {
              ws.send(
                JSON.stringify({
                  type: 'live:transcript',
                  role: 'model',
                  text: `CineTogether Companion: For "${payload.textPrompt}", I recommend starting a Couple Cinema room with Velvet Echoes in Kyoto (99% Couple Match) or Spider-Man: Brand New Day for Group Night.`,
                })
              );
            }
          } catch {
            // ignore
          }
        });
        return;
      }

      try {
        const sessionPromise = ai.live.connect({
          model: 'gemini-2.5-flash-native-audio-preview-09-2025',
          config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: 'Zephyr' },
              },
            },
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            systemInstruction:
              'You are the real-time voice companion for CineTogether. Help users pick movies, set up Couple Cinema or Group Cinema rooms, and discuss plot twists concisely.',
          },
          callbacks: {
            onopen: () => {
              ws.send(JSON.stringify({ type: 'live:status', connected: true, mode: 'live' }));
            },
            onmessage: (message: LiveServerMessage) => {
              const audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
              if (audio) {
                ws.send(JSON.stringify({ type: 'live:audio', audio }));
              }
              const outTranscript = message.serverContent?.outputTranscription?.text;
              if (outTranscript) {
                ws.send(
                  JSON.stringify({
                    type: 'live:transcript',
                    role: 'model',
                    text: outTranscript,
                  })
                );
              }
              const inTranscript = message.serverContent?.inputTranscription?.text;
              if (inTranscript) {
                ws.send(
                  JSON.stringify({
                    type: 'live:transcript',
                    role: 'user',
                    text: inTranscript,
                  })
                );
              }
              if (message.serverContent?.interrupted) {
                ws.send(JSON.stringify({ type: 'live:interrupted', interrupted: true }));
              }
            },
            onerror: () => {
              ws.send(
                JSON.stringify({
                  type: 'live:status',
                  connected: true,
                  mode: 'fallback',
                })
              );
            },
          },
        });

        ws.on('message', (data) => {
          try {
            const parsed = JSON.parse(data.toString());
            if (parsed.audio) {
              sessionPromise
                .then((session) => {
                  session.sendRealtimeInput({
                    audio: { data: parsed.audio, mimeType: 'audio/pcm;rate=16000' },
                  });
                })
                .catch(() => {});
            } else if (parsed.textPrompt) {
              sessionPromise
                .then((session) => {
                  session.sendRealtimeInput({
                    text: String(parsed.textPrompt),
                  });
                })
                .catch(() => {
                  ws.send(
                    JSON.stringify({
                      type: 'live:transcript',
                      role: 'model',
                      text: `CineTogether Companion: Based on "${parsed.textPrompt}", Velvet Echoes in Kyoto (99% Couple Match) and Spider-Man: Brand New Day are ready to stream now.`,
                    })
                  );
                });
            }
          } catch {
            // ignore
          }
        });

        ws.on('close', () => {
          sessionPromise.then((session) => session.close()).catch(() => {});
        });
      } catch {
        ws.send(JSON.stringify({ type: 'live:status', connected: true, mode: 'fallback' }));
      }
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        allowedHosts: true,
        hmr: process.env.DISABLE_HMR === 'true' ? false : { server },
        ws: { server },
        watch: process.env.DISABLE_HMR === 'true' ? null : {},
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`CineTogether server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
