/**
 * Client-side idempotency helpers for outbound message sends.
 *
 * The composer generates a UUIDv4 `client_message_id` the moment the agent
 * clicks Send. We INSERT a row with status='pending' before dispatching to
 * the remote channel (unibox or channel-proxy). If the user double-clicks
 * or a tab retries, the UNIQUE PK on (company_id, thread_key,
 * client_message_id) makes the second INSERT fail — the caller sees that
 * the send is already in flight and skips.
 *
 * After the remote dispatch returns, we UPDATE the row to 'delivered' or
 * 'failed'. The optimistic UI bubble in the feed reads this via Realtime
 * to flip from "Sending…" to the final state.
 *
 * This intentionally runs client-direct (no edge function) — the UNIQUE
 * PK is the only guarantee we need, and round-tripping through an edge
 * function wouldn't strengthen it.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export type SendStatus = 'pending' | 'delivered' | 'failed';

export interface SendIdempotencyRow {
  company_id: string;
  thread_key: string;
  client_message_id: string;
  status: SendStatus;
  remote_message_id: string | null;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
}

/**
 * Claim exclusivity for an outbound send.
 *
 * Returns { won: true } when the caller is the first to attempt this
 * client_message_id; the caller should proceed to dispatch.
 *
 * Returns { won: false, existing } when a prior attempt has already
 * recorded a row; the caller should NOT re-dispatch. Common cases:
 *   - existing.status === 'pending'   → another tab is mid-dispatch; wait
 *   - existing.status === 'delivered' → already sent; optimistic bubble
 *                                        should reconcile via Realtime
 *   - existing.status === 'failed'    → caller may retry with a NEW
 *                                        client_message_id (new UUID)
 */
export async function claimOutboundSend(
  supabase: SupabaseClient,
  params: {
    companyId: string;
    threadKey: string;
    clientMessageId: string;
  },
): Promise<
  | { won: true }
  | { won: false; existing: SendIdempotencyRow | null }
> {
  const { error } = await supabase
    .from('outbound_send_idempotency')
    .insert({
      company_id: params.companyId,
      thread_key: params.threadKey,
      client_message_id: params.clientMessageId,
      status: 'pending',
    });

  if (!error) return { won: true };

  // 23505 = unique_violation. Something else already owns this client_message_id.
  const code = (error as { code?: string }).code;
  if (code !== '23505') {
    console.warn('[outbound-send-idempotency] claim failed:', error.message);
    return { won: false, existing: null };
  }

  const { data } = await supabase
    .from('outbound_send_idempotency')
    .select('*')
    .eq('company_id', params.companyId)
    .eq('thread_key', params.threadKey)
    .eq('client_message_id', params.clientMessageId)
    .maybeSingle<SendIdempotencyRow>();

  return { won: false, existing: data ?? null };
}

/**
 * Mark an outbound send as delivered. Transitions pending → delivered and
 * records the remote provider's message id so future round-trip messages
 * from Realtime can be correlated with the optimistic bubble.
 */
export async function markSendDelivered(
  supabase: SupabaseClient,
  params: {
    companyId: string;
    threadKey: string;
    clientMessageId: string;
    remoteMessageId?: string;
  },
): Promise<void> {
  const { error } = await supabase
    .from('outbound_send_idempotency')
    .update({
      status: 'delivered',
      remote_message_id: params.remoteMessageId ?? null,
      completed_at: new Date().toISOString(),
    })
    .eq('company_id', params.companyId)
    .eq('thread_key', params.threadKey)
    .eq('client_message_id', params.clientMessageId)
    .eq('status', 'pending');

  if (error) {
    console.warn('[outbound-send-idempotency] mark delivered failed:', error.message);
  }
}

/**
 * Mark an outbound send as failed. The agent can retry by issuing a new
 * client_message_id (don't reuse a failed one — the PK is permanent).
 */
export async function markSendFailed(
  supabase: SupabaseClient,
  params: {
    companyId: string;
    threadKey: string;
    clientMessageId: string;
    errorMessage: string;
  },
): Promise<void> {
  const { error } = await supabase
    .from('outbound_send_idempotency')
    .update({
      status: 'failed',
      error_message: params.errorMessage.slice(0, 500),
      completed_at: new Date().toISOString(),
    })
    .eq('company_id', params.companyId)
    .eq('thread_key', params.threadKey)
    .eq('client_message_id', params.clientMessageId)
    .eq('status', 'pending');

  if (error) {
    console.warn('[outbound-send-idempotency] mark failed failed:', error.message);
  }
}

/**
 * Generate a fresh UUIDv4 for a new send attempt.
 * Uses the browser crypto API; falls back to Math.random for older envs.
 */
export function newClientMessageId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  // RFC4122-ish fallback. Not cryptographically strong, but adequate when
  // paired with the DB's UNIQUE constraint (collisions just cause a
  // retry-with-new-id, not a security issue).
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
