import crypto from 'node:crypto';
import { deleteExpiredTmdbCatalogCache, getTmdbCatalogCache, putTmdbCatalogCache } from '../db/repository.ts';
import type { MediaItem, TvEpisodeItem, TvSeasonDetail } from '../types.ts';

const TMDB_API_BASE = 'https://api.themoviedb.org/3';
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p';
const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_TTL_MS = 10 * 60 * 1_000;
const SEARCH_TTL_MS = 2 * 60 * 1_000;
const DETAILS_TTL_MS = 24 * 60 * 60 * 1_000;
const GENRES_TTL_MS = 7 * 24 * 60 * 60 * 1_000;

export type TmdbMediaType = 'movie' | 'tv';
type TmdbRecord = Record<string, unknown>;
export type TmdbPage = {
  page: number;
  results: TmdbRecord[];
  total_pages: number;
  total_results: number;
};
type TmdbGenre = { id: number; name: string };
type CacheAdapter = {
  get<T>(key: string): Promise<T | null>;
  put(key: string, value: unknown, ttlMs: number): Promise<void>;
  deleteExpired?(): Promise<number>;
};

export class TmdbCatalogError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'TmdbCatalogError';
  }
}

function canonicalParameters(parameters: Record<string, string | number | undefined>): string {
  return Object.entries(parameters)
    .filter((entry): entry is [string, string | number] => entry[1] !== undefined && String(entry[1]).trim() !== '')
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => key + '=' + String(value).trim())
    .join('&');
}

/** Search text is hashed so it is not visible in database cache keys. */
export function tmdbCatalogCacheKey(path: string, parameters: Record<string, string | number | undefined>): string {
  return crypto.createHash('sha256')
    .update('tmdb:v3:' + path + ':' + canonicalParameters(parameters))
    .digest('hex');
}

function positiveId(value: unknown): number {
  const id = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new TmdbCatalogError('A valid TMDB ID is required.', 400, 'TMDB_INVALID_ID');
  }
  return id;
}

function pageNumber(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 500) {
    throw new TmdbCatalogError('Page must be an integer from 1 to 500.', 400, 'TMDB_INVALID_PAGE');
  }
  return value;
}

function imageUrl(path: unknown, size: 'w500' | 'w1280'): string | undefined {
  if (typeof path !== 'string' || !/^\/[A-Za-z0-9_.\/-]+$/.test(path)) return undefined;
  const encodedPath = path.split('/').map((part) => encodeURIComponent(part)).join('/');
  return TMDB_IMAGE_BASE + '/' + size + encodedPath;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function invalidTmdbResponse(): TmdbCatalogError {
  return new TmdbCatalogError('TMDB returned an unreadable response. Retry shortly.', 502, 'TMDB_INVALID_RESPONSE');
}

function idsValue(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.filter((id): id is number => Number.isSafeInteger(id) && id > 0);
}

function tmdbTitle(raw: TmdbRecord, mediaType: TmdbMediaType): string {
  return stringValue(mediaType === 'movie' ? raw.title : raw.name);
}

function tmdbReleaseDate(raw: TmdbRecord, mediaType: TmdbMediaType): string {
  return stringValue(mediaType === 'movie' ? raw.release_date : raw.first_air_date);
}

function normalizeMedia(raw: TmdbRecord, mediaType: TmdbMediaType, details = false): MediaItem {
  const id = positiveId(raw.id);
  const releaseDate = tmdbReleaseDate(raw, mediaType);
  const title = tmdbTitle(raw, mediaType);
  if (!title.trim()) throw invalidTmdbResponse();
  const credits = (raw.credits || raw.aggregate_credits) as TmdbRecord | undefined;
  const crew = Array.isArray(credits?.crew) ? credits.crew as TmdbRecord[] : [];
  const cast = Array.isArray(credits?.cast) ? credits.cast as TmdbRecord[] : [];
  const director = crew.find((person) => person.job === 'Director');
  const genreObjects = Array.isArray(raw.genres) ? raw.genres as TmdbGenre[] : [];
  const runtime = mediaType === 'movie'
    ? numberValue(raw.runtime)
    : (Array.isArray(raw.episode_run_time) ? numberValue(raw.episode_run_time[0]) : undefined);
  const seasons = Array.isArray(raw.seasons) ? raw.seasons as TmdbRecord[] : [];
  const rating = numberValue(raw.vote_average);

  return {
    id: 'tmdb:' + mediaType + ':' + id,
    providerId: String(id),
    tmdbId: id,
    title,
    originalTitle: stringValue(mediaType === 'movie' ? raw.original_title : raw.original_name) || undefined,
    mediaType,
    platform: 'Unverified',
    releaseDate,
    year: /^\d{4}/.test(releaseDate) ? releaseDate.slice(0, 4) : '',
    ...(rating === undefined ? {} : { rating }),
    ...(runtime === undefined ? {} : { durationMinutes: runtime }),
    ...(mediaType === 'tv' && details ? {
      seasons: seasons.length,
      episodes: seasons.reduce((sum, season) => sum + (numberValue(season.episode_count) || 0), 0),
    } : {}),
    genres: genreObjects.map((genre) => stringValue(genre.name)).filter(Boolean),
    genreIds: idsValue(raw.genre_ids),
    language: stringValue(raw.original_language),
    description: stringValue(raw.overview),
    posterUrl: imageUrl(raw.poster_path, 'w500'),
    backdropUrl: imageUrl(raw.backdrop_path, 'w1280'),
    streamUrl: undefined,
    accentColor: '#8b5cf6',
    secondaryColor: '#1e1b4b',
    director: details ? stringValue(director?.name) : '',
    cast: details ? cast.map((person) => stringValue(person.name)).filter(Boolean).slice(0, 8) : [],
    sourceProvider: 'TMDB',
    metadataProvider: 'TMDB',
    playbackStatus: 'metadata-only',
    playbackType: 'metadata-only',
    sourceAvailability: 'unavailable',
    playbackCapability: { canSync: false, canEmbed: false, requiresExternalWatch: false },
  };
}

export type TmdbCatalogPage = {
  provider: 'TMDB';
  state: 'available';
  items: MediaItem[];
  page: number;
  totalPages: number;
  totalResults: number;
  hasMore: boolean;
};

function normalizePage(response: TmdbPage, mediaType: TmdbMediaType, trending = false): TmdbCatalogPage {
  const page = Number.isSafeInteger(response.page) && response.page > 0 ? response.page : 1;
  const totalPages = Number.isSafeInteger(response.total_pages) && response.total_pages >= 0 ? response.total_pages : 0;
  const totalResults = Number.isSafeInteger(response.total_results) && response.total_results >= 0 ? response.total_results : 0;
  const items = (Array.isArray(response.results) ? response.results : [])
    .filter((record) => Number.isSafeInteger(record.id) && Number(record.id) > 0 && tmdbTitle(record, mediaType))
    .map((record) => ({
      ...normalizeMedia(record, mediaType),
      ...(trending ? { isTrending: true } : {}),
    }));
  return {
    provider: 'TMDB',
    state: 'available' as const,
    items,
    page,
    totalPages,
    totalResults,
    hasMore: page < totalPages,
  };
}

function normalizeSeason(raw: TmdbRecord, seasonNumber: number): TvSeasonDetail {
  const rawEpisodes = Array.isArray(raw.episodes) ? raw.episodes as TmdbRecord[] : [];
  const episodes: TvEpisodeItem[] = rawEpisodes
    .filter((episode) => Number.isSafeInteger(episode.id) && Number(episode.id) > 0)
    .map((episode) => ({
      id: String(episode.id),
      seasonNumber,
      episodeNumber: numberValue(episode.episode_number) || 0,
      title: stringValue(episode.name),
      overview: stringValue(episode.overview),
      durationMinutes: numberValue(episode.runtime),
      airDate: stringValue(episode.air_date),
      stillUrl: imageUrl(episode.still_path, 'w500'),
    }));
  return {
    seasonNumber,
    name: stringValue(raw.name),
    episodeCount: numberValue(raw.episode_count) ?? episodes.length,
    airDate: stringValue(raw.air_date) || undefined,
    posterUrl: imageUrl(raw.poster_path, 'w500'),
    episodes,
  };
}

export function createTmdbCatalogService(options: {
  token?: () => string | undefined;
  fetchImpl?: typeof fetch;
  cache?: CacheAdapter;
  timeoutMs?: number;
} = {}) {
  const token = options.token || (() => process.env.TMDB_API_READ_ACCESS_TOKEN);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const cache: CacheAdapter = options.cache || {
    get: getTmdbCatalogCache,
    put: putTmdbCatalogCache,
    deleteExpired: deleteExpiredTmdbCatalogCache,
  };
  const timeoutMs = options.timeoutMs || Number(process.env.TMDB_REQUEST_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;
  let lastCacheSweepAt = 0;

  async function request<T>(path: string, parameters: Record<string, string | number | undefined> = {}, ttlMs = DEFAULT_TTL_MS): Promise<T> {
    const accessToken = token()?.trim();
    if (!accessToken) {
      throw new TmdbCatalogError(
        'The TMDB catalog is unavailable because TMDB_API_READ_ACCESS_TOKEN is not configured on the server.',
        503,
        'TMDB_TOKEN_REQUIRED',
      );
    }

    const cacheKey = tmdbCatalogCacheKey(path, parameters);
    try {
      if (cache.deleteExpired && Date.now() - lastCacheSweepAt >= 60 * 60 * 1_000) {
        lastCacheSweepAt = Date.now();
        await cache.deleteExpired();
      }
      const cached = await cache.get<T>(cacheKey);
      if (cached !== null) return cached;
    } catch {
      // The metadata API remains usable if the optional cache database is temporarily unavailable.
    }

    const url = new URL(TMDB_API_BASE + path);
    for (const [key, value] of Object.entries(parameters)) {
      if (value !== undefined && String(value).trim() !== '') url.searchParams.set(key, String(value));
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.max(500, Math.min(timeoutMs, 60_000)));
    let response: Response;
    try {
      response = await fetchImpl(url, {
        headers: { accept: 'application/json', Authorization: 'Bearer ' + accessToken },
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new TmdbCatalogError('TMDB did not respond before the request timed out. Retry shortly.', 504, 'TMDB_TIMEOUT');
      }
      throw new TmdbCatalogError('TMDB could not be reached. Check the provider connection and retry.', 502, 'TMDB_UNAVAILABLE');
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      if (response.status === 429) {
        const retryHeader = response.headers.get('retry-after');
        const retryAfter = retryHeader && /^\d+$/.test(retryHeader) ? Number(retryHeader) : undefined;
        throw new TmdbCatalogError('TMDB is rate-limiting catalog requests. Retry shortly.', 429, 'TMDB_RATE_LIMITED', retryAfter);
      }
      if (response.status === 401 || response.status === 403) {
        throw new TmdbCatalogError('TMDB rejected the server API token. Check TMDB_API_READ_ACCESS_TOKEN.', 503, 'TMDB_TOKEN_REJECTED');
      }
      if (response.status === 404) {
        throw new TmdbCatalogError('TMDB did not find that title.', 404, 'TMDB_TITLE_NOT_FOUND');
      }
      throw new TmdbCatalogError('TMDB returned an error while loading catalog metadata.', 502, 'TMDB_UPSTREAM_ERROR');
    }

    let payload: T;
    try {
      payload = await response.json() as T;
    } catch {
      throw invalidTmdbResponse();
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw invalidTmdbResponse();
    try {
      await cache.put(cacheKey, payload, ttlMs);
    } catch {
      // A failed cache write must not turn a valid TMDB response into an API failure.
    }
    return payload;
  }

  async function list(path: string, mediaType: TmdbMediaType, parameters: Record<string, string | number | undefined>, trending = false, ttlMs = DEFAULT_TTL_MS) {
    const response = await request<TmdbPage>(path, { language: 'en-US', ...parameters }, ttlMs);
    if (!Array.isArray(response.results)) throw invalidTmdbResponse();
    return normalizePage(response, mediaType, trending);
  }

  function health() {
    const configured = Boolean(token()?.trim());
    return {
      status: configured ? 'configured' as const : 'unavailable' as const,
      provider: 'TMDB',
      version: 3,
      configured,
      playbackProvider: 'Nxsha',
      playbackIndependent: true,
    };
  }

  return {
    health,
    popularMovies(page = 1) {
      return list('/movie/popular', 'movie', { page: pageNumber(page) });
    },
    trendingMovies(page = 1, window: 'day' | 'week' = 'week') {
      return list('/trending/movie/' + window, 'movie', { page: pageNumber(page) }, true);
    },
    topRatedMovies(page = 1) {
      return list('/movie/top_rated', 'movie', { page: pageNumber(page) });
    },
    nowPlayingMovies(page = 1) {
      return list('/movie/now_playing', 'movie', { page: pageNumber(page) });
    },
    upcomingMovies(page = 1) {
      return list('/movie/upcoming', 'movie', { page: pageNumber(page) });
    },
    discoverMovies(page = 1, filters: { genre?: number; year?: number } = {}) {
      return list('/discover/movie', 'movie', {
        page: pageNumber(page),
        sort_by: 'popularity.desc',
        with_genres: filters.genre,
        primary_release_year: filters.year,
      });
    },
    async searchMovies(query: string, page = 1, year?: number) {
      const cleanQuery = query.trim();
      if (!cleanQuery || cleanQuery.length > 120) {
        throw new TmdbCatalogError('Search query must contain 1 to 120 characters.', 400, 'TMDB_INVALID_QUERY');
      }
      return list('/search/movie', 'movie', {
        query: cleanQuery,
        page: pageNumber(page),
        include_adult: 'false',
        year,
      }, false, SEARCH_TTL_MS);
    },
    movieDetails(id: number | string) {
      const movieId = positiveId(id);
      return request<TmdbRecord>('/movie/' + movieId, {
        language: 'en-US',
        append_to_response: 'credits',
      }, DETAILS_TTL_MS).then((raw) => ({
        provider: 'TMDB',
        state: 'available' as const,
        item: normalizeMedia(raw, 'movie', true),
      }));
    },
    movieRecommendations(id: number | string, page = 1) {
      const movieId = positiveId(id);
      return list('/movie/' + movieId + '/recommendations', 'movie', { page: pageNumber(page) });
    },
    popularTv(page = 1) {
      return list('/tv/popular', 'tv', { page: pageNumber(page) });
    },
    trendingTv(page = 1, window: 'day' | 'week' = 'week') {
      return list('/trending/tv/' + window, 'tv', { page: pageNumber(page) }, true);
    },
    discoverTv(page = 1, filters: { genre?: number; year?: number } = {}) {
      return list('/discover/tv', 'tv', {
        page: pageNumber(page),
        sort_by: 'popularity.desc',
        with_genres: filters.genre,
        first_air_date_year: filters.year,
      });
    },
    async searchTv(query: string, page = 1, year?: number) {
      const cleanQuery = query.trim();
      if (!cleanQuery || cleanQuery.length > 120) {
        throw new TmdbCatalogError('Search query must contain 1 to 120 characters.', 400, 'TMDB_INVALID_QUERY');
      }
      return list('/search/tv', 'tv', {
        query: cleanQuery,
        page: pageNumber(page),
        include_adult: 'false',
        first_air_date_year: year,
      }, false, SEARCH_TTL_MS);
    },
    async tvDetails(id: number | string) {
      const tvId = positiveId(id);
      const raw = await request<TmdbRecord>('/tv/' + tvId, {
        language: 'en-US',
        append_to_response: 'aggregate_credits',
      }, DETAILS_TTL_MS);
      return {
        provider: 'TMDB',
        state: 'available' as const,
        item: normalizeMedia(raw, 'tv', true),
        seasons: (Array.isArray(raw.seasons) ? raw.seasons as TmdbRecord[] : []).map((season) => ({
          seasonNumber: numberValue(season.season_number) || 0,
          name: stringValue(season.name),
          episodeCount: numberValue(season.episode_count) || 0,
          airDate: stringValue(season.air_date) || undefined,
          posterUrl: imageUrl(season.poster_path, 'w500'),
        })),
      };
    },
    tvSeason(id: number | string, seasonNumber: number) {
      const tvId = positiveId(id);
      if (!Number.isSafeInteger(seasonNumber) || seasonNumber < 0 || seasonNumber > 500) {
        throw new TmdbCatalogError('Season number must be an integer from 0 to 500.', 400, 'TMDB_INVALID_SEASON');
      }
      return request<TmdbRecord>('/tv/' + tvId + '/season/' + seasonNumber, { language: 'en-US' }, DETAILS_TTL_MS)
        .then((raw) => normalizeSeason(raw, seasonNumber));
    },
    genres(mediaType: TmdbMediaType) {
      return request<{ genres: TmdbGenre[] }>('/genre/' + mediaType + '/list', { language: 'en-US' }, GENRES_TTL_MS)
        .then((response) => {
          if (!Array.isArray(response.genres)) throw invalidTmdbResponse();
          return {
            provider: 'TMDB',
            state: 'available' as const,
            genres: response.genres.filter((genre) => Number.isSafeInteger(genre.id) && typeof genre.name === 'string'),
          };
        });
    },
  };
}

export const tmdbCatalogService = createTmdbCatalogService();
