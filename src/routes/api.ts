import crypto from 'node:crypto';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { GoogleGenAI } from '@google/genai';
import { checkDatabaseConnection } from '../db/index.ts';
import {
  addUserWatchlistItem,
  createWatchHistorySession,
  createWatchRoomInDb,
  getProfileByUid,
  getUserWatchlistItems,
  getWatchHistory,
  getWatchRoomByCode,
  listActiveWatchRooms,
  removeUserWatchlistItem,
  toggleUserWatchlistItem,
  updateProfilePreferences,
  updateWatchHistoryProgress,
  verifyRoomPassword,
} from '../db/repository.ts';
import { requireActor, requireAuth, type AuthRequest } from '../middleware/auth.ts';
import { createGuestSession, createRoomAccessToken } from '../security/tokens.ts';
import { canUseNxshaEmbedTest } from '../security/nxshaEmbedAccess.ts';
import { getAuthorizedMediaSource } from '../services/mediaSources.ts';
import { TmdbCatalogError, tmdbCatalogService } from '../services/catalogService.ts';
import type { createTmdbCatalogService } from '../services/catalogService.ts';
import type { MediaItem } from '../types.ts';

type CatalogService = ReturnType<typeof createTmdbCatalogService>;

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const asyncRoute = (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => { void fn(req, res, next).catch(next); };

function rateLimit(windowMs: number, max: number) {
  const buckets = new Map<string, { count: number; resetAt: number }>();
  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > max) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))));
      return res.status(429).json({ error: 'Too many requests. Please retry shortly.' });
    }
    if (buckets.size > 5000) {
      for (const [entry, value] of buckets) if (value.resetAt <= now) buckets.delete(entry);
    }
    return next();
  };
}

const requireDatabase = asyncRoute(async (_req, res, next) => {
  const health = await checkDatabaseConnection();
  if (!health.available) throw new HttpError(503, 'Database is not available. No data was saved.');
  next();
});

function bodyObject(req: Request): Record<string, unknown> {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    throw new HttpError(400, 'Request body must be a JSON object.');
  }
  return req.body as Record<string, unknown>;
}

function text(value: unknown, field: string, max: number, required = true): string {
  if (typeof value !== 'string') {
    if (!required && value === undefined) return '';
    throw new HttpError(400, `${field} must be text.`);
  }
  const result = value.trim();
  if (required && !result) throw new HttpError(400, `${field} is required.`);
  if (result.length > max) throw new HttpError(400, `${field} must be at most ${max} characters.`);
  return result;
}

function finiteNumber(value: unknown, field: string, min: number, max: number, fallback?: number): number {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new HttpError(400, `${field} must be a number between ${min} and ${max}.`);
  }
  return value;
}

function roomCode(value: unknown): string {
  const code = text(value, 'roomCode', 32).toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9-]{2,31}$/.test(code)) throw new HttpError(400, 'Room code format is invalid.');
  return code;
}

function withPlaybackAvailability(item: MediaItem): MediaItem {
  const source = getAuthorizedMediaSource(item.id);
  return {
    ...item,
    platform: 'Unverified',
    playbackStatus: source ? (source.type === 'external' ? 'external-watch' : 'synced-ready') : 'metadata-only',
    authorizedSourceType: source?.type,
    authorizedProviderUrl: source?.type === 'external' ? source.url : undefined,
    authorizedPlaybackSource: source && source.type !== 'external' ? source.url : undefined,
    streamUrl: source?.type === 'mp4' ? source.url : undefined,
    hlsUrl: source?.type === 'hls' ? source.url : undefined,
    sourceAvailability: source ? (source.type === 'external' ? 'external-only' : 'verified') : 'unavailable',
    playbackType: source ? (source.type === 'external' ? 'external-watch' : 'synced-studio') : 'metadata-only',
    playbackCapability: {
      canSync: source?.type === 'mp4' || source?.type === 'hls',
      canEmbed: false,
      requiresExternalWatch: source?.type === 'external',
    },
  };
}

function addPlaybackAvailability(payload: unknown): unknown {
  const decorate = (value: unknown): unknown => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    const item = value as Partial<MediaItem>;
    if (typeof item.id !== 'string' || !item.id || !['movie', 'tv', 'anime'].includes(String(item.mediaType))) return value;
    return withPlaybackAvailability(value as MediaItem);
  };
  if (Array.isArray(payload)) return payload.map(decorate);
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    if (Array.isArray(record.items)) return { ...record, items: record.items.map(decorate) };
    if (record.item) return { ...record, item: decorate(record.item) };
  }
  return decorate(payload);
}

function catalogPage(req: Request): number {
  const raw = req.query.page;
  if (raw === undefined) return 1;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > 500) throw new HttpError(400, 'page must be an integer from 1 to 500.');
  return value;
}

function catalogWindow(req: Request): 'day' | 'week' {
  const value = req.query.window === undefined ? 'week' : req.query.window;
  if (value !== 'day' && value !== 'week') throw new HttpError(400, 'window must be day or week.');
  return value;
}

function catalogFilter(req: Request): { genre?: number; year?: number } {
  const genreRaw = req.query.genre;
  const yearRaw = req.query.year;
  const genre = genreRaw === undefined || genreRaw === '' ? undefined : Number(genreRaw);
  const year = yearRaw === undefined || yearRaw === '' ? undefined : Number(yearRaw);
  if (genre !== undefined && (!Number.isSafeInteger(genre) || genre <= 0)) throw new HttpError(400, 'genre must be a positive TMDB genre ID.');
  if (year !== undefined && (!Number.isSafeInteger(year) || year < 1000 || year > 9999)) throw new HttpError(400, 'year must be an integer from 1000 to 9999.');
  return { genre, year };
}

function catalogSearchQuery(req: Request): string {
  return text(
    typeof req.query.q === 'string' ? req.query.q : typeof req.query.query === 'string' ? req.query.query : '',
    'q',
    120,
  );
}

function catalogId(value: string): number {
  if (!/^[1-9]\d{0,9}$/.test(value)) throw new HttpError(400, 'A numeric TMDB ID is required.');
  const id = Number(value);
  if (!Number.isSafeInteger(id)) throw new HttpError(400, 'A numeric TMDB ID is required.');
  return id;
}

function catalogResponse(payload: unknown): unknown {
  return addPlaybackAvailability(payload);
}

function userId(req: AuthRequest): string {
  if (!req.user?.uid) throw new HttpError(401, 'Sign-in is required.');
  return req.user.uid;
}

function aiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  return apiKey && apiKey !== 'MY_GEMINI_API_KEY' ? new GoogleGenAI({ apiKey }) : null;
}

export function createApiRouter(catalog: CatalogService = tmdbCatalogService): Router {
  const router = Router();
  const authRateLimit = rateLimit(60_000, 30);
  const roomRateLimit = rateLimit(60_000, 20);
  const aiRateLimit = rateLimit(60_000, 15);
  const catalogRateLimit = rateLimit(60_000, 120);

  router.get('/health', asyncRoute(async (_req, res) => {
    const database = await checkDatabaseConnection();
    res.status(database.available ? 200 : 503).json({
      status: database.available ? 'ok' : 'degraded',
      database: database.available ? 'connected' : 'unavailable',
      timestamp: new Date().toISOString(),
    });
  }));
  router.get('/health/catalog', asyncRoute(async (_req, res) => {
    const health = catalog.health();
    return res.status(health.configured ? 200 : 503).json(health);
  }));

  router.post('/auth/guest-session', authRateLimit, asyncRoute(async (req, res) => {
    const name = text(bodyObject(req).displayName || 'Cinema Guest', 'displayName', 48);
    res.status(201).json({ data: createGuestSession(name) });
  }));

  router.get('/playback/nxsha/test-access', authRateLimit, requireAuth, (req, res) => {
    const uid = (req as AuthRequest).user?.uid;
    return res.json({ enabled: canUseNxshaEmbedTest(uid, {
      enabled: process.env.NXSHA_EMBED_TEST_ENABLED,
      accountUid: process.env.NXSHA_EMBED_TEST_ACCOUNT_UID,
    }) });
  });

  router.get('/catalog/status', catalogRateLimit, (_req, res) => {
    const health = catalog.health();
    return res.status(health.configured ? 200 : 503).json(health);
  });

  router.get('/catalog/genres/:mediaType', catalogRateLimit, asyncRoute(async (req, res) => {
    const mediaType = req.params.mediaType;
    if (mediaType !== 'movie' && mediaType !== 'tv') throw new HttpError(400, 'mediaType must be movie or tv.');
    return res.json(catalogResponse(await catalog.genres(mediaType)));
  }));

  router.get('/catalog/movies/popular', catalogRateLimit, asyncRoute(async (req, res) => {
    const page = catalogPage(req);
    const filters = catalogFilter(req);
    const payload = filters.genre || filters.year
      ? await catalog.discoverMovies(page, filters)
      : await catalog.popularMovies(page);
    return res.json(catalogResponse(payload));
  }));
  router.get('/catalog/movies/top-rated', catalogRateLimit, asyncRoute(async (req, res) => {
    return res.json(catalogResponse(await catalog.topRatedMovies(catalogPage(req))));
  }));
  router.get('/catalog/movies/now-playing', catalogRateLimit, asyncRoute(async (req, res) => {
    return res.json(catalogResponse(await catalog.nowPlayingMovies(catalogPage(req))));
  }));
  router.get('/catalog/movies/upcoming', catalogRateLimit, asyncRoute(async (req, res) => {
    return res.json(catalogResponse(await catalog.upcomingMovies(catalogPage(req))));
  }));
  router.get('/catalog/movies/trending', catalogRateLimit, asyncRoute(async (req, res) => {
    return res.json(catalogResponse(await catalog.trendingMovies(catalogPage(req), catalogWindow(req))));
  }));
  router.get('/catalog/movies/discover', catalogRateLimit, asyncRoute(async (req, res) => {
    return res.json(catalogResponse(await catalog.discoverMovies(catalogPage(req), catalogFilter(req))));
  }));
  router.get('/catalog/movies/search', catalogRateLimit, asyncRoute(async (req, res) => {
    const filters = catalogFilter(req);
    return res.json(catalogResponse(await catalog.searchMovies(catalogSearchQuery(req), catalogPage(req), filters.year)));
  }));
  router.get('/catalog/movies/:id/recommendations', catalogRateLimit, asyncRoute(async (req, res) => {
    return res.json(catalogResponse(await catalog.movieRecommendations(catalogId(req.params.id), catalogPage(req))));
  }));
  router.get('/catalog/movies/:id', catalogRateLimit, asyncRoute(async (req, res) => {
    return res.json(catalogResponse(await catalog.movieDetails(catalogId(req.params.id))));
  }));

  router.get('/catalog/tv/popular', catalogRateLimit, asyncRoute(async (req, res) => {
    const page = catalogPage(req);
    const filters = catalogFilter(req);
    const payload = filters.genre || filters.year
      ? await catalog.discoverTv(page, filters)
      : await catalog.popularTv(page);
    return res.json(catalogResponse(payload));
  }));
  router.get('/catalog/tv/trending', catalogRateLimit, asyncRoute(async (req, res) => {
    return res.json(catalogResponse(await catalog.trendingTv(catalogPage(req), catalogWindow(req))));
  }));
  router.get('/catalog/tv/discover', catalogRateLimit, asyncRoute(async (req, res) => {
    return res.json(catalogResponse(await catalog.discoverTv(catalogPage(req), catalogFilter(req))));
  }));
  router.get('/catalog/tv/search', catalogRateLimit, asyncRoute(async (req, res) => {
    const filters = catalogFilter(req);
    return res.json(catalogResponse(await catalog.searchTv(catalogSearchQuery(req), catalogPage(req), filters.year)));
  }));
  router.get('/catalog/tv/:id/seasons/:seasonNumber/episodes', catalogRateLimit, asyncRoute(async (req, res) => {
    const season = Number(req.params.seasonNumber);
    return res.json({ provider: 'TMDB', state: 'available', season: await catalog.tvSeason(catalogId(req.params.id), season) });
  }));
  router.get('/catalog/tv/:id/seasons/:seasonNumber', catalogRateLimit, asyncRoute(async (req, res) => {
    const season = Number(req.params.seasonNumber);
    return res.json({ provider: 'TMDB', state: 'available', season: await catalog.tvSeason(catalogId(req.params.id), season) });
  }));
  router.get('/catalog/tv/:id/seasons', catalogRateLimit, asyncRoute(async (req, res) => {
    return res.json(catalogResponse(await catalog.tvDetails(catalogId(req.params.id))));
  }));
  router.get('/catalog/tv/:id', catalogRateLimit, asyncRoute(async (req, res) => {
    return res.json(catalogResponse(await catalog.tvDetails(catalogId(req.params.id))));
  }));

  router.get('/catalog/feed', catalogRateLimit, asyncRoute(async (req, res) => {
    const section = String(req.query.section || 'all').toLowerCase();
    const page = catalogPage(req);
    const filters = catalogFilter(req);
    if (section === 'movie' || section === 'movies') {
      const payload = filters.genre || filters.year ? await catalog.discoverMovies(page, filters) : await catalog.popularMovies(page);
      return res.json(catalogResponse(payload));
    }
    if (section === 'tv' || section === 'series') {
      const payload = filters.genre || filters.year ? await catalog.discoverTv(page, filters) : await catalog.popularTv(page);
      return res.json(catalogResponse(payload));
    }
    if (section === 'trending') return res.json(catalogResponse(await catalog.trendingMovies(page)));
    if (section === 'top-rated') return res.json(catalogResponse(await catalog.topRatedMovies(page)));
    if (section === 'now-playing') return res.json(catalogResponse(await catalog.nowPlayingMovies(page)));
    if (section === 'upcoming') return res.json(catalogResponse(await catalog.upcomingMovies(page)));
    if (section === 'tv-trending') return res.json(catalogResponse(await catalog.trendingTv(page)));
    if (section === 'anime') {
      throw new HttpError(422, 'TMDB does not expose a separate anime catalog. Browse movie or TV metadata instead.');
    }
    if (section !== 'all') throw new HttpError(400, 'section must be all, movie, tv, trending, top-rated, now-playing, upcoming, tv-trending, or anime.');
    const [movies, shows] = await Promise.all([catalog.popularMovies(page), catalog.popularTv(page)]);
    return res.json(catalogResponse({
      provider: 'TMDB',
      state: 'available',
      items: [...movies.items, ...shows.items],
      page,
      totalPages: Math.max(movies.totalPages, shows.totalPages),
      totalResults: movies.totalResults + shows.totalResults,
      hasMore: movies.hasMore || shows.hasMore,
    }));
  }));

  router.get('/catalog/search', catalogRateLimit, asyncRoute(async (req, res) => {
    const query = catalogSearchQuery(req);
    const page = catalogPage(req);
    const filters = catalogFilter(req);
    const type = req.query.type === undefined ? 'all' : String(req.query.type);
    if (type === 'movie') return res.json(catalogResponse(await catalog.searchMovies(query, page, filters.year)));
    if (type === 'tv') return res.json(catalogResponse(await catalog.searchTv(query, page, filters.year)));
    if (type !== 'all') throw new HttpError(400, 'type must be movie, tv, or all.');
    const [movies, shows] = await Promise.all([
      catalog.searchMovies(query, page, filters.year),
      catalog.searchTv(query, page, filters.year),
    ]);
    const items = [...movies.items, ...shows.items];
    return res.json(catalogResponse({
      provider: 'TMDB',
      state: 'available',
      items,
      page,
      totalPages: Math.max(movies.totalPages, shows.totalPages),
      totalResults: movies.totalResults + shows.totalResults,
      hasMore: movies.hasMore || shows.hasMore,
    }));
  }));

  // Backwards-compatible metadata route; numeric IDs must be explicitly scoped to TMDB.
  router.get('/catalog/:providerId/seasons/:seasonNumber/episodes', catalogRateLimit, asyncRoute(async (req, res) => {
    const match = /^tmdb:tv:([1-9]\d{0,9})$/.exec(req.params.providerId);
    if (!match) throw new HttpError(400, 'Use a TMDB TV ID for season and episode metadata.');
    const season = Number(req.params.seasonNumber);
    return res.json({ provider: 'TMDB', state: 'available', season: await catalog.tvSeason(Number(match[1]), season) });
  }));
  router.get('/catalog/:providerId/seasons', catalogRateLimit, asyncRoute(async (req, res) => {
    const match = /^tmdb:tv:([1-9]\d{0,9})$/.exec(req.params.providerId);
    if (!match) throw new HttpError(400, 'Use a TMDB TV ID for series season metadata.');
    return res.json(catalogResponse(await catalog.tvDetails(Number(match[1]))));
  }));
  router.get('/catalog/:providerId', catalogRateLimit, asyncRoute(async (req, res) => {
    const match = /^tmdb:(movie|tv):([1-9]\d{0,9})$/.exec(req.params.providerId);
    if (!match) throw new HttpError(400, 'Use a TMDB-scoped ID for catalog details.');
    const payload = match[1] === 'movie'
      ? await catalog.movieDetails(Number(match[2]))
      : await catalog.tvDetails(Number(match[2]));
    return res.json(catalogResponse(payload));
  }));

  router.get('/media/availability/:id', asyncRoute(async (req, res) => {
    const id = text(req.params.id, 'mediaId', 120);
    const season = Number(req.query.season);
    const episode = Number(req.query.episode);
    const episodeId = Number.isInteger(season) && season > 0 && Number.isInteger(episode) && episode > 0 ? `${id}:s${season}:e${episode}` : '';
    const source = (episodeId && getAuthorizedMediaSource(episodeId)) || getAuthorizedMediaSource(id);
    if (!source) return res.json({ mediaId: id, available: false, status: 'metadata-only', message: 'No authorized playback source is configured for this title.' });
    return res.json({ mediaId: id, available: true, status: source.type === 'external' ? 'external-watch' : 'synced-ready', sourceType: source.type, url: source.url, host: source.host });
  }));

  router.get('/party/rooms', requireDatabase, asyncRoute(async (_req, res) => {
    const rooms = await listActiveWatchRooms();
    return res.json({ items: rooms, rooms });
  }));
  router.post('/party/rooms', roomRateLimit, requireActor, requireDatabase, asyncRoute(async (req, res) => {
    const body = bodyObject(req);
    const actor = (req as AuthRequest).actor!;
    const code = body.roomCode ? roomCode(body.roomCode) : `${body.mode === 'couple' ? 'LOVE' : 'CLUB'}-${crypto.randomInt(100000, 999999)}`;
    const mode = body.mode === 'couple' ? 'couple' : body.mode === 'group' ? 'group' : null;
    if (!mode) throw new HttpError(400, 'mode must be couple or group.');
    if (body.mediaType !== undefined && !['movie', 'tv', 'anime'].includes(String(body.mediaType))) {
      throw new HttpError(400, 'mediaType must be movie, tv, or anime.');
    }
    const mediaType = typeof body.mediaType === 'string' ? body.mediaType : 'movie';
    const mediaId = text(body.mediaId, 'mediaId', 120);
    const room = await createWatchRoomInDb({
      roomCode: code,
      roomType: mode,
      title: text(body.roomName, 'roomName', 100),
      description: typeof body.description === 'string' ? body.description.slice(0, 500) : '',
      hostUserId: actor.id,
      hostDisplayName: text(body.hostName || actor.displayName || 'Cinema Guest', 'hostName', 48),
      currentMediaId: mediaId,
      currentMediaType: mediaType,
      password: typeof body.password === 'string' ? body.password.slice(0, 128) : undefined,
      maxParticipants: finiteNumber(body.maxParticipants, 'maxParticipants', 2, 20, mode === 'couple' ? 2 : 10),
      collaborativeControls: typeof body.collaborativeControls === 'boolean' ? body.collaborativeControls : mode === 'couple',
      roomTheme: typeof body.roomTheme === 'string' ? body.roomTheme.slice(0, 40) : undefined,
    });
    const token = createRoomAccessToken(actor.id, code, 'host');
    return res.status(201).json({ room: { roomCode: room.roomCode, roomType: room.roomType, title: room.title }, roomAccessToken: token });
  }));
  router.post('/party/rooms/:roomCode/verify', roomRateLimit, requireActor, requireDatabase, asyncRoute(async (req, res) => {
    const code = roomCode(req.params.roomCode);
    const room = await getWatchRoomByCode(code);
    if (!room || room.status === 'ended') throw new HttpError(404, 'Watch room was not found.');
    const pass = typeof req.body?.password === 'string' ? req.body.password.slice(0, 128) : '';
    if (room.passwordHash && !verifyRoomPassword(pass, room.passwordHash)) throw new HttpError(403, 'Invalid room password or code.');
    const actor = (req as AuthRequest).actor!;
    const role = room.hostUserId === actor.id ? 'host' : 'member';
    return res.json({ valid: true, mode: room.roomType, roomAccessToken: createRoomAccessToken(actor.id, code, role), room: { roomCode: code, roomName: room.title, mediaId: room.currentMediaId, mediaType: room.currentMediaType } });
  }));
  router.get('/watchlist', requireAuth, requireDatabase, asyncRoute(async (req, res) => {
    const items = await getUserWatchlistItems(userId(req as AuthRequest));
    return res.json({ items });
  }));
  router.post('/watchlist/toggle', requireAuth, requireDatabase, asyncRoute(async (req, res) => {
    const body = bodyObject(req);
    const result = await toggleUserWatchlistItem({
      userId: userId(req as AuthRequest),
      mediaId: text(body.mediaId, 'mediaId', 120),
      mediaTitle: text(body.mediaTitle, 'mediaTitle', 200),
      mediaType: text(body.mediaType, 'mediaType', 20),
      posterUrl: text(body.posterUrl || '', 'posterUrl', 1000, false),
      year: text(body.year || '', 'year', 12, false),
      rating: finiteNumber(body.rating, 'rating', 0, 10, 0),
    });
    return res.json(result);
  }));
  router.post('/watchlist', requireAuth, requireDatabase, asyncRoute(async (req, res) => {
    const body = bodyObject(req);
    const item = await addUserWatchlistItem({ userId: userId(req as AuthRequest), mediaId: text(body.mediaId, 'mediaId', 120), mediaTitle: text(body.mediaTitle, 'mediaTitle', 200), mediaType: text(body.mediaType, 'mediaType', 20), posterUrl: text(body.posterUrl || '', 'posterUrl', 1000, false), year: text(body.year || '', 'year', 12, false), rating: finiteNumber(body.rating, 'rating', 0, 10, 0) });
    return res.status(201).json({ item });
  }));
  router.delete('/watchlist/:mediaId', requireAuth, requireDatabase, asyncRoute(async (req, res) => {
    const removed = await removeUserWatchlistItem(userId(req as AuthRequest), text(req.params.mediaId, 'mediaId', 120));
    return res.json({ removed });
  }));

  router.get('/profile', requireAuth, requireDatabase, asyncRoute(async (req, res) => {
    const uid = userId(req as AuthRequest);
    return res.json({ profile: await getProfileByUid(uid) });
  }));
  const saveProfile = asyncRoute(async (req, res) => {
    const body = bodyObject(req);
    const actor = (req as AuthRequest).user!;
    const email = actor.email || '';
    const preferences = body.preferences && typeof body.preferences === 'object' && !Array.isArray(body.preferences) ? body.preferences as Record<string, unknown> : undefined;
    if (body.preferences !== undefined && !preferences) throw new HttpError(400, 'preferences must be a JSON object.');
    if (preferences && JSON.stringify(preferences).length > 4000) throw new HttpError(400, 'Profile preferences must be at most 4 KB.');
    const theme = body.preferredTheme === undefined ? 'midnight-violet' : text(body.preferredTheme, 'preferredTheme', 40);
    const profile = await updateProfilePreferences({ uid: actor.uid, email, displayName: text(body.displayName || actor.name || 'CineTogether Member', 'displayName', 80), avatarUrl: typeof actor.picture === 'string' ? actor.picture : undefined, preferredTheme: theme, preferences });
    return res.json({ profile });
  });
  router.patch('/profile', requireAuth, requireDatabase, saveProfile);
  router.post('/profile/preferences', requireAuth, requireDatabase, saveProfile);

  router.get('/watch-history', requireAuth, requireDatabase, asyncRoute(async (req, res) => {
    const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 50));
    return res.json({ items: await getWatchHistory(userId(req as AuthRequest), limit) });
  }));
  const recordHistory = asyncRoute(async (req, res) => {
    const body = bodyObject(req);
    const session = await createWatchHistorySession({
      userId: userId(req as AuthRequest),
      mediaId: text(body.mediaId, 'mediaId', 120),
      mediaTitle: text(body.mediaTitle, 'mediaTitle', 200),
      mediaType: text(body.mediaType || 'movie', 'mediaType', 20),
      roomType: text(body.roomType || 'solo', 'roomType', 20),
      progressSeconds: finiteNumber(body.progressSeconds, 'progressSeconds', 0, 86_400, 0),
      durationSeconds: finiteNumber(body.durationSeconds, 'durationSeconds', 1, 86_400, 7_200),
    });
    return res.status(201).json({ session });
  });
  router.post('/watch-history', requireAuth, requireDatabase, recordHistory);
  router.post('/sessions/record', requireAuth, requireDatabase, recordHistory);
  router.patch('/watch-history/:sessionId', requireAuth, requireDatabase, asyncRoute(async (req, res) => {
    const body = bodyObject(req);
    if (body.ended !== undefined && typeof body.ended !== 'boolean') throw new HttpError(400, 'ended must be a boolean.');
    const session = await updateWatchHistoryProgress({ sessionId: text(req.params.sessionId, 'sessionId', 80), userId: userId(req as AuthRequest), progressSeconds: finiteNumber(body.progressSeconds, 'progressSeconds', 0, 86_400), durationSeconds: finiteNumber(body.durationSeconds, 'durationSeconds', 1, 86_400), ended: body.ended === true });
    if (!session) throw new HttpError(404, 'Watch history record was not found.');
    return res.json({ session });
  }));

  router.post('/gemini/analyze', aiRateLimit, asyncRoute(async (req, res) => {
    const body = bodyObject(req);
    const title = text(body.title, 'title', 200);
    const prompt = text(body.query || 'Analyze the story themes and pacing without inventing plot details.', 'query', 1000);
    const client = aiClient();
    if (!client) throw new HttpError(503, 'AI analysis is unavailable because GEMINI_API_KEY is not configured.');
    const response = await client.models.generateContent({ model: 'gemini-2.5-flash', contents: `Analyze this metadata only; do not claim you watched the title. Title: ${title}. Description: ${String(body.description || '').slice(0, 3000)}. Genres: ${Array.isArray(body.genres) ? body.genres.slice(0, 12).join(', ') : ''}. Request: ${prompt}` });
    return res.json({ analysis: response.text || '', model: 'gemini-2.5-flash' });
  }));
  router.post('/gemini/quick-recap', aiRateLimit, asyncRoute(async (req, res) => {
    const body = bodyObject(req);
    const title = text(body.title, 'title', 200);
    const seconds = finiteNumber(body.timestampSeconds, 'timestampSeconds', 0, 86_400, 0);
    const client = aiClient();
    if (!client) throw new HttpError(503, 'AI recap is unavailable because GEMINI_API_KEY is not configured.');
    const response = await client.models.generateContent({ model: 'gemini-2.5-flash', contents: `The user is at ${Math.floor(seconds)} seconds in a title named "${title}". No plot synopsis or episode transcript is provided. Explain that exact scene context is unavailable and offer a spoiler-safe recap request based only on metadata; do not invent scene details.` });
    return res.json({ recap: response.text || 'Scene context is unavailable because no authorized synopsis or transcript is configured.', model: 'gemini-2.5-flash' });
  }));
  router.post('/gemini/recommend', aiRateLimit, asyncRoute(async (req, res) => {
    const body = bodyObject(req);
    const mood = text(body.mood || 'open-minded', 'mood', 100);
    const history = Array.isArray(body.historyTitles) ? body.historyTitles.slice(0, 20).map((x) => String(x).slice(0, 120)) : [];
    const client = aiClient();
    if (!client) throw new HttpError(503, 'AI recommendations are unavailable because GEMINI_API_KEY is not configured.');
    const response = await client.models.generateContent({ model: 'gemini-2.5-flash', contents: `Give three film/TV metadata recommendations for mood "${mood}" based on titles ${history.join(', ') || 'none supplied'}. Say that availability must be checked separately. Return concise JSON with itineraryTitle, curatorNote, and picks [{title,reason}].` });
    const raw = response.text || '';
    try { return res.json({ model: 'gemini-2.5-flash', data: JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, '')) }); }
    catch { return res.json({ model: 'gemini-2.5-flash', data: { itineraryTitle: `${mood} watch ideas`, curatorNote: raw, picks: [] } }); }
  }));

  router.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) return;
    if (error instanceof TmdbCatalogError) {
      if (error.retryAfterSeconds !== undefined) res.setHeader('Retry-After', String(error.retryAfterSeconds));
      return res.status(error.status).json({
        provider: 'TMDB',
        state: error.status >= 500 ? 'unavailable' : 'error',
        code: error.code,
        error: error.message,
      });
    }
    if (error instanceof HttpError) return res.status(error.status).json({ error: error.message });
    const pgCode = (error as { code?: string })?.code;
    if (pgCode === '23505') return res.status(409).json({ error: 'That value already exists.' });
    if (pgCode === '23503') return res.status(400).json({ error: 'A referenced record does not exist.' });
    const safeMessage = process.env.NODE_ENV === 'production' ? 'The request could not be completed.' : (error instanceof Error ? error.message : 'Unknown error');
    console.error('[API ERROR]', error instanceof Error ? error.name : 'UnknownError', pgCode || 'no_code');
    return res.status(500).json({ error: safeMessage });
  });
  return router;
}

export const _routeTestUtils = { withPlaybackAvailability, roomCode, finiteNumber, text };
