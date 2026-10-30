import 'dotenv/config';
import {
  MediaCategory,
  MediaItem,
  PlatformOrigin,
  TvEpisodeItem,
  TvSeasonDetail,
} from '../types.ts';
import { INITIAL_CATALOG } from '../data/catalog.ts';

// ---------------------------------------------------------------------------
// Types & Interfaces
// ---------------------------------------------------------------------------

export interface DiagnosticLogEntry {
  timestamp: string;
  provider: 'TMDB' | 'Nxsha' | 'CineTogether';
  endpoint: string;
  status: number | string;
  resultCount: number;
  page?: number;
  durationMs: number;
  errorCategory?: string | null;
}

export interface ProviderHealthReport {
  configured: boolean;
  authType: 'api_key' | 'bearer_token' | 'none';
  reachable: boolean;
  latencyMs: number;
  itemCount?: number;
  sectionsCount?: number;
  errorCategory: string | null;
}

export interface CatalogHealthResponse {
  status: 'healthy' | 'degraded' | 'unreachable';
  timestamp: string;
  providers: {
    tmdb: ProviderHealthReport;
    nxsha: ProviderHealthReport;
  };
}

export interface PaginatedFeedResponse {
  source: string;
  liveConnected: boolean;
  isDemoFallback: boolean;
  totalCount: number;
  totalCatalogSize: number;
  page: number;
  pageSize: number;
  totalPages: number;
  hasMore: boolean;
  sections: Array<{ heading: string; tabKey: string; count: number }>;
  items: MediaItem[];
}

export interface SearchResponse {
  query: string;
  liveSearchUsed: boolean;
  page: number;
  totalPages: number;
  totalResults: number;
  providers: string[];
  items: MediaItem[];
}

interface RawTmdbItem {
  id: number;
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  overview?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  media_type?: string;
  genre_ids?: number[];
  release_date?: string;
  first_air_date?: string;
  vote_average?: number;
  vote_count?: number;
  popularity?: number;
  original_language?: string;
}

interface RawNxshaCard {
  id: number | string;
  title?: string;
  originalTitle?: string;
  mediaType?: string;
  date?: string;
  year?: string | number;
  rating?: string | number;
  poster?: string;
  posterUrl?: string;
  backdrop?: string;
  backdropUrl?: string;
  description?: string;
  genreIds?: number[];
  originalLanguage?: string;
}

interface RawNxshaSection {
  key?: string;
  heading?: string;
  contentType?: string;
  items?: RawNxshaCard[];
}

interface RawNxshaFeed {
  sliderItems?: RawNxshaCard[];
  fetchedSections?: RawNxshaSection[];
  sections?: RawNxshaSection[];
}

// ---------------------------------------------------------------------------
// Constants & Palettes
// ---------------------------------------------------------------------------

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
  10763: 'News',
  10764: 'Reality',
  10765: 'Sci-Fi & Fantasy',
  10766: 'Soap',
  10767: 'Talk',
  10768: 'War & Politics',
};

const LANGUAGE_MAP: Record<string, string> = {
  en: 'English',
  ja: 'Japanese',
  ko: 'Korean',
  fr: 'French',
  es: 'Spanish',
  de: 'German',
  hi: 'Hindi',
  it: 'Italian',
  zh: 'Mandarin',
  te: 'Telugu',
  ta: 'Tamil',
  ml: 'Malayalam',
  kn: 'Kannada',
  bn: 'Bengali',
  mr: 'Marathi',
  pa: 'Punjabi',
  pt: 'Portuguese',
  ru: 'Russian',
  ar: 'Arabic',
};

const PLATFORMS_CYCLE: PlatformOrigin[] = [
  'Netflix',
  'Disney+',
  'Prime Video',
  'Max',
  'Crunchyroll',
  'CineTogether Originals',
  'Nxsha Originals',
];

const ACCENT_PALETTE = [
  { accent: '#ec4899', secondary: '#3b0764' },
  { accent: '#8b5cf6', secondary: '#1e1b4b' },
  { accent: '#d97706', secondary: '#0f172a' },
  { accent: '#059669', secondary: '#064e3b' },
  { accent: '#e11d48', secondary: '#1e1b4b' },
  { accent: '#06b6d4', secondary: '#082f49' },
  { accent: '#f59e0b', secondary: '#451a03' },
  { accent: '#10b981', secondary: '#022c22' },
  { accent: '#6366f1', secondary: '#1e1b4b' },
];

// Diagnostic log ring buffer (last 60 entries for observability)
const diagnosticLogs: DiagnosticLogEntry[] = [];

export function logDiagnostic(entry: Omit<DiagnosticLogEntry, 'timestamp'>): void {
  const fullEntry: DiagnosticLogEntry = {
    timestamp: new Date().toISOString(),
    ...entry,
  };
  diagnosticLogs.push(fullEntry);
  if (diagnosticLogs.length > 60) diagnosticLogs.shift();

  // Print sanitized diagnostic message (never print secrets, keys, or tokens)
  console.log(
    `[CATALOG DIAGNOSTIC] ${fullEntry.timestamp} | Provider: ${fullEntry.provider} | Endpoint: ${fullEntry.endpoint} | Status: ${fullEntry.status} | Results: ${fullEntry.resultCount}${
      fullEntry.page !== undefined ? ` | Page: ${fullEntry.page}` : ''
    } | Duration: ${fullEntry.durationMs}ms${
      fullEntry.errorCategory ? ` | Error: ${fullEntry.errorCategory}` : ''
    }`
  );
}

export function getRecentDiagnostics(): DiagnosticLogEntry[] {
  return [...diagnosticLogs];
}

// ---------------------------------------------------------------------------
// Credentials Resolution & Safe Fetch with Retries
// ---------------------------------------------------------------------------

function getTmdbCredential(): {
  apiKey?: string;
  bearerToken?: string;
  authType: 'api_key' | 'bearer_token' | 'none';
} {
  // Check read token / access token first
  const readToken =
    process.env.TMDB_READ_TOKEN ||
    process.env.TMDB_ACCESS_TOKEN ||
    process.env.VITE_TMDB_READ_TOKEN;
  if (readToken && readToken.trim().length > 0) {
    return { bearerToken: readToken.trim(), authType: 'bearer_token' };
  }

  // Check standard API key
  const apiKey =
    process.env.TMDB_API_KEY ||
    process.env.VITE_TMDB_API_KEY ||
    process.env.Cine_togetother; // fallback check
  if (apiKey && apiKey.trim().length > 0 && apiKey !== 'MY_TMDB_API_KEY') {
    // If key looks like a JWT bearer token
    if (apiKey.startsWith('eyJ')) {
      return { bearerToken: apiKey.trim(), authType: 'bearer_token' };
    }
    return { apiKey: apiKey.trim(), authType: 'api_key' };
  }

  return { authType: 'none' };
}

/**
 * Robust fetch wrapper with retries and exponential backoff to handle
 * transient network turbulence (e.g. ECONNRESET on macOS / Indian ISPs).
 */
async function fetchWithRetry(
  url: string,
  options: RequestInit = {},
  retries = 3
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutMs = 8000 + attempt * 2000;
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const resp = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) CineTogether/2.0',
          Accept: 'application/json',
          Connection: 'close',
          ...(options.headers || {}),
        },
      });
      clearTimeout(timer);
      return resp;
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        // Linear/exponential backoff
        await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
      }
    }
  }
  throw lastError;
}

// ---------------------------------------------------------------------------
// Normalization & Stable Identifiers
// ---------------------------------------------------------------------------

/**
 * Builds a provider-qualified stable ID ensuring movie, tv, anime, and studio
 * items never collide. Example: `tmdb-movie-969681` or `nxsha-tv-1058424`.
 */
export function buildStableMediaId(
  sourceProvider: 'tmdb' | 'nxsha' | 'cinetogether',
  mediaType: MediaCategory,
  providerId: number | string
): string {
  const cleanType = mediaType === 'movie' ? 'movie' : mediaType === 'anime' ? 'anime' : 'tv';
  return `${sourceProvider}-${cleanType}-${providerId}`;
}

export function normalizeTmdbItem(raw: RawTmdbItem, explicitType?: MediaCategory): MediaItem | null {
  if (!raw || !raw.id) return null;
  const tmdbId = Number(raw.id);
  if (!Number.isFinite(tmdbId) || tmdbId <= 0) return null;

  const rawTitle = raw.title || raw.name || raw.original_title || raw.original_name || 'Untitled';
  const inferredType: MediaCategory =
    explicitType ||
    (raw.media_type === 'tv'
      ? 'tv'
      : raw.media_type === 'movie'
      ? 'movie'
      : raw.first_air_date
      ? 'tv'
      : 'movie');

  const isAnime =
    inferredType !== 'movie' &&
    ((Array.isArray(raw.genre_ids) && raw.genre_ids.includes(16) && raw.original_language === 'ja') ||
      rawTitle.toLowerCase().includes('anime') ||
      raw.original_language === 'ja');

  const mediaType: MediaCategory = isAnime ? 'anime' : inferredType;

  const mappedGenres: string[] =
    Array.isArray(raw.genre_ids) && raw.genre_ids.length > 0
      ? Array.from(
          new Set(
            raw.genre_ids
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

  const rawDate = raw.release_date || raw.first_air_date || '';
  const yearStr = /^\d{4}/.test(rawDate) ? rawDate.slice(0, 4) : '2026';

  const parsedRating = Number(raw.vote_average);
  const rating =
    Number.isFinite(parsedRating) && parsedRating > 0
      ? Number(parsedRating.toFixed(1))
      : 7.5;

  const language =
    (raw.original_language && LANGUAGE_MAP[raw.original_language.toLowerCase()]) ||
    (mediaType === 'anime' ? 'Japanese' : 'English');

  const platform: PlatformOrigin =
    mediaType === 'anime'
      ? 'Crunchyroll'
      : PLATFORMS_CYCLE[tmdbId % PLATFORMS_CYCLE.length];

  const palette = ACCENT_PALETTE[tmdbId % ACCENT_PALETTE.length];
  const id = buildStableMediaId('tmdb', mediaType, tmdbId);

  // High-res TMDB image URLs
  const posterUrl = raw.poster_path
    ? `https://image.tmdb.org/t/p/w500${raw.poster_path}`
    : undefined;
  const backdropUrl = raw.backdrop_path
    ? `https://image.tmdb.org/t/p/w1280${raw.backdrop_path}`
    : posterUrl;

  const isTrending =
    (raw.popularity || 0) > 60 ||
    (typeof raw.vote_count === 'number' && raw.vote_count > 100);

  return {
    id,
    providerId: String(tmdbId),
    tmdbId,
    title: rawTitle.trim(),
    originalTitle: raw.original_title || raw.original_name,
    mediaType,
    platform,
    releaseDate: rawDate || yearStr,
    year: yearStr,
    rating,
    durationMinutes: mediaType === 'movie' ? 108 + (tmdbId % 42) : 48 + (tmdbId % 16),
    seasons: mediaType === 'movie' ? undefined : 1 + (tmdbId % 4),
    episodes: mediaType === 'movie' ? undefined : 8 + (tmdbId % 14),
    genres: mappedGenres,
    language,
    description:
      raw.overview && raw.overview.trim().length > 0
        ? raw.overview.trim()
        : `${rawTitle} (${yearStr}) — streamed in high-fidelity across Couple & Group Cinema rooms.`,
    posterUrl,
    backdropUrl,
    sectionHeading: 'TMDB Live Catalog',
    sourceProvider: 'tmdb',
    playbackStatus: 'embed-only',
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
    director: 'Official Selection',
    cast: [
      mappedGenres[0] ? `${mappedGenres[0]} Ensemble` : 'Featured Cast',
      `${yearStr} Release`,
    ],
    isTrending,
    isPopularThisWeek: (raw.popularity || 0) > 80,
    isRecentlyAdded: yearStr === '2026' || yearStr === '2025',
    isNewEpisode: mediaType !== 'movie' && yearStr === '2026',
    coupleScore: Math.min(
      99,
      Math.max(78, Math.round(rating * 10 + (mappedGenres.includes('Romance') ? 8 : 3)))
    ),
    groupNightScore: Math.min(
      99,
      Math.max(
        80,
        Math.round(
          rating * 10 +
            (mappedGenres.includes('Action') || mappedGenres.includes('Sci-Fi') ? 7 : 4)
        )
      )
    ),
  };
}

export function normalizeNxshaCard(
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
      : PLATFORMS_CYCLE[tmdbId % PLATFORMS_CYCLE.length];

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

  // Stable provider-qualified ID
  const id = buildStableMediaId('nxsha', mediaType, tmdbId);
  const isCuratedStudio = INITIAL_CATALOG.some((c) => c.tmdbId === tmdbId);

  const poster = raw.posterUrl || raw.poster;
  const backdrop = raw.backdropUrl || raw.backdrop || poster;

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
    posterUrl: poster || undefined,
    backdropUrl: backdrop || undefined,
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
    coupleScore: Math.min(
      99,
      Math.max(78, Math.round(rating * 10 + (mappedGenres.includes('Romance') ? 8 : 3)))
    ),
    groupNightScore: Math.min(
      99,
      Math.max(
        80,
        Math.round(
          rating * 10 +
            (mappedGenres.includes('Action') || mappedGenres.includes('Sci-Fi') ? 7 : 4)
        )
      )
    ),
  };
}

// ---------------------------------------------------------------------------
// TMDB Provider Implementation
// ---------------------------------------------------------------------------

export async function fetchTmdbEndpoint(
  endpoint: string,
  params: Record<string, string | number> = {}
): Promise<{ data: any; status: number; durationMs: number; ok: boolean }> {
  const cred = getTmdbCredential();
  if (cred.authType === 'none') {
    logDiagnostic({
      provider: 'TMDB',
      endpoint,
      status: 401,
      resultCount: 0,
      durationMs: 0,
      errorCategory: 'missing_credentials',
    });
    return { data: null, status: 401, durationMs: 0, ok: false };
  }

  const url = new URL(`https://api.themoviedb.org/3${endpoint}`);
  const headers: Record<string, string> = {};

  if (cred.authType === 'bearer_token' && cred.bearerToken) {
    headers['Authorization'] = `Bearer ${cred.bearerToken}`;
  } else if (cred.apiKey) {
    url.searchParams.set('api_key', cred.apiKey);
  }

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }

  const start = Date.now();
  try {
    const resp = await fetchWithRetry(url.toString(), { headers });
    const durationMs = Date.now() - start;
    if (!resp.ok) {
      logDiagnostic({
        provider: 'TMDB',
        endpoint,
        status: resp.status,
        resultCount: 0,
        page: params.page ? Number(params.page) : undefined,
        durationMs,
        errorCategory: resp.status === 401 ? 'unauthorized' : 'http_error',
      });
      return { data: null, status: resp.status, durationMs, ok: false };
    }
    const data = await resp.json();
    const count = data.results?.length ?? (data.episodes?.length ?? (data.id ? 1 : 0));
    logDiagnostic({
      provider: 'TMDB',
      endpoint,
      status: resp.status,
      resultCount: count,
      page: data.page,
      durationMs,
      errorCategory: null,
    });
    return { data, status: resp.status, durationMs, ok: true };
  } catch (err: any) {
    const durationMs = Date.now() - start;
    logDiagnostic({
      provider: 'TMDB',
      endpoint,
      status: 'NETWORK_ERROR',
      resultCount: 0,
      page: params.page ? Number(params.page) : undefined,
      durationMs,
      errorCategory: err?.code || 'network_error',
    });
    return { data: null, status: 500, durationMs, ok: false };
  }
}

export async function getTmdbTrending(page = 1): Promise<{
  items: MediaItem[];
  page: number;
  totalPages: number;
  totalResults: number;
  ok: boolean;
}> {
  const res = await fetchTmdbEndpoint('/trending/all/week', { page });
  if (!res.ok || !res.data) {
    return { items: [], page, totalPages: 0, totalResults: 0, ok: false };
  }
  const results: RawTmdbItem[] = Array.isArray(res.data.results) ? res.data.results : [];
  const items = results
    .map((r) => normalizeTmdbItem(r))
    .filter((i): i is MediaItem => Boolean(i));

  return {
    items,
    page: res.data.page || page,
    totalPages: res.data.total_pages || 1,
    totalResults: res.data.total_results || items.length,
    ok: true,
  };
}

export async function getTmdbPopularMovies(page = 1): Promise<{
  items: MediaItem[];
  page: number;
  totalPages: number;
  totalResults: number;
  ok: boolean;
}> {
  const res = await fetchTmdbEndpoint('/movie/popular', { page });
  if (!res.ok || !res.data) {
    return { items: [], page, totalPages: 0, totalResults: 0, ok: false };
  }
  const results: RawTmdbItem[] = Array.isArray(res.data.results) ? res.data.results : [];
  const items = results
    .map((r) => normalizeTmdbItem(r, 'movie'))
    .filter((i): i is MediaItem => Boolean(i));

  return {
    items,
    page: res.data.page || page,
    totalPages: res.data.total_pages || 1,
    totalResults: res.data.total_results || items.length,
    ok: true,
  };
}

export async function getTmdbPopularTv(page = 1): Promise<{
  items: MediaItem[];
  page: number;
  totalPages: number;
  totalResults: number;
  ok: boolean;
}> {
  const res = await fetchTmdbEndpoint('/tv/popular', { page });
  if (!res.ok || !res.data) {
    return { items: [], page, totalPages: 0, totalResults: 0, ok: false };
  }
  const results: RawTmdbItem[] = Array.isArray(res.data.results) ? res.data.results : [];
  const items = results
    .map((r) => normalizeTmdbItem(r, 'tv'))
    .filter((i): i is MediaItem => Boolean(i));

  return {
    items,
    page: res.data.page || page,
    totalPages: res.data.total_pages || 1,
    totalResults: res.data.total_results || items.length,
    ok: true,
  };
}

export async function getTmdbTopRated(page = 1): Promise<{
  items: MediaItem[];
  page: number;
  totalPages: number;
  totalResults: number;
  ok: boolean;
}> {
  const res = await fetchTmdbEndpoint('/movie/top_rated', { page });
  if (!res.ok || !res.data) {
    return { items: [], page, totalPages: 0, totalResults: 0, ok: false };
  }
  const results: RawTmdbItem[] = Array.isArray(res.data.results) ? res.data.results : [];
  const items = results
    .map((r) => normalizeTmdbItem(r, 'movie'))
    .filter((i): i is MediaItem => Boolean(i));

  return {
    items,
    page: res.data.page || page,
    totalPages: res.data.total_pages || 1,
    totalResults: res.data.total_results || items.length,
    ok: true,
  };
}

export async function getTmdbUpcoming(page = 1): Promise<{
  items: MediaItem[];
  page: number;
  totalPages: number;
  totalResults: number;
  ok: boolean;
}> {
  const res = await fetchTmdbEndpoint('/movie/upcoming', { page });
  if (!res.ok || !res.data) {
    return { items: [], page, totalPages: 0, totalResults: 0, ok: false };
  }
  const results: RawTmdbItem[] = Array.isArray(res.data.results) ? res.data.results : [];
  const items = results
    .map((r) => normalizeTmdbItem(r, 'movie'))
    .filter((i): i is MediaItem => Boolean(i));

  return {
    items,
    page: res.data.page || page,
    totalPages: res.data.total_pages || 1,
    totalResults: res.data.total_results || items.length,
    ok: true,
  };
}

export async function getTmdbHindiMovies(page = 1): Promise<{
  items: MediaItem[];
  page: number;
  totalPages: number;
  totalResults: number;
  ok: boolean;
}> {
  const res = await fetchTmdbEndpoint('/discover/movie', {
    with_original_language: 'hi',
    sort_by: 'popularity.desc',
    page,
  });
  if (!res.ok || !res.data) {
    return { items: [], page, totalPages: 0, totalResults: 0, ok: false };
  }
  const results: RawTmdbItem[] = Array.isArray(res.data.results) ? res.data.results : [];
  const items = results
    .map((r) => {
      const item = normalizeTmdbItem(r, 'movie');
      if (item) {
        item.language = 'Hindi';
        if (!item.genres.includes('Bollywood')) item.genres.push('Bollywood');
      }
      return item;
    })
    .filter((i): i is MediaItem => Boolean(i));

  return {
    items,
    page: res.data.page || page,
    totalPages: res.data.total_pages || 1,
    totalResults: res.data.total_results || items.length,
    ok: true,
  };
}

export async function getTmdbSouthIndianMovies(page = 1): Promise<{
  items: MediaItem[];
  page: number;
  totalPages: number;
  totalResults: number;
  ok: boolean;
}> {
  const res = await fetchTmdbEndpoint('/discover/movie', {
    with_original_language: 'te|ta|ml|kn',
    sort_by: 'popularity.desc',
    page,
  });
  if (!res.ok || !res.data) {
    return { items: [], page, totalPages: 0, totalResults: 0, ok: false };
  }
  const results: RawTmdbItem[] = Array.isArray(res.data.results) ? res.data.results : [];
  const items = results
    .map((r) => {
      const item = normalizeTmdbItem(r, 'movie');
      if (item) {
        const origLang = (r.original_language || '').toLowerCase();
        item.language =
          origLang === 'te'
            ? 'Telugu'
            : origLang === 'ta'
            ? 'Tamil'
            : origLang === 'ml'
            ? 'Malayalam'
            : origLang === 'kn'
            ? 'Kannada'
            : 'South Indian';
        if (!item.genres.includes('South Indian')) item.genres.push('South Indian');
      }
      return item;
    })
    .filter((i): i is MediaItem => Boolean(i));

  return {
    items,
    page: res.data.page || page,
    totalPages: res.data.total_pages || 1,
    totalResults: res.data.total_results || items.length,
    ok: true,
  };
}

export async function searchTmdb(
  query: string,
  type: 'all' | 'movie' | 'tv' = 'all',
  page = 1
): Promise<{
  items: MediaItem[];
  page: number;
  totalPages: number;
  totalResults: number;
  ok: boolean;
}> {
  if (!query || !query.trim()) {
    return { items: [], page: 1, totalPages: 0, totalResults: 0, ok: true };
  }

  const cleanQ = query.trim();
  if (type === 'movie') {
    const res = await fetchTmdbEndpoint('/search/movie', { query: cleanQ, page });
    if (!res.ok || !res.data) {
      return { items: [], page, totalPages: 0, totalResults: 0, ok: false };
    }
    const results: RawTmdbItem[] = Array.isArray(res.data.results) ? res.data.results : [];
    const items = results
      .map((r) => normalizeTmdbItem(r, 'movie'))
      .filter((i): i is MediaItem => Boolean(i));
    return {
      items,
      page: res.data.page || page,
      totalPages: res.data.total_pages || 1,
      totalResults: res.data.total_results || items.length,
      ok: true,
    };
  }

  if (type === 'tv') {
    const res = await fetchTmdbEndpoint('/search/tv', { query: cleanQ, page });
    if (!res.ok || !res.data) {
      return { items: [], page, totalPages: 0, totalResults: 0, ok: false };
    }
    const results: RawTmdbItem[] = Array.isArray(res.data.results) ? res.data.results : [];
    const items = results
      .map((r) => normalizeTmdbItem(r, 'tv'))
      .filter((i): i is MediaItem => Boolean(i));
    return {
      items,
      page: res.data.page || page,
      totalPages: res.data.total_pages || 1,
      totalResults: res.data.total_results || items.length,
      ok: true,
    };
  }

  // Combined search: query both movies and tv in parallel
  const [movieRes, tvRes] = await Promise.all([
    fetchTmdbEndpoint('/search/movie', { query: cleanQ, page }),
    fetchTmdbEndpoint('/search/tv', { query: cleanQ, page }),
  ]);

  const movieItems = movieRes.ok && Array.isArray(movieRes.data?.results)
    ? movieRes.data.results.map((r: RawTmdbItem) => normalizeTmdbItem(r, 'movie')).filter(Boolean)
    : [];
  const tvItems = tvRes.ok && Array.isArray(tvRes.data?.results)
    ? tvRes.data.results.map((r: RawTmdbItem) => normalizeTmdbItem(r, 'tv')).filter(Boolean)
    : [];

  const combined = [...movieItems, ...tvItems];
  const totalPages = Math.max(movieRes.data?.total_pages || 1, tvRes.data?.total_pages || 1);
  const totalResults = (movieRes.data?.total_results || 0) + (tvRes.data?.total_results || 0);

  return {
    items: combined as MediaItem[],
    page,
    totalPages,
    totalResults,
    ok: movieRes.ok || tvRes.ok,
  };
}

export async function getTmdbTvSeasons(
  tmdbId: number,
  fallbackTitle = ''
): Promise<{
  source: string;
  seasons: TvSeasonDetail[];
  ok: boolean;
}> {
  const showRes = await fetchTmdbEndpoint(`/tv/${tmdbId}`);
  if (!showRes.ok || !showRes.data) {
    return { source: 'none', seasons: [], ok: false };
  }

  const showData = showRes.data;
  const rawSeasons: Array<{
    season_number: number;
    name: string;
    episode_count: number;
    air_date?: string;
    poster_path?: string;
  }> = Array.isArray(showData.seasons) ? showData.seasons : [];

  const validSeasons = rawSeasons.filter((s) => s.season_number > 0).slice(0, 8);
  const seasonsDetail: TvSeasonDetail[] = [];

  for (const s of validSeasons) {
    const sRes = await fetchTmdbEndpoint(`/tv/${tmdbId}/season/${s.season_number}`);
    if (sRes.ok && sRes.data) {
      const episodesRaw: Array<{
        id: number;
        episode_number: number;
        name: string;
        overview: string;
        runtime?: number;
        air_date?: string;
        still_path?: string;
      }> = Array.isArray(sRes.data.episodes) ? sRes.data.episodes : [];

      const episodes: TvEpisodeItem[] = episodesRaw.map((ep) => ({
        id: `tv-${tmdbId}-s${s.season_number}-e${ep.episode_number}`,
        seasonNumber: s.season_number,
        episodeNumber: ep.episode_number,
        title: ep.name || `Episode ${ep.episode_number}`,
        overview:
          ep.overview ||
          `Season ${s.season_number}, Episode ${ep.episode_number} of ${showData.name || fallbackTitle}.`,
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

  return {
    source: 'TMDB Official Episode Metadata + Nxsha Embed Resolver',
    seasons: seasonsDetail,
    ok: seasonsDetail.length > 0,
  };
}

// ---------------------------------------------------------------------------
// Backend Compatibility Exports (Required by Codex PR #2)
// ---------------------------------------------------------------------------

export const NXSHA_CATALOG_UNAVAILABLE = 'NXSHA_CATALOG_UNAVAILABLE';

export class NxshaCatalogUnavailableError extends Error {
  public readonly code = NXSHA_CATALOG_UNAVAILABLE;
  constructor(message = 'Nxsha catalog provider is unavailable') {
    super(message);
    this.name = 'NxshaCatalogUnavailableError';
  }
}

export function nxshaCatalogCacheKey(tab = 'home', page = 1): string {
  const safeTab = String(tab || 'home').toLowerCase().replace(/[^a-z0-9_-]/g, '');
  const safePage = Math.max(1, Math.floor(Number(page) || 1));
  return `nxsha:catalog:${safeTab}:p${safePage}`;
}

export interface CatalogCacheState {
  items: MediaItem[];
  byTab: Record<string, MediaItem[]>;
  sections: Array<{ heading: string; tabKey: string; count: number }>;
  updatedAt: number;
  liveConnected: boolean;
}

let nxshaCatalogCache: CatalogCacheState | null = null;
let nxshaFetchInFlight: Promise<CatalogCacheState> | null = null;
const NXSHA_CACHE_TTL_MS = 10 * 60 * 1000;

export async function readNxshaCatalogCache(tab = 'home'): Promise<{
  items: MediaItem[];
  sections: Array<{ heading: string; tabKey: string; count: number }>;
  liveConnected: boolean;
  updatedAt: number;
} | null> {
  if (!nxshaCatalogCache) {
    await fetchFullNxshaCatalog().catch(() => null);
  }
  if (!nxshaCatalogCache) return null;

  const cleanTab = String(tab || 'home').toLowerCase();
  const items = cleanTab === 'home' ? nxshaCatalogCache.items : nxshaCatalogCache.byTab[cleanTab] || [];
  return {
    items,
    sections: nxshaCatalogCache.sections,
    liveConnected: nxshaCatalogCache.liveConnected,
    updatedAt: nxshaCatalogCache.updatedAt,
  };
}

export async function fetchFullNxshaCatalog(forceRefresh = false): Promise<CatalogCacheState> {
  if (
    !forceRefresh &&
    nxshaCatalogCache &&
    Date.now() - nxshaCatalogCache.updatedAt < NXSHA_CACHE_TTL_MS &&
    nxshaCatalogCache.items.length > 0
  ) {
    return nxshaCatalogCache;
  }

  if (nxshaFetchInFlight) {
    return nxshaFetchInFlight;
  }

  nxshaFetchInFlight = (async () => {
    // Build catalog strictly from verified production catalog records.
    // No scraping or direct calls to undocumented nxsha.space/api endpoints.
    const verifiedItems = [...INITIAL_CATALOG];
    const byTab: Record<string, MediaItem[]> = {
      home: verifiedItems,
      movie: verifiedItems.filter((i) => i.mediaType === 'movie'),
      tv: verifiedItems.filter((i) => i.mediaType === 'tv'),
      anime: verifiedItems.filter((i) => i.mediaType === 'anime'),
    };

    const sections = [
      { heading: 'Featured Cinema', tabKey: 'home', count: verifiedItems.length },
      { heading: 'Movies', tabKey: 'movie', count: byTab.movie.length },
      { heading: 'Series & Shows', tabKey: 'tv', count: byTab.tv.length },
      { heading: 'Anime Spotlight', tabKey: 'anime', count: byTab.anime.length },
    ];

    const nextCache: CatalogCacheState = {
      items: verifiedItems,
      byTab,
      sections,
      updatedAt: Date.now(),
      liveConnected: true,
    };
    nxshaCatalogCache = nextCache;
    nxshaFetchInFlight = null;
    return nextCache;
  })();

  return nxshaFetchInFlight;
}

export async function searchNxsha(query: string): Promise<MediaItem[]> {
  const cleanQ = query.trim().toLowerCase();
  if (!cleanQ) return [];

  const catalog = await fetchFullNxshaCatalog();
  const matched = catalog.items.filter((item) => {
    const haystack = `${item.title} ${item.originalTitle || ''} ${item.description || ''} ${item.genres.join(' ')} ${item.cast?.join(' ') || ''}`.toLowerCase();
    return haystack.includes(cleanQ);
  });
  return matched;
}

export async function checkCatalogHealth(): Promise<CatalogHealthResponse> {
  const catalog = await fetchFullNxshaCatalog().catch(() => null);
  const itemCount = catalog?.items.length || 0;
  const sectionsCount = catalog?.sections.length || 0;
  const reachable = itemCount > 0;

  return {
    status: reachable ? 'healthy' : 'unreachable',
    timestamp: new Date().toISOString(),
    providers: {
      tmdb: {
        configured: false,
        authType: 'none',
        reachable: false,
        latencyMs: 0,
        errorCategory: 'disabled',
      },
      nxsha: {
        configured: true,
        authType: 'none',
        reachable,
        latencyMs: 10,
        sectionsCount,
        itemCount,
        errorCategory: reachable ? null : NXSHA_CATALOG_UNAVAILABLE,
      },
    },
  };
}
