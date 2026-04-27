/**
 * KB slice — knowledge chunks, ingested documents, and the derived
 * legacy `kbEntries` view. Owns three layers of persistence (Supabase,
 * IndexedDB, runtime state) and the realtime sync between them.
 *
 * Cross-slice surface:
 *   - Inbound: `proxyCompanyIds` from the Connections slice (scope for
 *     Supabase fetch / realtime subscription).
 *   - Outbound: refs prefixed `_` (knowledgeChunksRef, chunksHydratedRef,
 *     serverSyncedRef, companyIdRef) that the Onboarding slice's
 *     onboarding-form → KB-chunk backfill effect needs to read. Public
 *     fields are unprefixed and identical to AppState.
 *
 * Storage layers (in order of authority):
 *   1. Supabase (canonical, multi-device, RLS-scoped)
 *   2. IndexedDB (instant-render cache — shows data before network resolves)
 *   3. React state (runtime)
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KBEntry, KnowledgeChunk, IngestedDocument } from '../../data/types';
import { kvGet, kvSet, stableHash, STORAGE_KEYS } from '../../lib/storage';
import * as kbPersist from '@/lib/kb-persistence';
import { MOCK_KB } from '../../data/mock-data';

/**
 * Project a manual-sourced KnowledgeChunk into the legacy KBEntry
 * shape so callers of `kbEntries` (KnowledgeBaseView's inline editor,
 * InquiryDetector's legacy consumers) keep working without rewriting.
 *
 * The chunk id convention is `manual-${timestamp}`; we extract the
 * timestamp as the KBEntry's numeric id. For chunks with unexpected ids
 * we hash to a stable positive int so the legacy UI can still key them.
 */
function chunkToKBEntry(c: KnowledgeChunk): KBEntry {
  const legacyIdMatch = c.id.match(/^manual-(\d+)/);
  let numericId: number;
  if (legacyIdMatch) {
    numericId = parseInt(legacyIdMatch[1], 10);
  } else {
    let h = 0;
    for (let i = 0; i < c.id.length; i++) {
      h = ((h * 31) + c.id.charCodeAt(i)) | 0;
    }
    numericId = Math.abs(h) || 1;
  }
  return {
    id: numericId,
    hostId: c.hostId,
    propId: c.propId,
    roomId: c.roomId,
    scope: c.roomId ? 'Room' : c.propId ? 'Property' : 'Host Global',
    title: c.title,
    content: c.body,
    tags: c.tags,
    internal: c.visibility === 'internal',
    source: 'manual',
    sectionId: typeof c.structured?.sectionId === 'string' ? c.structured.sectionId : undefined,
  };
}

export interface KBSliceParams {
  /** From Connections slice. Scope for Supabase fetch + realtime subscribe. */
  proxyCompanyIds: string[];
}

export interface KBSlicePublic {
  // Knowledge chunks (canonical store)
  knowledgeChunks: KnowledgeChunk[];
  upsertKnowledgeChunks: (chunks: KnowledgeChunk[]) => void;
  updateKnowledgeChunk: (id: string, updates: Partial<KnowledgeChunk>) => void;
  deleteKnowledgeChunks: (ids: string[]) => void;
  // Ingested documents
  ingestedDocuments: IngestedDocument[];
  upsertIngestedDocument: (doc: IngestedDocument) => void;
  deleteIngestedDocument: (id: string) => void;
  // Derived legacy view + its mutators (write through to chunks)
  kbEntries: KBEntry[];
  addKBEntry: (entry: Omit<KBEntry, 'id'>) => Promise<void>;
  updateKBEntry: (id: number, updates: Partial<KBEntry>) => Promise<void>;
  deleteKBEntry: (id: number) => void;
  deleteKBEntriesBySource: (propId: string, source: 'onboarding' | 'manual') => void;
}

export interface KBSliceInternal {
  /** Latest-value ref. Onboarding's backfill effect reads this. */
  _knowledgeChunksRef: React.MutableRefObject<KnowledgeChunk[]>;
  /** True once the IndexedDB hydrate has completed. Onboarding waits on it. */
  _chunksHydratedRef: React.MutableRefObject<boolean>;
  /** True once the Supabase fetch + migration has run. Onboarding waits on it. */
  _serverSyncedRef: React.MutableRefObject<boolean>;
  /** Company id used for Supabase scope on writes. */
  _companyIdRef: React.MutableRefObject<string | null>;
  /** Raw setter — composer uses it from `resetToDemo` to wipe runtime
   *  state without firing the per-chunk persistence calls. */
  _setKnowledgeChunks: React.Dispatch<React.SetStateAction<KnowledgeChunk[]>>;
}

export type KBSliceReturn = KBSlicePublic & KBSliceInternal;

export function useKBSlice({ proxyCompanyIds }: KBSliceParams): KBSliceReturn {
  // MOCK_KB seed pool, merged in via the kbEntries memo when the chunk
  // store is empty for demos. Writing to a MOCK seed entry no-ops because
  // its id has no backing chunk.
  const [mockKbSeed] = useState<KBEntry[]>(MOCK_KB);

  const [knowledgeChunks, setKnowledgeChunks] = useState<KnowledgeChunk[]>([]);
  const [ingestedDocuments, setIngestedDocuments] = useState<IngestedDocument[]>([]);

  // Latest-value refs so async effects (Supabase hydrate) can snapshot
  // current state without capturing stale closures.
  const knowledgeChunksRef = useRef(knowledgeChunks);
  const ingestedDocumentsRef = useRef(ingestedDocuments);
  useEffect(() => { knowledgeChunksRef.current = knowledgeChunks; }, [knowledgeChunks]);
  useEffect(() => { ingestedDocumentsRef.current = ingestedDocuments; }, [ingestedDocuments]);

  // Derived kbEntries — projection of manual-sourced active chunks into
  // the legacy `KBEntry` shape, merged with MOCK_KB seeds for demos.
  const kbEntries = useMemo<KBEntry[]>(() => {
    const manualChunks = knowledgeChunks
      .filter(c => c.source.type === 'manual' && c.status === 'active')
      .map(chunkToKBEntry);
    // Dedupe: a MOCK seed and a user-created chunk could collide on id.
    const byId = new Map<number, KBEntry>();
    for (const e of mockKbSeed) byId.set(e.id, e);
    for (const e of manualChunks) byId.set(e.id, e);
    return Array.from(byId.values());
  }, [knowledgeChunks, mockKbSeed]);

  const companyIdRef = useRef<string | null>(null);

  // ─── Mutators ─────────────────────────────────────────────────────────
  const upsertKnowledgeChunks = useCallback((chunks: KnowledgeChunk[]) => {
    setKnowledgeChunks(prev => {
      const byId = new Map(prev.map(c => [c.id, c]));
      for (const c of chunks) byId.set(c.id, c);
      return Array.from(byId.values());
    });
    const companyId = companyIdRef.current;
    if (!companyId) return;
    kbPersist.enqueueUpsertChunks(chunks, companyId);
  }, []);

  const updateKnowledgeChunk = useCallback((id: string, updates: Partial<KnowledgeChunk>) => {
    const nowIso = new Date().toISOString();
    setKnowledgeChunks(prev => prev.map(c =>
      c.id === id ? { ...c, ...updates, updatedAt: nowIso } : c,
    ));
    kbPersist.enqueueUpdateChunk(id, updates);
  }, []);

  const deleteKnowledgeChunks = useCallback((ids: string[]) => {
    const idSet = new Set(ids);
    setKnowledgeChunks(prev => prev.filter(c => !idSet.has(c.id)));
    kbPersist.enqueueDeleteChunks(ids);
  }, []);

  const upsertIngestedDocument = useCallback((doc: IngestedDocument) => {
    setIngestedDocuments(prev => {
      const idx = prev.findIndex(d => d.id === doc.id);
      if (idx === -1) return [...prev, doc];
      const next = [...prev];
      next[idx] = doc;
      return next;
    });
    const companyId = companyIdRef.current;
    if (!companyId) return;
    kbPersist.enqueueUpsertDoc(doc, companyId);
  }, []);

  const deleteIngestedDocument = useCallback((id: string) => {
    setIngestedDocuments(prev => prev.filter(d => d.id !== id));
    kbPersist.enqueueDeleteDoc(id);
  }, []);

  // Legacy KB mutators — write through to knowledge_chunks under the hood.
  // kbEntries is a read-only derived view, so callers still get expected
  // behavior, but data flows through the canonical store every AI path reads.
  const addKBEntry = useCallback(async (entry: Omit<KBEntry, 'id'>) => {
    const nowIso = new Date().toISOString();
    const timestamp = Date.now();
    const chunkId = `manual-${timestamp}`;
    const hash = await stableHash(JSON.stringify({ title: entry.title, body: entry.content }));
    upsertKnowledgeChunks([{
      id: chunkId,
      hostId: entry.hostId,
      propId: entry.propId,
      roomId: entry.roomId,
      kind: 'property_fact',
      title: entry.title,
      body: entry.content,
      chunkHash: hash,
      structured: entry.sectionId ? { sectionId: entry.sectionId } : undefined,
      source: { type: 'manual', extractedAt: nowIso, editedBy: 'agent' },
      visibility: entry.internal ? 'internal' : 'guest_facing',
      status: 'active',
      tags: entry.tags || [],
      createdAt: nowIso,
      updatedAt: nowIso,
    }]);
  }, [upsertKnowledgeChunks]);

  const updateKBEntry = useCallback(async (id: number, updates: Partial<KBEntry>) => {
    const chunkId = `manual-${id}`;
    const patch: Partial<KnowledgeChunk> = {};
    if (updates.title !== undefined) patch.title = updates.title;
    if (updates.content !== undefined) patch.body = updates.content;
    if (updates.tags !== undefined) patch.tags = updates.tags;
    if (updates.internal !== undefined) {
      patch.visibility = updates.internal ? 'internal' : 'guest_facing';
    }
    if (updates.content !== undefined || updates.title !== undefined) {
      patch.chunkHash = await stableHash(JSON.stringify({
        title: updates.title ?? '',
        body: updates.content ?? '',
      }));
    }
    updateKnowledgeChunk(chunkId, patch);
  }, [updateKnowledgeChunk]);

  const deleteKBEntry = useCallback((id: number) => {
    deleteKnowledgeChunks([`manual-${id}`]);
  }, [deleteKnowledgeChunks]);

  const deleteKBEntriesBySource = useCallback((propId: string, source: 'onboarding' | 'manual') => {
    if (source !== 'manual') return;
    const ids = knowledgeChunksRef.current
      .filter(c => c.source.type === 'manual' && c.propId === propId)
      .map(c => c.id);
    if (ids.length > 0) deleteKnowledgeChunks(ids);
  }, [deleteKnowledgeChunks]);

  // ─── Persistence: legacy localStorage stale-check ─────────────────────
  // Old `kb_entries_all` was the pre-chunks store. We don't load from it
  // anymore (kbEntries derives from chunks), but we still read it once on
  // mount to log the migration state for debugging.
  useEffect(() => {
    const localData = localStorage.getItem('kb_entries_all');
    if (!localData) {
      console.log('[KB Load] No persisted data found, using MOCK_KB');
      return;
    }
    try {
      const entries = JSON.parse(localData);
      if (Array.isArray(entries) && entries.length > 0) {
        const manualOnly = entries.filter((e: { source?: string }) => e.source !== 'onboarding');
        console.log(`[KB Load] Ignoring ${manualOnly.length} stale legacy KB entries from localStorage — kbEntries is now derived from knowledge_chunks.`);
      }
    } catch {
      // Malformed legacy data — ignore.
    }
  }, []);

  // ─── Persistence: legacy localStorage mirror of kbEntries ─────────────
  // Kept for back-compat with any tooling that sniffs `kb_entries_all`.
  // The canonical write path is the chunk mutators above.
  useEffect(() => {
    if (kbEntries.length === 0) return;
    const timer = setTimeout(() => {
      try {
        localStorage.setItem('kb_entries_all', JSON.stringify(kbEntries));
        console.log(`[KB Persist] ✓ Saved ${kbEntries.length} entries to localStorage`);
      } catch (err) {
        console.log('[KB Persist] localStorage failed:', err);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [kbEntries]);

  // ─── Knowledge Chunks + Ingested Documents persistence ────────────────
  //
  // Hydrate flow:
  //   a) Read IndexedDB → setState immediately (instant UI on page load)
  //   b) Fetch from Supabase → setState again (canonical state wins)
  //   c) Subscribe to realtime changes → incremental merges forever
  const chunksHydrated = useRef(false);
  const docsHydrated = useRef(false);
  const serverSyncedRef = useRef(false);

  // Seed companyIdRef once proxyCompanyIds resolves. The prototype fallback
  // yields 'delta-hq' for any authenticated user when no explicit mapping
  // exists, so a warmed session always has a valid scope.
  useEffect(() => {
    if (proxyCompanyIds.length > 0) {
      companyIdRef.current = proxyCompanyIds[0] ?? null;
    }
  }, [proxyCompanyIds]);

  // Step 1 — IndexedDB hydrate (fast, offline-safe).
  useEffect(() => {
    (async () => {
      try {
        const [chunks, docs] = await Promise.all([
          kvGet<KnowledgeChunk[]>(STORAGE_KEYS.KB_CHUNKS),
          kvGet<IngestedDocument[]>(STORAGE_KEYS.INGESTED_DOCS),
        ]);
        // Race-safe merge: if the user wrote to state before hydrate
        // completed, fresh writes win over stale cache values.
        if (Array.isArray(chunks)) {
          setKnowledgeChunks(prev => {
            if (prev.length === 0) return chunks;
            const byId = new Map(chunks.map(c => [c.id, c]));
            for (const c of prev) byId.set(c.id, c);
            return Array.from(byId.values());
          });
        }
        if (Array.isArray(docs)) {
          setIngestedDocuments(prev => {
            if (prev.length === 0) return docs;
            const byId = new Map(docs.map(d => [d.id, d]));
            for (const d of prev) byId.set(d.id, d);
            return Array.from(byId.values());
          });
        }
        console.log(`[KB Persist] ✓ Cache hydrated: ${chunks?.length ?? 0} chunks, ${docs?.length ?? 0} docs from IndexedDB`);
      } catch (err) {
        console.warn('[KB Persist] Cache hydrate failed:', err);
      } finally {
        chunksHydrated.current = true;
        docsHydrated.current = true;
      }
    })();
  }, []);

  // Step 2 — Supabase fetch (canonical). Waits for proxyCompanyIds so RLS
  // has a valid scope. Runs once per session; realtime handles updates.
  // Also performs a one-time local→server migration of any chunks that
  // exist in the IndexedDB cache but not on the server.
  useEffect(() => {
    if (proxyCompanyIds.length === 0) return;
    if (serverSyncedRef.current) return;
    serverSyncedRef.current = true;
    const companyId = proxyCompanyIds[0];
    if (!companyId) return;
    (async () => {
      try {
        const [serverChunks, serverDocs] = await Promise.all([
          kbPersist.fetchAllChunks(),
          kbPersist.fetchAllDocs(),
        ]);

        const localChunks = knowledgeChunksRef.current;
        const localDocs = ingestedDocumentsRef.current;

        const serverChunkIds = new Set(serverChunks.map(c => c.id));
        const orphanLocalChunks = localChunks.filter(c => !serverChunkIds.has(c.id));
        const serverDocIds = new Set(serverDocs.map(d => d.id));
        const orphanLocalDocs = localDocs.filter(d => !serverDocIds.has(d.id));

        if (orphanLocalChunks.length > 0 || orphanLocalDocs.length > 0) {
          console.log(`[KB Persist] Migrating ${orphanLocalChunks.length} chunks + ${orphanLocalDocs.length} docs from local cache → Supabase`);
          if (orphanLocalChunks.length > 0) {
            kbPersist.upsertChunks(orphanLocalChunks, companyId).catch(err =>
              console.warn('[KB Persist] Migration upload failed:', err),
            );
          }
          for (const d of orphanLocalDocs) {
            kbPersist.upsertDoc(d, companyId).catch(err =>
              console.warn('[KB Persist] Doc migration upload failed:', err),
            );
          }
        }

        // Server is canonical, but keep local-only items and prefer
        // newer-updatedAt between the two.
        setKnowledgeChunks(prev => {
          const byId = new Map(serverChunks.map(c => [c.id, c]));
          for (const c of prev) {
            const serverCopy = byId.get(c.id);
            if (!serverCopy) { byId.set(c.id, c); continue; }
            if (new Date(c.updatedAt) > new Date(serverCopy.updatedAt)) byId.set(c.id, c);
          }
          return Array.from(byId.values());
        });
        setIngestedDocuments(prev => {
          const byId = new Map(serverDocs.map(d => [d.id, d]));
          for (const d of prev) if (!byId.has(d.id)) byId.set(d.id, d);
          return Array.from(byId.values());
        });
        console.log(`[KB Persist] ✓ Synced from Supabase: ${serverChunks.length} chunks, ${serverDocs.length} docs`);
      } catch (err) {
        console.warn('[KB Persist] Supabase fetch failed — staying on IndexedDB cache:', err);
      }
    })();
  }, [proxyCompanyIds]);

  // Step 3 — Realtime. One tab's mutations become every other tab's
  // incremental merge. Unsubscribe on unmount.
  useEffect(() => {
    if (proxyCompanyIds.length === 0) return;
    const unsub = kbPersist.subscribeKBRealtime({
      onChunkChange: (event, c) => {
        if (event === 'DELETE') {
          setKnowledgeChunks(prev => prev.filter(x => x.id !== c.id));
          return;
        }
        setKnowledgeChunks(prev => {
          const idx = prev.findIndex(x => x.id === c.id);
          if (idx === -1) return [...prev, c as KnowledgeChunk];
          const next = [...prev];
          next[idx] = c as KnowledgeChunk;
          return next;
        });
      },
      onDocChange: (event, d) => {
        if (event === 'DELETE') {
          setIngestedDocuments(prev => prev.filter(x => x.id !== d.id));
          return;
        }
        setIngestedDocuments(prev => {
          const idx = prev.findIndex(x => x.id === d.id);
          if (idx === -1) return [...prev, d as IngestedDocument];
          const next = [...prev];
          next[idx] = d as IngestedDocument;
          return next;
        });
      },
    });
    return unsub;
  }, [proxyCompanyIds]);

  // IndexedDB mirror — fire-and-forget cache writes on every state change.
  useEffect(() => {
    if (!chunksHydrated.current) return;
    const timer = setTimeout(() => {
      kvSet(STORAGE_KEYS.KB_CHUNKS, knowledgeChunks)
        .then(() => console.log(`[KB Persist] ✓ Cached ${knowledgeChunks.length} chunks to IndexedDB`))
        .catch(err => console.warn('[KB Persist] Cache write failed:', err));
    }, 300);
    return () => clearTimeout(timer);
  }, [knowledgeChunks]);

  useEffect(() => {
    if (!docsHydrated.current) return;
    const timer = setTimeout(() => {
      kvSet(STORAGE_KEYS.INGESTED_DOCS, ingestedDocuments)
        .catch(err => console.warn('[KB Persist] Doc cache write failed:', err));
    }, 300);
    return () => clearTimeout(timer);
  }, [ingestedDocuments]);

  return {
    knowledgeChunks,
    upsertKnowledgeChunks,
    updateKnowledgeChunk,
    deleteKnowledgeChunks,
    ingestedDocuments,
    upsertIngestedDocument,
    deleteIngestedDocument,
    kbEntries,
    addKBEntry,
    updateKBEntry,
    deleteKBEntry,
    deleteKBEntriesBySource,
    _knowledgeChunksRef: knowledgeChunksRef,
    _chunksHydratedRef: chunksHydrated,
    _serverSyncedRef: serverSyncedRef,
    _companyIdRef: companyIdRef,
    _setKnowledgeChunks: setKnowledgeChunks,
  };
}
