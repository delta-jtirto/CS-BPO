/**
 * Single fetch wrapper for all calls to the Supabase Edge Function
 * (`make-server-ab702ee0`). Centralizes:
 *
 *   - Auth: bearer token from the current Supabase session, falling back
 *     to the anon key only as a last resort (the edge function rejects
 *     anon callers on every endpoint except `/health`).
 *   - 401 recovery: on a 401 we call `supabase.auth.refreshSession()` and
 *     retry the request once with the new token. Prevents transient
 *     auth failures during long-lived pages.
 *   - Transient backoff: on 429 / 502 / 503 / 504 we retry once after a
 *     short delay. Avoids surfacing OpenRouter / network blips to the UI.
 *   - Timeout: every request gets a default 30s deadline, composed with
 *     any caller-supplied AbortSignal.
 */
import { projectId, publicAnonKey } from '/utils/supabase/info';
import { supabase, getAccessToken } from '@/lib/supabase-client';

export const EDGE_BASE_URL = `https://${projectId}.supabase.co/functions/v1/make-server-ab702ee0`;

const DEFAULT_TIMEOUT_MS = 30_000;
const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);

export interface EdgeFetchOptions extends Omit<RequestInit, 'headers'> {
  /** Extra headers to merge with the auth + content-type defaults. */
  headers?: Record<string, string>;
  /** Override the default 30s timeout. Set 0 to disable. */
  timeoutMs?: number;
  /** Internal: prevents infinite refresh/retry loops. */
  _retried?: boolean;
}

async function buildAuthHeaders(extra: Record<string, string> = {}): Promise<Record<string, string>> {
  const token = (await getAccessToken()) ?? publicAnonKey;
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
    ...extra,
  };
}

function composeSignal(userSignal: AbortSignal | undefined, timeoutMs: number): { signal: AbortSignal; cleanup: () => void } {
  if (!timeoutMs) {
    return { signal: userSignal ?? new AbortController().signal, cleanup: () => {} };
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new DOMException('Request timed out', 'TimeoutError')), timeoutMs);
  if (userSignal) {
    if (userSignal.aborted) ctrl.abort(userSignal.reason);
    else userSignal.addEventListener('abort', () => ctrl.abort(userSignal.reason), { once: true });
  }
  return { signal: ctrl.signal, cleanup: () => clearTimeout(timer) };
}

/**
 * Fetch a path on the edge function with auth, timeout, and one
 * automatic retry for 401 (after session refresh) or 429/5xx (after a
 * 500ms wait).
 *
 * `path` may be absolute (`/ai/settings`) or already include the base
 * URL — both work.
 */
export async function edgeFetch(path: string, options: EdgeFetchOptions = {}): Promise<Response> {
  const { headers: extraHeaders, timeoutMs = DEFAULT_TIMEOUT_MS, _retried, signal: userSignal, ...rest } = options;

  const url = path.startsWith('http') ? path : `${EDGE_BASE_URL}${path.startsWith('/') ? '' : '/'}${path}`;
  const headers = await buildAuthHeaders(extraHeaders);
  const { signal, cleanup } = composeSignal(userSignal ?? undefined, timeoutMs);

  let res: Response;
  try {
    res = await fetch(url, { ...rest, headers, signal });
  } finally {
    cleanup();
  }

  // 401 → refresh the session and retry once.
  if (res.status === 401 && !_retried) {
    const { data, error } = await supabase.auth.refreshSession();
    if (!error && data.session) {
      return edgeFetch(path, { ...options, _retried: true });
    }
  }

  // Transient → wait briefly and retry once.
  if (RETRYABLE_STATUSES.has(res.status) && !_retried) {
    await new Promise(r => setTimeout(r, 500));
    return edgeFetch(path, { ...options, _retried: true });
  }

  return res;
}

/**
 * Convenience helper for JSON endpoints. Throws on non-2xx with the
 * server-supplied error message when present.
 */
export async function edgeFetchJson<T = unknown>(path: string, options: EdgeFetchOptions = {}): Promise<T> {
  const res = await edgeFetch(path, options);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const errMsg = (json as { error?: string })?.error || `Request failed (${res.status})`;
    throw new Error(errMsg);
  }
  return json as T;
}
