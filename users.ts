import { db } from './index.ts';
import { profiles } from './schema.ts';

export async function getOrCreateProfile(
  uid: string,
  email: string,
  displayName?: string,
  avatarUrl?: string
) {
  try {
    const safeName = displayName || email.split('@')[0] || 'Cinema Lover';
    const result = await db
      .insert(profiles)
      .values({
        uid,
        email,
        displayName: safeName,
        avatarUrl: avatarUrl || null,
      })
      .onConflictDoUpdate({
        target: profiles.uid,
        set: {
          email,
          displayName: safeName,
          updatedAt: new Date(),
        },
      })
      .returning();

    return result[0];
  } catch (error) {
    console.error('Database query failed in getOrCreateProfile:', error);
    throw new Error('Failed to synchronize user profile. Please try again later.', {
      cause: error,
    });
  }
}
