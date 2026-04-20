/**
 * Source-agnostic bot-reply marker.
 *
 * Problem: when the client sends an AI auto-reply through any channel —
 * channel-proxy (WhatsApp/Instagram/LINE/Email), Unified Inbox (Firestore),
 * or mock/devMode — the message eventually round-trips back as an "outbound"
 * message that looks indistinguishable from a human agent reply. The channel-
 * proxy backend strips our metadata.source='bot' hint, so the DB can't help
 * either. Without a separate record, "AI Auto-Reply" bubbles silently revert
 * to plain agent bubbles after reload or on a second device, and the auto-
 * reply dedup can't tell its own prior replies apart from manual ones.
 *
 * Fix: a dedicated Supabase table (public.bot_message_signatures) holds a
 * lightweight fingerprint of every bot-sent message — (thread_key, text
 * snippet, minute-of-send). On app mount we hydrate the table into an
 * in-memory Set keyed by thread_key so the sync API isBotSent(threadKey, text,
 * ts) is callable from any mapper. markBotSent writes both the Set and
 * Supabase in one call; the DB write is fire-and-forget because the local
 * Set is already correct and the UI doesn't need to await the round-trip.
 *
 * Same predicate, same two entry points, every source:
 *   proxy-mappers.ts, firestore-mappers.ts, (future) any other channel mapper
 * just consult isBotSent(threadKey, text, tsMs) — no per-source logic.
 *
 * Tolerance: ±1 minute on sent_at_min absorbs clock skew between the
 * client's Date.now() and the channel_timestamp the remote provider stamps
 * on the echoed message. Tight enough that two different threads don't
 * collide even when agents send identical canned replies in the same minute,
 * because the signature is thread-scoped.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

const TEXT_SNIPPET_LEN = 120;

/** In-memory lookup Set, keyed by `${threadKey}|${textSnippet}|${minute}`. */
const localSet = new Set<string>();

function sigKey(threadKey: string, text: string, minute: number): string {
  return `${threadKey}|${text.slice(0, TEXT_SNIPPET_LEN)}|${minute}`;
}

/**
 * Load all known bot-reply signatures for the given companies into the
 * in-memory Set. Call once on app start (and on company-list changes) before
 * any mapper runs — otherwise the first batch of Realtime messages after
 * reload will render as plain agent bubbles until the hydrate resolves.
 *
 * Returns the number of signatures loaded (for observability).
 */
/** Only hydrate signatures from the last N days. Older bot messages
 *  either belong to resolved threads (no longer rendered) or already
 *  correctly display as 'agent' in the UI after any prior hydrate
 *  completed. Windowing keeps the round-trip size bounded and
 *  startup latency flat as the table grows. */
const HYDRATE_WINDOW_DAYS = 7;

export async function hydrateBotSignatures(
  supabase: SupabaseClient,
  companyIds: string[],
): Promise<number> {
  if (companyIds.length === 0) return 0;

  const cutoffIso = new Date(Date.now() - HYDRATE_WINDOW_DAYS * 86_400_000).toISOString();

  const { data, error } = await supabase
    .from('bot_message_signatures')
    .select('thread_key, text_snippet, sent_at_min')
    .in('company_id', companyIds)
    .gte('created_at', cutoffIso);

  if (error) {
    console.warn('[bot-signatures] hydrate failed:', error.message);
    return 0;
  }

  for (const row of (data ?? []) as Array<{ thread_key: string; text_snippet: string; sent_at_min: number }>) {
    localSet.add(sigKey(row.thread_key, row.text_snippet, Number(row.sent_at_min)));
  }
  return data?.length ?? 0;
}

/**
 * Record a bot-sent reply. Updates the local Set synchronously (so the very
 * next `isBotSent` call for the round-tripped message hits) and writes the
 * row to Supabase in the background. Errors are logged and swallowed — the
 * local Set is the authoritative source for the active session, and next
 * mount rehydrates from the DB for cross-device persistence.
 */
export function markBotSent(
  supabase: SupabaseClient,
  companyId: string,
  threadKey: string,
  text: string,
  timestampMs: number,
): void {
  const minute = Math.floor(timestampMs / 60_000);
  const snippet = text.slice(0, TEXT_SNIPPET_LEN);
  localSet.add(sigKey(threadKey, snippet, minute));

  void supabase
    .from('bot_message_signatures')
    .insert({
      company_id: companyId,
      thread_key: threadKey,
      text_snippet: snippet,
      sent_at_min: minute,
    })
    .then(({ error }) => {
      if (error) {
        console.warn('[bot-signatures] insert failed:', error.message);
      }
    });
}

/**
 * Synchronous check used inside source mappers to decide whether a given
 * outbound Message should be stamped sender='bot' (AI Auto-Reply bubble) or
 * sender='agent' (manual agent reply).
 *
 * Tolerant by ±1 minute on the timestamp to absorb clock skew between the
 * local mark and the channel-assigned timestamp on the echoed message.
 */
export function isBotSent(threadKey: string, text: string, timestampMs: number): boolean {
  const minute = Math.floor(timestampMs / 60_000);
  const snippet = text.slice(0, TEXT_SNIPPET_LEN);
  return (
    localSet.has(sigKey(threadKey, snippet, minute)) ||
    localSet.has(sigKey(threadKey, snippet, minute - 1)) ||
    localSet.has(sigKey(threadKey, snippet, minute + 1))
  );
}

/** Testing / diagnostics only. */
export function _resetBotSignatures(): void {
  localSet.clear();
}
