import { useEffect, useState, useCallback, useRef } from 'react';
import {
  collection, query, onSnapshot, where, doc,
  type Firestore, type Unsubscribe,
} from 'firebase/firestore';
import type { Ticket, Host } from '@/app/data/types';
import { mapV1ThreadToTicket, type FirestoreThread } from '@/lib/firestore-mappers';
import type { EscalationOverride } from '@/lib/compute-ticket-state';

export interface FirestoreConnection {
  hostId: string;
  userId: string;
  db: Firestore;
  companyName: string;
  host: Host;
}

interface UseFirestoreThreadsResult {
  threads: Ticket[];
  isLoading: boolean;
  /** True when new data arrived but we deferred re-sort (active ticket is selected) */
  hasPendingSort: boolean;
  /** Manually trigger a re-sort of the thread list */
  refreshSort: () => void;
}

/**
 * Subscribe to thread lists from multiple Firestore company connections.
 * Merges all threads into a single sorted list.
 *
 * Uses the V1 query path (same as Unified Inbox legacy):
 * 1. Subscribe to `users/{userId}` doc → read `user_to_threads` array
 * 2. Batch-query `user_to_thread` junction → filter is_connected
 * 3. Subscribe to `threads` collection with connected thread IDs
 *
 * Re-sort policy: When `activeTicketId` is set, new data updates in-place
 * but doesn't re-sort. Caller can check `hasPendingSort` and call `refreshSort()`.
 */
export interface BPOOverlayState {
  escalationOverrides: Record<string, EscalationOverride>;
  resolvedIds: Record<string, number>; // threadId → resolvedAt epoch
  handoverReasons: Record<string, string>;
}

/** Split an array into chunks of `size` */
function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

/** Firestore error codes that mean the session has lost its authority. */
function isAuthError(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  return code === 'permission-denied' || code === 'unauthenticated';
}

export function useFirestoreThreads(
  connections: FirestoreConnection[],
  activeTicketId: string | null,
  bpoState?: BPOOverlayState,
  properties?: { hostId: string; name: string }[],
  onAuthError?: (hostId: string) => void,
): UseFirestoreThreadsResult {
  // Stable ref so changing the callback doesn't re-subscribe
  const onAuthErrorRef = useRef(onAuthError);
  onAuthErrorRef.current = onAuthError;

  // Per-host raw thread data
  const threadsByHost = useRef<Map<string, Ticket[]>>(new Map());
  const [threads, setThreads] = useState<Ticket[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [hasPendingSort, setHasPendingSort] = useState(false);
  const loadedHosts = useRef(new Set<string>());

  // Merge all hosts' threads into a single sorted list (most recent first)
  const mergeAndSort = useCallback(() => {
    const all: Ticket[] = [];
    for (const hostThreads of threadsByHost.current.values()) {
      all.push(...hostThreads);
    }
    all.sort((a, b) => (b.slaSetAt || 0) - (a.slaSetAt || 0));
    return all;
  }, []);

  const refreshSort = useCallback(() => {
    const merged = mergeAndSort();
    setThreads(merged);
    setHasPendingSort(false);
  }, [mergeAndSort]);

  // Stable ref for bpoState so the snapshot handlers always see current values
  const bpoStateRef = useRef(bpoState);
  bpoStateRef.current = bpoState;

  // Stable ref for properties so snapshot handlers can resolve property names
  const propertiesRef = useRef(properties);
  propertiesRef.current = properties;

  const activeTicketIdRef = useRef(activeTicketId);
  activeTicketIdRef.current = activeTicketId;

  useEffect(() => {
    if (connections.length === 0) {
      setIsLoading(false);
      setThreads([]);
      return;
    }

    // Per-host teardown registries. The old pattern stashed child
    // unsubscribes on a magic __threadSubs_${hostId} property of an
    // array — type-unsafe and easy to leak on fast navigation. Proper
    // Maps keyed by hostId instead.
    const userUnsubs = new Map<string, Unsubscribe>();
    const junctionUnsubs = new Map<string, Map<string, Unsubscribe>>(); // hostId → chunkKey → unsub
    const threadUnsubs = new Map<string, Map<string, Unsubscribe>>();   // hostId → chunkKey → unsub
    // Short-circuit signal: if user_to_threads array is unchanged from
    // the last snapshot, we skip the junction+thread re-subscription.
    const lastThreadIdSig = new Map<string, string>();
    loadedHosts.current.clear();

    const clearHostSubs = (hostId: string, which: 'junction' | 'threads' | 'both') => {
      if (which === 'junction' || which === 'both') {
        const m = junctionUnsubs.get(hostId);
        if (m) { for (const u of m.values()) u(); m.clear(); }
      }
      if (which === 'threads' || which === 'both') {
        const m = threadUnsubs.get(hostId);
        if (m) { for (const u of m.values()) u(); m.clear(); }
      }
    };

    for (const conn of connections) {
      // V1 Step 1: Subscribe to user doc → get user_to_threads array.
      const userDocRef = doc(conn.db, 'users', conn.userId);

      const unsubUser = onSnapshot(
        userDocRef,
        (userSnapshot) => {
          if (!userSnapshot.exists()) {
            clearHostSubs(conn.hostId, 'both');
            lastThreadIdSig.set(conn.hostId, '');
            threadsByHost.current.set(conn.hostId, []);
            loadedHosts.current.add(conn.hostId);
            updateThreadState(conn.hostId, []);
            return;
          }

          const userData = userSnapshot.data();
          const threadIds: string[] = userData?.user_to_threads || [];

          // Short-circuit: user doc snapshots can fire without any change
          // to the thread list (unread badge tick, last-read marker, etc.).
          // Skip re-subscription if the ID set is identical.
          const sig = [...threadIds].sort().join('|');
          if (sig === lastThreadIdSig.get(conn.hostId)) {
            return;
          }
          lastThreadIdSig.set(conn.hostId, sig);

          if (threadIds.length === 0) {
            clearHostSubs(conn.hostId, 'both');
            threadsByHost.current.set(conn.hostId, []);
            loadedHosts.current.add(conn.hostId);
            updateThreadState(conn.hostId, []);
            return;
          }

          // Replace previous junction + thread subscriptions for this host.
          clearHostSubs(conn.hostId, 'both');
          const hostJunctionSubs = new Map<string, Unsubscribe>();
          const hostThreadSubs = new Map<string, Unsubscribe>();
          junctionUnsubs.set(conn.hostId, hostJunctionSubs);
          threadUnsubs.set(conn.hostId, hostThreadSubs);

          const BATCH_SIZE = 15;

          // Chunk-indexed valid-thread-id sets. When a junction chunk
          // re-fires (is_connected toggled on any of its docs), we
          // rebuild the chunk's threads subscription.
          const validByJunctionChunk = new Map<number, Set<string>>();
          // Chunk-indexed thread tickets so the UI update merges them.
          const chunkResults = new Map<string, Ticket[]>();

          const recomputeValid = () => {
            const all = new Set<string>();
            for (const set of validByJunctionChunk.values()) {
              for (const id of set) all.add(id);
            }
            return all;
          };

          const resubscribeThreadsForHost = () => {
            // Rebuild threads subscriptions to match the current union
            // of valid thread ids. Over-tearing-down is fine — Firestore
            // dedups cache reads and the UI picks up the first snapshot.
            const validIds = Array.from(recomputeValid());
            // Tear down any old thread subs first.
            for (const u of hostThreadSubs.values()) u();
            hostThreadSubs.clear();
            chunkResults.clear();

            if (validIds.length === 0) {
              threadsByHost.current.set(conn.hostId, []);
              loadedHosts.current.add(conn.hostId);
              updateThreadState(conn.hostId, []);
              return;
            }

            const threadChunks = chunkArray(validIds, BATCH_SIZE);
            for (let ci = 0; ci < threadChunks.length; ci++) {
              const chunk = threadChunks[ci];
              const threadsQuery = query(
                collection(conn.db, 'threads'),
                where('__name__', 'in', chunk),
              );
              const chunkKey = `t:${ci}`;
              const unsub = onSnapshot(
                threadsQuery,
                (threadsSnapshot) => {
                  const state = bpoStateRef.current;
                  const chunkTickets = threadsSnapshot.docs
                    .map((tDoc) => {
                      const thread = { thread_id: tDoc.id, ...tDoc.data() } as FirestoreThread;
                      if (thread.is_archived) return null;
                      const propName = propertiesRef.current?.find(p => p.hostId === conn.hostId)?.name || conn.companyName;
                      return mapV1ThreadToTicket(
                        thread,
                        conn.hostId,
                        conn.host,
                        conn.companyName,
                        state?.resolvedIds[thread.thread_id] || null,
                        state?.escalationOverrides[thread.thread_id] || null,
                        state?.handoverReasons[thread.thread_id] || '',
                        propName,
                      );
                    })
                    .filter((t): t is Ticket => t !== null);
                  chunkResults.set(chunkKey, chunkTickets);

                  const allHostTickets: Ticket[] = [];
                  for (const tickets of chunkResults.values()) allHostTickets.push(...tickets);
                  threadsByHost.current.set(conn.hostId, allHostTickets);
                  loadedHosts.current.add(conn.hostId);
                  updateThreadState(conn.hostId, allHostTickets);
                },
                (error) => {
                  console.error(`[Firestore] Threads query error for ${conn.hostId}:`, error);
                  if (isAuthError(error)) onAuthErrorRef.current?.(conn.hostId);
                  loadedHosts.current.add(conn.hostId);
                  if (loadedHosts.current.size >= connections.length) setIsLoading(false);
                },
              );
              hostThreadSubs.set(chunkKey, unsub);
            }
          };

          // V1 Step 2: Subscribe (not getDocs) to user_to_thread junction
          // chunks. Now a revoked connection (is_connected → false)
          // propagates to the UI immediately instead of sitting stale
          // until the page reloads.
          const junctionChunks = chunkArray(threadIds, BATCH_SIZE);
          for (let jci = 0; jci < junctionChunks.length; jci++) {
            const chunk = junctionChunks[jci];
            const junctionQuery = query(
              collection(conn.db, 'user_to_thread'),
              where('__name__', 'in', chunk),
            );
            const junctionKey = `j:${jci}`;
            const unsub = onSnapshot(
              junctionQuery,
              (snap) => {
                const connected = new Set<string>();
                for (const jDoc of snap.docs) {
                  const d = jDoc.data();
                  if (d.is_connected) connected.add(d.thread_id);
                }
                const prev = validByJunctionChunk.get(jci);
                // Only re-subscribe threads if the set actually changed —
                // avoids thrash on noisy junction updates.
                const sameSet = prev && prev.size === connected.size &&
                  [...connected].every((id) => prev.has(id));
                if (sameSet) return;
                validByJunctionChunk.set(jci, connected);
                resubscribeThreadsForHost();
              },
              (error) => {
                console.error(`[Firestore] Junction query error for ${conn.hostId}:`, error);
                if (isAuthError(error)) onAuthErrorRef.current?.(conn.hostId);
                loadedHosts.current.add(conn.hostId);
                if (loadedHosts.current.size >= connections.length) setIsLoading(false);
              },
            );
            hostJunctionSubs.set(junctionKey, unsub);
          }
        },
        (error) => {
          console.error(`[Firestore] User doc error for ${conn.hostId}:`, error);
          if (isAuthError(error)) onAuthErrorRef.current?.(conn.hostId);
          loadedHosts.current.add(conn.hostId);
          if (loadedHosts.current.size >= connections.length) {
            setIsLoading(false);
          }
        },
      );

      userUnsubs.set(conn.hostId, unsubUser);
    }

    function updateThreadState(hostId: string, _tickets: Ticket[]) {
      if (activeTicketIdRef.current) {
        setThreads((prev) => {
          // O(n) Map-based merge — replaces prior host's tickets without
          // scanning-and-filtering, then adds the new host's.
          const merged = new Map<string, Ticket>();
          for (const t of prev) if (t.firestoreHostId !== hostId) merged.set(t.id, t);
          for (const t of _tickets) merged.set(t.id, t);
          return Array.from(merged.values());
        });
        setHasPendingSort(true);
      } else {
        const all = mergeAndSort();
        setThreads(all);
        setHasPendingSort(false);
      }
      setIsLoading(false);
    }

    return () => {
      for (const u of userUnsubs.values()) u();
      userUnsubs.clear();
      for (const m of junctionUnsubs.values()) { for (const u of m.values()) u(); m.clear(); }
      junctionUnsubs.clear();
      for (const m of threadUnsubs.values()) { for (const u of m.values()) u(); m.clear(); }
      threadUnsubs.clear();
      lastThreadIdSig.clear();
    };
  // Re-subscribe when connections change
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connections]);

  return { threads, isLoading, hasPendingSort, refreshSort };
}
