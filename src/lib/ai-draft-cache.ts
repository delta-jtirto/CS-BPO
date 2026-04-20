/**
 * Persistent draft cache backed by public.ai_reply_drafts.
 *
 * One row per (company_id, thread_key). messages_hash lives as a column,
 * NOT part of the primary key — so a new guest message arriving mid-edit
 * doesn't silently wipe the agent's in-progress text. On load, callers
 * compare the stored hash to the current thread hash and, if they diverge,
 * surface a "new messages since this draft" banner instead of throwing
 * the draft away.
 *
 * Writes are debounced at the caller (useSmartReply) to keep the Supabase
 * round-trip count reasonable during rapid typing / recomposition.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface StoredDraft {
  composedMessage: string;
  decisions: Record<string, 'yes' | 'no'>;
  customTexts: Record<string, string>;
  triggered?: boolean;
}

export interface DraftRow {
  draft: StoredDraft;
  messagesHash: string;
  source: 'ai' | 'agent';
  updatedAt: string;
}

/**
 * Stable hash over the messages list. Used as the staleness signature:
 * while the hash matches, a cached draft is "in sync" with the thread.
 *
 * Includes ids + sender + text so reorderings (rare, but possible when
 * Firestore resyncs) invalidate the draft; does NOT include time
 * formatting or other derived fields. Cheap to compute per render.
 */
export function computeMessagesHash(
  messages: Array<{ id: number | string; sender: string; text?: string; createdAt?: number }>,
): string {
  if (!messages || messages.length === 0) return 'empty';
  // FNV-1a over a compact serialization. Plenty good for drift detection
  // without pulling in a crypto hash.
  let h = 2166136261;
  for (const m of messages) {
    const s = `${m.id}|${m.sender}|${(m.text ?? '').length}|${m.createdAt ?? 0};`;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
  }
  return `${messages.length}:${(h >>> 0).toString(16)}`;
}

export async function loadDraft(
  supabase: SupabaseClient,
  params: { companyId: string; threadKey: string },
): Promise<DraftRow | null> {
  const { data, error } = await supabase
    .from('ai_reply_drafts')
    .select('draft, messages_hash, source, updated_at')
    .eq('company_id', params.companyId)
    .eq('thread_key', params.threadKey)
    .maybeSingle();

  if (error) {
    console.warn('[ai-draft-cache] load failed:', error.message);
    return null;
  }
  if (!data) return null;

  // Defensive shape-check: DB is jsonb so if someone hand-wrote garbage,
  // don't crash the panel. Treat as a cache miss.
  const draft = data.draft as unknown;
  if (!draft || typeof draft !== 'object' || typeof (draft as StoredDraft).composedMessage !== 'string') {
    return null;
  }

  return {
    draft: draft as StoredDraft,
    messagesHash: String(data.messages_hash ?? ''),
    source: (data.source === 'agent' ? 'agent' : 'ai'),
    updatedAt: String(data.updated_at ?? ''),
  };
}

export async function saveDraft(
  supabase: SupabaseClient,
  params: {
    companyId: string;
    threadKey: string;
    draft: StoredDraft;
    messagesHash: string;
    source: 'ai' | 'agent';
  },
): Promise<void> {
  const { error } = await supabase
    .from('ai_reply_drafts')
    .upsert(
      {
        company_id: params.companyId,
        thread_key: params.threadKey,
        draft: params.draft as unknown as Record<string, unknown>,
        messages_hash: params.messagesHash,
        source: params.source,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'company_id,thread_key' },
    );

  if (error) {
    console.warn('[ai-draft-cache] save failed:', error.message);
  }
}

export async function clearDraft(
  supabase: SupabaseClient,
  params: { companyId: string; threadKey: string },
): Promise<void> {
  const { error } = await supabase
    .from('ai_reply_drafts')
    .delete()
    .eq('company_id', params.companyId)
    .eq('thread_key', params.threadKey);

  if (error) {
    console.warn('[ai-draft-cache] clear failed:', error.message);
  }
}
