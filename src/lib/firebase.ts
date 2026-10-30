import { FirebaseApp, initializeApp } from 'firebase/app';
import { Auth, GoogleAuthProvider, getAuth } from 'firebase/auth';

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || '',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || '',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || undefined,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || undefined,
};

const configured = Boolean(config.apiKey && config.authDomain && config.projectId && config.appId);
export const firebaseApp: FirebaseApp | null = configured ? initializeApp(config) : null;
export const auth: Auth | null = firebaseApp ? getAuth(firebaseApp) : null;
export const googleAuthProvider = new GoogleAuthProvider();
