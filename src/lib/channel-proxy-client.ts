/**
 * Thin HTTP client for the channel-proxy backend.
 *
 * Centralizes every fetch that was previously duplicated inline in
 * InboxView / ConnectedChannelsPanel. Each call:
 *   * Reads PROXY_URL from env once.
 *   * Grabs the current user's Supabase JWT via getAccessToken().
 *   * Throws a typed ChannelProxyError with status + parsed body on
 *     non-OK responses so callers can distinguish 401/403/network/etc
 *     without re-parsing.
 *
 * Not meant as an exhaustive SDK — just the routes the app calls today.
 */

import { getAccessToken } from './supabase-client';

const PROXY_URL = import.meta.env.VITE_CHANNEL_PROXY_URL || '';

export class ChannelProxyError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.name = 'ChannelProxyError';
    this.status = status;
    this.body = body;
  }
}

function requireConfigured(): string {
  if (!PROXY_URL) {
    throw new ChannelProxyError(0, 'Channel proxy URL not configured');
  }
  return PROXY_URL;
}

async function authedRequest(path: string, init: RequestInit): Promise<Response> {
  const base = requireConfigured();
  const token = await getAccessToken();
  if (!token) {
    throw new ChannelProxyError(401, 'Not authenticated — no Supabase session');
  }
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      ...(init.headers as Record<string, string> | undefined),
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });
  if (!response.ok) {
    let body: unknown = undefined;
    try { body = await response.json(); } catch { /* non-JSON */ }
    const message = (body as { error?: string } | null)?.error
      ?? `Channel proxy ${response.status}`;
    throw new ChannelProxyError(response.status, message, body);
  }
  return response;
}

/** Trigger an email sync for the given company. Backend pulls new
 *  inbound emails from connected mailboxes into the `messages` table. */
export async function fetchEmails(companyId: string): Promise<{ stored: number }> {
  const res = await authedRequest('/api/proxy/email/fetch', {
    method: 'POST',
    body: JSON.stringify({ company_id: companyId }),
  });
  const data = await res.json().catch(() => ({}));
  return { stored: typeof data?.stored === 'number' ? data.stored : 0 };
}

export interface ChannelAccount {
  id: string;
  company_id: string;
  channel: string;
  host_id: string | null;
  display_name: string | null;
  [extra: string]: unknown;
}

/** List connected channel accounts for the company. */
export async function listAccounts(companyId: string): Promise<ChannelAccount[]> {
  const res = await authedRequest(
    `/api/proxy/accounts?company_id=${encodeURIComponent(companyId)}`,
    { method: 'GET' },
  );
  const data = await res.json().catch(() => ({}));
  const rows = (data?.accounts ?? data ?? []) as unknown;
  return Array.isArray(rows) ? (rows as ChannelAccount[]) : [];
}

/** Update the host mapping on a channel account. */
export async function updateAccountHost(
  accountId: string,
  hostId: string | null,
): Promise<void> {
  await authedRequest(`/api/proxy/accounts/${encodeURIComponent(accountId)}`, {
    method: 'PUT',
    body: JSON.stringify({ host_id: hostId }),
  });
}
