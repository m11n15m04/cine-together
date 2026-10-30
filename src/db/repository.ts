import crypto from 'node:crypto';
import { and, desc, eq, ne, sql } from 'drizzle-orm';
import { db } from './index.ts';
import {
  chatMessages,
  mediaItems,
  playbackStates,
  profiles,
  roomMembers,
  roomReactions,
  roomVotes,
  watchlists,
  watchlistItems,
  watchRooms,
  watchSessions,
} from './schema.ts';
import { INITIAL_CATALOG } from '../data/catalog.ts';
import type { ChatMessage, PartyPlaybackState, RoomThemeId, WatchRoomSummary } from '../types.ts';

function normalizeRoomCode(roomCode: string): string {
  return roomCode.trim().toUpperCase();
}

export function hashPassword(plain?: string): string | null {
  if (!plain?.trim()) return null;
  const salt = crypto.randomBytes(16);
  const digest = crypto.scryptSync(plain.trim(), salt, 64);
  return `scrypt$${salt.toString('hex')}$${digest.toString('hex')}`;
}

export function verifyRoomPassword(plain: string, storedHash: string | null | undefined): boolean {
  if (!storedHash) return true;
  if (storedHash.startsWith('scrypt$')) {
    const [, saltHex, expectedHex] = storedHash.split('$');
    if (!saltHex || !expectedHex || !/^[0-9a-f]+$/i.test(saltHex + expectedHex)) return false;
    const expected = Buffer.from(expectedHex, 'hex');
    const actual = crypto.scryptSync(plain.trim(), Buffer.from(saltHex, 'hex'), expected.length);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  }

  // Existing rooms used a fixed-prefix SHA-256 digest. Keep those room passwords valid until
  // they are rotated; new passwords always use salted scrypt hashes.
  const legacy = crypto.createHash('sha256').update(`cinetogether::${plain.trim()}`).digest('hex');
  const expected = Buffer.from(storedHash, 'hex');
  const actual = Buffer.from(legacy, 'hex');
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

export async function seedDemoCatalog(): Promise<void> {
  if (process.env.SEED_DEMO_DATA !== 'true') return;
  for (const item of INITIAL_CATALOG) {
    await db
      .insert(mediaItems)
      .values({
        id: item.id,
        tmdbId: item.tmdbId,
        mediaType: item.mediaType,
        title: item.title,
        year: item.year,
        rating: item.rating,
        durationMinutes: item.durationMinutes,
        genres: JSON.stringify(item.genres),
        language: item.language || 'English',
        overview: item.description,
        posterUrl: item.posterUrl || '',
        backdropUrl: item.backdropUrl || '',
        seasons: item.seasons || 1,
        episodes: item.episodes || 1,
      })
      .onConflictDoNothing({ target: mediaItems.id });
  }
}

export async function listActiveWatchRooms(): Promise<WatchRoomSummary[]> {
  const rows = await db
    .select({
      room: watchRooms,
      memberCount: sql<number>`(
        SELECT count(*)::int
        FROM ${roomMembers}
        WHERE ${roomMembers.roomId} = ${watchRooms.id}
          AND ${roomMembers.isOnline} = true
          AND ${roomMembers.leftAt} IS NULL
      )`,
    })
    .from(watchRooms)
    .where(and(eq(watchRooms.isPrivate, false), ne(watchRooms.status, 'ended')))
    .orderBy(desc(watchRooms.createdAt))
    .limit(50);
  return rows.map(({ room, memberCount }) => ({
    id: room.id,
    roomCode: room.roomCode,
    roomType: room.roomType === 'couple' ? 'couple' : 'group',
    title: room.title,
    description: room.description,
    hostUserId: room.hostUserId,
    currentMediaId: room.currentMediaId,
    currentMediaType: room.currentMediaType as WatchRoomSummary['currentMediaType'],
    currentSeason: room.currentSeason,
    currentEpisode: room.currentEpisode,
    isPrivate: room.isPrivate,
    hasPassword: Boolean(room.passwordHash),
    maxParticipants: room.maxParticipants,
    collaborativeControls: room.collaborativeControls,
    roomTheme: room.roomTheme as RoomThemeId,
    status: room.status as WatchRoomSummary['status'],
    memberCount,
    createdAt: room.createdAt.toISOString(),
  }));
}

export async function createWatchRoomInDb(params: {
  roomCode: string;
  roomType: 'couple' | 'group';
  title: string;
  description?: string;
  hostUserId: string;
  hostDisplayName: string;
  currentMediaId: string;
  currentMediaType: string;
  password?: string;
  maxParticipants?: number;
  collaborativeControls?: boolean;
  roomTheme?: string;
}) {
  const code = normalizeRoomCode(params.roomCode);
  const now = new Date();
  const pwdHash = hashPassword(params.password);
  const maxCap = params.roomType === 'couple' ? 2 : Math.max(3, Math.min(20, params.maxParticipants || 10));

  return db.transaction(async (tx) => {
    const [room] = await tx
      .insert(watchRooms)
      .values({
        roomCode: code,
        roomType: params.roomType,
        title: params.title.trim(),
        description: params.description?.trim() || '',
        hostUserId: params.hostUserId,
        currentMediaId: params.currentMediaId,
        currentMediaType: params.currentMediaType,
        currentSeason: 1,
        currentEpisode: 1,
        isPrivate: params.roomType === 'couple' || Boolean(pwdHash),
        passwordHash: pwdHash,
        maxParticipants: maxCap,
        collaborativeControls: params.collaborativeControls ?? params.roomType === 'couple',
        isLocked: false,
        roomTheme: params.roomTheme || (params.roomType === 'couple' ? 'rose-nebula' : 'midnight-violet'),
        couplePartnerNote: '',
        status: 'waiting',
      })
      .returning();

    await tx.insert(playbackStates).values({
      roomId: room.id,
      mediaId: params.currentMediaId,
      mediaType: params.currentMediaType,
      status: 'paused',
      positionSeconds: 0,
      playbackRate: 1,
      hostId: params.hostUserId,
      revision: 1,
      updatedAt: now,
    });
    await tx.insert(roomMembers).values({
      roomId: room.id,
      userId: params.hostUserId,
      displayName: params.hostDisplayName,
      role: 'host',
      isOnline: true,
      joinedAt: now,
    });
    return room;
  });
}

export async function getWatchRoomByCode(roomCode: string) {
  const [room] = await db
    .select()
    .from(watchRooms)
    .where(eq(watchRooms.roomCode, normalizeRoomCode(roomCode)))
    .limit(1);
  return room || null;
}

export async function getWatchRoomSnapshot(roomCode: string): Promise<PartyPlaybackState | null> {
  const room = await getWatchRoomByCode(roomCode);
  if (!room) return null;
  const [playback] = await db
    .select()
    .from(playbackStates)
    .where(eq(playbackStates.roomId, room.id))
    .limit(1);
  const members = await db
    .select()
    .from(roomMembers)
    .where(and(eq(roomMembers.roomId, room.id), eq(roomMembers.isOnline, true)))
    .orderBy(roomMembers.joinedAt);
  const messages = await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.roomId, room.id))
    .orderBy(desc(chatMessages.createdAt))
    .limit(100);
  const votes = await db.select().from(roomVotes).where(eq(roomVotes.roomId, room.id));
  const [reactionCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(roomReactions)
    .where(eq(roomReactions.roomId, room.id));

  return {
    roomId: room.roomCode,
    roomCode: room.roomCode,
    roomName: room.title,
    mode: room.roomType === 'couple' ? 'couple' : 'group',
    mediaId: playback?.mediaId || room.currentMediaId,
    mediaType: (playback?.mediaType || room.currentMediaType) as PartyPlaybackState['mediaType'],
    season: room.currentSeason,
    episode: room.currentEpisode,
    isPlaying: playback?.status === 'playing',
    currentTimeSeconds: playback?.positionSeconds || 0,
    playbackRate: playback?.playbackRate || 1,
    revision: playback?.revision || 1,
    updatedAtMs: (playback?.updatedAt || room.createdAt).getTime(),
    hostId: room.hostUserId,
    collaborativeControls: room.collaborativeControls,
    isLocked: room.isLocked,
    roomTheme: room.roomTheme as RoomThemeId,
    lifecycleState: room.status as PartyPlaybackState['lifecycleState'],
    members: members.map((member) => ({
      id: member.userId,
      name: member.displayName,
      avatarColor: member.avatarColor,
      role: member.role as PartyPlaybackState['members'][number]['role'],
      isOnline: member.isOnline,
      joinedAt: member.joinedAt.toISOString(),
      micMuted: true,
      camEnabled: false,
    })),
    messages: messages.reverse().map((message) => ({
      id: message.id,
      senderId: message.senderId,
      senderName: message.senderName,
      text: message.content,
      timestamp: message.createdAt.toISOString(),
      videoTimestampSeconds: message.videoTimestampSeconds,
      type: message.messageType as ChatMessage['type'],
    })),
    votes: votes.map((vote) => ({
      id: vote.id,
      mediaId: vote.mediaId,
      mediaTitle: vote.mediaTitle,
      voterId: vote.voterId,
      voterName: vote.voterName,
    })),
    couplePulseCount: reactionCount?.count || 0,
    couplePartnerNote: room.couplePartnerNote,
  };
}

export async function joinRoomInDb(params: {
  roomCode: string;
  userId: string;
  displayName: string;
  role: string;
}) {
  return db.transaction(async (tx) => {
    const code = normalizeRoomCode(params.roomCode);
    await tx.execute(sql`select id from ${watchRooms} where ${watchRooms.roomCode} = ${code} for update`);
    const [room] = await tx.select().from(watchRooms).where(eq(watchRooms.roomCode, code)).limit(1);
    if (!room || room.status === 'ended') return null;
    const [existing] = await tx.select().from(roomMembers).where(and(
      eq(roomMembers.roomId, room.id), eq(roomMembers.userId, params.userId)
    )).limit(1);
    if (existing?.isBanned) throw new Error('ROOM_BANNED');
    if (room.isLocked && !existing && room.hostUserId !== params.userId) throw new Error('ROOM_LOCKED');
    const [{ count }] = await tx.select({ count: sql<number>`count(*)::int` }).from(roomMembers).where(and(
      eq(roomMembers.roomId, room.id), eq(roomMembers.isOnline, true)
    ));
    if (!existing && count >= room.maxParticipants) throw new Error('ROOM_FULL');

    const role = room.hostUserId === params.userId ? 'host' : (existing?.role === 'moderator' ? 'moderator' : params.role);
    const [member] = await tx
      .insert(roomMembers)
      .values({
        roomId: room.id,
        userId: params.userId,
        displayName: params.displayName,
        role,
        isOnline: true,
        joinedAt: new Date(),
        leftAt: null,
        isBanned: false,
      })
      .onConflictDoUpdate({
        target: [roomMembers.roomId, roomMembers.userId],
        set: { displayName: params.displayName, role, isOnline: true, leftAt: null },
      })
      .returning();
    return member;
  });
}

export async function leaveRoomInDb(roomCode: string, userId: string) {
  const room = await getWatchRoomByCode(roomCode);
  if (!room) return;
  await db
    .update(roomMembers)
    .set({ isOnline: false, leftAt: new Date() })
    .where(and(eq(roomMembers.roomId, room.id), eq(roomMembers.userId, userId)));
}

export async function removeRoomMember(roomCode: string, userId: string) {
  const room = await getWatchRoomByCode(roomCode);
  if (!room) return;
  await db
    .update(roomMembers)
    .set({ isOnline: false, leftAt: new Date(), isBanned: true })
    .where(and(eq(roomMembers.roomId, room.id), eq(roomMembers.userId, userId)));
}

export async function recordChatMessageInDb(params: {
  roomCode: string;
  senderId: string;
  senderName: string;
  content: string;
  messageType?: string;
  videoTimestampSeconds?: number;
}) {
  const room = await getWatchRoomByCode(params.roomCode);
  if (!room) throw new Error('ROOM_NOT_FOUND');
  const [message] = await db
    .insert(chatMessages)
    .values({
      roomId: room.id,
      senderId: params.senderId,
      senderName: params.senderName,
      content: params.content,
      messageType: params.messageType || 'chat',
      videoTimestampSeconds: Math.max(0, Math.round(params.videoTimestampSeconds || 0)),
    })
    .returning();
  return message;
}

export async function recordReactionInDb(params: {
  roomCode: string;
  userId: string;
  userName: string;
  emoji: string;
}) {
  const room = await getWatchRoomByCode(params.roomCode);
  if (!room) throw new Error('ROOM_NOT_FOUND');
  const [reaction] = await db
    .insert(roomReactions)
    .values({ roomId: room.id, userId: params.userId, userName: params.userName, emoji: params.emoji })
    .returning();
  return reaction;
}

export async function toggleRoomVoteInDb(params: {
  roomCode: string;
  mediaId: string;
  mediaTitle: string;
  voterId: string;
  voterName: string;
}) {
  const room = await getWatchRoomByCode(params.roomCode);
  if (!room) throw new Error('ROOM_NOT_FOUND');
  return db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: roomVotes.id })
      .from(roomVotes)
      .where(and(
        eq(roomVotes.roomId, room.id),
        eq(roomVotes.mediaId, params.mediaId),
        eq(roomVotes.voterId, params.voterId)
      ))
      .limit(1);
    if (existing[0]) {
      await tx.delete(roomVotes).where(eq(roomVotes.id, existing[0].id));
      return false;
    }
    await tx.insert(roomVotes).values({
      roomId: room.id,
      mediaId: params.mediaId,
      mediaTitle: params.mediaTitle,
      voterId: params.voterId,
      voterName: params.voterName,
    });
    return true;
  });
}

export async function updatePlaybackStateInDb(params: {
  roomCode: string;
  mediaId: string;
  mediaType?: string;
  status: 'playing' | 'paused';
  positionSeconds: number;
  playbackRate: number;
  hostId: string;
  revision: number;
  season?: number;
  episode?: number;
}) {
  const room = await getWatchRoomByCode(params.roomCode);
  if (!room) throw new Error('ROOM_NOT_FOUND');
  const now = new Date();
  return db.transaction(async (tx) => {
    await tx.execute(sql`select id from ${watchRooms} where id = ${room.id} for update`);
    const [current] = await tx
      .select()
      .from(playbackStates)
      .where(eq(playbackStates.roomId, room.id))
      .limit(1);
    if (current && params.revision <= current.revision) return current;

    await tx
      .update(watchRooms)
      .set({
        currentMediaId: params.mediaId,
        currentMediaType: params.mediaType || room.currentMediaType,
        currentSeason: params.season || room.currentSeason,
        currentEpisode: params.episode || room.currentEpisode,
        status: params.status,
      })
      .where(eq(watchRooms.id, room.id));

    const [updated] = await tx
      .insert(playbackStates)
      .values({
        roomId: room.id,
        mediaId: params.mediaId,
        mediaType: params.mediaType || room.currentMediaType,
        status: params.status,
        positionSeconds: Math.max(0, params.positionSeconds),
        playbackRate: Math.min(2, Math.max(0.5, params.playbackRate)),
        hostId: params.hostId,
        revision: params.revision,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: playbackStates.roomId,
        set: {
          mediaId: params.mediaId,
          mediaType: params.mediaType || room.currentMediaType,
          status: params.status,
          positionSeconds: Math.max(0, params.positionSeconds),
          playbackRate: Math.min(2, Math.max(0.5, params.playbackRate)),
          hostId: params.hostId,
          revision: params.revision,
          updatedAt: now,
        },
      })
      .returning();
    return updated;
  });
}

export async function updateRoomSettings(params: {
  roomCode: string;
  collaborativeControls?: boolean;
  isLocked?: boolean;
  roomTheme?: string;
  lifecycleState?: string;
  couplePartnerNote?: string;
  hostUserId?: string;
}) {
  const room = await getWatchRoomByCode(params.roomCode);
  if (!room) throw new Error('ROOM_NOT_FOUND');
  const set: Partial<typeof watchRooms.$inferInsert> = {};
  if (params.collaborativeControls !== undefined) set.collaborativeControls = params.collaborativeControls;
  if (params.isLocked !== undefined) set.isLocked = params.isLocked;
  if (params.roomTheme !== undefined) set.roomTheme = params.roomTheme;
  if (params.lifecycleState !== undefined) set.status = params.lifecycleState;
  if (params.couplePartnerNote !== undefined) set.couplePartnerNote = params.couplePartnerNote;
  if (params.hostUserId !== undefined) set.hostUserId = params.hostUserId;
  const [updated] = await db.update(watchRooms).set(set).where(eq(watchRooms.id, room.id)).returning();
  return updated;
}

export async function transferRoomHost(roomCode: string, nextHostUserId: string) {
  const room = await getWatchRoomByCode(roomCode);
  if (!room) throw new Error('ROOM_NOT_FOUND');
  return db.transaction(async (tx) => {
    const [member] = await tx.select().from(roomMembers).where(and(
      eq(roomMembers.roomId, room.id), eq(roomMembers.userId, nextHostUserId), eq(roomMembers.isOnline, true), eq(roomMembers.isBanned, false)
    )).limit(1);
    if (!member) throw new Error('ROOM_MEMBER_NOT_FOUND');
    await tx.update(roomMembers).set({ role: 'member' }).where(and(eq(roomMembers.roomId, room.id), eq(roomMembers.userId, room.hostUserId)));
    await tx.update(roomMembers).set({ role: 'host' }).where(and(eq(roomMembers.roomId, room.id), eq(roomMembers.userId, nextHostUserId)));
    const [updated] = await tx.update(watchRooms).set({ hostUserId: nextHostUserId }).where(eq(watchRooms.id, room.id)).returning();
    return updated;
  });
}

export async function getUserWatchlistItems(userId: string) {
  return db
    .select()
    .from(watchlistItems)
    .where(eq(watchlistItems.userId, userId))
    .orderBy(desc(watchlistItems.addedAt));
}

export async function addUserWatchlistItem(params: {
  userId: string;
  mediaId: string;
  mediaTitle: string;
  mediaType: string;
  posterUrl: string;
  year: string;
  rating: number;
}) {
  return db.transaction(async (tx) => {
    const [list] = await tx
      .insert(watchlists)
      .values({ userId: params.userId, name: 'My Watchlist', isShared: false })
      .onConflictDoNothing({ target: watchlists.userId })
      .returning();
    const [existingList] = list ? [list] : await tx.select().from(watchlists).where(eq(watchlists.userId, params.userId)).limit(1);
    const [item] = await tx
      .insert(watchlistItems)
      .values({
        watchlistId: existingList.id,
        userId: params.userId,
        mediaId: params.mediaId,
        mediaTitle: params.mediaTitle,
        mediaType: params.mediaType,
        posterUrl: params.posterUrl,
        year: params.year,
        rating: params.rating,
      })
      .onConflictDoUpdate({
        target: [watchlistItems.userId, watchlistItems.mediaId],
        set: {
          mediaTitle: params.mediaTitle,
          mediaType: params.mediaType,
          posterUrl: params.posterUrl,
          year: params.year,
          rating: params.rating,
        },
      })
      .returning();
    return item;
  });
}

export async function removeUserWatchlistItem(userId: string, mediaId: string): Promise<boolean> {
  const removed = await db
    .delete(watchlistItems)
    .where(and(eq(watchlistItems.userId, userId), eq(watchlistItems.mediaId, mediaId)))
    .returning({ id: watchlistItems.id });
  return removed.length > 0;
}

export async function toggleUserWatchlistItem(params: {
  userId: string;
  mediaId: string;
  mediaTitle: string;
  mediaType: string;
  posterUrl: string;
  year: string;
  rating: number;
}) {
  const existing = await db
    .select({ id: watchlistItems.id })
    .from(watchlistItems)
    .where(and(eq(watchlistItems.userId, params.userId), eq(watchlistItems.mediaId, params.mediaId)))
    .limit(1);
  if (existing[0]) {
    await removeUserWatchlistItem(params.userId, params.mediaId);
    return { added: false };
  }
  const item = await addUserWatchlistItem(params);
  return { added: true, item };
}

export async function getProfileByUid(uid: string) {
  const [profile] = await db.select().from(profiles).where(eq(profiles.uid, uid)).limit(1);
  return profile || null;
}

export async function updateProfilePreferences(params: {
  uid: string;
  email: string;
  displayName: string;
  avatarUrl?: string;
  preferredTheme: string;
  preferences?: Record<string, unknown>;
}) {
  const [profile] = await db
    .insert(profiles)
    .values({
      uid: params.uid,
      email: params.email,
      displayName: params.displayName,
      avatarUrl: params.avatarUrl || null,
      preferredTheme: params.preferredTheme,
      preferences: params.preferences || {},
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: profiles.uid,
      set: {
        displayName: params.displayName,
        avatarUrl: params.avatarUrl || null,
        preferredTheme: params.preferredTheme,
        ...(params.preferences ? { preferences: params.preferences } : {}),
        updatedAt: new Date(),
      },
    })
    .returning();
  return profile;
}

export async function getWatchHistory(userId: string, limit = 100) {
  return db
    .select()
    .from(watchSessions)
    .where(eq(watchSessions.userId, userId))
    .orderBy(desc(watchSessions.lastWatchedAt))
    .limit(Math.min(100, Math.max(1, limit)));
}

export async function createWatchHistorySession(params: {
  userId: string;
  mediaId: string;
  mediaTitle: string;
  mediaType: string;
  roomType: string;
  progressSeconds: number;
  durationSeconds: number;
}) {
  const now = new Date();
  const [session] = await db
    .insert(watchSessions)
    .values({
      userId: params.userId,
      mediaId: params.mediaId,
      mediaTitle: params.mediaTitle,
      mediaType: params.mediaType,
      roomType: params.roomType,
      progressSeconds: Math.round(params.progressSeconds),
      durationSeconds: Math.round(params.durationSeconds),
      startedAt: now,
      lastWatchedAt: now,
      updatedAt: now,
    })
    .returning();
  return session;
}

export async function updateWatchHistoryProgress(params: {
  sessionId: string;
  userId: string;
  progressSeconds: number;
  durationSeconds: number;
  ended?: boolean;
}) {
  const now = new Date();
  const [session] = await db
    .update(watchSessions)
    .set({
      progressSeconds: Math.max(0, Math.round(params.progressSeconds)),
      durationSeconds: Math.max(1, Math.round(params.durationSeconds)),
      lastWatchedAt: now,
      updatedAt: now,
      endedAt: params.ended ? now : null,
    })
    .where(and(eq(watchSessions.id, params.sessionId), eq(watchSessions.userId, params.userId)))
    .returning();
  return session || null;
}
