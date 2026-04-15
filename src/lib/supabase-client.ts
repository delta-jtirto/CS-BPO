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
 * Get the current user's company IDs.
 * Hardcoded for single-company setup — avoids RLS complexity.
 * To support multiple companies later, query user_companies table.
 */
export const COMPANY_ID = 'delta-hq';

export async function getUserCompanyIds(): Promise<string[]> {
  return [COMPANY_ID];
}
