import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
const testDatabaseWritesAllowed = process.env.CINETEST_DATABASE_ALLOW_WRITE === 'true';
function isDisposableDatabase(url: string | undefined): boolean {
  try { return Boolean(url && /(?:^|[_-])test(?:[_-]|$)/i.test(new URL(url).pathname)); }
  catch { return false; }
}
const safeTestDatabase = Boolean(
  testDatabaseUrl && testDatabaseWritesAllowed && isDisposableDatabase(testDatabaseUrl)
  && (testDatabaseUrl !== process.env.DATABASE_URL || process.env.NODE_ENV === 'test')
);

test('PostgreSQL watchlist, profile, history, room, and chat persistence', {
  skip: safeTestDatabase ? false : 'Set TEST_DATABASE_URL to a dedicated disposable database and CINETEST_DATABASE_ALLOW_WRITE=true.',
}, async () => {
  process.env.DATABASE_URL = testDatabaseUrl!;
  delete process.env.POSTGRES_URL;
  delete process.env.SQL_HOST;
  delete process.env.SQL_DB_NAME;
  delete process.env.SQL_USER;
  delete process.env.SQL_PASSWORD;

  const [{ db, checkDatabaseConnection, closeDatabaseConnection }, repository, schema] = await Promise.all([
    import('./index.ts'),
    import('./repository.ts'),
    import('./schema.ts'),
  ]);
  const uid = `cinetogether-test-${crypto.randomUUID()}`;
  const hostId = `test-host-${crypto.randomUUID()}`;
  const roomCode = `TST-${crypto.randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`;
  const privateRoomCode = `PRV-${crypto.randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`;
  const cacheKey = `test-nxsha-cache-${crypto.randomUUID()}`;
  let historyId: string | undefined;
  let roomId: string | undefined;
  let privateRoomId: string | undefined;
  try {
    assert.equal((await checkDatabaseConnection()).available, true);

    const cacheNow = new Date();
    await repository.putNxshaCatalogCache(cacheKey, { providerId: 'nxsha-provider-id' }, 1_000, cacheNow);
    assert.deepEqual(await repository.getNxshaCatalogCache(cacheKey, new Date(cacheNow.getTime() + 500)), {
      providerId: 'nxsha-provider-id',
    });
    assert.equal(await repository.getNxshaCatalogCache(cacheKey, new Date(cacheNow.getTime() + 1_000)), null);
    await repository.putNxshaCatalogCache(cacheKey, { providerId: 'refreshed-provider-id' }, 2_000, cacheNow);
    assert.deepEqual(await repository.getNxshaCatalogCache(cacheKey, new Date(cacheNow.getTime() + 1_500)), {
      providerId: 'refreshed-provider-id',
    });
    assert.ok((await repository.deleteExpiredNxshaCatalogCache(new Date(cacheNow.getTime() + 2_000))) >= 1);

    const watchlistItem = await repository.addUserWatchlistItem({
      userId: uid, mediaId: 'test-film', mediaTitle: 'Test Film', mediaType: 'movie', posterUrl: '', year: '2026', rating: 7.5,
    });
    assert.equal(watchlistItem.mediaId, 'test-film');
    await repository.addUserWatchlistItem({
      userId: uid, mediaId: 'test-film', mediaTitle: 'Updated Test Film', mediaType: 'movie', posterUrl: '', year: '2026', rating: 8,
    });
    assert.equal((await repository.getUserWatchlistItems(uid)).length, 1);
    assert.equal(await repository.removeUserWatchlistItem(uid, 'test-film'), true);
    assert.equal(await repository.removeUserWatchlistItem(uid, 'test-film'), false);

    const profile = await repository.updateProfilePreferences({
      uid, email: 'test@example.invalid', displayName: 'Test Member', preferredTheme: 'midnight-violet', preferences: { captions: true },
    });
    assert.equal((await repository.getProfileByUid(uid))?.preferences?.captions, true);
    assert.equal(profile.uid, uid);

    const history = await repository.createWatchHistorySession({
      userId: uid, mediaId: 'test-film', mediaTitle: 'Test Film', mediaType: 'movie', roomType: 'solo', progressSeconds: 10, durationSeconds: 100,
    });
    historyId = history.id;
    assert.equal((await repository.updateWatchHistoryProgress({
      sessionId: history.id, userId: `${uid}-other`, progressSeconds: 20, durationSeconds: 100,
    })), null);
    assert.equal((await repository.updateWatchHistoryProgress({
      sessionId: history.id, userId: uid, progressSeconds: 45, durationSeconds: 100,
    }))?.progressSeconds, 45);
    assert.equal((await repository.getWatchHistory(uid)).some((entry) => entry.id === history.id), true);

    const room = await repository.createWatchRoomInDb({
      roomCode, roomType: 'group', title: 'Persistence Test', hostUserId: hostId, hostDisplayName: 'Test Host',
      currentMediaId: 'test-film', currentMediaType: 'movie', maxParticipants: 3,
    });
    roomId = room.id;
    const guestId = `${uid}-member`;
    await repository.joinRoomInDb({ roomCode, userId: guestId, displayName: 'Test Guest', role: 'member' });
    await repository.joinRoomInDb({ roomCode, userId: guestId, displayName: 'Test Guest Reconnected', role: 'member' });
    const privateRoom = await repository.createWatchRoomInDb({
      roomCode: privateRoomCode, roomType: 'couple', title: 'Private Test Room', hostUserId: `${hostId}-private`,
      hostDisplayName: 'Private Host', currentMediaId: 'test-film', currentMediaType: 'movie',
    });
    privateRoomId = privateRoom.id;
    const activeRooms = await repository.listActiveWatchRooms();
    assert.equal(activeRooms.find((entry) => entry.id === roomId)?.memberCount, 2);
    assert.equal(activeRooms.some((entry) => entry.id === privateRoomId || entry.roomCode === privateRoomCode), false);
    await repository.leaveRoomInDb(roomCode, guestId);
    assert.equal((await repository.listActiveWatchRooms()).find((entry) => entry.id === roomId)?.memberCount, 1);
    await repository.joinRoomInDb({ roomCode, userId: guestId, displayName: 'Test Guest Reconnected', role: 'member' });
    assert.equal((await repository.listActiveWatchRooms()).find((entry) => entry.id === roomId)?.memberCount, 2);
    await repository.updatePlaybackStateInDb({
      roomCode, mediaId: 'test-film', status: 'playing', positionSeconds: 42, playbackRate: 1, hostId, revision: 2,
    });
    const stale = await repository.updatePlaybackStateInDb({
      roomCode, mediaId: 'test-film', status: 'paused', positionSeconds: 3, playbackRate: 1, hostId, revision: 1,
    });
    assert.equal(stale.revision, 2);
    await repository.recordChatMessageInDb({ roomCode, senderId: hostId, senderName: 'Test Host', content: 'Persisted message' });
    assert.equal(await repository.toggleRoomVoteInDb({ roomCode, mediaId: 'test-film', mediaTitle: 'Test Film', voterId: uid, voterName: 'Test Member' }), true);
    assert.equal(await repository.toggleRoomVoteInDb({ roomCode, mediaId: 'test-film', mediaTitle: 'Test Film', voterId: uid, voterName: 'Test Member' }), false);
    const snapshot = await repository.getWatchRoomSnapshot(roomCode);
    assert.equal(snapshot?.isPlaying, true);
    assert.equal(snapshot?.currentTimeSeconds, 42);
    assert.equal(snapshot?.members.filter((member) => member.id === `${uid}-member`).length, 1);
    assert.equal(snapshot?.messages.some((message) => message.text === 'Persisted message'), true);
  } finally {
    const cacheTable = await import('./schema.ts');
    await db.delete(cacheTable.nxshaCatalogCache).where(eq(cacheTable.nxshaCatalogCache.cacheKey, cacheKey)).catch(() => {});
    if (roomId) await db.delete(schema.watchRooms).where(eq(schema.watchRooms.id, roomId)).catch(() => {});
    if (privateRoomId) await db.delete(schema.watchRooms).where(eq(schema.watchRooms.id, privateRoomId)).catch(() => {});
    if (historyId) await db.delete(schema.watchSessions).where(eq(schema.watchSessions.id, historyId)).catch(() => {});
    await db.delete(schema.watchlists).where(eq(schema.watchlists.userId, uid)).catch(() => {});
    await db.delete(schema.profiles).where(eq(schema.profiles.uid, uid)).catch(() => {});
    await closeDatabaseConnection();
  }
});

test('initial migration is additive and safe for pre-existing CineTogether tables', async () => {
  const { readFile } = await import('node:fs/promises');
  const migration = await readFile(new URL('../../drizzle/0000_organic_justice.sql', import.meta.url), 'utf8');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "profiles"/);
  assert.match(migration, /ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "preferences"/);
  assert.match(migration, /ALTER TABLE "room_members" ADD COLUMN IF NOT EXISTS "left_at"/);
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS "watchlist_items_user_media_unique"/);
  assert.doesNotMatch(migration, /\bDROP\s+(TABLE|COLUMN|DATABASE)\b/i);
});
