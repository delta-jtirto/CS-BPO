import { useEffect, useState, useCallback, useRef } from 'react';
import {
  collection, query, onSnapshot, where, doc, getDocs,
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

export function useFirestoreThreads(
  connections: FirestoreConnection[],
  activeTicketId: string | null,
  bpoState?: BPOOverlayState,
  properties?: { hostId: string; name: string }[],
): UseFirestoreThreadsResult {
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

    const allUnsubscribes: Unsubscribe[] = [];
    loadedHosts.current.clear();

    for (const conn of connections) {
      // V1 Step 1: Subscribe to user doc → get user_to_threads array
      const userDocRef = doc(conn.db, 'users', conn.userId);

      const unsubUser = onSnapshot(
        userDocRef,
        async (userSnapshot) => {
          // Clean up any previous thread subscriptions for this host
          const hostSubKey = `__threadSubs_${conn.hostId}`;
          const prevSubs = (allUnsubscribes as any)[hostSubKey] as Unsubscribe[] | undefined;
          if (prevSubs) {
            prevSubs.forEach((u) => u());
            prevSubs.length = 0;
          }
          const threadSubs: Unsubscribe[] = [];
          (allUnsubscribes as any)[hostSubKey] = threadSubs;

          if (!userSnapshot.exists()) {
            threadsByHost.current.set(conn.hostId, []);
            loadedHosts.current.add(conn.hostId);
            updateThreadState(conn.hostId, []);
            return;
          }

          const userData = userSnapshot.data();
          const threadIds: string[] = userData?.user_to_threads || [];

          if (threadIds.length === 0) {
            threadsByHost.current.set(conn.hostId, []);
            loadedHosts.current.add(conn.hostId);
            updateThreadState(conn.hostId, []);
            return;
          }

          // V1 Step 2: Batch-query user_to_thread junction → filter is_connected
          const BATCH_SIZE = 15;
          const chunks = chunkArray(threadIds, BATCH_SIZE);
          const validThreadIds: string[] = [];

          try {
            for (const chunk of chunks) {
              const junctionQuery = query(
                collection(conn.db, 'user_to_thread'),
                where('__name__', 'in', chunk),
              );
              const junctionSnapshot = await getDocs(junctionQuery);
              for (const jDoc of junctionSnapshot.docs) {
                if (jDoc.data().is_connected) {
                  validThreadIds.push(jDoc.data().thread_id);
                }
              }
            }
          } catch (err) {
            console.error(`[Firestore] Junction query error for ${conn.hostId}:`, err);
          }

          if (validThreadIds.length === 0) {
            threadsByHost.current.set(conn.hostId, []);
            loadedHosts.current.add(conn.hostId);
            updateThreadState(conn.hostId, []);
            return;
          }

          // V1 Step 3: Subscribe to threads collection with valid IDs
          const threadChunks = chunkArray(validThreadIds, BATCH_SIZE);
          // Accumulate thread docs from all chunks
          const chunkResults = new Map<number, Ticket[]>();

          for (let ci = 0; ci < threadChunks.length; ci++) {
            const chunk = threadChunks[ci];
            const threadsQuery = query(
              collection(conn.db, 'threads'),
              where('__name__', 'in', chunk),
            );

            const unsubThreads = onSnapshot(
              threadsQuery,
              (threadsSnapshot) => {
                const state = bpoStateRef.current;
                const chunkTickets = threadsSnapshot.docs
                  .map((tDoc) => {
                    const thread = { thread_id: tDoc.id, ...tDoc.data() } as FirestoreThread;
                    // Filter archived threads client-side
                    if (thread.is_archived) return null;
                    // Resolve property name from the properties list using the connection's hostId
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

                chunkResults.set(ci, chunkTickets);

                // Merge all chunks for this host
                const allHostTickets: Ticket[] = [];
                for (const tickets of chunkResults.values()) {
                  allHostTickets.push(...tickets);
                }
                threadsByHost.current.set(conn.hostId, allHostTickets);
                loadedHosts.current.add(conn.hostId);
                updateThreadState(conn.hostId, allHostTickets);
              },
              (error) => {
                console.error(`[Firestore] Threads query error for ${conn.hostId}:`, error);
                loadedHosts.current.add(conn.hostId);
                if (loadedHosts.current.size >= connections.length) {
                  setIsLoading(false);
                }
              },
            );

            threadSubs.push(unsubThreads);
          }
        },
        (error) => {
          console.error(`[Firestore] User doc error for ${conn.hostId}:`, error);
          loadedHosts.current.add(conn.hostId);
          if (loadedHosts.current.size >= connections.length) {
            setIsLoading(false);
          }
        },
      );

      allUnsubscribes.push(unsubUser);
    }

    function updateThreadState(hostId: string, _tickets: Ticket[]) {
      if (activeTicketIdRef.current) {
        setThreads((prev) => {
          const otherHosts = prev.filter((t) => t.firestoreHostId !== hostId);
          const merged = [...otherHosts, ..._tickets];
          const deduped = Array.from(new Map(merged.map((t) => [t.id, t])).values());
          return deduped;
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
      allUnsubscribes.forEach((u) => {
        if (typeof u === 'function') u();
      });
      // Clean up thread subs stored on the array
      for (const key of Object.keys(allUnsubscribes)) {
        if (key.startsWith('__threadSubs_')) {
          const subs = (allUnsubscribes as any)[key] as Unsubscribe[];
          subs?.forEach((u) => u());
        }
      }
    };
  // Re-subscribe when connections change
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connections]);

  return { threads, isLoading, hasPendingSort, refreshSort };
}
