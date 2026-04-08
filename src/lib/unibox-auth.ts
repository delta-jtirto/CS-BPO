import { signInWithCustomToken, signOut, onAuthStateChanged, type Unsubscribe } from 'firebase/auth';
import { type Firestore } from 'firebase/firestore';
import { getOrCreateApp, getAuthForHost, getDbForHost, destroyApp } from './firebase-config';

const UNIBOX_API_BASE = import.meta.env.VITE_UNIBOX_API_BASE_URL || '';

export type ConnectionHealth =
  | 'connected'
  | 'expired'
  | 'permission-denied'
  | 'network-error'
  | 'disconnected';

export interface UniboxUser {
  unibox_user_id: string;
  name: string;
  avatar_url: string;
  role: string;
  custom_token: string;
  to_get_thread_id: string | null;
}

export interface AuthenticatedHost {
  hostId: string;
  userId: string; // to_get_thread_id — the host-level ID used for thread_list queries
  companyName: string;
  db: Firestore;
  /** Unsubscribe from auth state changes */
  unsubAuthListener: Unsubscribe;
}

/**
 * Validate a Unified Inbox access token by calling the API.
 * Returns the user profile including the Firebase custom token.
 * Throws with a specific ConnectionHealth error on failure.
 */
export async function validateToken(accessToken: string): Promise<UniboxUser> {
  if (!UNIBOX_API_BASE) {
    throw new AuthError('network-error', 'Unibox API URL not configured');
  }

  let response: Response;
  try {
    response = await fetch(`${UNIBOX_API_BASE}v1/unibox/me`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });
  } catch {
    throw new AuthError('network-error', 'Failed to reach Unified Inbox API — check your network');
  }

  if (response.status === 401 || response.status === 403) {
    throw new AuthError('expired', 'Token is invalid or expired — paste a new token');
  }

  if (!response.ok) {
    throw new AuthError('network-error', `Unified Inbox API returned ${response.status}`);
  }

  const data = await response.json();
  // The API wraps the user in a `data` field
  const user: UniboxUser = data.data ?? data;

  if (!user.unibox_user_id || !user.custom_token) {
    throw new AuthError('permission-denied', 'API response missing user ID or custom token');
  }

  return user;
}

/**
 * Full auth flow for a company:
 * 1. Validate the access token via Unibox API
 * 2. Create a named Firebase app for this host
 * 3. Sign in with the Firebase custom token
 * 4. Return the authenticated host with Firestore access
 *
 * @param onHealthChange - called when the auth state changes mid-session
 */
export async function authenticateHost(
  accessToken: string,
  hostId: string,
  onHealthChange?: (hostId: string, health: ConnectionHealth) => void,
): Promise<AuthenticatedHost> {
  // Step 1: Validate token and get Firebase custom token
  const user = await validateToken(accessToken);

  // Step 2: Create named Firebase app
  getOrCreateApp(hostId);
  const auth = getAuthForHost(hostId);
  const db = getDbForHost(hostId);

  // Step 3: Sign in with custom token
  try {
    await signInWithCustomToken(auth, user.custom_token);
  } catch (err: unknown) {
    const code = (err as { code?: string }).code;
    if (code === 'auth/invalid-custom-token' || code === 'auth/custom-token-mismatch') {
      throw new AuthError('expired', 'Firebase custom token is invalid — re-paste your inbox token');
    }
    throw new AuthError('network-error', `Firebase auth failed: ${code || 'unknown error'}`);
  }

  // Step 4: Monitor auth state for mid-session expiry
  const unsubAuthListener = onAuthStateChanged(auth, (firebaseUser) => {
    if (!firebaseUser && onHealthChange) {
      onHealthChange(hostId, 'expired');
    }
  });

  return {
    hostId,
    userId: user.to_get_thread_id || user.unibox_user_id, // host-level ID for thread_list queries
    companyName: user.name,
    db,
    unsubAuthListener,
  };
}

/**
 * Disconnect a host: sign out of Firebase + destroy the app instance
 */
export async function disconnectHost(hostId: string): Promise<void> {
  try {
    const auth = getAuthForHost(hostId);
    await signOut(auth);
  } catch {
    // Already signed out — fine
  }
  await destroyApp(hostId);
}

/** Typed auth error with connection health status */
export class AuthError extends Error {
  constructor(
    public readonly health: ConnectionHealth,
    message: string,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

/** Mask a token for display: show only last 4 chars */
export function maskToken(token: string): string {
  if (token.length <= 8) return '••••••••';
  return '••••••••' + token.slice(-4);
}
