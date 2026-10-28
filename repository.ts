import crypto from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
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

export function hashPassword(plain?: string): string | null {
  if (!plain || !plain.trim()) return null;
  return crypto.createHash('sha256').update(`cinetogether::${plain.trim()}`).digest('hex');
}

export async function seedCatalogAndDefaultRooms(): Promise<void> {
  try {
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
          posterUrl: `/poster/${item.id}`,
          backdropUrl: `/backdrop/${item.id}`,
          seasons: item.seasons || 1,
          episodes: item.episodes || 1,
        })
        .onConflictDoUpdate({
          target: mediaItems.id,
          set: {
            title: item.title,
            rating: item.rating,
            overview: item.description,
          },
        });
    }

    // Ensure default Couple Room LOVE-2026 and Group Room CLUB-4096 exist
    const defaultRooms = [
      {
        roomCode: 'LOVE-2026',
        roomType: 'couple',
        title: 'Kyoto Rain & Rose Nebula Date Night',
        description: 'Private Couple Cinema for two with synchronized playback and floating heart reactions.',
        hostUserId: 'host-aria',
        currentMediaId: 'nx-204988',
        currentMediaType: 'tv',
        maxParticipants: 2,
        collaborativeControls: true,
        roomTheme: 'rose-nebula',
        status: 'playing',
      },
      {
        roomCode: 'CLUB-4096',
        roomType: 'group',
        title: 'Friday Sci-Fi & Spider-Verse Premiere Lounge',
        description: 'Open Group Cinema room with live movie voting, reactions, and optional voice chat.',
        hostUserId: 'host-marcus',
        currentMediaId: 'nx-969681',
        currentMediaType: 'movie',
        maxParticipants: 12,
        collaborativeControls: false,
        roomTheme: 'midnight-violet',
        status: 'playing',
      },
    ];

    for (const r of defaultRooms) {
      const existing = await db
        .select()
        .from(watchRooms)
        .where(eq(watchRooms.roomCode, r.roomCode))
        .limit(1);

      if (existing.length === 0) {
        const [createdRoom] = await db
          .insert(watchRooms)
          .values({
            roomCode: r.roomCode,
            roomType: r.roomType,
            title: r.title,
            description: r.description,
            hostUserId: r.hostUserId,
            currentMediaId: r.currentMediaId,
            currentMediaType: r.currentMediaType,
            currentSeason: 1,
            currentEpisode: 1,
            isPrivate: r.roomType === 'couple',
            maxParticipants: r.maxParticipants,
            collaborativeControls: r.collaborativeControls,
            roomTheme: r.roomTheme,
            status: r.status,
          })
          .returning();

        if (createdRoom) {
          await db.insert(playbackStates).values({
            roomId: createdRoom.id,
            mediaId: r.currentMediaId,
            mediaType: r.currentMediaType,
            status: 'playing',
            positionSeconds: r.roomType === 'couple' ? 142 : 310,
            playbackRate: 1,
            hostId: r.hostUserId,
            revision: 1,
          });
        }
      }
    }
  } catch (error) {
    console.error('Database Error in seedCatalogAndDefaultRooms:', error);
  }
}

export async function listActiveWatchRooms() {
  try {
    const rooms = await db.select().from(watchRooms).orderBy(desc(watchRooms.createdAt)).limit(25);
    return rooms;
  } catch (error) {
    console.error('Database Error in listActiveWatchRooms:', error);
    throw error;
  }
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
  try {
    const code = params.roomCode.trim().toUpperCase();
    const pwdHash = hashPassword(params.password);
    const maxCap = params.roomType === 'couple' ? 2 : Math.max(3, Math.min(20, params.maxParticipants || 10));

    const [room] = await db
      .insert(watchRooms)
      .values({
        roomCode: code,
        roomType: params.roomType,
        title: params.title.trim() || `${params.hostDisplayName}'s Cinema`,
        description: params.description?.trim() || '',
        hostUserId: params.hostUserId,
        currentMediaId: params.currentMediaId,
        currentMediaType: params.currentMediaType || 'movie',
        currentSeason: 1,
        currentEpisode: 1,
        isPrivate: params.roomType === 'couple' || Boolean(pwdHash),
        passwordHash: pwdHash,
        maxParticipants: maxCap,
        collaborativeControls:
          params.collaborativeControls ?? (params.roomType === 'couple' ? true : false),
        roomTheme:
          params.roomTheme || (params.roomType === 'couple' ? 'rose-nebula' : 'midnight-violet'),
        status: 'waiting',
      })
      .onConflictDoUpdate({
        target: watchRooms.roomCode,
        set: {
          title: params.title.trim() || `${params.hostDisplayName}'s Cinema`,
          currentMediaId: params.currentMediaId,
          roomTheme:
            params.roomTheme || (params.roomType === 'couple' ? 'rose-nebula' : 'midnight-violet'),
        },
      })
      .returning();

    if (room) {
      await db
        .insert(playbackStates)
        .values({
          roomId: room.id,
          mediaId: params.currentMediaId,
          mediaType: params.currentMediaType || 'movie',
          status: 'paused',
          positionSeconds: 0,
          playbackRate: 1,
          hostId: params.hostUserId,
          revision: 1,
        })
        .onConflictDoNothing();

      await db.insert(roomMembers).values({
        roomId: room.id,
        userId: params.hostUserId,
        displayName: params.hostDisplayName,
        role: 'host',
        isOnline: true,
      });
    }

    return room;
  } catch (error) {
    console.error('Database Error in createWatchRoomInDb:', error);
    throw error;
  }
}

export async function getWatchRoomByCode(roomCode: string) {
  try {
    const cleanCode = roomCode.trim().toUpperCase();
    const [room] = await db
      .select()
      .from(watchRooms)
      .where(eq(watchRooms.roomCode, cleanCode))
      .limit(1);
    return room || null;
  } catch (error) {
    console.error('Database Error in getWatchRoomByCode:', error);
    throw error;
  }
}

export async function recordChatMessageInDb(params: {
  roomCode: string;
  senderId: string;
  senderName: string;
  content: string;
  messageType?: string;
  videoTimestampSeconds?: number;
}) {
  try {
    const room = await getWatchRoomByCode(params.roomCode);
    if (!room) return null;
    const [msg] = await db
      .insert(chatMessages)
      .values({
        roomId: room.id,
        senderId: params.senderId,
        senderName: params.senderName,
        content: params.content,
        messageType: params.messageType || 'chat',
        videoTimestampSeconds: Math.round(params.videoTimestampSeconds || 0),
      })
      .returning();
    return msg;
  } catch (error) {
    console.error('Database Error in recordChatMessageInDb:', error);
    return null;
  }
}

export async function recordReactionInDb(params: {
  roomCode: string;
  userId: string;
  userName: string;
  emoji: string;
}) {
  try {
    const room = await getWatchRoomByCode(params.roomCode);
    if (!room) return null;
    const [reaction] = await db
      .insert(roomReactions)
      .values({
        roomId: room.id,
        userId: params.userId,
        userName: params.userName,
        emoji: params.emoji,
      })
      .returning();
    return reaction;
  } catch (error) {
    console.error('Database Error in recordReactionInDb:', error);
    return null;
  }
}

export async function recordRoomVoteInDb(params: {
  roomCode: string;
  mediaId: string;
  mediaTitle: string;
  voterId: string;
  voterName: string;
}) {
  try {
    const room = await getWatchRoomByCode(params.roomCode);
    if (!room) return null;
    const [vote] = await db
      .insert(roomVotes)
      .values({
        roomId: room.id,
        mediaId: params.mediaId,
        mediaTitle: params.mediaTitle,
        voterId: params.voterId,
        voterName: params.voterName,
      })
      .returning();
    return vote;
  } catch (error) {
    console.error('Database Error in recordRoomVoteInDb:', error);
    return null;
  }
}

export async function updatePlaybackStateInDb(params: {
  roomCode: string;
  mediaId: string;
  status: 'playing' | 'paused';
  positionSeconds: number;
  playbackRate: number;
  hostId: string;
  revision: number;
}) {
  try {
    const room = await getWatchRoomByCode(params.roomCode);
    if (!room) return null;
    await db
      .update(watchRooms)
      .set({
        currentMediaId: params.mediaId,
        status: params.status,
      })
      .where(eq(watchRooms.id, room.id));

    const [updated] = await db
      .insert(playbackStates)
      .values({
        roomId: room.id,
        mediaId: params.mediaId,
        status: params.status,
        positionSeconds: params.positionSeconds,
        playbackRate: params.playbackRate,
        hostId: params.hostId,
        revision: params.revision,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: playbackStates.roomId,
        set: {
          mediaId: params.mediaId,
          status: params.status,
          positionSeconds: params.positionSeconds,
          playbackRate: params.playbackRate,
          hostId: params.hostId,
          revision: params.revision,
          updatedAt: new Date(),
        },
      })
      .returning();
    return updated;
  } catch (error) {
    console.error('Database Error in updatePlaybackStateInDb:', error);
    return null;
  }
}

export async function getUserWatchlistItems(userId: string) {
  try {
    const items = await db
      .select()
      .from(watchlistItems)
      .where(eq(watchlistItems.userId, userId))
      .orderBy(desc(watchlistItems.addedAt));
    return items;
  } catch (error) {
    console.error('Database Error in getUserWatchlistItems:', error);
    throw error;
  }
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
  try {
    const existing = await db
      .select()
      .from(watchlistItems)
      .where(
        and(
          eq(watchlistItems.userId, params.userId),
          eq(watchlistItems.mediaId, params.mediaId)
        )
      )
      .limit(1);

    if (existing.length > 0) {
      await db.delete(watchlistItems).where(eq(watchlistItems.id, existing[0].id));
      return { added: false, item: existing[0] };
    }

    let [userList] = await db
      .select()
      .from(watchlists)
      .where(eq(watchlists.userId, params.userId))
      .limit(1);

    if (!userList) {
      [userList] = await db
        .insert(watchlists)
        .values({
          userId: params.userId,
          name: 'My Watchlist',
          isShared: false,
        })
        .returning();
    }

    const [inserted] = await db
      .insert(watchlistItems)
      .values({
        watchlistId: userList?.id || null,
        userId: params.userId,
        mediaId: params.mediaId,
        mediaTitle: params.mediaTitle,
        mediaType: params.mediaType,
        posterUrl: params.posterUrl,
        year: params.year,
        rating: params.rating,
      })
      .returning();

    return { added: true, item: inserted };
  } catch (error) {
    console.error('Database Error in toggleUserWatchlistItem:', error);
    throw error;
  }
}

export async function updateProfilePreferences(params: {
  uid: string;
  email: string;
  displayName: string;
  preferredTheme: string;
}) {
  try {
    const [updated] = await db
      .insert(profiles)
      .values({
        uid: params.uid,
        email: params.email,
        displayName: params.displayName,
        preferredTheme: params.preferredTheme,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: profiles.uid,
        set: {
          displayName: params.displayName,
          preferredTheme: params.preferredTheme,
          updatedAt: new Date(),
        },
      })
      .returning();
    return updated;
  } catch (error) {
    console.error('Database Error in updateProfilePreferences:', error);
    throw error;
  }
}

export async function recordWatchSessionInDb(params: {
  userId: string;
  mediaId: string;
  mediaTitle: string;
  mediaType: string;
  roomType: string;
  progressSeconds: number;
  durationSeconds: number;
}) {
  try {
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
      })
      .returning();
    return session;
  } catch (error) {
    console.error('Database Error in recordWatchSessionInDb:', error);
    throw error;
  }
}
