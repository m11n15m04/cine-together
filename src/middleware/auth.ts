import type { DecodedIdToken } from 'firebase-admin/auth';
import type { NextFunction, Request, Response } from 'express';
import { getAdminAuth } from '../lib/firebase-admin.ts';
import { verifyGuestSessionToken } from '../security/tokens.ts';

export interface AuthActor {
  id: string;
  kind: 'user' | 'guest';
  email?: string;
  displayName?: string;
}

export interface AuthRequest extends Request {
  user?: DecodedIdToken;
  actor?: AuthActor;
}

export type AuthenticatedRequest = AuthRequest;

export class AuthConfigurationError extends Error {
  constructor() {
    super('Firebase authentication is not configured.');
    this.name = 'AuthConfigurationError';
  }
}

function bearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const match = /^Bearer\s+([^\s]+)$/i.exec(header.trim());
  return match?.[1] || null;
}

export async function verifyActorToken(token: string): Promise<{ actor: AuthActor; user?: DecodedIdToken }> {
  const guest = verifyGuestSessionToken(token);
  if (guest) {
    return { actor: { id: guest.sub, kind: 'guest', displayName: guest.name } };
  }

  const adminAuth = getAdminAuth();
  if (!adminAuth) throw new AuthConfigurationError();
  const user = await adminAuth.verifyIdToken(token, true);
  return {
    actor: {
      id: user.uid,
      kind: 'user',
      email: user.email,
      displayName: typeof user.name === 'string' ? user.name : undefined,
    },
    user,
  };
}

export const requireActor = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const token = bearerToken(req);
  if (!token) return res.status(401).json({ error: 'Authentication required.' });
  try {
    const verified = await verifyActorToken(token);
    req.actor = verified.actor;
    req.user = verified.user;
    return next();
  } catch (error) {
    if (error instanceof AuthConfigurationError) {
      return res.status(503).json({ error: 'Authentication is temporarily unavailable.' });
    }
    return res.status(401).json({ error: 'Invalid or expired authentication token.' });
  }
};

export const requireAuth = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const token = bearerToken(req);
  if (!token) return res.status(401).json({ error: 'Sign-in is required.' });
  try {
    const adminAuth = getAdminAuth();
    if (!adminAuth) throw new AuthConfigurationError();
    const user = await adminAuth.verifyIdToken(token, true);
    req.user = user;
    req.actor = {
      id: user.uid,
      kind: 'user',
      email: user.email,
      displayName: typeof user.name === 'string' ? user.name : undefined,
    };
    return next();
  } catch (error) {
    if (error instanceof AuthConfigurationError) {
      return res.status(503).json({ error: 'Authentication is temporarily unavailable.' });
    }
    return res.status(401).json({ error: 'Invalid or expired Firebase ID token.' });
  }
};

export const optionalAuth = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const token = bearerToken(req);
  if (!token) return next();
  try {
    const adminAuth = getAdminAuth();
    if (!adminAuth) throw new AuthConfigurationError();
    const user = await adminAuth.verifyIdToken(token, true);
    req.user = user;
    req.actor = {
      id: user.uid,
      kind: 'user',
      email: user.email,
      displayName: typeof user.name === 'string' ? user.name : undefined,
    };
    return next();
  } catch (error) {
    if (error instanceof AuthConfigurationError) {
      return res.status(503).json({ error: 'Authentication is temporarily unavailable.' });
    }
    return res.status(401).json({ error: 'Invalid or expired Firebase ID token.' });
  }
};
