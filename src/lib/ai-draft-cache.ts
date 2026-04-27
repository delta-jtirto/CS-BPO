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

// ─── V1 legacy shape (SmartReply phase-based) ────────────
// Kept for read-only legacy compatibility during the v2 rollout. New
// writes never use this shape; old rows surface as `{legacy: true}` in
// loadDraft and the UI offers a "Regenerate to upgrade" action.

export interface StoredDraft {
  composedMessage: string;
  decisions: Record<string, 'yes' | 'no'>;
  customTexts: Record<string, string>;
  triggered?: boolean;
}

// ─── V2 shape (SmartReply v2 — per-inquiry sections) ─────

export type StoredSectionSource = 'ai' | 'agent-edit' | 'agent-regen' | 'auto-reply';

export interface StoredSection {
  /** Stable content-derived key from InquiryDetector.deriveInquiryKey.
   *  Survives re-classification so agent edits aren't lost when the LLM
   *  shuffles positional ids. */
  inquiryKey: string;
  text: string;
  covered: boolean;
  confidence: number;
  source: StoredSectionSource;
  isSkipped?: boolean;
  /** Set once the agent types into this section's textarea. Cleared on
   *  regenerate. */
  isEdited?: boolean;
  /** FNV hash of (text at write time) + messagesHash when saved — used by
   *  per-section staleness detection. Drift in this hash means: either the
   *  thread advanced, or this specific text changed. */
  snippetHash: string;
}

export type StoredPromisedAction = {
  action: 'dispatch_maintenance' | 'check_availability' | 'confirm_booking_detail' | 'contact_vendor' | 'custom';
  summary: string;
  urgency: 'normal' | 'high';
  confidence: number;
};

export interface StoredDraftV2 {
  version: 2;
  greeting: string;
  /** Keyed by inquiryKey for O(1) section lookup during edit/regen. */
  sections: Record<string, StoredSection>;
  closing: string;
  outcome: 'answered' | 'partial' | 'escalate';
  riskScore: number;
  escalateTopics: string[];
  promisedActions: StoredPromisedAction[];
  /** Marks the LLM output as having tripped the banned-phrase scan at
   *  compose time. UI uses this to force review-before-send. */
  safetyFlagged?: boolean;
  /** Last assembled text the hook pushed to the compose box via onInsert.
   *  On reopen, the collision detector compares `existingDraft` against
   *  this — equal means the reply box holds our OWN prior insert (no
   *  collision), different means the agent typed over it (real collision). */
  lastSyncedText?: string;
}

export type AnyStoredDraft = StoredDraft | StoredDraftV2;

export interface DraftRow {
  draft: StoredDraft;
  messagesHash: string;
  source: 'ai' | 'agent';
  updatedAt: string;
}

export interface DraftRowV2 {
  draft: StoredDraftV2;
  messagesHash: string;
  source: StoredSectionSource;
  updatedAt: string;
}

/** Discriminated result from loadDraft — consumers branch on `legacy`. */
export type LoadedDraft =
  | (DraftRowV2 & { legacy: false })
  | (DraftRow & { legacy: true });

function isV2Draft(draft: unknown): draft is StoredDraftV2 {
  if (!draft || typeof draft !== 'object') return false;
  const d = draft as Record<string, unknown>;
  return d.version === 2 && typeof d.sections === 'object' && d.sections !== null;
}

function isV1Draft(draft: unknown): draft is StoredDraft {
  if (!draft || typeof draft !== 'object') return false;
  const d = draft as Record<string, unknown>;
  return typeof d.composedMessage === 'string';
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
  if (!isV1Draft(draft)) {
    // V2 row (or junk). V1 loadDraft intentionally returns null so the
    // old SmartReply flow treats it as a cache miss instead of crashing
    // on a missing composedMessage field. The flag-gated v2 code path
    // uses loadDraftV2 instead.
    return null;
  }

  return {
    draft,
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

// ─── V2 helpers (SmartReply v2 / unified auto-reply) ─────

/**
 * Stable hash of a single section's text tied to the messages hash at write
 * time. Drift (text changed OR thread advanced) surfaces a per-section stale
 * pill in the UI without wiping the edit — the agent chooses to regenerate.
 * FNV-1a, same algorithm as computeMessagesHash.
 */
export function computeSnippetHash(text: string, messagesHash: string): string {
  const s = `${messagesHash}|${text.length}|${text}`;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

/**
 * Load either a V2 section-based draft, a V1 legacy draft, or nothing.
 * Consumers branch on the `legacy` discriminator — V2 code renders cards
 * from `draft.sections`; V1 rows surface a "Regenerate to upgrade" banner
 * and disable inline edit until the agent regenerates.
 */
export async function loadDraftV2(
  supabase: SupabaseClient,
  params: { companyId: string; threadKey: string },
): Promise<LoadedDraft | null> {
  const { data, error } = await supabase
    .from('ai_reply_drafts')
    .select('draft, messages_hash, source, updated_at')
    .eq('company_id', params.companyId)
    .eq('thread_key', params.threadKey)
    .maybeSingle();

  if (error) {
    console.warn('[ai-draft-cache] loadV2 failed:', error.message);
    return null;
  }
  if (!data) return null;

  const draft = data.draft as unknown;
  const sourceRaw = String(data.source ?? 'ai');

  if (isV2Draft(draft)) {
    const source: StoredSectionSource =
      sourceRaw === 'agent-edit' ? 'agent-edit'
      : sourceRaw === 'agent-regen' ? 'agent-regen'
      : sourceRaw === 'auto-reply' ? 'auto-reply'
      : 'ai';
    return {
      legacy: false,
      draft,
      messagesHash: String(data.messages_hash ?? ''),
      source,
      updatedAt: String(data.updated_at ?? ''),
    };
  }

  if (isV1Draft(draft)) {
    return {
      legacy: true,
      draft,
      messagesHash: String(data.messages_hash ?? ''),
      source: sourceRaw === 'agent' ? 'agent' : 'ai',
      updatedAt: String(data.updated_at ?? ''),
    };
  }

  return null;
}

/**
 * Upsert a V2 section-based draft. Callers: SmartReply v2 (per-keystroke
 * debounced) and — Phase C — useAutoReply's draft-mode branch.
 */
export async function saveDraftV2(
  supabase: SupabaseClient,
  params: {
    companyId: string;
    threadKey: string;
    draft: StoredDraftV2;
    messagesHash: string;
    source: StoredSectionSource;
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
    console.warn('[ai-draft-cache] saveV2 failed:', error.message);
  }
}
