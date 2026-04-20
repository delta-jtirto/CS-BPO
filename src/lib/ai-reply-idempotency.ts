/**
 * Client helper for the server-side AI auto-reply idempotency gate.
 *
 * Three steps:
 *   1. claimAIReply()   — try to INSERT the ai_reply_attempts row. Winner
 *                         proceeds with the LLM call; loser skips.
 *   2. tailCheck()      — called BEFORE finalize on the winning tab. If any
 *                         non-guest message has landed after the guest msg
 *                         the attempt was claimed against, finalize with
 *                         outcome='superseded' and don't inject the reply.
 *   3. finalizeAIReply() — write the terminal outcome back so loser tabs
 *                          receive it via Realtime and render the reply.
 *
 * guest_msg_id derivation: we use `${createdAt}|${text.slice(0,100)}` of
 * the latest guest message. That's the same fingerprint useGlobalAutoReply
 * already uses to detect new messages, so two tabs observing the same
 * Firestore/Realtime state will derive the same id and collide on the
 * PK as intended.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from './supabase-client';

export const PROMPT_VERSION = 'auto-reply@2026-04-21';

const BASE_URL = `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co/functions/v1/make-server-ab702ee0`;

export type AttemptOutcome =
  | 'pending'
  | 'answered'
  | 'partial'
  | 'escalate'
  | 'safety'
  | 'superseded'
  | 'error';

export interface AttemptRow {
  trace_id: string;
  outcome: AttemptOutcome;
  reply_text: string | null;
  risk_score: number | null;
  model?: string;
  prompt_version?: string;
  created_at?: string;
  completed_at?: string | null;
}

export interface GuestMessageIdInput {
  createdAt: number;
  text: string;
}

/**
 * Stable id for the latest guest message. Mirrors lastGuestFingerprint()
 * in useAutoReply.ts — keep the derivation byte-identical so different
 * tabs / browsers collide on the DB PK.
 */
export function deriveGuestMsgId(msg: GuestMessageIdInput): string {
  return `${msg.createdAt}|${(msg.text ?? '').slice(0, 100)}`;
}

async function userAuthHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token ?? import.meta.env.VITE_SUPABASE_ANON_KEY;
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  };
}

export interface ClaimResult {
  won: boolean;
  trace_id: string;
  existing: AttemptRow | null;
}

/**
 * Try to claim the attempt. On PK collision, returns the winner's row so
 * the caller can either render it immediately (if finalized) or subscribe
 * to Realtime and wait (if outcome='pending').
 */
export async function claimAIReply(params: {
  companyId: string;
  threadKey: string;
  guestMsgId: string;
  model: string;
}): Promise<ClaimResult> {
  const res = await fetch(`${BASE_URL}/ai/auto-reply/claim`, {
    method: 'POST',
    headers: await userAuthHeaders(),
    body: JSON.stringify({
      company_id: params.companyId,
      thread_key: params.threadKey,
      guest_msg_id: params.guestMsgId,
      prompt_version: PROMPT_VERSION,
      model: params.model,
    }),
  });

  const json = await res.json();
  if (!res.ok) {
    throw new Error(json.error || `claim failed (${res.status})`);
  }
  return json as ClaimResult;
}

export async function finalizeAIReply(params: {
  companyId: string;
  threadKey: string;
  guestMsgId: string;
  outcome: Exclude<AttemptOutcome, 'pending'>;
  replyText?: string;
  riskScore?: number;
}): Promise<void> {
  const res = await fetch(`${BASE_URL}/ai/auto-reply/finalize`, {
    method: 'POST',
    headers: await userAuthHeaders(),
    body: JSON.stringify({
      company_id: params.companyId,
      thread_key: params.threadKey,
      guest_msg_id: params.guestMsgId,
      outcome: params.outcome,
      reply_text: params.replyText,
      risk_score: params.riskScore,
    }),
  });

  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.error || `finalize failed (${res.status})`);
  }
}

/**
 * Commit-time tail check. Returns true if the thread tail still looks like
 * "guest message last, no interleaving human or bot reply since". Returns
 * false if someone beat us to it — caller should finalize 'superseded'.
 */
export function isTailClean(params: {
  messages: Array<{ sender: string; createdAt?: number }>;
  guestMsgCreatedAt: number;
}): boolean {
  for (const m of params.messages) {
    if ((m.createdAt ?? 0) <= params.guestMsgCreatedAt) continue;
    // Anything newer than the guest message that isn't another guest msg
    // means we're racing a human/bot reply. Abort.
    if (m.sender !== 'guest') return false;
  }
  return true;
}

/**
 * One-shot subscription to the attempt row. Resolves when outcome
 * transitions from pending to terminal, or immediately if the row is
 * already finalized. Used by loser tabs so they render the winner's
 * reply as soon as it's ready.
 *
 * Timeout defaults to 90s — longer than any reasonable LLM call, short
 * enough that a stuck pending row doesn't leak a subscription forever.
 */
export async function waitForAttemptFinalized(
  client: SupabaseClient,
  params: {
    companyId: string;
    threadKey: string;
    guestMsgId: string;
    timeoutMs?: number;
  },
): Promise<AttemptRow | null> {
  const timeoutMs = params.timeoutMs ?? 90_000;

  // Fast-path: check current row first.
  const { data: existing } = await client
    .from('ai_reply_attempts')
    .select('trace_id, outcome, reply_text, risk_score, model, prompt_version, created_at, completed_at')
    .eq('company_id', params.companyId)
    .eq('thread_key', params.threadKey)
    .eq('guest_msg_id', params.guestMsgId)
    .maybeSingle<AttemptRow>();

  if (existing && existing.outcome !== 'pending') {
    return existing;
  }

  // Slow-path: subscribe until we see a terminal outcome or timeout.
  return new Promise<AttemptRow | null>((resolve) => {
    let settled = false;
    const settle = (row: AttemptRow | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      channel.unsubscribe();
      resolve(row);
    };

    const timer = setTimeout(() => settle(null), timeoutMs);

    const channel = client
      .channel(`ai_reply_attempts:${params.companyId}:${params.threadKey}:${params.guestMsgId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'ai_reply_attempts',
          filter: `thread_key=eq.${params.threadKey}`,
        },
        (payload) => {
          const row = payload.new as AttemptRow & { guest_msg_id: string; company_id: string };
          if (
            row.company_id === params.companyId &&
            row.guest_msg_id === params.guestMsgId &&
            row.outcome !== 'pending'
          ) {
            settle(row);
          }
        },
      )
      .subscribe();
  });
}
