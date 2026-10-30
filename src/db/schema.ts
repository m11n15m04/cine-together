import { relations } from 'drizzle-orm';
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// 1. profiles (linked to Firebase Auth UID)
export const profiles = pgTable(
  'profiles',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    uid: text('uid').notNull().unique(),
    email: text('email').notNull(),
    displayName: text('display_name').notNull(),
    avatarUrl: text('avatar_url'),
    preferredTheme: text('preferred_theme').default('midnight-violet').notNull(),
    preferences: jsonb('preferences').$type<Record<string, unknown>>().default({}).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [index('profiles_uid_idx').on(table.uid)]
);

// 2. media_items
export const mediaItems = pgTable(
  'media_items',
  {
    id: text('id').primaryKey(),
    tmdbId: integer('tmdb_id').notNull(),
    mediaType: text('media_type').notNull(), // 'movie' | 'tv' | 'anime'
    title: text('title').notNull(),
    year: text('year').notNull(),
    rating: doublePrecision('rating').notNull(),
    durationMinutes: integer('duration_minutes').notNull(),
    genres: text('genres').notNull(), // JSON array string
    language: text('language').default('English').notNull(),
    overview: text('overview').notNull(),
    posterUrl: text('poster_url').notNull(),
    backdropUrl: text('backdrop_url').notNull(),
    seasons: integer('seasons').default(1),
    episodes: integer('episodes').default(1),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('media_items_type_idx').on(table.mediaType)]
);

// 3. watch_rooms
export const watchRooms = pgTable(
  'watch_rooms',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    roomCode: text('room_code').notNull().unique(),
    roomType: text('room_type').notNull(), // 'couple' | 'group'
    title: text('title').notNull(),
    description: text('description').default('').notNull(),
    hostUserId: text('host_user_id').notNull(),
    currentMediaId: text('current_media_id').notNull(),
    currentMediaType: text('current_media_type').default('movie').notNull(),
    currentSeason: integer('current_season').default(1).notNull(),
    currentEpisode: integer('current_episode').default(1).notNull(),
    isPrivate: boolean('is_private').default(true).notNull(),
    passwordHash: text('password_hash'),
    maxParticipants: integer('max_participants').default(2).notNull(),
    collaborativeControls: boolean('collaborative_controls').default(false).notNull(),
    isLocked: boolean('is_locked').default(false).notNull(),
    roomTheme: text('room_theme').default('rose-nebula').notNull(),
    couplePartnerNote: text('couple_partner_note').default('').notNull(),
    status: text('status').default('waiting').notNull(), // waiting | joined | selecting | ready | playing | paused | ended
    createdAt: timestamp('created_at').defaultNow().notNull(),
    expiresAt: timestamp('expires_at'),
  },
  (table) => [
    index('watch_rooms_code_idx').on(table.roomCode),
    index('watch_rooms_host_idx').on(table.hostUserId),
  ]
);

// 4. watchlists
export const watchlists = pgTable(
  'watchlists',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id').notNull(),
    name: text('name').default('My Watchlist').notNull(),
    roomId: uuid('room_id').references(() => watchRooms.id, { onDelete: 'cascade' }),
    isShared: boolean('is_shared').default(false).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [uniqueIndex('watchlists_user_unique').on(table.userId)]
);

// 5. watchlist_items
export const watchlistItems = pgTable(
  'watchlist_items',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    watchlistId: uuid('watchlist_id').references(() => watchlists.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    mediaId: text('media_id').notNull(),
    mediaTitle: text('media_title').notNull(),
    mediaType: text('media_type').notNull(),
    posterUrl: text('poster_url').notNull(),
    year: text('year').notNull(),
    rating: doublePrecision('rating').default(8.0).notNull(),
    addedAt: timestamp('added_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('watchlist_items_user_media_unique').on(table.userId, table.mediaId),
    index('watchlist_items_user_idx').on(table.userId),
    index('watchlist_items_media_idx').on(table.mediaId),
  ]
);

// 6. room_members
export const roomMembers = pgTable(
  'room_members',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    roomId: uuid('room_id')
      .references(() => watchRooms.id, { onDelete: 'cascade' })
      .notNull(),
    userId: text('user_id').notNull(),
    displayName: text('display_name').notNull(),
    avatarColor: text('avatar_color').default('#8b5cf6').notNull(),
    role: text('role').default('member').notNull(), // 'host' | 'moderator' | 'partner' | 'member'
    isOnline: boolean('is_online').default(true).notNull(),
    joinedAt: timestamp('joined_at').defaultNow().notNull(),
    leftAt: timestamp('left_at'),
    isBanned: boolean('is_banned').default(false).notNull(),
  },
  (table) => [
    uniqueIndex('room_members_room_user_unique').on(table.roomId, table.userId),
    index('room_members_room_idx').on(table.roomId),
    index('room_members_user_idx').on(table.userId),
  ]
);

// 7. playback_states
export const playbackStates = pgTable(
  'playback_states',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    roomId: uuid('room_id')
      .references(() => watchRooms.id, { onDelete: 'cascade' })
      .notNull()
      .unique(),
    mediaId: text('media_id').notNull(),
    mediaType: text('media_type').default('movie').notNull(),
    status: text('status').default('paused').notNull(), // 'playing' | 'paused'
    positionSeconds: doublePrecision('position_seconds').default(0).notNull(),
    playbackRate: doublePrecision('playback_rate').default(1).notNull(),
    hostId: text('host_id').notNull(),
    revision: integer('revision').default(1).notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [index('playback_states_room_idx').on(table.roomId)]
);

// 8. chat_messages
export const chatMessages = pgTable(
  'chat_messages',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    roomId: uuid('room_id')
      .references(() => watchRooms.id, { onDelete: 'cascade' })
      .notNull(),
    senderId: text('sender_id').notNull(),
    senderName: text('sender_name').notNull(),
    content: text('content').notNull(),
    messageType: text('message_type').default('chat').notNull(), // 'chat' | 'system' | 'reaction'
    videoTimestampSeconds: integer('video_timestamp_seconds').default(0).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('chat_messages_room_created_idx').on(table.roomId, table.createdAt)]
);

// 9. room_reactions
export const roomReactions = pgTable(
  'room_reactions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    roomId: uuid('room_id')
      .references(() => watchRooms.id, { onDelete: 'cascade' })
      .notNull(),
    userId: text('user_id').notNull(),
    userName: text('user_name').notNull(),
    emoji: text('emoji').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('room_reactions_room_idx').on(table.roomId)]
);

// 10. room_votes
export const roomVotes = pgTable(
  'room_votes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    roomId: uuid('room_id')
      .references(() => watchRooms.id, { onDelete: 'cascade' })
      .notNull(),
    mediaId: text('media_id').notNull(),
    mediaTitle: text('media_title').notNull(),
    voterId: text('voter_id').notNull(),
    voterName: text('voter_name').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('room_votes_room_media_voter_unique').on(table.roomId, table.mediaId, table.voterId),
    index('room_votes_room_idx').on(table.roomId),
  ]
);

// 11. watch_sessions
export const watchSessions = pgTable(
  'watch_sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id').notNull(),
    roomId: uuid('room_id').references(() => watchRooms.id, { onDelete: 'set null' }),
    mediaId: text('media_id').notNull(),
    mediaTitle: text('media_title').notNull(),
    mediaType: text('media_type').default('movie').notNull(),
    roomType: text('room_type').default('solo').notNull(),
    progressSeconds: integer('progress_seconds').default(0).notNull(),
    durationSeconds: integer('duration_seconds').default(7200).notNull(),
    startedAt: timestamp('started_at').defaultNow().notNull(),
    lastWatchedAt: timestamp('last_watched_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
    endedAt: timestamp('ended_at'),
  },
  (table) => [index('watch_sessions_user_last_watched_idx').on(table.userId, table.lastWatchedAt)]
);

// Relations
export const watchRoomsRelations = relations(watchRooms, ({ many, one }) => ({
  members: many(roomMembers),
  messages: many(chatMessages),
  reactions: many(roomReactions),
  votes: many(roomVotes),
  playbackState: one(playbackStates, {
    fields: [watchRooms.id],
    references: [playbackStates.roomId],
  }),
}));

export const roomMembersRelations = relations(roomMembers, ({ one }) => ({
  room: one(watchRooms, {
    fields: [roomMembers.roomId],
    references: [watchRooms.id],
  }),
}));

export const chatMessagesRelations = relations(chatMessages, ({ one }) => ({
  room: one(watchRooms, {
    fields: [chatMessages.roomId],
    references: [watchRooms.id],
  }),
}));
