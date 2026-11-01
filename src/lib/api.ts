import { auth } from './firebase.ts';

const GUEST_TOKEN_KEY = 'cinetogether.guest-session.v1';
const roomTokenKey = (roomCode: string) => `cinetogether.room-access.${roomCode.trim().toUpperCase()}`;

interface StoredGuestSession {
  token: string;
  expiresAt: string;
}

function browserStorage(): Storage | null {
  return typeof window === 'undefined' ? null : window.sessionStorage;
}

async function getFirebaseToken(): Promise<string | null> {
  const user = auth?.currentUser;
  return user ? user.getIdToken() : null;
}

export async function getActorToken(options: { allowGuest?: boolean; displayName?: string } = {}): Promise<string | null> {
  const firebaseToken = await getFirebaseToken();
  if (firebaseToken) return firebaseToken;
  if (!options.allowGuest) return null;
  const storage = browserStorage();
  if (!storage) return null;

  try {
    const cached = JSON.parse(storage.getItem(GUEST_TOKEN_KEY) || 'null') as StoredGuestSession | null;
    if (cached && new Date(cached.expiresAt).getTime() > Date.now() + 60_000) return cached.token;
  } catch {
    storage.removeItem(GUEST_TOKEN_KEY);
  }

  const response = await fetch('/api/auth/guest-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ displayName: options.displayName || 'Cinema Guest' }),
  });
  if (!response.ok) throw new Error('Could not start a guest session.');
  const result = await response.json();
  const session = result?.data as StoredGuestSession | undefined;
  if (!session?.token || !session.expiresAt) throw new Error('Guest session response was invalid.');
  storage.setItem(GUEST_TOKEN_KEY, JSON.stringify(session));
  return session.token;
}

export async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}, options: { allowGuest?: boolean; displayName?: string } = {}): Promise<Response> {
  const token = await getActorToken(options);
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}

export function saveRoomAccessToken(roomCode: string, token: string): void {
  browserStorage()?.setItem(roomTokenKey(roomCode), token);
}

export function getRoomAccessToken(roomCode: string): string | null {
  return browserStorage()?.getItem(roomTokenKey(roomCode)) || null;
}

export function clearRoomAccessToken(roomCode: string): void {
  browserStorage()?.removeItem(roomTokenKey(roomCode));
}

export function clearGuestSession(): void {
  browserStorage()?.removeItem(GUEST_TOKEN_KEY);
}
