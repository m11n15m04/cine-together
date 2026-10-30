import crypto from 'node:crypto';

export interface GuestSessionClaims {
  purpose: 'guest-session';
  sub: string;
  name: string;
  exp: number;
}

export interface RoomAccessClaims {
  purpose: 'room-access';
  sub: string;
  roomCode: string;
  role: 'host' | 'member';
  exp: number;
}

type SignedClaims = GuestSessionClaims | RoomAccessClaims;

function signingSecret(): string {
  const secret = process.env.AUTH_TOKEN_SECRET?.trim();
  if (secret && Buffer.byteLength(secret) >= 32) return secret;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('AUTH_TOKEN_SECRET must contain at least 32 bytes in production.');
  }
  return 'cinetogether-local-development-secret-only';
}

function encode(payload: SignedClaims): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', signingSecret()).update(body).digest('base64url');
  return `${body}.${signature}`;
}

export function verifySignedClaims(token: string): SignedClaims | null {
  const [body, signature, extra] = token.split('.');
  if (!body || !signature || extra) return null;

  try {
    const expected = crypto.createHmac('sha256', signingSecret()).update(body).digest();
    const supplied = Buffer.from(signature, 'base64url');
    if (expected.length !== supplied.length || !crypto.timingSafeEqual(expected, supplied)) return null;
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SignedClaims;
    if (!claims || typeof claims.exp !== 'number' || claims.exp <= Math.floor(Date.now() / 1000)) return null;
    if (claims.purpose === 'guest-session' && typeof claims.sub === 'string' && typeof claims.name === 'string') {
      return claims;
    }
    if (
      claims.purpose === 'room-access' &&
      typeof claims.sub === 'string' &&
      typeof claims.roomCode === 'string' &&
      (claims.role === 'host' || claims.role === 'member')
    ) {
      return claims;
    }
    return null;
  } catch {
    return null;
  }
}

export function createGuestSession(name: string): { token: string; guestId: string; expiresAt: string } {
  const guestId = `guest-${crypto.randomUUID()}`;
  const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 24;
  return {
    token: encode({ purpose: 'guest-session', sub: guestId, name, exp }),
    guestId,
    expiresAt: new Date(exp * 1000).toISOString(),
  };
}

export function createRoomAccessToken(
  actorId: string,
  roomCode: string,
  role: RoomAccessClaims['role']
): string {
  const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 24;
  return encode({ purpose: 'room-access', sub: actorId, roomCode, role, exp });
}

export function verifyGuestSessionToken(token: string): GuestSessionClaims | null {
  const claims = verifySignedClaims(token);
  return claims?.purpose === 'guest-session' ? claims : null;
}

export function verifyRoomAccessToken(
  token: string,
  actorId: string,
  roomCode: string
): RoomAccessClaims | null {
  const claims = verifySignedClaims(token);
  if (claims?.purpose !== 'room-access') return null;
  if (claims.sub !== actorId || claims.roomCode !== roomCode.toUpperCase()) return null;
  return claims;
}

export function assertSecurityConfiguration(): void {
  signingSecret();
}
