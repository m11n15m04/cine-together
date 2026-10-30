import crypto from 'node:crypto';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { GoogleGenAI } from '@google/genai';
import { INITIAL_CATALOG } from '../data/catalog.ts';
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
import { getAuthorizedMediaSource } from '../services/mediaSources.ts';
import {
  checkCatalogHealth,
  fetchFullNxshaCatalog,
  getTmdbPopularMovies,
  getTmdbPopularTv,
  getTmdbTrending,
  getTmdbTvSeasons,
  searchNxsha,
  searchTmdb,
} from '../services/catalogService.ts';
import type { MediaItem } from '../types.ts';

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
    platform: source?.type === 'external' ? item.platform : 'Unverified',
    playbackStatus: source ? (source.type === 'external' ? 'external-watch' : 'synced-ready') : 'metadata-only',
    authorizedSourceType: source?.type,
    authorizedProviderUrl: source?.type === 'external' ? source.url : undefined,
  };
}

function userId(req: AuthRequest): string {
  if (!req.user?.uid) throw new HttpError(401, 'Sign-in is required.');
  return req.user.uid;
}

function aiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  return apiKey && apiKey !== 'MY_GEMINI_API_KEY' ? new GoogleGenAI({ apiKey }) : null;
}

export function createApiRouter(): Router {
  const router = Router();
  const authRateLimit = rateLimit(60_000, 30);
  const roomRateLimit = rateLimit(60_000, 20);
  const aiRateLimit = rateLimit(60_000, 15);

  router.get('/health', asyncRoute(async (_req, res) => {
    const database = await checkDatabaseConnection();
    res.status(database.available ? 200 : 503).json({
      status: database.available ? 'ok' : 'degraded',
      database: database.available ? 'connected' : 'unavailable',
      timestamp: new Date().toISOString(),
    });
  }));
  router.get('/health/catalog', asyncRoute(async (_req, res) => res.json(await checkCatalogHealth())));

  router.post('/auth/guest-session', authRateLimit, asyncRoute(async (req, res) => {
    const name = text(bodyObject(req).displayName || 'Cinema Guest', 'displayName', 48);
    res.status(201).json({ data: createGuestSession(name) });
  }));

  router.get('/catalog/feed', asyncRoute(async (req, res) => {
    const section = String(req.query.section || 'all').slice(0, 32);
    const page = Math.max(1, Math.min(500, Number(req.query.page) || 1));
    const pageSize = Math.max(1, Math.min(100, Number(req.query.pageSize) || 24));
    let items: MediaItem[] = [];
    let source = 'catalog';
    let totalCount = 0;
    let totalPages = 0;
    let sections: Array<{ heading: string; tabKey: string; count: number }> = [];
    let liveConnected = false;
    if (section === 'trending') {
      const result = await getTmdbTrending(page);
      items = result.items;
      totalCount = result.totalResults;
      totalPages = result.totalPages;
      liveConnected = result.ok;
      source = 'TMDB trending metadata';
    } else if (section === 'popular-movies' || section === 'popular-tv') {
      const result = section === 'popular-movies' ? await getTmdbPopularMovies(page) : await getTmdbPopularTv(page);
      items = result.items;
      totalCount = result.totalResults;
      totalPages = result.totalPages;
      liveConnected = result.ok;
      source = 'TMDB popular metadata';
    } else {
      const catalog = await fetchFullNxshaCatalog();
      const tab = section === 'movie' || section === 'tv' || section === 'anime' ? section : 'home';
      items = tab === 'home' ? catalog.items : catalog.byTab[tab] || [];
      totalCount = items.length;
      totalPages = Math.ceil(totalCount / pageSize);
      sections = catalog.sections;
      liveConnected = catalog.liveConnected;
      source = 'Nxsha metadata catalog';
    }
    const offset = (page - 1) * pageSize;
    return res.json({
      source,
      liveConnected,
      isDemoFallback: false,
      totalCount: Math.min(totalCount, pageSize),
      totalCatalogSize: totalCount,
      page,
      pageSize,
      totalPages,
      hasMore: page < totalPages,
      sections,
      items: items.slice(offset, offset + pageSize).map(withPlaybackAvailability),
    });
  }));

  router.get('/catalog/search', asyncRoute(async (req, res) => {
    const query = text(typeof req.query.q === 'string' ? req.query.q : '', 'q', 120);
    const typeParam = ['movie', 'tv'].includes(String(req.query.type)) ? String(req.query.type) as 'movie' | 'tv' : 'all';
    const page = Math.max(1, Math.min(100, Number(req.query.page) || 1));
    const [tmdb, nxsha] = await Promise.all([searchTmdb(query, typeParam, page), searchNxsha(query)]);
    const merged = new Map<string, MediaItem>();
    for (const item of [...tmdb.items, ...nxsha]) if (!merged.has(item.id)) merged.set(item.id, item);
    const all = [...merged.values()];
    return res.json({ query, liveSearchUsed: tmdb.ok || nxsha.length > 0, page, totalPages: tmdb.totalPages, totalResults: Math.max(tmdb.totalResults, all.length), providers: ['TMDB', 'Nxsha'], items: all.slice(0, 100).map(withPlaybackAvailability) });
  }));
  router.get('/nxsha/feed', asyncRoute(async (req, res) => {
    const catalog = await fetchFullNxshaCatalog();
    const tab = ['home', 'movie', 'tv', 'anime'].includes(String(req.query.tab)) ? String(req.query.tab) : 'home';
    const items = (tab === 'home' ? catalog.items : catalog.byTab[tab] || []).map(withPlaybackAvailability);
    return res.json({ source: 'Nxsha metadata catalog', liveConnected: catalog.liveConnected, isDemoFallback: false, items, sections: catalog.sections, totalCount: items.length });
  }));
  router.get('/nxsha/search', asyncRoute(async (req, res) => {
    const query = text(typeof req.query.q === 'string' ? req.query.q : '', 'q', 120);
    const items = await searchNxsha(query);
    return res.json({ query, source: 'Nxsha metadata search', items: items.map(withPlaybackAvailability) });
  }));
  router.get('/nxsha/tv/:tmdbId/seasons', asyncRoute(async (req, res) => {
    const id = Number(req.params.tmdbId);
    if (!Number.isSafeInteger(id) || id <= 0) throw new HttpError(400, 'TMDB ID is invalid.');
    const result = await getTmdbTvSeasons(id, String(req.query.title || '').slice(0, 120));
    return res.json(result);
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

export const _routeTestUtils = { withPlaybackAvailability, roomCode, finiteNumber, text, initialCatalogSize: INITIAL_CATALOG.length };
