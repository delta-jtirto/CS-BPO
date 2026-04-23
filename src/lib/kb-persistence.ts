import { supabase } from './supabase-client';
import type {
  KnowledgeChunk,
  IngestedDocument,
  KnowledgeKind,
  ChunkVisibility,
  ChunkStatus,
  ChunkSource,
} from '../app/data/types';

/**
 * Knowledge Chunks + Ingested Documents persistence layer.
 *
 * Supabase-primary storage with a thin camelCase ↔ snake_case mapping.
 * All writes are idempotent upserts keyed by the client-generated `id`;
 * concurrent writes from multiple tabs collapse into one row per id.
 *
 * RLS scopes every query to the authenticated user's companies
 * automatically — callers never pass `company_id` on reads.
 *
 * This module is ALSO the authoritative API any server-side AI or
 * edge function should use to read knowledge chunks. The shape returned
 * here is identical to what `buildPropertyContext` in kb-context.ts
 * expects.
 */

// ─── DB row shape (internal) ──────────────────────────────────────────

interface ChunkRow {
  id: string;
  company_id: string;
  host_id: string;
  prop_id: string | null;
  room_id: string | null;
  kind: KnowledgeKind;
  title: string;
  body: string;
  chunk_hash: string;
  structured: Record<string, unknown> | null;
  slot_key: string | null;
  is_override: boolean;
  supersedes: string | null;
  source: ChunkSource;
  visibility: ChunkVisibility;
  status: ChunkStatus;
  tags: string[] | null;
  created_at: string;
  updated_at: string;
}

interface DocRow {
  id: string;
  company_id: string;
  host_id: string;
  prop_id: string | null;
  filename: string;
  content_hash: string;
  uploaded_by: string;
  uploaded_at: string;
  sheets: string[] | null;
  chunk_ids: string[];
  status: 'processing' | 'ready' | 'partial' | 'failed';
  parse_error: string | null;
}

// ─── Mapping helpers ──────────────────────────────────────────────────

function rowToChunk(row: ChunkRow): KnowledgeChunk {
  return {
    id: row.id,
    hostId: row.host_id,
    propId: row.prop_id,
    roomId: row.room_id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    chunkHash: row.chunk_hash,
    structured: row.structured ?? undefined,
    slotKey: row.slot_key ?? undefined,
    isOverride: row.is_override,
    supersedes: row.supersedes ?? undefined,
    source: row.source,
    visibility: row.visibility,
    status: row.status,
    tags: row.tags ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function chunkToRow(chunk: KnowledgeChunk, companyId: string): Omit<ChunkRow, 'created_at' | 'updated_at'> & { created_at?: string; updated_at?: string } {
  return {
    id: chunk.id,
    company_id: companyId,
    host_id: chunk.hostId,
    prop_id: chunk.propId,
    room_id: chunk.roomId,
    kind: chunk.kind,
    title: chunk.title,
    body: chunk.body,
    chunk_hash: chunk.chunkHash,
    structured: chunk.structured ?? null,
    slot_key: chunk.slotKey ?? null,
    is_override: chunk.isOverride ?? false,
    supersedes: chunk.supersedes ?? null,
    source: chunk.source,
    visibility: chunk.visibility,
    status: chunk.status,
    tags: chunk.tags ?? null,
    // Let the DB pick created_at on INSERT; the trigger bumps updated_at.
    // Sending them explicitly preserves client-tracked values when round-tripping.
    created_at: chunk.createdAt || undefined,
    updated_at: chunk.updatedAt || undefined,
  };
}

function rowToDoc(row: DocRow): IngestedDocument {
  return {
    id: row.id,
    hostId: row.host_id,
    propId: row.prop_id,
    filename: row.filename,
    contentHash: row.content_hash,
    uploadedAt: row.uploaded_at,
    uploadedBy: row.uploaded_by,
    sheets: row.sheets ?? undefined,
    chunkIds: row.chunk_ids,
    status: row.status,
    parseError: row.parse_error ?? undefined,
  };
}

function docToRow(doc: IngestedDocument, companyId: string): Omit<DocRow, 'uploaded_at'> & { uploaded_at?: string } {
  return {
    id: doc.id,
    company_id: companyId,
    host_id: doc.hostId,
    prop_id: doc.propId,
    filename: doc.filename,
    content_hash: doc.contentHash,
    uploaded_by: doc.uploadedBy,
    uploaded_at: doc.uploadedAt || undefined,
    sheets: doc.sheets ?? null,
    chunk_ids: doc.chunkIds,
    status: doc.status,
    parse_error: doc.parseError ?? null,
  };
}

// ─── Public API ────────────────────────────────────────────────────────

/** Load every chunk visible to the current user. RLS filters by company. */
export async function fetchAllChunks(): Promise<KnowledgeChunk[]> {
  const { data, error } = await supabase
    .from('knowledge_chunks')
    .select('*')
    // Exclude fully-superseded chunks from the default fetch — they're
    // audit-trail only. Archived chunks ARE fetched so the Inspector can
    // show them in the Archived tab.
    .neq('status', 'superseded');
  if (error) throw error;
  return (data as ChunkRow[]).map(rowToChunk);
}

/** Load every ingested document visible to the current user. */
export async function fetchAllDocs(): Promise<IngestedDocument[]> {
  const { data, error } = await supabase
    .from('ingested_documents')
    .select('*')
    .order('uploaded_at', { ascending: false });
  if (error) throw error;
  return (data as DocRow[]).map(rowToDoc);
}

/** Batch upsert. Keyed by `id` — concurrent tabs collapse into one row. */
export async function upsertChunks(chunks: KnowledgeChunk[], companyId: string): Promise<void> {
  if (chunks.length === 0) return;
  const rows = chunks.map(c => chunkToRow(c, companyId));
  const { error } = await supabase
    .from('knowledge_chunks')
    .upsert(rows, { onConflict: 'id' });
  if (error) throw error;
}

/** Partial update by id — used for status flips and supersedes link maintenance. */
export async function updateChunk(
  id: string,
  updates: Partial<Pick<KnowledgeChunk, 'status' | 'supersedes' | 'title' | 'body' | 'chunkHash' | 'structured' | 'isOverride' | 'visibility' | 'tags'>>,
): Promise<void> {
  const row: Record<string, unknown> = {};
  if (updates.status !== undefined) row.status = updates.status;
  if (updates.supersedes !== undefined) row.supersedes = updates.supersedes ?? null;
  if (updates.title !== undefined) row.title = updates.title;
  if (updates.body !== undefined) row.body = updates.body;
  if (updates.chunkHash !== undefined) row.chunk_hash = updates.chunkHash;
  if (updates.structured !== undefined) row.structured = updates.structured ?? null;
  if (updates.isOverride !== undefined) row.is_override = updates.isOverride;
  if (updates.visibility !== undefined) row.visibility = updates.visibility;
  if (updates.tags !== undefined) row.tags = updates.tags ?? null;
  if (Object.keys(row).length === 0) return;
  const { error } = await supabase
    .from('knowledge_chunks')
    .update(row)
    .eq('id', id);
  if (error) throw error;
}

/** Hard-delete by ids. The Inspector's "Delete now" and Discard actions use this. */
export async function deleteChunks(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await supabase
    .from('knowledge_chunks')
    .delete()
    .in('id', ids);
  if (error) throw error;
}

export async function upsertDoc(doc: IngestedDocument, companyId: string): Promise<void> {
  const { error } = await supabase
    .from('ingested_documents')
    .upsert(docToRow(doc, companyId), { onConflict: 'id' });
  if (error) throw error;
}

export async function deleteDoc(id: string): Promise<void> {
  const { error } = await supabase
    .from('ingested_documents')
    .delete()
    .eq('id', id);
  if (error) throw error;
}

// ─── Retry queue + sync status ────────────────────────────────────────
//
// Every Supabase write flows through this queue. On network / RLS / quota
// errors the operation stays in the queue with exponential backoff, then
// retries automatically:
//   - every 5s as a backstop (for persistent flakiness)
//   - immediately on `online` event (for the common offline→online case)
//   - immediately when `flushKBSyncQueue()` is called (manual retry button)
//
// Listeners subscribe via `subscribeKBSyncStatus` — the header chip uses
// this to render a live "syncing / synced / offline" indicator.

export type KBSyncState = 'synced' | 'syncing' | 'offline';

export interface KBSyncStatus {
  state: KBSyncState;
  pending: number;
  lastError?: string;
  lastErrorAt?: number;
}

interface QueueEntry {
  id: string;                  // stable op-id for de-dupe
  run: () => Promise<void>;    // the actual Supabase call
  attempts: number;
  nextRetryAt: number;
  lastError?: string;
}

const queue = new Map<string, QueueEntry>();
const listeners = new Set<(s: KBSyncStatus) => void>();
let processing = false;
let lastError: string | undefined;
let lastErrorAt: number | undefined;

function deriveStatus(): KBSyncStatus {
  if (queue.size === 0) return { state: 'synced', pending: 0, lastError, lastErrorAt };
  const online = typeof navigator === 'undefined' ? true : navigator.onLine;
  return {
    state: online ? 'syncing' : 'offline',
    pending: queue.size,
    lastError,
    lastErrorAt,
  };
}

function notify() {
  const status = deriveStatus();
  for (const cb of listeners) {
    try { cb(status); } catch { /* listener errors must not break the queue */ }
  }
}

function backoffMs(attempts: number): number {
  // 1s, 2s, 4s, 8s, 16s, 32s, cap 60s.
  return Math.min(60_000, 1000 * Math.pow(2, attempts));
}

async function processQueue(): Promise<void> {
  if (processing) return;
  processing = true;
  try {
    const now = Date.now();
    // Snapshot current entries so retries don't re-enter this pass.
    const eligible = Array.from(queue.values()).filter(e => e.nextRetryAt <= now);
    for (const entry of eligible) {
      try {
        await entry.run();
        queue.delete(entry.id);
        notify();
      } catch (err) {
        entry.attempts += 1;
        entry.lastError = err instanceof Error ? err.message : String(err);
        entry.nextRetryAt = Date.now() + backoffMs(entry.attempts);
        lastError = entry.lastError;
        lastErrorAt = Date.now();
        console.warn(`[KB Sync] ${entry.id} failed (attempt ${entry.attempts}), retrying in ${Math.round(backoffMs(entry.attempts)/1000)}s:`, entry.lastError);
        notify();
      }
    }
  } finally {
    processing = false;
  }
}

/** Submit or replace a queued write. Operations with the same id collapse —
 *  later calls supersede earlier ones (e.g. rapid UI edits on the same
 *  chunk batch into one Supabase write). */
function enqueue(id: string, run: () => Promise<void>): void {
  queue.set(id, { id, run, attempts: 0, nextRetryAt: 0 });
  notify();
  // Fire immediately; subsequent retries run via the 5s interval below.
  void processQueue();
}

/** Public flush — callable from a "retry now" button or online event. */
export function flushKBSyncQueue(): void {
  for (const entry of queue.values()) entry.nextRetryAt = 0;
  void processQueue();
}

/** Subscribe to sync status changes. Returns an unsubscribe fn. */
export function subscribeKBSyncStatus(cb: (s: KBSyncStatus) => void): () => void {
  listeners.add(cb);
  cb(deriveStatus());
  return () => { listeners.delete(cb); };
}

export function getKBSyncStatus(): KBSyncStatus {
  return deriveStatus();
}

// Global retry scaffolding — runs forever in the tab.
if (typeof window !== 'undefined') {
  // Periodic backstop (5s). Cheap — no-op when queue is empty.
  setInterval(() => { if (queue.size > 0) void processQueue(); }, 5000);
  // Immediate flush on reconnect.
  window.addEventListener('online', () => { flushKBSyncQueue(); });
  // Opportunistic flush on tab refocus — users often come back expecting sync.
  window.addEventListener('focus', () => { if (queue.size > 0) void processQueue(); });
}

// ─── Queued variants (the mutators in AppContext use these) ───────────

export function enqueueUpsertChunks(chunks: KnowledgeChunk[], companyId: string): void {
  if (chunks.length === 0) return;
  // One queue entry per chunk batch keyed by the sorted id list — rapid
  // sequential upserts of overlapping chunk sets collapse into a single
  // pending write, preserving the most recent state.
  const key = `chunks:upsert:${chunks.map(c => c.id).sort().join(',')}`;
  enqueue(key, () => upsertChunks(chunks, companyId));
}

export function enqueueUpdateChunk(
  id: string,
  updates: Parameters<typeof updateChunk>[1],
): void {
  // Collapse multiple rapid updates on the same chunk into the latest set.
  const key = `chunks:update:${id}`;
  enqueue(key, () => updateChunk(id, updates));
}

export function enqueueDeleteChunks(ids: string[]): void {
  if (ids.length === 0) return;
  const key = `chunks:delete:${[...ids].sort().join(',')}`;
  enqueue(key, () => deleteChunks(ids));
}

export function enqueueUpsertDoc(doc: IngestedDocument, companyId: string): void {
  const key = `docs:upsert:${doc.id}`;
  enqueue(key, () => upsertDoc(doc, companyId));
}

export function enqueueDeleteDoc(id: string): void {
  const key = `docs:delete:${id}`;
  enqueue(key, () => deleteDoc(id));
}

// ─── Realtime ──────────────────────────────────────────────────────────

/** Subscribe to chunk and doc changes. Returns an unsubscribe fn. */
export function subscribeKBRealtime(handlers: {
  onChunkChange: (event: 'INSERT' | 'UPDATE' | 'DELETE', chunk: KnowledgeChunk | { id: string }) => void;
  onDocChange: (event: 'INSERT' | 'UPDATE' | 'DELETE', doc: IngestedDocument | { id: string }) => void;
}): () => void {
  const chunkChannel = supabase
    .channel('kb-chunks')
    .on(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      'postgres_changes' as any,
      { event: '*', schema: 'public', table: 'knowledge_chunks' },
      (payload: { eventType: 'INSERT' | 'UPDATE' | 'DELETE'; new: ChunkRow; old: { id?: string } }) => {
        if (payload.eventType === 'DELETE') {
          if (payload.old?.id) handlers.onChunkChange('DELETE', { id: payload.old.id });
          return;
        }
        handlers.onChunkChange(payload.eventType, rowToChunk(payload.new));
      },
    )
    .subscribe();

  const docChannel = supabase
    .channel('kb-docs')
    .on(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      'postgres_changes' as any,
      { event: '*', schema: 'public', table: 'ingested_documents' },
      (payload: { eventType: 'INSERT' | 'UPDATE' | 'DELETE'; new: DocRow; old: { id?: string } }) => {
        if (payload.eventType === 'DELETE') {
          if (payload.old?.id) handlers.onDocChange('DELETE', { id: payload.old.id });
          return;
        }
        handlers.onDocChange(payload.eventType, rowToDoc(payload.new));
      },
    )
    .subscribe();

  return () => {
    supabase.removeChannel(chunkChannel);
    supabase.removeChannel(docChannel);
  };
}
