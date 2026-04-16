/**
 * Agent-side manual overrides on proxy conversations (Supabase-backed).
 *
 * Keeps channel-sync data (public.conversations) separate from human input.
 * The UI reads overrides as a flat `Record<conversation_id, overrides>` and
 * writes via a single `setOverride(conversationId, field, value)` API that
 * upserts to Supabase and updates local state immediately.
 *
 * New override fields (e.g. manual room, tags, pinned notes) are added by:
 *   1. ALTER TABLE public.conversation_overrides ADD COLUMN ...
 *   2. Extend `ConversationOverride` below
 *   3. Pass the new field name to setOverride — no API reshape required.
 */

import { useCallback, useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { toast } from 'sonner';

export interface ConversationOverride {
  /** Property name manually picked by the agent for tickets without a PMS booking. */
  property?: string | null;
}

type OverrideField = keyof ConversationOverride;

interface UseConversationOverridesOptions {
  supabase: SupabaseClient;
  companyIds: string[];
}

interface UseConversationOverridesResult {
  /** Map of conversation_id (uuid) → override fields. */
  overrides: Record<string, ConversationOverride>;
  isLoading: boolean;
  /**
   * Upsert a single override field for a conversation. Updates local state
   * optimistically; on failure, logs and rolls back.
   */
  setOverride: <K extends OverrideField>(
    conversationId: string,
    companyId: string,
    field: K,
    value: ConversationOverride[K],
  ) => Promise<void>;
}

export function useConversationOverrides({
  supabase,
  companyIds,
}: UseConversationOverridesOptions): UseConversationOverridesResult {
  const [overrides, setOverrides] = useState<Record<string, ConversationOverride>>({});
  const [isLoading, setIsLoading] = useState(true);

  // Initial fetch — one round trip per company set change
  useEffect(() => {
    if (companyIds.length === 0) {
      setOverrides({});
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);

    supabase
      .from('conversation_overrides')
      .select('conversation_id, property')
      .in('company_id', companyIds)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.error('[conversation_overrides] fetch failed:', error);
          setOverrides({});
        } else {
          const map: Record<string, ConversationOverride> = {};
          for (const row of data ?? []) {
            map[row.conversation_id] = { property: row.property };
          }
          setOverrides(map);
        }
        setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // Stringify so the effect doesn't re-fire on a new-but-equal array reference
  }, [supabase, companyIds.join(',')]);

  const setOverride = useCallback<UseConversationOverridesResult['setOverride']>(
    async (conversationId, companyId, field, value) => {
      // Optimistic update — snapshot previous so we can roll back on failure
      const previous = overrides[conversationId];
      setOverrides(prev => ({
        ...prev,
        [conversationId]: { ...prev[conversationId], [field]: value },
      }));

      const { error } = await supabase
        .from('conversation_overrides')
        .upsert(
          {
            conversation_id: conversationId,
            company_id: companyId,
            [field]: value,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'conversation_id' },
        );

      if (error) {
        console.error('[conversation_overrides] upsert failed:', error);
        toast.error('Failed to save property override', {
          description: error.message,
        });
        // Roll back
        setOverrides(prev => {
          const next = { ...prev };
          if (previous === undefined) {
            delete next[conversationId];
          } else {
            next[conversationId] = previous;
          }
          return next;
        });
      }
    },
    [supabase, overrides],
  );

  return { overrides, isLoading, setOverride };
}
