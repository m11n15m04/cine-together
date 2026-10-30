import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { Auth, getAuth } from 'firebase-admin/auth';

export function getAdminAuth(): Auth | null {
  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID;
  if (!projectId) return null;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL?.trim();
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n').trim();
  if (Boolean(clientEmail) !== Boolean(privateKey)) return null;
  const appName = 'cinetogether-admin';
  const app = getApps().find((candidate) => candidate.name === appName)
    || initializeApp({
      projectId,
      ...(clientEmail && privateKey ? { credential: cert({ projectId, clientEmail, privateKey }) } : {}),
    }, appName);
  return getAuth(app);
}
