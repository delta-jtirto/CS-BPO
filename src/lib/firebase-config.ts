import { initializeApp, getApp, deleteApp, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

/** Cache of named Firebase app instances — one per connected company */
const appCache = new Map<string, FirebaseApp>();

/**
 * Get or create a named Firebase app instance for a specific host/company.
 * Each company gets its own app so it can have its own auth session.
 */
export function getOrCreateApp(hostId: string): FirebaseApp {
  if (appCache.has(hostId)) {
    return appCache.get(hostId)!;
  }

  // Try to retrieve an existing app first (survives HMR)
  try {
    const existing = getApp(hostId);
    appCache.set(hostId, existing);
    return existing;
  } catch {
    // App doesn't exist yet — create it
  }

  const app = initializeApp(firebaseConfig, hostId);
  appCache.set(hostId, app);
  return app;
}

/** Get the Firestore instance for a specific host's Firebase app */
export function getDbForHost(hostId: string): Firestore {
  const app = getOrCreateApp(hostId);
  return getFirestore(app);
}

/** Get the Auth instance for a specific host's Firebase app */
export function getAuthForHost(hostId: string): Auth {
  const app = getOrCreateApp(hostId);
  return getAuth(app);
}

/** Tear down a host's Firebase app (on disconnect) */
export async function destroyApp(hostId: string): Promise<void> {
  const app = appCache.get(hostId);
  if (app) {
    try {
      await deleteApp(app);
    } catch {
      // Already deleted or never initialized — safe to ignore
    }
    appCache.delete(hostId);
  }
}

/** Check if Firebase is configured (env vars present) */
export function isFirebaseConfigured(): boolean {
  return Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);
}
