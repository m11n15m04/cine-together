import test from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';

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

test('Drizzle migration preserves rows from the pre-existing database schema', {
  skip: safeTestDatabase ? false : 'Set TEST_DATABASE_URL to a migrated dedicated disposable database and CINETEST_DATABASE_ALLOW_WRITE=true.',
}, async () => {
  process.env.DATABASE_URL = testDatabaseUrl!;
  delete process.env.POSTGRES_URL;
  const [{ db, closeDatabaseConnection }, schema] = await Promise.all([import('./index.ts'), import('./schema.ts')]);
  try {
    const [profile] = await db.select().from(schema.profiles).where(eq(schema.profiles.uid, 'legacy-migration-user'));
    assert.equal(profile?.displayName, 'Legacy Member');
    assert.deepEqual(profile?.preferences, {});

    const [room] = await db.select().from(schema.watchRooms).where(eq(schema.watchRooms.roomCode, 'LEGACY-MIGRATION'));
    assert.equal(room?.title, 'Legacy Room');
    assert.equal(room?.isLocked, false);
    assert.equal(room?.couplePartnerNote, '');

    const [member] = await db.select().from(schema.roomMembers).where(eq(schema.roomMembers.userId, 'legacy-migration-user'));
    assert.equal(member?.isBanned, false);
    assert.equal(member?.leftAt, null);

    const [history] = await db.select().from(schema.watchSessions).where(eq(schema.watchSessions.userId, 'legacy-migration-user'));
    assert.equal(history?.progressSeconds, 125);
    assert.ok(history?.lastWatchedAt instanceof Date);
    assert.ok(history?.updatedAt instanceof Date);
  } finally {
    await closeDatabaseConnection();
  }
});
