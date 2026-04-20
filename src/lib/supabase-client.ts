import { createClient, type SupabaseClient, type Session } from '@supabase/supabase-js';

const SUPABASE_URL = `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co`;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

/**
 * Singleton Supabase client with auth session management.
 * Used by the entire AI BPO app for:
 * - Supabase Auth (sign-in, session)
 * - Supabase Realtime (proxy conversations/messages)
 * - API calls to the channel proxy (JWT from session)
 */
export const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/**
 * Get the current access token for API calls.
 * Returns null if not authenticated.
 */
export async function getAccessToken(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

/**
 * Get the current session.
 */
export async function getSession(): Promise<Session | null> {
  const { data: { session } } = await supabase.auth.getSession();
  return session;
}

/**
 * Resolve the authenticated user's company scope server-side.
 *
 * Calls the SECURITY DEFINER function `public.get_user_company_ids()`
 * (migration 20260421000001). Resolution order inside the function:
 *   1. JWT claim `app_metadata.companies` (array of text).
 *   2. `public.user_companies` rows for `auth.uid()`.
 *   3. `['delta-hq']` prototype fallback when a row exists but neither
 *      of the above is populated.
 *
 * Returns `[]` when no session is active. Callers should treat an empty
 * array as "not signed in" and avoid issuing company-scoped queries.
 */
export async function getUserCompanyIds(): Promise<string[]> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return [];

  const { data, error } = await supabase.rpc('get_user_company_ids');
  if (error) {
    console.warn('[supabase] get_user_company_ids RPC failed:', error.message);
    // Do NOT silently substitute a default here — a stale fallback is
    // exactly the kind of tenant-crossing bug this RPC is meant to
    // prevent. An empty array tells the caller to fail closed.
    return [];
  }

  const ids = Array.isArray(data)
    ? (data as unknown[]).filter((x): x is string => typeof x === 'string')
    : [];
  return ids;
}
