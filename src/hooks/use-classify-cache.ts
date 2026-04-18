/**
 * Persisted cache for LLM classify-inquiry results.
 *
 * Mirrors use-conversation-overrides.ts: one fetch on mount, optimistic upsert,
 * RLS-scoped to the user's companies. Unlike that hook, thread_key is a text
 * ticket.id so it works for both Firestore threads and proxy conversations.
 *
 * Contract: caller supplies a signature (lastMessageId + messageCount +
 * modelVersion) together with the result. A future read returns the stored
 * result ONLY when all three signature components still match — otherwise the
 * caller should re-run the LLM and overwrite the row.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ClassifyResult } from '@/app/components/inbox/InquiryDetector';

export interface ClassifySignature {
  lastMessageId: string;
  messageCount: number;
  modelVersion: string;
}

export interface ClassifyCacheEntry {
  signature: ClassifySignature;
  result: ClassifyResult;
  classifiedAt: number; // epoch ms
}

interface UseClassifyCacheOptions {
  supabase: SupabaseClient;
  companyIds: string[];
}

export interface UseClassifyCacheResult {
  /** Map of thread_key → cached entry. Only contains rows for the current companies. */
  entries: Record<string, ClassifyCacheEntry>;
  isLoading: boolean;
  /**
   * Synchronous read: returns the cached result only if the given signature
   * matches the stored one. Otherwise returns null and the caller should
   * re-classify.
   */
  getIfFresh: (threadKey: string, signature: ClassifySignature) => ClassifyResult | null;
  /**
   * Upsert the cache entry for a thread. Updates local state optimistically
   * so a same-session re-render sees the value without a round-trip.
   */
  save: (
    threadKey: string,
    companyId: string,
    signature: ClassifySignature,
    result: ClassifyResult,
  ) => Promise<void>;
}

interface RowShape {
  thread_key: string;
  last_message_id: string;
  message_count: number;
  model_version: string;
  result: ClassifyResult;
  classified_at: string; // ISO
}

export function useClassifyCache({
  supabase,
  companyIds,
}: UseClassifyCacheOptions): UseClassifyCacheResult {
  const [entries, setEntries] = useState<Record<string, ClassifyCacheEntry>>({});
  // Stays `true` until the first fetch with non-empty companyIds resolves.
  // Consumers gate their "should I run the LLM?" decision on this so they
  // don't fall through on the empty-companies render that happens between
  // mount and Supabase auth resolving.
  const [isLoading, setIsLoading] = useState(true);
  const didHydrateRef = useRef(false);

  // Ref mirror so getIfFresh (used inside effects/callbacks) always sees the
  // latest map without joining the closure deps of its consumers.
  const entriesRef = useRef(entries);
  entriesRef.current = entries;

  // Initial fetch — one round trip per company set change.
  useEffect(() => {
    if (companyIds.length === 0) {
      // Only declare "done loading" once we've actually hydrated at least
      // once. Otherwise, the brief empty-companies window between mount and
      // Supabase session resolution would flip isLoading to false, tricking
      // callers into treating an empty cache as authoritative.
      setEntries({});
      if (didHydrateRef.current) setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);

    supabase
      .from('thread_ai_classify')
      .select('thread_key, last_message_id, message_count, model_version, result, classified_at')
      .in('company_id', companyIds)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.error('[thread_ai_classify] fetch failed:', error);
          setEntries({});
        } else {
          const map: Record<string, ClassifyCacheEntry> = {};
          for (const row of (data ?? []) as RowShape[]) {
            map[row.thread_key] = {
              signature: {
                lastMessageId: row.last_message_id,
                messageCount: row.message_count,
                modelVersion: row.model_version,
              },
              result: row.result,
              classifiedAt: new Date(row.classified_at).getTime(),
            };
          }
          setEntries(map);
        }
        didHydrateRef.current = true;
        setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // Stringify so a new-but-equal companyIds array doesn't re-fire the fetch
  }, [supabase, companyIds.join(',')]);

  const getIfFresh = useCallback<UseClassifyCacheResult['getIfFresh']>(
    (threadKey, signature) => {
      const hit = entriesRef.current[threadKey];
      if (!hit) return null;
      if (
        hit.signature.lastMessageId === signature.lastMessageId &&
        hit.signature.messageCount === signature.messageCount &&
        hit.signature.modelVersion === signature.modelVersion
      ) {
        return hit.result;
      }
      return null;
    },
    [],
  );

  const save = useCallback<UseClassifyCacheResult['save']>(
    async (threadKey, companyId, signature, result) => {
      const classifiedAt = Date.now();
      // Optimistic local update so same-session reads hit immediately
      setEntries((prev) => ({
        ...prev,
        [threadKey]: { signature, result, classifiedAt },
      }));

      const { error } = await supabase
        .from('thread_ai_classify')
        .upsert(
          {
            company_id: companyId,
            thread_key: threadKey,
            last_message_id: signature.lastMessageId,
            message_count: signature.messageCount,
            model_version: signature.modelVersion,
            result,
            classified_at: new Date(classifiedAt).toISOString(),
          },
          { onConflict: 'company_id,thread_key' },
        );

      if (error) {
        // Keep the optimistic entry — next fetch will reconcile. Log loudly
        // because a failed upsert means we'll re-run the LLM on reload.
        console.error('[thread_ai_classify] upsert failed:', error);
      }
    },
    [supabase],
  );

  return { entries, isLoading, getIfFresh, save };
}
