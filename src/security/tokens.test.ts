import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertSecurityConfiguration,
  createGuestSession,
  createRoomAccessToken,
  verifyGuestSessionToken,
  verifyRoomAccessToken,
} from './tokens.ts';

const originalSecret = process.env.AUTH_TOKEN_SECRET;
const originalNodeEnv = process.env.NODE_ENV;
process.env.NODE_ENV = 'test';
process.env.AUTH_TOKEN_SECRET = 'tests-only-secret-with-at-least-32-bytes';

test('guest session token is signed and expires as a guest identity', () => {
  const session = createGuestSession('Cinema Guest');
  const verified = verifyGuestSessionToken(session.token);
  assert.equal(verified?.sub, session.guestId);
  assert.equal(verified?.name, 'Cinema Guest');
  assert.equal(verifyGuestSessionToken(`${session.token}x`), null);
});

test('room access token is bound to its actor and normalized room code', () => {
  const token = createRoomAccessToken('guest-1', 'ROOM-123', 'member');
  assert.equal(verifyRoomAccessToken(token, 'guest-1', 'ROOM-123')?.role, 'member');
  assert.equal(verifyRoomAccessToken(token, 'guest-2', 'ROOM-123'), null);
  assert.equal(verifyRoomAccessToken(token, 'guest-1', 'ROOM-999'), null);
});

test('production security configuration rejects a missing or short signing key', () => {
  process.env.NODE_ENV = 'production';
  process.env.AUTH_TOKEN_SECRET = 'too-short';
  assert.throws(assertSecurityConfiguration, /at least 32 bytes/);
  process.env.AUTH_TOKEN_SECRET = 'production-test-secret-with-at-least-32-bytes';
  assert.doesNotThrow(assertSecurityConfiguration);
});

test.after(() => {
  if (originalSecret === undefined) delete process.env.AUTH_TOKEN_SECRET;
  else process.env.AUTH_TOKEN_SECRET = originalSecret;
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
});
