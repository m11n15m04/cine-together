import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createServer } from 'node:http';
import WebSocket from 'ws';

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
const writesAllowed = process.env.CINETEST_DATABASE_ALLOW_WRITE === 'true';
function isDisposableDatabase(url: string | undefined): boolean {
  try { return Boolean(url && /(?:^|[_-])test(?:[_-]|$)/i.test(new URL(url).pathname)); }
  catch { return false; }
}
const safeTestDatabase = Boolean(
  testDatabaseUrl && writesAllowed && isDisposableDatabase(testDatabaseUrl)
  && (testDatabaseUrl !== process.env.DATABASE_URL || process.env.NODE_ENV === 'test')
);

function waitForType(socket: WebSocket, type: string, predicate: (message: any) => boolean = () => true): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${type}.`)), 5000);
    const onMessage = (data: WebSocket.RawData) => {
      let message: any;
      try { message = JSON.parse(data.toString()); } catch { return; }
      if (message.type !== type || !predicate(message)) return;
      clearTimeout(timer);
      socket.off('message', onMessage);
      resolve(message);
    };
    socket.on('message', onMessage);
    socket.once('error', (error) => { clearTimeout(timer); reject(error); });
  });
}

test('WebSocket authentication restores room state and persists playback revisions', {
  skip: safeTestDatabase ? false : 'Set TEST_DATABASE_URL to a dedicated disposable database and CINETEST_DATABASE_ALLOW_WRITE=true.',
}, async () => {
  process.env.DATABASE_URL = testDatabaseUrl!;
  process.env.NODE_ENV = 'test';
  process.env.AUTH_TOKEN_SECRET = 'tests-only-secret-with-at-least-32-bytes';
  delete process.env.POSTGRES_URL;
  const [{ attachPartyHub }, { createGuestSession, createRoomAccessToken }, repository, database, schema] = await Promise.all([
    import('./partyHub.ts'),
    import('../security/tokens.ts'),
    import('../db/repository.ts'),
    import('../db/index.ts'),
    import('../db/schema.ts'),
  ]);

  const guest = createGuestSession('WebSocket Test Host');
  const roomCode = `WS-${crypto.randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`;
  let roomId: string | undefined;
  let partyHub: ReturnType<typeof attachPartyHub> | undefined;
  let client: WebSocket | undefined;
  const server = createServer();
  try {
    assert.equal((await database.checkDatabaseConnection()).available, true);
    const room = await repository.createWatchRoomInDb({
      roomCode, roomType: 'group', title: 'WebSocket Test', hostUserId: guest.guestId, hostDisplayName: 'WebSocket Test Host',
      currentMediaId: 'test-film', currentMediaType: 'movie', maxParticipants: 3,
    });
    roomId = room.id;
    partyHub = attachPartyHub(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    client = new WebSocket(`ws://127.0.0.1:${address.port}/ws/party`);
    await new Promise<void>((resolve, reject) => {
      client!.once('open', resolve);
      client!.once('error', reject);
    });

    const authResponse = waitForType(client, 'auth:ok');
    client.send(JSON.stringify({ type: 'auth', token: guest.token }));
    await authResponse;
    const joined = waitForType(client, 'room:state');
    client.send(JSON.stringify({
      type: 'room:join', roomId: roomCode, roomAccessToken: createRoomAccessToken(guest.guestId, roomCode, 'host'), memberName: 'WebSocket Test Host',
    }));
    await joined;

    const updated = waitForType(client, 'room:state', (message) => message.room?.revision > 1);
    client.send(JSON.stringify({ type: 'playback:update', isPlaying: true, currentTimeSeconds: 52, playbackRate: 1 }));
    const state = await updated;
    assert.equal(state.room.isPlaying, true);
    assert.equal(state.room.currentTimeSeconds, 52);
    assert.equal((await repository.getWatchRoomSnapshot(roomCode))?.revision, state.room.revision);
  } finally {
    client?.close();
    if (partyHub) await partyHub.close();
    if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
    if (roomId) {
      await database.db.delete(schema.watchRooms).where((await import('drizzle-orm')).eq(schema.watchRooms.id, roomId)).catch(() => {});
    }
    await database.closeDatabaseConnection();
  }
});
