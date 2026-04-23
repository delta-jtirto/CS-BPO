import type { KnowledgeChunk } from '../data/types';

/**
 * Deterministic client-side diff for a re-ingest.
 *
 * Compares freshly extracted chunks (from Stage B) against the existing
 * chunks in the store, bucketed by what should happen to each. No AI calls
 * here — this is pure logic so it's testable and predictable.
 *
 * Two invariants govern the output:
 *
 * 1. OVERRIDES ARE SACRED. Any chunk with `isOverride=true` is never
 *    silently replaced. If the new doc proposes a different value for the
 *    same slot, the proposal lands in `pendingReview` for the user to
 *    resolve. If the new doc doesn't mention the slot at all, the override
 *    stays put, untouched.
 *
 * 2. DOC-LAYER CHUNKS ARE DOCUMENT-SCOPED FOR FREE-FORM KINDS. LLMs can't
 *    stably identify "the same FAQ" across versions, so when we re-ingest
 *    doc X, ALL non-override free-form chunks from doc X get archived and
 *    the new ones replace them wholesale. property_fact chunks use
 *    slotKey-based matching because they're enum-constrained.
 */

export interface DiffInput {
  /** Chunks freshly extracted from a Stage B ingest for this doc. */
  newChunks: KnowledgeChunk[];
  /** All chunks currently in the store (scoped to the caller's hostId / propId
   *  is optional — this function only looks at what's passed in). */
  existingChunks: KnowledgeChunk[];
  /** The IngestedDocument.id for the re-upload. Used to identify which
   *  existing chunks belong to this doc for archive-and-replace. */
  docId: string;
  /** The IngestedDocument.id of the previous upload for this filename, if
   *  different from `docId` (rare — only if the filename changed). */
  previousDocId?: string;
}

export interface PendingReviewItem {
  /** Why this chunk needs human review. */
  reason: 'override_conflict' | 'missing_slot' | 'low_confidence' | 'unmapped_fact';
  /** The new chunk proposed by the router (if any). Null means the slot
   *  disappeared from the new doc. */
  proposed: KnowledgeChunk | null;
  /** The existing chunk this conflicts with (if any). */
  existing: KnowledgeChunk | null;
}

export interface DiffOutcome {
  /** Chunks to write as-is (new slot, or unambiguous doc-layer replacement). */
  toInsert: KnowledgeChunk[];
  /** Existing chunk ids to flip to status='archived'. */
  toArchive: string[];
  /** Existing override chunks that should have their `supersedes` link
   *  cleared (the old doc chunk they pointed to just got archived). Not
   *  destructive — just housekeeping. */
  toUnlink: string[];
  /** Chunks unchanged between old and new (same slot + same chunkHash) —
   *  skip the DB write. Surfaced as a count in the summary. */
  unchangedCount: number;
  /** Conflict and missing-slot items that need a human decision. */
  pendingReview: PendingReviewItem[];
  /** Summary counts for the re-ingest summary card. */
  summary: {
    newCount: number;
    unchangedCount: number;
    archivedCount: number;
    pendingCount: number;
  };
}

export function diffReingest(input: DiffInput): DiffOutcome {
  const { newChunks, existingChunks, docId, previousDocId } = input;
  const now = new Date().toISOString();

  const toInsert: KnowledgeChunk[] = [];
  const toArchive = new Set<string>();
  const toUnlink: string[] = [];
  const pendingReview: PendingReviewItem[] = [];
  let unchangedCount = 0;

  // Index existing chunks for fast lookups.
  const existingBySlot = new Map<string, KnowledgeChunk[]>(); // slotKey → chunks
  const existingByDocId: KnowledgeChunk[] = [];
  for (const c of existingChunks) {
    if (c.slotKey) {
      const list = existingBySlot.get(c.slotKey) ?? [];
      list.push(c);
      existingBySlot.set(c.slotKey, list);
    }
    if (c.source.docId === docId || (previousDocId && c.source.docId === previousDocId)) {
      existingByDocId.push(c);
    }
  }

  const touchedSlotKeys = new Set<string>();
  const touchedExistingIds = new Set<string>();

  // ─── Pass 1: process new chunks ───────────────────────────────────────
  for (const incoming of newChunks) {
    // Router-flagged pending_review (low confidence, unmapped facts) — ship
    // it through to review without trying to reconcile against existing state.
    if (incoming.status === 'pending_review') {
      pendingReview.push({
        reason: incoming.slotKey ? 'low_confidence' : 'unmapped_fact',
        proposed: incoming,
        existing: null,
      });
      toInsert.push(incoming);
      continue;
    }

    // property_fact → slot-keyed reconciliation.
    if (incoming.slotKey) {
      touchedSlotKeys.add(incoming.slotKey);
      const existingForSlot = existingBySlot.get(incoming.slotKey) ?? [];

      const activeOverride = existingForSlot.find(c => c.isOverride && c.status === 'active');
      const activeDoc = existingForSlot.find(c => !c.isOverride && c.status === 'active');

      if (activeOverride) {
        // Override takes precedence. Compare values.
        if (activeOverride.body.trim() === incoming.body.trim()) {
          // New doc now agrees — drop the redundant override; keep the doc.
          toArchive.add(activeOverride.id);
          if (activeDoc) touchedExistingIds.add(activeDoc.id);
          if (!activeDoc || activeDoc.chunkHash !== incoming.chunkHash) {
            if (activeDoc) toArchive.add(activeDoc.id);
            toInsert.push(incoming);
          } else {
            unchangedCount++;
          }
        } else {
          // Real conflict — stage new as pending_review, keep override.
          pendingReview.push({
            reason: 'override_conflict',
            proposed: { ...incoming, status: 'pending_review' },
            existing: activeOverride,
          });
          toInsert.push({ ...incoming, status: 'pending_review' });
        }
        continue;
      }

      if (activeDoc) {
        touchedExistingIds.add(activeDoc.id);
        if (activeDoc.chunkHash === incoming.chunkHash) {
          unchangedCount++;
        } else {
          toArchive.add(activeDoc.id);
          toInsert.push(incoming);
        }
        continue;
      }

      // New slot — just insert.
      toInsert.push(incoming);
      continue;
    }

    // Free-form chunk — insert as new. Prior chunks for this doc get
    // archived in Pass 2.
    toInsert.push(incoming);
  }

  // ─── Pass 2: archive stale doc-layer chunks ───────────────────────────
  for (const existing of existingByDocId) {
    if (existing.status !== 'active') continue;
    if (existing.isOverride) continue;          // never touch overrides
    if (touchedExistingIds.has(existing.id)) continue;

    if (existing.slotKey) {
      // property_fact — if the new doc didn't touch this slot, surface as
      // "missing slot" (don't silently archive — AI might have just missed it).
      if (!touchedSlotKeys.has(existing.slotKey)) {
        pendingReview.push({
          reason: 'missing_slot',
          proposed: null,
          existing,
        });
      }
      continue;
    }

    // Free-form chunk that belongs to this doc but wasn't re-emitted by
    // the new ingest → archive. Surface existing overrides that pointed at
    // it via `supersedes` so the UI can offer a re-link.
    toArchive.add(existing.id);
    for (const c of existingChunks) {
      if (c.supersedes === existing.id && c.isOverride) {
        toUnlink.push(c.id);
      }
    }
  }

  // Timestamp the inserts. Keep status as-is (router already set 'active'
  // for confident chunks and 'pending_review' for low-confidence ones).
  for (const c of toInsert) {
    c.updatedAt = now;
    if (!c.createdAt) c.createdAt = now;
  }

  return {
    toInsert,
    toArchive: Array.from(toArchive),
    toUnlink,
    unchangedCount,
    pendingReview,
    summary: {
      newCount: toInsert.filter(c => c.status === 'active').length,
      unchangedCount,
      archivedCount: toArchive.size,
      pendingCount: pendingReview.length,
    },
  };
}
